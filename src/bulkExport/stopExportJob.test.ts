/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
import * as AWSMock from 'aws-sdk-mock';
import AWS from 'aws-sdk';
import { BulkExportStateMachineGlobalParameters } from './types';
import { stopExportJobHandler } from './stopExportJob';

AWSMock.setSDKInstance(AWS);

describe('getJobStatus', () => {
    beforeEach(() => {
        process.env.GLUE_JOB_NAME = 'jobName';
        AWSMock.restore();
    });

    test('stop job successfully', async () => {
        const glueJobRunId = 'jr_1';
        const event: BulkExportStateMachineGlobalParameters = {
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                glueJobRunId,
            },
        };
        const glueJobName = 'jobName';
        process.env.GLUE_JOB_NAME = glueJobName;

        AWSMock.mock('Glue', 'batchStopJobRun', (params: any, callback: Function) => {
            callback(null, {
                SuccessfulSubmissions: [
                    {
                        JobName: glueJobName,
                        JobRunId: glueJobRunId,
                    },
                ],
                Errors: [],
            });
        });
        await expect(stopExportJobHandler(event, null as any, null as any)).resolves.toEqual({ jobId: '1' });
    });
    test('stop job failed', async () => {
        const glueJobRunId = 'jr_1';
        const event: BulkExportStateMachineGlobalParameters = {
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                glueJobRunId,
            },
        };
        const glueJobName = 'jobName';
        process.env.GLUE_JOB_NAME = glueJobName;

        AWSMock.mock('Glue', 'batchStopJobRun', (params: any, callback: Function) => {
            callback(null, {
                SuccessfulSubmissions: [],
                Errors: [
                    {
                        JobName: glueJobName,
                        JobRunId: glueJobRunId,
                        ErrorDetail: {
                            ErrorCode: 'JobRunCannotBeStoppedException',
                            ErrorMessage: 'Job Run cannot be stopped in current state.',
                        },
                    },
                ],
            });
        });
        await expect(stopExportJobHandler(event, null as any, null as any)).rejects.toThrow('Failed to stop job');
    });
});
