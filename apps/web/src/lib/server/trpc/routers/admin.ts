import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, or, ilike, count } from 'drizzle-orm';
import { router, adminProcedure } from '../init.js';
import { db, users } from '../../db/index.js';
import { hashPassword } from '../../auth/password.js';
import { lucia } from '../../auth/index.js';

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

	createUser: adminProcedure
		.input(z.object({
			email: z.string().email(),
			name: z.string().min(1).max(200),
			password: z.string().min(8).max(256),
			isAdmin: z.boolean().default(false),
		}))
		.mutation(async ({ input }) => {
			const hashedPassword = await hashPassword(input.password);

			try {
				const [created] = await db
					.insert(users)
					.values({
						email: input.email.toLowerCase().trim(),
						name: input.name.trim(),
						hashedPassword,
						isAdmin: input.isAdmin,
					})
					.returning({ id: users.id });

				if (!created) {
					throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create user.' });
				}

				return { id: created.id };
			} catch (e: unknown) {
				if (e instanceof TRPCError) throw e;
				const dbError = e as { code?: string };
				if (dbError.code === '23505') {
					throw new TRPCError({ code: 'CONFLICT', message: 'A user with this email already exists.' });
				}
				throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create user.' });
			}
		}),

	toggleAdmin: adminProcedure
		.input(z.object({ userId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			if (input.userId === ctx.user.id) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot change your own admin status.' });
			}

			const [user] = await db
				.select({ id: users.id, isAdmin: users.isAdmin })
				.from(users)
				.where(eq(users.id, input.userId));

			if (!user) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
			}

			const [updated] = await db
				.update(users)
				.set({ isAdmin: !user.isAdmin, updatedAt: new Date() })
				.where(eq(users.id, input.userId))
				.returning({ id: users.id, isAdmin: users.isAdmin });

			return updated!;
		}),
});
