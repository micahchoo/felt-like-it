import { Queue } from 'bullmq';
import { createRedisConnection } from './connection.js';
import type { ImportJobPayload } from '@felt-like-it/shared-types';

// Lazily created queue instance
let _importQueue: Queue<ImportJobPayload> | null = null;

export function getImportQueue(): Queue<ImportJobPayload> {
  if (!_importQueue) {
    _importQueue = new Queue<ImportJobPayload>('file-import', {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return _importQueue;
}

export async function enqueueImportJob(payload: ImportJobPayload): Promise<string> {
  const queue = getImportQueue();
  const job = await queue.add('import', payload, { jobId: payload.jobId });
  return job.id ?? payload.jobId;
}
