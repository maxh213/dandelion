# Handoff: Coder

## What I did
Audited the slice against the feature instead of re-running the gate only, and fixed real gaps:
- Unit tests were spawning the real `kilo` CLI (installed at `~/.local/bin/kilo`) via `main`. `main`/`runIfMain` now take an injected runner; only the module's top-level call builds `RealCommandRunner`. `main.test.ts` mocks it.
- Banner printed full ISO with millis, so output never contained `10:00:00Z`. Banner now shows `HH:MM:SSZ` from the fetch instant.
- Unavailable panel was not actually dim: the rule's own reset code ended the dim span. The whole panel is now wrapped once (`dim` helper in `src/render/terminal.ts`).
- `main.ts` now depends on app only (runner type derived from `runApp`); `UsageWindow` is no longer exported (unused outside domain).
- Removed duplicate/throwaway tests; added scenario-level tests in `src/app/wiring.test.ts` that drive `runApp` end to end with a mock runner.

`marestail gate --tier fast` prints GATE PASSED; `node qa/e2e.mjs` passes.

## What is left
Nothing for this task.

## What the next role must know
- Your shell may have `NO_COLOR=1` set; unset it to see the colored/Unicode dashboard.
- Renderer tests and wiring tests take the fetch time as an ISO instant, not a clock string.
- The qa e2e fixture uses `echo` with `\n`; under bash-as-sh it prints one line, which still parses. Worth making it `printf` when the cleaner touches qa.

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
