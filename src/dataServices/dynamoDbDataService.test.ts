/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

// eslint-disable-next-line import/no-extraneous-dependencies
import AWSMock from 'aws-sdk-mock';

import { GetItemInput, PutItemInput, QueryInput, UpdateItemInput } from 'aws-sdk/clients/dynamodb';
import * as AWS from 'aws-sdk';
// eslint-disable-next-line import/no-extraneous-dependencies
import { BundleResponse, BatchReadWriteResponse, ResourceVersionNotFoundError } from 'fhir-works-on-aws-interface';
import { utcTimeRegExp } from '../../testUtilities/regExpressions';
import { DynamoDbBundleService } from './dynamoDbBundleService';
import { DynamoDbDataService } from './dynamoDbDataService';
import { DynamoDBConverter } from './dynamoDb';
import DynamoDbHelper from './dynamoDbHelper';

AWSMock.setSDKInstance(AWS);

// eslint-disable-next-line import/order
import sinon = require('sinon');

describe('CREATE', () => {
    afterEach(() => {
        AWSMock.restore();
    });
    test('SUCCESS: Create Resource', async () => {
        // BUILD
        const id = '8cafa46d-08b4-4ee4-b51b-803e20ae8126';
        const resourceType = 'Patient';
        const resource = {
            id,
            resourceType,
            name: [
                {
                    family: 'Jameson',
                    given: ['Matt'],
                },
            ],
        };

        // READ items (Success)
        AWSMock.mock('DynamoDB', 'putItem', (params: PutItemInput, callback: Function) => {
            callback(null, 'success');
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE
        const serviceResponse = await dynamoDbDataService.createResource({ resource, resourceType, id });

        // CHECK
        const expectedResource: any = { ...resource };
        expectedResource.meta = {
            versionId: '1',
            lastUpdated: expect.stringMatching(utcTimeRegExp),
        };

        expect(serviceResponse.success).toEqual(true);
        expect(serviceResponse.message).toEqual('Resource created');
        expect(serviceResponse.resource).toStrictEqual(expectedResource);
    });
});

describe('READ', () => {
    // beforeEach(() => {
    //     // Ensures that for each test, we test the assertions in the catch block
    //     expect.hasAssertions();
    // });
    afterEach(() => {
        AWSMock.restore();
    });
    test('SUCCESS: Get Resource', async () => {
        // BUILD
        const id = '8cafa46d-08b4-4ee4-b51b-803e20ae8126';
        const resourceType = 'Patient';
        const resource = {
            id,
            resourceType,
            name: [
                {
                    family: 'Jameson',
                    given: ['Matt'],
                },
            ],
            meta: { versionId: '1', lastUpdated: new Date().toISOString() },
        };

        sinon
            .stub(DynamoDbHelper.prototype, 'getMostRecentValidResource')
            .returns(Promise.resolve({ message: 'Resource found', resource }));

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE
        const serviceResponse = await dynamoDbDataService.readResource({ resourceType, id });

        // CHECK
        expect(serviceResponse.message).toEqual('Resource found');
        expect(serviceResponse.resource).toStrictEqual(resource);
    });
    test('SUCCESS: Get Versioned Resource', async () => {
        // BUILD
        const id = '8cafa46d-08b4-4ee4-b51b-803e20ae8126';
        const vid = '5';
        const resourceType = 'Patient';
        const resource = {
            id,
            vid: parseInt(vid, 10),
            resourceType,
            documentStatus: 'shouldberemoved',
            name: [
                {
                    family: 'Jameson',
                    given: ['Matt'],
                },
            ],
            meta: { versionId: vid, lastUpdated: new Date().toISOString() },
        };

        // READ items (Success)
        AWSMock.mock('DynamoDB', 'getItem', (params: GetItemInput, callback: Function) => {
            callback(null, {
                Item: DynamoDBConverter.marshall(resource),
            });
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB({ apiVersion: '2012-08-10' }));

        // OPERATE
        const serviceResponse = await dynamoDbDataService.vReadResource({ resourceType, id, vid });

        // CHECK
        expect(serviceResponse.message).toEqual('Resource found');
        const expectedResource = { ...resource };
        delete expectedResource.vid;
        delete expectedResource.documentStatus;
        expect(serviceResponse.resource).toStrictEqual(expectedResource);
    });

    test('ERROR: Get Versioned Resource', async () => {
        // BUILD
        const id = '8cafa46d-08b4-4ee4-b51b-803e20ae8126';
        const vid = '5';
        const resourceType = 'Patient';

        // READ items (Success)
        AWSMock.mock('DynamoDB', 'getItem', (params: GetItemInput, callback: Function) => {
            callback(null, { Item: undefined });
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());
        try {
            // OPERATE
            await dynamoDbDataService.vReadResource({ resourceType, id, vid });
        } catch (e) {
            // CHECK
            expect(e).toMatchObject(new ResourceVersionNotFoundError(resourceType, id, vid));
        }
    });
});

describe('UPDATE', () => {
    afterEach(() => {
        AWSMock.restore();
    });

    test('Successfully update resource', async () => {
        // BUILD
        const id = '8cafa46d-08b4-4ee4-b51b-803e20ae8126';
        const resource = {
            id,
            vid: 1,
            resourceType: 'Patient',
            name: [
                {
                    family: 'Jameson',
                    given: ['Matt'],
                },
            ],
            meta: { versionId: '1', lastUpdated: new Date().toISOString() },
        };

        // READ items (Success)
        AWSMock.mock('DynamoDB', 'query', (params: QueryInput, callback: Function) => {
            callback(null, {
                Items: [DynamoDBConverter.marshall(resource)],
            });
        });

        const vid = 2;
        const batchReadWriteResponse: BatchReadWriteResponse = {
            id,
            vid: vid.toString(),
            resourceType: 'Patient',
            operation: 'update',
            resource: {},
            lastModified: '2020-06-18T20:20:12.763Z',
        };

        const batchReadWriteServiceResponse: BundleResponse = {
            success: true,
            message: '',
            batchReadWriteResponses: [batchReadWriteResponse],
        };

        sinon.stub(DynamoDbBundleService.prototype, 'batch').returns(Promise.resolve(batchReadWriteServiceResponse));
        sinon
            .stub(DynamoDbBundleService.prototype, 'transaction')
            .returns(Promise.resolve(batchReadWriteServiceResponse));

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE
        const serviceResponse = await dynamoDbDataService.updateResource({ resourceType: 'Patient', id, resource });

        // CHECK
        const expectedResource: any = { ...resource };
        expectedResource.meta = {
            versionId: vid.toString(),
            lastUpdated: expect.stringMatching(utcTimeRegExp),
        };

        expect(serviceResponse.success).toEqual(true);
        expect(serviceResponse.message).toEqual('Resource updated');
        expect(serviceResponse.resource).toStrictEqual(expectedResource);
    });
});

describe('DELETE', () => {
    afterEach(() => {
        AWSMock.restore();
    });

    test('Successfully delete resource', async () => {
        // BUILD
        const id = '8cafa46d-08b4-4ee4-b51b-803e20ae8126';
        const resourceType = 'Patient';
        const vid = 1;
        const resource = {
            id,
            vid,
            resourceType,
            name: [
                {
                    family: 'Jameson',
                    given: ['Matt'],
                },
            ],
            meta: { versionId: vid.toString(), lastUpdated: new Date().toISOString() },
        };

        // READ items (Success)
        AWSMock.mock('DynamoDB', 'query', (params: QueryInput, callback: Function) => {
            callback(null, {
                Items: [DynamoDBConverter.marshall(resource)],
            });
        });

        // UPDATE (delete) item (Success)
        AWSMock.mock('DynamoDB', 'updateItem', (params: UpdateItemInput, callback: Function) => {
            callback(null, {
                Items: [DynamoDBConverter.marshall(resource)],
            });
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE
        const serviceResponse = await dynamoDbDataService.deleteResource({ resourceType, id });

        // CHECK
        expect(serviceResponse.success).toEqual(true);
        expect(serviceResponse.message).toEqual(
            `Successfully deleted ResourceType: ${resourceType}, Id: ${id}, VersionId: ${vid}`,
        );
    });
});
