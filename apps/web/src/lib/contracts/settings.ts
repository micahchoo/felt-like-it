import type { User, ApiKey } from '@felt-like-it/shared-types';
import type { BaseActions } from './shared.js';

export interface SettingsData {
	user: User;
	apiKeys: ApiKey[];
}

export interface SettingsActions extends BaseActions {
	onUpdateProfile: (changes: { name?: string }) => Promise<void>;
	onCreateApiKey: (name: string, scope: string) => Promise<void>;
	onRevokeApiKey: (id: string) => Promise<void>;
}

export type SettingsStatus = 'loading' | 'success' | 'error';
