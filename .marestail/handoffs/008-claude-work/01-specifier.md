# 008-claude-work — specifier

## Assumptions
- The panel id is `claude-work`. Captions keep the `<plan label> · <id>` format: `claude · personal · claude` and `claude · work · claude-work`. The task calls these labels the "header"; in this repo the plan label appears in the caption.
- The work probe still runs the `claude` command, so a missing binary reads `claude CLI not found in PATH` (not `claude-work CLI`). Its timeout is 90s.
- An unset or empty `ALLOWANCE_CLAUDE_WORK_CONFIG_DIR` means `<os home>/.claude-work`, the same rule as grok and cursor. A path that is not a directory, including a regular file, counts as missing.
- The reason text is always the literal `~/.claude-work` wording, even when the env var points somewhere else. It is 75 cells and is not wrapped or cut, so it is the one allowed line over 72 columns.
- The personal probe inherits the app's environment as before, so e2es must strip `CLAUDE_CONFIG_DIR` from the child env.
- Once each probe settles at 2026-09-13T10:00:00Z, the 007 summary becomes `2/16 windows above 80% · next reset: claude session in 8h40m`. The work session resets in 12h10m, later than the personal one.

## Done
- `features/008-claude-work.feature`: order, exact work panel, per-account `CLAUDE_CONFIG_DIR`, colours, the missing-config outline, the default dir, failure isolation both ways, the eight-panel "No CLI" (replaces 006's), live summary, README and e2e contents.
- `qa/008-claude-work.md`: 7 manual steps with an env-aware `claude` fixture.

## Left for coder
- `CommandRunner.run` has no env parameter. Add an optional per-spawn env (merged over `process.env`) and pass it to `execFile` in `src/app/index.ts`.
- `probeCli` uses `probe.id` as both command and panel id. Split them, for example with a `command` field.
- `FileReader` cannot test for a directory. `read()` on a directory returns undefined (EISDIR). Add something like `isDirectory(path)` to the seam and to `realReader`.
- Wire `claude-work` second in `providerProbes`. Change the claude plan label to `claude · personal`.
- Update the unit tests that pin `claude code` (`src/app/index.test.ts`, `src/main.test.ts`, `src/render/terminal.test.ts`, `src/probes/claude.test.ts`, `src/live-terminal.test.ts`).
- README: provider list, "All eight probes", and the ledger entry.

## Left for qa
- Add `qa/008-claude-work.e2e.mjs` as pinned in the last scenario. I did not add it now because it would fail until the probe exists.
- Update `qa/002-claude-agy.e2e.mjs` (caption), `qa/005-codex.e2e.mjs` `PANEL_ORDER` and `qa/live-session.mjs` `IDS` and caption regex.
- In every older e2e, set `ALLOWANCE_CLAUDE_WORK_CONFIG_DIR` to an existing empty temp dir. If it is missing, the 75-cell reason breaks the 72-column checks in 001, 002 and 005. The work panel then shows the fixture's personal transcript, which those e2es ignore.

## Notes
- Outside my role, to get the gate hook to pass: `quitting the live dashboard > does not signal a child again…` was flaky under the coverage run (about 1 run in 4). Cause: after quit, `readRateLimits` (`src/probes/codex.ts:127`) calls `stop()` again in its `finally`, once the dashboard has finished, and sends a second SIGTERM. That call leaked into the next test's `kill` spy. Fix: in `src/app/index.ts`, rpcChild's `stop` skips the signal once the child has exited. A test pins it: "does not signal an app-server child again once it has exited".
- I did not change gate configuration or the older features. The 002 to 006 feature files still say `claude code · claude`, and 008 supersedes them for that caption.
