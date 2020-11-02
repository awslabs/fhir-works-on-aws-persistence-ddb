/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
import * as AWSMock from 'aws-sdk-mock';
import AWS from 'aws-sdk';
import each from 'jest-each';
import { BulkExportStateMachineGlobalParameters } from './types';
import { getCrawlerStatusHandler } from './getCrawlerStatus';

AWSMock.setSDKInstance(AWS);

describe('getCrawlerStatusHandler', () => {
    beforeEach(() => {
        process.env.CRAWLER_NAME = 'crawlerName';
        AWSMock.restore();
    });

    each([
        ['READY', 'SUCCEEDED', 'succeeded'],
        ['READY', 'CANCELLED', 'failed'],
        ['READY', 'FAILED', 'failed'],
        ['RUNNING', '**any**', 'running'],
        ['STOPPING', '**any**', 'running'],
    ]).test('State=%s, LastCrawl.Status=%s => %s', async (state: string, lastStatus: string, expected: string) => {
        AWSMock.mock('Glue', 'getCrawler', (params: any, callback: Function) => {
            callback(null, {
                Crawler: {
                    LastCrawl: {
                        Status: lastStatus,
                    },
                    State: state,
                },
            });
        });

        const event: BulkExportStateMachineGlobalParameters = {
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
        };
        await expect(getCrawlerStatusHandler(event, null as any, null as any)).resolves.toEqual({
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
            executionParameters: {
                crawlerStatus: expected,
            },
        });
    });

    test('missing env variables', async () => {
        delete process.env.CRAWLER_NAME;

        const event: BulkExportStateMachineGlobalParameters = {
            jobId: '1',
            exportType: 'system',
            transactionTime: '',
        };
        await expect(getCrawlerStatusHandler(event, null as any, null as any)).rejects.toThrowError(
            'CRAWLER_NAME environment variable is not defined',
        );
    });
});
