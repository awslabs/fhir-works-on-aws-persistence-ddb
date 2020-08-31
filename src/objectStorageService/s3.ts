/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import AWS from '../AWS';

const { IS_OFFLINE } = process.env;

let binaryBucket = process.env.FHIR_BINARY_BUCKET || '';
if (IS_OFFLINE === 'true') {
    binaryBucket = process.env.OFFLINE_BINARY_BUCKET || '';
}

export const FHIR_BINARY_BUCKET = binaryBucket;

export const S3 = new AWS.S3({ signatureVersion: 'v4', sslEnabled: true });

export default S3;
