#!/usr/bin/env bash
# .claude/hooks/session_local.sh
# Project-specific ambient context for felt-like-it
set -euo pipefail

TOP=$(git rev-parse --show-toplevel 2>/dev/null || exit 0)
MIGRATIONS_DIR="$TOP/apps/web/src/lib/server/db/migrations"

# Migration count + latest
if [ -d "$MIGRATIONS_DIR" ]; then
    MIG_COUNT=$(fd -e sql --type f . "$MIGRATIONS_DIR" 2>/dev/null | wc -l)
    LATEST=$(fd -e sql --type f . "$MIGRATIONS_DIR" 2>/dev/null | sort | tail -1 | xargs basename 2>/dev/null || echo "none")
    echo "**Migrations**: ${MIG_COUNT} files, latest: ${LATEST}"
fi

# TODO(loop) + TYPE_DEBT counts (subshell to isolate pipefail from rg exit 1 on no-match)
if command -v rg &>/dev/null; then
    TODO_COUNT=$(set +o pipefail; rg -c 'TODO\(loop\)' --type ts --glob '*.svelte' "$TOP" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
    DEBT_COUNT=$(set +o pipefail; rg -c 'TYPE_DEBT' --type ts --glob '*.svelte' "$TOP" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
    echo "**Debt markers**: TODO(loop): ${TODO_COUNT:-0}, TYPE_DEBT: ${DEBT_COUNT:-0}"
fi

# Strict tsconfig flags
TSCONFIG="$TOP/apps/web/tsconfig.json"
if [ -f "$TSCONFIG" ] && command -v jq &>/dev/null; then
    FLAGS=""
    for flag in exactOptionalPropertyTypes noUncheckedIndexedAccess verbatimModuleSyntax; do
        val=$(jq -r ".compilerOptions.${flag} // false" "$TSCONFIG" 2>/dev/null)
        if [ "$val" = "true" ]; then
            FLAGS="${FLAGS}${FLAGS:+, }${flag}"
        fi
    done
    [ -n "$FLAGS" ] && echo "**Strict tsconfig**: ${FLAGS}"
fi
