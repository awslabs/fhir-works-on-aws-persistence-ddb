/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
export * from './dataServices/dynamoDbBundleService';
export * from './dataServices/dynamoDbDataService';
export { DynamoDb } from './dataServices/dynamoDb';
export * from './objectStorageService/s3DataService';
export { handleDdbToEsEvent } from './ddbToEs/index';
