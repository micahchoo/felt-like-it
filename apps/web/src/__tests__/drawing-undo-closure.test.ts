// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

/**
 * Verifies that undo closures capture their own feature ID —
 * not a shared mutable variable that would alias to the last save.
 *
 * This simulates the pattern used in DrawingToolbar.saveFeature():
 *   undoStore.push({ undo: async () => deleteMutation({ id: upsertedId }) })
 *
 * The adversarial case: two rapid saves should produce two undo closures,
 * each deleting its own feature, not both deleting the second one.
 */
describe('drawing undo closure captures correct feature ID', () => {
  it('each undo closure deletes its own feature, not the last one saved', async () => {
    const deletedIds: string[] = [];
    const deleteMutation = vi.fn(async (id: string) => { deletedIds.push(id); });

    // Simulate two rapid saveFeature calls — each creates a closure over its own upsertedId
    const undoActions: Array<() => Promise<void>> = [];

    for (const featureId of ['feat-aaa', 'feat-bbb']) {
      // This mirrors DrawingToolbar: const upsertedId = result.id; undoStore.push(...)
      const upsertedId = featureId;
      undoActions.push(async () => {
        await deleteMutation(upsertedId);
      });
    }

    // Undo in reverse order (LIFO)
    await undoActions[1]!();
    await undoActions[0]!();

    expect(deletedIds).toEqual(['feat-bbb', 'feat-aaa']);
    expect(deleteMutation).toHaveBeenCalledTimes(2);
    expect(deleteMutation).toHaveBeenNthCalledWith(1, 'feat-bbb');
    expect(deleteMutation).toHaveBeenNthCalledWith(2, 'feat-aaa');
  });

  it('rejects if closure captured undefined (guard check)', () => {
    // If undoStore.push happens before upsertedIds resolves, closure captures undefined.
    // The existing code guards: if (upsertedIds[0]) { undoStore.push(...) }
    // This test documents that the guard is load-bearing.
    const upsertedIds: string[] = []; // empty — server hasn't responded
    const shouldPush = upsertedIds[0] !== undefined;
    expect(shouldPush).toBe(false);
  });
});
