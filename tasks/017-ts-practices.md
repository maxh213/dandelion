# 017 — apply the TypeScript practices rulebook

This task changes no user-visible behaviour. After it, every TypeScript file under `src/` that this branch touches complies with `guidance/ts.md` (`TS-1`…`TS-48`), and `marestail` practices on that diff PASSes.

The rulebook is already in the repo. This task is the pass that applies it: unions over enums, `satisfies` over `as`, schema at the edges, no classes in the TUI layer, derive-don't-duplicate, no barrel `index.ts` in app code, and the rest of the numbered rules. React and Next.js rules do not apply (this is a Node TUI).

## What to change

- TypeScript under `src/` (app, domain, probes, render, `main.ts`). Match `guidance/ts.md`. One rule id per finding; no taste beyond the rulebook.
- Tests under `src/**/*.test.ts` only as needed so behaviour stays pinned. Do not weaken assertions to satisfy a rule.

## What must not change

- Probe results, panel order, captions, gauges, route lines (`dandelion route` / `route --high`), eligibility toggle, session-trip, QA fixtures and e2es from 001–016.
- `guidance/ts.md` itself (frozen). README meaning. `package.json` scripts and the vitest runner.
- No new runtime dependencies. kilo is still never routed.

## Done when

- `marestail` practices PASSes on the task diff against `guidance/ts.md`.
- `node qa/e2e.mjs` still passes. Existing unit tests still pass.
- A user running the dashboard or `dandelion route` cannot tell this task ran, except the code is stricter against the rulebook.
