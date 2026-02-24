import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { PageServerLoad } from './$types';

const UPLOAD_DIR = process.env['UPLOAD_DIR'] ?? 'uploads';

async function getDirectoryStats(dir: string): Promise<{ totalBytes: number; fileCount: number }> {
  let totalBytes = 0;
  let fileCount = 0;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile()) {
        const s = await stat(fullPath);
        totalBytes += s.size;
        fileCount++;
      } else if (entry.isDirectory()) {
        const sub = await getDirectoryStats(fullPath);
        totalBytes += sub.totalBytes;
        fileCount += sub.fileCount;
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  return { totalBytes, fileCount };
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
    totalBytes: stats.totalBytes,
    totalFormatted: formatBytes(stats.totalBytes),
    fileCount: stats.fileCount,
  };
};
