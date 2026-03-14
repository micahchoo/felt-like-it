import { z } from 'zod';
import { desc, or, ilike, count } from 'drizzle-orm';
import { router, adminProcedure } from '../init.js';
import { db, users } from '../../db/index.js';

const PAGE_SIZE = 50;

export const adminRouter = router({
	listUsers: adminProcedure
		.input(z.object({
			page: z.number().int().min(1).default(1),
			search: z.string().optional(),
		}))
		.query(async ({ input }) => {
			const offset = (input.page - 1) * PAGE_SIZE;

			const baseWhere = input.search
				? or(
						ilike(users.email, `%${input.search}%`),
						ilike(users.name, `%${input.search}%`),
					)
				: undefined;

			const [totalResult] = await db
				.select({ total: count() })
				.from(users)
				.where(baseWhere);

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
				.where(baseWhere)
				.orderBy(desc(users.createdAt))
				.limit(PAGE_SIZE)
				.offset(offset);

			return {
				users: userList,
				total: totalResult?.total ?? 0,
				page: input.page,
				pageSize: PAGE_SIZE,
			};
		}),
});
