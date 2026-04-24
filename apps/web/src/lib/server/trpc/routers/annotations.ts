import { z } from 'zod';
import { router, protectedProcedure } from '../init.js';
import { annotationService } from '../../annotations/service.js';
import {
  convertAnnotationsToLayer,
  convertLayerFeaturesToAnnotations,
} from '../../annotations/convert.js';
import { getChangelog, getChangelogMapId } from '../../annotations/changelog.js';
import { requireMapAccess } from '../../geo/access.js';
import {
  CreateAnnotationObjectSchema,
  UpdateAnnotationObjectSchema,
  DeleteAnnotationObjectSchema,
  GeoJSONFeatureCollectionSchema,
} from '@felt-like-it/shared-types';
import { TRPCError } from '@trpc/server';

export const annotationsRouter = router({
  list: protectedProcedure
    .input(z.object({
      mapId: z.string().uuid(),
      rootsOnly: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { items } = await annotationService.list({
        userId: ctx.user.id,
        mapId: input.mapId,
        ...(input.rootsOnly !== undefined ? { rootsOnly: input.rootsOnly } : {}),
      });
      return items;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return annotationService.get({ userId: ctx.user.id, id: input.id });
    }),

  getThread: protectedProcedure
    .input(z.object({ rootId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return annotationService.getThread({ userId: ctx.user.id, rootId: input.rootId });
    }),

  /**
   * Fetch the change history for an annotation object.
   * Returns newest-first with cursor-based pagination.
   * Requires viewer+ access to the parent map.
   */
  changelog: protectedProcedure
    .input(z.object({
      annotationId: z.string().uuid(),
      limit: z.number().int().min(1).max(200).default(50),
      cursor: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Resolve the map_id from the changelog table (works even if annotation is deleted)
      const mapId = await getChangelogMapId(input.annotationId);
      if (!mapId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No changelog found for this annotation.' });
      }

      await requireMapAccess(ctx.user.id, mapId, 'viewer');

      return getChangelog({
        objectId: input.annotationId,
        limit: input.limit,
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      });
    }),

  create: protectedProcedure
    .input(CreateAnnotationObjectSchema)
    .mutation(async ({ ctx, input }) => {
      return annotationService.create({
        userId: ctx.user.id,
        userName: ctx.user.name,
        mapId: input.mapId,
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        anchor: input.anchor,
        content: input.content,
        ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      });
    }),

  update: protectedProcedure
    .input(UpdateAnnotationObjectSchema)
    .mutation(async ({ ctx, input }) => {
      return annotationService.update({
        userId: ctx.user.id,
        userName: ctx.user.name,
        id: input.id,
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.anchor !== undefined ? { anchor: input.anchor } : {}),
        // Omit vs null distinction: only spread if the input contained the key.
        ...(('name' in input) ? { name: input.name ?? null } : {}),
        ...(('description' in input) ? { description: input.description ?? null } : {}),
        version: input.version,
      });
    }),

  delete: protectedProcedure
    .input(DeleteAnnotationObjectSchema)
    .mutation(async ({ ctx, input }) => {
      return annotationService.delete({
        userId: ctx.user.id,
        userName: ctx.user.name,
        id: input.id,
        expectedVersion: input.version,
      });
    }),

  convertAnnotationsToLayer: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        annotationIds: z.array(z.string().uuid()).min(1).max(500),
        layerName: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return convertAnnotationsToLayer({
        userId: ctx.user.id,
        mapId: input.mapId,
        annotationIds: input.annotationIds,
        layerName: input.layerName,
      });
    }),

  convertLayerFeaturesToAnnotations: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        layerId: z.string().uuid(),
        featureIds: z.array(z.string().uuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return convertLayerFeaturesToAnnotations({
        userId: ctx.user.id,
        userName: ctx.user.name,
        mapId: input.mapId,
        layerId: input.layerId,
        featureIds: input.featureIds,
      });
    }),

  convertToPoint: protectedProcedure
    .input(z.object({
      mapId: z.string().uuid(),
      annotationId: z.string().uuid(),
      coordinates: z.tuple([z.number(), z.number()]),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireMapAccess(ctx.user.id, input.mapId, 'editor');
      await annotationService.convertAnchorToPoint(input.annotationId, input.mapId, input.coordinates);
    }),

  /** Fetch IIIF NavPlace extension — unchanged from legacy router. */
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

      // L4: re-validate externally-fetched navPlace against the same GeoJSON
      // schema used for locally-authored content. A malformed manifest from
      // an untrusted IIIF server must never reach the jsonb column. On
      // validation failure we return null (skip-the-field policy) so the
      // caller's annotation save proceeds without the navPlace.
      const navPlaceObj = navPlace as Record<string, unknown>;
      if (navPlaceObj['type'] === 'FeatureCollection') {
        const result = GeoJSONFeatureCollectionSchema.safeParse(navPlace);
        return result.success ? result.data : null;
      }
      if (navPlaceObj['type'] === 'Feature') {
        const fc = { type: 'FeatureCollection', features: [navPlace] };
        const result = GeoJSONFeatureCollectionSchema.safeParse(fc);
        return result.success ? result.data : null;
      }
      return null;
    }),
});
