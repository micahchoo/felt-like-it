# Layer Management -- Behavior (L8)

## Flow 1: Layer Create

```
User types name + clicks "Add Layer"
  → LayerPanel.createLayer()
  → creatingLayer = true
  → await trpc.layers.create.mutate({ mapId, name })
  → Server: requireMapAccess(editor+)
  → Server: SELECT max(z_index) FROM layers WHERE map_id = ?
  → Server: INSERT INTO layers (map_id, name, type, z_index) VALUES (?, ?, 'mixed', max+1) RETURNING *
  → Client receives new Layer
  → layersStore.add(layer) — appends, sorts by zIndex, sets active
  → onlayerchange?.() — tells MapEditor to refresh
  → toastStore.success()
  → creatingLayer = false

Error path:
  → catch: toastStore.error("Failed to create layer.")
  → No rollback needed — add happens only after successful await
```

**Key design choice:** Create is NOT optimistic. The layer only appears in the store after the server confirms. This avoids orphan-layer rollback complexity.

## Flow 2: Layer Delete

```
User clicks delete icon
  → confirm() dialog — "Delete layer X and all its features? Cannot be undone."
  → await trpc.layers.delete.mutate({ id })
  → Server: requireMapAccess(editor+)
  → Server: DELETE FROM layers WHERE id = ? (features cascade via FK)
  → Client: layersStore.remove(id) — filters out, reassigns active to first
  → Client: styleStore.clearStyle(id) — clean up ephemeral override
  → onlayerchange?.()
  → toastStore.success()

Error path:
  → catch: toastStore.error("Failed to delete layer.")
  → Layer remains in store (server didn't delete)
```

**Note:** Delete is also non-optimistic. The layer stays visible until server confirms deletion.

## Flow 3: Visibility Toggle

```
User clicks eye icon on layer
  → toggleVisibility(layerId)
  → Guard: if togglingIds.has(layerId) return (dedup)
  → togglingIds.add(layerId)
  → layersStore.toggle(layerId)  ← OPTIMISTIC: flip visible immediately
  → await trpc.layers.update.mutate({ id, visible: !layer.visible, version })
  → Server: version-gated UPDATE → bumps version
  → togglingIds.delete(layerId)

Error path (CONFLICT or network):
  → layersStore.toggle(layerId)  ← REVERT: flip back
  → CONFLICT code? → "Modified by another user. Please reload."
  → Otherwise → "Failed to update visibility."
  → loadErrors[layerId] = msg
  → toastStore.error(msg)
```

**Optimistic with rollback.** The `togglingIds` Set prevents double-toggle race conditions.

## Flow 4: Layer Reorder

```
User clicks up/down arrow on layer
  → moveLayer(index, direction)
  → layersStore.reorder(fromIndex, toIndex) ← OPTIMISTIC: splice + reassign zIndex
  → versioned = layersStore.getOrderedIdsWithVersions()
  → await trpc.layers.reorder.mutate({ mapId, order: versioned })
  → Server: BEGIN TRANSACTION
  →   For each (id, version, newIndex):
  →     UPDATE layers SET z_index = newIndex, version = version+1
  →       WHERE id = ? AND map_id = ? AND version = ?
  →     If no row updated → ROLLBACK + throw CONFLICT
  → COMMIT

Error path:
  → CONFLICT → toast "Layer order has changed. Please reload."
  → Note: client store already has the optimistic reorder applied.
  → The user must reload to get server truth.
```

**Gap identified:** On reorder CONFLICT, the client store is NOT reverted to the pre-reorder state. The user sees the locally-reordered list but the server rejected it. Only a page reload reconciles. This is a known trade-off -- the previous implementation had rollback bugs (see history below).

## Flow 5: Style Change

