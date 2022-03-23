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
        const deleteRequests: any[] = [];
        const createRequests: any[] = [];
        const updateRequests: any[] = [];

        const batchReadWriteResponses: BatchReadWriteResponse[] = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const request of requests) {
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
                    // eslint-disable-next-line no-await-in-loop
                    item = await dynamoDbHelper.getMostRecentUserReadableResource(resourceType, id, tenantId);
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
                        Statement: `INSERT INTO "${RESOURCE_TABLE}" VALUE ${this.convertToPartiQLString(item)}`,
                        id,
                    });

                    batchReadWriteResponses.push({
                        id,
                        vid: item.meta.versionId,
                        operation: request.operation,
                        lastModified: item.meta.lastUpdated,
                        resourceType,
                        resource: item,
                    });
                    break;
                }
                case 'update': {
                    if (vid === 0) {
                        break;
                    }
                    // increment the vid
                    vid += 1;
                    item = DynamoDbUtil.prepItemForDdbInsert(
                        { ...item?.resource, ...request.resource },
                        id,
                        vid,
                        DOCUMENT_STATUS.AVAILABLE,
                        tenantId,
                    );
                    // we create a new version of the resource with an incremented vid
                    updateRequests.push({
                        Statement: `INSERT INTO "${RESOURCE_TABLE}" VALUE ${this.convertToPartiQLString(item)}`,
                        id,
                    });
                    batchReadWriteResponses.push({
                        id,
                        vid: vid.toString(),
                        operation: request.operation,
                        lastModified: item.meta.lastUpdated,
                        resourceType,
                        resource: {},
                    });
                    break;
                }
                case 'delete': {
                    if (vid === 0) {
                        break;
                    }
                    deleteRequests.push({
                        Statement: `
                            UPDATE "${RESOURCE_TABLE}"
                            SET "${DOCUMENT_STATUS_FIELD}" = '${DOCUMENT_STATUS.DELETED}'
                            WHERE "id" = '${buildHashKey(id, tenantId)}' AND "vid" = ${vid}
                        `,
                        id,
                    });

                    batchReadWriteResponses.push({
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
                    if (vid === 0) {
                        break;
                    }
                    batchReadWriteResponses.push({
                        id,
                        vid: vid.toString(),
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
        }
        // we cannot do deleteRequests nor updateRequests in a batchwriteitem call, since we use the update api instead of delete
        // hence, we will separate these requests and use batchexecuteStatement to update items in a batch (and
        // we know there are no conflicts since there will only be updates running)
        return {
            editRequests: [...deleteRequests, ...createRequests, ...updateRequests],
            batchReadWriteResponses,
        };
    }

    static async processBatchEditRequests(
        editRequests: any[],
        batchReadWriteResponses: BatchReadWriteResponse[],
        dynamoDb: DynamoDB,
    ) {
        const updatedResponses = batchReadWriteResponses;
        for (let i = 0; i < editRequests.length; i += MAX_BATCH_WRITE_ITEMS) {
            const upperLimit = Math.min(i + MAX_BATCH_WRITE_ITEMS, editRequests.length);
            const batch = editRequests.slice(i, upperLimit);
            const statements = batch.map((x) => {
                return { Statement: x.Statement };
            });
            // eslint-disable-next-line no-await-in-loop
            const batchExecuteResponse = await dynamoDb
                .batchExecuteStatement({
                    Statements: [...statements],
                })
                .promise();
            batchExecuteResponse?.Responses?.forEach((response, index) => {
                if (response.Error) {
                    console.log('Unable to process request: ', response.Error);
                    const indexOfFailure = batchReadWriteResponses.findIndex((x) => x.id === batch[index].id);
                    if (index !== -1) {
                        updatedResponses[indexOfFailure] = {
                            ...batchReadWriteResponses[indexOfFailure],
                            vid: '',
                        };
                    }
                }
            });
        }
        return updatedResponses;
    }

    // ExecuteStatement requires objects to be in the form a PartiQL tuple
    // this means strings must be single quotes
    static convertToPartiQLString(value: any) {
        let objString = '';
        if (typeof value === 'object') {
            if (Array.isArray(value)) {
                objString += '[';
                value.forEach((_, index) => {
                    objString += `${this.convertToPartiQLString(value[index])}`;
                    if (index !== value.length - 1) {
                        objString += ',';
                    }
                });
                objString += ']';
            } else {
                const lastKey = Object.keys(value).pop();
                objString += '{';
                Object.keys(value).forEach((key) => {
                    objString += `'${key}':${this.convertToPartiQLString(value[key])}`;
                    if (key !== lastKey) {
                        objString += ',';
                    }
                });
                objString += '}';
            }
        } else if (typeof value === 'string') {
            objString += `'${value.replace(/'/g, "''")}'`;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            objString += `${value}`;
        }
        return objString;
    }
}
