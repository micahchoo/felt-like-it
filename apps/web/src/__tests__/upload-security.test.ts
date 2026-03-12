import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '$lib/server/import/sanitize.js';

describe('sanitizeFilename', () => {
  it('strips directory traversal sequences', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
  });

  it('strips path separators', () => {
    expect(sanitizeFilename('../../../app/server.ts')).toBe('server.ts');
  });

  it('replaces special characters with underscores', () => {
    expect(sanitizeFilename('my file (1).geojson')).toBe('my_file__1_.geojson');
  });

  it('replaces pure-dot names with underscores', () => {
    expect(sanitizeFilename('...')).toBe('___');
  });

  it('falls back to "upload" for empty filename', () => {
    expect(sanitizeFilename('')).toBe('upload');
  });

  it('preserves normal filenames', () => {
    expect(sanitizeFilename('data.geojson')).toBe('data.geojson');
  });

  it('handles Windows path separators', () => {
    expect(sanitizeFilename('C:\\Users\\evil\\payload.zip')).toBe('payload.zip');
  });
});
