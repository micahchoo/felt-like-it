export interface Command {
  description: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

const MAX_HISTORY = 50;

let _past = $state<Command[]>([]);
let _future = $state<Command[]>([]);

export const undoStore = {
  get canUndo() { return _past.length > 0; },
  get canRedo() { return _future.length > 0; },
  get undoLabel() { return _past[_past.length - 1]?.description ?? null; },
  get redoLabel() { return _future[_future.length - 1]?.description ?? null; },

  /** Push a command that was already executed */
  push(command: Command) {
    _past = [..._past.slice(-MAX_HISTORY + 1), command];
    _future = []; // Clear redo stack on new action
  },

  async undo() {
    const command = _past[_past.length - 1];
    if (!command) return;
    _past = _past.slice(0, -1);
    _future = [..._future, command];
    await command.undo();
  },

  async redo() {
    const command = _future[_future.length - 1];
    if (!command) return;
    _future = _future.slice(0, -1);
    _past = [..._past, command];
    await command.redo();
  },

  clear() {
    _past = [];
    _future = [];
  },
};
