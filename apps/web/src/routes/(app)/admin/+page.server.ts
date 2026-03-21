import { desc } from 'drizzle-orm';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { db } from '$lib/server/db/index.js';
import { users, importJobs, auditLog } from '$lib/server/db/schema.js';
import type { PageServerLoad } from './$types';

const UPLOAD_DIR = process.env['UPLOAD_DIR'] ?? 'uploads';
const UPLOAD_VOLUME_MAX = 1_073_741_824; // 1 GiB

async function getDirectoryStats(dir: string): Promise<{ totalBytes: number; fileCount: number }> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		const results = await Promise.all(
			entries.map(async (entry) => {
				const fullPath = join(dir, entry.name);
				if (entry.isFile()) {
					const s = await stat(fullPath);
					return { totalBytes: s.size, fileCount: 1 };
				} else if (entry.isDirectory()) {
					return getDirectoryStats(fullPath);
				}
				return { totalBytes: 0, fileCount: 0 };
			})
		);
		return results.reduce(
			(acc, r) => ({ totalBytes: acc.totalBytes + r.totalBytes, fileCount: acc.fileCount + r.fileCount }),
			{ totalBytes: 0, fileCount: 0 }
		);
	} catch {
		return { totalBytes: 0, fileCount: 0 };
	}
}

export const load: PageServerLoad = async () => {
	const [userList, jobList, auditEntries, storageStats] = await Promise.all([
		db
			.select({
				id: users.id,
				email: users.email,
				name: users.name,
				isAdmin: users.isAdmin,
				createdAt: users.createdAt,
				disabledAt: users.disabledAt,
			})
			.from(users)
			.orderBy(desc(users.createdAt)),

		db
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
			.limit(100),

		db
			.select({
				id: auditLog.seq,
				action: auditLog.action,
				userId: auditLog.userId,
				entityType: auditLog.entityType,
				entityId: auditLog.entityId,
				mapId: auditLog.mapId,
				metadata: auditLog.metadata,
				createdAt: auditLog.createdAt,
			})
			.from(auditLog)
			.orderBy(desc(auditLog.seq))
			.limit(200),

		getDirectoryStats(UPLOAD_DIR),
	]);

	return {
		users: userList,
		importJobs: jobList,
		auditLog: auditEntries,
		storageStats: {
			uploadVolumeBytes: storageStats.totalBytes,
			uploadVolumeMax: UPLOAD_VOLUME_MAX,
			totalFeatures: 0,
			totalLayers: 0,
			totalMaps: 0,
		},
	};
};
