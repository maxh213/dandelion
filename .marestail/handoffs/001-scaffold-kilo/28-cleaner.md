# Handoff: Cleaner

## What I did
- `src/render/terminal.ts`: named constants (`WIDTH`, `GAUGE_CELLS`, ANSI codes); one `styled` helper behind bold and dim; one `gaugeCells` behind the filled and empty gauges; `balanceLine`/`balanceGauge`/`caption`/`renderPanel` split out; panels built with `join('\n')`; the hand-rolled loop is now `String.repeat`, still clamped so negative or NaN references render exactly as before.
- `src/probes/kilo.ts`: named timeout, default reference and balance regex; `parseBalance` returns `Balance | undefined`; `RegExp.exec` and `Number.parseFloat`.
- `src/app/wiring.ts`: `node:child_process`, one `toRunnerResult` with clear `exitCode`/`wasKilledByTimeout`.
- `src/domain/helpers.ts`: named ms constants, less noise.
- `src/main.ts`: `node:url`.
- Tests: the six kilo failure tests became one `it.each` with the same cases and assertions; `toHaveLength` in the renderer tests.
- Cleared all 9 Sonar findings. `marestail gate --tier sonar` prints GATE PASSED; `node qa/e2e.mjs` passes.

## What is left
Nothing for this task.

## What the next role must know
- Behaviour is unchanged. Exported renderer names stayed the same because tests import them.
- Your shell may have `NO_COLOR=1` set; unset it to see the coloured dashboard.
- The QA e2e fixture still uses `echo` with `\n`. I left `qa/` alone because it belongs to the QA procedure.

## Config change
`marestail gate --hook` (scope changed) fails `ts.deps` on a clean tree: `scoped_findings` in `marestail/gates/ts_deps.py` reports depcruise's `✔ no dependency violations found` and npm notices as findings. `npx depcruise --config .dependency-cruiser.cjs --output-type err src` exits 0, and `--tier sonar` (scope all) passes `ts.deps`. It should return no findings when depcruise exits 0 or prints no `VIOLATION` lines.

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
