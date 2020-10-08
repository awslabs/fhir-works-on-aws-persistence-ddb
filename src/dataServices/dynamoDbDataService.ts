/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable class-methods-use-this */

import uuidv4 from 'uuid/v4';
import {
    GenericResponse,
    Persistence,
    ReadResourceRequest,
    vReadResourceRequest,
    CreateResourceRequest,
    DeleteResourceRequest,
    UpdateResourceRequest,
    PatchResourceRequest,
    ConditionalDeleteResourceRequest,
    BatchReadWriteRequest,
    BundleResponse,
    generateMeta,
    clone,
    ResourceVersionNotFoundError,
    InitiateExportRequest,
    GetExportStatusResponse,
    BulkDataAccess,
    ResourceNotFoundError,
    TooManyConcurrentExportRequestsError,
    ExportJobStatus,
} from 'fhir-works-on-aws-interface';
import DynamoDB, { ItemList } from 'aws-sdk/clients/dynamodb';
import { DynamoDBConverter } from './dynamoDb';
import DOCUMENT_STATUS from './documentStatus';
import { DynamoDbBundleService } from './dynamoDbBundleService';
import { DynamoDbUtil } from './dynamoDbUtil';
import DynamoDbParamBuilder from './dynamoDbParamBuilder';
import DynamoDbHelper from './dynamoDbHelper';

export class DynamoDbDataService implements Persistence, BulkDataAccess {
    private readonly MAXIMUM_SYSTEM_LEVEL_CONCURRENT_REQUESTS = 2;

    private readonly MAXIMUM_CONCURRENT_REQUEST_PER_USER = 1;

    updateCreateSupported: boolean = false;

    private readonly transactionService: DynamoDbBundleService;

    private readonly dynamoDbHelper: DynamoDbHelper;

    private readonly dynamoDb: DynamoDB;

    constructor(dynamoDb: DynamoDB) {
        this.dynamoDbHelper = new DynamoDbHelper(dynamoDb);
        this.transactionService = new DynamoDbBundleService(dynamoDb);
        this.dynamoDb = dynamoDb;
    }

    async readResource(request: ReadResourceRequest): Promise<GenericResponse> {
        return this.dynamoDbHelper.getMostRecentValidResource(request.resourceType, request.id);
    }

    async vReadResource(request: vReadResourceRequest): Promise<GenericResponse> {
        const { resourceType, id, vid } = request;
        const params = DynamoDbParamBuilder.buildGetItemParam(id, parseInt(vid, 10));
        const result = await this.dynamoDb.getItem(params).promise();
        if (result.Item === undefined) {
            throw new ResourceVersionNotFoundError(resourceType, id, vid);
        }
        let item = DynamoDBConverter.unmarshall(result.Item);
        item = DynamoDbUtil.cleanItem(item);
        return {
            message: 'Resource found',
            resource: item,
        };
    }

    async createResource(request: CreateResourceRequest) {
        const { resourceType, resource, id } = request;
        const vid = 1;
        let item = resource;
        item.resourceType = resourceType;
        item.meta = generateMeta(vid.toString());

        const params = DynamoDbParamBuilder.buildPutAvailableItemParam(item, id || uuidv4(), vid);
        await this.dynamoDb.putItem(params).promise();
        const newItem = DynamoDBConverter.unmarshall(params.Item);
        item = DynamoDbUtil.cleanItem(newItem);
        return {
            success: true,
            message: 'Resource created',
            resource: item,
        };
    }

    async deleteResource(request: DeleteResourceRequest) {
        const { resourceType, id } = request;
        const itemServiceResponse = await this.readResource({ resourceType, id });

        const { versionId } = itemServiceResponse.resource.meta;

        return this.deleteVersionedResource(resourceType, id, parseInt(versionId, 10));
    }

    async deleteVersionedResource(resourceType: string, id: string, vid: number) {
        const updateStatusToDeletedParam = DynamoDbParamBuilder.buildUpdateDocumentStatusParam(
            DOCUMENT_STATUS.AVAILABLE,
            DOCUMENT_STATUS.DELETED,
            id,
            vid,
        ).Update;
        await this.dynamoDb.updateItem(updateStatusToDeletedParam).promise();
        return {
            success: true,
            message: `Successfully deleted ResourceType: ${resourceType}, Id: ${id}, VersionId: ${vid}`,
        };
    }

    async updateResource(request: UpdateResourceRequest) {
        const { resource, resourceType, id } = request;
        const resourceCopy = { ...resource };
        const getResponse = await this.readResource({ resourceType, id });
        const currentVId: number = getResponse.resource.meta
            ? parseInt(getResponse.resource.meta.versionId, 10) || 0
            : 0;

        resourceCopy.meta = generateMeta((currentVId + 1).toString());

        const batchRequest: BatchReadWriteRequest = {
            operation: 'update',
            resourceType,
            id,
            resource: resourceCopy,
        };

        let item: any = {};
        // Sending the request to `atomicallyReadWriteResources` to take advantage of LOCKING management handled by
        // that method
        const response: BundleResponse = await this.transactionService.transaction({
            requests: [batchRequest],
            startTime: new Date(),
        });
        item = clone(resource);
        const batchReadWriteEntryResponse = response.batchReadWriteResponses[0];
        item.meta = generateMeta(batchReadWriteEntryResponse.vid, new Date(batchReadWriteEntryResponse.lastModified));
        return {
            success: true,
            message: 'Resource updated',
            resource: item,
        };
    }

