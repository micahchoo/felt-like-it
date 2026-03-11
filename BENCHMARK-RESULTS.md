# CLI Tool Benchmark Results

Tested on the `felt-like-it` codebase (~250 files, ~40K lines, SvelteKit/TypeScript monorepo).
Benchmarks run with `hyperfine` (10+ runs each, 3 warmup runs).

## Executive Summary

| Verdict | Tools |
|---------|-------|
| **CLEAR WIN** — measurable speed or output advantage | `readtags`, `fd` (deep search), `jq`, `tokei`/`scc`, `rg -l`/`-c` (output modes) |
| **MARGINAL** — small advantage, not worth switching for | `rg` (vs grep), `choose` (vs cut/awk), `dust` (vs du) |
| **NO ADVANTAGE / WORSE** | `bat` (vs cat), `eza` (vs ls), `procs` (vs ps), `delta` (output is *larger*), `duf` (vs df) |
| **CLAUDE CODE NATIVE WINS** | Glob, Grep, Read — all better than any bash tool for Claude Code usage |

---

## Category 1: Content Search — `rg` vs `grep` vs Claude Code Grep

### Speed (hyperfine)

| Test | grep | rg | Winner | Speedup |
|------|------|----|--------|---------|
| File list (`-l "import"`) | **10.2ms** | 13.8ms | grep | 1.36x |
| Count (`-c "function"`) | 12.8ms | **10.3ms** | rg | 1.24x |
| Regex + type filter | 10.4ms | **10.1ms** | rg | ~1x (tie) |
| Complex regex (Perl) | 19.5ms | **13.9ms** | rg | 1.41x |

**Verdict:** rg is **marginally faster** on complex regex (1.4x) but effectively tied for simple searches on a project this size. The speed claim is **overstated for small/medium codebases**.

### Output Size (the real win for Claude Code)

| Mode | Output bytes |
|------|-------------|
| `grep -rn 'import'` (full content) | 91,965 |
| `rg -n 'import'` (full content) | 91,965 |
| `rg -l 'import'` (filenames only) | **6,593** (93% reduction) |
| `rg -c 'import'` (counts only) | **6,904** (92% reduction) |

**Key insight:** The token savings come from **output mode flags** (`-l`, `-c`), not from rg itself. Claude Code's native `Grep` tool has these modes built in (`files_with_matches`, `count`).

### Claude Code Native Comparison

Claude Code's **Grep tool uses rg internally** — so calling rg via Bash provides zero speed advantage. The native tool adds:
- Built-in `output_mode` parameter (files_with_matches, count, content)
- Automatic `head_limit` to cap output
- Type filtering via `type` parameter
- No need to worry about PATH or flags

**Winner: Claude Code Grep** — identical search engine, better interface for token management.

---

## Category 2: File Finding — `fd` vs `find` vs Claude Code Glob

### Speed

| Test | find | fd | Winner | Speedup |
|------|------|----|--------|---------|
| All .ts files (full repo) | 1,141ms | **8.6ms** | fd | **133x** |
| All directories | 991ms | **8.4ms** | fd | **118x** |
| find+exec (wc -l) | **10.2ms** | 19.7ms | find | 1.9x |
| Depth-limited | 12.7ms | 13.6ms | tie | ~1x |

**Critical detail:** fd's massive speedup (133x) comes from `.gitignore` awareness — `find` crawls `node_modules/`, `.svelte-kit/`, etc. When find uses `-not -path` exclusions, it still stats every inode. fd skips them entirely.

However: `find -exec ... +` is still faster than `fd -x` for small result sets because fd spawns parallel processes.

### Output Size

| Command | Bytes |
|---------|-------|
| `find . -name "*.ts"` (with exclusions) | 9,461 |
| `fd -e ts` | **6,393** (32% less — shorter paths, no `./` prefix) |
| `find . -type d` (with exclusions) | 17,171 |
| `fd --type d` | **2,224** (87% less) |

### Claude Code Native Comparison

Claude Code's **Glob tool** handles file finding natively. It:
- Respects `.gitignore` (like fd)
- Returns sorted results
- Has no shell overhead
- Truncates results automatically when too large

