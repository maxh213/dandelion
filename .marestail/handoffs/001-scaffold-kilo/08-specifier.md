# Handoff: Specifier

## What I did
I verified the project state. The acceptance criteria in `features/001-scaffold-kilo.feature` and the manual QA procedure in `qa/001-scaffold-kilo.md` are complete and correctly cover all paths as requested. I ensured no frozen files were modified.

## What is left
- Project scaffold (Node >= 24, `"type": "module"`, TypeScript strict, `erasableSyntaxOnly: true`, and development tools).
- Implementation of domain model types, `kilo` probe with injected runner, 72-column ANSI terminal renderer, and the app wiring/entrypoint.
- Write unit tests and the `qa/e2e.mjs` test runner.

## What the next role must know
- **Zero runtime dependencies** are allowed.
- `.dependency-cruiser.cjs` must enforce the layered architecture (`main -> app -> render/probes -> domain`).
- The `kilo` probe must parse `Balance: $<dollars.cents>` using an injected runner for testability without the real CLI.
- No network calls should be made in this slice.
- Frozen files must not be changed.
