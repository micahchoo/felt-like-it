import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createHash, randomBytes } from 'node:crypto';
import { db, users, maps, layers, apiKeys } from '$lib/server/db/index.js';
import { eq, and, desc } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '$lib/server/auth/password.js';
import { lucia } from '$lib/server/auth/index.js';
import { insertFeatures } from '$lib/server/geo/queries.js';
import type { Geometry } from '@felt-like-it/shared-types';

const DEMO_EMAIL = 'demo@felt-like-it.local';

const PARKS_STYLE = {
  type: 'simple' as const,
  paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.5, 'fill-outline-color': '#15803d' },
  layout: {},
  legend: [{ label: 'Park', color: '#22c55e' }],
};

const SF_PARKS_FEATURES: Array<{
  geometry: Geometry;
  properties: Record<string, unknown>;
}> = [
  {
    properties: { name: 'Golden Gate Park', area_acres: 1017, established: 1870, category: 'Regional Park' },
    geometry: { type: 'Polygon', coordinates: [[[-122.5117,37.7694],[-122.4534,37.7694],[-122.4534,37.7715],[-122.5117,37.7715],[-122.5117,37.7694]]] },
  },
  {
    properties: { name: 'Mission Dolores Park', area_acres: 16, established: 1905, category: 'Neighborhood Park' },
    geometry: { type: 'Polygon', coordinates: [[[-122.4278,37.7601],[-122.4244,37.7601],[-122.4244,37.7636],[-122.4278,37.7636],[-122.4278,37.7601]]] },
  },
  {
    properties: { name: 'Alamo Square', area_acres: 12.7, established: 1892, category: 'Neighborhood Park' },
    geometry: { type: 'Polygon', coordinates: [[[-122.4349,37.7759],[-122.4321,37.7759],[-122.4321,37.7779],[-122.4349,37.7779],[-122.4349,37.7759]]] },
  },
  {
    properties: { name: 'Buena Vista Park', area_acres: 36, established: 1894, category: 'Neighborhood Park' },
    geometry: { type: 'Polygon', coordinates: [[[-122.4435,37.7692],[-122.4408,37.7692],[-122.4408,37.7714],[-122.4435,37.7714],[-122.4435,37.7692]]] },
  },
  {
    properties: { name: 'Crissy Field', area_acres: 100, established: 2001, category: 'Regional Park' },
    geometry: { type: 'Polygon', coordinates: [[[-122.471,37.802],[-122.45,37.802],[-122.45,37.8055],[-122.471,37.8055],[-122.471,37.802]]] },
  },
];

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, '/auth/login');

  const userKeys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, locals.user.id))
    .orderBy(desc(apiKeys.createdAt));

  return {
    user: {
      id: locals.user.id,
      email: (locals.user as { id: string; email: string; name: string }).email,
      name: (locals.user as { id: string; email: string; name: string }).name,
    },
    apiKeys: userKeys,
  };
};

export const actions: Actions = {
  updateProfile: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const userId = locals.user.id;
    const formData = await request.formData();
    const name = (formData.get('name') as string | null)?.trim();

    if (!name || name.length < 1) {
      return fail(400, { field: 'name', message: 'Name cannot be empty.' });
    }

    await db.update(users).set({ name }).where(eq(users.id, userId));
    return { success: true, message: 'Profile updated.' };
  },

  changePassword: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const userId = locals.user.id;
    const formData = await request.formData();
    const currentPassword = formData.get('currentPassword') as string | null;
    const newPassword = formData.get('newPassword') as string | null;

    if (!currentPassword || !newPassword) {
      return fail(400, { field: 'currentPassword', message: 'Both passwords are required.' });
    }
    if (newPassword.length < 8) {
      return fail(400, { field: 'newPassword', message: 'New password must be at least 8 characters.' });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return fail(500, { field: 'currentPassword', message: 'User not found.' });

    const valid = await verifyPassword(user.hashedPassword, currentPassword);
    if (!valid) {
      return fail(400, { field: 'currentPassword', message: 'Current password is incorrect.' });
    }

    const hashedPassword = await hashPassword(newPassword);
    await db.update(users).set({ hashedPassword }).where(eq(users.id, userId));

    // Invalidate all sessions to force re-login
    await lucia.invalidateUserSessions(userId);

    redirect(302, '/auth/login');
  },

  createKey: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const formData = await request.formData();
    const name = (formData.get('keyName') as string | null)?.trim();

    if (!name || name.length < 1) {
      return fail(400, { field: 'apiKey', message: 'Key name cannot be empty.' });
    }
    if (name.length > 64) {
      return fail(400, { field: 'apiKey', message: 'Key name must be 64 characters or fewer.' });
    }

    const randomHex = randomBytes(32).toString('hex');
    const rawKey = `flk_${randomHex}`;
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 12);

    const [record] = await db
      .insert(apiKeys)
      .values({ userId: locals.user.id, name, keyHash: hash, prefix, scope: 'read-write' })
      .returning({ id: apiKeys.id });

    if (!record) {
      return fail(500, { field: 'apiKey', message: 'Failed to create API key.' });
    }

    return { success: true, newKey: rawKey, keyName: name, message: '' };
  },

  revokeKey: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const formData = await request.formData();
    const id = formData.get('id') as string | null;

    if (!id) {
      return fail(400, { field: 'apiKey', message: 'Key ID required.' });
    }

    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, locals.user.id)));

    return { success: true, message: 'API key revoked.' };
  },

  resetDemo: async ({ locals }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const userWithEmail = locals.user as { id: string; email: string; name: string };
    if (userWithEmail.email !== DEMO_EMAIL) {
      return fail(403, { field: 'demoReset', message: 'This action is only available for the demo account.' });
    }

    const userId = locals.user.id;

    try {
      // Delete all maps (cascades to layers, features, shares, import_jobs)
      await db.delete(maps).where(eq(maps.userId, userId));

      // Re-create the demo map
      const [newMap] = await db
        .insert(maps)
        .values({
          userId,
          title: 'San Francisco Parks',
          description: 'A map of parks in San Francisco, CA.',
          viewport: { center: [-122.449, 37.7749] as [number, number], zoom: 12, bearing: 0, pitch: 0 },
          basemap: 'osm',
        })
        .returning();

      if (!newMap) {
        return fail(500, { field: 'demoReset', message: 'Failed to create demo map.' });
      }

      // Re-create the Parks layer
      const [newLayer] = await db
        .insert(layers)
        .values({
          mapId: newMap.id,
          name: 'Parks',
          type: 'polygon',
          style: PARKS_STYLE,
          zIndex: 0,
        })
        .returning();

      if (!newLayer) {
        return fail(500, { field: 'demoReset', message: 'Failed to create demo layer.' });
      }

      // Re-insert the SF park features
      await insertFeatures(newLayer.id, SF_PARKS_FEATURES);

      return { success: true, message: 'Demo data has been reset.' };
    } catch {
      return fail(500, { field: 'demoReset', message: 'Failed to reset demo data. Please try again.' });
    }
  },
};
