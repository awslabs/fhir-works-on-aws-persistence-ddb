/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import './offlineEnvVariables';
import AWSXRay from 'aws-xray-sdk';
import AWS from 'aws-sdk';

const AWSWithXray = AWSXRay.captureAWS(AWS);

const { IS_OFFLINE } = process.env;
if (IS_OFFLINE === 'true') {
    AWS.config.update({
        region: 'us-west-2',
        accessKeyId: process.env.ACCESS_KEY,
        secretAccessKey: process.env.SECRET_KEY,
    });
}

export default AWSWithXray;
