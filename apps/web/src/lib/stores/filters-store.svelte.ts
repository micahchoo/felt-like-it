import { fslFiltersToMapLibre } from '@felt-like-it/geo-engine';
import type { FilterOperator, UIFilter } from './filters.svelte.js';

export type FieldType = 'string' | 'number' | 'boolean';

export interface FilterCondition extends UIFilter {}

/**
 * Map-scoped filter store with URL reflection and type inference.
 * Replaces the module-level singleton with an instance-per-map class.
 */
export class FiltersStore {
  conditions = $state<FilterCondition[]>([]);
  fieldTypes = $state<Record<string, FieldType>>({});
  readonly mapId: string;

  constructor(mapId: string) {
    this.mapId = mapId;
    // Initialize from URL if present
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      this.fromUrlParams(params);
    }
  }

  addCondition(condition: FilterCondition): void {
    this.conditions = [...this.conditions, condition];
    this.syncToUrl();
  }

  removeCondition(index: number): void {
    this.conditions = this.conditions.filter((_, i) => i !== index);
    this.syncToUrl();
  }

  updateCondition(index: number, updates: Partial<FilterCondition>): void {
    this.conditions = this.conditions.map((c, i) => (i === index ? { ...c, ...updates } : c));
    this.syncToUrl();
  }

  clearAll(): void {
    this.conditions = [];
    this.syncToUrl();
  }

  /** Infer field types from first N sample features. */
  inferFields(features: Array<{ properties: Record<string, unknown> }>): Record<string, FieldType> {
    const sample = features.slice(0, 100);
    const types: Record<string, Set<string>> = {};

    for (const feature of sample) {
      for (const [key, value] of Object.entries(feature.properties ?? {})) {
        if (!types[key]) types[key] = new Set();
        if (value !== null && value !== undefined) {
          types[key].add(typeof value);
        }
      }
    }

    const result: Record<string, FieldType> = {};
    for (const [key, typeSet] of Object.entries(types)) {
      if (typeSet.has('number')) result[key] = 'number';
      else if (typeSet.has('boolean')) result[key] = 'boolean';
      else result[key] = 'string';
    }

    this.fieldTypes = result;
    return result;
  }

  /** Serialize conditions to URLSearchParams. */
  toUrlParams(): URLSearchParams {
    const params = new URLSearchParams();
    for (const cond of this.conditions) {
      params.append('filter', `${cond.field}:${cond.operator}:${encodeURIComponent(cond.value)}`);
    }
    return params;
  }

  /** Deserialize conditions from URLSearchParams. */
  fromUrlParams(params: URLSearchParams): void {
    const filters = params.getAll('filter');
    this.conditions = filters
      .map((raw) => {
        const parts = raw.split(':');
        if (parts.length < 3) return null;
        const field = parts[0];
        const operator = parts[1] as FilterOperator;
        const value = decodeURIComponent(parts.slice(2).join(':'));
        const validOperators: FilterOperator[] = ['eq', 'ne', 'lt', 'gt', 'cn', 'in', 'ni'];
        if (!validOperators.includes(operator)) return null;
        return { field, operator, value };
      })
      .filter((c): c is FilterCondition => c !== null);
  }

  /** Sync current conditions to browser URL. */
  syncToUrl(): void {
    if (typeof window === 'undefined') return;
    const params = this.toUrlParams();
    const newQuery = params.toString();
    const currentQuery = window.location.search.slice(1);
    if (newQuery !== currentQuery) {
      const url = new URL(window.location.href);
      url.search = newQuery;
      window.history.replaceState({}, '', url.toString());
    }
  }

  /** Convert conditions to a MapLibre filter expression. */
  toMapLibreFilter(_layerId: string): unknown[] | undefined {
    if (this.conditions.length === 0) return undefined;
    const fslFilters = this.conditions.map((f) => [f.field, f.operator, f.value]);
    return fslFiltersToMapLibre(fslFilters) ?? undefined;
  }

  /** Apply conditions to features array (for DataTable filtering). */
  applyToFeatures(features: Array<{ properties: Record<string, unknown> }>): typeof features {
    if (this.conditions.length === 0) return features;
    return features.filter((f) =>
      this.conditions.every((cond) => matchesFilter(f.properties ?? {}, cond))
    );
  }
}

function matchesFilter(properties: Record<string, unknown>, filter: UIFilter): boolean {
  const val = properties[filter.field];
  const raw = filter.value;
  switch (filter.operator) {
    case 'eq':
      return String(val ?? '') === raw;
    case 'ne':
      return String(val ?? '') !== raw;
    case 'lt':
      return Number(val) < Number(raw);
    case 'gt':
      return Number(val) > Number(raw);
    case 'cn':
      return String(val ?? '')
        .toLowerCase()
        .includes(raw.toLowerCase());
    case 'in': {
      const allowed = raw.split(',').map((s) => s.trim());
      return allowed.includes(String(val ?? ''));
    }
    case 'ni': {
      const excluded = raw.split(',').map((s) => s.trim());
      return !excluded.includes(String(val ?? ''));
    }
    default:
      return true;
  }
}
