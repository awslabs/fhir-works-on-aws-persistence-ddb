/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

// eslint-disable-next-line import/no-extraneous-dependencies
import AWSMock from 'aws-sdk-mock';

import { QueryInput, TransactWriteItemsInput } from 'aws-sdk/clients/dynamodb';
import * as AWS from 'aws-sdk';
import { BundleResponse, BatchReadWriteRequest } from 'fhir-works-on-aws-interface';
import { DynamoDbBundleService } from './dynamoDbBundleService';
import { DynamoDBConverter } from './dynamoDb';
import { timeFromEpochInMsRegExp, utcTimeRegExp, uuidRegExp } from '../../testUtilities/regExpressions';
import DynamoDbHelper from './dynamoDbHelper';
// eslint-disable-next-line import/order
import sinon = require('sinon');

AWSMock.setSDKInstance(AWS);

describe('atomicallyReadWriteResources', () => {
    afterEach(() => {
        AWSMock.restore();
    });

    const id = 'bce8411e-c15e-448c-95dd-69155a837405';
    describe('ERROR Cases', () => {
        const runTest = async (expectedResponse: BundleResponse) => {
            const dynamoDb = new AWS.DynamoDB();
            const bundleService = new DynamoDbBundleService(dynamoDb);

            const deleteRequest: BatchReadWriteRequest = {
                operation: 'delete',
                resourceType: 'Patient',
                id,
                resource: 'Patient/bce8411e-c15e-448c-95dd-69155a837405',
            };
            const actualResponse = await bundleService.transaction({
                requests: [deleteRequest],
                startTime: new Date(),
            });

            expect(actualResponse).toStrictEqual(expectedResponse);
        };

        test('LOCK: Delete item that does not exist', async () => {
            // READ items (Failure)
            AWSMock.mock('DynamoDB', 'query', (params: QueryInput, callback: Function) => {
                callback(null, { Items: [] });
            });

            const expectedResponse: BundleResponse = {
                success: false,
                message: 'Failed to find resources: Patient/bce8411e-c15e-448c-95dd-69155a837405',
                batchReadWriteResponses: [],
                errorType: 'USER_ERROR',
            };

            await runTest(expectedResponse);
        });

        test('LOCK: Try to delete item that exist, but system cannot obtain the lock', async () => {
            // READ items (Success)
            AWSMock.mock('DynamoDB', 'query', (params: QueryInput, callback: Function) => {
                callback(null, {
                    Items: [
                        DynamoDBConverter.marshall({
                            id,
                            vid: '1',
                            resourceType: 'Patient',
                            meta: { versionId: '1', lastUpdated: new Date().toISOString() },
                        }),
                    ],
                });
            });

            // LOCK items (Failure)
            AWSMock.mock('DynamoDB', 'transactWriteItems', (params: TransactWriteItemsInput, callback: Function) => {
                callback('ConditionalCheckFailed', {});
            });

            const expectedResponse: BundleResponse = {
                success: false,
                message: 'Failed to lock resources for transaction. Please try again after 35 seconds.',
                batchReadWriteResponses: [],
                errorType: 'SYSTEM_ERROR',
            };

            await runTest(expectedResponse);
        });

        test('STAGING: Item exist and lock obtained, but failed to stage', async () => {
            // READ items (Success)
            AWSMock.mock('DynamoDB', 'query', (params: QueryInput, callback: Function) => {
                callback(null, {
                    Items: [
                        DynamoDBConverter.marshall({
                            id,
                            vid: '1',
                            resourceType: 'Patient',
                            meta: { versionId: '1', lastUpdated: new Date().toISOString() },
                        }),
                    ],
                });
            });

            const transactWriteItemStub = sinon.stub();
            // LOCK Items (Success)
            transactWriteItemStub.onFirstCall().returns({ error: null, value: {} });

            // STAGE Items (Failure)
            transactWriteItemStub.onSecondCall().returns({ error: 'ConditionalCheckFailed', value: {} });

            // Rollback Items (Success)
            transactWriteItemStub.onThirdCall().returns({ error: null, value: {} });
            AWSMock.mock('DynamoDB', 'transactWriteItems', (params: TransactWriteItemsInput, callback: Function) => {
                const result = transactWriteItemStub();
                callback(result?.error || null, result?.value || {});
            });

            const expectedResponse: BundleResponse = {
                success: false,
                message: 'Failed to stage resources for transaction',
                batchReadWriteResponses: [],
                errorType: 'SYSTEM_ERROR',
            };

            await runTest(expectedResponse);
        });
    });

    describe('SUCCESS Cases', () => {
        // When creating a resource, no locks is needed because no items in DDB to put a lock on yet
        test('CREATING a resource', async () => {
            // BUILD
            const transactWriteItemSpy = sinon.spy();
            AWSMock.mock('DynamoDB', 'transactWriteItems', (params: TransactWriteItemsInput, callback: Function) => {
                transactWriteItemSpy(params);
                callback(null, {});
            });

            const dynamoDb = new AWS.DynamoDB();
            const transactionService = new DynamoDbBundleService(dynamoDb);

            const resourceType = 'Patient';
            const resource = {
                resourceType,
                name: [
                    {
                        family: 'Smith',
                        given: ['John'],
                    },
                ],
                gender: 'male',
            };

            const createRequest: BatchReadWriteRequest = {
                operation: 'create',
                resourceType,
                id,
                resource,
            };

            // OPERATE
            const actualResponse = await transactionService.transaction({
                requests: [createRequest],
                startTime: new Date(),
            });

            // CHECK
            // transactWriteItem requests is called twice
            expect(transactWriteItemSpy.calledTwice).toBeTruthy();

            const insertedResource = DynamoDBConverter.marshall({
                ...resource,
                documentStatus: 'PENDING',
                vid: 1,
                id: 'holder',
                lockEndTs: 5, // test number
                meta: {
                    lastUpdated: 'holder',
                    versionId: '1',
                },
            });
            insertedResource.id.S = expect.stringMatching(uuidRegExp);
            insertedResource.lockEndTs.N = expect.stringMatching(timeFromEpochInMsRegExp);
            if (insertedResource.meta.M) {
                insertedResource.meta.M.lastUpdated.S = expect.stringMatching(utcTimeRegExp);
            }

            // 1. create new Patient record with documentStatus of 'PENDING'
            expect(transactWriteItemSpy.getCall(0).args[0]).toStrictEqual({
                TransactItems: [
                    {
                        Put: {
                            TableName: '',
                            Item: insertedResource,
                        },
                    },
                ],
            });

            // 2. change Patient record's documentStatus to be 'AVAILABLE'
            expect(transactWriteItemSpy.getCall(1).args[0]).toStrictEqual({
                TransactItems: [
                    {
                        Update: {
                            TableName: '',
                            Key: {
                                id: { S: 'bce8411e-c15e-448c-95dd-69155a837405' },
                                vid: { N: '1' },
                            },
                            UpdateExpression: 'set documentStatus = :newStatus, lockEndTs = :futureEndTs',
                            ExpressionAttributeValues: {
                                ':newStatus': { S: 'AVAILABLE' },
                                ':futureEndTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                            },
                        },
                    },
                ],
            });

            expect(actualResponse).toStrictEqual({
                message: 'Successfully committed requests to DB',
                batchReadWriteResponses: [
                    {
                        id: 'bce8411e-c15e-448c-95dd-69155a837405',
                        vid: '1',
                        operation: 'create',
                        lastModified: expect.stringMatching(utcTimeRegExp),
                        resourceType: 'Patient',
                        resource: {},
                    },
                ],
                success: true,
            });
        });

        test('UPDATING a resource', async () => {
            // BUILD
            const transactWriteItemSpy = sinon.spy();
            AWSMock.mock('DynamoDB', 'transactWriteItems', (params: TransactWriteItemsInput, callback: Function) => {
                transactWriteItemSpy(params);
                callback(null, {});
            });
            const resourceType = 'Patient';
            const oldVid = 1;
            const newVid = oldVid + 1;
            const oldResource = {
                id,
                resourceType,
                name: [
                    {
                        family: 'Jameson',
                        given: ['Matt'],
                    },
                ],
                meta: { versionId: oldVid.toString(), lastUpdated: new Date().toISOString() },
            };
            const newResource = { ...oldResource, test: 'test' };

            sinon
                .stub(DynamoDbHelper.prototype, 'getMostRecentResource')
                .returns(Promise.resolve({ message: 'Resource found', resource: oldResource }));

            const dynamoDb = new AWS.DynamoDB();
            const transactionService = new DynamoDbBundleService(dynamoDb);

            const updateRequest: BatchReadWriteRequest = {
                operation: 'update',
                resourceType,
                id,
                resource: newResource,
            };

            // OPERATE
            const actualResponse = await transactionService.transaction({
                requests: [updateRequest],
                startTime: new Date(),
            });

            // CHECK
            // transactWriteItem requests is called thrice
            expect(transactWriteItemSpy.calledThrice).toBeTruthy();

            // 0. change Patient record's documentStatus to be 'LOCKED'
            expect(transactWriteItemSpy.getCall(0).args[0]).toStrictEqual({
                TransactItems: [
                    {
                        Update: {
                            TableName: '',
                            Key: {
                                id: { S: id },
                                vid: { N: oldVid.toString() },
                            },
                            ConditionExpression:
                                'documentStatus = :oldStatus OR (lockEndTs < :currentTs AND (documentStatus = :lockStatus OR documentStatus = :pendingStatus OR documentStatus = :pendingDeleteStatus))',
                            UpdateExpression: 'set documentStatus = :newStatus, lockEndTs = :futureEndTs',
                            ExpressionAttributeValues: {
                                ':newStatus': { S: 'LOCKED' },
                                ':lockStatus': { S: 'LOCKED' },
                                ':oldStatus': { S: 'AVAILABLE' },
                                ':pendingDeleteStatus': { S: 'PENDING_DELETE' },
                                ':pendingStatus': { S: 'PENDING' },
                                ':currentTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                                ':futureEndTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                            },
                        },
                    },
                ],
            });

            const insertedResource = DynamoDBConverter.marshall({
                ...newResource,
                documentStatus: 'PENDING',
                vid: newVid,
                lockEndTs: 5, // test number
            });
            insertedResource.lockEndTs.N = expect.stringMatching(timeFromEpochInMsRegExp);

            // 1. create new Patient record with documentStatus of 'PENDING'
            expect(transactWriteItemSpy.getCall(1).args[0]).toStrictEqual({
                TransactItems: [
                    {
                        Put: {
                            TableName: '',
                            Item: insertedResource,
                        },
                    },
                ],
            });

            // 2. change Patient record's documentStatus to be 'AVAILABLE'
            expect(transactWriteItemSpy.getCall(2).args[0]).toStrictEqual({
                TransactItems: [
                    {
                        Update: {
                            TableName: '',
                            Key: {
                                id: { S: id },
                                vid: { N: oldVid.toString() },
                            },
                            UpdateExpression: 'set documentStatus = :newStatus, lockEndTs = :futureEndTs',
                            ExpressionAttributeValues: {
                                ':newStatus': { S: 'DELETED' },
                                ':futureEndTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                            },
                        },
                    },
                    {
                        Update: {
                            TableName: '',
                            Key: {
                                id: { S: id },
                                vid: { N: newVid.toString() },
                            },
                            UpdateExpression: 'set documentStatus = :newStatus, lockEndTs = :futureEndTs',
                            ExpressionAttributeValues: {
                                ':newStatus': { S: 'AVAILABLE' },
                                ':futureEndTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                            },
                        },
                    },
                ],
            });

            expect(actualResponse).toStrictEqual({
                message: 'Successfully committed requests to DB',
                batchReadWriteResponses: [
                    {
                        id,
                        vid: newVid.toString(),
                        operation: 'update',
                        lastModified: expect.stringMatching(utcTimeRegExp),
                        resourceType,
                        resource: {},
                    },
                ],
                success: true,
            });
        });
    });
});
