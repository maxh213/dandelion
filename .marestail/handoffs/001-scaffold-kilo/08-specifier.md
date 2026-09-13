# Handoff: Specifier

## Assumptions
- The task was previously attempted and the `features/001-scaffold-kilo.feature` and `qa/001-scaffold-kilo.md` were correctly created but the branch was bounced due to modifying frozen files. I assume retaining the correctly generated spec files is the right course of action.
- The `allowance` project directory is the intended root.

## What I did
I reviewed the user's requirements for the initial slice of the allowance dashboard. I ensured the acceptance criteria in `features/001-scaffold-kilo.feature` and the QA procedure in `qa/001-scaffold-kilo.md` perfectly align with the constraints (no runtime dependencies, specific CLI output format). I avoided touching any frozen files like `tasks/008-claude-work.md`.

## What is left
- Scaffold the project (Node >= 24, TypeScript strict, etc.).
- Set up the development dependencies and static analysis tools.
- Implement the domain model, `kilo` probe, and terminal renderer.
- Write unit tests and the `qa/e2e.mjs` script.

## What the next role must know
- The application must have zero runtime dependencies.
- Use an injected runner for the `kilo` probe so tests do not touch the real CLI.
- No network calls in this slice.
- Frozen files must not be changed.
