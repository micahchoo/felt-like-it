# Touch/Mobile Interaction Patterns in Annotation & Drawing Tools

Research date: 2026-03-15

## 1. Terra Draw

### Touch Support Model
Terra Draw uses **Pointer Events API** exclusively (not Touch Events). Touch input is handled through the same `pointerdown`/`pointermove`/`pointerup` pipeline as mouse input.

**Key: multitouch is explicitly unsupported.** Every pointer handler checks `event.isPrimary` and returns early for secondary touches:
```typescript
// In base.adapter.ts — pointerdown, pointermove, pointerup all do this:
if (!event.isPrimary) {
    return;
}
```

This means pinch-to-zoom on a map is handled entirely by the map library's own touch handlers — Terra Draw ignores the second finger.

### Tap vs Drag Disambiguation
Terra Draw uses a **three-state drag machine**: `"not-dragging" → "pre-dragging" → "dragging"`.

- `pointerdown` sets state to `"pre-dragging"`
- `pointermove` checks pixel distance from the down point. If below threshold → treated as "microdrag" and ignored. If above → transitions to `"dragging"` and calls `onDragStart`
- `pointerup` while still `"pre-dragging"` or `"not-dragging"` → fires `onClick`

### Microdrag Thresholds (Configurable via `BaseAdapterConfig`)

| Config Key | Default | Purpose |
|---|---|---|
| `minPixelDragDistance` | **1px** | General drag threshold (idle state) |
| `minPixelDragDistanceSelecting` | **1px** | Drag threshold when in selection mode |
| `minPixelDragDistanceDrawing` | **8px** | Drag threshold when actively drawing |

The 8px drawing threshold is the **fat-finger accommodation** — small accidental movements during drawing don't trigger drags. For touch, you'd want to increase these values (e.g., 12-16px for drawing).

### Map Pan Prevention
Terra Draw passes a `setDraggability(enabled: boolean)` callback into `onDragStart`, `onDrag`, and `onDragEnd`. Each map adapter implements this:
- The drawing mode calls `setDraggability(false)` when it begins a drag (e.g., moving a vertex)
- Calls `setDraggability(true)` on drag end
- The adapter translates this into map-specific API calls (e.g., `map.dragPan.disable()` for Mapbox/MapLibre)

### No Long-Press Support
Terra Draw has **no built-in long-press detection**. Tap vs click is purely movement-based (microdrag threshold), not time-based. You would need to implement long-press yourself on top of the `onClick`/`onDragStart` callbacks.

---

## 2. tldraw

### Pointer Type Detection
tldraw detects coarse vs fine pointers through `tlenvReactive`:
```typescript
// getIsCoarsePointer.tsx
import { tlenvReactive } from 'tldraw'
export function getIsCoarsePointer() {
    return tlenvReactive.get().isCoarsePointer
}
```

This uses the CSS media query `(pointer: coarse)` under the hood to detect touch-primary devices.

### Key Architectural Patterns
- **Unified Pointer Events**: tldraw uses Pointer Events API, not separate mouse/touch handlers
- **`ClickManager`**: Manages click vs double-click vs drag disambiguation (file exists at `packages/editor/src/lib/editor/managers/ClickManager.ts`)
- **Coarse pointer adjustments**: When `isCoarsePointer` is true, hit targets are enlarged and UI adapts (mobile toolbar, larger handles)
- **Gesture handling**: Two-finger pinch-to-zoom is built into the canvas — tldraw handles this at the editor level, not the shape level
- **No map conflict**: tldraw owns the entire canvas, so there's no gesture conflict with an underlying map

### Mobile-Specific UI
tldraw has dedicated mobile components:
- `TlaSidebarToggleMobile.tsx` — mobile-specific sidebar
- Mobile Chrome e2e snapshot tests — they actively test mobile rendering
- Coarse pointer detection drives UI layout decisions

---

## 3. Excalidraw

### Gesture System
Excalidraw has a dedicated `gesture.ts` module for multi-touch:

```typescript
// packages/excalidraw/gesture.ts
export const getCenter = (pointers: Map<number, PointerCoords>) => {
    const allCoords = Array.from(pointers.values());
    return {
        x: sum(allCoords, (coords) => coords.x) / allCoords.length,
        y: sum(allCoords, (coords) => coords.y) / allCoords.length,
    };
};

export const getDistance = ([a, b]: readonly PointerCoords[]) =>
    Math.hypot(a.x - b.x, a.y - b.y);
```

### Multi-Touch Architecture
- Maintains a `Map<number, PointerCoords>` keyed by pointer ID
- `getCenter()` computes the centroid of all active pointers (for pan during pinch)
- `getDistance()` computes distance between two pointers (for pinch-to-zoom)
- This is used in the main `App.tsx` (very large file) to handle:
  - **1 finger**: draw/select/pan depending on active tool
  - **2 fingers**: pinch-to-zoom + pan, regardless of active tool

### Mobile UI Components
- `MobileMenu.tsx`, `MobileToolBar.tsx`, `MobileToolBar.scss` — dedicated mobile toolbar
- `LaserPointerButton.tsx` — pointer/presentation mode

### Known Issues Pattern
Excalidraw's issue tracker shows recurring themes around:
- Touch drawing precision on small screens
- Gesture conflicts between drawing and zooming
- Palm rejection challenges

---

## 4. Mapbox GL Draw

### Touch-Specific Configuration (from `src/options.js`)

