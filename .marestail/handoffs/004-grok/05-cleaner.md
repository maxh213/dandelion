# 004-grok — cleaner

## Done
- Sonar S6644 in `src/probes/grok.ts` `grokHome`: the conditional default is now `env['ALLOWANCE_GROK_HOME'] || ...`. An empty value still falls back to `~/.grok`.
- Removed duplication: agy's `validInstant`, kimi's `instantOf` and grok's `validInstant` were three copies of the same date check, each with its own `DATE_BEFORE_TIME`. There is now one `validInstant(value: unknown)` in `src/domain/index.ts`, which all three probes import. Probes may import domain, but they may not import each other.
- grok.ts: `field` is now `fieldOf` with an `isRecord` guard, and it has an `isCount` helper. These match kimi's names, so there are no `as` casts left. The percent check is unchanged: a finite number >= 0, rounded.
- No behaviour or test changes. Render, app and the domain types are as the coder left them.

## Verification
- `marestail gate --tier sonar`: GATE PASSED (268 tests, 100% coverage, CRAP <= 4, sonar clean).
- `node qa/e2e.mjs`: 002, 002-readme and 003 pass. 001 `missingKiloRendersUnavailable` fails with "unavailable panel still shows a gauge". It fails the same way on 1943265 without my changes. The cause is the tester's real `~/.grok` (99% gauge) leaking into the frozen 001, as 04-coder describes.

## Left for the next role
- `qa/004-grok.e2e.mjs` is still unwritten (the draft is in 5ab7b17).
- The 001/002 e2e conflict from 04-coder's Config change is still open: set `ALLOWANCE_GROK_HOME` to the fixture dir in their `runApp`, and allow `—` in their ASCII checks.

## Config change
None from me. 04-coder's request above still stands.
