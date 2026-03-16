# Annotation Tool Accessibility Patterns

Research into how production drawing/annotation tools handle keyboard navigation, screen readers, and ARIA — based on source code analysis of tldraw, Excalidraw, Annotorious, and Mapbox GL Draw.

## Key Finding: Accessibility Is Largely Absent

None of the tools examined have comprehensive accessibility implementations. Canvas/annotation accessibility is an industry-wide gap, not a solved problem. What follows is what each tool *does* provide, plus patterns worth adopting.

---

## 1. tldraw

### Keyboard Shortcuts (strong)
Uses `hotkeys-js` library via `useKeyboardShortcuts()` hook. Every action and tool can declare a `kbd` property:

- **Tool switching**: Single-key mnemonics (e.g., `R` for rectangle, `D` for draw, `A` for arrow, `E` for eraser)
- **Actions**: Standard modifier combos (`Cmd+Z` undo, `Cmd+Shift+Z` redo, `Cmd+A` select all, `Del/Backspace` delete)
- **View**: `Shift+1` zoom to fit, `Shift+2` zoom to selection, `Shift+0` reset zoom
- **Alignment**: `Alt+A` align left, `Alt+H` center horizontal, `Alt+V` center vertical, etc.
- **Z-order**: `]` bring forward, `[` send backward, `Alt+]` bring to front, `Alt+[` send to back
- **Tool lock**: `Q` locks current tool so it doesn't revert to select after one use

### Keyboard-Only Shape Creation (unique)
The `,` (comma) key simulates `pointer_down`/`pointer_up` at the current cursor position. This enables keyboard-only shape placement when combined with arrow-key panning — a rare feature among canvas tools.

### `isRequiredA11yAction` Flag
Actions can be marked with `isRequiredA11yAction: true`, which keeps them active even when shortcuts are otherwise disabled (e.g., during menu interaction). This is a good pattern for ensuring critical accessibility actions are never blocked.

