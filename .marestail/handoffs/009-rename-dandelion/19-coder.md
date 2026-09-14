# 009 rename-dandelion — coder (after hardener bounce)

## What I did
- Hardener item 1 (Stryker dry run): the unit suite no longer depends on the working-file exec bit, which the Stryker sandbox drops.
  - Manifest test: now checks the committed git mode (`git ls-files -s -- :/src/main.ts` starts with `100755`), not `statSync`. The `:/` pathspec resolves from the repo top, so it also works inside `.stryker-tmp`.
  - Dashboard test: runs `node src/main.ts --once` and `node <tmp>/dandelion --once` (a symlink to main.ts). The symlink run goes through the real isEntryFile realpath check. `./src/main.ts` and the bare `dandelion` exec, which need the exec bit, are left to the e2e.
- Killed the one surviving mutant (src/app/index.ts `argv1 !== undefined` → true, which was equivalent because `existsSync(undefined)` is false). `isEntryFile(moduleUrl, argv1: string)` and `runIfMain(metaUrl, argv1: string, …)` now take a string. `process.argv[1]` is already typed string (no noUncheckedIndexedAccess). I dropped the undefined test cases. perf/bench_entry calls it with strings, so it still works.
- `marestail gate --tier full`: GATE PASSED (496 tests, all mutants killed, sonar clean).

## What is left
- Hardener item 2: qa/*.mjs still use the ALLOWANCE banner and env names, and qa/009-rename-dandelion.e2e.mjs does not exist, so `node qa/e2e.mjs` fails. The qa role must apply the diff in 08/10-proposal.md. The coder may not edit qa/**.
- Hardener item 3: the name conflict is in the spec (see Config change).

## What the next role must know
- Two missing paths still compare equal inside isEntryFile (both undefined). That cannot happen at runtime.
- Port 59177 may be held by a real kimi process on this machine.

## Config change
- Rename the cursor unit test in the feature to "ignores the old cursor names in OLD_ENV". A literal ALLOWANCE title would break the feature's own grep.
- The qa role applies the qa/*.mjs renames and adds the 009 e2e from 08/10-proposal.md.

## Audit
- The banner says DANDELION -> src/main.test.ts::prints the same DANDELION dashboard through node src/main.ts and a dandelion symlink
- Live mode says DANDELION -> src/app/index.test.ts::begins the frame with the data age banner and the fleet summary once every probe has settled
- node src/main.ts still works -> src/main.test.ts::prints the same DANDELION dashboard through node src/main.ts and a dandelion symlink
- The dandelion command runs the dashboard -> src/main.test.ts::runIfMain runs once when invoked through a symlink to main.ts, as npm link creates
- Every env var works under its new name -> src/app/index.test.ts::applies every setting under its DANDELION_* name
- Live refresh reads DANDELION_REFRESH_SECONDS -> src/app/live.test.ts::starts the next round after the interval, keeps the data and marks the banner until it settles
- Old ALLOWANCE_* names are ignored -> src/app/index.test.ts::reads its settings under the DANDELION_* names and no other name
- The cursor probe ignores the old cursor names, proven without network -> src/probes/cursor.test.ts::ignores the old cursor names in OLD_ENV
- Live refresh ignores ALLOWANCE_REFRESH_SECONDS -> src/app/index.test.ts::waits the default 300 seconds between rounds unless DANDELION_REFRESH_SECONDS is set, reading no other name
- README uses the new name -> src/main.test.ts::README is updated with project details
- End-to-end checks -> src/main.test.ts::declares the dandelion bin with a shebang on an executable main.ts and no dependencies
