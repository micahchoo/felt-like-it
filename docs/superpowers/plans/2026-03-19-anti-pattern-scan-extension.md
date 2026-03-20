# Anti-Pattern Scan Extension Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `~/.claude/scripts/anti-pattern-scan.sh` with risk signal detectors that produce categorized findings and per-file risk scores, cached per git state, wired into skill invocations via hook.

**Architecture:** Single script rewrite with detector functions, JSONL internal format, dual text output (findings + scores). Separate hook script for PreToolUse injection. Project-specific detectors via glob.

**Tech Stack:** bash, grep, awk, git, jq

**Spec:** `docs/superpowers/specs/2026-03-19-anti-pattern-scan-extension-design.md`

---

## File Structure

- **Rewrite:** `~/.claude/scripts/anti-pattern-scan.sh` — main script with detectors, compositor, cache
- **Create:** `~/.claude/scripts/anti-pattern-hook.sh` — PreToolUse hook that gates on skill name
- **Modify:** `~/.claude/settings.json` — add PreToolUse hook entry

## Execution Waves

- **Wave 1:** Task 1 (script skeleton + cache + input contract + compositor + output formatting)
- **Wave 2:** Tasks 2, 3, 4 (parallel — individual detectors, each independent)
- **Wave 3:** Task 5 (project-specific detector glob — depends on skeleton from Wave 1)
- **Wave 4:** Task 6 (hook script + settings wiring — depends on main script working)
- **Wave 5:** Task 7 (integration test against live project)

---

### Task 1: Script Skeleton — Cache, Input Contract, Compositor, Output

**Files:**
- Rewrite: `~/.claude/scripts/anti-pattern-scan.sh`

This task builds the scaffolding. Detectors are stubs that output nothing — later tasks fill them in.

- [ ] **Step 1: Write the script skeleton**

```bash
#!/usr/bin/env bash
# anti-pattern-scan.sh — Risk signal detection for shadow walks
# Usage: anti-pattern-scan.sh [file1 file2 ...] or pipe file list on stdin
# If no input, scans all git-tracked source files.
# Output: categorized findings + per-file risk scores (cached per git state)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXCLUDES="node_modules|\.git|vendor|dist|build|__pycache__|\.next|\.cache|\.venv|target|\.worktrees"
SOURCE_EXTS='\.(ts|js|svelte|py|rb|go|rs|java|php|tsx|jsx|vue|mjs|cjs)$'

# --- Input contract ---
resolve_files() {
  if [[ $# -gt 0 ]]; then
    # File arguments passed directly
    printf '%s\n' "$@"
  elif [[ ! -t 0 ]]; then
    # Stdin pipe
    cat
  else
    # Default: git-tracked source files
    git ls-files 2>/dev/null | grep -E "$SOURCE_EXTS" | grep -vE "$EXCLUDES"
  fi
}

# --- Cache logic ---
CACHE_DIR="/tmp/anti-pattern-cache"
mkdir -p "$CACHE_DIR"

GIT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "nogit")
GIT_DIRTY=$(git diff --stat 2>/dev/null | sha256sum | cut -d' ' -f1)
CACHE_KEY=$(echo "${PWD}_${GIT_HEAD}_${GIT_DIRTY}" | sha256sum | cut -d' ' -f1)
CACHE_FILE="$CACHE_DIR/$CACHE_KEY"

if [[ -f "$CACHE_FILE" ]] && [[ $(($(date +%s) - $(stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0))) -lt 300 ]]; then
  cat "$CACHE_FILE"
  exit 0
fi

# --- Resolve file list ---
FILE_LIST=$(resolve_files "$@")
if [[ -z "$FILE_LIST" ]]; then
  exit 0
fi

# --- Detector functions (each outputs JSONL to stdout) ---
detect_silent_catch()    { :; }  # Task 2
detect_console_only()    { :; }  # Task 3 (combined with no-error-surface)
detect_fire_and_forget() { :; }  # Task 4
detect_catch_all()       { :; }  # Task 4 (same task, simple grep)
detect_untested_churn()  { :; }  # Task 5
detect_todo_density()    { :; }  # Task 5 (same task, simple grep)

# --- Run all detectors, collect JSONL ---
run_detectors() {
  local files="$1"
  detect_silent_catch    <<< "$files"
  detect_console_only    <<< "$files"
  detect_fire_and_forget <<< "$files"
  detect_catch_all       <<< "$files"
  detect_untested_churn  <<< "$files"
  detect_todo_density    <<< "$files"

  # Project-specific detectors
  local project_dir
  project_dir=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -n "$project_dir" ]]; then
    for detector in "$project_dir"/.claude/scripts/detect-*.sh; do
      [[ -x "$detector" ]] && echo "$files" | "$detector"
    done
  fi
}

# --- Compositor: JSONL -> dual output ---
compositor() {
  local jsonl="$1"
  [[ -z "$jsonl" ]] && return

  # === FINDINGS ===
  echo "=== FINDINGS ==="
  echo "$jsonl" | jq -r '"[\(.signal)] \(.file):\(.line) -- \(.detail)"' | sort

  echo ""

  # === RISK SCORES ===
  echo "=== RISK SCORES ==="
  echo "$jsonl" | jq -s '
    group_by(.file)
    | map({
        file: .[0].file,
        score: (map(.severity) | add),
        signals: (map("\(.signal):\(.severity)") | join(" "))
      })
    | sort_by(-.score)
    | .[]
    | "\(.file)  \(.score)  \(.signals)"
  '
}

# --- Main ---
JSONL=$(run_detectors "$FILE_LIST")
compositor "$JSONL" | tee "$CACHE_FILE"

# Clean old cache files (> 1 hour)
find "$CACHE_DIR" -type f -mmin +60 -delete 2>/dev/null || true
```

