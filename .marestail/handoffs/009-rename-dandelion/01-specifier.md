# 009 rename-dandelion — specifier

## Assumptions
- Case-sensitive "ALLOWANCE" and "Allowance" disappear from src, qa, perf, README and package files. The ordinary word "allowances" in the README intro stays.
- Internal names change too: the temp dir prefixes `allowance-kimi-` and `allowance-qa-00N-` become `dandelion-…`, the package-lock name changes, and so does the codex `clientInfo.name`. None of these changes behaviour.
- `perf/bench_*` set ALLOWANCE_* envs, so they are renamed. Without that, the benches would silently test the defaults.
- The old names are ignored with no alias and no warning. The 001–008 features and QA docs keep the old names, and 009 overrides them through its rename table (the runner reverts edits to old spec files).
- The README gains a `dandelion` run command (via `npm link`). No new doc files.

## What I did
- `features/009-rename-dandelion.feature`: banner (once and live), `node src/main.ts`, the `dandelion` bin through a symlink, every env var under its new name, old names ignored, README, and e2e expectations.
- `qa/009-rename-dandelion.md`: a 9-step manual procedure.

## What the coder must know
- **Trap:** `isEntry` in `src/main.ts` compares `fileURLToPath(import.meta.url)` with `process.argv[1]`. Through a symlink (which is what `npm link` or a global install creates), argv[1] is the link path while import.meta.url is the real path. I checked this on node v26.7.0. So `dandelion --once` currently prints nothing and exits 0. Compare real paths (e.g. `realpathSync(argv1)`) and cover it in main.test.ts at 100%/CRAP≤4.
- `src/main.ts` needs `#!/usr/bin/env node` as line 1 and git mode 100755 (`git update-index --chmod=+x`). The gate bans comments, but a shebang is not a comment for ESLint. If Sonar or the comment check still flags it, report that instead of weakening the gate.
- The wordmark keeps its length (9 cells), so the banner layout math is unchanged.
- The user-visible kimi reason becomes `DANDELION_KIMI_PORT must be an integer from 1 to 65535`.
- Update `qa/live-session.mjs` (env and prefix) and every 001–008 e2e, then add `qa/009-rename-dandelion.e2e.mjs`.
- Unit tests in src/**/*.test.ts pin the old names in about 100 places. Rename them without changing their logic.

## What is left
- All of the implementation. I wrote no production code.
- `.marestail/handoffs/008-claude-work/01-specifier.md` showed as deleted in the working tree before I started. I did not cause that and did not commit it.

## Config change
None needed.
