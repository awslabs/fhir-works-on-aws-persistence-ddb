/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 *
 */

export interface BulkExportResultsUrlGenerator {
    getUrls(options: { bucket: string; keys: string[] }): Promise<{ requiresAccessToken: boolean; urls: string[] }>;
}
