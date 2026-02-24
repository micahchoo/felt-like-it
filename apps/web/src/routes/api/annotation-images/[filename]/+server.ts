/**
 * GET /api/annotation-images/[filename]
 *
 * Serves uploaded annotation images from `$UPLOAD_DIR/annotations/`.
 *
 * Filename format: `{uuid}.{ext}` — enforced by a strict regex so only
 * UUID-named files with known image extensions can be read.
 * This prevents path traversal (no `..`, no slashes, no arbitrary extensions).
 *
 * No auth required — annotation images are semi-public (URLs are unguessable
 * UUIDs). A future hardening pass could add map-ownership checks if needed.
 */

import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { env } from '$env/dynamic/private';

const UPLOAD_DIR = env.UPLOAD_DIR ?? '/tmp/felt-uploads';

/** Strict allowlist — must match what the upload endpoint stores. */
const FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/i;

const MIME: Record<string, string> = {
  jpg:  'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
  gif:  'image/gif',
};

export const GET: RequestHandler = async ({ params }) => {
  const { filename } = params;

  // Reject anything that doesn't look like a UUID-named image file
  if (!FILENAME_RE.test(filename)) {
    return new Response('Not found', { status: 404 });
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const contentType = MIME[ext];
  if (!contentType) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const buffer = await readFile(join(UPLOAD_DIR, 'annotations', filename));
    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        // Allow browsers to cache for up to a day; UUIDs are immutable
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
