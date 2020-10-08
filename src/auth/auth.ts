/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { AxiosInstance } from 'axios';

export default interface Auth {
    // Hook into axios and intercept requests to add Auth tokens
    // https://masteringjs.io/tutorials/axios/interceptors
    attachInterceptor(axiosInstance: AxiosInstance): void;
}
