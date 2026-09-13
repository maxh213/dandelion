# Handoff: Coder

## What I did
- Investigated the bounce. 26-coder did not edit `marestail.toml`; its commit `defdd18` touches only `src/` and its handoff. The runner's revert `ff9c5d7` undid the human commit `91af28f` ("switch pipeline backend to claude opus-5"), setting `[agent]` back to `agy` / `gemini-3.1-pro-high`.
- Left `marestail.toml` untouched as reverted, per the frozen rule.
- Confirmed no code changes are needed: `marestail gate --tier fast` prints GATE PASSED (43 tests, 0 uncovered, 0 above CRAP 4, lint/deps/comments/deadcode/docs clean), and the working tree stays clean after the gate.
- Checked that every audited test name below exists in `src/`.

## What is left
Nothing for this task in code.

## What the next role must know
- The runner's frozen-file check seems to diff against a base that predates the human's `marestail.toml` commit, so a human edit gets blamed on whichever agent runs next.
- Your shell may have `NO_COLOR=1` set; unset it to see the coloured/Unicode dashboard.
- The qa e2e fixture uses `echo` with `\n`; `printf` would be more portable when the cleaner touches qa.

## Config change
The revert `ff9c5d7` rolled back the human's intentional backend switch (`91af28f`: agy -> claude / claude-opus-5). A human should re-apply it if still wanted, and look at why the frozen-file check blames human commits on the coder (it probably compares against a base older than `91af28f`).

`marestail gate --hook` (and any `--scope changed`) always fails `ts.deps` on a clean repo. In `marestail/gates/ts_deps.py::scoped_findings`, when no line matches `VIOLATION` it returns every output line as a finding, including depcruise's `✔ no dependency violations found`. It should return `[]` when depcruise exits 0 or no violation lines exist. `marestail gate --tier fast` (scope all) passes `ts.deps`, and depcruise exits 0 with no violations.

## Audit
- Display kilo balance successfully with default reference -> src/app/wiring.test.ts::displays kilo balance with default reference
- Gauge fill count rounds half-up -> src/app/wiring.test.ts::rounds gauge fill half-up
- Balance exceeds the reference amount -> src/app/wiring.test.ts::fills the gauge when balance exceeds reference
- Gauge is empty when no reference is provided -> src/app/wiring.test.ts::renders an empty gauge when reference is empty
- Gauge rendering degrades to ASCII when NO_COLOR is set -> src/app/wiring.test.ts::degrades to ASCII when NO_COLOR is set
- Kilo CLI is missing from PATH -> src/app/wiring.test.ts::renders a dim unavailable panel when kilo is missing
- Kilo CLI returns unparseable output -> src/app/wiring.test.ts::renders a dim unavailable panel for unparseable output
- Kilo CLI command times out after 20 seconds -> src/app/wiring.test.ts::probes kilo profile with a 20 second timeout
- Kilo CLI exits with an error code -> src/app/wiring.test.ts::renders a dim unavailable panel when kilo exits with an error
- Domain helper formats a reset countdown -> src/domain/helpers.test.ts::formats days and hours
- Domain helper formats a shorter reset countdown -> src/domain/helpers.test.ts::formats hours and minutes
- Renderer enforces a fixed 72-column layout -> src/app/wiring.test.ts::keeps every line within 72 columns
- README is updated with project details -> src/main.test.ts::README is updated with project details
- Custom ALLOWANCE_KILO_REFERENCE is parsed correctly -> src/app/wiring.test.ts::uses a custom reference
