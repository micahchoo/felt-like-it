# Anti-Pattern Scan Extension: Risk Signal Detection for Shadow Walks

**Date:** 2026-03-19
**Status:** Draft

## Problem

Shadow walks require manual targeting — an agent must read files, guess which flows are risky, and enumerate sub-flows to trace. The 94-issue shadow walk on this project succeeded but the targeting was entirely judgment-based. There's no deterministic way to:

1. **Target** — which files/flows have the highest risk signal density
2. **Plan** — which signal categories dominate (silent fails vs race conditions vs missing feedback)
3. **Scope** — how many files warrant deep walks vs surface passes
4. **Find an early batch** — which files should be characterized or walked first

## Solution

Extend `~/.claude/scripts/anti-pattern-scan.sh` with additional signal detectors that produce both categorized findings (with file:line locations) and per-file risk scores. Cache results. Wire into skill invocations via PreToolUse hook.

## Architecture

Single script extension. No new directories, no advisory system, no template generators.

```
~/.claude/scripts/anti-pattern-scan.sh   <-- extended with new detectors + dual output
<project>/.claude/scripts/detect-*.sh    <-- optional project-specific detectors (manual)
```

### Detector Contract

Each detector is a function within `anti-pattern-scan.sh` (or a standalone `detect-*.sh` for project-specific patterns). All detectors output JSONL to stdout:

```jsonl
{"file":"src/MapEditor.svelte","line":493,"signal":"silent-catch","severity":2,"detail":"try/catch -> console.error, no user feedback"}
```

Fields:
- `file` — relative path from project root
- `line` — line number (0 if file-level signal)
- `signal` — detector name (kebab-case)
- `severity` — integer weight (1-3)
- `detail` — human-readable description

### Global Signal Detectors

All detectors are grep/awk/git based. No AST parsing. No LLM.

| Signal | Detection Logic | Severity | Rationale |
|--------|----------------|----------|-----------|
| `silent-catch` | try/catch or .catch() body contains only console.error/warn/log — no throw, no toast, no return error, no user-facing feedback | 3 | Direct SILENT FAIL source. Highest shadow walk hit rate. |
| `console-only-error` | `console.error` as sole error handling in a function (no throw, no return, no UI call) | 2 | Weaker form of silent-catch — error logged but user never sees it. |
| `fire-and-forget` | Promise-returning call with no .catch(), no try/catch wrapper, no error handler in chain | 2 | Unhandled async errors. Maps to SILENT FAIL + RACE. |
| `catch-all` | Bare `catch(e)` / `catch(_)` / `except:` / `except Exception` with no specific error type | 1 | Swallows errors indiscriminately. Low severity alone but compounds with other signals. |
| `untested-churn` | File in top-20 git churn (6 months) with no corresponding test file (`*.test.*`, `*.spec.*`, `__tests__/*`) | 2 | High-change files without tests are the most likely to have undetected regressions. |
| `todo-density` | 3+ TODO/FIXME/HACK/XXX markers in a single file | 1 | Acknowledged debt concentration. |
| `no-error-surface` | Async function body has try/catch but catch branch calls no function matching common UI feedback patterns (toast, alert, notify, dispatch, emit, set.*error, show.*error) | 2 | Async operation fails silently — the catch exists but does nothing user-visible. |

### Detection Heuristics

**silent-catch detection (pseudocode):**

Approach: Use `grep -n 'catch' | awk` with a fixed context window (10 lines after catch). This is a deliberate trade-off: catch blocks longer than 10 lines may produce false negatives, but most error handlers are short. False positives from nested functions within the window are acceptable — shadow walks verify findings.

```
For each file in scan scope:
  grep -n 'catch' to find catch lines with line numbers
  For each catch line, extract the next 10 lines (awk window)
  In that window, check for:
    - console.error / console.warn / console.log  --> present? mark as "logs"
    - throw / toast / notify / alert / emit / set.*error / show.*error --> present? mark as "surfaces"
    - return.*error / return.*fail / return.*null --> present? mark as "returns"
  If "logs" but not "surfaces" and not "returns" --> emit silent-catch finding
```

The 10-line window is tunable. Start conservative; if false negative rate is too high, increase.

**untested-churn detection:**
```
churn_files = git log --since="6 months ago" --name-only | sort | uniq -c | sort -rn | head -20
test_files = git ls-files | grep -E '\.(test|spec)\.' or '__tests__/'
For each churn_file:
  Strip extension, check if any test_file contains the base name
  If no match --> emit untested-churn finding with churn count in detail
```

**fire-and-forget detection:**

Approach: Line-level heuristic, NOT scope-tracking. Grep for `await` calls, then check if the same line or adjacent lines (2-line window) contain try/catch/.catch. This intentionally does NOT attempt brace-scope tracking — that requires an AST. The trade-off: if `await` is deep inside a try block, this may false-positive. Acceptable — shadow walks verify.

```
For each source file (not test files):
  grep -n 'await ' to find await lines
  For each await line, check 2 lines above for 'try {' or 'try {'
  Also check if the line itself contains .catch(
  If neither found --> emit fire-and-forget finding
```

### UI Feedback Pattern List

The `no-error-surface` detector checks catch bodies for calls matching known UI feedback patterns. The default list is:

```
toast|alert|notify|dispatch|emit|set.*[Ee]rror|show.*[Ee]rror|throw|fail|reject
```

