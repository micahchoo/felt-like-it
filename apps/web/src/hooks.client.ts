import type { HandleClientError } from '@sveltejs/kit';

/**
 * SvelteKit client-side error handler.
 * Catches errors that occur during client-side navigation and load functions.
 * Reports them to the server so they appear in docker logs.
 */
export const handleError: HandleClientError = ({ error, event, status, message }) => {
  const path = event.url.pathname;
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);

  console.error(`[CLIENT ERROR] ${status} ${path} — ${message}`);
  console.error(stack);

  // Report to server so it surfaces in docker logs
  void reportToServer({ type: 'navigation', status, path, message, stack });

  return { message: status === 404 ? 'Not found' : 'An unexpected error occurred' };
};

function reportToServer(payload: Record<string, unknown>): Promise<void> {
  return fetch('/api/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(() => undefined).catch(() => undefined);
}
