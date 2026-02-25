import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { lucia } from '$lib/server/auth/index.js';
import { verifyPassword } from '$lib/server/auth/password.js';
import { db, users } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { checkRateLimit } from '$lib/server/rate-limit.js';

/** Only allow relative paths that don't escape to another origin. */
function safeRedirect(url: URL): string {
  const target = url.searchParams.get('redirect');
  if (!target || !target.startsWith('/') || target.startsWith('//')) return '/dashboard';
  return target;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) {
    redirect(302, safeRedirect(url));
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
    if (!checkRateLimit(getClientAddress())) {
      return fail(429, { field: '', message: 'Too many attempts. Please wait a minute.' });
    }

    const formData = await request.formData();
    const email = (formData.get('email') as string | null)?.trim().toLowerCase();
    const password = formData.get('password') as string | null;

    if (!email || !password) {
      return fail(400, { field: '',message: 'Email and password are required.' });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email));

    if (!user) {
      // Hash a dummy password to prevent timing attacks
      await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$invalid$invalid', password).catch(() => {});
      return fail(400, { field: '',message: 'Invalid email or password.' });
    }

    const valid = await verifyPassword(user.hashedPassword, password);
    if (!valid) {
      return fail(400, { field: '',message: 'Invalid email or password.' });
    }

    const session = await lucia.createSession(user.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: '.',
      ...sessionCookie.attributes,
    });

    redirect(302, safeRedirect(url));
  },
};
