import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user
      ? {
          id: locals.user.id,
          email: (locals.user as { id: string; email: string; name: string }).email,
          name: (locals.user as { id: string; email: string; name: string }).name,
        }
      : null,
  };
};
