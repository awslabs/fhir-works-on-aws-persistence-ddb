/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
import * as AWSMock from 'aws-sdk-mock';
import AWS from 'aws-sdk';
import { getBulkExportResults } from './bulkExportResults';

AWSMock.setSDKInstance(AWS);

describe('getBulkExportResults', () => {
    beforeEach(() => {
        process.env.GLUE_JOB_NAME = 'jobName';
        AWSMock.restore();

        AWSMock.mock('STS', 'assumeRole', (params: any, callback: Function) => {
            callback(null, {
                Credentials: { AccessKeyId: 'xxx', SecretAccessKey: 'xxx', SessionToken: 'xxx' },
            });
        });

        AWSMock.mock('S3', 'getSignedUrl', (apiCallToSign: any, params: any, callback: Function) => {
            callback(null, 'https://somePresignedUrl');
        });
    });

    test('happy case', async () => {
        AWSMock.mock('S3', 'listObjectsV2', (params: any, callback: Function) => {
            callback(null, {
                Contents: [{ Key: 'job-1/Patient-1.ndjson' }, { Key: 'job-1/Observation-1.ndjson' }],
            });
        });

        await expect(getBulkExportResults('job-1')).resolves.toEqual([
            { type: 'Patient', url: 'https://somePresignedUrl' },
            { type: 'Observation', url: 'https://somePresignedUrl' },
        ]);
    });

    test('no results', async () => {
        AWSMock.mock('S3', 'listObjectsV2', (params: any, callback: Function) => {
            callback(null, {
                Contents: [],
            });
        });

        await expect(getBulkExportResults('job-1')).resolves.toEqual([]);
    });

    test('filenames with unknown format', async () => {
        AWSMock.mock('S3', 'listObjectsV2', (params: any, callback: Function) => {
            callback(null, {
                Contents: [{ Key: 'job-1/BadFilenameFormat$$.exe' }, { Key: 'job-1/Observation-1.ndjson' }],
            });
        });

        await expect(getBulkExportResults('job-1')).rejects.toThrowError(
            'Could not parse the name of bulk exports result file: job-1/BadFilenameFormat$$.exe',
        );
    });
});
