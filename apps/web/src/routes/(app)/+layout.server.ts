import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(302, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  return {
    user: {
      id: locals.user.id,
      email: (locals.user as { id: string; email: string; name: string; isAdmin: boolean }).email,
      name: (locals.user as { id: string; email: string; name: string; isAdmin: boolean }).name,
      isAdmin: (locals.user as { id: string; email: string; name: string; isAdmin: boolean }).isAdmin,
    },
  };
};
