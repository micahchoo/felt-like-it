const BASE = '/api/v1';

export function mapLinks(mapId: string) {
  return {
    self: `${BASE}/maps/${mapId}`,
    layers: `${BASE}/maps/${mapId}/layers`,
    annotations: `${BASE}/maps/${mapId}/annotations`,
    comments: `${BASE}/maps/${mapId}/comments`,
  };
}

export function layerLinks(mapId: string, layerId: string) {
  return {
    self: `${BASE}/maps/${mapId}/layers/${layerId}`,
    geojson: `${BASE}/maps/${mapId}/layers/${layerId}/geojson`,
    features: `${BASE}/maps/${mapId}/layers/${layerId}/features`,
    tiles: `${BASE}/maps/${mapId}/layers/${layerId}/tiles`,
    map: `${BASE}/maps/${mapId}`,
  };
}

export function annotationLinks(mapId: string, annotationId: string) {
  return {
    self: `${BASE}/maps/${mapId}/annotations/${annotationId}`,
    map: `${BASE}/maps/${mapId}`,
  };
}

export function commentLinks(mapId: string, commentId: string) {
  return {
    self: `${BASE}/maps/${mapId}/comments/${commentId}`,
    map: `${BASE}/maps/${mapId}`,
  };
}

/** Build links for paginated list endpoints. Adds `next` only when a cursor exists. */
export function listLinks(basePath: string, nextCursor: string | null, extra: Record<string, string> = {}) {
  const links: Record<string, string> = { self: basePath, ...extra };
  if (nextCursor) links.next = `${basePath}?cursor=${nextCursor}`;
  return links;
}
