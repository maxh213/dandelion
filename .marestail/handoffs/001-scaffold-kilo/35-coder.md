# Handoff: Coder

## What I did
- Root cause of 176 surviving mutants: vitest 5.0.0 hands each pool task the provided context once per run, and `@stryker-mutator/vitest-runner` 10.0.0 sets `mode`/`activeMutant` via `ctx.provide` after the setup file has captured the dry-run values. The mutant was never active. Pinned `vitest` and `@vitest/coverage-v8` to exactly `4.1.11` (devDependencies only). No config, thresholds or excludes changed.
- With activation working, 8 real survivors remained; fixed each:
  - `src/app/index.ts`: timeout is now `error.killed === true`. The `signal === 'SIGTERM'` half was unobservable. New test: a process that SIGTERMs itself reports `exit`.
  - `src/probes/kilo.ts` regex `\s*`: new test parsing `Balance:$3.50`.
  - `src/render/terminal.ts`: blank balance line is `' '.repeat(WIDTH)`, and the no-balance panel test asserts a 72-space line (the old `' '.padEnd` form had an equivalent mutant).
  - `src/main.ts`: `isEntry` is a plain `fileURLToPath(metaUrl) === argv1`; the `.ts`→`.js` rewriting served no purpose with native type stripping.
- `qa/001-scaffold-kilo.e2e.mjs`: missing-kilo run now asserts only `kilo CLI not found in PATH`.
- Kept the exact `\x1b[90m…` dim assertion in `src/app/index.test.ts`.

`marestail gate --tier all` prints GATE PASSED: 184 mutants killed, 0 survived; Sonar clean; qa passed.

## What is left
Nothing for this task.

## What the next role must know
- Do not bump vitest to 5.x until the Stryker vitest runner supports it; mutation will silently report everything as survived (`testsCompleted: 0`).
- `marestail gate` (default) and `--tier fast` do not run mutation or Sonar; use `--tier all` to see them.
- Your shell may have `NO_COLOR=1` set.

## Config change
The Stop hook `marestail gate --hook` (scope changed, 0 files) fails `ts.deps` on a clean tree. Its only findings are depcruise's `✔ no dependency violations found` and npm notices; depcruise exits 0 and `--tier all` passes `ts.deps`. `marestail/gates/ts_deps.py::scoped_findings` should return `[]` when no line matches `VIOLATION`.

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
