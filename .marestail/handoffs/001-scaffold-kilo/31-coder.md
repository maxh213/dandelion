# Handoff: Coder

## What I did
Fixed all four practices findings:
- TS-24: `ProviderUsage` (src/domain/index.ts) is now a discriminated union on `status`: `ok` carries optional `balance`, `unavailable | error` carry a required `reason`. `renderPanel` (src/render/terminal.ts) switches over `status` with an `assertNever` default. The `'Unknown error'` fallback is gone.
- TS-20: `CommandRunnerResult` now carries a typed `failure?: 'missing' | 'timeout' | 'exit'` (`RunFailure`) instead of `code`/`timedOut`/`error`. `src/app/index.ts` sets it from `ExecException.code === 'ENOENT'` and the timeout kill. `runFailureReason` in kilo switches on it with an `assertNever` default. Nothing matches on `e.message` any more.
- TS-10: `RealCommandRunner` class is now the `realCommandRunner` object. Test mock classes (`StubRunner`, `MockRunner`) are now object literals or small factory functions.
- TS-7: `CommandRunnerResult` is a `type`. `CommandRunner` is still an `interface`.
- Tests: unknown status and unknown failure kind both throw, and the real runner reports missing, timeout and exit.

`marestail gate --tier fast` prints GATE PASSED. `node qa/e2e.mjs` passes.

## What is left
Nothing for this task.

## What the next role must know
- A probe signals run problems only through `failure`. Add a new kind to `RunFailure` and the compiler flags every switch that needs updating.
- Your shell may have `NO_COLOR=1` set. Unset it to see the coloured dashboard.

## Config change
The Stop hook `marestail gate --hook` (scope changed) reports a false `ts.deps` failure on a clean tree. The only "findings" are depcruise's `✔ no dependency violations found` and the npm notices. `npx depcruise --config .dependency-cruiser.cjs --output-type err src` exits 0, and `--tier fast` (scope all) passes `ts.deps`. `marestail/gates/ts_deps.py::scoped_findings` should return `[]` when no line matches `VIOLATION` or depcruise exits 0.

## Audit
- Display kilo balance successfully with default reference -> src/app/index.test.ts::displays kilo balance with default reference
- Gauge fill count rounds half-up -> src/app/index.test.ts::rounds gauge fill half-up
- Balance exceeds the reference amount -> src/app/index.test.ts::fills the gauge when balance exceeds reference
- Gauge is empty when no reference is provided -> src/app/index.test.ts::renders an empty gauge when reference is empty
- Gauge rendering degrades to ASCII when NO_COLOR is set -> src/app/index.test.ts::degrades to ASCII when NO_COLOR is set
- Kilo CLI is missing from PATH -> src/app/index.test.ts::renders a dim unavailable panel when kilo is missing
- Kilo CLI returns unparseable output -> src/app/index.test.ts::renders a dim unavailable panel for unparseable output
- Kilo CLI command times out after 20 seconds -> src/app/index.test.ts::probes kilo profile with a 20 second timeout
- Kilo CLI exits with an error code -> src/app/index.test.ts::renders a dim unavailable panel when kilo exits with an error
- Domain helper formats a reset countdown -> src/domain/index.test.ts::formats days and hours
- Domain helper formats a shorter reset countdown -> src/domain/index.test.ts::formats hours and minutes
- Renderer enforces a fixed 72-column layout -> src/app/index.test.ts::keeps every line within 72 columns
- README is updated with project details -> src/main.test.ts::README is updated with project details
- Custom ALLOWANCE_KILO_REFERENCE is parsed correctly -> src/app/index.test.ts::uses a custom reference
