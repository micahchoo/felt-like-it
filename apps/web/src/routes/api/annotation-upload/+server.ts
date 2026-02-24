/**
 * POST /api/annotation-upload
 *
 * Accepts a multipart upload of a single image file for use as an annotation
 * image pin. Saves the image to `$UPLOAD_DIR/annotations/` and returns an
 * absolute URL that can be stored in the `image` AnnotationContentSchema.
 *
 * Auth: authenticated users only — guests cannot upload images.
 * Size limit: 10 MB (images larger than this are unlikely to be useful in a map popup).
 * Accepted types: JPEG / PNG / WebP / GIF.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { env } from '$env/dynamic/private';

const UPLOAD_DIR = env.UPLOAD_DIR ?? '/tmp/felt-uploads';
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Allowed image MIME types → file extension for the stored filename. */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

export const POST: RequestHandler = async ({ request, locals, url }) => {
  if (!locals.user) {
    error(401, 'Unauthorized');
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file || !(file instanceof File)) {
    error(400, 'No file provided');
  }

  const ext = ALLOWED_MIME[file.type];
  if (!ext) {
    error(415, 'Unsupported image type. Accepted: JPEG, PNG, WebP, GIF.');
  }

  if (file.size > MAX_SIZE_BYTES) {
    error(413, `Image exceeds 10 MB limit (received ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // Store under UPLOAD_DIR/annotations/{uuid}.{ext}
  // The UUID filename prevents path traversal and name collisions.
  const filename = `${randomUUID()}.${ext}`;
  const annotationDir = join(UPLOAD_DIR, 'annotations');

  await mkdir(annotationDir, { recursive: true });
  await writeFile(join(annotationDir, filename), Buffer.from(await file.arrayBuffer()));

  // Return an absolute URL so the value passes z.string().url() validation
  // and works correctly whether the client is on the same host or a different origin.
  const imageUrl = `${url.origin}/api/annotation-images/${filename}`;

  return json({ url: imageUrl });
};
