/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-underscore-dangle */

import { Client } from '@elastic/elasticsearch';
// @ts-ignore
import { AmazonConnection, AmazonTransport } from 'aws-elasticsearch-connector';
import AWS from '../AWS';
import ESBulkCommand, { OperationType } from './ESBulkCommand';
import { DOCUMENT_STATUS_FIELD } from '../dataServices/dynamoDbUtil';
import DOCUMENT_STATUS from '../dataServices/documentStatus';
import getComponentLogger from '../loggerBuilder';

const logger = getComponentLogger();

const BINARY_RESOURCE = 'binary';

const { IS_OFFLINE, ELASTICSEARCH_DOMAIN_ENDPOINT } = process.env;

export default class DdbToEsHelper {
    public ElasticSearch: Client;

    constructor() {
        let ES_DOMAIN_ENDPOINT = ELASTICSEARCH_DOMAIN_ENDPOINT || 'https://fake-es-endpoint.com';
        if (IS_OFFLINE === 'true') {
            const { ACCESS_KEY, SECRET_KEY, AWS_REGION, OFFLINE_ELASTICSEARCH_DOMAIN_ENDPOINT } = process.env;

            AWS.config.update({
                region: AWS_REGION || 'us-west-2',
                accessKeyId: ACCESS_KEY,
                secretAccessKey: SECRET_KEY,
            });
            ES_DOMAIN_ENDPOINT = OFFLINE_ELASTICSEARCH_DOMAIN_ENDPOINT || 'https://fake-es-endpoint.com';
        }

        this.ElasticSearch = new Client({
            node: ES_DOMAIN_ENDPOINT,
            Connection: AmazonConnection,
            Transport: AmazonTransport,
        });
    }

    async createIndexAndAliasIfNotExist(aliases: Set<string>) {
        if (aliases.size === 0) {
            return;
        }

        const listOfAliases = Array.from(aliases);
        const { body: allFound } = await this.ElasticSearch.indices.existsAlias({
            name: listOfAliases,
            expand_wildcards: 'all',
        });
        if (allFound) {
            // All needed aliases exist
            return;
        }

        logger.debug('There are missing aliases');

        const indicesToCreate: Set<string> = new Set();
        listOfAliases.forEach((alias: string) => {
            indicesToCreate.add(alias.substring(0, alias.length - 6)); // remove '-alias'
        });
        const aliasesToCreate: Set<string> = new Set(aliases);

        const { body: indices } = await this.ElasticSearch.indices.getAlias();
        // for each index and alias found remove from set
        Object.entries(indices).forEach(([k, v]) => {
            indicesToCreate.delete(k);
            Object.keys((v as any).aliases).forEach((aliasNames: string) => {
                aliasesToCreate.delete(aliasNames);
            });
        });
        try {
            const promises: any[] = [];
            Array.from(indicesToCreate).forEach((index: string) => {
                const alias = `${index}-alias`;
                // Only create index when we also need to create an alias
                if (aliasesToCreate.has(alias)) {
                    aliasesToCreate.delete(alias);
                    logger.info(`create index ${index} & alias ${alias}`);
                    const params = {
                        index,
                        body: {
                            mappings: {
                                properties: {
                                    id: {
                                        type: 'keyword',
                                        index: true,
                                    },
                                    resourceType: {
                                        type: 'keyword',
                                        index: true,
                                    },
                                    _references: {
                                        type: 'keyword',
                                        index: true,
                                    },
                                    documentStatus: {
                                        type: 'keyword',
                                        index: true,
                                    },
                                },
                            },
                            aliases: { [alias]: {} },
                        },
                    };
                    promises.push(this.ElasticSearch.indices.create(params));
                }
            });

            Array.from(aliasesToCreate).forEach((alias: string) => {
                // Create Alias
                logger.info(`create alias ${alias}`);
                promises.push(
                    this.ElasticSearch.indices.putAlias({
                        index: alias.substring(0, alias.length - 6),
                        name: alias,
                    }),
                );
            });

            await Promise.all(promises);
        } catch (error) {
            logger.error(`Failed to create indices and aliases. Aliases: ${aliases} were examined`);
            throw error;
        }
    }

    // eslint-disable-next-line class-methods-use-this
    private generateFullId(id: string, vid: number) {
        return `${id}_${vid}`;
    }

    // Getting promise params for actual deletion of the record from ES
    createBulkESDelete(ddbResourceImage: any): ESBulkCommand {
        const lowercaseResourceType = ddbResourceImage.resourceType.toLowerCase();

        const { id, vid } = ddbResourceImage;
        const compositeId = this.generateFullId(id, vid);
        return {
            bulkCommand: [
                {
                    delete: { _index: `${lowercaseResourceType}-alias`, _id: compositeId },
                },
            ],
            id: compositeId,
            type: 'delete',
        };
    }

    // Getting promise params for inserting a new record or editing a record
    createBulkESUpsert(newImage: any): ESBulkCommand | null {
        const lowercaseResourceType = newImage.resourceType.toLowerCase();

        // We only perform operations on records with documentStatus === AVAILABLE || DELETED
        if (
            newImage[DOCUMENT_STATUS_FIELD] !== DOCUMENT_STATUS.AVAILABLE &&
            newImage[DOCUMENT_STATUS_FIELD] !== DOCUMENT_STATUS.DELETED
        ) {
            return null;
        }

        let type: OperationType = 'upsert-DELETED';
        if (newImage[DOCUMENT_STATUS_FIELD] === DOCUMENT_STATUS.AVAILABLE) {
            type = 'upsert-AVAILABLE';
        }
        const { id, vid } = newImage;
        const compositeId = this.generateFullId(id, vid);
        return {
            id: compositeId,
            bulkCommand: [
                { update: { _index: `${lowercaseResourceType}-alias`, _id: compositeId } },
                { doc: newImage, doc_as_upsert: true },
            ],
            type,
        };
    }

    // eslint-disable-next-line class-methods-use-this
    isBinaryResource(image: any): boolean {
        const resourceType = image.resourceType.toLowerCase();
        // Don't index binary files
        return resourceType === BINARY_RESOURCE;
    }

    async executeEsCmds(cmds: ESBulkCommand[]) {
        const bulkCmds: any[] = cmds.flatMap((cmd: ESBulkCommand) => {
            return cmd.bulkCommand;
        });

        if (bulkCmds.length === 0) {
            return;
        }
        const listOfIds = cmds.map(cmd => {
            return cmd.id;
        });
        logger.info(`Starting bulk sync operation on ids: `, listOfIds);
        try {
            const { body: bulkResponse } = await this.ElasticSearch.bulk({
                refresh: 'wait_for',
                body: bulkCmds,
            });

            if (bulkResponse.errors) {
                const erroredDocuments: any[] = [];
                // The presence of the `error` key indicates that the operation
                // that we did for the document has failed.
                bulkResponse.items.forEach((action: any) => {
                    const operation = Object.keys(action)[0];
                    if (action[operation].error) {
                        erroredDocuments.push({
                            status: action[operation].status,
                            error: action[operation].error,
                            index: action[operation]._index,
                            id: action[operation]._id,
                            esOperation: operation,
                        });
                    }
                });
                throw new Error(JSON.stringify(erroredDocuments));
            }
        } catch (error) {
            logger.error(`Bulk sync operation failed on ids: `, listOfIds);
            throw error;
        }
    }
}
