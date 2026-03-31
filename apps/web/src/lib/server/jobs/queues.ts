import { Queue } from 'bullmq';
import { createRedisConnection } from './connection.js';
import type { ImportJobPayload, GeoprocessingJobPayload } from '@felt-like-it/shared-types';

// ─── Import queue ────────────────────────────────────────────────────────────

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

// ─── Geoprocessing queue ─────────────────────────────────────────────────────

let _geoprocessingQueue: Queue<GeoprocessingJobPayload> | null = null;

export function getGeoprocessingQueue(): Queue<GeoprocessingJobPayload> {
  if (!_geoprocessingQueue) {
    _geoprocessingQueue = new Queue<GeoprocessingJobPayload>('geoprocessing', {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    });
  }
  return _geoprocessingQueue;
}

export async function enqueueGeoprocessingJob(payload: GeoprocessingJobPayload): Promise<string> {
  const queue = getGeoprocessingQueue();
  const job = await queue.add('geoprocessing', payload, { jobId: payload.jobId });
  return job.id ?? payload.jobId;
}
