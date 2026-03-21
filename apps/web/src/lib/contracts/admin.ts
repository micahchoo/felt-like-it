import type { User, AuditLogEntry, ImportJob } from '@felt-like-it/shared-types';
import type { BaseActions, PaginatedData } from './shared.js';

export interface AdminUser extends User { isAdmin: boolean; disabledAt: Date | null; }

export interface StorageStats {
	totalFeatures: number;
	totalLayers: number;
	totalMaps: number;
	uploadVolumeBytes: number;
	uploadVolumeMax: number;
}

export interface AdminData {
	users: PaginatedData<AdminUser>;
	auditLog: PaginatedData<AuditLogEntry>;
	storageStats: StorageStats;
	importJobs: ImportJob[];
}

export interface AdminActions extends BaseActions {
	onDisableUser: (id: string) => Promise<void>;
	onEnableUser: (id: string) => Promise<void>;
	onCreateUser: (data: { email: string; name: string; password: string }) => Promise<void>;
	onVerifyAuditLog: () => Promise<boolean>;
}

export type AdminStatus = 'loading' | 'success' | 'error';
