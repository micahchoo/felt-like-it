// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module mocks ---

vi.mock('$lib/server/db/index.js', () => ({
	db: {
		select: vi.fn(),
	},
	maps:             { id: {}, userId: {} },
	mapCollaborators: { mapId: {}, userId: {}, role: {} },
}));

import { requireMapOwnership, requireMapAccess } from '../lib/server/geo/access.js';
import { db } from '$lib/server/db/index.js';
import { drizzleChain } from './test-utils.js';

// --- Constants ---

const USER_ID  = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const MAP_ID   = 'cccccccc-0000-0000-0000-cccccccccccc';

const OWNER_MAP = { id: MAP_ID, userId: USER_ID };
const OTHER_MAP = { id: MAP_ID, userId: OTHER_ID };

// --- requireMapOwnership ---

describe('requireMapOwnership', () => {
	beforeEach(() => vi.resetAllMocks());

	it('resolves when the user owns the map', async () => {
		vi.mocked(db.select).mockReturnValueOnce(drizzleChain([{ id: MAP_ID }]));
		await expect(requireMapOwnership(USER_ID, MAP_ID)).resolves.toBeUndefined();
	});

	it('throws NOT_FOUND when the map does not exist', async () => {
		vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));
		await expect(requireMapOwnership(USER_ID, MAP_ID)).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('throws NOT_FOUND when a different user owns the map (hides existence)', async () => {
		// The WHERE clause includes userId — no rows returned for a non-owner
		vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));
		await expect(requireMapOwnership(OTHER_ID, MAP_ID)).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});
});

// --- requireMapAccess ---

describe('requireMapAccess', () => {
	beforeEach(() => vi.resetAllMocks());

	// Owner fast-path

	it('owner + minRole=viewer → resolves (owner fast-path)', async () => {
		vi.mocked(db.select).mockReturnValueOnce(drizzleChain([OWNER_MAP]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).resolves.toBeUndefined();
		// Only one DB call — no collaborator lookup needed
		expect(db.select).toHaveBeenCalledOnce();
	});

	it('owner + minRole=editor → resolves (owner fast-path)', async () => {
		vi.mocked(db.select).mockReturnValueOnce(drizzleChain([OWNER_MAP]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'editor')).resolves.toBeUndefined();
		expect(db.select).toHaveBeenCalledOnce();
	});

	it('owner + minRole=owner → resolves (owner fast-path)', async () => {
		vi.mocked(db.select).mockReturnValueOnce(drizzleChain([OWNER_MAP]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'owner')).resolves.toBeUndefined();
	});

	// minRole='owner' hides map existence from non-owners

	it('minRole=owner + non-owner → NOT_FOUND (hides map existence)', async () => {
		vi.mocked(db.select).mockReturnValueOnce(drizzleChain([OTHER_MAP]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'owner')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		// Short-circuits — no second DB call for collaborator check
		expect(db.select).toHaveBeenCalledOnce();
	});

	// Nonexistent map

	it('nonexistent map → NOT_FOUND', async () => {
		vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	// No collaborator record hides map existence

	it('no collaborator record → NOT_FOUND (hides map existence)', async () => {
		vi.mocked(db.select)
			.mockReturnValueOnce(drizzleChain([OTHER_MAP])) // map found, not owner
			.mockReturnValueOnce(drizzleChain([]));          // no collaborator row
		await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	// Collaborator role matrix

	it('collaborator with editor + minRole=viewer → resolves', async () => {
		vi.mocked(db.select)
			.mockReturnValueOnce(drizzleChain([OTHER_MAP]))
			.mockReturnValueOnce(drizzleChain([{ role: 'editor' }]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).resolves.toBeUndefined();
	});

	it('collaborator with editor + minRole=editor → resolves (exact match)', async () => {
		vi.mocked(db.select)
			.mockReturnValueOnce(drizzleChain([OTHER_MAP]))
			.mockReturnValueOnce(drizzleChain([{ role: 'editor' }]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'editor')).resolves.toBeUndefined();
	});

	it('collaborator with viewer + minRole=viewer → resolves (exact match)', async () => {
		vi.mocked(db.select)
			.mockReturnValueOnce(drizzleChain([OTHER_MAP]))
			.mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).resolves.toBeUndefined();
	});

	it('collaborator with viewer + minRole=editor → FORBIDDEN', async () => {
		vi.mocked(db.select)
			.mockReturnValueOnce(drizzleChain([OTHER_MAP]))
			.mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'editor')).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
	});

	it('collaborator with commenter + minRole=editor → FORBIDDEN', async () => {
		vi.mocked(db.select)
			.mockReturnValueOnce(drizzleChain([OTHER_MAP]))
			.mockReturnValueOnce(drizzleChain([{ role: 'commenter' }]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'editor')).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
	});

	it('collaborator with commenter + minRole=commenter → resolves (exact match)', async () => {
		vi.mocked(db.select)
			.mockReturnValueOnce(drizzleChain([OTHER_MAP]))
			.mockReturnValueOnce(drizzleChain([{ role: 'commenter' }]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'commenter')).resolves.toBeUndefined();
	});

	it('collaborator with viewer + minRole=commenter → FORBIDDEN', async () => {
		vi.mocked(db.select)
			.mockReturnValueOnce(drizzleChain([OTHER_MAP]))
			.mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]));
		await expect(requireMapAccess(USER_ID, MAP_ID, 'commenter')).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
	});
});
