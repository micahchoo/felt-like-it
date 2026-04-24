import { Lucia } from 'lucia';
import { DrizzlePostgreSQLAdapter } from '@lucia-auth/adapter-drizzle';
import { env } from '$env/dynamic/private';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';

const adapter = new DrizzlePostgreSQLAdapter(db, sessions, users);

// Use secure cookies only when served over HTTPS.
// Checking ORIGIN lets local Docker (http://localhost) work without --insecure workarounds.
const secureCookies = (env.ORIGIN ?? '').startsWith('https://');

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    // Only `secure` and `sameSite` are accept by Lucia's typed options.
    // `httpOnly` is always true and `path` is always `/` — those are hard-coded
    // inside Lucia (see @lucia-auth/adapter-drizzle and lucia's createSessionCookie).
    // M10 audit item: verified the defaults are safe; the CSRF hole that
    // `sameSite: 'strict'` would close is covered by the Origin check in
    // apps/web/src/routes/api/v1/middleware.ts (M7).
    attributes: {
      secure: secureCookies,
      sameSite: 'lax',
    },
  },
  getUserAttributes: (attributes) => {
    return {
      email: attributes.email,
      name: attributes.name,
      isAdmin: attributes.isAdmin,
      disabledAt: attributes.disabledAt,
    };
  },
});

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      email: string;
      name: string;
      isAdmin: boolean;
      disabledAt: Date | null;
    };
  }
}

export type { Session, User } from 'lucia';
