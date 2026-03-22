import type {
	MapRecord,
	Layer,
} from '@felt-like-it/shared-types';
import type { BaseActions } from './shared.js';

/** Locally-defined until these types are promoted to shared-types. */
export interface Comment {
	id: string;
	body: string;
	authorName: string;
	createdAt: Date;
	resolved: boolean;
}

/**
 * Data the route provides to MapEditorScreen.
 *
 * Annotations, comments, events, and collaborators are fetched client-side
 * by the screen via tRPC / TanStack Query — they are NOT provided by the route.
 */
export interface MapEditorData {
	map: MapRecord;
	layers: Layer[];
	userId: string;
	userRole: 'owner' | 'editor' | 'commenter' | 'viewer';
	isOwner: boolean;
	readonly: boolean;
	embed: boolean;
}

export interface MapEditorActions extends BaseActions {
	// Route provides onRetry from BaseActions.
	// All mutation actions (layer CRUD, feature upsert, annotation CRUD, etc.)
	// are handled internally by MapEditor via tRPC.
}

export type MapEditorStatus = 'loading' | 'success' | 'error' | 'empty';
