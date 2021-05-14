/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { clone, generateMeta } from 'fhir-works-on-aws-interface';
import flatten from 'flat';
import _ from 'lodash';
import { SEPARATOR } from '../constants';
import DOCUMENT_STATUS from './documentStatus';

export const DOCUMENT_STATUS_FIELD = 'documentStatus';
export const LOCK_END_TS_FIELD = 'lockEndTs';
export const VID_FIELD = 'vid';
export const REFERENCES_FIELD = '_references';
export const TTL_IN_SECONDS = 'ttlInSeconds';

export class DynamoDbUtil {
    static cleanItem(item: any) {
        const cleanedItem = clone(item);

        delete cleanedItem[DOCUMENT_STATUS_FIELD];
        delete cleanedItem[LOCK_END_TS_FIELD];
        delete cleanedItem[VID_FIELD];
        delete cleanedItem[REFERENCES_FIELD];
        delete cleanedItem[TTL_IN_SECONDS];

        // Return id instead of full id (this is only a concern in results from ES)
        const id = item.id.split(SEPARATOR)[0];
        cleanedItem.id = id;

        return cleanedItem;
    }

    static prepItemForDdbInsert(
        resource: any,
        id: string,
        vid: number,
        documentStatus: DOCUMENT_STATUS,
        ttlInSeconds?: number,
    ) {
        const item = clone(resource);
        item.id = id;
        item.vid = vid;
        if (!_.isUndefined(ttlInSeconds)) {
            const unixNow: number = Math.floor(Date.now() / 1000);
            item[TTL_IN_SECONDS] = unixNow + ttlInSeconds;
        }

        // versionId and lastUpdated for meta object should be system generated
        const { versionId, lastUpdated } = generateMeta(vid.toString());
        if (!item.meta) {
            item.meta = { versionId, lastUpdated };
        } else {
            item.meta = { ...item.meta, versionId, lastUpdated };
        }

        item[DOCUMENT_STATUS_FIELD] = documentStatus;
        item[LOCK_END_TS_FIELD] = Date.now();

        // Format of flattenedResource
        // https://www.npmjs.com/package/flat
        // flatten({ key1: { keyA: 'valueI' } })  => { key1.keyA: 'valueI'}
        const flattenedResources: Record<string, string> = flatten(resource);
        const references = Object.keys(flattenedResources)
            .filter((key: string) => {
                return key.endsWith('.reference');
            })
            .map((key: string) => {
                return flattenedResources[key];
            });
        item[REFERENCES_FIELD] = references;
        return item;
    }
}
