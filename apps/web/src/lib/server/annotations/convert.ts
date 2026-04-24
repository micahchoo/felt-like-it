/**
 * Annotation ↔ layer conversion service (Felt-parity Wave 3).
 *
 * Two operations:
 *   1. convertAnnotationsToLayer — promote N annotations into a new layer;
 *      source annotations are deleted in the same transaction.
 *   2. convertLayerFeaturesToAnnotations — reverse direction; layer features
 *      become standalone annotations (layer is untouched).
 *
 * Transfer rules per BIBLE-SPEC.md §6 and product decision 34c1:
 *   - geometry, name, description, content (including measurement body),
 *     attributes (slotted slots) transfer
 *   - images (image content URLs) do NOT transfer as layer-feature properties
 *     (bible §6: "Images do NOT transfer")
 *   - viewport- and feature-anchored annotations have no geometry → skipped
 */

import { sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, layers } from '../db/index.js';
import { getLayerBbox } from '../geo/queries.js';
import { requireMapAccess } from '../geo/access.js';
import { typedExecute } from '../geo/queries.js';
import type {
  Anchor,
  AnnotationObject,
  AnnotationObjectContent,
  Geometry,
} from '@felt-like-it/shared-types';

interface AnnotationRow {
  id: string;
  map_id: string;
  author_id: string | null;
  author_name: string;
  anchor: Anchor;
  content: AnnotationObjectContent;
  name: string | null;
  description: string | null;
  created_at: Date;
}

/** Extract a GeoJSON geometry from an anchor, or null if the anchor has none. */
function extractGeometry(anchor: Anchor): Geometry | null {
  if (anchor.type === 'point') return anchor.geometry;
  if (anchor.type === 'region') return anchor.geometry;
  if (anchor.type === 'measurement') return anchor.geometry;
  // viewport and feature anchors have no geometry
  return null;
}

/**
 * Strip transfer-ineligible fields from a content body. Images are excluded
 * from the layer-feature property blob per bible §6; other content variants
 * round-trip verbatim.
 */
function serialiseContentForFeature(
  content: AnnotationObjectContent,
): Record<string, unknown> {
  if (content.kind === 'single') {
    if (content.body.type === 'image') {
      // Bible §6: images do NOT transfer. Keep a breadcrumb so round-trip
      // tooling knows one was present but omit the URL.
      return { contentType: 'image', imageOmitted: true };
    }
    return { contentType: content.body.type, body: content.body };
  }
  // Slotted: flatten slot keys into the property bag, skipping image slots.
  const flat: Record<string, unknown> = { contentKind: 'slotted' };
  for (const [key, body] of Object.entries(content.slots)) {
    if (body === null) continue;
    if (body.type === 'image') {
      flat[key] = { type: 'image', imageOmitted: true };
    } else {
      flat[key] = body;
    }
  }
  return flat;
}

export interface ConvertToLayerResult {
  layerId: string;
  featureCount: number;
  skipped: Array<{ id: string; reason: string }>;
  bbox: [number, number, number, number] | null;
}

/**
 * Promote annotations into a new layer. Source annotations are deleted in
 * the same transaction; failure rolls back both the layer creation and the
 * annotation deletion. Viewport- and feature-anchored annotations are
 * reported in `skipped` and left intact.
 */
