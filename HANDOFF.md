# Handoff

## Goal
Brownfield hardening — fix UX issues found during shadow walk (46 findings across 10 flows). Waves 1-2 complete (15/34 tasks), Waves 3-5 remain (19 tasks).

## Branch
Work lands directly on `master` via cherry-pick from feature branches. Previous branches: `fix/brownfield-turn3` (Wave 1, cleaned up), `fix/brownfield-wave2` (Wave 2, cherry-picked).

## Progress

### Brownfield Wave 1 (9 tasks, complete on master)
- Modal focus restoration via `previousFocus`
- Network error messages in `handle-error.ts`
- Login screen admin contact link
- MapEditor View Only badge
- Reduced-motion CSS support
- Register/Login autofocus
- GuestCommentPanel visibility hint
- InstallPrompt localStorage guard
- MapEditor silent catch removal

**Note**: 3 of 9 Wave 1 markers (Modal previousFocus, LoginScreen mailto, autofocus) exist on `fix/brownfield-turn3` but were NOT cherry-picked to master. They need to be cherry-picked or re-implemented.

### Brownfield Wave 2 (6 tasks, complete on master)
- Share/embed: `data.error` return instead of `error(404)`, "Link Not Found" page
- SettingsScreen: API key copy button with toast, "won't be shown again" warning
- AdminScreen: `window.confirm()` guard before disabling users
- DrawingToolbar: descriptive `aria-label` attributes on all buttons
- DashboardScreen: `creatingMap` loading state prevents double-click
- RegisterScreen: inline "Passwords must match" validation on blur

### Remaining: Waves 3-5 (19 tasks)

**Wave 3 (8 tasks) — feedback + transitions:**
- 1.7: LayerPanel error state (`loadErrors` marker)
- 1.9: AnnotationPanel field errors (`fieldErrors` marker)
- 1.10: Upload error toast
- 2.1: Modal transitions (`transition:fade` marker)
- 2.2: BasemapPicker/DataTable transitions (`transition:fly` marker)
- 2.5: Empty states (`No features to display` marker)
- 2.8: Filter count display (`Showing {filteredCount}` marker)
- 2.11: AnnotationThread retry button (`Retry` marker)

**Wave 4 (6 tasks) — structural + undo:**
- 3.1: StylePanel rollback (`layersStore.updateStyle(layer.id, lastSavedStyle)` marker)
- 3.2: Version typing
- 3.3: Undo closure (test: `drawing-undo-closure.test.ts`)
- 3.4: Save-failure UX
- 3.5: Geoprocessing cancel (`cancelling` marker)
- Test: `style-panel-rollback.test.ts`

**Wave 5 (5 tasks) — races + guards:**
- 4.1: Visibility dedup
- 4.2: Load generation guard
- 4.3: Import await
- 4.4: transitionTo decoupling (`// pure state machine` marker)
- 4.5: Init/reset guard

## Key Decisions (in mulch)
1. Priority: dead ends > polish > structural > races (no current users)
2. No new components/abstractions
3. Modal focus via `previousFocus` ref
4. Share/embed error via data return, not error boundary
5. Destructive actions use `window.confirm()` guards
6. Undo after server confirm
7. `transitionTo` as pure state machine
8. `setActiveTool` conditional clearing is intentional
9. Subagents don't work in worktrees — use sequential mode

## What Worked
- Cherry-pick workflow: implement on feature branch, cherry-pick to master, clean up
- Sequential mode for small targeted UI fixes
- Mulch search before implementing (loads relevant conventions)

## Active Skills & Routing
- Resume: `check-handoff` → `executing-plans` (Sequential Mode)
- Plan: `docs/superpowers/plans/2026-03-22-brownfield-hardening-turn3.md` (has artifact manifest)
- Audit: `bash ~/.claude/scripts/post-implementation-audit.sh <plan-path>` — currently 15/29 pass

## Context Files
- `docs/superpowers/plans/2026-03-22-brownfield-hardening-turn3.md` — plan with artifact manifest
- `CLAUDE.md` — project conventions
- `STATE.md` — shadow walk findings

## Other Pending Work
- Merge `fix/api-adversarial-bugs` to master
- `feat/web-next-merge` branch (reskin complete, not merged — cosmetic only, separate concern)
- Lost updates design decision (enforce If-Match or accept last-write-wins)
- Terra Draw bug (drawing tool dies after feature selection)
- Deploy to production
- 3 Wave 1 tasks not cherry-picked (Modal, LoginScreen, autofocus)
