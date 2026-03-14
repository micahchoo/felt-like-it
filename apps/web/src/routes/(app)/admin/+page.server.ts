import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db/index.js';
import { users } from '$lib/server/db/schema.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const userList = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return { users: userList };
};