```
User opens StylePanel (design mode toggle, Ctrl+\)
  → styleStore.setEditingLayer(layerId)
  → StylePanel derives current layer from layersStore.all
  → User edits paint property / applies choropleth / heatmap

On each edit:
  → styleStore.setStyle(layer.id, newStyle)    ← ephemeral override
  → layersStore.updateStyle(layer.id, newStyle) ← updates layer object
  → MapCanvas reactively derives new paint expressions
  → resolvePaintInterpolators(style.config, zoom) → MapLibre expressions
  → Map re-renders affected sublayers immediately

On save:
  → saveStyle()
  → await trpc.layers.update.mutate({ id, style, version })
  → Server: version-gated UPDATE, bumps version
  → toastStore.success("Style saved.")

On save failure:
  → Revert: styleStore.setStyle(layer.id, lastSavedStyle)
  → Revert: layersStore.updateStyle(layer.id, lastSavedStyle)
  → toastStore.error("Failed to save style. Reverting changes.")
  → MapCanvas re-renders back to previous style
```

**Dual-store pattern:** StylePanel always writes to BOTH `styleStore` and `layersStore` in tandem. `styleStore` is the ephemeral override layer; `layersStore` holds the canonical layer objects. MapCanvas resolves style as `styleStore.getStyle(id) ?? layer.style`.

**Rollback contract:** Tested in `style-panel-rollback.test.ts`. On save failure, both stores revert to `lastSavedStyle`. If `lastSavedStyle` is null (never saved), no revert occurs (style stays optimistic -- this is an edge case for brand-new layers).

## Rollback Bug History

The commit history shows a multi-stage evolution:

| Commit | What |
|--------|------|
| `28997bd` | Add `version` columns + Zod fields for optimistic concurrency |
| `c32bccf` | Optimistic concurrency on `layers.update` + transactional reorder |
| `e72cfb7` | Client-side CONFLICT handling + versioned reorder (LayerPanel, StylePanel, MapEditor) |
| `4c63ed0` | **Fix:** StylePanel save rollback + FilterPanel helper text |
| `d8d7d4f` | Fix lint errors in viewport and layers stores |
| `185a653` | Structural hardening + race guards (brownfield Waves 4-5) |

**Resolution:** The original rollback bug was that StylePanel did not revert ephemeral state on save failure. Commit `4c63ed0` added the `lastSavedStyle` snapshot + dual-store revert. Commit `e72cfb7` added version-passing from client to server for all update calls. The transactional reorder in `c32bccf` prevents partial z-index corruption.

**Current status:** Rollback is resolved for style saves. The reorder-CONFLICT non-revert (Flow 4 gap) is a deliberate trade-off after past rollback bugs proved worse than stale-until-reload.

## Endorheic Basins

Endorheic basins are state sinks -- data flows in but never drains, or UI states that trap the user.

### 1. styleStore override accumulation (LOW risk)
`_styleOverrides` Map grows as users edit different layers. Overrides are never cleared except:
- Explicitly via `styleStore.clearStyle(layerId)` when a layer is deleted
- Never on page navigation within the SPA

**Impact:** Memory leak proportional to number of edited layers. Negligible for typical use (< 20 layers). Would matter for power users with 100+ layers in a long session.

### 2. Reorder CONFLICT stale state (MEDIUM risk, documented above)
When reorder fails with CONFLICT, the client store has optimistic z-order that the server rejected. The user sees a locally-reordered list that doesn't match the DB until they reload.

**Impact:** Subsequent reorder attempts will also fail (wrong versions). Any feature operations on layers continue to work (unrelated to z-order). Self-resolves on page reload or layer list refresh.

### 3. loadErrors accumulation in LayerPanel (LOW risk)
`loadErrors: Record<string, string>` accumulates error messages per layer. Cleared per-layer via `clearError()` only on user dismiss. Layer deletion does NOT clear the error entry.

**Impact:** Orphan error keys for deleted layers. No visible effect (template iterates `layersStore.all`, not `loadErrors`). Cosmetic only.

### 4. hotOverlay stale features (LOW risk)
`hotOverlay` per-layer feature cache is cleared on `clearHotFeatures(layerId)` but NOT automatically on layer delete. If a layer is deleted while hot features exist, orphan entries persist in `_hotFeatures`.

**Impact:** MapCanvas iterates `layersStore.all` to render hot overlays, so orphan entries are never rendered. Memory-only leak, cleared on page navigation.

### 5. No basin identified in tRPC/DB layer (CLEAR)
Layer deletion cascades features via FK. No orphan data possible server-side.
