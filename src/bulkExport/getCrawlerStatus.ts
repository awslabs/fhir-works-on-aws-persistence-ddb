/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { Handler } from 'aws-lambda';
import AWS from 'aws-sdk';
import { GetCrawlerResponse } from 'aws-sdk/clients/glue';
import { BulkExportStateMachineGlobalParameters } from './types';

/**
 * This function combines the Crawler state and last crawl status into a simple status that is meaningful to our state machine.
 *
 * There is no way to get the status of a status of a specific "Crawler run". Crawlers only expose the status of the last crawl
 * @param getCrawlerResponse
 */
const getCrawlerStatus = (getCrawlerResponse: GetCrawlerResponse): 'succeeded' | 'failed' | 'running' => {
    const crawlerState = getCrawlerResponse.Crawler!.State!;
    const lastCrawlStatus = getCrawlerResponse.Crawler!.LastCrawl!.Status!;
    switch (crawlerState) {
        case 'READY':
            switch (lastCrawlStatus) {
                case 'SUCCEEDED':
                    return 'succeeded';
                case 'CANCELLED':
                case 'FAILED':
                    return 'failed';
                default:
                    // This should never happen per the current Glue API specification
                    throw new Error(`Unknown last crawl status: ${lastCrawlStatus}`);
            }
        case 'RUNNING':
        case 'STOPPING':
            return 'running';
        default:
            // This should never happen per the current Glue API specification
            throw new Error(`Unknown crawler state: ${crawlerState}`);
    }
};

export const getCrawlerStatusHandler: Handler<
    BulkExportStateMachineGlobalParameters,
    BulkExportStateMachineGlobalParameters
> = async event => {
    const { CRAWLER_NAME } = process.env;
    if (CRAWLER_NAME === undefined) {
        throw new Error('CRAWLER_NAME environment variable is not defined');
    }
    const glue = new AWS.Glue();
    const getCrawlerResponse = await glue
        .getCrawler({
            Name: CRAWLER_NAME,
        })
        .promise();

    const crawlerStatus = getCrawlerStatus(getCrawlerResponse);

    return {
        ...event,
        executionParameters: {
            ...event.executionParameters,
            crawlerStatus,
        },
    };
};
