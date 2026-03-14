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
