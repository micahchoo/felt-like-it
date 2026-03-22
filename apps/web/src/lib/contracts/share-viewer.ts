import type { MapRecord, Layer } from '@felt-like-it/shared-types';
import type { BaseActions } from './shared.js';

/**
 * Data the route provides to ShareViewerScreen / EmbedScreen.
 *
 * Guest comments are handled internally by GuestCommentPanel via tRPC.
 */
export interface ShareViewerData {
	map: MapRecord;
	layers: Layer[];
	shareToken: string;
}

export interface ShareViewerActions extends BaseActions {
	// Route provides onRetry from BaseActions.
}

export type ShareViewerStatus = 'loading' | 'success' | 'error';
