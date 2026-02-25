import { desc, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index.js';
import { importJobs } from '$lib/server/db/schema.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const jobs = await db
    .select({
      id: importJobs.id,
      fileName: importJobs.fileName,
      status: importJobs.status,
      progress: importJobs.progress,
      errorMessage: importJobs.errorMessage,
      createdAt: importJobs.createdAt,
    })
    .from(importJobs)
    .orderBy(desc(importJobs.createdAt))
    .limit(100);

  const statusCounts = await db
    .select({
      status: importJobs.status,
      count: sql<number>`count(*)`,
    })
    .from(importJobs)
    .groupBy(importJobs.status);

  const counts: Record<string, number> = {};
  for (const row of statusCounts) {
    counts[row.status] = Number(row.count);
  }

  return { jobs, counts };
};
