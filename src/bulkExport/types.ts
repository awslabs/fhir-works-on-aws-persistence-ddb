/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
import { ExportType } from 'fhir-works-on-aws-interface';
import { JobRunState } from 'aws-sdk/clients/glue';

/**
 * Bulk export state machine parameters.
 * All lambda functions in the state machine are expected to use this type as both input and output
 */
export interface BulkExportStateMachineGlobalParameters {
    jobId: string;
    exportType: ExportType;
    transactionTime: string;
    requestQueryParams?: {
        _outputFormat?: string;
        _since?: string;
        _type?: string;
    };
    executionParameters?: BulkExportStateMachineExecutionParameters;
}

/**
 * Outputs of intermediate steps of the state machine execution that can be used as parameters for subsequent steps
 */
export interface BulkExportStateMachineExecutionParameters {
    glueJobRunId?: string;
    glueJobRunStatus?: JobRunState;
    isCanceled?: boolean;
}
