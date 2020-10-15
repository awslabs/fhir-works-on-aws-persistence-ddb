import * as AWSMock from 'aws-sdk-mock';
import AWS from 'aws-sdk';
import { QueryInput } from 'aws-sdk/clients/dynamodb';
import { getJobStatusHandler } from './getJobStatus';
import { BulkExportStateMachineGlobalParameters } from './types';
import { DynamoDBConverter } from '../dataServices/dynamoDb';

AWSMock.setSDKInstance(AWS);

describe('getJobStatus', () => {
    beforeEach(() => {
        process.env.GLUE_JOB_NAME = 'jobName';
        AWSMock.restore();
    });

    test('completed job', async () => {
        const event: BulkExportStateMachineGlobalParameters = {
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                glueJobRunId: 'jr_1',
            },
        };
        process.env.GLUE_JOB_NAME = 'jobName';
        AWSMock.mock('Glue', 'getJobRun', (params: any, callback: Function) => {
            callback(null, {
                JobRun: {
                    JobRunState: 'SUCCEEDED',
                },
            });
        });
        AWSMock.mock('DynamoDB', 'getItem', (params: QueryInput, callback: Function) => {
            callback(null, {
                Item: DynamoDBConverter.marshall({
                    jobId: '2a937fe2-8bb1-442b-b9be-434c94f30e15',
                    jobStatus: 'in-progress',
                }),
            });
        });
        await expect(getJobStatusHandler(event, null as any, null as any)).resolves.toEqual({
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                glueJobRunId: 'jr_1',
                glueJobRunStatus: 'SUCCEEDED',
                isCanceled: false,
            },
        });
    });

    test('failed job', async () => {
        const event: BulkExportStateMachineGlobalParameters = {
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                glueJobRunId: 'jr_1',
            },
        };
        AWSMock.mock('Glue', 'getJobRun', (params: any, callback: Function) => {
            callback(null, {
                JobRun: {
                    JobRunState: 'FAILED',
                },
            });
        });
        AWSMock.mock('DynamoDB', 'getItem', (params: QueryInput, callback: Function) => {
            callback(null, {
                Item: DynamoDBConverter.marshall({
                    jobId: '2a937fe2-8bb1-442b-b9be-434c94f30e15',
                    jobStatus: 'in-progress',
                }),
            });
        });
        await expect(getJobStatusHandler(event, null as any, null as any)).resolves.toEqual({
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                glueJobRunId: 'jr_1',
                glueJobRunStatus: 'FAILED',
                isCanceled: false,
            },
        });
    });

    test('canceled job', async () => {
        const event: BulkExportStateMachineGlobalParameters = {
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                glueJobRunId: 'jr_1',
            },
        };
        AWSMock.mock('Glue', 'getJobRun', (params: any, callback: Function) => {
            callback(null, {
                JobRun: {
                    JobRunState: 'RUNNING',
                },
            });
        });
        AWSMock.mock('DynamoDB', 'getItem', (params: QueryInput, callback: Function) => {
            callback(null, {
                Item: DynamoDBConverter.marshall({
                    jobId: '2a937fe2-8bb1-442b-b9be-434c94f30e15',
                    jobStatus: 'canceling',
                }),
            });
        });
        await expect(getJobStatusHandler(event, null as any, null as any)).resolves.toEqual({
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                glueJobRunId: 'jr_1',
                glueJobRunStatus: 'RUNNING',
                isCanceled: true,
            },
        });
    });

    test('missing env variables ', async () => {
        delete process.env.GLUE_JOB_NAME;
        const event: BulkExportStateMachineGlobalParameters = {
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                glueJobRunId: 'jr_1',
            },
        };
        await expect(getJobStatusHandler(event, null as any, null as any)).rejects.toThrow(
            'GLUE_JOB_NAME environment variable is not defined',
        );
    });

    test('missing glueJobRunId ', async () => {
        const event: BulkExportStateMachineGlobalParameters = {
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
        };
        await expect(getJobStatusHandler(event, null as any, null as any)).rejects.toThrow(
            'executionParameters.glueJobRunId is missing in input event',
        );
    });
});
