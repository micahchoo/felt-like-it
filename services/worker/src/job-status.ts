import { sql } from 'drizzle-orm';
import { db } from './db.js';

export async function updateJobStatus(
  jobId: string,
  status: 'processing' | 'done' | 'failed',
  progress: number
): Promise<void> {
  await db.execute(sql`
    UPDATE import_jobs
    SET status = ${status}, progress = ${progress}, updated_at = NOW()
    WHERE id = ${jobId}
  `);
}
