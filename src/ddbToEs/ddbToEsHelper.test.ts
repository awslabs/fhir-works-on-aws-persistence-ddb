import { Client } from '@elastic/elasticsearch';

import Mock from '@elastic/elasticsearch-mock';

import DdbToEsHelper from './ddbToEsHelper';
import ESBulkCommand from './promiseParamAndId';

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
                        aliases: { 'patient-alias': {} },
                        mappings: {
                            properties: {
                                _references: { index: true, type: 'keyword' },
                                documentStatus: { index: true, type: 'keyword' },
                                id: { index: true, type: 'keyword' },
                                resourceType: { index: true, type: 'keyword' },
                            },
                        },
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

    describe('createBulkESDelete', () => {
        // BUILD
        const resourceType = 'Patient';
        const id = '1234';
        const vid = 5;
        const compositeId = `${id}_${vid}`;

        const ddbImage = {
            resourceType,
            id,
            vid,
            documentStatus: 'AVAILABLE',
        };

        // TEST
        const result: ESBulkCommand = ddbToEsHelper.createBulkESDelete(ddbImage);
        // VALIDATE
        const expectedOutput: ESBulkCommand = {
            id: compositeId,
            type: 'delete',
            bulkCommand: [
                {
                    delete: { _index: `${resourceType.toLowerCase()}-alias`, _id: compositeId },
                },
            ],
        };
        expect(result).toStrictEqual(expectedOutput);
    });

    describe('getUpsertRecordPromiseParam', () => {
        const resourceType = 'Patient';
        const id = '1234';
        const vid = 5;
        const compositeId = `${id}_${vid}`;

        const ddbImage = {
            resourceType,
            id,
            vid,
        };
        test('document status is AVAILABLE', async () => {
            // BUILD
            const ddbImageCopy = { ...ddbImage, documentStatus: 'AVAILABLE' };

            // TEST
            const result: ESBulkCommand | null = ddbToEsHelper.getUpsertRecordPromiseParam(ddbImageCopy);
            // VALIDATE
            const expectedOutput: ESBulkCommand = {
                id: compositeId,
                type: 'upsert-AVAILABLE',
                bulkCommand: [
                    { update: { _index: `${resourceType.toLowerCase()}-alias`, _id: compositeId } },
                    { doc: ddbImageCopy, doc_as_upsert: true },
                ],
            };
            expect(result).toStrictEqual(expectedOutput);
        });
        test('document status is DELETED', async () => {
            // BUILD
            const ddbImageCopy = { ...ddbImage, documentStatus: 'DELETED' };

            // TEST
            const result: ESBulkCommand | null = ddbToEsHelper.getUpsertRecordPromiseParam(ddbImageCopy);
            // VALIDATE
            const expectedOutput: ESBulkCommand = {
                id: compositeId,
                type: 'upsert-DELETED',
                bulkCommand: [
                    { update: { _index: `${resourceType.toLowerCase()}-alias`, _id: compositeId } },
                    { doc: ddbImageCopy, doc_as_upsert: true },
                ],
            };
            expect(result).toStrictEqual(expectedOutput);
        });
        test('document status is PENDING', async () => {
            // BUILD
            const ddbImageCopy = { ...ddbImage, documentStatus: 'PENDING' };

            // TEST
            const result: ESBulkCommand | null = ddbToEsHelper.getUpsertRecordPromiseParam(ddbImageCopy);
            // VALIDATE
            expect(result).toBeNull();
        });
        test('document status is LOCKED', async () => {
            // BUILD
            const ddbImageCopy = { ...ddbImage, documentStatus: 'LOCKED' };

            // TEST
            const result: ESBulkCommand | null = ddbToEsHelper.getUpsertRecordPromiseParam(ddbImageCopy);
            // VALIDATE
            expect(result).toBeNull();
        });
    });
});
