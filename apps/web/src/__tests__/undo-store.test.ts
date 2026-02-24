import { describe, it, expect, beforeEach, vi } from 'vitest';
import { undoStore } from '../lib/stores/undo.svelte.js';

describe('undoStore', () => {
  beforeEach(() => {
    undoStore.clear();
  });

  describe('initial state', () => {
    it('starts with empty stacks', () => {
      expect(undoStore.canUndo).toBe(false);
      expect(undoStore.canRedo).toBe(false);
      expect(undoStore.undoLabel).toBeNull();
      expect(undoStore.redoLabel).toBeNull();
    });
  });

  describe('push()', () => {
    it('makes undo available', () => {
      undoStore.push({ description: 'Draw point', undo: vi.fn(), redo: vi.fn() });
      expect(undoStore.canUndo).toBe(true);
    });

    it('clears redo stack', () => {
      const cmd1 = { description: 'A', undo: vi.fn(), redo: vi.fn() };
      const cmd2 = { description: 'B', undo: vi.fn(), redo: vi.fn() };
      undoStore.push(cmd1);
      undoStore.undo();
      // redo stack has cmd1
      expect(undoStore.canRedo).toBe(true);
      // Push a new command — redo stack must clear
      undoStore.push(cmd2);
      expect(undoStore.canRedo).toBe(false);
    });

    it('exposes description as undoLabel', () => {
      undoStore.push({ description: 'Delete layer', undo: vi.fn(), redo: vi.fn() });
      expect(undoStore.undoLabel).toBe('Delete layer');
    });
  });

  describe('undo()', () => {
    it('calls the undo function', async () => {
      const undo = vi.fn();
      undoStore.push({ description: 'X', undo, redo: vi.fn() });
      await undoStore.undo();
      expect(undo).toHaveBeenCalledOnce();
    });

    it('moves command to redo stack', async () => {
      undoStore.push({ description: 'X', undo: vi.fn(), redo: vi.fn() });
      await undoStore.undo();
      expect(undoStore.canUndo).toBe(false);
      expect(undoStore.canRedo).toBe(true);
      expect(undoStore.redoLabel).toBe('X');
    });

    it('is a no-op when stack is empty', async () => {
      await expect(undoStore.undo()).resolves.toBeUndefined();
    });

    it('undoes in LIFO order', async () => {
      const calls: string[] = [];
      undoStore.push({ description: 'A', undo: () => { calls.push('A'); }, redo: vi.fn() });
      undoStore.push({ description: 'B', undo: () => { calls.push('B'); }, redo: vi.fn() });
      await undoStore.undo();
      await undoStore.undo();
      expect(calls).toEqual(['B', 'A']);
    });
  });

  describe('redo()', () => {
    it('calls the redo function', async () => {
      const redo = vi.fn();
      undoStore.push({ description: 'X', undo: vi.fn(), redo });
      await undoStore.undo();
      await undoStore.redo();
      expect(redo).toHaveBeenCalledOnce();
    });

    it('moves command back to past stack', async () => {
      undoStore.push({ description: 'X', undo: vi.fn(), redo: vi.fn() });
      await undoStore.undo();
      await undoStore.redo();
      expect(undoStore.canUndo).toBe(true);
      expect(undoStore.canRedo).toBe(false);
    });

    it('is a no-op when redo stack is empty', async () => {
      await expect(undoStore.redo()).resolves.toBeUndefined();
    });
  });

  describe('clear()', () => {
    it('empties both stacks', async () => {
      undoStore.push({ description: 'A', undo: vi.fn(), redo: vi.fn() });
      undoStore.push({ description: 'B', undo: vi.fn(), redo: vi.fn() });
      await undoStore.undo();
      undoStore.clear();
      expect(undoStore.canUndo).toBe(false);
      expect(undoStore.canRedo).toBe(false);
    });
  });

  describe('MAX_HISTORY (50)', () => {
    it('caps past stack at 50 entries', () => {
      for (let i = 0; i < 60; i++) {
        undoStore.push({ description: `cmd-${i}`, undo: vi.fn(), redo: vi.fn() });
      }
      // The label should be the last pushed command
      expect(undoStore.undoLabel).toBe('cmd-59');
      // Undo 50 times should exhaust the stack
      const undoAll = async () => {
        for (let i = 0; i < 50; i++) await undoStore.undo();
        return undoStore.canUndo;
      };
      return undoAll().then((canUndo) => expect(canUndo).toBe(false));
    });
  });
});
