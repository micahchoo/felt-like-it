import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../sanitize.js';

describe('sanitizeFilename', () => {
  it('passes through safe filenames', () => {
    expect(sanitizeFilename('data.geojson')).toBe('data.geojson');
    expect(sanitizeFilename('my-file_v2.csv')).toBe('my-file_v2.csv');
  });

  it('strips directory components', () => {
    expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('../../secret.txt')).toBe('secret.txt');
  });

  it('strips Windows backslash paths', () => {
    expect(sanitizeFilename('C:\\Users\\test\\file.csv')).toBe('file.csv');
  });

  it('replaces unsafe characters', () => {
    expect(sanitizeFilename('hello world!.csv')).toBe('hello_world_.csv');
    expect(sanitizeFilename('file<>|.txt')).toBe('file___.txt');
  });

  it('handles path traversal dot names', () => {
    expect(sanitizeFilename('..')).toBe('__');
    expect(sanitizeFilename('.')).toBe('_');
    expect(sanitizeFilename('...')).toBe('___');
  });

  it('returns "upload" for empty result', () => {
    expect(sanitizeFilename('')).toBe('upload');
  });
});
