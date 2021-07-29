/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import AWS from 'aws-sdk';
import DdbToEsHelper from './ddbToEsHelper';
import ESBulkCommand from './ESBulkCommand';
import getComponentLogger from '../loggerBuilder';

const BINARY_RESOURCE = 'binary';
const REMOVE = 'REMOVE';
const logger = getComponentLogger();
const ddbToEsHelper = new DdbToEsHelper();
let knownResourceTypes: Set<string> = new Set();

function isBinaryResource(image: any): boolean {
    const resourceType = image.resourceType.toLowerCase();
    // Don't index binary files
    return resourceType === BINARY_RESOURCE;
}

// This is a separate lambda function from the main FHIR API server lambda.
// This lambda picks up changes from DDB by way of DDB stream, and sends those changes to ElasticSearch Service for indexing.
// This allows the FHIR API Server to query ElasticSearch service for search requests
export async function handleDdbToEsEvent(event: any) {
    try {
        const idToCommand: Record<string, ESBulkCommand> = {};
        const resourceTypesToCreate: Set<string> = new Set();
        for (let i = 0; i < event.Records.length; i += 1) {
            const record = event.Records[i];
            logger.debug('EventName: ', record.eventName);

            const ddbJsonImage = record.eventName === REMOVE ? record.dynamodb.OldImage : record.dynamodb.NewImage;
            const image = AWS.DynamoDB.Converter.unmarshall(ddbJsonImage);
            // Don't index binary files
            if (isBinaryResource(image)) {
                // eslint-disable-next-line no-continue
                continue;
            }
            const resourceType = image.resourceType.toLowerCase();
            if (!knownResourceTypes.has(resourceType)) {
                resourceTypesToCreate.add(resourceType);
            }

            const cmd =
                record.eventName === REMOVE
                    ? ddbToEsHelper.createBulkESDelete(image)
                    : ddbToEsHelper.createBulkESUpsert(image);

            if (cmd) {
                // Note this will overwrite the item if present
                // DDB streams guarantee in-order delivery of all mutations to each item
                // Meaning the last record in the event stream is the "newest"
                idToCommand[cmd.id] = cmd;
            }
        }
        await ddbToEsHelper.createIndexAndAliasIfNotExist(resourceTypesToCreate);
        // update cache of all known aliases
        knownResourceTypes = new Set([...knownResourceTypes, ...resourceTypesToCreate]);
        await ddbToEsHelper.executeEsCmds(Object.values(idToCommand));
    } catch (e) {
        logger.error(
            'Synchronization failed! The resources that could be effected are: ',
            event.Records.map(
                (record: {
                    eventName: string;
                    dynamodb: { OldImage: AWS.DynamoDB.AttributeMap; NewImage: AWS.DynamoDB.AttributeMap };
                }) => {
                    const image = record.eventName === REMOVE ? record.dynamodb.OldImage : record.dynamodb.NewImage;
                    return `{id: ${image.id.S}, vid: ${image.vid.N}}`;
                },
            ),
        );

        logger.error('Failed to update ES records', e);
        throw e;
    }
}
