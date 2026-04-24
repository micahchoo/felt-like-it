import { z } from 'zod';

/**
 * Measure the maximum nesting depth of a JSON-shaped value.
 *
 * Depth counts container nesting — the root object/array is depth 1, a value
 * nested one level inside is depth 2, etc. Primitives (string, number, bool,
 * null, undefined) are depth 0 so they contribute nothing when the root is
 * itself a primitive.
 *
 * Iterative (not recursive) so a maliciously deep payload doesn't blow the
 * call stack before the depth cap fires. Cycles are impossible in JSON.parse
 * output but we guard anyway via a seen-set to keep the helper safe for any
 * plain-object input a caller hands us.
 */
export function measureDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;

  const seen = new WeakSet<object>();
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
  let max = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    const { node, depth } = frame;
    if (depth > max) max = depth;

    if (node === null || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const child of node) {
        if (child !== null && typeof child === 'object') {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
    } else {
      for (const child of Object.values(node as Record<string, unknown>)) {
        if (child !== null && typeof child === 'object') {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
    }
  }

  return max;
}

/**
 * Zod refinement guarding against excessively nested jsonb-bound input.
 *
 * Usage:
 *   const Schema = SomeJsonSchema.superRefine(depthLimit(20));
 *
 * or as a standalone pipe step:
 *   const Guarded = z.unknown().superRefine(depthLimit(20)).pipe(SomeJsonSchema);
 *
 * Emits a `custom` issue with code `too_big` semantics when depth exceeds max.
 */
export function depthLimit(maxDepth: number) {
  return (value: unknown, ctx: z.RefinementCtx): void => {
    const depth = measureDepth(value);
    if (depth > maxDepth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Nested structure exceeds max depth of ${maxDepth} (got ${depth})`,
      });
    }
  };
}
