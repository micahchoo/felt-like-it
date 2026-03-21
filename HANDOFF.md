# Handoff

## Goal
Reskin every UI surface to match the reference designs at `docs/stitch_layer_annotation_panels/stitch_layer_annotation_panels/`. Iterative refinement loop until fully done.

## Branch
`feat/web-next-merge` — 15 commits ahead of master

## Progress

### Web-Next Merge (Complete)
- ✅ Merged web-next prototype UI into apps/web (Path A — big-bang replacement)
- ✅ Copied: 8 screens, 7 contracts, 30+ UI components, admin/collaboration component dirs
- ✅ Wired routes: dashboard (DashboardScreen), settings (SettingsScreen), admin (AdminScreen consolidated), auth (form-action restyled)
- ✅ Static assets: fonts (Inter + Kode Mono woff2), PWA icons, manifest, app.css with design tokens
- ✅ Root layout: PWA components (OfflineBanner, InstallPrompt, UpdateBanner)
- ✅ lucide-svelte dependency added
- ✅ AuditLogEntry type added to shared-types
- ✅ Build passes, 703/710 server tests pass (7 pre-existing failures)

### MapEditor Reskin — Wave 1 (Complete)
- ✅ Token migration: MapEditor shell, DrawingToolbar, DrawActionRow, LayerPanel, SidePanel, BasemapPicker, Tooltip — all migrated from slate/blue to design tokens
- ✅ Layer type badges: POINT/LINE/POLYGON/MIXED with color coding
- ✅ Status bar: cursor lat/lng, CRS EPSG:4326, zoom, green CONNECTED indicator
- ✅ Icon sidebar: 52px rail (LAYERS/PROCESS/TABLES/EXPORT) with LayerPanel flyout

### Reskin Wave 2 — Token Migration (Complete)
- ✅ All 22+ component files migrated from slate/blue to design tokens
- ✅ Zero remaining `bg-slate-*`, `text-slate-*`, `ring-blue-*` references (except 1 intentional polygon badge in LayerPanel)
- ✅ All `border-white/10` → `border-white/5` consistently

### Reskin Wave 3 — Structural Layout Changes (Complete)
- ✅ **DrawingToolbar** — moved to top-center horizontal, lucide icons, divider between select/draw tools
- ✅ **SidePanel** — glass-panel bg, amber inset border accent, amber icon tinting on active
- ✅ **AnnotationPanel** — full token migration, amber primary accents
- ✅ **StylePanel** — MAPPING MODE tabs (Simple/Categoric/Numeric), COLORRAMP section, COMPOSITION LAYERS with Fill Overlay
- ✅ **GeoprocessingPanel** — icon grid (2x5) replacing dropdown, PostGIS Engine header, RUN ANALYSIS button
- ✅ **MeasurementPanel** — terminal-style with LIVE MEASUREMENT MODE header, 2-column stat cards, unit toggle pills
- ✅ **FeaturePopup** — glass-panel with MapPin icon, coordinate stat pairs, EDIT ATTRIBUTES amber button
- ✅ **ImportDialog** — Import Pipeline header, dashed drop zone, LIVE JOB POLLING section, amber progress bars
- ✅ **ExportDialog** — Export & Output Controls, format cards, progress bar, Download/Generate buttons
- ✅ **ShareDialog** — collaborator list with avatars, role dropdowns, public access section, amber copy buttons
- ✅ **DataTable** — amber header, uppercase column names, validation badges (emerald/amber/muted), font-mono IDs
- ✅ **FilterPanel** — amber section headers, active filter chips with amber accent
- ✅ **Legend** — token migration complete

### Reskin Wave 4 — Screen Refinements (Complete)
- ✅ **Dashboard** — search bar, tab selector (All Maps/Recent/Shared/Templates), map cards with thumbnails/badges, PWA install prompt
- ✅ **Admin** — Audit Log Terminal aesthetic, stats section (Total Mutations, Shard Mode, Matrix), System Health indicators, terminal-style log entries
- ✅ **Settings** — amber section headers, design token cards, API keys table styling
- ✅ **Auth (Login + Register)** — centered glass card, FLI brand, amber submit buttons, token-styled inputs

### Remaining Work — UX Gestalt Remediation

Shadow walk (STATE.md) found 46 UX issues across 10 flows. Reskin is cosmetically complete but flows feel broken because components were styled independently without tracing user journeys.

**P0 — Silent failures + race conditions (10 findings)**
Fix error handling, add retry logic, prevent draw-without-layer, fix blob revocation timing.
Route: characterization-testing → targeted fixes.

**P1 — No feedback + dead ends + hidden requirements (19 findings)**
Wire dashboard buttons, add loading states, add inline validation messages, fix unsaved-changes warnings.
Route: writing-plans → implementation sprint.

**P2 — Assumptions + jargon (12 findings)**
UI copy pass: rename "Import Pipeline"→"Import Data", add tooltips, label pre-filled coords, etc.