- [ ] **Step 2: Make executable and verify skeleton runs**

Run: `chmod +x ~/.claude/scripts/anti-pattern-scan.sh && cd /mnt/Ghar/2TA/DevStuff/felt-like-it && ~/.claude/scripts/anti-pattern-scan.sh`
Expected: `No source files found.` or empty output (detectors are stubs). No errors.

- [ ] **Step 3: Test stdin pipe contract**

Run: `echo "apps/web/src/lib/components/map/MapEditor.svelte" | ~/.claude/scripts/anti-pattern-scan.sh`
Expected: Empty output (stubs), no errors. Confirms stdin pipe works.

- [ ] **Step 4: Test caching — second run should be instant**

Run: `time ~/.claude/scripts/anti-pattern-scan.sh && time ~/.claude/scripts/anti-pattern-scan.sh`
Expected: Second run near-instant (cache hit).

---

### Task 2: Detector — silent-catch + no-error-surface

**Files:**
- Modify: `~/.claude/scripts/anti-pattern-scan.sh` (replace `detect_silent_catch` and `detect_console_only` stubs)

These two detectors share logic (both scan catch bodies) so they're implemented together.

- [ ] **Step 1: Implement detect_silent_catch**

Replace the stub with:

```bash
detect_silent_catch() {
  local files
  files=$(cat)
  echo "$files" | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    # Find catch lines, extract 10-line window after each
    (grep -n 'catch' "$f" 2>/dev/null || true) | while IFS=: read -r lineno _; do
      [[ -z "$lineno" ]] && continue
      window=$(sed -n "$((lineno)),$((lineno + 10))p" "$f")
      has_log=$(echo "$window" | grep -cE 'console\.(error|warn|log)' || true)
      has_surface=$(echo "$window" | grep -cE 'throw |toast|alert|notify|dispatch|emit|set.*[Ee]rror|show.*[Ee]rror|fail|reject' || true)
      has_return=$(echo "$window" | grep -cE 'return.*(error|fail|null|undefined|false)' || true)
      if [[ $has_log -gt 0 && $has_surface -eq 0 && $has_return -eq 0 ]]; then
        detail="catch body logs error but never surfaces to user"
        printf '{"file":"%s","line":%d,"signal":"silent-catch","severity":3,"detail":"%s"}\n' "$f" "$lineno" "$detail"
      fi
    done
  done
}
```

- [ ] **Step 2: Implement detect_console_only (no-error-surface)**

Replace the stub with:

