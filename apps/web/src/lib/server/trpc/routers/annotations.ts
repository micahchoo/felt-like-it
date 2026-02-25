import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, annotations } from '../../db/index.js';
import { requireMapAccess } from '../../geo/access.js';
import { typedExecute } from '../../geo/queries.js';
import {
  CreateAnnotationSchema,
  UpdateAnnotationSchema,
  GeoJSONFeatureCollectionSchema,
} from '@felt-like-it/shared-types';
import type { Annotation, AnnotationContent } from '@felt-like-it/shared-types';

// ─── Raw DB row shape (before anchor reconstruction) ─────────────────────────

/**
 * Shape of a row returned by the raw SQL SELECT / INSERT / UPDATE queries.
 * ST_X/ST_Y decompose the PostGIS Point into scalar lng/lat columns because
 * Drizzle's customType cannot automatically decode geometry(Point,4326) to
 * a GeoJSON object — we reconstruct the anchor manually in `rowToAnnotation`.
 */
interface RawAnnotationRow {
  id: string;
  mapId: string;
  userId: string | null;
  authorName: string;
  /** Longitude — from ST_X(anchor_point) */
  lng: number;
  /** Latitude  — from ST_Y(anchor_point) */
  lat: number;
  /** JSONB parsed by the pg driver — already a JS object, not a string */
  content: AnnotationContent;
  createdAt: Date;
  updatedAt: Date;
}

/** Reconstruct a typed Annotation from a raw query row. */
function rowToAnnotation(row: RawAnnotationRow): Annotation {
  return {
    id: row.id,
    mapId: row.mapId,
    userId: row.userId,
    authorName: row.authorName,
    anchor: { type: 'Point', coordinates: [row.lng, row.lat] },
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Reusable SELECT fragment ─────────────────────────────────────────────────

/**
 * Standard column list for annotation SELECT / RETURNING clauses.
 * Decomposes anchor_point into scalar lng/lat for `rowToAnnotation`.
 */
const ANNOTATION_COLS = sql.raw(`
  id,
  map_id           AS "mapId",
  user_id          AS "userId",
  author_name      AS "authorName",
  ST_X(anchor_point) AS lng,
  ST_Y(anchor_point) AS lat,
  content,
  created_at       AS "createdAt",
  updated_at       AS "updatedAt"
`);

// ─── Router ───────────────────────────────────────────────────────────────────

export const annotationsRouter = router({
  /**
   * List all annotations for a map in chronological order.
   * Auth: caller must own the map.
   */
  list: protectedProcedure
    .input(z.object({ mapId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // 1 — Viewer+ access required to list annotations
      await requireMapAccess(ctx.user.id, input.mapId, 'viewer');

      // 2 — Fetch annotations with decomposed anchor coordinates
      const rows = await typedExecute<RawAnnotationRow>(sql`
        SELECT ${ANNOTATION_COLS}
        FROM   annotations
        WHERE  map_id = ${input.mapId}::uuid
        ORDER  BY created_at ASC
      `);

      return rows.map(rowToAnnotation);
    }),

  /**
   * Create a new annotation on the map.
   * Auth: caller must own the map. Author name is denormalized from session.
   */
  create: protectedProcedure
    .input(CreateAnnotationSchema)
    .mutation(async ({ ctx, input }) => {
      // 1 — Commenter+ access required to create annotations
      await requireMapAccess(ctx.user.id, input.mapId, 'commenter');

      // 2 — Insert with PostGIS anchor encoding
      // The anchor is a validated GeoJSON Point — ST_GeomFromGeoJSON handles SRID assignment.
      const anchorGeoJSON = JSON.stringify(input.anchor);
      const contentJSON = JSON.stringify(input.content);

      const rows = await typedExecute<RawAnnotationRow>(sql`
        INSERT INTO annotations (map_id, user_id, author_name, anchor_point, content)
        VALUES (
          ${input.mapId}::uuid,
          ${ctx.user.id}::uuid,
          ${ctx.user.name},
          ST_GeomFromGeoJSON(${anchorGeoJSON}),
          ${contentJSON}::jsonb
        )
        RETURNING ${ANNOTATION_COLS}
      `);

      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create annotation.' });
      }
      return rowToAnnotation(row);
    }),

  /**
   * Update the content of an existing annotation.
   * The geographic anchor is immutable after creation (move = delete + create).
   * Auth: caller must be the annotation's author.
   */
  update: protectedProcedure
    .input(UpdateAnnotationSchema)
    .mutation(async ({ ctx, input }) => {
      // 1 — Verify existence + authorship
      const [existing] = await db
        .select({ id: annotations.id, userId: annotations.userId })
        .from(annotations)
        .where(eq(annotations.id, input.id));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Annotation not found.' });
      }
      if (existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only edit your own annotations.' });
      }

      // 2 — Update content only; anchor and author_name are immutable
      const contentJSON = JSON.stringify(input.content);

      const rows = await typedExecute<RawAnnotationRow>(sql`
        UPDATE annotations
        SET    content    = ${contentJSON}::jsonb,
               updated_at = NOW()
        WHERE  id = ${input.id}::uuid
        RETURNING ${ANNOTATION_COLS}
      `);

      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update annotation.' });
      }
      return rowToAnnotation(row);
    }),

  /**
   * Delete an annotation.
   * Auth: caller must be the annotation's author (map owners cannot delete others' pins).
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify existence + authorship in one query
      const [existing] = await db
        .select({ id: annotations.id, userId: annotations.userId })
        .from(annotations)
        .where(eq(annotations.id, input.id));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Annotation not found.' });
      }
      if (existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only delete your own annotations.' });
      }

      await db.delete(annotations).where(eq(annotations.id, input.id));
      return { deleted: true as const };
    }),

  /**
   * Fetch the IIIF NavPlace extension from a IIIF manifest URL.
   *
   * Server-side fetch avoids CORS restrictions — IIIF repositories typically
   * do not add CORS headers that allow browser-side fetches from arbitrary origins.
   *
   * Returns the navPlace GeoJSON FeatureCollection, or null if the manifest
   * does not include the NavPlace extension or if the geometry is invalid.
   *
   * Spec: https://iiif.io/api/extension/navplace/
   */
  fetchIiifNavPlace: protectedProcedure
    .input(z.object({ manifestUrl: z.string().url() }))
    .query(async ({ input }) => {
      const response = await fetch(input.manifestUrl, {
        headers: { Accept: 'application/json, application/ld+json' },
      });

      if (!response.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to fetch IIIF manifest: HTTP ${response.status}`,
        });
      }

      const manifest: unknown = await response.json();

      if (typeof manifest !== 'object' || manifest === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'IIIF manifest response is not a JSON object.',
        });
      }

      const navPlace = (manifest as Record<string, unknown>)['navPlace'];
      if (!navPlace || typeof navPlace !== 'object') return null;

      const navPlaceObj = navPlace as Record<string, unknown>;

      // navPlace can be a FeatureCollection or a single Feature per the NavPlace spec
      if (navPlaceObj['type'] === 'FeatureCollection') {
        const result = GeoJSONFeatureCollectionSchema.safeParse(navPlace);
        return result.success ? result.data : null;
      }

      if (navPlaceObj['type'] === 'Feature') {
        // Wrap the single Feature in a FeatureCollection for a uniform return type
        const fc = { type: 'FeatureCollection', features: [navPlace] };
        const result = GeoJSONFeatureCollectionSchema.safeParse(fc);
        return result.success ? result.data : null;
      }

      return null;
    }),
});
