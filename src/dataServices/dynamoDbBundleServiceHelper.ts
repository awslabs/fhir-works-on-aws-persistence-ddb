/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import uuidv4 from 'uuid/v4';
import {
    BatchReadWriteRequest,
    BatchReadWriteResponse,
    TypeOperation,
    SystemOperation,
} from 'fhir-works-on-aws-interface';
import { DynamoDB } from 'aws-sdk';
import { buildHashKey, DOCUMENT_STATUS_FIELD, DynamoDbUtil } from './dynamoDbUtil';
import DOCUMENT_STATUS from './documentStatus';
import { DynamoDBConverter, RESOURCE_TABLE } from './dynamoDb';
import DynamoDbParamBuilder from './dynamoDbParamBuilder';
import { MAX_BATCH_WRITE_ITEMS } from '../constants';
import DynamoDbHelper from './dynamoDbHelper';

export interface ItemRequest {
    id: string;
    vid?: number;
    resourceType: string;
    operation: TypeOperation | SystemOperation;
    isOriginalUpdateItem?: boolean;
}

export default class DynamoDbBundleServiceHelper {
    static generateStagingRequests(
        requests: BatchReadWriteRequest[],
        idToVersionId: Record<string, number>,
        tenantId?: string,
    ) {
        const deleteRequests: any = [];
        const createRequests: any = [];
        const updateRequests: any = [];
        const readRequests: any = [];

        let newLocks: ItemRequest[] = [];
        let newBundleEntryResponses: BatchReadWriteResponse[] = [];

        requests.forEach((request) => {
            switch (request.operation) {
                case 'create': {
                    // Add create request, put it in PENDING
                    let id = uuidv4();
                    if (request.id) {
                        id = request.id;
                    }
                    const vid = 1;
                    const Item = DynamoDbUtil.prepItemForDdbInsert(
                        request.resource,
                        id,
                        vid,
                        DOCUMENT_STATUS.PENDING,
                        tenantId,
                    );

                    createRequests.push({
                        Put: {
                            TableName: RESOURCE_TABLE,
                            Item: DynamoDBConverter.marshall(Item),
                        },
                    });
                    const { stagingResponse, itemLocked } = this.addStagingResponseAndItemsLocked(request.operation, {
                        ...request.resource,
                        meta: { ...Item.meta },
                        id,
                    });
                    newBundleEntryResponses = newBundleEntryResponses.concat(stagingResponse);
                    newLocks = newLocks.concat(itemLocked);
                    break;
                }
                case 'update': {
                    // Create new entry with status = PENDING
                    // When updating a resource, create a new Document for that resource
                    const { id } = request.resource;
                    const vid = (idToVersionId[id] || 0) + 1;
                    const Item = DynamoDbUtil.prepItemForDdbInsert(
                        request.resource,
                        id,
                        vid,
                        DOCUMENT_STATUS.PENDING,
                        tenantId,
                    );

                    updateRequests.push({
                        Put: {
                            TableName: RESOURCE_TABLE,
                            Item: DynamoDBConverter.marshall(Item),
                        },
                    });

                    const { stagingResponse, itemLocked } = this.addStagingResponseAndItemsLocked(request.operation, {
                        ...request.resource,
                        meta: { ...Item.meta },
                    });
                    newBundleEntryResponses = newBundleEntryResponses.concat(stagingResponse);
                    newLocks = newLocks.concat(itemLocked);
                    break;
                }
                case 'delete': {
                    // Mark documentStatus as PENDING_DELETE
                    const { id, resourceType } = request;
                    const vid = idToVersionId[id];
                    deleteRequests.push(
                        DynamoDbParamBuilder.buildUpdateDocumentStatusParam(
                            DOCUMENT_STATUS.LOCKED,
                            DOCUMENT_STATUS.PENDING_DELETE,
                            id,
                            vid,
                            resourceType,
                            tenantId,
                        ),
                    );
                    newBundleEntryResponses.push({
                        id,
                        vid: vid.toString(),
                        operation: request.operation,
                        lastModified: new Date().toISOString(),
                        resource: {},
                        resourceType: request.resourceType,
                    });
                    break;
                }
                case 'read': {
                    // Read the latest version with documentStatus = "LOCKED"
                    const { id } = request;
                    const vid = idToVersionId[id];
                    readRequests.push({
                        Get: {
                            TableName: RESOURCE_TABLE,
                            Key: DynamoDBConverter.marshall({
                                id: buildHashKey(id, tenantId),
                                vid,
                            }),
                        },
                    });
                    newBundleEntryResponses.push({
                        id,
                        vid: vid.toString(),
                        operation: request.operation,
                        lastModified: '',
                        resource: {},
                        resourceType: request.resourceType,
                    });
                    break;
                }
                default: {
                    break;
                }
            }
        });

        return {
            deleteRequests,
            createRequests,
            updateRequests,
            readRequests,
            newLocks,
            newStagingResponses: newBundleEntryResponses,
        };
    }

