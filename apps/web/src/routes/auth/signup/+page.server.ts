import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { lucia } from '$lib/server/auth/index.js';
import { hashPassword } from '$lib/server/auth/password.js';
import { db, users } from '$lib/server/db/index.js';
import { checkRateLimit } from '$lib/server/rate-limit.js';

/**
 * M8 — generic signup-failure message. Distinguishing "email already exists"
 * from "signup unavailable" lets an attacker enumerate registered addresses.
 * One constant error closes that oracle; legitimate users hit the login form.
 */
const GENERIC_SIGNUP_FAIL =
  'Unable to create account. If you already have an account, please sign in.';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(302, '/dashboard');
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    if (!(await checkRateLimit(getClientAddress()))) {
      return fail(429, { field: '', message: 'Too many attempts. Please wait a minute.' });
    }

    const formData = await request.formData();
    const name = (formData.get('name') as string | null)?.trim();
    const email = (formData.get('email') as string | null)?.trim().toLowerCase();
    const password = formData.get('password') as string | null;

    if (!name || name.length < 1) {
      return fail(400, { field: 'name', message: 'Name is required.' });
    }
    if (!email || !email.includes('@')) {
      return fail(400, { field: 'email', message: 'A valid email is required.' });
    }
    if (!password || password.length < 8) {
      return fail(400, { field: 'password', message: 'Password must be at least 8 characters.' });
    }

    if (password.length > 256) {
      return fail(400, { field: 'password', message: 'Password is too long.' });
    }

    // M8: no pre-SELECT for email existence — lets the DB uniqueness
    // constraint produce a single error code (23505) that we map to a
    // generic message. Timing between "email new" and "email exists" is
    // equalised because both paths incur exactly one argon2 hash + one
    // INSERT attempt.
    const hashedPassword = await hashPassword(password);

    let user;
    try {
      [user] = await db
        .insert(users)
        .values({ email, hashedPassword, name })
        .returning({ id: users.id });
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        return fail(400, { field: '', message: GENERIC_SIGNUP_FAIL });
      }
      throw err;
    }

    if (!user) {
      return fail(500, { field: '', message: GENERIC_SIGNUP_FAIL });
    }

    const session = await lucia.createSession(user.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: '.',
      ...sessionCookie.attributes,
    });

    redirect(302, '/dashboard');
  },
};
