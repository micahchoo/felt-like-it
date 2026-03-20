import { fslFiltersToMapLibre } from '@felt-like-it/geo-engine';
import type { GeoJSONFeature } from '@felt-like-it/shared-types';

// ─── Types ─────────────────────────────────────────────────────────────────

export type FilterOperator = 'eq' | 'ne' | 'lt' | 'gt' | 'cn' | 'in' | 'ni';

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: '=',
  ne: '≠',
  lt: '<',
  gt: '>',
  cn: 'contains',
  in: 'one of',
  ni: 'not in',
};

export interface UIFilter {
  field: string;
  operator: FilterOperator;
  value: string;
}

// ─── State ──────────────────────────────────────────────────────────────────

/** Per-layer active UI filters. Ephemeral — not persisted to the server. */
let _filters = $state<Record<string, UIFilter[]>>({});

// ─── Client-side filter evaluator ───────────────────────────────────────────

function matchesFilter(properties: Record<string, unknown>, filter: UIFilter): boolean {
  const val = properties[filter.field];
  const raw = filter.value;
  switch (filter.operator) {
    case 'eq': return String(val ?? '') === raw;
    case 'ne': return String(val ?? '') !== raw;
    case 'lt': return Number(val) < Number(raw);
    case 'gt': return Number(val) > Number(raw);
    case 'cn': return String(val ?? '').toLowerCase().includes(raw.toLowerCase());
    case 'in': {
      const allowed = raw.split(',').map((s) => s.trim());
      return allowed.includes(String(val ?? ''));
    }
    case 'ni': {
      const excluded = raw.split(',').map((s) => s.trim());
      return !excluded.includes(String(val ?? ''));
    }
    default: return true;
  }
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const filterStore = {
  /** Get active filters for a layer (returns [] when none). Defensive copy — caller cannot mutate internal state. */
  get(layerId: string): UIFilter[] {
    return [...(_filters[layerId] ?? [])];
  },

  /** True when this layer has at least one active filter. */
  hasFilters(layerId: string): boolean {
    return (_filters[layerId]?.length ?? 0) > 0;
  },

  /** Append a filter for a layer. */
  add(layerId: string, filter: UIFilter): void {
    _filters = { ..._filters, [layerId]: [...(_filters[layerId] ?? []), filter] };
  },

  /** Remove the filter at the given index for a layer. */
  remove(layerId: string, index: number): void {
    const current = _filters[layerId] ?? [];
    _filters = { ..._filters, [layerId]: current.filter((_, i) => i !== index) };
  },

  /** Remove all filters for a layer. */
  clear(layerId: string): void {
    _filters = { ..._filters, [layerId]: [] };
  },

  /**
   * Convert active UI filters to a MapLibre filter expression for map rendering.
   * Returns undefined when no filters are active (MapLibre renders all features).
   */
  toMapLibreFilter(layerId: string): unknown[] | undefined {
    const filters = _filters[layerId];
    if (!filters || filters.length === 0) return undefined;
    const fslFilters = filters.map((f) => [f.field, f.operator, f.value]);
    return fslFiltersToMapLibre(fslFilters) ?? undefined;
  },

  /**
   * Apply active UI filters to a GeoJSON features array.
   * Used in the DataTable to filter rows client-side, keeping map + table in sync.
   */
  applyToFeatures(layerId: string, features: GeoJSONFeature[]): GeoJSONFeature[] {
    const filters = _filters[layerId];
    if (!filters || filters.length === 0) return features;
    return features.filter((f) =>
      filters.every((filter) => matchesFilter(f.properties ?? {}, filter))
    );
  },
};
