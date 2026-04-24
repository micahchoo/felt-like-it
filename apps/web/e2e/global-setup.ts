import { execSync } from 'node:child_process';

/**
 * Runs once before any Playwright test.
 *
 * Resets the two-tenant fixture (alice + bob + their maps/layers/features/
 * shares/api keys) via `pnpm seed:reset`, invoked at repo root. Requires
 * postgres to be reachable at DATABASE_URL (typically via `pnpm dev:up`).
 *
 * The webServer itself has no fixture dependency at startup, so resetting
 * here — after webServer is ready, before the first test — is safe.
 */
export default async function globalSetup(): Promise<void> {
  // Resolve the repo root from this file: apps/web/e2e → apps/web → repo root.
  const repoRoot = new URL('../../..', import.meta.url).pathname;
  console.log('[e2e] Resetting adversarial fixtures via pnpm seed:reset…');
  execSync('pnpm seed:reset', { cwd: repoRoot, stdio: 'inherit' });
  console.log('[e2e] Fixture reset complete.');
}
