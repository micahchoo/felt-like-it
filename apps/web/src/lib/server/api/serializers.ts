export function toMapSummary(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    basemap: row.basemap,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

export function toMapDetail(row: any) {
  return {
    ...toMapSummary(row),
    viewport: row.viewport,
  };
}

export function toLayerSummary(row: any) {
  return {
    id: row.id,
    mapId: row.mapId ?? row.map_id,
    name: row.name,
    type: row.type,
    featureCount: row.featureCount ?? row.feature_count ?? 0,
    visible: row.visible,
    zIndex: row.zIndex ?? row.z_index,
  };
}

export function toLayerDetail(row: any) {
  return {
    ...toLayerSummary(row),
    style: row.style,
    sourceFileName: row.sourceFileName ?? row.source_file_name,
  };
}

export function toAnnotation(row: any) {
  return {
    id: row.id,
    mapId: row.mapId ?? row.map_id,
    authorId: row.authorId ?? row.author_id,
    authorName: row.authorName ?? row.author_name,
    anchor: row.anchor,
    content: row.content,
    parentId: row.parentId ?? row.parent_id,
    templateId: row.templateId ?? row.template_id,
    version: row.version,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

export function toComment(row: any) {
  return {
    id: row.id,
    mapId: row.mapId ?? row.map_id,
    authorId: row.userId ?? row.user_id,
    authorName: row.authorName ?? row.author_name,
    body: row.body,
    resolved: row.resolved,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

export function toFeatureSummary(row: any) {
  return {
    id: row.id,
    properties: row.properties,
    geometryType: row.geometryType ?? row.geometry_type ?? null,
  };
}
