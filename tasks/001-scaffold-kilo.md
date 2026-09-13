# 001 — scaffold the app, ship the first gauge (kilo)

The repo has marestail config but no code yet. After this task a user can run one command and see a styled terminal dashboard showing their **kilo** API balance, rendered from live probe data. This is the first vertical slice: scaffolding, domain model, one probe, one renderer, one-shot output.

## User outcome

`npm start` (which runs `node src/main.ts`) probes kilo once and prints the allowance dashboard to stdout, then exits (one-shot mode; a live-refresh mode comes in a later task). With a working kilo CLI the user sees their current balance; without one they see an unavailable card that explains why.

## Scaffold (exactly this shape)

- Node >= 24, `"type": "module"`, TypeScript strict, **zero runtime dependencies** — the app runs via native type stripping: `node src/main.ts`. Set `"erasableSyntaxOnly": true` in tsconfig so this stays true. Dev dependencies only: typescript, vitest, @vitest/coverage-v8, eslint + typescript-eslint, dependency-cruiser, knip, @stryker-mutator/core + @stryker-mutator/vitest-runner.
- `package.json` scripts: `start` = `node src/main.ts`, `test` = `vitest run`, `qa` = `node qa/e2e.mjs`.
- `vitest.config.ts`: v8 coverage with `coverage.include = ["src/**/*.ts"]` (tests are colocated `src/**/*.test.ts`).
- `tsconfig.json` strict + erasableSyntaxOnly (the gate runs `tsc --noEmit -p tsconfig.json`).
- `eslint.config.js` flat config covering `**/*.ts`.
- `.dependency-cruiser.cjs` enforcing the layer direction below plus no cycles.
- `stryker.config.json` mutating `src/**/*.ts` except tests, vitest runner.
- `knip.json` (or equivalent) so the deadcode gate stays green.
- `.gitignore` gains `node_modules/`, `dist/`, `ts-coverage/`.
- `README.md`: what allowance is, the run commands, and an env-var ledger (see below) — keep it in sync with the code.

## Layers (dependency direction, enforced by dependency-cruiser)

- `src/domain/` — types and pure functions only; imports nothing outside domain.
- `src/probes/` — provider probes; depend on domain only.
- `src/render/` — ANSI rendering, pure functions; depends on domain only, never on probes.
- `src/app/` — wiring (runs probes, builds the view model); depends on probes, render, domain.
- `src/main.ts` — entry; depends on app.

## Domain model

- `ProviderUsage`: provider id, display name, optional plan/tier label, list of `UsageWindow`s, optional `Balance`, fetched-at timestamp, and a status of `ok | unavailable | error` with a human-readable reason when not ok.
- `UsageWindow`: label (e.g. "weekly"), `usedPct` 0–100 (always *used*, never remaining), optional `resetsAt` (ISO instant).
- `Balance`: amount, currency, optional reference amount.
- Pure helper: format a reset countdown ("5h12m", "3d4h") from `resetsAt` relative to an injected now.

## Kilo probe (the slice's provider)

Recipe (verified live): run `kilo profile` (20s timeout). stdout looks like:

```
Name: Max
Email: yeti213@googlemail.com
Team: Personal
Balance: $14.15
```

Parse `Balance: $<dollars.cents>` → `Balance` (reference amount from env var `ALLOWANCE_KILO_REFERENCE`, default `20`). No usage windows exist for kilo. Missing/binary-error/non-parseable output → status `unavailable` with the reason. All process spawning goes through a small injected runner interface so tests never touch the real CLI.

## Render

Mission-control gauge-cluster aesthetic, fixed 72-column layout, works on a plain 16-color terminal and degrades to ASCII when `NO_COLOR` is set. For this slice:

- A one-line banner with the wordmark `ALLOWANCE` and the fetch time.
- One provider panel for kilo: heavy top rule, provider name, the balance as `$14.15` with a 20-cell block gauge filled by balance/reference (empty when no reference), and a dim caption `api balance · kilo`.
- An `unavailable` panel variant: same frame, dim, reason text instead of the gauge.
- Gauges: `█` filled / `░` empty, exactly 20 cells; fill count rounds half-up.

## QA procedure

`node qa/e2e.mjs` (create it) runs every `qa/*.e2e.mjs` and reports pass/fail. Add one e2e: put a fixture directory first on PATH containing an executable `kilo` that prints the four-line profile above, run `node src/main.ts`, assert exit 0 and that the output contains `ALLOWANCE`, `kilo`, `$14.15`. A second e2e with an empty PATH fixture (no kilo) asserts the unavailable card renders and exit is still 0.

## Must not break

- `marestail.toml`, `sonar-project.properties`, `guidance/` are frozen.
- No runtime dependencies; no network calls in this slice.
