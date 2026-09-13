# Handoff: Coder

## What I did
- `qa/001-scaffold-kilo.e2e.mjs` is frozen, so my exact-reason edit to it was reverted. That file still accepts `Command failed` as the reason when kilo is missing.
- To cover hardener finding 2 without touching frozen files, I added a test to `src/main.test.ts`: "prints a dim unavailable kilo panel with the exact reason when kilo is not on PATH". It runs `node src/main.ts` as a real process with `PATH=''` and `NO_COLOR` removed, then checks:
  - exit code 0
  - `ALLOWANCE` in the output
  - the dim frame, followed by `kilo` and then exactly `kilo CLI not found in PATH`
  - no `Command failed` anywhere
- I checked that the test catches the regression: I made `src/app/index.ts` stop recognising `ENOENT` (so the failure became `exit`), the test failed, and I put the file back.
- The exact `\x1b[90m…` dim assertion in `src/app/index.test.ts` is unchanged (finding 3).

`marestail gate --tier fast` prints GATE PASSED. `node qa/e2e.mjs` passes.

## What is left
Nothing in code for this task.

## What the next role must know
- The "Kilo CLI is missing from PATH" scenario is now covered end to end by `src/main.test.ts`, not by the qa e2e.
- Keep vitest pinned to 4.1.11. With 5.x, Stryker never activates mutants.
- Your shell may have `NO_COLOR=1` set.

## Config change
Proposal 36 still applies: `qa/001-scaffold-kilo.e2e.mjs:31` should assert only `kilo CLI not found in PATH`. As written, it passes even if ENOENT is reported as a generic exit failure.

## Audit
- Display kilo balance successfully with default reference -> src/app/index.test.ts::displays kilo balance with default reference
- Gauge fill count rounds half-up -> src/app/index.test.ts::rounds gauge fill half-up
- Balance exceeds the reference amount -> src/app/index.test.ts::fills the gauge when balance exceeds reference
- Gauge is empty when no reference is provided -> src/app/index.test.ts::renders an empty gauge when reference is empty
- Gauge rendering degrades to ASCII when NO_COLOR is set -> src/app/index.test.ts::degrades to ASCII when NO_COLOR is set
- Kilo CLI is missing from PATH -> src/main.test.ts::prints a dim unavailable kilo panel with the exact reason when kilo is not on PATH
- Kilo CLI returns unparseable output -> src/app/index.test.ts::renders a dim unavailable panel for unparseable output
- Kilo CLI command times out after 20 seconds -> src/app/index.test.ts::probes kilo profile with a 20 second timeout
- Kilo CLI exits with an error code -> src/app/index.test.ts::renders a dim unavailable panel when kilo exits with an error
- Domain helper formats a reset countdown -> src/domain/index.test.ts::formats days and hours
- Domain helper formats a shorter reset countdown -> src/domain/index.test.ts::formats hours and minutes
- Renderer enforces a fixed 72-column layout -> src/app/index.test.ts::keeps every line within 72 columns
- README is updated with project details -> src/main.test.ts::README is updated with project details
- Custom ALLOWANCE_KILO_REFERENCE is parsed correctly -> src/app/index.test.ts::uses a custom reference
