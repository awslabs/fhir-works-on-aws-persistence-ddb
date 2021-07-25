/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

export type OperationType = 'delete' | 'upsert-AVAILABLE' | 'upsert-DELETED';

export default interface ESBulkCommand {
    bulkCommand: any[];
    id: string;
    type: OperationType;
}
