# Shadow Walk Skill: Layered UX Audit Protocol

**Date:** 2026-03-19
**Status:** Draft

## Problem

Shadow walks — tracing user-facing flows through code to find UX issues — are effective but ad-hoc. The 94-issue audit on this project proved the methodology works, but:

1. **No repeatable protocol** — each walk depends on the agent's judgment for what to trace and how deep to go
2. **No scoping model** — full audits, targeted investigations, and regression checks all use the same unstructured approach
3. **No integration** — findings don't route to the right remediation skill (debugging vs brainstorming vs testing)
4. **No targeting** — walks don't leverage anti-pattern scan signals to prioritize high-risk files

## Solution

A reusable skill with a core walk protocol in a reference file, two modes (full audit + targeted), 5 phases, and bidirectional integration with existing skills. Anti-pattern scan signals feed targeting; walk findings route to remediation skills.

## Skill Structure

```
~/.claude/skills/shadow-walk/
  SKILL.md              <- entry point, mode selection, phase orchestration
  references/
    walk-protocol.md    <- core tracing instructions, flag taxonomy, evidence rules
    agent-prompt.md     <- template for dispatching walker subagents
    false-positives.md  <- known false positive patterns by framework
```

### SKILL.md

Entry point. Responsibilities:
- Mode selection (full audit vs targeted, with scope type)
- Phase orchestration (Target -> Walk -> Compile -> Cluster -> Route)
- Anti-pattern report loading (Phase 1)
- Subagent dispatch coordination (Phase 2)
- Output format enforcement (Phase 3-5)

### walk-protocol.md

Core reference loaded by every walker subagent. Contains:
- Tracing instructions: render -> data source -> handler -> state -> re-render
- Happy path first, then sad, then weird (back button, refresh, double-click, slow network)
- Branch on roles/flags -> walk each variant
- Evidence rules: every claim -> file:line, every flag -> can a test or lint rule catch it permanently

### Flag Taxonomy

| Flag | Meaning |
|------|---------|
| DEAD END | No obvious next action for the user |
| SILENT FAIL | Error caught but not shown to user |
| NO FEEDBACK | State changes with no visible indication |
| ASSUMPTION | Jargon, unlabeled inputs, domain knowledge required |
| RACE | Stale data, flash states, timing-dependent behavior |
| NAV TRAP | Navigation loses user state |
| HIDDEN REQ | Validation only surfaces on submit |

### agent-prompt.md

Template for subagent dispatch. Includes:
- Scope definition (which files/flows to walk)
- Protocol reference path to load
- Output format (structured findings with flag, file:line, description)
- Instruction to not fix — only report what the user experiences

### false-positives.md

Framework-specific patterns that look like issues but aren't:
- SvelteKit: `goto()` after form action (not a NAV TRAP — intentional redirect)
- MapLibre: `map.on('error')` without user feedback (map errors are internal, not user-facing)
- tRPC: `onError` in middleware (server-side logging, client gets typed error)
- Terra Draw: `stop()` in try/catch (defensive teardown, not SILENT FAIL)

Grows over time as walks encounter false positives. Each entry needs: pattern, framework, why it's not an issue.

## Walk Taxonomy

### Full Audit

Three waves, each progressively deeper:

**Wave 1 — Major Flows:** One agent per top-level route group. Covers login, CRUD, primary workspace, sharing, admin/settings. Always runs first, covers ~60% of UX surface.

**Wave 2 — Sub-flows:** Breaks major flows into interactions — data pipelines, client state, UI infrastructure, API routers, styling/viz. Only dispatched for areas with 3+ issues from Wave 1.

**Wave 3 — Deep Dives:** Exhaustive single-feature walks — input mode variants, role-based behavior, unit/format variants, known debt impact. For features with multiple input modes or role-gated behavior.

### Targeted

Five scope types, each triggered by a different integration:

| Scope Type | What Gets Walked | Typical Trigger |
|---|---|---|
| Single file | All handlers/interactions in that file | Anti-pattern scan risk score |
| Single flow | Entry to completion with every branch | Brainstorming or debugging |
| Signal cluster | Every file:line of a signal type traced to user impact | Characterization testing |
| Component boundary | Data flow across boundary, state handoff, error propagation | Executing-plans or writing-plans |
| Regression | Re-walk only flows touching changed files, compare findings | Requesting-code-review |

## Phases

### Phase 1: Target

**Input:** Mode selection (full/targeted), optional scope, anti-pattern report.

**Actions:**
- Load anti-pattern report from `<project>/.claude/anti-pattern-report.txt` if it exists
- For full audit: rank route groups by risk score, assign Wave 1 agents
- For targeted: validate scope type matches trigger context, identify files to walk

**Output:** Walk plan — list of scopes with assigned agents and priority order.

