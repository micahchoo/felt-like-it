// @vitest-environment node
import { vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { User } from 'lucia';
import type { db } from '$lib/server/db/index.js';

/** Result type of db.execute() — needed for raw-SQL mock returns. */
export type DbExecuteResult = Awaited<ReturnType<typeof db.execute>>;

/**
 * Build a Drizzle-compatible awaitable chain mock that resolves to `value`.
 * Covers: db.select().from().where()..., db.insert().values().returning(),
 * db.update().set().where(), db.delete().from().where().
 *
 * The union return type means callers never need `as unknown as ReturnType<...>`.
 */
export function drizzleChain<T>(value: T) {
	const c: Record<string, unknown> = {
		then: (res: (v: T) => unknown, rej: (e: unknown) => unknown) =>
			Promise.resolve(value).then(res, rej),
	};
	for (const m of [
		'from',
		'where',
		'orderBy',
		'groupBy',
		'set',
		'innerJoin',
		'leftJoin',
		'limit',
		'offset',
	]) {
		c[m] = vi.fn(() => c);
	}
	c['values'] = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(value) }));
	c['returning'] = vi.fn().mockResolvedValue(value);

	// Single cast at the source — consumers never cast.
	// TYPE_DEBT: union of Drizzle builder return types cannot be expressed without cast
	return c as unknown as ReturnType<typeof db.select> &
		ReturnType<typeof db.insert> &
		ReturnType<typeof db.update> &
		ReturnType<typeof db.delete>;
}

/**
 * Build an authenticated tRPC context.
 * Eliminates per-file `{ user: {...} as unknown as User }` casts.
 */
export function mockContext(overrides?: {
	userId?: string;
	userName?: string;
	userEmail?: string;
}) {
	const userId = overrides?.userId ?? 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
	return {
		user: {
			id: userId,
			name: overrides?.userName ?? 'Test User',
			email: overrides?.userEmail ?? 'test@test.local',
		} as User,
		session: {
			id: 'sess',
			userId,
			expiresAt: new Date(Date.now() + 3_600_000),
			fresh: false,
		},
		event: {} as RequestEvent,
	};
}

/** Build an unauthenticated tRPC context (for share/guest flows). */
export function publicContext() {
	return {
		user: null,
		session: null,
		event: {} as RequestEvent,
	};
}

/**
 * Build a mock db.execute() result with typed rows.
 * Centralises the single cast from { rows } to DbExecuteResult.
 */
export function mockExecuteResult<T>(rows: T[]): DbExecuteResult {
	return { rows } as unknown as DbExecuteResult;
}
