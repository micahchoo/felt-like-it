import type { RequestHandler } from './$types';

/**
 * Receives client-side error reports and logs them server-side.
 * This makes JS crashes visible in docker logs without browser devtools.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { type, status, path, message, stack } = body;
    console.error(`[CLIENT:${String(type ?? 'error').toUpperCase()}] ${String(status ?? '')} ${String(path ?? '')} — ${String(message ?? '')}`);
    if (stack && stack !== message) {
      console.error(String(stack));
    }
  } catch {
    // Ignore malformed payloads
  }
  return new Response(null, { status: 204 });
};
