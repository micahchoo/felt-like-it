import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const mergeRouters = t.mergeRouters;

// Log slow calls (>500ms) always; log all calls when DEBUG=true
const debug = process.env['DEBUG'] === 'true';
const SLOW_MS = 500;

const timingMiddleware = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const ms = Date.now() - start;
  if (debug || ms > SLOW_MS) {
    const tag = result.ok ? 'tRPC' : 'tRPC:ERR';
    if (result.ok) {
      console.warn(`[${tag}] ${type} ${path} ${ms}ms`);
    } else {
      console.error(`[${tag}] ${type} ${path} ${ms}ms`);
    }
  }
  return result;
});

/** Public procedure — no auth required */
export const publicProcedure = t.procedure.use(timingMiddleware);

/** Protected procedure — requires authenticated session */
export const protectedProcedure = t.procedure.use(timingMiddleware).use(({ ctx, next }) => {
  if (!ctx.user || !ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You must be logged in.' });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      session: ctx.session,
    },
  });
});
