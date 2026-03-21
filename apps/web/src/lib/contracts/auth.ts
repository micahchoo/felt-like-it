import type { BaseActions } from './shared.js';

export interface LoginData {
	email: string;
	password: string;
}

export interface RegisterData {
	name: string;
	email: string;
	password: string;
	confirmPassword: string;
}

export interface AuthActions extends BaseActions {
	onLogin: (data: LoginData) => Promise<void>;
	onRegister: (data: RegisterData) => Promise<void>;
	onLogout: () => Promise<void>;
}

export type AuthStatus = 'idle' | 'loading' | 'error';
