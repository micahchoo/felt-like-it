import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { lucia } from '$lib/server/auth/index.js';
import { db, apiKeys, users } from '$lib/server/db/index.js';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import type { User } from 'lucia';

export const handle: Handle = async ({ event, resolve }) => {
  const start = Date.now();
  const { method } = event.request;
  const path = event.url.pathname;

  // ── API key (Bearer) auth — takes priority over session cookie ────────────
  const authHeader = event.request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer flk_')) {
    const rawKey = authHeader.slice(7); // strip "Bearer "
    const hash = createHash('sha256').update(rawKey).digest('hex');

    const [keyRow] = await db
      .select({ id: apiKeys.id, userId: apiKeys.userId })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hash));

    if (keyRow) {
      const [userRow] = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, keyRow.userId));

      if (userRow) {
        event.locals.user = userRow as unknown as User;
        event.locals.session = null;
        // Fire-and-forget: update last_used_at without blocking the request
        void db
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, keyRow.id));
      } else {
        event.locals.user = null;
        event.locals.session = null;
      }
    } else {
      event.locals.user = null;
      event.locals.session = null;
    }
  } else {
    // ── Session cookie auth ────────────────────────────────────────────────
    const sessionId = event.cookies.get(lucia.sessionCookieName);

    if (!sessionId) {
      event.locals.user = null;
      event.locals.session = null;
    } else {
      const { session, user } = await lucia.validateSession(sessionId);

      if (session?.fresh) {
        const sessionCookie = lucia.createSessionCookie(session.id);
        event.cookies.set(sessionCookie.name, sessionCookie.value, {
          path: '.',
          ...sessionCookie.attributes,
        });
      }

      if (!session) {
        const blankCookie = lucia.createBlankSessionCookie();
        event.cookies.set(blankCookie.name, blankCookie.value, {
          path: '.',
          ...blankCookie.attributes,
        });
      }

      event.locals.user = user;
      event.locals.session = session;
    }
  }

  const response = await resolve(event);

  // ── Request log ───────────────────────────────────────────────────────────
  // Skip noisy asset/health requests
  const skip = path.startsWith('/_app/') || path === '/favicon.svg';
  if (!skip) {
    const ms = Date.now() - start;
    const status = response.status;
    const tag = status >= 500 ? 'ERR' : status >= 400 ? 'WRN' : 'INF';
    if (status >= 500) {
      console.error(`[${tag}] ${method} ${path} ${status} ${ms}ms`);
    } else {
      console.warn(`[${tag}] ${method} ${path} ${status} ${ms}ms`);
    }
  }

  return response;
};

// ── Unhandled server errors ───────────────────────────────────────────────────
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const path = event.url.pathname;
  console.error(`[SERVER ERROR] ${status} ${path} — ${message}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  } else if (error) {
    console.error(error);
  }
  return { message: status === 404 ? 'Not found' : 'An unexpected error occurred' };
};
