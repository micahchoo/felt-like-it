import { pool } from './db.js';
import { logger } from './logger.js';

const STALE_JOB_INTERVAL_MS = 60 * 60 * 1_000; // 1 hour

async function reapStaleJobs(): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE import_jobs
       SET status = 'failed', error_message = 'Timed out: worker did not complete within 1 hour', updated_at = NOW()
       WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '1 hour'`
    );
    if ((result.rowCount ?? 0) > 0) {
      logger.info({ count: result.rowCount }, 'reaped stale jobs');
    }
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'stale job reaper failed');
  }
}

// Run once at startup (catches leftovers from previous crash), then hourly
void reapStaleJobs();
export const staleJobTimer = setInterval(reapStaleJobs, STALE_JOB_INTERVAL_MS);