    static generateRollbackRequests(bundleEntryResponses: BatchReadWriteResponse[], tenantId?: string) {
        let itemsToRemoveFromLock: { id: string; vid: string; resourceType: string }[] = [];
        let transactionRequests: any = [];
        bundleEntryResponses.forEach((stagingResponse) => {
            switch (stagingResponse.operation) {
                case 'create':
                case 'update': {
                    /*
                        DELETE latest record
                        and remove lock entry from lockedItems
                     */
                    const { transactionRequest, itemToRemoveFromLock } =
                        this.generateDeleteLatestRecordAndItemToRemoveFromLock(
                            stagingResponse.resourceType,
                            stagingResponse.id,
                            stagingResponse.vid,
                            tenantId,
                        );
                    transactionRequests = transactionRequests.concat(transactionRequest);
                    itemsToRemoveFromLock = itemsToRemoveFromLock.concat(itemToRemoveFromLock);
                    break;
                }
                default: {
                    // For READ and DELETE we don't need to delete anything, because no new records were made for those
                    // requests
                    break;
                }
            }
        });

        return { transactionRequests, itemsToRemoveFromLock };
    }

    private static generateDeleteLatestRecordAndItemToRemoveFromLock(
        resourceType: string,
        id: string,
        vid: string,
        tenantId?: string,
    ) {
        const transactionRequest = DynamoDbParamBuilder.buildDeleteParam(id, parseInt(vid, 10), tenantId);
        const itemToRemoveFromLock = {
            id,
            vid,
            resourceType,
        };

        return { transactionRequest, itemToRemoveFromLock };
    }

    static populateBundleEntryResponseWithReadResult(bundleEntryResponses: BatchReadWriteResponse[], readResult: any) {
        let index = 0;
        const updatedStagingResponses = bundleEntryResponses;
        for (let i = 0; i < bundleEntryResponses.length; i += 1) {
            const stagingResponse = bundleEntryResponses[i];
            // The first readResult will be the response to the first READ stagingResponse
            if (stagingResponse.operation === 'read') {
                let item = readResult?.Responses[index]?.Item;
                if (item === undefined) {
                    throw new Error('Failed to fulfill all READ requests');
                }
                item = DynamoDBConverter.unmarshall(item);
                item = DynamoDbUtil.cleanItem(item);

                stagingResponse.resource = item;
                stagingResponse.lastModified = item?.meta?.lastUpdated ? item.meta.lastUpdated : '';
                updatedStagingResponses[i] = stagingResponse;
                index += 1;
            }
        }
        return updatedStagingResponses;
    }

