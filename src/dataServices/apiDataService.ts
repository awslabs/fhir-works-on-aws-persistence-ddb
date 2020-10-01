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

export class ApiDataService implements Persistence {
    updateCreateSupported: boolean = false;

    // TODO: Pull this value from AWS Param Store
    static readonly INTEGRATION_TRANSFORM_URL = 'http://localhost:4000';

    async createResource(request: CreateResourceRequest): Promise<GenericResponse> {
        let genericResponse: GenericResponse = { message: '', resource: {} };
        try {
            const url = `${ApiDataService.INTEGRATION_TRANSFORM_URL}/${request.resourceType}`;
            const response = await axios.post(url, request.resource);
            genericResponse = { message: '', resource: response.data.resource };
        } catch (e) {
            console.error(e);
            this.handleError(e);
        }
        return Promise.resolve(genericResponse);
    }

    async readResource(request: ReadResourceRequest): Promise<GenericResponse> {
        let genericResponse: GenericResponse = { message: '', resource: {} };
        try {
            const response = await axios.get(
                `${ApiDataService.INTEGRATION_TRANSFORM_URL}/${request.resourceType}/${request.id}`,
            );
            genericResponse = { message: '', resource: response.data.resource };
        } catch (e) {
            this.handleError(e, request.resourceType, request.id);
        }
        return Promise.resolve(genericResponse);
    }

    async updateResource(request: UpdateResourceRequest): Promise<GenericResponse> {
        let genericResponse: GenericResponse = { message: '', resource: {} };
        try {
            const response = await axios.put(
                `${ApiDataService.INTEGRATION_TRANSFORM_URL}/${request.resourceType}/${request.id}`,
                request.resource,
            );
            genericResponse = { message: '', resource: response.data.resource };
        } catch (e) {
            this.handleError(e, request.resourceType, request.id);
        }
        return Promise.resolve(genericResponse);
    }

    async deleteResource(request: DeleteResourceRequest): Promise<GenericResponse> {
        try {
            await axios.delete(`${ApiDataService.INTEGRATION_TRANSFORM_URL}/${request.resourceType}/${request.id}`);
        } catch (e) {
            this.handleError(e, request.resourceType, request.id);
        }
        // Don't need to actually return anything to the router
        return Promise.resolve({ message: '', resource: {} });
    }

    handleError(e: any, resourceType: string = '', id: string = '') {
        if (e.response) {
            const message = e.response.data.message || '';
            const statusCode = e.response.status || undefined;
            if (id !== '' && statusCode === 404) {
                throw new ResourceNotFoundError(resourceType, id, message);
            }
            console.error('An error was received from the Integration Transform', {
                message,
                statusCode,
            });
            throw new Error(`An error was received from the Integration Transform: ${message}`);
        }
        throw new Error('Failed to connect to the Integration Transform');
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
