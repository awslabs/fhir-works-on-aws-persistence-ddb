/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { Handler } from 'aws-lambda';
import AWS from 'aws-sdk';
import { BulkExportStateMachineGlobalParameters } from './types';

export const stopExportJobHandler: Handler<
    BulkExportStateMachineGlobalParameters,
    BulkExportStateMachineGlobalParameters
> = async event => {
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
        throw new Error(`Failed to cancel job ${stopJobRunResponse.Errors!}`);
    }

    return {
        ...event,
        executionParameters: {
            ...event.executionParameters,
        },
    };
};
