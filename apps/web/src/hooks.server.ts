import { lucia } from '$lib/server/auth/index.js';
import type { Handle, HandleServerError } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const start = Date.now();
  const { method } = event.request;
  const path = event.url.pathname;

  // ── Session validation ────────────────────────────────────────────────────
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