    private static addStagingResponseAndItemsLocked(operation: TypeOperation, resource: any) {
        const stagingResponse: BatchReadWriteResponse = {
            id: resource.id,
            vid: resource.meta.versionId,
            operation,
            lastModified: resource.meta.lastUpdated,
            resourceType: resource.resourceType,
            resource,
        };
        const itemLocked: ItemRequest = {
            id: resource.id,
            vid: parseInt(resource.meta.versionId, 10),
            resourceType: resource.resourceType,
            operation,
        };
        if (operation === 'update') {
            itemLocked.isOriginalUpdateItem = false;
        }

        return { stagingResponse, itemLocked };
    }

    static async sortBatchRequests(
        requests: BatchReadWriteRequest[],
        dynamoDbHelper: DynamoDbHelper,
        tenantId?: string,
    ) {
        console.log(requests);
        const deleteRequests: any = [];
        const createRequests: any = [];
        const updateRequests: any = [];

        const batchReadWriteResponses: BatchReadWriteResponse[] = [];
        requests.forEach(async (request) => {
            let vid = 0;
            let { id } = request;
            const { resourceType, operation } = request;
            let item;
            // we need to query to get the VersionID of the resource for non-create operations
            if (operation === 'create') {
                vid = 1;
                id = request.id ? request.id : uuidv4();
            } else {
                try {
                    item = await dynamoDbHelper.getMostRecentUserReadableResource(resourceType, id, tenantId);
                    console.log('retrieved item:', item);
                    vid = Number(item.resource?.meta.versionId);
                } catch (e: any) {
                    console.log(`Failed to find resource ${id}`);
                    batchReadWriteResponses.push({
                        id,
                        vid: '',
                        operation,
                        resourceType,
                        resource: {},
                        lastModified: '',
                    });
                    return;
                }
            }
            switch (operation) {
                case 'create': {
                    item = DynamoDbUtil.prepItemForDdbInsert(
                        request.resource,
                        id,
                        vid,
                        DOCUMENT_STATUS.AVAILABLE,
                        tenantId,
                    );

                    createRequests.push({
                        PutRequest: {
                            Item: DynamoDBConverter.marshall(item),
                        },
                    });

                    batchReadWriteResponses.push({
                        id,
                        vid: item.meta.versionId,
                        operation: request.operation,
                        lastModified: item.meta.lastUpdated,
                        resourceType: request.resource.resourceType,
                        resource: request.resource,
                    });
                    break;
                }
                case 'update': {
                    // increment the vid
                    vid += 1;
                    item = DynamoDbUtil.prepItemForDdbInsert(
                        { ...item?.resource, ...request.resource },
                        id,
                        vid,
                        DOCUMENT_STATUS.AVAILABLE,
                        tenantId,
                    );
                    // we need to delete the old verison, and create a new version
                    updateRequests.push([
                        {
                            PutRequest: {
                                Item: DynamoDBConverter.marshall(item),
                            },
                        },
                        {
                            Statement: `
                                UPDATE "${RESOURCE_TABLE}"
                                SET "${DOCUMENT_STATUS_FIELD}" = '${DOCUMENT_STATUS.DELETED}'
                                WHERE "id" = '${buildHashKey(id, tenantId)}' AND "vid" = ${vid - 1}
                            `,
                        },
                    ]);
                    batchReadWriteResponses.push({
                        id: request.resource.id,
                        vid: vid.toString(),
                        operation: request.operation,
                        lastModified: item.meta.lastUpdated,
                        resourceType: request.resource.resourceType,
                        resource: request.resource,
                    });
                    break;
                }
                case 'delete': {
                    deleteRequests.push({
                        Statement: `
                            UPDATE "${RESOURCE_TABLE}"
                            SET "${DOCUMENT_STATUS_FIELD}" = '${DOCUMENT_STATUS.DELETED}'
                            WHERE "id" = '${buildHashKey(id, tenantId)}' AND "vid" = ${vid}
                        `,
                    });

                    batchReadWriteResponses.push({
                        id,
                        vid: vid?.toString(),
                        operation: request.operation,
                        lastModified: new Date().toISOString(),
                        resource: {},
                        resourceType: request.resourceType,
                    });
                    break;
                }
                case 'read': {
                    batchReadWriteResponses.push({
                        id,
                        vid: vid?.toString(),
                        operation: request.operation,
                        lastModified: '',
                        resource: item?.resource,
                        resourceType: request.resourceType,
                    });
                    break;
                }
                default:
                    break;
            }
        });
        // we cannot do deleteRequests nor updateRequests in a batchwriteitem call, since we use the update api instead of delete
        // hence, we will separate these requests and use batchexecuteStatement to update items in a batch (and
        // we know there are no conflicts since there will only be updates running)
        return {
            deleteRequests,
            createRequests,
            updateRequests,
            batchReadWriteResponses,
        };
    }

