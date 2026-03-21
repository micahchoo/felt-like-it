import type {
	MapRecord,
	Layer,
	Feature,
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

export interface MapEvent {
	id: string;
	action: string;
	userId: string | null;
	createdAt: Date;
	metadata: Record<string, unknown>;
}

export interface Collaborator {
	id: string;
	name: string;
	role: string;
}

/** Simplified annotation for UI display (full AnnotationObject schema is complex). */
export interface AnnotationSummary {
	id: string;
	authorName: string;
	content: { type: string; [key: string]: unknown };
	anchor: { type: string; coordinates?: [number, number] };
	createdAt: Date;
	version: number;
}

export interface MapEditorData {
	map: MapRecord;
	layers: Layer[];
	features: Record<string, Feature[]>; // keyed by layerId
	annotations: AnnotationSummary[];
	comments: Comment[];
	events: MapEvent[];
	collaborators: Collaborator[];
}

export interface MapEditorActions extends BaseActions {
	onLayerCreate: (name: string) => Promise<void>;
	onLayerDelete: (id: string) => Promise<void>;
	onLayerReorder: (id: string, newIndex: number) => Promise<void>;
	onLayerToggle: (id: string, visible: boolean) => Promise<void>;
	onLayerUpdateStyle: (id: string, style: Record<string, unknown>) => Promise<void>;
	onFeatureUpsert: (layerId: string, feature: Feature) => Promise<void>;
	onFeatureDelete: (layerId: string, featureId: string) => Promise<void>;
	onAnnotationCreate: (annotation: Partial<AnnotationSummary>) => Promise<void>;
	onAnnotationUpdate: (
		id: string,
		version: number,
		changes: Partial<AnnotationSummary>,
	) => Promise<void>;
	onAnnotationDelete: (id: string) => Promise<void>;
	onCommentCreate: (body: string) => Promise<void>;
	onCommentDelete: (id: string) => Promise<void>;
	onCommentResolve: (id: string) => Promise<void>;
	onMapUpdate: (changes: Partial<MapRecord>) => Promise<void>;
	onViewportSave: (viewport: {
		center: [number, number];
		zoom: number;
		bearing: number;
		pitch: number;
	}) => Promise<void>;
	onGeoprocessingRun: (op: Record<string, unknown>) => Promise<void>;
}

export type MapEditorStatus = 'loading' | 'success' | 'error' | 'empty';