**Winner: Claude Code Glob** for Claude Code usage. `fd` only wins when you need `-exec` (running commands on found files) — which is a Bash-specific workflow.

---

## Category 3: File Reading — `bat` vs `cat` vs Claude Code Read

### Speed

| Test | cat/head | bat | Winner | Speedup |
|------|----------|-----|--------|---------|
| Full file read | **0.69ms** | 4.7ms | cat | **6.8x** |
| Range (1-50 lines) | **0.55ms** | 3.9ms | head | **7.2x** |

### Output Size

| Command | Bytes |
|---------|-------|
| `cat router.ts` | 1,050 |
| `bat -p router.ts` | 1,050 |
| `bat -r 1:50` | 1,050 |
| `head -n 50` | 1,050 |

Same file, same output. bat adds **nothing** in plain mode (`-p`). The syntax highlighting only helps humans at a terminal.

**Winner: Claude Code Read** — native tool with built-in `offset`/`limit` parameters, no shell overhead, automatic truncation for long files. bat is strictly worse for Claude Code.

---

## Category 4: Symbol Lookup — `readtags` vs `rg` vs Claude Code Grep

### Speed

| Test | rg | readtags | Winner | Speedup |
|------|-----|----------|--------|---------|
| Function definition | 9.6ms | **0.65ms** | readtags | **14.9x** |

### Output Size

| Command | Bytes |
|---------|-------|
| `rg -n "function requireMapAccess"` | 81 |
| `readtags -en -t tags "requireMapAccess"` | 168 |

readtags returns more metadata (file, line, kind, signature) — **more bytes but more useful**. A single readtags call replaces what would normally be rg + Read.

**Verdict: readtags is a CLEAR WIN** for symbol lookups. 15x faster, O(1) index lookup vs linear scan. Requires maintaining a `tags` file, but that's a one-time cost (~20ms to rebuild for this project).

---

## Category 5: Code Statistics — `tokei` vs `scc`

### Speed

| Tool | Time |
|------|------|
| tokei --compact | 19.9ms |
| scc --no-cocomo | **19.6ms** |

Effectively identical.

### Output Size

| Command | Bytes |
|---------|-------|
| tokei --compact | **1,948** |
| scc --no-cocomo | 2,358 |
| tokei -s code | 3,084 |

**Verdict:** Both are fine. tokei produces slightly more compact output. Both replace `wc -l` + `find` pipelines and are language-aware (comments vs code vs blanks).

---

## Category 6: Directory Listing — `eza` vs `ls`

### Speed

| Test | ls | eza | Winner | Speedup |
|------|-----|-----|--------|---------|
| Long listing | **1.6ms** | 42.5ms | ls | **27x** |
| Tree view | **1.7ms** | 44.3ms | find+sort | **26x** |

### Output Size

| Command | Bytes |
|---------|-------|
| `ls -la` | 338 |
| `eza -l --no-user --no-time` | **102** (70% less) |

**Verdict:** eza produces dramatically **smaller output** (good for tokens) but is **27x slower**. The output savings matter for Claude Code, but the speed cost is real. For small directories, the ~40ms eza overhead is negligible. For recursive listings, prefer `fd`.

---

## Category 7: Disk Usage — `dust` vs `du`, `duf` vs `df`

### Speed

| Test | Standard | Modern | Winner |
|------|----------|--------|--------|
| du -sh * vs dust | **2.64s** | 2.90s | du | 1.1x |

### Output Size

| Command | Bytes |
|---------|-------|
| du -sh * | **279** |
| dust -d 1 -n 10 | 3,202 (11x larger!) |
| df -h | **831** |
| duf --only local | 1,972 (2.4x larger) |

**Verdict:** dust and duf produce **larger** output with visual ASCII art. **Worse for Claude Code tokens**. du/df are smaller and faster.

---

## Category 8: Process Listing — `procs` vs `ps`

### Speed

| Test | ps | procs | Winner | Speedup |
|------|-----|-------|--------|---------|
| Full list | **18.2ms** | 132ms | ps | **7.3x** |
| Filtered (node) | **18.5ms** | 131ms | ps | **7.1x** |

### Output Size

| Command | Bytes |
|---------|-------|
| ps aux | 67,755 |
| procs | 64,334 |
| ps aux \| grep node | 914 |
| procs node | 914 |

