// TYPE_DEBT: Serializers accept `Record<string, unknown>` because they normalize both raw SQL
// rows (snake_case) and Drizzle ORM results (camelCase). A union or branded row type would be
// stricter but the dual-casing fallback pattern (row.mapId ?? row.map_id) makes deep typing
// noisy. Callers are DB query sites, so the row shape is implicitly trusted.

type Row = Record<string, unknown>;

export function toMapSummary(row: Row) {
  return {
    id: row['id'],
    title: row['title'],
    description: row['description'],
    basemap: row['basemap'],
    createdAt: row['createdAt'] ?? row['created_at'],
    updatedAt: row['updatedAt'] ?? row['updated_at'],
  };
}

export function toMapDetail(row: Row) {
  return {
    ...toMapSummary(row),
    viewport: row['viewport'],
  };
}

export function toLayerSummary(row: Row) {
  return {
    id: row['id'],
    mapId: row['mapId'] ?? row['map_id'],
    name: row['name'],
    type: row['type'],
    featureCount: row['featureCount'] ?? row['feature_count'] ?? 0,
    visible: row['visible'],
    zIndex: row['zIndex'] ?? row['z_index'],
  };
}

export function toLayerDetail(row: Row) {
  return {
    ...toLayerSummary(row),
    style: row['style'],
    sourceFileName: row['sourceFileName'] ?? row['source_file_name'],
  };
}

export function toAnnotation(row: Row) {
  return {
    id: row['id'],
    mapId: row['mapId'] ?? row['map_id'],
    authorId: row['authorId'] ?? row['author_id'],
    authorName: row['authorName'] ?? row['author_name'],
    anchor: row['anchor'],
    content: row['content'],
    name: row['name'] ?? null,
    description: row['description'] ?? null,
    parentId: row['parentId'] ?? row['parent_id'],
    templateId: row['templateId'] ?? row['template_id'],
    version: row['version'],
    createdAt: row['createdAt'] ?? row['created_at'],
    updatedAt: row['updatedAt'] ?? row['updated_at'],
  };
}

export function toComment(row: Row) {
  return {
    id: row['id'],
    mapId: row['mapId'] ?? row['map_id'],
    authorId: row['userId'] ?? row['user_id'],
    authorName: row['authorName'] ?? row['author_name'],
    body: row['body'],
    resolved: row['resolved'],
    createdAt: row['createdAt'] ?? row['created_at'],
    updatedAt: row['updatedAt'] ?? row['updated_at'],
  };
}

export function toFeatureSummary(row: Row) {
  return {
    id: row['id'],
    properties: row['properties'],
    geometryType: row['geometryType'] ?? row['geometry_type'] ?? null,
  };
}
