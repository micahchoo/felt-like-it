# Handoff: Anti-Pattern Scan + Shadow Walk Skill

## Goal
Build deterministic scripts to target/plan/scope shadow walks, then generalize the shadow walk methodology into a reusable skill. Two deliverables: (1) anti-pattern scan extension, (2) shadow-walk skill.

## Progress

### ✅ Anti-Pattern Scan Extension (complete, working, not committed)
- `~/.claude/scripts/anti-pattern-scan.sh` — rewritten with 7 detectors (silent-catch, console-only-error, fire-and-forget, catch-all, untested-churn, todo-density, no-error-surface via silent-catch), JSONL internal format, dual output (categorized findings + deduplicated risk scores), git-state cache, project-specific detector glob
- `~/.claude/scripts/anti-pattern-hook.sh` — PreToolUse hook that injects compact summary (~25 lines: signal counts, top 15 risk scores, top 10 silent-catch findings, file path to full report) when brainstorming/debugging/CT/writing-plans skills are invoked
- `~/.claude/settings.json` — hook wired into existing Skill matcher with 30s timeout
- Full report written to `<project>/.claude/anti-pattern-report.txt` (507 lines for felt-like-it)
- `.gitignore` updated to exclude the report file
- Spec: `docs/superpowers/specs/2026-03-19-anti-pattern-scan-extension-design.md`
- Plan: `docs/superpowers/plans/2026-03-19-anti-pattern-scan-extension.md`

### 🔄 Shadow Walk Skill (design approved, spec not yet written)
- Brainstorming complete — all 4 design sections approved by user
- Design lives only in conversation context — MUST be written to spec file

### ⬚ Commit all work

## What Worked
- `set -u` instead of `set -euo pipefail` for diagnostic scripts — grep returning no matches is normal, `set -e` kills detectors silently
- 15-line lookback window for fire-and-forget (2-line was too aggressive, 410→322 findings)
- Deduplicating signals in risk scores: `fire-and-forget:64x32` instead of repeating 32 times
- Writing full report to file, injecting only compact slices into hook context
- Subshell wrapping `(grep ... || true)` to prevent exit-1 in pipes under strict modes

## What Didn't Work
- `set -euo pipefail` — too strict for a script where grep no-match is normal behavior, caused silent exit-1 with no error message
- `[[ ! -t 0 ]]` stdin TTY check — hangs in background execution contexts where stdin is not a TTY but also has no data. Fixed with `read -r -t 1` timeout probe.
- `ctx_execute_file` with shell language couldn't read the file (empty `$FILE_PATH`) — used Read tool instead for files needing edit

## Key Decisions
1. **Single script extension, not plugin architecture** — ruled out advisory system, template generators, detector module directories
2. **grep/awk/git only, no AST** — heuristic detection with known false positive rates, shadow walks verify
3. **Hook injects compact summary + file path** — not full findings (507 lines would flood context)
4. **`set -u` only** — `set -e` and `pipefail` are hostile to diagnostic scripts
5. **Shadow walk skill: Layered Protocol (Approach C)** — core protocol in reference file, two modes (full audit + targeted), 5 phases (Target → Walk → Compile → Cluster → Route), bidirectional integration with 6+ skills

## Active Skills & Routing
- `brainstorming` — completed for shadow-walk skill, design approved, ready for spec writeup
- `writing-skills` — next skill to invoke after spec is written (creates the actual skill files)
- Anti-pattern-scan hook is now live in settings.json — will fire on next skill invocation in any project

## Next Steps

### 1. Write shadow-walk skill spec
Write the approved design to `docs/superpowers/specs/2026-03-19-shadow-walk-skill-design.md`. The design has 4 sections all approved:

