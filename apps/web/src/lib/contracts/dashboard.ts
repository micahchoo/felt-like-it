import type { MapRecord } from '@felt-like-it/shared-types';
import type { BaseActions } from './shared.js';

export interface DashboardData {
	maps: MapRecord[];
	collaboratingMaps: MapRecord[];
	templates: MapRecord[];
}

export interface DashboardActions extends BaseActions {
	onCreate: (title: string, description?: string) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
	onClone: (id: string) => Promise<void>;
}

export type DashboardStatus = 'loading' | 'success' | 'error' | 'empty';
