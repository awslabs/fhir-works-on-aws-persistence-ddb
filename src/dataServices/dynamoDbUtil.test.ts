/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { clone } from 'fhir-works-on-aws-interface';
import { DOCUMENT_STATUS_FIELD, DynamoDbUtil, LOCK_END_TS_FIELD, REFERENCES_FIELD, VID_FIELD } from './dynamoDbUtil';
import DOCUMENT_STATUS from './documentStatus';
import { utcTimeRegExp } from '../../testUtilities/regExpressions';

describe('cleanItem', () => {
    const id = 'ee3928b9-8699-4970-ba49-8f41bd122f46';
    const vid = 2;

    test('Remove documentStatus field and format id correctly', () => {
        const item: any = {
            resourceType: 'Patient',
            id,
        };

        item[LOCK_END_TS_FIELD] = Date.now();
        item[DOCUMENT_STATUS_FIELD] = DOCUMENT_STATUS.AVAILABLE;
        item[VID_FIELD] = vid;
        item[REFERENCES_FIELD] = ['Organization/1', 'Patient/pat2'];

        const actualItem = DynamoDbUtil.cleanItem(item);

        expect(actualItem).toEqual({
            resourceType: 'Patient',
            id,
        });
    });

    test('Return item correctly if documentStatus, lockEndTs, and references is not in the item', () => {
        const item: any = {
            resourceType: 'Patient',
            id: `${id}_${vid}`,
        };

        item[VID_FIELD] = vid;

        const actualItem = DynamoDbUtil.cleanItem(item);

        expect(actualItem).toEqual({
            resourceType: 'Patient',
            id,
        });
    });
});

describe('prepItemForDdbInsert', () => {
    const id = '8cafa46d-08b4-4ee4-b51b-803e20ae8126';
    const vid = 1;
    const resource = {
        resourceType: 'Patient',
        id,
        name: [
            {
                family: 'Jameson',
                given: ['Matt'],
            },
        ],
        gender: 'male',
        meta: {
            lastUpdated: '2020-03-26T15:46:55.848Z',
            versionId: vid.toString(),
        },
    };

    const checkExpectedItemMatchActualItem = (actualItem: any, expectedResource: any, newVid: number) => {
        const expectedItem = clone(expectedResource);
        expectedItem[DOCUMENT_STATUS_FIELD] = DOCUMENT_STATUS.PENDING;
        expectedItem.id = id;
        expectedItem.vid = newVid;
        expectedItem.meta = {
            versionId: newVid.toString(),
            lastUpdated: expect.stringMatching(utcTimeRegExp),
        };
        expectedItem.lockEndTs = expect.any(Number);
        expect(actualItem).toEqual(expectedItem);
    };

    test('Return item correctly when resource to be prepped contains references', () => {
        const organization = 'Organization/1';
        const otherPatient = 'Patient/pat2';
        // BUILD
        const updatedResource = clone(resource);
        updatedResource.managingOrganization = {
            reference: organization,
        };
        updatedResource.link = [
            {
                other: {
                    reference: otherPatient,
                },
            },
        ];

        // OPERATE
        const actualItem = DynamoDbUtil.prepItemForDdbInsert(updatedResource, id, vid, DOCUMENT_STATUS.PENDING);

        // CHECK
        updatedResource.meta.versionId = vid.toString();
        updatedResource[REFERENCES_FIELD] = [organization, otherPatient];
        checkExpectedItemMatchActualItem(actualItem, updatedResource, vid);
    });

    test('Return item correctly when resource has "referenceSeq" as a field. Only resource fields named "reference" should be added to `_references`', () => {
        // BUILD
        const patient = 'Patient/pat1';
        const updatedResource: any = {
            resourceType: 'MolecularSequence',
            id,
            type: 'dna',
            coordinateSystem: 0,
            patient: {
                reference: patient,
            },
            referenceSeq: {
                referenceSeqId: {
                    coding: [
                        {
                            system: 'http://www.ncbi.nlm.nih.gov/nuccore',
                            code: 'NC_000009.11',
                        },
                    ],
                },
                strand: 'watson',
                windowStart: 22125500,
                windowEnd: 22125510,
            },
            meta: {
                lastUpdated: '2020-03-26T15:46:55.848Z',
                versionId: vid.toString(),
            },
        };

        // OPERATE
        const actualItem = DynamoDbUtil.prepItemForDdbInsert(updatedResource, id, vid, DOCUMENT_STATUS.PENDING);

        // CHECK
        updatedResource[REFERENCES_FIELD] = [patient];
        checkExpectedItemMatchActualItem(actualItem, updatedResource, vid);
    });

    test('Return item correctly when full meta field already exists', () => {
        // BUILD
        const updatedResource = clone(resource);

        // OPERATE
        const actualItem = DynamoDbUtil.prepItemForDdbInsert(updatedResource, id, vid, DOCUMENT_STATUS.PENDING);

        // CHECK
        updatedResource.meta.versionId = vid.toString();
        updatedResource[REFERENCES_FIELD] = [];
        checkExpectedItemMatchActualItem(actualItem, updatedResource, vid);
    });

    test('Return item correctly when meta field does not exist yet', () => {
        // BUILD
        const updatedResource = clone(resource);
        delete updatedResource.meta;

        // OPERATE
        const actualItem = DynamoDbUtil.prepItemForDdbInsert(updatedResource, id, vid, DOCUMENT_STATUS.PENDING);

        // CHECK
        updatedResource[REFERENCES_FIELD] = [];
        checkExpectedItemMatchActualItem(actualItem, updatedResource, vid);
    });

    test('Return item correctly when meta field exist but meta does not contain versionId', () => {
        // BUILD
        const updatedResource = clone(resource);
        delete updatedResource.meta.versionId;

        // OPERATE
        const actualItem = DynamoDbUtil.prepItemForDdbInsert(updatedResource, id, vid, DOCUMENT_STATUS.PENDING);

        // CHECK
        updatedResource[REFERENCES_FIELD] = [];
        checkExpectedItemMatchActualItem(actualItem, updatedResource, vid);
    });

    test('Return item correctly when meta field exist with versionId', () => {
        // BUILD
        // We set a new vid, that 'prepItemForDdbInsert' should use even though the existing resource already contains
        // versionId as a part of the 'meta' object. versionId should be system generated
        const newVid = 3;

        // OPERATE
        const actualItem = DynamoDbUtil.prepItemForDdbInsert(clone(resource), id, newVid, DOCUMENT_STATUS.PENDING);

        // CHECK
        const expectedResource = clone(resource);
        expectedResource[REFERENCES_FIELD] = [];

        checkExpectedItemMatchActualItem(actualItem, expectedResource, newVid);
    });
});
