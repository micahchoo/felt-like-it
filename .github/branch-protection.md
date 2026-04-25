# Branch Protection Setup

The CI pipeline enforces quality checks, but GitHub itself must be configured
to block merges when those checks fail. This is a one-time setup per
protected branch.

## Required status checks

Configure `main` (and `master`) with the following required checks, all
defined in `.github/workflows/ci.yml`:

- `format` — prettier `--check` across all tracked files
- `lint` — eslint across the monorepo
- `test` — `turbo test` (vitest for each package with a `test` script)

These three jobs must pass before a PR can merge. `publish` runs only on
pushes to the protected branch and depends on all three.

## Advisory (non-blocking) checks

- `typecheck` — `svelte-check` + `tsc` via `turbo check`. Currently advisory
  (`continue-on-error: true`) because the codebase carries a backlog of
  pre-existing type errors. Promote to required once the backlog is clean.

## Steps in the GitHub UI

1. Settings → Branches → Add rule for `main`.
2. Enable **Require status checks to pass before merging**.
3. Enable **Require branches to be up to date before merging**.
4. Under **Status checks**, add: `format`, `lint`, `test`.
5. (Optional) Enable **Require linear history** and **Include administrators**.
6. Repeat for `master` if used.

## Verification

After enabling protection, open a PR with a deliberate failure (e.g. a
syntax error) and confirm the merge button is disabled until the failing
job is fixed.
