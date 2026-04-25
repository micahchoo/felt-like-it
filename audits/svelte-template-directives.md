# Svelte Template Directives Audit

**Skill:** `svelte-template-directives` (svelte-skills-kit 1.3.0, last verified 2026-03-12)
**Scope:** `apps/web/src/lib/**/*.svelte` + `apps/web/src/routes/**/*.svelte`
**Date:** 2026-04-24
**Project Svelte version:** `^5.17.3` (package.json) — **below 5.29 cutoff**, so `{@attach}` is **not yet usable**. Recommendations gated on upgrade.

## Summary

| Directive  | Hits | Status |
|------------|------|--------|
| `{@attach}` | 0 | Gated on Svelte 5.29 upgrade |
| `{@html}`   | 0 | Clean |
| `{@render}` | 12 | All clean (children/footer/section.content) |
| `{@const}`  | 18 | Mostly idiomatic; opportunistic improvements below |
| `{@debug}`  | 0 | Clean (no leftovers) |
| `{#key}`    | 1 (`AdminScreen.svelte:161`) | Underused — see findings |
| `use:` actions | 2 (`use:enhance`) | Correct (SvelteKit primitive, not legacy action) |
| `{@html}`-equivalent (`innerHTML`) | 0 | Clean |

Confirms prior audit's clean rating on `{@html}`/`{@attach}`/`use:`. The "underused `{#key}`" claim is **confirmed** but is a `svelte-runes` concern, not this skill's — left out of findings here.

---

## Findings

### 1. MapLibre / TerraDraw / deck.gl mounted via `$effect` instead of `{@attach}`

**Skill rule:** "@attach replaces use: actions" / Pattern 1 (third-party library integration) / Pattern 9 (DOM-controlling libs) — re-runs on dep change, cleanup return value, composes via spread. `$effect` doing element-attach work is the documented anti-pattern.

| File:line | Severity | Violation |
|---|---|---|
| `apps/web/src/lib/components/map/DeckGLOverlay.svelte:55-72` | MED | `$effect` creates `new MapboxOverlay`, calls `map.addControl(o)`, returns cleanup. Textbook Pattern 1. |
| `apps/web/src/lib/components/map/DrawingToolbar.svelte:69-134` | MED | `$effect` initialises TerraDraw against `map`, registers commit handler, cleans up on `map` change. Pattern 9 (library controls own DOM segment). |
| `apps/web/src/lib/components/map/MapCanvas.svelte` (svelte-maplibre `bind:map`, around L99/324) | LOW | Already wraps via svelte-maplibre. No action — included for completeness. |

**Fix (post-upgrade):** convert each into an attachment factory and apply on the host element / via `fromAction` if a `use:` form exists upstream:
```svelte
{@attach useTerraDraw(map, onCommit)}
{@attach useMapboxOverlay(map)}
```
Cleanup returns the same teardown the `$effect` already returns. Reactivity on `map` is automatic.

**Pre-upgrade:** add a `// TODO(loop): migrate to {@attach} once Svelte ≥5.29` next to each effect so the boundary is greppable.

### 2. Window/document listener `$effect` blocks should use `<svelte:window>` / `<svelte:document>`

**Skill rule (Notes):** "Use `<svelte:window>`/`<svelte:document>` for global events, not `$effect`."

| File:line | Severity | Listener |
|---|---|---|
| `apps/web/src/lib/components/ui/OfflineBanner.svelte:9-10` | LOW | `window` `offline`/`online` — pure global event, ideal `<svelte:window onoffline=… ononline=…>` candidate. |
| `apps/web/src/lib/components/ui/InstallPrompt.svelte:20` | LOW | `window` `beforeinstallprompt`. Same. |
| `apps/web/src/routes/+layout.svelte:48-49` | LOW | `window` `error`, `unhandledrejection`. Same. |
| `apps/web/src/lib/components/map/DrawingToolbar.svelte:312` | LOW | `document` `keydown`. `<svelte:document onkeydown=…>`. |

**Fix:** replace each effect with the corresponding element. Removes the manual `removeEventListener` boilerplate; cleanup is implicit.

