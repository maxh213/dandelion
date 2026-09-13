# Handoff: Specifier

## What I did
I reviewed the project state after a reversion involving frozen files. The existing acceptance criteria in `features/001-scaffold-kilo.feature` and the manual QA procedure in `qa/001-scaffold-kilo.md` are comprehensive and accurately cover the happy path and all failure cases as requested. I strictly avoided modifying `tasks/008-claude-work.md` or any other frozen files.

## What is left
- Project scaffold (Node >= 24, `"type": "module"`, TypeScript strict, `erasableSyntaxOnly: true`, and the dev tools).
- Implementation of domain model types, `kilo` probe with injected runner, 72-column ANSI terminal renderer, and the app wiring/entrypoint.
- Write unit tests and the `qa/e2e.mjs` test runner.

## What the next role must know
- **Zero runtime dependencies** are allowed.
- `.dependency-cruiser.cjs` must enforce the layered architecture (`main -> app -> render/probes -> domain`).
- The `kilo` probe must parse `Balance: $<dollars.cents>` using an injected runner to allow testing without the real CLI.
- No network calls should be made in this slice.
- Frozen files (`marestail.toml`, `sonar-project.properties`, `guidance/`, `tasks/008-claude-work.md`) must not be changed.
