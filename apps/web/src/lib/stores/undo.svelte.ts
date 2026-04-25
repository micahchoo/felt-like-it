import { getContext, setContext } from 'svelte';

export interface Command {
  description: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

const MAX_HISTORY = 50;

const UNDO_STORE_KEY = Symbol('store:undo');

export class UndoStore {
  past = $state<Command[]>([]);
  future = $state<Command[]>([]);

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.description ?? null;
  }
  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.description ?? null;
  }

  /** Push a command that was already executed */
  push(command: Command): void {
    this.past = [...this.past.slice(-MAX_HISTORY + 1), command];
    this.future = []; // Clear redo stack on new action
  }

  async undo(): Promise<void> {
    const command = this.past[this.past.length - 1];
    if (!command) return;
    this.past = this.past.slice(0, -1);
    this.future = [...this.future, command];
    await command.undo();
  }

  async redo(): Promise<void> {
    const command = this.future[this.future.length - 1];
    if (!command) return;
    this.future = this.future.slice(0, -1);
    this.past = [...this.past, command];
    await command.redo();
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

export function createUndoStore(): UndoStore {
  return new UndoStore();
}

/** Register a UndoStore on the current component's context. Call inside component init. */
export function setUndoStore(store: UndoStore): UndoStore {
  setContext(UNDO_STORE_KEY, store);
  return store;
}

/** Retrieve the UndoStore registered on an ancestor. Throws if missing. */
export function getUndoStore(): UndoStore {
  const store = getContext<UndoStore | undefined>(UNDO_STORE_KEY);
  if (!store) {
    throw new Error('UndoStore not registered — did the root +layout.svelte call setUndoStore()?');
  }
  return store;
}
