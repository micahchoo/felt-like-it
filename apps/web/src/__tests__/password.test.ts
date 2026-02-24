// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/server/auth/password.js';

describe('hashPassword', () => {
  it('returns an argon2id hash string', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('includes the configured cost parameters', async () => {
    const hash = await hashPassword('test');
    // m=19456 (19 MiB), t=2, p=1
    expect(hash).toContain('m=19456,t=2,p=1');
  });

  it('produces unique hashes for the same input (salting)', async () => {
    const h1 = await hashPassword('duplicate');
    const h2 = await hashPassword('duplicate');
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPassword', () => {
  it('returns true when the password matches the hash', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword(hash, 'correct-password')).toBe(true);
  });

  it('returns false when the password does not match', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('returns false (not throw) for a completely invalid hash string', async () => {
    // The try/catch in verifyPassword should swallow errors from malformed hashes
    const result = await verifyPassword('not-a-valid-hash-at-all', 'password');
    expect(result).toBe(false);
  });

  it('returns false for an empty password against a real hash', async () => {
    const hash = await hashPassword('non-empty');
    expect(await verifyPassword(hash, '')).toBe(false);
  });
});
