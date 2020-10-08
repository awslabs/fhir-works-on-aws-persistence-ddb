/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { AxiosInstance } from 'axios';
import { aws4Interceptor } from 'aws4-axios';
import Auth from './auth';

export default class IamAuth implements Auth {
    region: string;

    constructor(region: string) {
        this.region = region;
    }

    attachInterceptor(axiosInstance: AxiosInstance) {
        const interceptor = aws4Interceptor({
            region: this.region,
            service: 'execute-api',
        });
        axiosInstance.interceptors.request.use(interceptor);
    }
}