### Phase 2: Walk

**Input:** Walk plan from Phase 1.

**Actions:**
- Dispatch subagents with `agent-prompt.md` template, scoped to their assigned files/flows
- Each agent loads `walk-protocol.md` as reference
- Each agent traces: render -> data source -> handler -> state -> re-render
- Each agent checks: happy path, sad path, weird path (back, refresh, double-click, slow network)
- Each agent records findings as structured flags with file:line evidence

**Output:** Raw findings per agent — list of `{flag, file, line, flow, description, evidence}`.

### Phase 3: Compile

**Input:** Raw findings from all walkers.

**Actions:**
- Merge findings across agents, deduplicate by file:line
- Cross-reference with `false-positives.md`, remove known false positives
- Assign severity: critical (blocks user), major (confusing), minor (rough edge)
- Format into STATE.md structure: per-flow entries with steps, issues, category, location

**Output:** Compiled findings document.

### Phase 4: Cluster

**Input:** Compiled findings, anti-pattern report.

**Actions:**
- Group findings by flag type, file, and flow
- Cross-reference with anti-pattern scan: which findings were predicted by signals (scan-predicted) vs discovered only through UX tracing (UX-only)
- Identify hotspots: files/flows with 3+ findings
- For full audit: determine which areas qualify for Wave 2/3

**Output:** Clustered analysis — hotspots, signal confirmation rates, wave escalation decisions.

### Phase 5: Route

**Input:** Clustered analysis.

**Actions:**
- Recommend next actions based on flag type:

| Flag Pattern | Recommended Skill | Priority |
|---|---|---|
| SILENT FAIL, RACE | characterization-testing | High — needs safety net before fix |
| DEAD END, NO FEEDBACK | brainstorming | Medium — needs design decision |
| HIDDEN REQ | writing-plans | Medium — needs spec for validation UX |
| NAV TRAP | systematic-debugging | Medium — needs root cause analysis |
| ASSUMPTION | documentation | Low — cosmetic unless blocking |

- For full audit: output wave escalation plan (which areas get Wave 2/3)
- For targeted: output specific remediation recommendations

**Output:** Routing recommendations with rationale. Written to STATE.md or returned to calling skill.

## Integration Hooks

### Inbound (skills that trigger shadow-walk)

| Source Skill | Trigger Condition | Shadow Walk Mode |
|---|---|---|
| Explicit invocation | User says "shadow walk" / "audit UX flows" | Full audit |
| brainstorming | New feature touches user-facing flows | Targeted: single flow |
| systematic-debugging | Bug is in user-facing code path | Targeted: single file |
| characterization-testing | Signal cluster needs UX verification | Targeted: signal cluster |
| executing-plans | Task crosses component boundaries | Targeted: component boundary |
| writing-plans | Plan touches component boundaries | Targeted: component boundary |
| requesting-code-review | Changes touch user-facing flows | Targeted: regression |

### Outbound (shadow-walk routes to other skills)

See Phase 5 routing table. Shadow walk discovers issues but does not fix them — it routes to the appropriate skill for remediation.

### Anti-Pattern Scan Integration

- **Phase 1:** Loads `<project>/.claude/anti-pattern-report.txt` for targeting. Files with risk score > 10 are walked first.
- **Phase 4:** Cross-references findings. Scan-predicted findings confirm the scan's accuracy. UX-only findings indicate gaps in scan coverage (potential new detectors).

## Trigger Description

**Positive triggers:** "shadow walk", "walk this flow", "audit UX flows", "trace user experience", "what does the user see when..."

**Diffused triggers:** "check all the flows", "find UX issues", "what's broken from the user's perspective"

**Negative triggers (do NOT activate):** code review (use interactive-pr-review), debugging known errors (use systematic-debugging), writing tests (use characterization-testing), performance analysis

**Distinguishing test:** Is the question "what does the user experience?" If yes, use this skill. If the question is about code correctness, performance, or test coverage, use the appropriate other skill.

## Locked Decisions

1. **Layered protocol (Approach C)** — core protocol in reference file, not inline in SKILL.md. Keeps SKILL.md focused on orchestration, protocol reusable across modes.
2. **Two modes, not three** — full audit and targeted cover all use cases. "Quick scan" is just targeted with narrow scope.
3. **5 phases always run in order** — no skipping. Even targeted walks benefit from clustering and routing.
4. **Subagent dispatch for walks** — walkers run as subagents to parallelize and isolate findings. SKILL.md orchestrates.
5. **Flag taxonomy matches CLAUDE.md** — uses the same flags defined in project CLAUDE.md UI/Shadow section. Single source of truth.
6. **False positives grow, never shrink** — entries are only added, never removed. Framework behavior may change but the pattern is worth documenting.
