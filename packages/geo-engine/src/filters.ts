/**
 * FSL filter expression → MapLibre GL filter expression converter.
 *
 * FSL filters use infix notation: [identifier, operator, operand]
 * This converter produces MapLibre's legacy filter syntax which is widely
 * supported across MapLibre versions.
 *
 * Supported FSL operators:
 *   lt  → ["<",  ["get", field], value]
 *   gt  → [">",  ["get", field], value]
 *   le  → ["<=", ["get", field], value]
 *   ge  → [">=", ["get", field], value]
 *   eq  → ["==", ["get", field], value]
 *   ne  → ["!=", ["get", field], value]
 *   cn  → ["in", value, ["get", field]]   (string "contains" via "in" text search)
 *   in  → ["in", ["get", field], ...values]
 *   ni  → ["!in", ["get", field], ...values]
 *   and → ["all", ...convertedFilters]
 *   or  → ["any", ...convertedFilters]
 */

/** A raw FSL filter — a 3-element array of [field, operator, operand]. */
export type FslFilter = [string, string, unknown];

/** A MapLibre GL filter expression — nested array. */
export type MaplibreFilter = unknown[];

/**
 * Convert a single FSL filter expression to a MapLibre filter expression.
 * Throws if the operator is unknown or the structure is invalid.
 */
export function fslFilterToMapLibre(filter: unknown): MaplibreFilter {
  if (!Array.isArray(filter) || filter.length !== 3) {
    throw new Error(`FSL filter must be a 3-element array, got: ${JSON.stringify(filter)}`);
  }

  const [field, op, operand] = filter as [unknown, unknown, unknown];

  if (typeof op !== 'string') {
    throw new Error(`FSL operator must be a string, got: ${JSON.stringify(op)}`);
  }

  // Compound operators: and / or — operand is array of sub-filters
  if (op === 'and' || op === 'or') {
    if (!Array.isArray(operand)) {
      throw new Error(`FSL '${op}' operator requires an array of sub-filters as operand`);
    }
    const maplibreOp = op === 'and' ? 'all' : 'any';
    return [maplibreOp, ...operand.map(fslFilterToMapLibre)];
  }

  // All other operators require field to be a string
  if (typeof field !== 'string') {
    throw new Error(`FSL filter field must be a string, got: ${JSON.stringify(field)}`);
  }

  const get = ['get', field];

  switch (op) {
    case 'lt': return ['<', get, operand];
    case 'gt': return ['>', get, operand];
    case 'le': return ['<=', get, operand];
    case 'ge': return ['>=', get, operand];
    case 'eq': return ['==', get, operand];
    case 'ne': return ['!=', get, operand];
    case 'cn':
      // "contains" — MapLibre doesn't have a native contains, so we use a case-sensitive
      // step: ["in", searchValue, ["get", field]] works for MapLibre GL expression syntax
      return ['in', operand, get];
    case 'in': {
      if (!Array.isArray(operand)) {
        throw new Error(`FSL 'in' operator requires an array operand, got: ${JSON.stringify(operand)}`);
      }
      return ['in', get, ...operand];
    }
    case 'ni': {
      if (!Array.isArray(operand)) {
        throw new Error(`FSL 'ni' operator requires an array operand, got: ${JSON.stringify(operand)}`);
      }
      return ['!in', get, ...operand];
    }
    default:
      throw new Error(`Unknown FSL filter operator: "${op}"`);
  }
}

/**
 * Convert an array of FSL filter expressions to a single MapLibre filter expression.
 * Multiple top-level filters are combined with "all" (AND semantics).
 * Returns null if the filters array is empty.
 */
export function fslFiltersToMapLibre(filters: unknown[]): MaplibreFilter | null {
  if (filters.length === 0) return null;
  if (filters.length === 1) {
    const first = filters[0];
    if (first === undefined) return null;
    return fslFilterToMapLibre(first);
  }
  return ['all', ...filters.map(fslFilterToMapLibre)];
}
