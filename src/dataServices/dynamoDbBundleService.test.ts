/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

// eslint-disable-next-line import/no-extraneous-dependencies
import * as AWSMock from 'aws-sdk-mock';

import { QueryInput, TransactWriteItemsInput } from 'aws-sdk/clients/dynamodb';
import AWS from 'aws-sdk';
import { BundleResponse, BatchReadWriteRequest, TypeOperation } from 'fhir-works-on-aws-interface';
import { DynamoDbBundleService } from './dynamoDbBundleService';
import { DynamoDBConverter } from './dynamoDb';
import { timeFromEpochInMsRegExp, utcTimeRegExp, uuidRegExp } from '../../testUtilities/regExpressions';
import DynamoDbHelper from './dynamoDbHelper';
import { DOCUMENT_STATUS_FIELD, LOCK_END_TS_FIELD, REFERENCES_FIELD, VID_FIELD } from './dynamoDbUtil';
// eslint-disable-next-line import/order
import sinon = require('sinon');

AWSMock.setSDKInstance(AWS);

describe('atomicallyReadWriteResources', () => {
    afterEach(() => {
        AWSMock.restore();
        sinon.restore();
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
        async function runCreateTest(shouldReqHasReferences: boolean, useVersionedReferences: boolean = false) {
            // BUILD
            const transactWriteItemSpy = sinon.spy();
            AWSMock.mock('DynamoDB', 'transactWriteItems', (params: TransactWriteItemsInput, callback: Function) => {
                transactWriteItemSpy(params);
                callback(null, {});
            });
            const dynamoDb = new AWS.DynamoDB();
            let versionedLinks;
            if (useVersionedReferences) {
                versionedLinks = {
                    Patient: ['managingOrganization.reference'],
                };
                const organizationResource: any = {
                    resourceType: 'Organization',
                    name: 'ACME .Inc',
                    active: true,
                    meta: { versionId: 3 },
                };

                sinon
                    .stub(DynamoDbHelper.prototype, 'getMostRecentResource')
                    .withArgs('Organization', '1', 'meta')
                    .returns(Promise.resolve({ message: 'Resource found', resource: organizationResource }));
            }
            const transactionService = new DynamoDbBundleService(dynamoDb, false, undefined, { versionedLinks });

            const resourceType = 'Patient';
            const resource: any = {
                resourceType,
                name: [
                    {
                        family: 'Smith',
                        given: ['John'],
                    },
                ],
                gender: 'male',
                meta: { security: 'gondor' },
            };

            const organization = 'Organization/1';
            if (shouldReqHasReferences) {
                resource.managingOrganization = {
                    reference: organization,
                };
            }

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

            const insertedResourceJson: any = {
                ...resource,
                id: 'holder',
                meta: {
                    lastUpdated: 'holder',
                    versionId: '1',
                    security: 'gondor',
                },
            };
            insertedResourceJson[DOCUMENT_STATUS_FIELD] = 'PENDING';
            insertedResourceJson[VID_FIELD] = 1;
            if (shouldReqHasReferences) {
                if (useVersionedReferences) {
                    insertedResourceJson[REFERENCES_FIELD] = [`${organization}/_history/3`];
                } else {
                    insertedResourceJson[REFERENCES_FIELD] = [organization];
                }
            } else {
                insertedResourceJson[REFERENCES_FIELD] = [];
            }
            insertedResourceJson[LOCK_END_TS_FIELD] = Date.now();

            const insertedResource = DynamoDBConverter.marshall(insertedResourceJson);

            // Setting up test assertions
            insertedResource.id.S = expect.stringMatching(uuidRegExp);
            insertedResource[LOCK_END_TS_FIELD].N = expect.stringMatching(timeFromEpochInMsRegExp);
            insertedResource.meta!.M!.lastUpdated.S = expect.stringMatching(utcTimeRegExp);

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
                                id: { S: id },
                                vid: { N: '1' },
                            },
                            UpdateExpression: 'set documentStatus = :newStatus, lockEndTs = :futureEndTs',
                            ConditionExpression: 'resourceType = :resourceType',
                            ExpressionAttributeValues: {
                                ':newStatus': { S: 'AVAILABLE' },
                                ':futureEndTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                                ':resourceType': { S: 'Patient' },
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
                        vid: '1',
                        operation: 'create',
                        lastModified: expect.stringMatching(utcTimeRegExp),
                        resourceType: 'Patient',
                        resource: {
                            ...resource,
                            id,
                            meta: {
                                lastUpdated: expect.stringMatching(utcTimeRegExp),
                                versionId: '1',
                                security: 'gondor',
                            },
                        },
                    },
                ],
                success: true,
            });
        }
        test('CREATING a resource with no references', async () => {
            await runCreateTest(false);
        });

        test('CREATING a resource with references', async () => {
            await runCreateTest(true);
        });

        test('CREATING a resource with references and versioned reference links', async () => {
            await runCreateTest(true, true);
        });

        async function runUpdateTest(shouldReqHasReferences: boolean, useVersionedReferences: boolean = false) {
            // BUILD
            const transactWriteItemSpy = sinon.spy();
            AWSMock.mock('DynamoDB', 'transactWriteItems', (params: TransactWriteItemsInput, callback: Function) => {
                transactWriteItemSpy(params);
                callback(null, {});
            });
            const resourceType = 'Patient';
            const oldVid = 1;
            const newVid = oldVid + 1;
            const organization = 'Organization/1';
            const oldResource: any = {
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

            if (shouldReqHasReferences) {
                oldResource.managingOrganization = {
                    reference: organization,
                };
            }

            const newResource = {
                ...oldResource,
                test: 'test',
                meta: { versionId: newVid.toString(), lastUpdated: new Date().toISOString(), security: 'skynet' },
            };

            const getMostRecentResourceStub = sinon.stub(DynamoDbHelper.prototype, 'getMostRecentResource');
            getMostRecentResourceStub
                .withArgs(resourceType, id, 'id, resourceType, meta')
                .returns(Promise.resolve({ message: 'Resource found', resource: oldResource }));

            const dynamoDb = new AWS.DynamoDB();
            let versionedLinks;
            if (useVersionedReferences) {
                versionedLinks = {
                    Patient: ['managingOrganization.reference'],
                };
                const organizationResource: any = {
                    resourceType: 'Organization',
                    name: 'ACME .Inc',
                    active: true,
                    meta: { versionId: 3 },
                };

                getMostRecentResourceStub
                    .withArgs('Organization', '1', 'meta')
                    .returns(Promise.resolve({ message: 'Resource found', resource: organizationResource }));
            }
            const transactionService = new DynamoDbBundleService(dynamoDb, false, undefined, { versionedLinks });

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
                                'resourceType = :resourceType AND (documentStatus = :oldStatus OR (lockEndTs < :currentTs AND (documentStatus = :lockStatus OR documentStatus = :pendingStatus OR documentStatus = :pendingDeleteStatus)))',
                            UpdateExpression: 'set documentStatus = :newStatus, lockEndTs = :futureEndTs',
                            ExpressionAttributeValues: {
                                ':newStatus': { S: 'LOCKED' },
                                ':lockStatus': { S: 'LOCKED' },
                                ':oldStatus': { S: 'AVAILABLE' },
                                ':pendingDeleteStatus': { S: 'PENDING_DELETE' },
                                ':pendingStatus': { S: 'PENDING' },
                                ':currentTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                                ':futureEndTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                                ':resourceType': { S: 'Patient' },
                            },
                        },
                    },
                ],
            });

            const insertedResourceJson: any = {
                ...newResource,
            };
            insertedResourceJson[DOCUMENT_STATUS_FIELD] = 'PENDING';
            insertedResourceJson[VID_FIELD] = newVid;
            if (shouldReqHasReferences) {
                if (useVersionedReferences) {
                    insertedResourceJson[REFERENCES_FIELD] = [`${organization}/_history/3`];
                } else {
                    insertedResourceJson[REFERENCES_FIELD] = [organization];
                }
            } else {
                insertedResourceJson[REFERENCES_FIELD] = [];
            }
            insertedResourceJson[LOCK_END_TS_FIELD] = Date.now();

            const insertedResource = DynamoDBConverter.marshall(insertedResourceJson);
            insertedResource.lockEndTs.N = expect.stringMatching(timeFromEpochInMsRegExp);
            insertedResource.meta!.M!.lastUpdated.S = expect.stringMatching(utcTimeRegExp);
            insertedResource.meta!.M!.versionId.S = newVid.toString();

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
                            ConditionExpression: 'resourceType = :resourceType',
                            UpdateExpression: 'set documentStatus = :newStatus, lockEndTs = :futureEndTs',
                            ExpressionAttributeValues: {
                                ':newStatus': { S: 'DELETED' },
                                ':futureEndTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                                ':resourceType': {
                                    S: 'Patient',
                                },
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
                            ConditionExpression: 'resourceType = :resourceType',
                            UpdateExpression: 'set documentStatus = :newStatus, lockEndTs = :futureEndTs',
                            ExpressionAttributeValues: {
                                ':newStatus': { S: 'AVAILABLE' },
                                ':futureEndTs': { N: expect.stringMatching(timeFromEpochInMsRegExp) },
                                ':resourceType': {
                                    S: 'Patient',
                                },
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
                        resource: {
                            ...newResource,
                            meta: {
                                versionId: newVid.toString(),
                                lastUpdated: expect.stringMatching(utcTimeRegExp),
                                security: 'skynet',
                            },
                        },
                    },
                ],
                success: true,
            });
        }

        test('UPDATING a resource with no references', async () => {
            await runUpdateTest(false);
        });

        test('UPDATING a resource with references', async () => {
            await runUpdateTest(true);
        });

        test('UPDATING a resource with references and versioned reference links', async () => {
            await runUpdateTest(true, true);
        });
    });

    describe('Update as Create Cases', () => {
        const runTest = async (supportUpdateCreate: boolean, operation: TypeOperation, isLockSuccessful: boolean) => {
            // READ items (Failure)
            AWSMock.mock('DynamoDB', 'query', (params: QueryInput, callback: Function) => {
                callback(null, { Items: [] });
            });

            const dynamoDb = new AWS.DynamoDB();
            const bundleService = new DynamoDbBundleService(dynamoDb, supportUpdateCreate);

            const batchRequest: BatchReadWriteRequest = {
                operation,
                resourceType: 'Patient',
                id,
                resource: `Patient/${id}`,
            };
            // @ts-ignore
            const actualResponse = await bundleService.lockItems([batchRequest]);
            if (isLockSuccessful) {
                expect(actualResponse).toStrictEqual({
                    lockedItems: [],
                    successfulLock: true,
                });
            } else {
                expect(actualResponse).toStrictEqual({
                    errorMessage: `Failed to find resources: Patient/${id}`,
                    errorType: 'USER_ERROR',
                    lockedItems: [],
                    successfulLock: false,
                });
            }
        };

        const testCases = [
            // ['supportUpdateCreate', 'operation', 'isLockSuccessful'],
            [true, 'create', true],
            [true, 'update', true],
            [true, 'read', false],
            [false, 'create', true],
            [false, 'update', false],
            [false, 'read', false],
        ];

        // eslint-disable-next-line no-restricted-syntax
        for (const [supportUpdateCreate, operation, isLockSuccessful] of testCases) {
            test('lock update ', async () => {
                await runTest(supportUpdateCreate as boolean, operation as TypeOperation, isLockSuccessful as boolean);
            });
        }
    });
});
