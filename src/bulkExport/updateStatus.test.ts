import * as AWSMock from 'aws-sdk-mock';
import AWS from 'aws-sdk';
import { updateStatusStatusHandler } from './updateStatus';

AWSMock.setSDKInstance(AWS);

describe('updateStatus', () => {
    beforeEach(() => {
        process.env.GLUE_JOB_NAME = 'jobName';
        AWSMock.restore();
    });

    test('valid status', async () => {
        AWSMock.mock('DynamoDB', 'updateItem', (params: any, callback: Function) => {
            callback(null);
        });
        await expect(
            updateStatusStatusHandler({ jobId: '1', status: 'completed' }, null as any, null as any),
        ).resolves.toBeUndefined();
    });

    test('invalid status', async () => {
        await expect(
            updateStatusStatusHandler({ jobId: '1', status: 'not-a-valid-status' }, null as any, null as any),
        ).rejects.toThrowError('Invalid status "not-a-valid-status"');
    });
});
