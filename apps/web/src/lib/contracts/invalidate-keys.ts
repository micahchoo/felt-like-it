// Dependency-key taxonomy used with SvelteKit's `event.depends()` and
// `invalidate()` to scope re-loads narrowly. Pattern: `<area>:<resource>`.
// Loaders register one or more keys; client mutations invalidate the
// matching key instead of running `invalidateAll()`. Add new keys here
// — never use a free-form string at a callsite.
export const INVALIDATE = {
	dashboardMaps: 'dashboard:maps',
	settingsProfile: 'settings:profile',
	settingsApiKeys: 'settings:apikeys',
	adminUsers: 'admin:users',
	adminAudit: 'admin:audit',
	adminStorage: 'admin:storage',
	adminImports: 'admin:imports',
} as const;

export type InvalidateKey = (typeof INVALIDATE)[keyof typeof INVALIDATE];
