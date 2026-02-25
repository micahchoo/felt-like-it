import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { PageServerLoad } from './$types';

const UPLOAD_DIR = process.env['UPLOAD_DIR'] ?? 'uploads';

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
    // Directory doesn't exist or isn't readable
    return { totalBytes: 0, fileCount: 0 };
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export const load: PageServerLoad = async () => {
  const stats = await getDirectoryStats(UPLOAD_DIR);
  return {
    uploadDir: UPLOAD_DIR,
    totalFormatted: formatBytes(stats.totalBytes),
    fileCount: stats.fileCount,
  };
};
