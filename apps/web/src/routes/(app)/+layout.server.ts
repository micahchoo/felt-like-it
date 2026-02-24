import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(302, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  return {
    user: {
      id: locals.user.id,
      email: locals.user.email,
      name: locals.user.name,
      isAdmin: locals.user.isAdmin,
    },
  };
};
