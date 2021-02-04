/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import DynamoDB from 'aws-sdk/clients/dynamodb';
import { GenericResponse, ResourceNotFoundError } from 'fhir-works-on-aws-interface';
import DynamoDbParamBuilder from './dynamoDbParamBuilder';
import { DynamoDBConverter } from './dynamoDb';
import DOCUMENT_STATUS from './documentStatus';
import { DynamoDbUtil, DOCUMENT_STATUS_FIELD } from './dynamoDbUtil';

export default class DynamoDbHelper {
    private dynamoDb: DynamoDB;

    constructor(dynamoDb: DynamoDB) {
        this.dynamoDb = dynamoDb;
    }

    async getMostRecentResource(
        resourceType: string,
        id: string,
        projectionExpression?: string,
    ): Promise<GenericResponse> {
        const params = DynamoDbParamBuilder.buildGetResourcesQueryParam(id, resourceType, 1, projectionExpression);

        const result = await this.dynamoDb.query(params).promise();
        if (result.Items === undefined || result.Items.length === 0) {
            throw new ResourceNotFoundError(resourceType, id);
        }
        let item = DynamoDBConverter.unmarshall(result.Items[0]);
        item = DynamoDbUtil.cleanItem(item);

        return {
            message: 'Resource found',
            resource: item,
        };
    }

    async getMostRecentValidResource(resourceType: string, id: string): Promise<GenericResponse> {
        // TODO: Add a test in for this method?
        const params = DynamoDbParamBuilder.buildGetResourcesQueryParam(id, resourceType, 2);
        let item = null;
        let result: any = {};
        try {
            result = await this.dynamoDb.query(params).promise();
        } catch (e) {
            if (e.code === 'ConditionalCheckFailedException') {
                throw new ResourceNotFoundError(resourceType, id);
            }
            throw e;
        }

        const items = result.Items
            ? result.Items.map((ddbJsonItem: any) => DynamoDBConverter.unmarshall(ddbJsonItem))
            : [];
        if (items.length === 0) {
            throw new ResourceNotFoundError(resourceType, id);
        }
        const latestItemDocStatus = items[0][DOCUMENT_STATUS_FIELD];
        if (latestItemDocStatus === DOCUMENT_STATUS.DELETED) {
            throw new ResourceNotFoundError(resourceType, id);
        }
        // If the latest version of the resource is in PENDING, grab the previous version
        if (latestItemDocStatus === DOCUMENT_STATUS.PENDING && items.length > 1) {
            // eslint-disable-next-line prefer-destructuring
            item = items[1];
        } else {
            // Latest version that are in LOCKED/PENDING_DELETE/AVAILABLE are valid to be read from
            // eslint-disable-next-line prefer-destructuring
            item = items[0];
        }
        item = DynamoDbUtil.cleanItem(item);
        return {
            message: 'Resource found',
            resource: item,
        };
    }
}