```bash
detect_console_only() {
  local files
  files=$(cat)
  local UI_PATTERN='toast|alert|notify|dispatch|emit|set.*[Ee]rror|show.*[Ee]rror|throw|fail|reject'
  echo "$files" | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    # Find lines with console.error that are the SOLE error handling
    (grep -n 'console\.error' "$f" 2>/dev/null || true) | while IFS=: read -r lineno _; do
      [[ -z "$lineno" ]] && continue
      # Check surrounding 5 lines for any UI feedback
      window=$(sed -n "$((lineno > 5 ? lineno - 5 : 1)),$((lineno + 5))p" "$f")
      has_surface=$(echo "$window" | grep -cE "$UI_PATTERN" || true)
      if [[ $has_surface -eq 0 ]]; then
        detail="console.error with no UI feedback in surrounding context"
        printf '{"file":"%s","line":%d,"signal":"console-only-error","severity":2,"detail":"%s"}\n' "$f" "$lineno" "$detail"
      fi
    done
  done
}
```

- [ ] **Step 3: Clear cache and test against real files**

Run:
```bash
rm -f /tmp/anti-pattern-cache/*
cd /mnt/Ghar/2TA/DevStuff/felt-like-it
~/.claude/scripts/anti-pattern-scan.sh
```
Expected: FINDINGS section shows `[silent-catch]` and/or `[console-only-error]` entries with file:line references. RISK SCORES section shows files with scores.

- [ ] **Step 4: Verify known issue detected**

Run: `echo "apps/web/src/lib/components/map/MapEditor.svelte" | ~/.claude/scripts/anti-pattern-scan.sh | grep silent-catch`
Expected: At least one finding (MapEditor has catch blocks with console.error from shadow walk evidence).

---

### Task 3: Detector — fire-and-forget + catch-all

**Files:**
- Modify: `~/.claude/scripts/anti-pattern-scan.sh` (replace `detect_fire_and_forget` and `detect_catch_all` stubs)

- [ ] **Step 1: Implement detect_fire_and_forget**

Replace the stub with:

```bash
detect_fire_and_forget() {
  local files
  files=$(cat)
  echo "$files" | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    # Skip test files
    echo "$f" | grep -qE '\.(test|spec)\.' && continue
    echo "$f" | grep -qE '__tests__/' && continue
    # Find await lines (grep in subshell to prevent exit-1 under set -e)
    (grep -n 'await ' "$f" 2>/dev/null || true) | while IFS=: read -r lineno _; do
      [[ -z "$lineno" ]] && continue
      # Check 2 lines above for try
      start=$((lineno > 2 ? lineno - 2 : 1))
      above=$(sed -n "${start},${lineno}p" "$f")
      has_try=$(echo "$above" | grep -c 'try' || true)
      # Check same line for .catch
      same_line=$(sed -n "${lineno}p" "$f")
      has_catch=$(echo "$same_line" | grep -c '\.catch' || true)
      if [[ $has_try -eq 0 && $has_catch -eq 0 ]]; then
        detail="await with no try/catch or .catch() in nearby context"
        printf '{"file":"%s","line":%d,"signal":"fire-and-forget","severity":2,"detail":"%s"}\n' "$f" "$lineno" "$detail"
      fi
    done
  done
}
```

- [ ] **Step 2: Implement detect_catch_all**

Replace the stub with:

```bash
detect_catch_all() {
  local files
  files=$(cat)
  echo "$files" | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    # Bare catch with generic variable or no variable
    (grep -nE 'catch\s*\(\s*(e|_|err|error|ex)\s*\)|catch\s*\{|except\s*:|except\s+Exception' "$f" 2>/dev/null || true) \
    | while IFS=: read -r lineno _; do
      [[ -z "$lineno" ]] && continue
      detail="bare catch-all with no specific error type"
      printf '{"file":"%s","line":%d,"signal":"catch-all","severity":1,"detail":"%s"}\n' "$f" "$lineno" "$detail"
    done
  done
}
```

- [ ] **Step 3: Clear cache and test**

Run:
```bash
rm -f /tmp/anti-pattern-cache/*
cd /mnt/Ghar/2TA/DevStuff/felt-like-it
~/.claude/scripts/anti-pattern-scan.sh | head -30
```
Expected: Findings include `[fire-and-forget]` and `[catch-all]` entries.