**Not findings** (correct): `ExportDialog.svelte:51,72` (EventSource — not a window/document target, must stay in code) and `UpdateBanner.svelte:17,21` (ServiceWorker registration — same, can't be a markup element).

### 3. `{@const}` could replace duplicate computation in `{#each}` blocks

**Skill rule:** "Useful in `{#each}` and `{#if}`" — declare once, reference many.

Most existing `{@const}` sites are correct (`AnnotationContent.svelte:82-84`, `DataTable.svelte:215`, `DataLayerRenderer.svelte:87-88`, `StylePanel.svelte:663`, `EmptyState.svelte:18`, `GeoprocessingPanel.svelte:376`, `MapEditor.svelte:770-771`, `AnnotationForm.svelte:302`). Two opportunities to **add** them:

| File:line | Severity | Issue |
|---|---|---|
| `apps/web/src/lib/components/ui/DataTable.svelte:125-135` | LOW | `{#each filteredRows as row}` iterates and `cellValue(row[col.key])` per col — if `cellValue` becomes non-trivial or row has derived fields, hoist with `{@const rowCells = columns.map(c => cellValue(row[c.key]))}` or per-row precompute. Currently fine; flagged for future-proofing only. |
| `apps/web/src/lib/components/data/DataTable.svelte:215` | INFO | Pattern already correctly used (`{@const val = String(...)}`). No fix. |

### 4. Unkeyed `{#each}` blocks

**Skill rule:** "Always use keyed each blocks — never use index as key." Several unkeyed blocks found; classify by whether items can reorder/insert/remove.

**MED — should add keys** (mutable / reorderable data):

| File:line | Iterates | Suggested key |
|---|---|---|
| `apps/web/src/lib/components/admin/AuditLogViewer.svelte:36` | `columns` (header) | `(col.key)` if column reorder possible |
| `apps/web/src/lib/components/admin/ImportJobMonitor.svelte:50` | `columns` | `(col.key)` |
| `apps/web/src/lib/components/admin/UserList.svelte:54` | `columns` | `(col.key)` |
| `apps/web/src/lib/components/ui/DataTable.svelte:104,125,131` | `columns`, `filteredRows`, `columns` | `(col.key)`, `(row.id ?? i)`, `(col.key)` — rows definitely keyable |
| `apps/web/src/lib/components/ui/Select.svelte:43` | `options` | `(opt.value)` |
| `apps/web/src/lib/screens/SettingsScreen.svelte:126` | `apiKeyColumns` | `(col.key)` |
| `apps/web/src/lib/screens/AdminScreen.svelte:145` | `tabs` | `(tab.id)` |

**LOW — fine as-is** (compile-time constant arrays, rendered once, cannot reorder):

- `DashboardScreen.svelte:72` — inline literal array.
- `AnnotationStylePanel.svelte:116` — `as const` literal `['solid','dashed','dotted']`.
- `SkeletonLoader.svelte:11,24,31` — `{ length: N }` placeholder bones.
- `StylePanel.svelte:663` — already keyed `(c)` per result above.

### 5. `{@render}` audit

All 12 sites pass `children()` / `footer()` / `section.content()` with **zero** untyped or parameterless misuse. `SidePanel.svelte:143` passes nothing because `section.content` is parameterless by contract — fine. No recommendations.

### 6. `{@debug}` leftovers

**Zero hits.** Confirmed clean.

### 7. `{@html}` and `innerHTML`

**Zero hits** for both. Confirmed clean — no XSS surface from this directive in the Svelte layer. (Phase 3 unified-annotations rich-text rendering does not currently route through `{@html}`; if/when it does, `DOMPurify.sanitize` + `$derived` per skill Security Warning is mandatory.)

---

## Confirm/refute prior findings

| Prior claim (svelte-skills-audit.md §4) | Verdict |
|---|---|
| MED: `{#key}` underused; id-shadow `$effect` would be cleaner with `{#key}` | **Confirmed**, but this is a `svelte-runes` concern, not template-directives. Note carried over without re-listing. |
| Clean: zero `{@html}`, `{@attach}` not used (no migration debt), `use:enhance` correct | **Confirmed.** Adding nuance: `{@attach}` non-use is currently *forced* by Svelte 5.17.3 < 5.29. Flagged as future migration debt. |

---

## Action ranking

1. **Upgrade Svelte to ≥5.29** so `{@attach}` is available — unblocks the highest-leverage findings (1).
2. **Add keys to `{#each}` over `columns`/`options`/`rows`/`tabs`** — Finding 4 (MED). Cheap, prevents stale-DOM bugs after sort/filter.
3. **Replace window/document `$effect` listener blocks with `<svelte:window>`/`<svelte:document>`** — Finding 2 (LOW). 4 sites, mechanical.
4. **Post-upgrade: convert MapLibre/TerraDraw/MapboxOverlay `$effect`s to `{@attach}` factories** — Finding 1 (MED). Improves reactivity on `map` reassignment and centralises cleanup.

Skill rules unviolated: `{@html}`, `{@debug}`, `{@render}`, most `{@const}` sites, `use:enhance`. No new mulch records proposed beyond the existing rule corpus.
