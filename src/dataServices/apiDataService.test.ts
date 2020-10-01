import axios from 'axios';
// eslint-disable-next-line import/no-extraneous-dependencies
import MockAdapter from 'axios-mock-adapter';
import {
    CreateResourceRequest,
    DeleteResourceRequest,
    InvalidResourceError,
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

const apiDataService = new ApiDataService();
const mock = new MockAdapter(axios);
afterEach(() => {
    mock.reset();
});
expect.hasAssertions();

const url = `${ApiDataService.INTEGRATION_TRANSFORM_URL}/Patient`;
describe('CREATE', () => {
    test('create resource successfully', async () => {
        const data = {
            message: '',
            resource,
        };
        mock.onPost(url).reply(201, data);

        const createResourceRequest: CreateResourceRequest = {
            resourceType: 'Patient',
            resource: '',
        };

        const response = await apiDataService.createResource(createResourceRequest);
        expect(response.resource).toEqual(resource);
    });

    test('api returns with 400 error', async () => {
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
            await apiDataService.createResource(createResourceRequest);
        } catch (e) {
            expect(e instanceof InvalidResourceError).toBeTruthy();
            expect(e).toMatchObject(new InvalidResourceError(message));
        }
    });

    test('api returns with 500 error', async () => {
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
            await apiDataService.createResource(createResourceRequest);
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error(message));
        }
    });

    test('network error', async () => {
        mock.onPost(url).networkError();

        const createResourceRequest: CreateResourceRequest = {
            resourceType: 'Patient',
            resource: '',
        };

        try {
            await apiDataService.createResource(createResourceRequest);
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error('Failed to connect to Integration Transform URL'));
        }
    });
});

describe('READ', () => {
    test('read resource successfully', async () => {
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

        const response = await apiDataService.readResource(readResourceRequest);
        expect(response.resource).toEqual(resource);
    });

    test('api returns with 404', async () => {
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
            await apiDataService.readResource(readResourceRequest);
        } catch (e) {
            expect(e instanceof ResourceNotFoundError).toBeTruthy();
            expect(e).toMatchObject(new ResourceNotFoundError(resourceType, id, message));
        }
    });

    test('api returns with 500', async () => {
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
            await apiDataService.readResource(readResourceRequest);
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error(message));
        }
    });

    test('network error', async () => {
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onGet(`${url}/${id}`).networkError();

        const resourceType = 'Patient';
        const readResourceRequest: ReadResourceRequest = {
            id,
            resourceType,
        };

        try {
            await apiDataService.readResource(readResourceRequest);
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error('Failed to connect to Integration Transform URL'));
        }
    });
});

describe('UPDATE', () => {
    test('update resource successfully', async () => {
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

        const response = await apiDataService.updateResource(updateResourceRequest);
        expect(response.resource).toEqual(resource);
    });

    test('api returns with 404 error', async () => {
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
            await apiDataService.updateResource(updateResourceRequest);
        } catch (e) {
            expect(e instanceof ResourceNotFoundError).toBeTruthy();
            expect(e).toMatchObject(new ResourceNotFoundError(resourceType, id, message));
        }
    });

    test('api returns with 500 error', async () => {
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
            await apiDataService.updateResource(updateResourceRequest);
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error(message));
        }
    });

    test('network error', async () => {
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onPut(`${url}/${id}`).networkError();

        const resourceType = 'Patient';
        const updateResourceRequest: UpdateResourceRequest = {
            id,
            resourceType,
            resource,
        };

        try {
            await apiDataService.updateResource(updateResourceRequest);
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error('Failed to connect to Integration Transform URL'));
        }
    });
});

describe('DELETE', () => {
    test('delete resource successfully', async () => {
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onDelete(`${url}/${id}`).reply(204);

        const deleteResourceRequest: DeleteResourceRequest = {
            id,
            resourceType: 'Patient',
        };

        const response = await apiDataService.deleteResource(deleteResourceRequest);
        expect(response).toEqual({ resource: {}, message: '' });
    });

    test('api returns with 404 error', async () => {
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
            await apiDataService.deleteResource(deleteResourceRequest);
        } catch (e) {
            expect(e instanceof ResourceNotFoundError).toBeTruthy();
            expect(e).toMatchObject(new ResourceNotFoundError(resourceType, id, message));
        }
    });

    test('api returns with 500 error', async () => {
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
            await apiDataService.deleteResource(deleteResourceRequest);
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error(message));
        }
    });

    test('network error', async () => {
        const id = 'f2ddf33c-9344-49cd-991f-8273eb959f92';
        mock.onDelete(`${url}/${id}`).networkError();

        const resourceType = 'Patient';
        const deleteResourceRequest: DeleteResourceRequest = {
            id,
            resourceType,
        };

        try {
            await apiDataService.deleteResource(deleteResourceRequest);
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
            expect(e).toMatchObject(new Error('Failed to connect to Integration Transform URL'));
        }
    });
});
