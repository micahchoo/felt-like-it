import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { lucia } from '$lib/server/auth/index.js';

export const actions: Actions = {
  default: async ({ locals, cookies }) => {
    if (locals.session) {
      await lucia.invalidateSession(locals.session.id);
    }

    const blankCookie = lucia.createBlankSessionCookie();
    cookies.set(blankCookie.name, blankCookie.value, {
      path: '.',
      ...blankCookie.attributes,
    });

    redirect(302, '/auth/login');
  },
};
