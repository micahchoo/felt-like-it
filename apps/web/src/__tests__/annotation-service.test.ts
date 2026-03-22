// @ts-nocheck — test file; strict null checks on array access are noise
// @vitest-environment node
/**
 * Characterization tests for annotations/service.ts
 *
 * Tests the service layer directly (not via tRPC router).
 * Focuses on: list, create, flagOrphanedAnnotations, convertAnchorToPoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db/index.js', () => ({
	db: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		execute: vi.fn(),
	},
	maps: { id: {}, userId: {} },
	annotations: { id: {}, mapId: {}, userId: {} },
	annotationObjects: { id: {}, mapId: {}, parentId: {}, authorId: {}, ordinal: {}, version: {} },
	annotationChangelog: { id: {}, mapId: {}, objectId: {}, authorId: {} },
	mapCollaborators: { mapId: {}, userId: {}, role: {} },
}));

vi.mock('$lib/server/geo/access.js', () => ({
	requireMapAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/annotations/changelog.js', () => ({
	buildAddPatch: vi.fn(() => ({ patch: { op: 'add' }, inverse: { op: 'del' } })),
	buildModPatch: vi.fn(() => ({ patch: { op: 'mod' }, inverse: { op: 'mod' } })),
	buildDelPatch: vi.fn(() => ({ patch: { op: 'del' }, inverse: { op: 'add' } })),
	insertChangelog: vi.fn().mockResolvedValue('changelog-id'),
}));

import { db } from '$lib/server/db/index.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { insertChangelog } from '$lib/server/annotations/changelog.js';
import { drizzleChain, mockExecuteResult } from './test-utils.js';
import { annotationService } from '../lib/server/annotations/service.js';

const USER_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const ANN_ID = 'cccccccc-0000-0000-0000-cccccccccccc';
const FEATURE_ID = 'dddddddd-0000-0000-0000-dddddddddddd';

const MOCK_ROW = {
	id: ANN_ID,
	map_id: MAP_ID,
	parent_id: null,
	author_id: USER_ID,
	author_name: 'Test User',
	anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
	content: { kind: 'single', body: { type: 'text', text: 'hello' } },
	template_id: null,
	ordinal: 0,
	version: 1,
	created_at: new Date('2025-01-01'),
	updated_at: new Date('2025-01-01'),
};

// ─── list ─────────────────────────────────────────────────────────────────────

describe('annotationService.list', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns mapped annotation objects for a map', async () => {
		vi.mocked(db.execute)
			.mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]))   // rows query
			.mockResolvedValueOnce(mockExecuteResult([{ cnt: '1' }])); // count query

		const result = await annotationService.list({ userId: USER_ID, mapId: MAP_ID });

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe(ANN_ID);
		expect(result.items[0]?.mapId).toBe(MAP_ID);
		expect(result.items[0]?.anchor.type).toBe('point');
		expect(result.totalCount).toBe(1);
	});

	it('checks viewer access before querying', async () => {
		vi.mocked(db.execute)
			.mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]))
			.mockResolvedValueOnce(mockExecuteResult([{ cnt: '1' }]));

		await annotationService.list({ userId: USER_ID, mapId: MAP_ID });

		expect(requireMapAccess).toHaveBeenCalledWith(USER_ID, MAP_ID, 'viewer');
	});

	it('returns empty items when map has no annotations', async () => {
		vi.mocked(db.execute)
			.mockResolvedValueOnce(mockExecuteResult([]))
			.mockResolvedValueOnce(mockExecuteResult([{ cnt: '0' }]));

		const result = await annotationService.list({ userId: USER_ID, mapId: MAP_ID });

		expect(result.items).toEqual([]);
		expect(result.totalCount).toBe(0);
	});

	it('executes two db queries (rows + count)', async () => {
		vi.mocked(db.execute)
			.mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]))
			.mockResolvedValueOnce(mockExecuteResult([{ cnt: '1' }]));

		await annotationService.list({ userId: USER_ID, mapId: MAP_ID });

		expect(db.execute).toHaveBeenCalledTimes(2);
	});

	it('filters to root annotations when rootsOnly is true', async () => {
		vi.mocked(db.execute)
			.mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]))
			.mockResolvedValueOnce(mockExecuteResult([{ cnt: '1' }]));

		const result = await annotationService.list({ userId: USER_ID, mapId: MAP_ID, rootsOnly: true });

		expect(result.items).toHaveLength(1);
		expect(db.execute).toHaveBeenCalledTimes(2);
	});

	it('does not filter by parent when rootsOnly is undefined', async () => {
		const replyRow = { ...MOCK_ROW, parent_id: ANN_ID };
		vi.mocked(db.execute)
			.mockResolvedValueOnce(mockExecuteResult([MOCK_ROW, replyRow]))
			.mockResolvedValueOnce(mockExecuteResult([{ cnt: '2' }]));

		const result = await annotationService.list({ userId: USER_ID, mapId: MAP_ID });

		expect(result.items).toHaveLength(2);
	});
});

// ─── create ───────────────────────────────────────────────────────────────────

describe('annotationService.create', () => {
	beforeEach(() => vi.clearAllMocks());

	it('inserts annotation and records changelog entry', async () => {
		vi.mocked(db.execute)
			.mockResolvedValueOnce(mockExecuteResult([{ cnt: '0' }])) // ordinal count
			.mockResolvedValueOnce(mockExecuteResult([MOCK_ROW])); // insert returning

		const result = await annotationService.create({
			userId: USER_ID,
			userName: 'Test User',
			mapId: MAP_ID,
			anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
			content: { kind: 'single', body: { type: 'text', text: 'hello' } },
		});

		expect(result.id).toBe(ANN_ID);
		expect(result.anchor.type).toBe('point');
		expect(insertChangelog).toHaveBeenCalledOnce();
	});

	it('returns created annotation with correct authorId and mapId', async () => {
		vi.mocked(db.execute)
			.mockResolvedValueOnce(mockExecuteResult([{ cnt: '0' }]))
			.mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

		const result = await annotationService.create({
			userId: USER_ID,
			userName: 'Test User',
			mapId: MAP_ID,
			anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
			content: { kind: 'single', body: { type: 'text', text: 'hello' } },
		});

		expect(result.authorId).toBe(USER_ID);
		expect(result.mapId).toBe(MAP_ID);
	});

	it('performs two db.execute calls: ordinal count then insert', async () => {
		vi.mocked(db.execute)
			.mockResolvedValueOnce(mockExecuteResult([{ cnt: '0' }]))
			.mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

		await annotationService.create({
			userId: USER_ID,
			userName: 'Test User',
			mapId: MAP_ID,
			anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
			content: { kind: 'single', body: { type: 'text', text: 'hello' } },
		});

		expect(db.execute).toHaveBeenCalledTimes(2);
	});

	it('rejects when parentId points to a non-root annotation', async () => {
		vi.mocked(db.select).mockReturnValueOnce(drizzleChain([{ parentId: 'some-parent-id' }]));
		vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([{ cnt: '0' }]));

		await expect(
			annotationService.create({
				userId: USER_ID,
				userName: 'Test User',
				mapId: MAP_ID,
				parentId: ANN_ID,
				anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
				content: { kind: 'single', body: { type: 'text', text: 'reply' } },
			}),
		).rejects.toThrow(/root annotation/i);
	});
});

// ─── flagOrphanedAnnotations ──────────────────────────────────────────────────

describe('annotationService.flagOrphanedAnnotations', () => {
	beforeEach(() => vi.resetAllMocks());

	it('short-circuits and returns 0 without querying when featureIds is empty', async () => {
		const count = await annotationService.flagOrphanedAnnotations([]);

		expect(count).toBe(0);
		expect(db.execute).not.toHaveBeenCalled();
	});

	it('flags a single feature-anchored annotation and returns count 1', async () => {
		vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([{ id: ANN_ID }]));

		const count = await annotationService.flagOrphanedAnnotations([FEATURE_ID]);

		expect(count).toBe(1);
		expect(db.execute).toHaveBeenCalledOnce();
	});

	it('flags multiple annotations across multiple feature IDs', async () => {
		const FEATURE_ID_2 = 'eeeeeeee-0000-0000-0000-eeeeeeeeeeee';
		const flaggedRows = [
			{ id: ANN_ID },
			{ id: 'ffffffff-0000-0000-0000-ffffffffffff' },
		];
		vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult(flaggedRows));

		const count = await annotationService.flagOrphanedAnnotations([FEATURE_ID, FEATURE_ID_2]);

		expect(count).toBe(2);
	});

	it('returns 0 when no annotations reference the deleted features', async () => {
		vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([]));

		const count = await annotationService.flagOrphanedAnnotations([FEATURE_ID]);

		expect(count).toBe(0);
	});
});

// ─── convertAnchorToPoint ─────────────────────────────────────────────────────

describe('annotationService.convertAnchorToPoint', () => {
	beforeEach(() => vi.resetAllMocks());

	it('executes a single UPDATE query and resolves without a return value', async () => {
		vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([{ id: ANN_ID }]));

		const result = await annotationService.convertAnchorToPoint(ANN_ID, MAP_ID, [-122.4, 37.8]);

		expect(result).toBeUndefined();
		expect(db.execute).toHaveBeenCalledOnce();
	});

	it('does not call requireMapAccess (access is checked at the router layer)', async () => {
		vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([{ id: ANN_ID }]));

		await annotationService.convertAnchorToPoint(ANN_ID, MAP_ID, [-122.4, 37.8]);

		expect(requireMapAccess).not.toHaveBeenCalled();
	});

	it('executes one db call even when no row matches (silent no-op)', async () => {
		// UPDATE WHERE … returns 0 rows — service does not throw
		vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([]));

		await expect(
			annotationService.convertAnchorToPoint(
				'00000000-0000-0000-0000-000000000000',
				MAP_ID,
				[0, 0],
			),
		).resolves.toBeUndefined();

		expect(db.execute).toHaveBeenCalledOnce();
	});
});
