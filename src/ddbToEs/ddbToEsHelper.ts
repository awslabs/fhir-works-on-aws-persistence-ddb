/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-underscore-dangle */

import { Client } from '@elastic/elasticsearch';
// @ts-ignore
import { AmazonConnection, AmazonTransport } from 'aws-elasticsearch-connector';
import allSettled from 'promise.allsettled';
import AWS from '../AWS';
import ESBulkCommand, { OperationType } from './promiseParamAndId';
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

    async createIndexAndAliasIfNotExist(indexName: string) {
        logger.debug('entering create index function');
        try {
            const indexExistResponse = await this.ElasticSearch.indices.exists({ index: indexName });
            logger.debug(indexExistResponse);
            if (!indexExistResponse.body) {
                // Create Index
                const params = {
                    index: indexName,
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
                        aliases: { [`${indexName}-alias`]: {} },
                    },
                };
                await this.ElasticSearch.indices.create(params);
            } else {
                const indexAliasExistResponse = await this.ElasticSearch.indices.existsAlias({
                    index: indexName,
                    name: `${indexName}-alias`,
                });
                logger.debug(indexAliasExistResponse);
                if (!indexAliasExistResponse.body) {
                    // Create Alias
                    logger.debug(`create alias ${indexName}-alias`);
                    await this.ElasticSearch.indices.putAlias({
                        index: indexName,
                        name: `${indexName}-alias`,
                    });
                }
            }
        } catch (error) {
            logger.error(`Failed to check if index(and alias): ${indexName} exist or create index(and alias)`);
            throw error;
        }
    }

    // eslint-disable-next-line class-methods-use-this
    private generateFullId(id: string, vid: number) {
        return `${id}_${vid}`;
    }

    // Getting promise params for actual deletion of the record from ES
    // eslint-disable-next-line class-methods-use-this
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
    // eslint-disable-next-line class-methods-use-this
    getUpsertRecordPromiseParam(newImage: any): ESBulkCommand | null {
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

    async logAndExecutePromises(cmds: ESBulkCommand[]) {
        // We're using allSettled-shim because as of 7/21/2020 'serverless-plugin-typescript' does not support
        // Promise.allSettled.
        allSettled.shim();

        if (cmds.length === 0) {
            return;
        }

        const bulkCmds: any[] = cmds.flat();

        logger.error(
            `Starting bulk sync operation on resource Ids: `,
            cmds.map(cmd => {
                return cmd.id;
            }),
        );

        const { body: bulkResponse } = await this.ElasticSearch.bulk({
            refresh: 'wait_for',
            require_alias: true,
            body: bulkCmds,
        });

        if (bulkResponse.errors) {
            const erroredDocuments: any[] = [];
            // The items array has the same order of the dataset we just indexed.
            // The presence of the `error` key indicates that the operation
            // that we did for the document has failed.
            bulkResponse.items.forEach((action: any) => {
                const operation = Object.keys(action)[0];
                if (action[operation].error) {
                    erroredDocuments.push({
                        // If the status is 429 it means that you can retry the document,
                        // otherwise it's very likely a mapping error, and you should
                        // fix the document before to try it again.
                        status: action[operation].status,
                        error: action[operation].error,
                        index: action[operation]._index,
                        id: action[operation]._id,
                        esOperation: operation,
                    });
                }
            });

            // TODO handle retries

            logger.error(erroredDocuments);
            throw new Error(erroredDocuments.toString()); // TODO
        }
    }
}
