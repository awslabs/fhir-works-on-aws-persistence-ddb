/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable class-methods-use-this */
import {
    ConditionalDeleteResourceRequest,
    CreateResourceRequest,
    DeleteResourceRequest,
    GenericResponse,
    PatchResourceRequest,
    Persistence,
    ReadResourceRequest,
    ResourceNotFoundError,
    UpdateResourceRequest,
    vReadResourceRequest,
} from 'fhir-works-on-aws-interface';
import axios, { AxiosInstance } from 'axios';
import IamAuth from '../auth/iamAuth';

export class ApiDataService implements Persistence {
    updateCreateSupported: boolean = false;

    private axiosInstance: AxiosInstance;

    constructor(integrationTransformUrl: string, awsRegion: string, axiosInstance?: AxiosInstance) {
        const instance = axiosInstance ?? axios.create({ baseURL: integrationTransformUrl });
        new IamAuth(awsRegion).attachInterceptor(instance);
        this.axiosInstance = instance;
    }

    async createResource(request: CreateResourceRequest): Promise<GenericResponse> {
        try {
            const response = await this.axiosInstance.post(`/persistence/${request.resourceType}`, request.resource);
            return { message: '', resource: response.data.resource };
        } catch (e) {
            throw this.getError(e);
        }
    }

    async readResource(request: ReadResourceRequest): Promise<GenericResponse> {
        try {
            const response = await this.axiosInstance.get(`/persistence/${request.resourceType}/${request.id}`);
            return { message: '', resource: response.data.resource };
        } catch (e) {
            throw this.getError(e, request.resourceType, request.id);
        }
    }

    async updateResource(request: UpdateResourceRequest): Promise<GenericResponse> {
        try {
            const response = await this.axiosInstance.put(
                `/persistence/${request.resourceType}/${request.id}`,
                request.resource,
            );
            return { message: '', resource: response.data.resource };
        } catch (e) {
            throw this.getError(e, request.resourceType, request.id);
        }
    }

    async deleteResource(request: DeleteResourceRequest): Promise<GenericResponse> {
        try {
            await this.axiosInstance.delete(`/persistence/${request.resourceType}/${request.id}`);
            // Don't need to actually return anything to the router
            return { message: '' };
        } catch (e) {
            return this.getError(e, request.resourceType, request.id);
        }
    }

    getError(e: any, resourceType: string = '', id: string = '') {
        if (e.response) {
            const message = e.response.data.message || '';
            const statusCode = e.response.status || undefined;
            if (id !== '' && statusCode === 404) {
                return new ResourceNotFoundError(resourceType, id, message);
            }
            console.error('An error was received from the Integration Transform', {
                message,
                statusCode,
            });
            return new Error(`An error was received from the Integration Transform: ${message}`);
        }
        const errorMessage = 'Failed to connect to the Integration Transform';
        console.error(errorMessage, e);
        return new Error(errorMessage);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async deleteVersionedResource(resourceType: string, id: string, vid: number) {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async vReadResource(request: vReadResourceRequest): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conditionalCreateResource(request: CreateResourceRequest, queryParams: any): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conditionalUpdateResource(request: UpdateResourceRequest, queryParams: any): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    patchResource(request: PatchResourceRequest): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conditionalPatchResource(request: PatchResourceRequest, queryParams: any): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    conditionalDeleteResource(request: ConditionalDeleteResourceRequest, queryParams: any): Promise<GenericResponse> {
        throw new Error('Method not implemented.');
    }
}
