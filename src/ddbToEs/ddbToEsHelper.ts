/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@elastic/elasticsearch';
// @ts-ignore
import { AmazonConnection, AmazonTransport } from 'aws-elasticsearch-connector';
import allSettled from 'promise.allsettled';
import AWS from '../AWS';
import PromiseParamAndId, { PromiseType } from './promiseParamAndId';
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
    getDeleteRecordPromiseParam(image: any): PromiseParamAndId {
        const lowercaseResourceType = image.resourceType.toLowerCase();

        const { id, vid } = image;
        const compositeId = this.generateFullId(id, vid);
        return {
            promiseParam: {
                index: `${lowercaseResourceType}-alias`,
                id: compositeId,
            },
            id: compositeId,
            type: 'delete',
        };
    }

    // Getting promise params for inserting a new record or editing a record
    // eslint-disable-next-line class-methods-use-this
    getUpsertRecordPromiseParam(newImage: any): PromiseParamAndId | null {
        const lowercaseResourceType = newImage.resourceType.toLowerCase();

        // We only perform operations on records with documentStatus === AVAILABLE || DELETED
        if (
            newImage[DOCUMENT_STATUS_FIELD] !== DOCUMENT_STATUS.AVAILABLE &&
            newImage[DOCUMENT_STATUS_FIELD] !== DOCUMENT_STATUS.DELETED
        ) {
            return null;
        }

        let type: PromiseType = 'upsert-DELETED';
        if (newImage[DOCUMENT_STATUS_FIELD] === DOCUMENT_STATUS.AVAILABLE) {
            type = 'upsert-AVAILABLE';
        }
        const { id, vid } = newImage;
        const compositeId = this.generateFullId(id, vid);
        return {
            id: compositeId,
            promiseParam: {
                index: `${lowercaseResourceType}-alias`,
                id: compositeId,
                body: {
                    doc: newImage,
                    doc_as_upsert: true,
                },
            },
            type,
        };
    }

    // eslint-disable-next-line class-methods-use-this
    isBinaryResource(image: any): boolean {
        const resourceType = image.resourceType.toLowerCase();
        // Don't index binary files
        return resourceType === BINARY_RESOURCE;
    }

    // eslint-disable-next-line class-methods-use-this
    async logAndExecutePromises(promiseParamAndIds: PromiseParamAndId[]) {
        // We're using allSettled-shim because as of 7/21/2020 'serverless-plugin-typescript' does not support
        // Promise.allSettled.
        allSettled.shim();

        await this.executePromiseBlock('upsert-AVAILABLE', promiseParamAndIds);
        await this.executePromiseBlock('upsert-DELETED', promiseParamAndIds);
        await this.executePromiseBlock('delete', promiseParamAndIds);
    }

    // eslint-disable-next-line class-methods-use-this
    private async executePromiseBlock(type: PromiseType, promiseParamAndIds: PromiseParamAndId[]) {
        const filteredPromiseParamAndIds = promiseParamAndIds.filter(paramAndId => {
            return paramAndId.type === type;
        });

        if (filteredPromiseParamAndIds.length === 0) {
            return;
        }

        logger.info(
            `Starting operation "${type}" on resource Ids: `,
            filteredPromiseParamAndIds.map(paramAndId => {
                return paramAndId.id;
            }),
        );

        // @ts-ignore
        const results = await Promise.allSettled(
            filteredPromiseParamAndIds.map(async paramAndId => {
                try {
                    let response;
                    if (type === 'upsert-AVAILABLE' || type === 'upsert-DELETED') {
                        response = await this.ElasticSearch.update(paramAndId.promiseParam);
                    } else if (type === 'delete') {
                        response = await this.ElasticSearch.delete(paramAndId.promiseParam);
                    } else {
                        throw new Error(`unknown type: ${type}`);
                    }
                    return response;
                } catch (e) {
                    logger.error(`${type} failed on id: ${paramAndId.id}, due to error:\n${e}`);
                    throw e;
                }
            }),
        );

        // Throw rejected promises
        const rejected = results
            .filter((result: { status: string }) => result.status === 'rejected')
            .map((result: { reason: string }) => result.reason);
        if (rejected.length > 0) {
            throw new Error(rejected);
        }
    }
}
