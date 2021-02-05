/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

// eslint-disable-next-line import/no-extraneous-dependencies
import * as AWSMock from 'aws-sdk-mock';

import { GetItemInput, PutItemInput, QueryInput, UpdateItemInput } from 'aws-sdk/clients/dynamodb';
import AWS from 'aws-sdk';
import isEqual from 'lodash/isEqual';
// eslint-disable-next-line import/no-extraneous-dependencies
import {
    BundleResponse,
    InitiateExportRequest,
    ResourceNotFoundError,
    ExportJobStatus,
    ResourceVersionNotFoundError,
    InvalidResourceError,
} from 'fhir-works-on-aws-interface';
import { TooManyConcurrentExportRequestsError } from 'fhir-works-on-aws-interface/lib/errors/TooManyConcurrentExportRequestsError';
import each from 'jest-each';
import { utcTimeRegExp, uuidRegExp } from '../../testUtilities/regExpressions';
import { DynamoDbBundleService } from './dynamoDbBundleService';
import { DynamoDbDataService } from './dynamoDbDataService';
import { DynamoDBConverter } from './dynamoDb';
import DynamoDbHelper from './dynamoDbHelper';
import DynamoDbParamBuilder from './dynamoDbParamBuilder';
import { ConditionalCheckFailedExceptionMock } from '../../testUtilities/ConditionalCheckFailedException';

jest.mock('../bulkExport/bulkExport');
AWSMock.setSDKInstance(AWS);

// eslint-disable-next-line import/order
import sinon = require('sinon');

beforeEach(() => {
    expect.hasAssertions();
});
afterEach(() => {
    AWSMock.restore();
});