    static async processBatchDeleteRequests(deleteRequests: any[], dynamoDb: DynamoDB) {
        for (let i = 0; i < deleteRequests.length; i += MAX_BATCH_WRITE_ITEMS) {
            const upperLimit = Math.min(i + MAX_BATCH_WRITE_ITEMS, deleteRequests.length);
            const batch = deleteRequests.slice(i, upperLimit);
            // eslint-disable-next-line no-await-in-loop
            await dynamoDb
                .batchExecuteStatement({
                    Statements: [...batch],
                })
                .promise();
        }
    }

    static async processBatchWriteRequests(writeRequests: any[], dynamoDb: DynamoDB) {
        for (let i = 0; i < writeRequests.length; i += MAX_BATCH_WRITE_ITEMS) {
            const upperLimit = Math.min(i + MAX_BATCH_WRITE_ITEMS, writeRequests.length);
            const batch = writeRequests.slice(i, upperLimit);
            // eslint-disable-next-line no-await-in-loop
            await dynamoDb
                .batchWriteItem({
                    RequestItems: {
                        [RESOURCE_TABLE]: [...batch],
                    },
                })
                .promise();
        }
    }

    static async processBatchUpdateRequests(updateRequests: any[], dynamoDb: DynamoDB) {
        const editRequests = updateRequests.map((updateReq) => {
            return updateReq[0];
        });
        const deleteRequests = updateRequests.map((updateReq) => {
            return updateReq[1];
        });
        for (let i = 0; i < editRequests.length; i += MAX_BATCH_WRITE_ITEMS) {
            const upperLimit = Math.min(i + MAX_BATCH_WRITE_ITEMS, editRequests.length);
            const batch = editRequests.slice(i, upperLimit);
            // eslint-disable-next-line no-await-in-loop
            await dynamoDb
                .batchWriteItem({
                    RequestItems: {
                        [RESOURCE_TABLE]: [...batch],
                    },
                })
                .promise();
        }
        for (let i = 0; i < deleteRequests.length; i += MAX_BATCH_WRITE_ITEMS) {
            const upperLimit = Math.min(i + MAX_BATCH_WRITE_ITEMS, deleteRequests.length);
            const batch = deleteRequests.slice(i, upperLimit);
            // eslint-disable-next-line no-await-in-loop
            await dynamoDb
                .batchExecuteStatement({
                    Statements: [...batch],
                })
                .promise();
        }
    }

    static populateBatchResponseWithReadResult(bundleEntryResponses: BatchReadWriteResponse[], readResult: any[]) {
        let index = 0;
        const updatedReadResponses = bundleEntryResponses;
        bundleEntryResponses.forEach((readResponse, i) => {
            // The first readResult will be the response to the first READ
            if (readResponse.operation === 'read') {
                let item = readResult[index];
                if (item === undefined) {
                    return;
                }
                item = DynamoDBConverter.unmarshall(item);
                item = DynamoDbUtil.cleanItem(item);

                // eslint-disable-next-line no-param-reassign
                readResponse.resource = item;
                // eslint-disable-next-line no-param-reassign
                readResponse.lastModified = item?.meta?.lastUpdated ? item.meta.lastUpdated : '';
                updatedReadResponses[i] = readResponse;
                index += 1;
            }
        });
        return updatedReadResponses;
    }
}