### ARIA / Screen Reader Support (absent)
- **No ARIA attributes on shapes.** `Shape.tsx` has zero `aria-*`, `role`, or `tabIndex` attributes.
- **No `aria-live` regions** for announcing state changes (shape created, deleted, selected).
- **No tab navigation** between shapes on the canvas.
- Shapes are rendered as plain SVG/DOM elements without semantic markup.
- GitHub issues show focus on i18n/RTL (#8033), alt text for images (#8158), and tooltips (#8160) — but no systematic screen reader work.

### Focus Management
The editor tracks `isFocused` state via `editor.getInstanceState().isFocused`. Keyboard shortcuts only activate when the editor is focused. The `areShortcutsDisabled()` function suppresses shortcuts when menus are open or a shape is being edited.

---

## 2. Excalidraw

### Keyboard Shortcuts (strong)
Single-key tool activation, documented in `HelpDialog.tsx`:

| Key | Tool |
|-----|------|
| V / 1 | Selection |
| R / 2 | Rectangle |
| D / 3 | Diamond |
| O / 4 | Ellipse |
| A / 5 | Arrow |
| L / 6 | Line |
| P / 7 | Freedraw |
| T / 8 | Text |
| 9 | Image |
| E / 0 | Eraser |
| F | Frame |
| K | Laser pointer |
| H | Hand/pan |
| Q | Tool lock |
| I / Shift+S / Shift+G | Eye dropper |

### Tab/Shift+Tab Element Type Conversion (unique)
`Tab` and `Shift+Tab` cycle through element types for the selected shape (e.g., rectangle -> diamond -> ellipse). Listed under `convertElementType` in shortcuts. This is not tab-navigation between shapes — it is shape-type morphing.

### Focus Management
- Container element has `tabIndex={0}` for keyboard focus capture.
- `focusContainer()` method called after many interactions (tool switch, paste, drag end) to ensure keyboard events route correctly.
- Line 9196: "Prevents focus from escaping excalidraw tab" — focus trapping within the app.

### ARIA / Screen Reader Support (minimal)
- GitHub issue #7492: "Excalidraw whiteboard accessibility issues reported in Deque Audit" — a professional accessibility audit identified issues.
- GitHub issue #5759: "[Discussion] Excalidraw accessibility" — open discussion thread.
- Issues #10490/#10491: Missing `aria-labels` on share button and other UI elements — fixes are being applied incrementally to toolbar buttons, not to canvas shapes.
- **No ARIA attributes on the canvas element or on individual shapes** (confirmed by grep of App.tsx).
- **No `aria-live` announcements** for drawing actions.
- **No tab navigation between shapes.**

---

## 3. Annotorious

### Keyboard Support (minimal)
`keyboardCommands.ts` implements only:
- `Ctrl+Z` / `Cmd+Z` — undo
- `Ctrl+Y` / `Cmd+Shift+Z` — redo

That is the entire keyboard command set. No tool switching, no shape navigation, no selection shortcuts.

### ARIA / Screen Reader (absent)
- No ARIA attributes found on annotation overlays or tool components.
- The Svelte-based overlay components (`ToolMount.svelte`, rectangle tools) render without semantic roles.
- No `aria-live` regions for annotation creation/deletion events.
- No tab navigation between annotations.
- No keyboard-based annotation creation workflow.

### Architecture Note
Annotorious renders annotations as SVG overlays on top of images. The SVG elements have no accessibility attributes, making annotations completely invisible to screen readers.

---

## 4. Mapbox GL Draw

### Keyboard Support (limited)
- `keybindings` option (boolean) enables/disables keyboard event listeners on the container.
- `keydown`/`keyup` events are forwarded to the current drawing mode.
- In `simple_select` and `direct_select` modes, keyboard events can trigger mode transitions (e.g., Enter to confirm, Escape to cancel).
- **No documented keyboard shortcuts** for feature selection, deletion, or tool switching beyond Escape/Enter.

### ARIA / Screen Reader (absent)
- Features are rendered on a WebGL canvas — completely opaque to screen readers.
- No ARIA attributes on the draw control buttons or drawn features.
- No focus management between drawn features.
- No `aria-live` announcements.

---

## 5. General Patterns and Gaps

### What Exists (Keyboard Shortcuts Only)
All tools implement some keyboard shortcuts, following a consistent pattern:
1. **Single-key tool activation** (R for rectangle, etc.) — tldraw and Excalidraw
2. **Standard modifier combos** for clipboard/undo/redo — all tools
3. **Escape to cancel** current operation — all tools
4. **Delete/Backspace to remove** selected shapes — tldraw, Excalidraw

### What Is Missing Everywhere

| Capability | tldraw | Excalidraw | Annotorious | Mapbox Draw |
|------------|--------|------------|-------------|-------------|
| Tool switching shortcuts | Yes | Yes | No | No |
| Tab between shapes | No | No | No | No |
| ARIA on shapes | No | No | No | N/A (WebGL) |
| `aria-live` announcements | No | No | No | No |
| Screen reader shape descriptions | No | No | No | No |
| Keyboard-only shape creation | Partial (`,` key) | No | No | No |
| Focus management | Basic | Basic | No | No |

### Implementation Patterns Worth Adopting

#### Pattern 1: Virtual Cursor for Keyboard-Only Creation (from tldraw)
```
// Comma key simulates pointer events at current cursor position
hot(',', (e) => {
  const { x, y, z } = editor.inputs.getCurrentPagePoint()
  const screenpoints = editor.pageToScreen({ x, y })
  editor.dispatch({
    type: 'pointer', name: 'pointer_down',
    point: { x: screenpoints.x, y: screenpoints.y, z },
    ...modifiers
  })
})
```
Enables keyboard users to "click" at the current position. Combined with arrow-key panning, this allows full keyboard-only shape creation.

#### Pattern 2: Required A11y Actions (from tldraw)
```
if (areShortcutsDisabled(editor) && !action.isRequiredA11yAction) return
```
Some actions bypass the "shortcuts disabled" check. This ensures critical accessibility actions (like escape, focus management) work even during modal states.

#### Pattern 3: Focus Trapping (from Excalidraw)
```
// Container gets tabIndex={0} for keyboard focus
<div tabIndex={0} ref={this.excalidrawContainerRef}>
// Focus is restored after interactions
this.focusContainer();
// Line 9196: Prevents focus from escaping excalidraw tab
```

#### Pattern 4: Action/Tool Shortcut Registry (from tldraw)
Every action declares its own `kbd` property. A central hook iterates all actions and registers hotkeys dynamically:
```
for (const action of Object.values(actions)) {
  if (!action.kbd) continue
  hot(getHotkeysStringFromKbd(action.kbd), (event) => {
    action.onSelect('kbd')
  })
}
```
This makes shortcuts discoverable, configurable, and self-documenting.

### Patterns That Should Exist But Don't

#### Pattern 5: Shape Focus Ring with Tab Navigation
```typescript
// Hypothetical — no tool implements this
interface FocusableShape {
  tabIndex: number;
  'aria-label': string;        // "Red rectangle at position 100, 200"
  'aria-describedby': string;  // Points to shape properties panel
  role: 'img' | 'figure';
  onFocus: () => selectShape(id);
  onKeyDown: (e) => handleShapeKeyboard(e); // Arrow keys to move, Delete to remove
}
```

#### Pattern 6: Live Region for State Announcements
```typescript
// Hypothetical — no tool implements this
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {announcement}  {/* "Rectangle created" / "3 shapes selected" / "Shape deleted" */}
</div>
```

#### Pattern 7: Roving Tabindex for Shape Navigation
```typescript
// Hypothetical — would enable Tab/Shift+Tab between shapes
shapes.forEach((shape, i) => {
  shape.tabIndex = (i === focusedIndex) ? 0 : -1;
  shape.role = 'option';
});
// Container gets role="listbox" and aria-label="Canvas shapes"
```

---

## Summary

The state of accessibility in annotation/drawing tools is poor across the board. Keyboard shortcuts for tool switching are well-implemented in tldraw and Excalidraw. Everything else — screen reader support, ARIA attributes on shapes, tab navigation, live announcements — is absent from all examined tools. This represents both a significant gap and an opportunity to differentiate. Any annotation system that implements even basic ARIA on shapes and live region announcements would be ahead of the entire field.

### Key Sources
- tldraw: `packages/tldraw/src/lib/ui/hooks/useKeyboardShortcuts.ts`, `packages/tldraw/src/lib/ui/context/actions.tsx`
- Excalidraw: `packages/excalidraw/actions/shortcuts.ts`, `packages/excalidraw/components/HelpDialog.tsx`, `packages/excalidraw/components/App.tsx`
- Excalidraw audit: GitHub issue #7492 (Deque accessibility audit)
- Annotorious: `packages/annotorious/src/keyboardCommands.ts`
- Mapbox GL Draw: `src/events.js`, `src/modes/simple_select.js`
