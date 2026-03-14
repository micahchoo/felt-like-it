// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockContext } from './test-utils.js';

// Mock db before importing router
vi.mock('$lib/server/db/index.js', () => ({
	db: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		execute: vi.fn(),
	},
	users: { id: 'id', email: 'email', name: 'name', isAdmin: 'is_admin', hashedPassword: 'hashed_password', createdAt: 'created_at', updatedAt: 'updated_at', disabledAt: 'disabled_at' },
	sessions: { id: 'id', userId: 'user_id' },
}));

vi.mock('$lib/server/auth/password.js', () => ({
	hashPassword: vi.fn().mockResolvedValue('hashed_password_mock'),
}));

vi.mock('$lib/server/auth/index.js', () => ({
	lucia: {
		invalidateUserSessions: vi.fn().mockResolvedValue(undefined),
	},
}));

const { adminRouter } = await import('$lib/server/trpc/routers/admin.js');
const { db } = await import('$lib/server/db/index.js');

import { drizzleChain } from './test-utils.js';

describe('admin router', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('access control', () => {
		it('rejects non-admin users', async () => {
			const caller = adminRouter.createCaller(mockContext({ isAdmin: false }));
			await expect(caller.listUsers({ page: 1 })).rejects.toThrow('Admin access required');
		});
	});

	describe('createUser', () => {
		it('creates a user with hashed password', async () => {
			vi.mocked(db.insert).mockReturnValue(drizzleChain([{ id: 'new-id' }]));

			const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
			await caller.createUser({
				email: 'new@test.com',
				name: 'New User',
				password: 'securepass123',
			});

			expect(db.insert).toHaveBeenCalled();
		});

		it('rejects password shorter than 8 characters', async () => {
			const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
			await expect(
				caller.createUser({ email: 'x@test.com', name: 'X', password: 'short' })
			).rejects.toThrow();
		});

		it('rejects duplicate email with friendly error', async () => {
			const dupeError = new Error('duplicate key') as Error & { code: string };
			dupeError.code = '23505';
			vi.mocked(db.insert).mockReturnValue({
				values: vi.fn().mockReturnValue({
					returning: vi.fn().mockRejectedValue(dupeError),
				}),
			} as ReturnType<typeof db.insert>);

			const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
			await expect(
				caller.createUser({ email: 'dupe@test.com', name: 'Dupe', password: 'securepass123' })
			).rejects.toThrow('email already exists');
		});

		it('rejects non-admin users', async () => {
			const caller = adminRouter.createCaller(mockContext({ isAdmin: false }));
			await expect(
				caller.createUser({ email: 'x@test.com', name: 'X', password: 'securepass123' })
			).rejects.toThrow('Admin access required');
		});
	});

	describe('toggleAdmin', () => {
		it('promotes a regular user to admin', async () => {
			const targetId = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
			vi.mocked(db.select).mockReturnValue(drizzleChain([{ id: targetId, isAdmin: false }]));
			vi.mocked(db.update).mockReturnValue(drizzleChain([{ id: targetId, isAdmin: true }]));

			const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
			const result = await caller.toggleAdmin({ userId: targetId });
			expect(result.isAdmin).toBe(true);
		});

		it('prevents self-demotion', async () => {
			const selfId = 'cccccccc-0000-0000-0000-cccccccccccc';
			const ctx = mockContext({ isAdmin: true, userId: selfId });
			vi.mocked(db.select).mockReturnValue(drizzleChain([{ id: selfId, isAdmin: true }]));

			const caller = adminRouter.createCaller(ctx);
			await expect(caller.toggleAdmin({ userId: selfId })).rejects.toThrow('Cannot change your own admin status');
		});
	});

	describe('resetPassword', () => {
		it('resets password for existing user', async () => {
			const targetId = 'dddddddd-0000-0000-0000-dddddddddddd';
			vi.mocked(db.update).mockReturnValue(drizzleChain([{ id: targetId }]));

			const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
			await caller.resetPassword({ userId: targetId, newPassword: 'newsecurepass' });

			expect(db.update).toHaveBeenCalled();
		});

		it('rejects password shorter than 8 characters', async () => {
			const targetId = 'dddddddd-0000-0000-0000-dddddddddddd';
			const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
			await expect(
				caller.resetPassword({ userId: targetId, newPassword: 'short' })
			).rejects.toThrow();
		});
	});

	describe('listUsers', () => {
		it('returns paginated user list for admin', async () => {
			const mockUsers = [
				{ id: 'u1', email: 'a@test.com', name: 'Alice', isAdmin: false, createdAt: new Date(), disabledAt: null },
			];
			vi.mocked(db.select)
				.mockReturnValueOnce(drizzleChain([{ total: 1 }]))
				.mockReturnValueOnce(drizzleChain(mockUsers));

			const caller = adminRouter.createCaller(mockContext({ isAdmin: true }));
			const result = await caller.listUsers({ page: 1 });
			expect(result.users).toEqual(mockUsers);
			expect(result.total).toBe(1);
		});
	});
});