describe('CREATE', () => {
    afterEach(() => {
        AWSMock.restore();
    });
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
    test('SUCCESS: Create Resource', async () => {
        // READ items (Success)
        AWSMock.mock('DynamoDB', 'putItem', (params: PutItemInput, callback: Function) => {
            callback(null, 'success');
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE
        const serviceResponse = await dynamoDbDataService.createResource({ resource, resourceType });

        // CHECK
        const expectedResource: any = { ...resource };
        expectedResource.meta = {
            versionId: '1',
            lastUpdated: expect.stringMatching(utcTimeRegExp),
        };
        expectedResource.id = expect.stringMatching(uuidRegExp);

        expect(serviceResponse.success).toEqual(true);
        expect(serviceResponse.message).toEqual('Resource created');
        expect(serviceResponse.resource).toStrictEqual(expectedResource);
    });
    test('FAILED: Resource with Id already exists', async () => {
        // READ items (Success)
        AWSMock.mock('DynamoDB', 'putItem', (params: PutItemInput, callback: Function) => {
            callback(new ConditionalCheckFailedExceptionMock(), {});
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE, CHECK
        await expect(dynamoDbDataService.createResource({ resource, resourceType, id })).rejects.toThrowError(
            new InvalidResourceError('Auto generated id matched an existing id'),
        );
    });
});

describe('READ', () => {
    // beforeEach(() => {
    //     // Ensures that for each test, we test the assertions in the catch block
    //     expect.hasAssertions();
    // });
    afterEach(() => {
        AWSMock.restore();
        sinon.restore();
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
            .stub(DynamoDbHelper.prototype, 'getMostRecentUserReadableResource')
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
        const expectedResource = { ...resource } as any;
        delete expectedResource.vid;
        delete expectedResource.documentStatus;
        expect(serviceResponse.resource).toStrictEqual(expectedResource);
    });

    test('ERROR: Get Versioned Resource: Unable to find resource', async () => {
        // BUILD
        const id = '8cafa46d-08b4-4ee4-b51b-803e20ae8126';
        const vid = '5';
        const resourceType = 'Patient';

        // READ items (Success)
        AWSMock.mock('DynamoDB', 'getItem', (params: GetItemInput, callback: Function) => {
            callback(null, { Item: undefined });
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE, CHECK
        await expect(dynamoDbDataService.vReadResource({ resourceType, id, vid })).rejects.toThrowError(
            new ResourceVersionNotFoundError(resourceType, id, vid),
        );
    });

    test('ERROR: Get Versioned Resource: resourceType of request does not match resourceType retrieved', async () => {
        // BUILD
        const id = '8cafa46d-08b4-4ee4-b51b-803e20ae8126';
        const vid = '5';
        const resourceType = 'Patient';

        // READ items (Success)
        AWSMock.mock('DynamoDB', 'getItem', (params: GetItemInput, callback: Function) => {
            callback(null, { Item: DynamoDBConverter.marshall({ id, vid, resourceType: 'Observation' }) });
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());
        await expect(dynamoDbDataService.vReadResource({ resourceType, id, vid })).rejects.toThrowError(
            new ResourceVersionNotFoundError(resourceType, id, vid),
        );
    });
});

describe('UPDATE', () => {
    afterEach(() => {
        AWSMock.restore();
        sinon.restore();
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
        };

        sinon
            .stub(DynamoDbHelper.prototype, 'getMostRecentUserReadableResource')
            .returns(Promise.resolve({ message: 'Resource found', resource }));

        const vid = 2;
        const batchReadWriteServiceResponse: BundleResponse = {
            success: true,
            message: '',
            batchReadWriteResponses: [
                {
                    id,
                    vid: vid.toString(),
                    resourceType: 'Patient',
                    operation: 'update',
                    resource: {},
                    lastModified: '2020-06-18T20:20:12.763Z',
                },
            ],
        };

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
        sinon.restore();
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

        sinon
            .stub(DynamoDbHelper.prototype, 'getMostRecentUserReadableResource')
            .returns(Promise.resolve({ message: 'Resource found', resource }));

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

describe('initiateExport', () => {
    const initiateExportRequest: InitiateExportRequest = {
        requesterUserId: 'userId-1',
        exportType: 'system',
        transactionTime: '2020-09-01T12:00:00Z',
        outputFormat: 'ndjson',
        since: '2020-08-01T12:00:00Z',
        type: 'Patient',
        groupId: '1',
    };

    test('Successful initiate export request', async () => {
        // BUILD
        // Return an export request that is in-progress
        AWSMock.mock('DynamoDB', 'query', (params: QueryInput, callback: Function) => {
            if (isEqual(params, DynamoDbParamBuilder.buildQueryExportRequestJobStatus('in-progress'))) {
                callback(null, {
                    Items: [DynamoDBConverter.marshall({ jobOwnerId: 'userId-2', jobStatus: 'in-progress' })],
                });
            }
            callback(null, {});
        });

        AWSMock.mock('DynamoDB', 'putItem', (params: QueryInput, callback: Function) => {
            // Successfully update export-request table with request
            callback(null, {});
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE
        const jobId = await dynamoDbDataService.initiateExport(initiateExportRequest);

        // CHECK
        expect(jobId).toBeDefined();
    });

    each(['in-progress', 'canceling']).test(
        'throttle limit exceeds MAXIMUM_CONCURRENT_REQUEST_PER_USER because user already has an %s request',
        async (jobStatus: ExportJobStatus) => {
            // BUILD
            // Return an export request that is in-progress
            AWSMock.mock('DynamoDB', 'query', (params: QueryInput, callback: Function) => {
                if (
                    isEqual(
                        params,
                        DynamoDbParamBuilder.buildQueryExportRequestJobStatus(jobStatus, 'jobOwnerId, jobStatus'),
                    )
                ) {
                    callback(null, {
                        Items: [DynamoDBConverter.marshall({ jobOwnerId: 'userId-1', jobStatus })],
                    });
                }
                callback(null, {});
            });

            const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

            // OPERATE
            try {
                await dynamoDbDataService.initiateExport(initiateExportRequest);
            } catch (e) {
                // CHECK
                expect(e).toMatchObject(new TooManyConcurrentExportRequestsError());
            }
        },
    );

    test('throttle limit exceeded MAXIMUM_SYSTEM_LEVEL_CONCURRENT_REQUESTS because system already has a job in the "in-progress" status and the "canceling" status', async () => {
        // BUILD
        // Return two export requests that are in-progress
        AWSMock.mock('DynamoDB', 'query', (params: QueryInput, callback: Function) => {
            if (
                isEqual(
                    params,
                    DynamoDbParamBuilder.buildQueryExportRequestJobStatus('in-progress', 'jobOwnerId, jobStatus'),
                )
            ) {
                callback(null, {
                    Items: [DynamoDBConverter.marshall({ jobOwnerId: 'userId-2', jobStatus: 'in-progress' })],
                });
            } else if (
                isEqual(
                    params,
                    DynamoDbParamBuilder.buildQueryExportRequestJobStatus('canceling', 'jobOwnerId, jobStatus'),
                )
            ) {
                callback(null, {
                    Items: [DynamoDBConverter.marshall({ jobOwnerId: 'userId-3', jobStatus: 'canceling' })],
                });
            }
            callback(null, {});
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE
        try {
            await dynamoDbDataService.initiateExport(initiateExportRequest);
        } catch (e) {
            // CHECK
            expect(e).toMatchObject(new TooManyConcurrentExportRequestsError());
        }
    });
});

describe('cancelExport', () => {
    test('Successfully cancel job', async () => {
        // BUILD
        AWSMock.mock('DynamoDB', 'getItem', (params: QueryInput, callback: Function) => {
            callback(null, {
                Item: DynamoDBConverter.marshall({ requesterUserId: 'userId-1', jobStatus: 'in-progress' }),
            });
        });

        const updateJobSpy = sinon.spy();
        AWSMock.mock('DynamoDB', 'updateItem', (params: QueryInput, callback: Function) => {
            updateJobSpy(params);
            callback(null, {});
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        const jobId = '2a937fe2-8bb1-442b-b9be-434c94f30e15';
        // OPERATE
        await dynamoDbDataService.cancelExport(jobId);

        // CHECK
        expect(updateJobSpy.getCall(0).args[0]).toMatchObject(
            DynamoDbParamBuilder.buildUpdateExportRequestJobStatus(jobId, 'canceling'),
        );
    });

    each(['failed', 'completed']).test(
        'Job cannot be canceled because job is in an invalid state',
        async (jobStatus: ExportJobStatus) => {
            // BUILD
            AWSMock.mock('DynamoDB', 'getItem', (params: QueryInput, callback: Function) => {
                callback(null, {
                    Item: DynamoDBConverter.marshall({ requesterUserId: 'userId-1', jobStatus }),
                });
            });

            const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

            const jobId = '2a937fe2-8bb1-442b-b9be-434c94f30e15';
            // OPERATE
            try {
                await dynamoDbDataService.cancelExport(jobId);
            } catch (e) {
                // CHECK
                expect(e).toMatchObject(
                    new Error(`Job cannot be canceled because job is already in ${jobStatus} state`),
                );
            }
        },
    );
});

describe('getExportStatus', () => {
    test('Successfully get export job status', async () => {
        // BUILD
        AWSMock.mock('DynamoDB', 'getItem', (params: QueryInput, callback: Function) => {
            callback(null, {
                Item: DynamoDBConverter.marshall({
                    jobFailedMessage: '',
                    outputFormat: 'ndjson',
                    exportType: 'system',
                    transactionTime: '2020-09-13T17:19:21.475Z',
                    since: '2020-09-02T05:00:00.000Z',
                    requesterUserId: 'userId-1',
                    groupId: '',
                    jobId: '2a937fe2-8bb1-442b-b9be-434c94f30e15',
                    jobStatus: 'in-progress',
                    stepFunctionExecutionArn: '',
                    type: 'Patient',
                }),
            });
        });

        const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

        // OPERATE
        const exportStatus = await dynamoDbDataService.getExportStatus('2a937fe2-8bb1-442b-b9be-434c94f30e15');

        // CHECK
        expect(exportStatus).toMatchObject({
            jobStatus: 'in-progress',
            exportedFileUrls: [],
            transactionTime: expect.stringMatching(utcTimeRegExp),
            exportType: 'system',
            outputFormat: 'ndjson',
            since: expect.stringMatching(utcTimeRegExp),
            type: 'Patient',
            groupId: '',
            errorArray: [],
            errorMessage: '',
        });
    });
});

each(['cancelExport', 'getExportStatus']).test('%s:Unable to find job', async (testMethod: string) => {
    // BUILD
    AWSMock.mock('DynamoDB', 'getItem', (params: QueryInput, callback: Function) => {
        callback(null, {});
    });

    const dynamoDbDataService = new DynamoDbDataService(new AWS.DynamoDB());

    const jobId = '2a937fe2-8bb1-442b-b9be-434c94f30e15';
    try {
        // OPERATE
        if (testMethod === 'cancelExport') {
            await dynamoDbDataService.cancelExport(jobId);
        } else {
            await dynamoDbDataService.getExportStatus(jobId);
        }
    } catch (e) {
        expect(e).toMatchObject(new ResourceNotFoundError('$export', jobId));
    }
});
