import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '$lib/server/trpc/router.js';
import { createContext } from '$lib/server/trpc/context.js';
import type { RequestEvent } from '@sveltejs/kit';

function handler(event: RequestEvent) {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req: event.request,
    router: appRouter,
    createContext: () => createContext(event),
    onError: ({ path, error }) => {
      // Always log 5xx (INTERNAL_SERVER_ERROR); log 4xx only outside production
      const isInternal = error.code === 'INTERNAL_SERVER_ERROR';
      if (isInternal || process.env['NODE_ENV'] !== 'production') {
        console.error(`[tRPC] ${error.code} /${path ?? '?'} — ${error.message}`);
      }
      if (isInternal) {
        const cause = error.cause;
        if (cause instanceof Error && cause.stack) {
          console.error(cause.stack);
        } else if (cause) {
          console.error(cause);
        }
      }
    },
  });
}

export const GET = handler;
export const POST = handler;
