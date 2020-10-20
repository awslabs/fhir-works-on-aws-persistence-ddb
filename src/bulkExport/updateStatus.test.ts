/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import * as AWSMock from 'aws-sdk-mock';
import AWS from 'aws-sdk';
import each from 'jest-each';
import { updateStatusStatusHandler } from './updateStatus';

AWSMock.setSDKInstance(AWS);

describe('updateStatus', () => {
    beforeEach(() => {
        process.env.GLUE_JOB_NAME = 'jobName';
        AWSMock.restore();
    });

    test('valid status', async () => {
        AWSMock.mock('DynamoDB', 'updateItem', (params: any, callback: Function) => {
            callback(null);
        });
        await expect(
            updateStatusStatusHandler({ jobId: '1', status: 'completed' }, null as any, null as any),
        ).resolves.toBeUndefined();
    });

    describe('Invalid status', () => {
        each([null, undefined, 'not-a-valid-status']).test('%j', async (status: any) => {
            await expect(
                updateStatusStatusHandler({ jobId: '1', status }, null as any, null as any),
            ).rejects.toThrowError(`Invalid status "${status}"`);
        });
    });
});
