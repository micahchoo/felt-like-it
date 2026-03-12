import { basename } from 'path';

/**
 * Sanitize a user-supplied filename to prevent path traversal.
 * Strips directory components (including Windows backslash paths), replaces unsafe characters.
 */
export function sanitizeFilename(name: string): string {
  // Normalize Windows backslash separators before extracting basename
  const normalized = name.replace(/\\/g, '/');
  const base = basename(normalized);
  // Replace unsafe chars; also replace dots in pure-dot names (path traversal sentinels like "..")
  const safe = /^\.+$/.test(base)
    ? base.replace(/\./g, '_')
    : base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'upload';
}
