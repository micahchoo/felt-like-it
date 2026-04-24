import type { MapRecord, Layer } from '@felt-like-it/shared-types';
import type { BaseActions } from './shared.js';

/**
 * Public-share view of a map — deliberately narrower than MapRecord to limit
 * payload size and avoid leaking owner metadata (userId, timestamps, description)
 * through unauthenticated share/embed routes. The share/embed loaders produce
 * exactly this shape; ShareViewerScreen / EmbedScreen must only read these fields.
 *
 * Guest comments are handled internally by GuestCommentPanel via tRPC.
 */
export type ShareViewerMap = Pick<MapRecord, 'id' | 'title' | 'viewport' | 'basemap'>;

export interface ShareViewerData {
	map: ShareViewerMap;
	layers: Layer[];
	shareToken: string;
}

export interface ShareViewerActions extends BaseActions {
	// Route provides onRetry from BaseActions.
}

export type ShareViewerStatus = 'loading' | 'success' | 'error';