**Section 1 — Skill Structure:**
```
~/.claude/skills/shadow-walk/
├── SKILL.md              ← entry point, mode selection, phase orchestration
├── references/
│   ├── walk-protocol.md  ← core tracing instructions, flag taxonomy, evidence rules
│   ├── agent-prompt.md   ← template for dispatching walker subagents
│   └── false-positives.md ← known false positive patterns by framework
```

**Section 2 — Walk Taxonomy + Phases:**
- Full audit: Wave 1 (major flows) → Wave 2 (sub-flows, areas with 3+ issues) → Wave 3 (deep dives, multi-mode features)
- Targeted: 5 scope types (single file, single flow, signal cluster, component boundary, regression)
- 5 phases: Target → Walk → Compile → Cluster → Route
- Walk scopes table:
  - **Full audit Wave 1 (Major Flows):** one agent per top-level route group — login, CRUD, primary workspace, sharing, admin/settings. Always first, covers ~60% of UX surface.
  - **Full audit Wave 2 (Sub-flows):** break major flows into interactions — data pipelines, client state, UI infrastructure, API routers, styling/viz. Only for areas with 3+ issues from Wave 1.
  - **Full audit Wave 3 (Deep Dives):** exhaustive single-feature — input mode variants, role-based behavior, unit/format variants, known debt impact. For features with multiple input modes or role-gated behavior.
  - **Targeted: Single file** — all handlers/interactions in that file, from anti-pattern-scan risk score
  - **Targeted: Single flow** — entry to completion with every branch, from brainstorming or debugging
  - **Targeted: Signal cluster** — every file:line of a signal type traced to user impact, from CT
  - **Targeted: Component boundary** — data flow across boundary, state handoff, error propagation, from executing-plans
  - **Targeted: Regression** — re-walk only flows touching changed files, compare findings, from requesting-code-review

**Section 3 — Integration Hooks:**
- Inbound: brainstorming (targeted: single flow), systematic-debugging (targeted: single file), characterization-testing (targeted: signal cluster), executing-plans (targeted: component boundary/regression), writing-plans (targeted: component boundary), requesting-code-review (targeted: regression), explicit invocation (full audit)
- Outbound: Phase 5 recommends routing — SILENT FAIL/RACE → characterization-testing, DEAD END/NO FEEDBACK → brainstorming, HIDDEN REQ → writing-plans, NAV TRAP → systematic-debugging, ASSUMPTION → documentation (lowest priority)
- Anti-pattern-scan: Phase 1 loads report for targeting (files with score > 10 walked first), Phase 4 cross-references for confirmation (scan-predicted vs UX-only)

**Section 4 — Trigger Description:**
- Positive: "shadow walk", "walk this flow", "audit UX flows", "trace user experience", "what does the user see when..."
- Diffused: "check all the flows", "find UX issues", "what's broken from the user's perspective"
- Negative: not code review, not debugging known errors, not writing tests, not performance
- Distinguishing test: "what does the user experience?" = this skill

### 2. Run spec review loop
Dispatch spec-document-reviewer subagent, fix issues, get user approval.

### 3. Create the skill via writing-skills
Invoke `writing-skills` to create `~/.claude/skills/shadow-walk/` with SKILL.md + references/.

### 4. Commit all work
- Anti-pattern scan scripts (already working)
- Shadow walk skill files
- Spec and plan documents
- Settings.json changes

### 5. Rebuild claude-skill-tree index
After skill is created: `context add ~/.claude --name claude-skill-tree --pkg-version 1.4`

## Context Files
| File | Why |
|------|-----|
| `~/.claude/scripts/anti-pattern-scan.sh` | The scan script — working, all detectors implemented |
| `~/.claude/scripts/anti-pattern-hook.sh` | The hook script — working, compact output |
| `~/.claude/settings.json` | Hook wiring — already modified |
| `docs/superpowers/specs/2026-03-19-anti-pattern-scan-extension-design.md` | Scan spec — for reference on locked decisions |
| `STATE.md` | 94 shadow walk issues — evidence for what the skill should produce |