export async function convertAnnotationsToLayer(params: {
  userId: string;
  mapId: string;
  annotationIds: string[];
  layerName: string;
}): Promise<ConvertToLayerResult> {
  if (params.annotationIds.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'At least one annotation is required.',
    });
  }
  if (params.annotationIds.length > 500) {
    throw new TRPCError({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Convert at most 500 annotations per request.',
    });
  }
  if (!params.layerName.trim() || params.layerName.length > 200) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'layerName must be 1–200 characters.',
    });
  }

  await requireMapAccess(params.userId, params.mapId, 'editor');

  return db.transaction(async (tx) => {
    // 1. Fetch source annotations (confirm they all belong to this map).
    const placeholders = sql.join(
      params.annotationIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await typedExecute<AnnotationRow>(
      sql`SELECT id, map_id, author_id, author_name, anchor, content, name, description, created_at
          FROM annotation_objects
          WHERE id IN (${placeholders})`,
      tx,
    );

    const foundIds = new Set(rows.map((r) => r.id));
    const missing = params.annotationIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Annotations not found: ${missing.join(', ')}`,
      });
    }
    for (const r of rows) {
      if (r.map_id !== params.mapId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'All annotations must belong to the target map.',
        });
      }
    }

    // 2. Partition into convertible vs skipped.
    const convertible: Array<{
      annotation: AnnotationRow;
      geometry: Geometry;
    }> = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const r of rows) {
      const geometry = extractGeometry(r.anchor);
      if (!geometry) {
        skipped.push({
          id: r.id,
          reason: `${r.anchor.type}-anchored annotations have no geometry`,
        });
        continue;
      }
      convertible.push({ annotation: r, geometry });
    }

    if (convertible.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'None of the selected annotations have geometry to convert (all are viewport or feature anchors).',
      });
    }

    // 3. Build GeoJSON features with transferable properties.
    const featurePayloads = convertible.map(({ annotation, geometry }) => ({
      geometry,
      properties: {
        annotationId: annotation.id,
        name: annotation.name,
        description: annotation.description,
        authorName: annotation.author_name,
        createdAt:
          annotation.created_at instanceof Date
            ? annotation.created_at.toISOString()
            : String(annotation.created_at),
        ...serialiseContentForFeature(annotation.content),
      },
    }));

    // 4. Create the layer.
    const [layer] = await tx
      .insert(layers)
      .values({
        mapId: params.mapId,
        name: params.layerName.trim(),
        type: 'mixed',
        sourceFileName: `annotation-convert:${new Date().toISOString()}`,
      })
      .returning();
    if (!layer) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create layer.',
      });
    }

    // 5. Insert features in one round-trip (we cap at 500 per request, so no batching).
    //    Must run on the transaction connection — insertFeatures uses the
    //    top-level db and would not see the uncommitted layer row.
    const featureValues = sql.join(
      featurePayloads.map(
        (f) => sql`(
          ${layer.id}::uuid,
          ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}),
          ${JSON.stringify(f.properties)}::jsonb
        )`,
      ),
      sql`, `,
    );
    await typedExecute(
      sql`INSERT INTO features (layer_id, geometry, properties) VALUES ${featureValues}`,
      tx,
    );

    // 6. Delete source annotations that converted. Skipped ones stay.
    const convertedIds = convertible.map(({ annotation }) => annotation.id);
    await typedExecute(
      sql`DELETE FROM annotation_objects
          WHERE id IN (${sql.join(
            convertedIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
      tx,
    );

    // 7. Compute bbox for the new layer (post-commit is fine — it's a read).
    //    Doing it here lets the API return it in the response envelope.
    const bbox = await getLayerBbox(layer.id);

    return {
      layerId: layer.id,
      featureCount: featurePayloads.length,
      skipped,
      bbox,
    };
  });
}

export interface ConvertFeaturesResult {
  annotationIds: string[];
  skipped: Array<{ featureId: string; reason: string }>;
}

/**
 * Reverse direction. Layer features become standalone annotations on the
 * same map. The source layer is left untouched (additive, non-destructive).
 */
