import type { BaseActions } from './shared.js';

/** Locally-defined until ApiKey is promoted to shared-types. */
export interface ApiKey {
	id: string;
	name: string;
	prefix: string;
	lastUsedAt: Date | null;
	createdAt: Date;
}

export interface SettingsUser {
	id: string;
	email: string;
	name: string;
}

export interface SettingsData {
	user: SettingsUser;
	apiKeys: ApiKey[];
}

export interface SettingsActions extends BaseActions {
	onUpdateProfile: (changes: { name?: string }) => Promise<void>;
	onCreateApiKey: (name: string, scope: string) => Promise<void>;
	onRevokeApiKey: (id: string) => Promise<void>;
}

export type SettingsStatus = 'loading' | 'success' | 'error';
