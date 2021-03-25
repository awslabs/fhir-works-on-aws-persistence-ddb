/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { Handler } from 'aws-lambda';
import AWS from '../AWS';
import { BulkExportStateMachineGlobalParameters } from './types';

export const stopExportJobHandler: Handler<BulkExportStateMachineGlobalParameters, { jobId: string }> = async event => {
    const { GLUE_JOB_NAME } = process.env;
    if (GLUE_JOB_NAME === undefined) {
        throw new Error('GLUE_JOB_NAME environment variable is not defined');
    }
    const glueJobRunId = event.executionParameters?.glueJobRunId;
    if (glueJobRunId === undefined) {
        throw new Error('executionParameters.glueJobRunId is missing in input event');
    }

    const glue = new AWS.Glue();
    const stopJobRunResponse = await glue
        .batchStopJobRun({
            JobName: GLUE_JOB_NAME,
            JobRunIds: [glueJobRunId],
        })
        .promise();
    if (stopJobRunResponse.Errors!.length > 0) {
        console.log('Failed to stop job', JSON.stringify(stopJobRunResponse));
        throw new Error(`Failed to stop job ${glueJobRunId}`);
    }
    return {
        jobId: event.jobId,
    };
};
