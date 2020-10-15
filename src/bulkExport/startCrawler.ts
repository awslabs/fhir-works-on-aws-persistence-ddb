/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { Handler } from 'aws-lambda';
import AWS from 'aws-sdk';
import { BulkExportStateMachineGlobalParameters } from './types';

export const startCrawlerHandler: Handler<
    BulkExportStateMachineGlobalParameters,
    BulkExportStateMachineGlobalParameters
> = async event => {
    const { CRAWLER_NAME } = process.env;
    if (CRAWLER_NAME === undefined) {
        throw new Error('CRAWLER_NAME environment variable is not defined');
    }
    const glue = new AWS.Glue();
    try {
        console.log(`Starting crawler ${CRAWLER_NAME}`);
        await glue
            .startCrawler({
                Name: CRAWLER_NAME,
            })
            .promise();
        console.log('Crawler started successfully');
        return event;
    } catch (e) {
        if (e.code === 'CrawlerRunningException') {
            console.log('Crawler is already running');
            return event;
        }
        throw e;
    }
};
