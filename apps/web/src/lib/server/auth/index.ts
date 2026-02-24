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
    attributes: {
      secure: secureCookies,
      sameSite: 'lax',
    },
  },
  getUserAttributes: (attributes) => {
    return {
      email: attributes.email,
      name: attributes.name,
    };
  },
});

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      email: string;
      name: string;
    };
  }
}

export type { Session, User } from 'lucia';
