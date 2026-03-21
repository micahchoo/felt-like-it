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

### Remaining Reskin Work (Not Started)
- ⬚ **MapEditor toolbar refinement** — reference shows icon-only toolbar, current still has text labels (STYLE, IMPORT, EXPORT, etc.)
- ⬚ **Right panel (SidePanel) refinement** — active section should use amber accent, annotations/analysis/activity sections need tighter styling
- ⬚ **AnnotationPanel reskin** — reference shows coordinate display, content type picker (TEXT/EMOJI/GIF/IMAGE/LINK/IIIF), anchor UI
- ⬚ **StylePanel reskin** — reference shows FSL coloramp, composition layers (Fill Overlay + Boundary Stroke), Simple/Categoric/Numeric tabs
- ⬚ **GeoprocessingPanel reskin** — reference shows icon grid for operations (Union, Intersection, Buffer, Dissolve), target layer dropdown
- ⬚ **DataTable/FilterPanel reskin** — reference shows feature rows with validation badges, geometry type column
- ⬚ **FeaturePopup reskin** — reference shows coordinates, "EDIT ATTRIBUTES" button
- ⬚ **ImportDialog reskin** — reference shows split-screen import pipeline + audit terminal
- ⬚ **ExportDialog reskin** — reference shows output format controls, progress bar
- ⬚ **ShareDialog/Collaboration reskin** — reference shows user list with role dropdowns, public access token
- ⬚ **Dashboard refinement** — reference shows map thumbnails, tabs (All Maps/Recent/Shared/Templates), search bar
- ⬚ **Admin refinement** — reference shows "Audit Log Terminal" aesthetic with integrity badge
- ⬚ **Settings refinement** — check against reference designs
- ⬚ **Auth refinement** — check against reference designs
- ⬚ **Legend reskin** — match reference styling
- ⬚ **MeasurementPanel reskin** — reference shows terminal-style measurement display

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
