/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import {
    CreateResourceRequest,
    DeleteResourceRequest,
    ReadResourceRequest,
    ResourceNotFoundError,
    UpdateResourceRequest,
} from 'fhir-works-on-aws-interface';
import { ApiDataService } from './apiDataService';

const resource = {
    resourceType: 'Patient',
    text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><p></p></div>',
    },
    active: true,
    name: [
        {
            family: 'Smith',
            given: ['Emily'],
        },
    ],
    gender: 'female',
    birthDate: '1995-09-24',
    managingOrganization: {
        reference: 'Organization/2.16.840.1.113883.19.5',
        display: 'Good Health Clinic',
    },
    meta: {
        versionId: '1',
        lastUpdated: '2020-09-30T14:17:52.867Z',
    },
    id: 'f2ddf33c-9344-49cd-991f-8273eb959f92',
};

const baseURL = 'http://localhost:4000';
const axiosInstance = axios.create({ baseURL });
const apiDataService = new ApiDataService(baseURL, 'us-east-1', axiosInstance);
const mock = new MockAdapter(axiosInstance);
afterEach(() => {
    mock.reset();
});
expect.hasAssertions();

const url = `http://localhost:4000/persistence/Patient`;
describe('CREATE', () => {
    test('create resource successfully', async () => {
        // BUILD
        const data = {
            message: '',
            resource,
        };

        mock.onPost(url).reply(201, data);

        const createResourceRequest: CreateResourceRequest = {
            resourceType: 'Patient',
            resource: '',
        };

        // OPERATE
        const response = await apiDataService.createResource(createResourceRequest);

        // CHECK
        expect(response.resource).toEqual(resource);
    });

    test('api returns with 400 error', async () => {
        // BUILD
        const message = 'Failed to parse request';
        const data = {
            message,
            resource: {},
        };
        mock.onPost(url).reply(400, data);

        const createResourceRequest: CreateResourceRequest = {
            resourceType: 'Patient',
            resource: '',
        };

        try {
            // OPERATE
            await apiDataService.createResource(createResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error(`An error was received from the Integration Transform: ${message}`));
        }
    });

    test('api returns with 500 error', async () => {
        // BUILD
        const message = 'Failed to parse request';
        const data = {
            message,
            resource: {},
        };
        mock.onPost(url).reply(500, data);

        const createResourceRequest: CreateResourceRequest = {
            resourceType: 'Patient',
            resource: '',
        };

        try {
            // OPERATE
            await apiDataService.createResource(createResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error(`An error was received from the Integration Transform: ${message}`));
        }
    });

    test('network error', async () => {
        // BUILD
        mock.onPost(url).networkError();

        const createResourceRequest: CreateResourceRequest = {
            resourceType: 'Patient',
            resource: '',
        };

        try {
            // OPERATE
            await apiDataService.createResource(createResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error('Failed to connect to the Integration Transform'));
        }
    });
});

describe('READ', () => {
    test('read resource successfully', async () => {
        // BUILD
        const data = {
            message: '',
            resource,
        };

        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onGet(`${url}/${id}`).reply(200, data);

        const readResourceRequest: ReadResourceRequest = {
            id,
            resourceType: 'Patient',
        };

        // OPERATE
        const response = await apiDataService.readResource(readResourceRequest);
        // CHECK
        expect(response.resource).toEqual(resource);
    });

    test('api returns with 404', async () => {
        // BUILD
        const message = 'Failed to find resource';
        const data = {
            message,
            resource: {},
        };
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onGet(`${url}/${id}`).reply(404, data);

        const resourceType = 'Patient';
        const readResourceRequest: ReadResourceRequest = {
            id,
            resourceType,
        };

        try {
            // OPERATE
            await apiDataService.readResource(readResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof ResourceNotFoundError).toBeTruthy();
            expect(e).toMatchObject(new ResourceNotFoundError(resourceType, id, message));
        }
    });

    test('api returns with 500', async () => {
        // BUILD
        const message = 'Failed to find resource';
        const data = {
            message,
            resource: {},
        };
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onGet(`${url}/${id}`).reply(500, data);

        const resourceType = 'Patient';
        const readResourceRequest: ReadResourceRequest = {
            id,
            resourceType,
        };

        try {
            // OPERATE
            await apiDataService.readResource(readResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error(`An error was received from the Integration Transform: ${message}`));
        }
    });

    test('network error', async () => {
        // BUILD
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onGet(`${url}/${id}`).networkError();

        const resourceType = 'Patient';
        const readResourceRequest: ReadResourceRequest = {
            id,
            resourceType,
        };

        try {
            // OPERATE
            await apiDataService.readResource(readResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error('Failed to connect to the Integration Transform'));
        }
    });
});

