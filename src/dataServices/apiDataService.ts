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
import axios from 'axios';
import IamAuth from '../auth/iamAuth';

export class ApiDataService implements Persistence {
    updateCreateSupported: boolean = false;

    private INTEGRATION_TRANSFORM_URL: string;

    constructor(integrationTransformUrl: string) {
        this.INTEGRATION_TRANSFORM_URL = integrationTransformUrl;
        new IamAuth().initialize();
    }

    async createResource(request: CreateResourceRequest): Promise<GenericResponse> {
        try {
            const url = `${this.INTEGRATION_TRANSFORM_URL}/persistence/${request.resourceType}`;
            const response = await axios.post(url, request.resource);
            return { message: '', resource: response.data.resource };
        } catch (e) {
            throw this.getError(e);
        }
    }

    async readResource(request: ReadResourceRequest): Promise<GenericResponse> {
        try {
            const response = await axios.get(
                `${this.INTEGRATION_TRANSFORM_URL}/persistence/${request.resourceType}/${request.id}`,
            );
            return { message: '', resource: response.data.resource };
        } catch (e) {
            throw this.getError(e, request.resourceType, request.id);
        }
    }

    async updateResource(request: UpdateResourceRequest): Promise<GenericResponse> {
        try {
            const response = await axios.put(
                `${this.INTEGRATION_TRANSFORM_URL}/persistence/${request.resourceType}/${request.id}`,
                request.resource,
            );
            return { message: '', resource: response.data.resource };
        } catch (e) {
            throw this.getError(e, request.resourceType, request.id);
        }
    }

    async deleteResource(request: DeleteResourceRequest): Promise<GenericResponse> {
        try {
            await axios.delete(`${this.INTEGRATION_TRANSFORM_URL}/persistence/${request.resourceType}/${request.id}`);
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
