import { createRateLimiter } from '$lib/server/rate-limit.js';

/**
 * Allowed characters for share tokens, 32–64 chars. Short tokens are a
 * dictionary-attack surface; characters outside this class are not emitted
 * by the token generator, so rejecting them early cuts DB load from
 * malformed probes. See docs/testing/adversarial-findings.md#h2.
 */
export const SHARE_TOKEN_REGEX = /^[A-Za-z0-9_-]{32,64}$/;

/**
 * Redis-backed IP rate limiter for the share-token path.
 *
 * Chosen shape (10 per 60 s) balances real users opening the same share in
 * tabs/refresh against dictionary-attack rates. Keyed by remote IP — per-token
 * counters don't help the attack model because the attacker rotates tokens.
 *
 * On Redis failure this fails open (see rate-limit.ts); acceptable because the
 * alternative is denying legitimate share viewers during a Redis outage.
 */
export const shareTokenLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  scope: 'share-token',
});

export function isValidShareTokenFormat(token: string): boolean {
  return SHARE_TOKEN_REGEX.test(token);
}
