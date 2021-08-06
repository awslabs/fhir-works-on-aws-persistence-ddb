import { Client } from '@elastic/elasticsearch';

import Mock from '@elastic/elasticsearch-mock';

import cloneDeep from 'lodash';
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
            process.env.ENABLE_ES_HARD_DELETE = 'true';
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
                                _tenantId: { index: true, type: 'keyword' },
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

    describe('isRemoveResource', () => {
        const record: any = {
            eventID: 'some-event-id',
            eventName: 'INSERT',
            dynamodb: {
                OldImage: { documentStatus: { S: 'AVAILABLE' } },
                NewImage: { documentStatus: { S: 'AVAILABLE' } },
            },
        };

        test('Should remove for REMOVE event', () => {
            const removeRecord: any = cloneDeep(record);
            removeRecord.eventName = 'REMOVE';
            expect(ddbToEsHelper.isRemoveResource(removeRecord)).toBeTruthy();
        });

        test('Should remove for new image in DELETED status and hard delete enabled', () => {
            process.env.ENABLE_ES_HARD_DELETE = 'true';
            const modifyRecord: any = cloneDeep(record);
            modifyRecord.eventName = 'MODIFY';
            modifyRecord.dynamodb = {
                OldImage: { documentStatus: { S: 'AVAILABLE' } },
                NewImage: { documentStatus: { S: 'DELETED' } },
            };
            expect(ddbToEsHelper.isRemoveResource(modifyRecord)).toBeTruthy();
        });

        test('Should NOT remove for new image in DELETED status and hard delete NOT enabled', () => {
            process.env.ENABLE_ES_HARD_DELETE = 'false';
            const modifyRecord: any = cloneDeep(record);
            modifyRecord.eventName = 'MODIFY';
            modifyRecord.dynamodb = {
                OldImage: { documentStatus: { S: 'AVAILABLE' } },
                NewImage: { documentStatus: { S: 'DELETED' } },
            };
            expect(ddbToEsHelper.isRemoveResource(modifyRecord)).toBeFalsy();
        });
    });
});
