/** Format a number to a fixed number of decimal places, trimming trailing zeros */
export function formatNumber(n: number, decimals = 4): string {
  return parseFloat(n.toFixed(decimals)).toString();
}

/** Format coordinate pair as a human-readable string */
export function formatCoords(lng: number, lat: number): string {
  return `${formatNumber(lat, 5)}, ${formatNumber(lng, 5)}`;
}

/** Format file size to human-readable string */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = sizes[i];
  if (size === undefined) return `${bytes} B`;
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${size}`;
}

/** Format any value for display in the data table */
export function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') return formatNumber(val, 4);
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (val instanceof Date) return val.toLocaleString();
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Format a value using FSL attribute format options.
 * Falls back to formatValue() when no format options are provided.
 */
export function formatAttributeValue(
  val: unknown,
  format?: { mantissa?: number | undefined; thousandSeparated?: boolean | undefined }
): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number' && format !== undefined) {
    const mantissa = format.mantissa ?? 4;
    const fixed = val.toFixed(mantissa);
    if (format.thousandSeparated) {
      const [intPart, decPart] = fixed.split('.');
      const withCommas = (intPart ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return decPart !== undefined && mantissa > 0 ? `${withCommas}.${decPart}` : withCommas;
    }
    // Remove trailing zeros only when no explicit mantissa was requested
    return format.mantissa === undefined ? parseFloat(fixed).toString() : fixed;
  }
  return formatValue(val);
}

/** Format a date as a relative time string (e.g., "2 hours ago") */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
