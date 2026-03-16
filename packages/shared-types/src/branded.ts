export type FeatureUUID = string & { readonly __brand: 'FeatureUUID' };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toFeatureUUID(value: string | number | undefined | null): FeatureUUID | null {
  if (typeof value !== 'string') return null;
  if (!UUID_REGEX.test(value)) return null;
  return value as FeatureUUID;
}

export function isFeatureUUID(value: unknown): value is FeatureUUID {
  return typeof value === 'string' && UUID_REGEX.test(value);
}
