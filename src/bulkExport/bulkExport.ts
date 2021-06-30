/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
import AWS from '../AWS';
import { BulkExportJob } from './types';

const EXPIRATION_TIME_SECONDS = 1800;
const EXPORT_RESULTS_BUCKET = process.env.EXPORT_RESULTS_BUCKET || ' ';
const EXPORT_RESULTS_SIGNER_ROLE_ARN = process.env.EXPORT_RESULTS_SIGNER_ROLE_ARN || '';
const EXPORT_STATE_MACHINE_ARN = process.env.EXPORT_STATE_MACHINE_ARN || '';

const getFiles = async (jobId: string): Promise<string[]> => {
    const s3 = new AWS.S3();

    const listObjectsResult = await s3.listObjectsV2({ Bucket: EXPORT_RESULTS_BUCKET, Prefix: jobId }).promise();
    return listObjectsResult.Contents!.map(x => x.Key!);
};

const signExportResults = async (keys: string[]): Promise<{ key: string; url: string }[]> => {
    if (keys.length === 0) {
        return [];
    }
    const sts = new AWS.STS();
    const assumeRoleResponse = await sts
        .assumeRole({
            RoleArn: EXPORT_RESULTS_SIGNER_ROLE_ARN,
            RoleSessionName: 'signBulkExportResults',
            DurationSeconds: EXPIRATION_TIME_SECONDS,
        })
        .promise();

    const s3 = new AWS.S3({
        credentials: {
            accessKeyId: assumeRoleResponse.Credentials!.AccessKeyId,
            secretAccessKey: assumeRoleResponse.Credentials!.SecretAccessKey,
            sessionToken: assumeRoleResponse.Credentials!.SessionToken,
        },
    });

    return Promise.all(
        keys.map(async key => ({
            key,
            url: await s3.getSignedUrlPromise('getObject', {
                Bucket: EXPORT_RESULTS_BUCKET,
                Key: key,
                Expires: EXPIRATION_TIME_SECONDS,
            }),
        })),
    );
};

const getResourceType = (key: string, jobId: string): string => {
    const regex = new RegExp(`^${jobId}/([A-Za-z]+)-\\d+.ndjson$`);
    const match = regex.exec(key);
    if (match === null) {
        throw new Error(`Could not parse the name of bulk exports result file: ${key}`);
    }
    return match[1];
};

export const getBulkExportResults = async (jobId: string): Promise<{ type: string; url: string }[]> => {
    const keys = await getFiles(jobId);
    const signedUrls = await signExportResults(keys);
    return signedUrls.map(({ key, url }) => ({
        type: getResourceType(key, jobId),
        url,
    }));
};

export const startJobExecution = async (bulkExportJob: BulkExportJob): Promise<void> => {
    const { jobId, exportType, groupId, type, transactionTime, outputFormat, since, tenantId } = bulkExportJob;
    const params: any = {
        jobId,
        exportType,
        transactionTime,
        since,
        outputFormat,
    };
    if (groupId) {
        params.groupId = groupId;
    }
    if (type) {
        params.type = type;
    }
    if (tenantId) {
        params.tenantId = tenantId;
    }

    await new AWS.StepFunctions()
        .startExecution({
            stateMachineArn: EXPORT_STATE_MACHINE_ARN,
            name: jobId,
            input: JSON.stringify(params),
        })
        .promise();
};
