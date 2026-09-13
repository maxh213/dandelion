# 005 codex — cleaner

## Done
- `isRecord`, `fieldOf` and `isCount` were copied in kimi, grok and codex. Now they live once in `src/domain/index.ts` and all three probes import them. The dependency rules allow probes to import domain, and `ts.deps` still passes.
- `src/probes/codex.ts`:
  - `loginMode` checks for a run failure before it joins stdout and stderr.
  - `resetInstant` returns early for non-numbers. Before, it built a NaN date and mutated it.
- Behaviour, tests and test names are unchanged. No test was touched.

## Checks
- `marestail gate --tier sonar`: GATE PASSED. 339 tests, 154 functions (160 before), 0 above CRAP 4, sonar clean. The baseline before cleaning also passed.

## Left / next role must know
- Still open for the QA role, from 06-coder.md:
  - write `qa/005-codex.e2e.mjs`;
  - add a `codex` fixture to `qa/001-scaffold-kilo.e2e.mjs`, which fails today on the "not found" assertion;
  - move the 001–004 e2es to a PATH holding only `node` and `sh` symlinks.
- Test fixtures for the codex limits (`HAPPY_LIMITS`/`CODEX_LIMITS`, answer lines) are similar in `src/probes/codex.test.ts` and `src/app/index.test.ts`. They were left as they are, because the tests are the safety net and Sonar does not flag them.
- In `src/main.test.ts`, the stub spawner appears in both `vi.mock` and `profileIo`. `vi.mock` is hoisted, so the two cannot share a constant without `vi.hoisted`. Left as is.

## Config change
- None.

## Audit
- ChatGPT mode renders both rate-limit windows between grok and kilo -> src/app/index.test.ts::renders both ChatGPT rate-limit windows between grok and kilo
- ChatGPT mode colours -> src/app/index.test.ts::colours the 5h window calm, the weekly window hot and the caption dim
- API-key mode is a normal ok panel with no windows -> src/app/index.test.ts::renders the API-key caption instead of rows without starting app-server
- Rate-limit window variations -> src/app/index.test.ts::renders rate limits %j as the single row "%s"
- A rate-limits notification before the answer is not used -> src/app/index.test.ts::ignores a non-JSON line and a rate-limits notification before the answer
- Codex failures render a dim panel, keep the others, and reap the child -> src/probes/codex.test.ts::is an error and stops the child on %s
- An app-server that ignores SIGTERM is killed after 5 seconds -> src/app/index.test.ts::kills an app-server child that ignores SIGTERM after 5 seconds
- The API-key line on stdout is recognised too -> src/probes/codex.test.ts::is an ok API-key panel with a note and no app-server when the key line is on %s
- No CLI on the PATH at all -> src/main.test.ts::prints six dim unavailable panels in order when no CLI is on PATH and grok home is empty
- README documents codex -> src/main.test.ts::README documents codex
- Earlier end-to-end checks keep passing -> src/main.test.ts::runs with only fixtures, node and sh on PATH and no runtime dependencies
