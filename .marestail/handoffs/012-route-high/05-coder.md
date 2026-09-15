# 012 route --high — coder

## Done
- `src/domain/route.ts`: `HIGH_CHAIN` (exported, rank/providers/matcher/line; (all) entries have no `matcher`) and `highRouteLine(usages, ineligible)`.
  Gating: a matcher entry takes rolling windows plus label-contains-matcher (lower-cased). An (all) entry takes every window except those matching any chain matcher of that provider.
  An account is open when its highest gating usedPct is < 90 (0 when it has no gating windows). Lowest used wins; stable sort keeps chain provider order on ties.
- Plain `routeLine` now returns `<line> <id>`; the decision is unchanged. `RoutableWindow` gained `label`.
- `renderRoute(..., high)` and `runRoute(..., high)` take a boolean. `main.ts` passes `argv.slice(3).includes('--high')`.
- Tests: chain pin plus 16 walker rows in `src/domain/index.test.ts`, the high path in `src/render/route.test.ts` and `src/app/index.test.ts`, and argv parsing plus README in `src/main.test.ts`.
  The old route expectations gained only the provider token.
- `qa/010-*.e2e.mjs` and `qa/011-*.e2e.mjs` changed only in expected route lines, adding the token. 001–009 are byte-identical to d1df61f.
- New `qa/012-route-high.e2e.mjs` covers every chain, argument and plain-token row, plus a `script` terminal run through a `dandelion` symlink. It sets SHELL=/bin/sh, otherwise the user's fish config leaks into the output.
- README: `--high` in Run Commands; the Route section gains the account token, the chain table, gating windows, the 90% trip, skips, the tie-break and `none`.
- `marestail gate --tier fast` passed. `node qa/e2e.mjs` passed all 14 files.

## Left / next role must know
- Assumptions 1 and 2 from the specifier are implemented as written and still need a human to confirm them.
  (1) `(all)` excludes windows other entries match. (2) Tie-break on left over gating windows.
- `renderRoute`/`runRoute` take a positional boolean `high`; the cleaner may prefer a mode value.
- The README eligibility test counts paragraphs containing lowercase "ineligible". The new --high paragraph uses "Ineligible" at the start of a sentence, so it stays a single match.

## Config change
None.

## Audit
- route --high walks the chain -> qa/012-route-high.e2e.mjs::highWalksTheChain
- Arguments -> qa/012-route-high.e2e.mjs::argumentsPickTheMode
- route --high on a terminal still prints one line -> qa/012-route-high.e2e.mjs::terminalStillPrintsOneLine
- Plain route prints the account token -> qa/012-route-high.e2e.mjs::plainRoutePrintsTheToken
- The decisions, unit level -> src/domain/index.test.ts::pins the chain entry by entry
- Nothing else changes -> qa/011-route-eligibility-toggle.e2e.mjs::onceShowsTagAndNeverWrites
- README documents route --high and the token -> src/main.test.ts::README documents route --high and the account token
- End-to-end checks -> qa/012-route-high.e2e.mjs::assertNoQaProcessLeft