This is a grep alternation pattern, not a configuration system. If a project uses different patterns (e.g., `addNotification`, `reportError`), a project-specific `detect-*.sh` can override or supplement `no-error-surface` with project-appropriate patterns.

### Detector Input Contract

All detectors (global and project-specific) follow the same contract:

- **Input:** If stdin is a TTY (no pipe), scan all git-tracked source files. If stdin has data, read file paths from stdin (one per line).
- **Output:** JSONL to stdout, one finding per line.
- **Exit code:** 0 always (findings are informational, not errors).

This applies uniformly. The compositor pipes the same file list to all detectors.

### Output Format

The script produces two sections separated by a blank line:

```
=== FINDINGS ===
[silent-catch] src/lib/server/geoprocessing.ts:70 -- catch logs error, returns success
[untested-churn] src/lib/components/map/MapEditor.svelte:0 -- 42 commits (6mo), no test file
[fire-and-forget] src/routes/dashboard/+page.server.ts:107 -- await with no catch
[todo-density] src/lib/server/import/geopackage.ts:0 -- 4 markers (2 TODO, 1 FIXME, 1 HACK)

=== RISK SCORES ===
src/lib/components/map/MapEditor.svelte    7  silent-catch:3 untested-churn:2 todo-density:1 console-only-error:1
src/lib/server/geoprocessing.ts            5  silent-catch:3 fire-and-forget:2
src/routes/dashboard/+page.server.ts       4  silent-catch:2 fire-and-forget:2
src/lib/server/import/geopackage.ts        3  todo-density:1 catch-all:1 fire-and-forget:1
```

Risk score = sum of severity values for all findings in that file.

### Caching

Same pattern as `codebase-analytics.sh`:

```bash
CACHE_DIR="${HOME}/.cache/claude-scripts"
CACHE_KEY=$(echo "$(git rev-parse HEAD 2>/dev/null)$(git diff --stat 2>/dev/null)" | sha256sum | cut -c1-16)
CACHE_FILE="${CACHE_DIR}/anti-pattern-${CACHE_KEY}.txt"

# Serve from cache if fresh (< 5 min old)
if [[ -f "$CACHE_FILE" ]] && find "$CACHE_FILE" -mmin -5 -print -quit | grep -q .; then
  cat "$CACHE_FILE"
  exit 0
fi
```

Clean old cache files (> 1 hour) on each run, same as existing scripts.

### Project-Specific Detectors

If `<project>/.claude/scripts/detect-*.sh` files exist, the compositor runs them after global detectors and merges their JSONL output. Same contract: JSONL to stdout, receives file list on stdin.

No automatic generation. A user or agent writes these manually when project-specific patterns are identified (e.g., SvelteKit `$effect` write conflicts, form action key consistency).

## Hook Wiring

### PreToolUse Hook on Skill Invocations

Add to `~/.claude/settings.json` (or user settings):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Skill",
        "command": "~/.claude/scripts/anti-pattern-hook.sh"
      }
    ]
  }
}
```

The hook script (`anti-pattern-hook.sh`) reads the Skill tool input from stdin, checks if the skill name matches a consumer skill, and if so runs the scan and injects output:

```bash
# Read hook input
INPUT=$(cat)
SKILL_NAME=$(echo "$INPUT" | jq -r '.tool_input.skill // empty')

# Only fire for consumer skills
case "$SKILL_NAME" in
  brainstorming|systematic-debugging|characterization-testing|writing-plans) ;;
  *) exit 0 ;;
esac

# Run scan (cached)
SCAN_OUTPUT=$(~/.claude/scripts/anti-pattern-scan.sh)

# Inject as additional context
jq -n --arg ctx "$SCAN_OUTPUT" '{
  "additionalContext": ("Risk signals from anti-pattern scan:\n" + $ctx)
}'
```

### How Skills Consume Output

Each consumer skill receives the scan output as hook-injected context. The skill decides what to do:

- **brainstorming** — reads RISK SCORES to identify which areas need design attention
- **systematic-debugging** — reads FINDINGS to narrow Phase 1 investigation scope
- **characterization-testing** — reads FINDINGS to select which code paths to characterize first (prioritize silent-catch and fire-and-forget — these have testable wrong behavior)
- **writing-plans** — reads RISK SCORES to prioritize task ordering in the plan

No skill modifications needed. The hook context appears alongside other hook-injected context and the agent uses it as evidence.

## Locked Decisions

1. **Single script extension, not a plugin architecture** — rules out advisory system, template generators, detector module directories. Project-specific detectors are manual drop-in files.
2. **JSONL as internal format, text as output** — detectors produce JSONL internally for compositing, final output is human-readable text sections. Rules out JSON-only output that skills would need to parse.
3. **grep/awk/git only, no AST** — rules out language-specific parsers. Detection is heuristic. False positives are acceptable (shadow walks verify them). False negatives are acceptable (the scan targets, it doesn't replace walks).
4. **Cache per git state** — rules out time-based-only or per-session caching. Same HEAD + same dirty state = same results.
5. **Hook injection, not skill modification** — skills don't import or call the scan. They receive it as PreToolUse context. Rules out changes to skill SKILL.md files.

## Referenced Documents

- `~/.claude/scripts/anti-pattern-scan.sh` — existing script being extended
- `~/.claude/scripts/codebase-analytics.sh` — caching pattern to replicate
- `HANDOFF.md` — shadow walk methodology and false positive patterns
- `STATE.md` — 94 shadow walk issues organized by flow and flag category
