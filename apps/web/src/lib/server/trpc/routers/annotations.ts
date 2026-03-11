import { z } from 'zod';
import { router, protectedProcedure } from '../init.js';
import { annotationService } from '../../annotations/service.js';
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
      return annotationService.list({
        userId: ctx.user.id,
        mapId: input.mapId,
        ...(input.rootsOnly !== undefined ? { rootsOnly: input.rootsOnly } : {}),
      });
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
      });
    }),

  update: protectedProcedure
    .input(UpdateAnnotationObjectSchema)
    .mutation(async ({ ctx, input }) => {
      return annotationService.update({
        userId: ctx.user.id,
        userName: ctx.user.name,
        id: input.id,
        content: input.content,
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
      });
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
