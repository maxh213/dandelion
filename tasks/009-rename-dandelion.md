# 009 — rename the project to dandelion

This is a rename refactor: no behaviour changes except user-visible names. Everything the rename does not touch is frozen. After this task the project, its command, and its dashboard are called **dandelion**.

Context for the worker: the human has already renamed the repo directory and updated the two human-frozen config files (`marestail.toml` `[sonar] project_key/project_name = "dandelion"`, `sonar-project.properties`). Everything below that is not in those two files is yours.

## What changes

- `package.json`: `"name"` becomes `dandelion`; add `"bin": { "dandelion": "src/main.ts" }` and a `#!/usr/bin/env node` shebang on `src/main.ts` (type stripping still applies; `node src/main.ts` must keep working exactly as before).
- Banner wordmark: `ALLOWANCE` becomes `DANDELION` (same one-line banner, same layout rules).
- Every environment variable is renamed `ALLOWANCE_*` → `DANDELION_*` with no backwards-compatible aliases: `DANDELION_KILO_REFERENCE`, `DANDELION_KIMI_PORT`, `DANDELION_GROK_HOME`, `DANDELION_CURSOR_AUTH_FILE`, `DANDELION_CURSOR_API_BASE`, `DANDELION_REFRESH_SECONDS`, `DANDELION_CLAUDE_WORK_CONFIG_DIR`. The README env ledger is updated to match.
- `README.md`: project name, title, and every command example use dandelion.
- All tests, fixtures, and e2e assertions that pin `ALLOWANCE`, the old env names, or the old package name are updated; nothing else about them changes.

## What must not change

- Probe recipes, parsing, window math, gauge rendering (beyond the wordmark), panel order, live mode, exit codes, the layer architecture, and every provider behaviour from tasks 001–008.
- `marestail.toml`, `sonar-project.properties`, `guidance/`, `features/` (scenario *behaviour* stays; the specifier may adjust names inside scenarios to match).

## QA procedure

Run the full e2e suite with the full fixture set: every assertion passes with `DANDELION` in the banner and the `DANDELION_*` env names; grep the rendered output for `ALLOWANCE` and assert zero matches; `node src/main.ts --once` still exits 0 with all providers rendering.