---

### Task 4: Detector — untested-churn + todo-density

**Files:**
- Modify: `~/.claude/scripts/anti-pattern-scan.sh` (replace `detect_untested_churn` and `detect_todo_density` stubs)

- [ ] **Step 1: Implement detect_untested_churn**

Replace the stub with:

```bash
detect_untested_churn() {
  local files
  files=$(cat)  # consume stdin but this detector uses git log directly

  # Top 20 churn files (6 months)
  local churn
  churn=$(git log --since="6 months ago" --pretty=format: --name-only 2>/dev/null \
    | grep -vE "$EXCLUDES" | grep -E "$SOURCE_EXTS" \
    | grep -v '^$' | sort | uniq -c | sort -rn | head -20)

  # All test files
  local test_files
  test_files=$(git ls-files 2>/dev/null | grep -E '\.(test|spec)\.' || true)
  local test_dirs
  test_dirs=$(git ls-files 2>/dev/null | grep -E '__tests__/' || true)

  echo "$churn" | while read -r count filepath; do
    [[ -z "$filepath" ]] && continue
    # Extract base name without extension
    local base
    base=$(basename "$filepath" | sed 's/\.[^.]*$//')
    # Check if any test file references this base name
    local has_test=0
    echo "$test_files" "$test_dirs" | grep -q "$base" && has_test=1
    if [[ $has_test -eq 0 ]]; then
      detail="${count} commits (6mo), no test file"
      printf '{"file":"%s","line":0,"signal":"untested-churn","severity":2,"detail":"%s"}\n' "$filepath" "$detail"
    fi
  done
}
```

- [ ] **Step 2: Implement detect_todo_density**

Replace the stub with:

```bash
detect_todo_density() {
  local files
  files=$(cat)
  echo "$files" | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    local count
    count=$(grep -cE 'TODO|FIXME|HACK|XXX' "$f" 2>/dev/null || echo 0)
    if [[ $count -ge 3 ]]; then
      detail="${count} debt markers in single file"
      printf '{"file":"%s","line":0,"signal":"todo-density","severity":1,"detail":"%s"}\n' "$f" "$detail"
    fi
  done
}
```

- [ ] **Step 3: Clear cache and test**

Run:
```bash
rm -f /tmp/anti-pattern-cache/*
cd /mnt/Ghar/2TA/DevStuff/felt-like-it
~/.claude/scripts/anti-pattern-scan.sh | grep -E 'untested-churn|todo-density'
```
Expected: `[untested-churn]` entries for high-churn files without tests (MapEditor.svelte is top churn with 42 commits).

---

### Task 5: Project-Specific Detector Glob

**Files:**
- Modify: `~/.claude/scripts/anti-pattern-scan.sh` (already wired in skeleton — verify it works)

- [ ] **Step 1: Create a test project-specific detector**

```bash
mkdir -p /mnt/Ghar/2TA/DevStuff/felt-like-it/.claude/scripts
cat > /mnt/Ghar/2TA/DevStuff/felt-like-it/.claude/scripts/detect-test-ping.sh << 'DETECTOR'
#!/usr/bin/env bash
# Test detector — emits one finding per file to verify project-specific glob works
while IFS= read -r f; do
  printf '{"file":"%s","line":0,"signal":"test-ping","severity":0,"detail":"project detector works"}\n' "$f"
done
DETECTOR
chmod +x /mnt/Ghar/2TA/DevStuff/felt-like-it/.claude/scripts/detect-test-ping.sh
```

- [ ] **Step 2: Run scan and verify project detector fires**

Run:
```bash
rm -f /tmp/anti-pattern-cache/*
cd /mnt/Ghar/2TA/DevStuff/felt-like-it
echo "apps/web/src/app.html" | ~/.claude/scripts/anti-pattern-scan.sh | grep test-ping
```
Expected: `[test-ping] apps/web/src/app.html:0 -- project detector works`

- [ ] **Step 3: Remove test detector**

Run: `rm /mnt/Ghar/2TA/DevStuff/felt-like-it/.claude/scripts/detect-test-ping.sh`

