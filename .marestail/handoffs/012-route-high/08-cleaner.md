# 012 route --high — cleaner

## Done
- The Sonar gate passed on the coder's tree before I changed anything: 0 CRAP > 4, sonar clean, no dead code.
- `src/domain/route.ts`:
  - `onAccount(line, id)` now builds the `<line> <provider id>` token. `routeLine` and the chain walker used to repeat that template three times.
  - Renames for clarity: `chainMatchers` → `matchersInChainFor`, `others` → `claimedByOtherEntries`, `strongestLine` → `entryLine`, `best` → `leastUsed`.
  - `routeLine` now reads `.route` straight from the evaporation pick.
- `src/main.ts`: moved the `--high` argument check into `asksForHighChain(argv)`.
- No behaviour changed and no tests changed. The README already matched the code, so I left it alone.
- `marestail gate --tier sonar` printed GATE PASSED after these edits.

## Left / next role must know
- `node qa/e2e.mjs` still fails until the qa role updates the frozen 010/011 e2es for the account token and adds
  `qa/012-route-high.e2e.mjs`. 06-proposal.md has the full draft.
- `renderRoute`/`runRoute` still take a positional boolean `high`. I kept it: it is a single flag passed through two layers,
  and changing it to a mode type would only churn call sites.
- `rank` in `HIGH_CHAIN` is data only. The walk uses array order. The chain pin test covers it, and the task asks for every value to be pinned.
- A human still needs to confirm the specifier's assumptions 1 and 2.

## Config change
None.
