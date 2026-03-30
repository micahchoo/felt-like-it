import type { FeatureCollection, Feature, Geometry } from 'geojson';
import type { AnnotationObject, Anchor } from '@felt-like-it/shared-types';

/**
 * Convert an annotation anchor to a GeoJSON Geometry.
 * Returns null for anchor types that don't have intrinsic geometry (feature, viewport).
 */
export function anchorToGeometry(anchor: Anchor): Geometry | null {
  switch (anchor.type) {
    case 'point':
      return anchor.geometry;
    case 'region':
      return anchor.geometry;
    case 'measurement':
      return anchor.geometry as Geometry;
    case 'feature':
      // Feature-anchored annotations reference another feature — no standalone geometry
      return null;
    case 'viewport':
      // Viewport anchors have optional bounds but no point/polygon geometry
      return null;
    default:
      return null;
  }
}

/**
 * Extract a plain-text summary from annotation content for the GeoJSON properties.
 */
function contentToText(content: AnnotationObject['content']): string {
  if (content.kind === 'single') {
    const body = content.body;
    if ('text' in body && typeof body.text === 'string') return body.text;
    if ('displayValue' in body && typeof body.displayValue === 'string') return body.displayValue;
    if ('caption' in body && typeof body.caption === 'string') return body.caption;
    return body.type;
  }
  // Slotted content — join non-null slot text values
  const texts: string[] = [];
  for (const slot of Object.values(content.slots)) {
    if (slot && 'text' in slot && typeof slot.text === 'string') texts.push(slot.text);
  }
  return texts.join(' | ') || 'slotted';
}

/**
 * Build a GeoJSON FeatureCollection from annotation objects.
 *
 * Annotations without exportable geometry (feature-anchored, viewport-anchored)
 * are excluded. Each annotation becomes a Feature with:
 *   - geometry: from the anchor's point/region/measurement
 *   - properties: id, author, text summary, timestamps, anchor type, content type
 */
export function annotationsToFeatureCollection(
  annotations: AnnotationObject[],
): FeatureCollection {
  const features: Feature[] = [];

  for (const ann of annotations) {
    const geometry = anchorToGeometry(ann.anchor);
    if (!geometry) continue;

    features.push({
      type: 'Feature',
      id: ann.id,
      geometry,
      properties: {
        annotationId: ann.id,
        authorName: ann.authorName,
        anchorType: ann.anchor.type,
        contentType: ann.content.kind === 'single' ? ann.content.body.type : 'slotted',
        text: contentToText(ann.content),
        parentId: ann.parentId,
        createdAt: ann.createdAt instanceof Date ? ann.createdAt.toISOString() : String(ann.createdAt),
        updatedAt: ann.updatedAt instanceof Date ? ann.updatedAt.toISOString() : String(ann.updatedAt),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}
