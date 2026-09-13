# Handoff: Architect

## What I did
Each layer is now one module with one entry point, `src/<layer>/index.ts`. Files behind it are private.
- `domain/index.ts`: `types.ts` and `helpers.ts` merged. Both hold the usage model (the shapes plus the countdown rule), and the old split only added an import path.
- `probes/index.ts`: exports `probeProviders(runner, now, env)` and the `CommandRunner` port types. The port moved from `kilo.ts` to `probes/runner.ts` because every subprocess probe shares it (tasks 002–006), so it is not kilo's. `kilo.ts` is now private. App used to call `probeKilo` and wrap it in `[kiloUsage]`, so it knew which providers exist. That knowledge now lives inside probes, and new providers change only `probes/`.
- `render/index.ts`: exports only `renderDashboard`. Banner, rule, gauge and panel helpers stay in `terminal.ts` for its colocated tests and are off the interface.
- `app/index.ts` (was `wiring.ts`): `runApp`, `RealCommandRunner` (the only process IO), and a re-export of `CommandRunner`. `main.ts` now uses that type instead of `Parameters<typeof runApp>[0]`, and `main.test.ts` no longer reaches into `probes/kilo.ts`.
- IO stays at the edges: child_process only in app, and process/stdout/clock only in `main.ts`. Domain, probes and render are pure.

## Contracts (`.dependency-cruiser.cjs`, stricter only)
- `module-entry-only`: a file in one layer may import another layer only through its `index.ts`.
- `entry-reaches-modules-through-index`: the same rule for top-level files (`main.ts`).
- `includeOnly` now also covers Node built-ins, so domain/probes/render importing `fs`, `child_process`, etc. fails the existing layer rules. Before, core imports were filtered out and never checked. `app-layer` and `main-entry` got `to.path: '^src/'` so their own allowed built-ins still pass.
- I checked each rule against throwaway violating files; all four kinds were reported.

## What is left
Nothing for this task. Gate `--tier sonar` passes, and `node qa/e2e.mjs` passes. No behaviour or test assertions changed; only test import paths and two test file names changed.

## What the next role must know
- Add a provider as `src/probes/<name>.ts` and list it in `probeProviders`. Do not import it from app.
- Colocated tests may import private files in their own layer. Other layers cannot.
- `marestail depth` rates `render/index.ts` and `probes/runner.ts` shallow per file. They are the interface of a deep module, not modules of their own.
- The `$1` back-reference in `module-entry-only` needs dependency-cruiser group matching (v18 has it).

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

## Config change
The Stop hook `marestail gate --hook` (changed files only) still fails `ts.deps` on a clean tree. Its output was just `✔ no dependency violations found` plus npm notices. The cause is in `marestail/gates/ts_deps.py::scoped_findings`: when no line matches `VIOLATION`, it returns every output line as a finding. It should return `[]`. The full-scope `--tier sonar` gate passes `ts.deps`.
