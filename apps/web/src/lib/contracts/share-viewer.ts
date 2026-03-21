import type { MapRecord, Layer, Feature } from '@felt-like-it/shared-types';
import type { Comment } from './map-editor.js';
import type { BaseActions } from './shared.js';

export interface ShareViewerData {
	map: MapRecord;
	layers: Layer[];
	features: Record<string, Feature[]>;
	comments: Comment[];
	shareToken: string;
	accessLevel: 'public' | 'unlisted';
}

export interface ShareViewerActions extends BaseActions {
	onGuestComment: (authorName: string, body: string) => Promise<void>;
}

export type ShareViewerStatus = 'loading' | 'success' | 'error';
