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

const REMOVE = 'REMOVE';
const DELETED = 'DELETED';

const logger = getComponentLogger();

const { IS_OFFLINE, ELASTICSEARCH_DOMAIN_ENDPOINT } = process.env;

const ALIAS_SUFFIX = '-alias';

const getAliasName = (resourceType: string, tenantId?: string) => {
    const lowercaseResourceType = resourceType.toLowerCase();
    if (tenantId) {
        return `${lowercaseResourceType}-alias-tenant-${tenantId}`;
    }
    return `${lowercaseResourceType}-alias`;
};

const formatDocument = (ddbImage: any): any => {
    // eslint-disable-next-line no-underscore-dangle
    if (ddbImage._tenantId) {
        return {
            ...ddbImage,
            // eslint-disable-next-line no-underscore-dangle
            id: ddbImage._id, // use the original resourceId as id instead of the DDB composite id
            _id: undefined, // _id is a reserved field in ES, so it must be removed.
        };
    }
    return ddbImage;
};

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

    async createIndexAndAliasIfNotExist(resourceTypes: Set<string>) {
        if (resourceTypes.size === 0) {
            return;
        }

        const listOfAliases = Array.from(resourceTypes).map((resourceType: string) => {
            return this.generateAlias(resourceType);
        });
        const { body: allFound } = await this.ElasticSearch.indices.existsAlias({
            name: listOfAliases,
            expand_wildcards: 'all',
        });
        if (allFound) {
            // All needed aliases exist
            return;
        }

        logger.debug('There are missing aliases');

        const indicesToCreate: Set<string> = new Set(resourceTypes);
        const aliasesToCreate: Set<string> = new Set(listOfAliases);

        const { body: indices } = await this.ElasticSearch.indices.getAlias();
        // for each index and alias found remove from set
        Object.entries(indices).forEach(([indexName, indexBody]) => {
            indicesToCreate.delete(indexName);
            Object.keys((indexBody as any).aliases).forEach((alias: string) => {
                aliasesToCreate.delete(alias);
            });
        });
        try {
            const promises: any[] = [];
            Array.from(indicesToCreate).forEach((index: string) => {
                const alias = this.generateAlias(index);
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
                                    _tenantId: {
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
                // Create Alias; this block is creating aliases for existing indices
                logger.info(`create alias ${alias}`);
                promises.push(
                    this.ElasticSearch.indices.putAlias({
                        index: this.getResourceType(alias),
                        name: alias,
                    }),
                );
            });

            await Promise.all(promises);
        } catch (error) {
            logger.error(`Failed to create indices and aliases. Resource types: ${resourceTypes} were examined`);
            throw error;
        }
    }

    // eslint-disable-next-line class-methods-use-this
    private generateFullId(ddbImage: any) {
        const { id, vid, _tenantId, _id } = ddbImage;
        if (_tenantId) {
            return `${_tenantId}_${_id}_${vid}`;
        }
        return `${id}_${vid}`;
    }

    // eslint-disable-next-line class-methods-use-this
    private generateAlias(resourceType: string) {
        return `${resourceType.toLowerCase()}${ALIAS_SUFFIX}`;
    }

    // eslint-disable-next-line class-methods-use-this
    private getResourceType(alias: string) {
        return alias.substring(0, alias.length - ALIAS_SUFFIX.length);
    }

    // Getting promise params for actual deletion of the record from ES
    createBulkESDelete(ddbResourceImage: any): ESBulkCommand {
        const { id, vid } = ddbResourceImage;
        const compositeId = this.generateFullId(id, vid);
        return {
            bulkCommand: [
                {
                    delete: { _index: this.generateAlias(ddbResourceImage.resourceType), _id: compositeId },
                },
            ],
            id: compositeId,
            type: 'delete',
        };
    }

    // Getting promise params for inserting a new record or editing a record
    createBulkESUpsert(newImage: any): ESBulkCommand | null {
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
        const { _tenantId } = newImage;
        const compositeId = this.generateFullId(newImage);
        return {
            id: compositeId,
            bulkCommand: [
                { update: { _index: this.generateAlias(newImage.resourceType), _id: compositeId } },
                { doc: formatDocument(newImage), doc_as_upsert: true },
            ],
            type,
        };
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

    // eslint-disable-next-line class-methods-use-this
    isRemoveResource(record: any): boolean {
        if (record.eventName === REMOVE) {
            return true;
        }
        return record.dynamodb.NewImage.documentStatus.S === DELETED && process.env.ENABLE_ES_HARD_DELETE === 'true';
    }
}
