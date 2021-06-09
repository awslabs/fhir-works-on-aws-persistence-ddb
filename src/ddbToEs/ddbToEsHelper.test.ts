import { Client } from '@elastic/elasticsearch';

import Mock from '@elastic/elasticsearch-mock';

import DdbToEsHelper from './ddbToEsHelper';

const ddbToEsHelper = new DdbToEsHelper();

describe('DdbToEsHelper', () => {
    let esMock: Mock;
    beforeEach(() => {
        esMock = new Mock();
        ddbToEsHelper.ElasticSearch = new Client({
            node: 'https://fake-es-endpoint.com',
            Connection: esMock.getConnection(),
        });
    });
    afterEach(() => {
        esMock.clearAll();
    });

    describe('createIndexIfNotExist', () => {
        test('Create index and alias for new index', async () => {
            // BUILD
            // esMock throws 404 for unmocked method, so there's no need to mock HEAD /patient here
            const mockAddIndex = jest.fn(() => {
                return { statusCode: 200 };
            });
            esMock.add(
                {
                    method: 'PUT',
                    // path: '/patient/_alias/patient-alias',
                    path: '/patient',
                },
                mockAddIndex,
            );
            // TEST
            await ddbToEsHelper.createIndexAndAliasIfNotExist('patient');
            // VALIDATE
            expect(mockAddIndex).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: {
                        mappings: {
                            properties: {
                                _references: { index: true, type: 'keyword' },
                                documentStatus: { index: true, type: 'keyword' },
                                id: { index: true, type: 'keyword' },
                                resourceType: { index: true, type: 'keyword' },
                            },
                        },
                        'patient-alias': {},
                    },
                    method: 'PUT',
                    path: '/patient',
                    querystring: {},
                }),
            );
        });

        test('Create alias for existing index', async () => {
            // BUILD
            // esMock throws 404 for unmocked method, so there's no need to mock HEAD /patient/_alias/patient-alias here
            esMock.add({ method: 'HEAD', path: '/patient' }, () => {
                return {
                    headers: {
                        date: 'Mon, 07 Jun 2021 17:47:31 GMT',
                        connection: 'keep-alive',
                        'access-control-allow-origin': '*',
                    },
                };
            });
            const mockAddAlias = jest.fn(() => {
                return { status: 'ok' };
            });
            esMock.add(
                {
                    method: 'PUT',
                    path: '/patient/_alias/patient-alias',
                },
                mockAddAlias,
            );
            // TEST
            await ddbToEsHelper.createIndexAndAliasIfNotExist('patient');
            // VALIDATE
            expect(mockAddAlias).toHaveBeenCalledWith(
                expect.objectContaining({ path: '/patient/_alias/patient-alias' }),
            );
        });
    });
});