**Pre-existing:** 29 type errors from web-next merge (not reskin-related).

### Routes NOT reskinned (kept existing behavior)
- `(app)/map/[id]` — MapEditor reskinned but child panel internals still need work
- `(public)/share/[token]` — uses MapEditor readonly, will inherit reskin
- `(public)/embed/[token]` — same

## What Worked
- **Parallel subagent dispatch** — 6 CSS-only reskin tasks in parallel, zero conflicts
- **Token migration pattern** — systematic class replacement (bg-slate-800 → bg-surface-container, etc.) is mechanical and safe
- **Design tokens already in app.css** — glass-panel, tonal-elevation, signature-gradient, surface hierarchy, font-display all ready to use
- **Icon sidebar approach** — thin rail + flyout preserves LayerPanel component unchanged

## What Didn't Work
- **mulch commands** fail on feat/web-next-merge branch — `.mulch/` directory not found (exists on master, not on this branch). Need to run mulch from project root or copy .mulch.

## Key Decisions
- **Path A merge** — web-next UI merged into apps/web, not standalone app. Server code untouched.
- **MapEditor kept, not rewritten** — reskinned in place, preserving all functional logic
- **Auth uses form actions** — not screen callback pattern. GlassPanel + Input + Button with use:enhance.
- **Admin consolidated** — 4 sub-routes merged into single AdminScreen
- **Design token system**: surfaces (bg-surface, bg-surface-container, bg-surface-high, bg-surface-lowest), primary (amber/gold), text (text-on-surface, text-on-surface-variant, text-primary), signatures (glass-panel, tonal-elevation, signature-gradient, surface-well, status-glow), typography (font-display = Kode Mono, font-body = Inter)

## Active Skills & Routing
- **executing-plans** was used for the merge (14 tasks, 4 waves)
- **Plan mode** was used for the MapEditor reskin (8 tasks, 3 waves)
- Next: iterative refinement loop — user wants `/loop`-style continuous refinement until every surface matches reference designs

## Reference Designs
Located at `docs/stitch_layer_annotation_panels/stitch_layer_annotation_panels/`. Each directory has `screen.png` (target design) and `code.html` (reference implementation). Key references:

| Directory | What it shows |
|-----------|--------------|
| `desktop_map_editor_orchestrator` | Main desktop layout: icon sidebar, toolbar, layer panel, status bar |
| `fli_dashboard` | Dashboard with map cards, tabs, search, PWA install prompt |
| `layer_annotation_panels` | Style editor (Simple/Categoric/Numeric), annotation panel with coordinates |
| `annotation_crud_felt_inspired` | Mobile annotation editor with content type picker |
| `audit_log_admin_view` | Audit Log Terminal aesthetic |
| `desktop_data_table_filter_panel` | Data table with validation badges |
| `desktop_editor_geoprocessing` | Geoprocessing panel with operation icons |
| `desktop_export_output_controls` | Export controls with progress bar |
| `desktop_import_audit_terminal` | Import pipeline + audit terminal split |
| `desktop_collaboration_permissions` | User list with roles, public access token |
| `desktop_geoprocessing_panel_refined` | Refined geo panel with PostGIS operations |
| `measurement_spatial_math` | Terminal-style measurement display |
| `map_editor` | Mobile map editor with feature popup |
| `public_share_embed_view` | Public share/embed view |

Also: `docs/stitch_layer_annotation_panels/fli_design_audit_compliance_document.html` — full design audit document.

## Next Steps
1. **Read the design audit document** (`fli_design_audit_compliance_document.html`) — may contain specific design rules and compliance criteria
2. **Reskin MapEditor toolbar** — convert text labels to icon-only with tooltips, matching reference
3. **Reskin each child panel** — AnnotationPanel, StylePanel, GeoprocessingPanel, MeasurementPanel, DataTable, FilterPanel, FeaturePopup — one at a time, checking reference screenshot each time
4. **Reskin dialogs** — ImportDialog, ExportDialog, ShareDialog
5. **Refine wired screens** — Dashboard, Admin, Settings, Auth — compare against their reference screenshots
6. **Final pass** — compare every screen against every reference, fix remaining gaps

## Context Files
- `apps/web/src/lib/components/map/MapEditor.svelte` — main editor component (reskinned)
- `apps/web/src/app.css` — design token definitions (surfaces, primary, typography, signatures)
- `docs/stitch_layer_annotation_panels/` — reference designs directory
- `docs/superpowers/specs/2026-03-20-web-next-merge-design.md` — merge design spec
- `docs/superpowers/plans/2026-03-20-web-next-merge.md` — merge implementation plan

## Backups
- Tags: `backup/pre-merge-master`, `backup/pre-merge-web-next`
- Stash: `stash before web-next worktree` (stash@{0})

## Other Pending Work
- Merge `fix/api-adversarial-bugs` to master
- Lost updates design decision (enforce If-Match or accept last-write-wins)
- Terra Draw bug (drawing tool dies after feature selection)
- Deploy to production
