# Handoff: Specifier

## What I did
I reviewed the previously created acceptance criteria (`features/001-scaffold-kilo.feature`) and QA procedure (`qa/001-scaffold-kilo.md`). They correctly cover the required functionality for the first vertical slice. I made sure not to modify any frozen files like `tasks/008-claude-work.md`.

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
