import type { PageServerLoad } from './$types';
import { isValidShareTokenFormat, shareTokenLimiter } from '$lib/server/auth/share-token.js';
import { resolveShareToken } from '$lib/server/auth/resolve-share-token.js';

export const load: PageServerLoad = async ({ params, getClientAddress }) => {
  const { token } = params;

  // H2/L1: reject malformed tokens without touching the DB, and rate-limit
  // brute-force attempts per IP. Format check + rate-limit stay at the
  // call site because they depend on caller context (IP); the DB chain
  // (share → map → layers) lives in resolveShareToken.
  if (!isValidShareTokenFormat(token)) {
    return { error: 'not_found' as const };
  }
  const allowed = await shareTokenLimiter.check(getClientAddress());
  if (!allowed) {
    return { error: 'not_found' as const };
  }

  const result = await resolveShareToken(token);
  if (result.kind === 'not_found') {
    return { error: 'not_found' as const };
  }
  if (result.kind === 'expired') {
    // Surface a distinct error so the UI can show "this link has expired"
    // instead of "not found." Owner can issue a new link via the dashboard.
    return { error: 'expired' as const, expiredAt: result.expiredAt.toISOString() };
  }

  return {
    map: {
      id: result.map.id,
      title: result.map.title,
      viewport: result.map.viewport,
      basemap: result.map.basemap,
    },
    layers: result.layers,
    share: { token: result.share.token, accessLevel: result.share.accessLevel },
  };
};
