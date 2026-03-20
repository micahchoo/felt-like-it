/** Encode createdAt + id into an opaque cursor string. */
export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${id}`).toString('base64url');
}

/** Decode a cursor into { createdAt, id }. Returns null if invalid. */
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString();
    const [iso, id] = decoded.split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Parse ?cursor and ?limit from URL search params. */
export function parsePaginationParams(url: URL): { cursor: ReturnType<typeof decodeCursor>; limit: number } {
  const rawCursor = url.searchParams.get('cursor');
  const rawLimit = url.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(rawLimit ?? '20', 10) || 20, 1), 100);
  return {
    cursor: rawCursor ? decodeCursor(rawCursor) : null,
    limit,
  };
}