    async initiateExport(initiateExportRequest: InitiateExportRequest): Promise<string> {
        await this.throttleExportRequestsIfNeeded(initiateExportRequest.requesterUserId);
        // Create new export job
        const jobId = uuidv4();

        // TODO: Start Export Job Step Function
        // const stepFunctionArn = await StartStepFunctionAndGetStepFunctionArn

        const params = DynamoDbParamBuilder.buildPutCreateExportRequest(jobId, initiateExportRequest, '');
        await this.dynamoDb.putItem(params).promise();
        return jobId;
    }

    async throttleExportRequestsIfNeeded(requesterUserId: string) {
        const jobStatusesToThrottle: ExportJobStatus[] = ['canceling', 'in-progress'];
        const exportJobItems = await this.getJobsWithExportStatuses(jobStatusesToThrottle);

        if (exportJobItems) {
            const numberOfConcurrentUserRequest = exportJobItems.filter(item => {
                return DynamoDBConverter.unmarshall(item).jobOwnerId === requesterUserId;
            }).length;
            if (
                numberOfConcurrentUserRequest >= this.MAXIMUM_CONCURRENT_REQUEST_PER_USER ||
                exportJobItems.length >= this.MAXIMUM_SYSTEM_LEVEL_CONCURRENT_REQUESTS
            ) {
                throw new TooManyConcurrentExportRequestsError();
            }
        }
    }

    async getJobsWithExportStatuses(jobStatuses: ExportJobStatus[]): Promise<ItemList> {
        const jobStatusPromises = jobStatuses.map((jobStatus: ExportJobStatus) => {
            const projectionExpression = 'jobOwnerId, jobStatus';
            const queryJobStatusParam = DynamoDbParamBuilder.buildQueryExportRequestJobStatus(
                jobStatus,
                projectionExpression,
            );
            return this.dynamoDb.query(queryJobStatusParam).promise();
        });

        const jobStatusResponses = await Promise.all(jobStatusPromises);
        let allJobStatusItems: ItemList = [];
        jobStatusResponses.forEach((jobStatusResponse: DynamoDB.QueryOutput) => {
            if (jobStatusResponse.Items) {
                allJobStatusItems = allJobStatusItems.concat(jobStatusResponse.Items);
            }
        });
        return allJobStatusItems;
    }

    async cancelExport(jobId: string): Promise<void> {
        const jobDetailsParam = DynamoDbParamBuilder.buildGetExportRequestJob(jobId);
        const jobDetailsResponse = await this.dynamoDb.getItem(jobDetailsParam).promise();
        if (!jobDetailsResponse.Item) {
            throw new ResourceNotFoundError('$export', jobId);
        }
        const jobItem = DynamoDBConverter.unmarshall(jobDetailsResponse.Item);
        if (['completed', 'failed'].includes(jobItem.jobStatus)) {
            throw new Error(`Job cannot be canceled because job is already in ${jobItem.jobStatus} state`);
        }
        // A job in the canceled or canceling state doesn't need to be updated to 'canceling'
        if (['canceled', 'canceling'].includes(jobItem.jobStatus)) {
            return;
        }

        const params = DynamoDbParamBuilder.buildUpdateExportRequestJobStatus(jobId, 'canceling');
        await this.dynamoDb.updateItem(params).promise();
    }

    async getExportStatus(jobId: string): Promise<GetExportStatusResponse> {
        const jobDetailsParam = DynamoDbParamBuilder.buildGetExportRequestJob(jobId);
        const jobDetailsResponse = await this.dynamoDb.getItem(jobDetailsParam).promise();
        if (!jobDetailsResponse.Item) {
            throw new ResourceNotFoundError('$export', jobId);
        }

        const item = DynamoDBConverter.unmarshall(<DynamoDB.AttributeMap>jobDetailsResponse.Item);

        const {
            jobStatus,
            jobOwnerId,
            s3PresignedUrls,
            transactionTime,
            exportType,
            outputFormat,
            since,
            type,
            groupId,
            errorArray = [],
            errorMessage = '',
        } = item;

        const getExportStatusResponse: GetExportStatusResponse = {
            jobOwnerId,
            jobStatus,
            exportedFileUrls: s3PresignedUrls,
            transactionTime,
            exportType,
            outputFormat,
            since,
            type,
            groupId,
            errorArray,
            errorMessage,
        };

        return getExportStatusResponse;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conditionalCreateResource(request: CreateResourceRequest, queryParams: any): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conditionalUpdateResource(request: UpdateResourceRequest, queryParams: any): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    patchResource(request: PatchResourceRequest): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conditionalPatchResource(request: PatchResourceRequest, queryParams: any): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conditionalDeleteResource(request: ConditionalDeleteResourceRequest, queryParams: any): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }
}
