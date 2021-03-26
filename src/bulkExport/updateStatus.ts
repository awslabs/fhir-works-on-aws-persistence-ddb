/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { Handler } from 'aws-lambda';
import { ExportJobStatus } from 'fhir-works-on-aws-interface';
import AWS from '../AWS';
import DynamoDbParamBuilder from '../dataServices/dynamoDbParamBuilder';

const EXPORT_JOB_STATUS = ['completed', 'failed', 'in-progress', 'canceled', 'canceling'];
const isJobStatus = (x: string): x is ExportJobStatus => EXPORT_JOB_STATUS.includes(x);

export const updateStatusStatusHandler: Handler<{ jobId: string; status: string }, void> = async event => {
    const { jobId, status } = event;
    if (!isJobStatus(status)) {
        throw new Error(`Invalid status "${event.status}"`);
    }
    await new AWS.DynamoDB()
        .updateItem(DynamoDbParamBuilder.buildUpdateExportRequestJobStatus(jobId, status))
        .promise();
};
