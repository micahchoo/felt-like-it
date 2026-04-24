/**
 * Deterministic test fixture IDs and credentials.
 *
 * Imported by:
 *   - scripts/seed.ts (creates the rows)
 *   - apps/web/e2e/** (asserts against the rows)
 *
 * Do not randomise — adversarial probes reference these values by literal UUID.
 */

export const FIXTURE_USERS = {
  alice: {
    id: '11111111-aaaa-4aaa-aaaa-111111111111',
    email: 'alice@felt-like-it.local',
    password: 'alice-password-1',
    name: 'Alice Fixture',
  },
  bob: {
    id: '22222222-bbbb-4bbb-bbbb-222222222222',
    email: 'bob@felt-like-it.local',
    password: 'bob-password-1',
    name: 'Bob Fixture',
  },
} as const;

export const FIXTURE_MAPS = {
  aliceMap: '33333333-aaaa-4aaa-aaaa-333333333333',
  bobMap: '44444444-bbbb-4bbb-bbbb-444444444444',
} as const;

export const FIXTURE_LAYERS = {
  aliceLayer: '55555555-aaaa-4aaa-aaaa-555555555555',
  bobLayer: '66666666-bbbb-4bbb-bbbb-666666666666',
} as const;

/**
 * Read-only share token on bobMap. Probes use this to hit share-scoped
 * endpoints. Length 32+ to satisfy the share-token format regex (see
 * `lib/server/auth/share-token.ts`).
 */
export const FIXTURE_SHARE_TOKEN_BOB = 'fixture-share-bob-unlisted-abcdef01234567';

/**
 * Plaintext API keys — the `/api/v1/*` surface authenticates via
 * `Authorization: Bearer flk_...` OR `?token=<share-token>`. Session cookies
 * are NOT honored for the API, so the harness uses these keys directly.
 *
 * Format: `flk_` + 64 hex chars (matches hooks.server.ts:18 — `Bearer flk_` detection).
 * The DB stores sha256(plaintext) as `key_hash`; tests and the seed script
 * both derive the hash from these constants.
 *
 * All fixture keys are write-scoped so probes can exercise POST/PATCH/DELETE.
 * Read-only authz is covered by the share-token path.
 */
export const FIXTURE_API_KEY_ALICE_PLAINTEXT =
  'flk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const FIXTURE_API_KEY_BOB_PLAINTEXT =
  'flk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

export const FIXTURE_API_KEY_ALICE_PREFIX = FIXTURE_API_KEY_ALICE_PLAINTEXT.slice(0, 12);
export const FIXTURE_API_KEY_BOB_PREFIX = FIXTURE_API_KEY_BOB_PLAINTEXT.slice(0, 12);
