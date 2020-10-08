/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { AxiosInstance } from 'axios';
import { aws4Interceptor } from 'aws4-axios';
import Auth, { InterceptorConfig } from './auth';

export default class IamAuth implements Auth {
    // eslint-disable-next-line class-methods-use-this
    attachInterceptor(axiosInstance: AxiosInstance, interceptorConfig: InterceptorConfig) {
        const interceptor = aws4Interceptor({
            region: interceptorConfig.awsRegion,
            service: 'execute-api',
        });
        axiosInstance.interceptors.request.use(interceptor);
    }
}