**Verdict:** procs is **7x slower** with comparable output size. No advantage for Claude Code.

---

## Category 9: JSON Processing — `jq` vs `python3`

### Speed

| Test | python3 | jq | Winner | Speedup |
|------|---------|-----|--------|---------|
| Extract field | 18.9ms | **2.0ms** | jq | **9.4x** |

### Output Size (gron)

| Command | Bytes |
|---------|-------|
| `jq . package.json` | 2,386 |
| `gron package.json` | 3,426 (greppable lines) |

**Verdict:** jq is a **CLEAR WIN** over python for JSON extraction — 9.4x faster. gron is useful for exploration (greppable JSON paths) but produces 43% more output.

---

## Category 10: Text Processing — `choose` vs `cut`/`awk`

### Speed

| Tool | Time |
|------|------|
| cut | **3.5ms** |
| choose | 3.6ms |
| awk | 3.8ms |

All effectively identical. **No measurable advantage** for `choose`.

---

## Category 11: Git Diff — `delta` vs plain

### Output Size

| Command | Bytes |
|---------|-------|
| `git diff` (plain) | 658 |
| `git diff \| delta` | 2,411 (**3.7x larger**) |
| `git log -5 --patch` | 54,795 |
| `git log -5 \| delta` | 165,038 (**3x larger**) |

**Verdict:** delta is **actively harmful for Claude Code** — adds ANSI color codes and formatting that triple the output size. Only useful for human terminal viewing.

---

## Category 12: ast-grep — Not Tested

The `sg` binary on this system is `setgid(1)`, not ast-grep. Installing ast-grep requires rustc 1.79+ (system has 1.75). **Cannot benchmark.**

Theoretical advantage: AST-aware matching (zero false positives on structural patterns). Worth installing via a Rust toolchain update.

---

## Final Rankings for Claude Code Usage

### Tier 1: Install These (clear, measurable advantage)
| Tool | Why | Over |
|------|-----|------|
| **readtags** (+ ctags) | 15x faster symbol lookup | rg for definitions |
| **jq** | 9.4x faster JSON extraction | python3 one-liners |
| **fd** | 133x faster file finding (gitignore-aware) | find |
| **tokei** or **scc** | Language-aware LOC in one command | wc -l pipelines |
| **hyperfine** | Statistical benchmarking | time |

### Tier 2: Use These Output Modes (no new tool needed)
| Technique | Token Savings |
|-----------|--------------|
| `rg -l` (filenames only) | **93%** vs full content |
| `rg -c` (counts only) | **92%** vs full content |
| Claude Code Grep `output_mode: "count"` | Same as rg -c, native |
| Claude Code Grep `head_limit` | Caps output automatically |

### Tier 3: Use Claude Code Native Tools Instead
| Claude Tool | Replaces | Why |
|-------------|----------|-----|
| **Grep** | rg in Bash | Same engine (rg), better output modes |
| **Glob** | fd / find | Gitignore-aware, auto-truncation |
| **Read** | cat / bat / head | offset/limit params, auto-truncation |

### Tier 4: Skip These (no advantage or worse)
| Tool | Problem |
|------|---------|
| bat | 7x slower than cat, identical output in plain mode |
| eza | 27x slower than ls (terser output not worth it) |
| delta | 3x MORE output (ANSI codes) — actively harmful |
| dust | 11x more output, slower than du |
| duf | 2.4x more output than df |
| procs | 7x slower than ps, same output size |
| choose | Same speed as cut/awk |
| gron | 43% more output than jq (useful for exploration only) |
| fastmod | Can't benchmark safely (does actual file modification) |

---

## Key Takeaway

**The biggest token savings don't come from installing new tools — they come from using the right output modes.** `rg -l` instead of `rg -n`, Claude Code Grep with `count` mode, and Claude Code Read with `limit` parameter together save 90%+ of wasted context tokens.

The only tools worth adding to a Claude Code workflow beyond what's already built in:
1. **readtags** — for instant symbol lookups (already in CLAUDE.md)
2. **jq** — for JSON extraction (already available)
3. **tokei** — for code stats (already in CLAUDE.md)