---

### Task 6: Hook Script + Settings Wiring

**Files:**
- Create: `~/.claude/scripts/anti-pattern-hook.sh`
- Modify: `~/.claude/settings.json` (add hook entry)

- [ ] **Step 1: Create the hook script**

```bash
cat > ~/.claude/scripts/anti-pattern-hook.sh << 'HOOK'
#!/usr/bin/env bash
# PreToolUse hook — injects anti-pattern scan results when consumer skills are invoked
set -euo pipefail

INPUT=$(cat)
SKILL_NAME=$(echo "$INPUT" | jq -r '.tool_input.skill // empty' 2>/dev/null)

# Only fire for consumer skills
case "$SKILL_NAME" in
  brainstorming|systematic-debugging|characterization-testing|writing-plans) ;;
  *) exit 0 ;;
esac

# Must be in a git repo
git rev-parse --is-inside-work-tree &>/dev/null || exit 0

# Run scan (cached)
SCAN_OUTPUT=$(~/.claude/scripts/anti-pattern-scan.sh 2>/dev/null || true)
[[ -z "$SCAN_OUTPUT" ]] && exit 0

# Inject as additional context
jq -n --arg ctx "$SCAN_OUTPUT" '{
  "additionalContext": ("Risk signals from anti-pattern scan:\n" + $ctx)
}'
HOOK
chmod +x ~/.claude/scripts/anti-pattern-hook.sh
```

- [ ] **Step 2: Test hook script standalone**

Run:
```bash
cd /mnt/Ghar/2TA/DevStuff/felt-like-it
echo '{"tool_input":{"skill":"brainstorming"}}' | ~/.claude/scripts/anti-pattern-hook.sh | jq .
```
Expected: JSON with `additionalContext` field containing scan output.

- [ ] **Step 3: Test hook script ignores non-consumer skills**

Run:
```bash
echo '{"tool_input":{"skill":"handoff"}}' | ~/.claude/scripts/anti-pattern-hook.sh
```
Expected: No output (exit 0, no JSON).

- [ ] **Step 4: Add hook to settings.json**

Read `~/.claude/settings.json`, add this entry to the `hooks.PreToolUse` array:

```json
{
  "matcher": "Skill",
  "hooks": [
    {
      "type": "command",
      "command": "~/.claude/scripts/anti-pattern-hook.sh"
    }
  ]
}
```

- [ ] **Step 5: Verify hook appears in settings**

Run: `jq '.hooks.PreToolUse' ~/.claude/settings.json`
Expected: Array includes the anti-pattern-hook entry.

---

### Task 7: Integration Test Against Live Project

**Files:** None (read-only verification)

- [ ] **Step 1: Full scan of felt-like-it project**

Run:
```bash
rm -f /tmp/anti-pattern-cache/*
cd /mnt/Ghar/2TA/DevStuff/felt-like-it
~/.claude/scripts/anti-pattern-scan.sh
```
Expected: Both `=== FINDINGS ===` and `=== RISK SCORES ===` sections present. Multiple signals detected.

- [ ] **Step 2: Validate known issues detected**

Cross-reference output against STATE.md shadow walk findings:
- MapEditor.svelte should appear in RISK SCORES (high churn, catch blocks)
- geoprocessing.ts should show silent-catch (G2 from shadow walk)
- dashboard/+page.server.ts should show findings (D1 cluster)

- [ ] **Step 3: Verify cache hit**

Run: `time ~/.claude/scripts/anti-pattern-scan.sh`
Expected: Near-instant (< 0.1s) from cache.

- [ ] **Step 4: Verify cache invalidation on file change**

Run:
```bash
touch apps/web/src/app.html
time ~/.claude/scripts/anti-pattern-scan.sh
```
Expected: Full scan (cache miss due to dirty state change).

- [ ] **Step 5: Commit**

Stage and commit the two new/modified scripts:
```bash
git add ~/.claude/scripts/anti-pattern-scan.sh ~/.claude/scripts/anti-pattern-hook.sh
git commit -m "feat: extend anti-pattern-scan with risk signal detectors + skill hook"
```