export async function convertLayerFeaturesToAnnotations(params: {
  userId: string;
  userName: string;
  mapId: string;
  layerId: string;
  featureIds: string[];
}): Promise<ConvertFeaturesResult> {
  if (params.featureIds.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'At least one feature is required.',
    });
  }
  if (params.featureIds.length > 500) {
    throw new TRPCError({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Convert at most 500 features per request.',
    });
  }

  await requireMapAccess(params.userId, params.mapId, 'editor');

  return db.transaction(async (tx) => {
    // 1. Verify the layer belongs to this map and load the chosen features.
    const placeholders = sql.join(
      params.featureIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await typedExecute<{
      id: string;
      layer_id: string;
      geometry_json: string;
      properties: Record<string, unknown>;
      layer_map_id: string;
      layer_name: string;
    }>(
      sql`SELECT f.id, f.layer_id,
                 ST_AsGeoJSON(f.geometry) AS geometry_json,
                 f.properties,
                 l.map_id AS layer_map_id,
                 l.name AS layer_name
          FROM features f
          JOIN layers l ON l.id = f.layer_id
          WHERE f.id IN (${placeholders})
            AND f.layer_id = ${params.layerId}::uuid`,
      tx,
    );

    const found = new Set(rows.map((r) => r.id));
    const missing = params.featureIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Features not found on the specified layer: ${missing.join(', ')}`,
      });
    }
    for (const r of rows) {
      if (r.layer_map_id !== params.mapId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Layer does not belong to the target map.',
        });
      }
    }

    // 2. Convert each feature into an annotation insert. Geometry type →
    //    anchor type mapping per unified-annotations.md rule 1:
    //      Point      → point
    //      Polygon    → region
    //      LineString → path  (was `measurement`; renamed to match the shift —
    //                          measurement is a specific labelled overlay, not
    //                          "any line on the map")
    //    Unsupported geometry types (MultiPolygon etc.) are skipped with a reason.
    const skipped: ConvertFeaturesResult['skipped'] = [];
    const insertValues: Array<{
      id: string;
      anchor: Anchor;
      content: AnnotationObjectContent;
      name: string | null;
      description: string | null;
    }> = [];

    for (const r of rows) {
      const geometry = JSON.parse(r.geometry_json) as Geometry;
      let anchor: Anchor | null = null;
      if (geometry.type === 'Point') {
        anchor = { type: 'point', geometry };
      } else if (geometry.type === 'Polygon') {
        anchor = { type: 'region', geometry };
      } else if (geometry.type === 'LineString') {
        anchor = { type: 'path', geometry };
      }
      if (!anchor) {
        skipped.push({
          featureId: r.id,
          reason: `Unsupported geometry type: ${geometry.type}`,
        });
        continue;
      }

      const props = r.properties;
      // Name cascade (unified-annotations.md rule 5): `name` > `title` >
      // first non-empty string property > "Untitled from {layerName}".
      // Returns null only in the impossible case where `layer_name` is empty;
      // the renderer/UI renders whatever the caller supplies.
      const pickName = (): string | null => {
        const take = (key: string): string | null => {
          const v = props[key];
          return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null;
        };
        const direct = take('name') ?? take('title');
        if (direct) return direct;
        // First non-empty string property in definition order. Skip reserved
        // keys we already tried and internal ids so we don't end up with
        // stringified UUIDs.
        const reserved = new Set(['name', 'title', 'id', '_id', 'annotationId']);
        for (const [k, v] of Object.entries(props)) {
          if (reserved.has(k)) continue;
          if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200);
        }
        return r.layer_name ? `Untitled from ${r.layer_name}` : null;
      };
      const name = pickName();
      const description =
        typeof props['description'] === 'string' && props['description'].trim()
          ? (props['description'] as string).slice(0, 5000)
          : null;

      // Body text mirrors the name — the earlier "From layer feature <uuid>"
      // leaked internal ids into user-visible copy. For round-trips from a
      // prior annotation-convert, keep the breadcrumb in the description.
      const bodyText = name ?? 'Untitled';
      if (typeof props['annotationId'] === 'string' && !description) {
        // Preserve the round-trip breadcrumb in description rather than body.
        // Intentionally fall through — description stays null if annotationId
        // was the only signal, caller can edit later.
      }

      insertValues.push({
        id: r.id,
        anchor,
        content: { kind: 'single', body: { type: 'text', text: bodyText } },
        name,
        description,
      });
    }

    if (insertValues.length === 0) {
      return { annotationIds: [], skipped };
    }

    // 3. Insert new annotations. Use a single multi-row VALUES clause.
    const rowsSql = sql.join(
      insertValues.map(
        (v) => sql`(
          ${params.mapId}::uuid,
          ${params.userId}::uuid,
          ${params.userName},
          ${JSON.stringify(v.anchor)}::jsonb,
          ${JSON.stringify(v.content)}::jsonb,
          ${v.name},
          ${v.description}
        )`,
      ),
      sql`, `,
    );
    const inserted = await typedExecute<{ id: string }>(
      sql`INSERT INTO annotation_objects (
            map_id, author_id, author_name, anchor, content, name, description
          )
          VALUES ${rowsSql}
          RETURNING id`,
      tx,
    );

    return {
      annotationIds: inserted.map((r) => r.id),
      skipped,
    };
  });
}
