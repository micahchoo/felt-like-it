import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { lucia } from '$lib/server/auth/index.js';
import { hashPassword } from '$lib/server/auth/password.js';
import { db, users } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { checkRateLimit } from '$lib/server/rate-limit.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(302, '/dashboard');
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    if (!checkRateLimit(getClientAddress())) {
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

    // Check for duplicate email
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) {
      return fail(400, { field: 'email', message: 'An account with this email already exists.' });
    }

    const hashedPassword = await hashPassword(password);

    let user;
    try {
      [user] = await db
        .insert(users)
        .values({ email, hashedPassword, name })
        .returning({ id: users.id });
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        return fail(400, { field: 'email', message: 'An account with this email already exists.' });
      }
      throw err;
    }

    if (!user) {
      return fail(500, { field: '', message: 'Failed to create account. Please try again.' });
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
