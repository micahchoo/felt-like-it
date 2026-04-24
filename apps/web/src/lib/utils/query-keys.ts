export const queryKeys = {
  annotations: {
    all: ['annotations'] as const,
    list: (params: { mapId: string }) =>
      ['annotations', 'list', params] as const,
    thread: (params: { annotationId: string }) =>
      ['annotations', 'getThread', params] as const,
    groups: (params: { mapId: string }) =>
      ['annotations', 'listGroups', params] as const,
  },
  comments: {
    all: ['comments'] as const,
    list: (params: { mapId: string }) =>
      ['comments', 'list', params] as const,
  },
  features: {
    all: ['features'] as const,
    list: (params: { layerId: string }) =>
      ['features', 'list', params] as const,
  },
  layers: {
    all: ['layers'] as const,
    list: (params: { mapId: string }) =>
      ['layers', 'list', params] as const,
  },
} as const;