describe('UPDATE', () => {
    test('update resource successfully', async () => {
        // BUILD
        const data = {
            message: '',
            resource,
        };

        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onPut(`${url}/${id}`).reply(200, data);

        const updateResourceRequest: UpdateResourceRequest = {
            id,
            resourceType: 'Patient',
            resource,
        };

        // OPERATE
        const response = await apiDataService.updateResource(updateResourceRequest);
        // CHECK
        expect(response.resource).toEqual(resource);
    });

    test('api returns with 404 error', async () => {
        // BUILD
        const message = 'Failed to parse request';
        const data = {
            message,
            resource: {},
        };
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onPut(`${url}/${id}`).reply(404, data);

        const resourceType = 'Patient';
        const updateResourceRequest: UpdateResourceRequest = {
            id,
            resourceType,
            resource,
        };

        try {
            // OPERATE
            await apiDataService.updateResource(updateResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof ResourceNotFoundError).toBeTruthy();
            expect(e).toMatchObject(new ResourceNotFoundError(resourceType, id, message));
        }
    });

    test('api returns with 500 error', async () => {
        // BUILD
        const message = 'Failed to parse request';
        const data = {
            message,
            resource: {},
        };
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onPut(`${url}/${id}`).reply(500, data);

        const resourceType = 'Patient';
        const updateResourceRequest: UpdateResourceRequest = {
            id,
            resourceType,
            resource,
        };

        try {
            // OPERATE
            await apiDataService.updateResource(updateResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error(`An error was received from the Integration Transform: ${message}`));
        }
    });

    test('network error', async () => {
        // BUILD
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onPut(`${url}/${id}`).networkError();

        const resourceType = 'Patient';
        const updateResourceRequest: UpdateResourceRequest = {
            id,
            resourceType,
            resource,
        };

        try {
            // OPERATE
            await apiDataService.updateResource(updateResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error('Failed to connect to the Integration Transform'));
        }
    });
});

describe('DELETE', () => {
    test('delete resource successfully', async () => {
        // BUILD
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onDelete(`${url}/${id}`).reply(204);

        const deleteResourceRequest: DeleteResourceRequest = {
            id,
            resourceType: 'Patient',
        };

        // OPERATE
        const response = await apiDataService.deleteResource(deleteResourceRequest);
        // CHECK
        expect(response).toEqual({ message: '' });
    });

    test('api returns with 404 error', async () => {
        // BUILD
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        const message = 'Failed to find resource';
        const data = {
            message,
        };
        mock.onDelete(`${url}/${id}`).reply(404, data);

        const resourceType = 'Patient';
        const deleteResourceRequest: DeleteResourceRequest = {
            id,
            resourceType,
        };

        try {
            // OPERATE
            await apiDataService.deleteResource(deleteResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof ResourceNotFoundError).toBeTruthy();
            expect(e).toMatchObject(new ResourceNotFoundError(resourceType, id, message));
        }
    });

    test('api returns with 500 error', async () => {
        // BUILD
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        const message = 'Failed to find resource';
        const data = {
            message,
        };
        mock.onDelete(`${url}/${id}`).reply(500, data);

        const resourceType = 'Patient';
        const deleteResourceRequest: DeleteResourceRequest = {
            id,
            resourceType,
        };

        try {
            // OPERATE
            await apiDataService.deleteResource(deleteResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error(`An error was received from the Integration Transform: ${message}`));
        }
    });

    test('network error', async () => {
        // BUILD
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onDelete(`${url}/${id}`).networkError();

        const resourceType = 'Patient';
        const deleteResourceRequest: DeleteResourceRequest = {
            id,
            resourceType,
        };

        try {
            // OPERATE
            await apiDataService.deleteResource(deleteResourceRequest);
        } catch (e) {
            // CHECK
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error('Failed to connect to the Integration Transform'));
        }
    });
});