```javascript
const defaultOptions = {
    touchEnabled: true,    // Master toggle for touch support
    clickBuffer: 2,        // Hit test buffer for mouse clicks (pixels)
    touchBuffer: 25,       // Hit test buffer for touch taps (pixels) — 12.5x larger!
    // ...
};
```

**The `touchBuffer: 25` vs `clickBuffer: 2` split is the critical pattern.** This is how Mapbox GL Draw handles fat-finger precision — touch interactions get a 25px hit-testing radius vs 2px for mouse.

### Tap Detection (from `src/lib/is_tap.js`)

```javascript
export const TAP_TOLERANCE = 25;   // Max pixels of movement
export const TAP_INTERVAL = 250;   // Max milliseconds

export default function isTap(start, end, options = {}) {
    const tolerance = options.tolerance ?? TAP_TOLERANCE;
    const interval = options.interval ?? TAP_INTERVAL;
    const moveDistance = euclideanDistance(start.point, end.point);
    return moveDistance < tolerance && (end.time - start.time) < interval;
}
```

A tap is: **< 25px movement AND < 250ms duration**. Both are configurable.

### Map Interaction Locking
Mapbox GL Draw disables these map interactions during drawing modes:
```javascript
export const interactions = [
    'scrollZoom',
    'boxZoom',
    'dragRotate',
    'dragPan',
    'keyboard',
    'doubleClickZoom',
    'touchZoomRotate'  // ← This is the key one for touch
];
```

When entering a draw mode, Draw calls `map[interaction].disable()` selectively. The `touchZoomRotate` interaction is what prevents two-finger zoom from conflicting with drawing.

---

## 5. Cross-Cutting Patterns

### Pattern 1: Tap vs Drag — Movement + Time Threshold
All tools use the same fundamental approach:
- **Mapbox GL Draw**: `< 25px movement AND < 250ms` = tap
- **Terra Draw**: `< N px movement` (no time component) = click, configurable per mode state (1px idle, 8px drawing)
- **Excalidraw/tldraw**: Pointer Events with similar movement thresholds in their state machines

**Recommendation**: Use both movement AND time. Movement-only (Terra Draw's approach) can misclassify very slow deliberate drags as clicks.

### Pattern 2: Separate Touch Hit Buffer
Only Mapbox GL Draw has an explicit `touchBuffer` vs `clickBuffer` split. This is the cleanest pattern:
- Detect `pointerType === "touch"` on the event
- Use larger hit radius (25px touch vs 2px mouse is the Mapbox ratio — 12.5x)

### Pattern 3: Map Draggability Toggle
Both Terra Draw and Mapbox GL Draw use the same approach:
- Drawing mode starts → disable map pan (`setDraggability(false)` / `map.dragPan.disable()`)
- Drawing action ends → re-enable map pan
- The key: this must happen on `dragStart`, not on `pointerdown`, to allow taps to pass through to the map

### Pattern 4: Multitouch Passthrough vs Handling
Two opposing strategies:
- **Terra Draw**: Ignore non-primary pointers entirely (`!event.isPrimary → return`). Map handles its own multitouch. Simple but means you can't do custom two-finger gestures.
- **Excalidraw**: Track all pointers in a Map, compute center/distance, handle pinch-zoom in application code. More control but more complexity.

**For map-based annotation**: Terra Draw's approach is better — let MapLibre/Mapbox handle pinch-to-zoom natively. Your drawing tool only needs to handle one finger.

### Pattern 5: Coarse Pointer Detection
tldraw's `(pointer: coarse)` media query approach is the right way to detect touch-primary devices for UI adaptation (larger buttons, different toolbar layout). But don't use it for hit testing — use `pointerType` on the event instead, because a device can have both touch and mouse.

### Pattern 6: No Long-Press in Drawing Tools
None of these tools use long-press for core interactions. Long-press is problematic because:
- It conflicts with the browser's native long-press (text selection, context menu)
- The 300-500ms delay feels unresponsive
- It requires `touch-action: none` CSS which can break scrolling
- Drawing tools prefer mode-switching (tap a tool button) over gesture disambiguation

---

## Specific API References

| Tool | Config | Default | Purpose |
|---|---|---|---|
| Mapbox GL Draw | `touchEnabled` | `true` | Master touch toggle |
| Mapbox GL Draw | `touchBuffer` | `25` | Touch hit-test radius (px) |
| Mapbox GL Draw | `clickBuffer` | `2` | Mouse hit-test radius (px) |
| Mapbox GL Draw | `TAP_TOLERANCE` | `25` | Max movement for tap (px) |
| Mapbox GL Draw | `TAP_INTERVAL` | `250` | Max duration for tap (ms) |
| Terra Draw | `minPixelDragDistance` | `1` | General microdrag threshold |
| Terra Draw | `minPixelDragDistanceDrawing` | `8` | Drawing microdrag threshold |
| Terra Draw | `minPixelDragDistanceSelecting` | `1` | Selection microdrag threshold |
| tldraw | `tlenvReactive.isCoarsePointer` | auto | Coarse pointer detection |

## Source Files

- Terra Draw base adapter: `packages/terra-draw/src/common/base.adapter.ts`
- Terra Draw adapter listener: `packages/terra-draw/src/common/adapter-listener.ts`
- Mapbox GL Draw tap detection: `src/lib/is_tap.js`
- Mapbox GL Draw options: `src/options.js`
- Mapbox GL Draw constants (interactions list): `src/constants.js`
- Excalidraw gesture utilities: `packages/excalidraw/gesture.ts`
- tldraw coarse pointer: `apps/dotcom/client/src/tla/utils/getIsCoarsePointer.tsx`
