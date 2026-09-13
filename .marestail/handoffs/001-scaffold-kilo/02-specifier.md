# Handoff: Specifier

## What I did
I wrote the acceptance criteria in `features/001-scaffold-kilo.feature` and the manual QA procedure in `qa/001-scaffold-kilo.md`. These outline the exact behavior of the one-shot dashboard displaying the kilo balance, and the fallback behaviors when the CLI is missing or returning bad data. 

## What is left
- Scaffold the project (Node >= 24, `"type": "module"`, TypeScript strict, `erasableSyntaxOnly: true`).
- Configure dev dependencies and static analysis tools (`vitest`, `eslint`, `dependency-cruiser`, `knip`, `stryker`).
- Implement the domain model types (`ProviderUsage`, `UsageWindow`, `Balance`).
- Implement the `kilo` probe utilizing an injected command runner for testability.
- Implement the fixed 72-column ANSI terminal renderer.
- Add the app wiring and the `src/main.ts` entrypoint.
- Write unit tests and the `qa/e2e.mjs` automated E2E test runner.

## What the next role must know
- The application must have **zero runtime dependencies**.
- Ensure `.dependency-cruiser.cjs` enforces the strict layered architecture (`main -> app -> render/probes -> domain`).
- The `kilo` probe must parse `Balance: $<dollars.cents>` using an injected runner; tests should never touch the real CLI.
- No network calls should be made in this slice.
- `marestail.toml`, `sonar-project.properties`, and `guidance/` are frozen and must not be broken.
