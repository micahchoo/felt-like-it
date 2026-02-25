// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * Tests the safeRedirect logic used in login/+page.server.ts.
 * The function rejects absolute URLs and protocol-relative redirects.
 */
function safeRedirect(url: URL): string {
  const target = url.searchParams.get('redirect');
  if (!target || !target.startsWith('/') || target.startsWith('//')) return '/dashboard';
  return target;
}

describe('safeRedirect', () => {
  it('allows relative paths', () => {
    expect(safeRedirect(new URL('http://localhost/login?redirect=/map/123'))).toBe('/map/123');
  });

  it('rejects absolute URLs', () => {
    expect(safeRedirect(new URL('http://localhost/login?redirect=https://evil.com'))).toBe('/dashboard');
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeRedirect(new URL('http://localhost/login?redirect=//evil.com'))).toBe('/dashboard');
  });

  it('defaults to /dashboard when no redirect param', () => {
    expect(safeRedirect(new URL('http://localhost/login'))).toBe('/dashboard');
  });

  it('defaults to /dashboard for empty redirect', () => {
    expect(safeRedirect(new URL('http://localhost/login?redirect='))).toBe('/dashboard');
  });
});
