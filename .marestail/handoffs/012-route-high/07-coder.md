# 012 route --high — coder (after the qa freeze revert)

## Done
- The runner freezes `qa/**` for coders. I restored `qa/010-route-command.e2e.mjs` and `qa/011-route-eligibility-toggle.e2e.mjs` to 3ab70b2
  and removed `qa/012-route-high.e2e.mjs`. After this commit qa/ matches 3ab70b2.
- Production code is unchanged from a62aaf3: `HIGH_CHAIN` and `highRouteLine` in `src/domain/route.ts`, both route forms print
  `<line> <provider id>`, `main.ts` passes an exact `--high` after `route`. README is unchanged from a62aaf3.
- Two new tests in `src/main.test.ts` replace process-level coverage the removed e2e used to give:
  - `runIfMain route --high prints one line on two terminals without live mode`
  - a real `node src/main.ts route --high` run with a fixture where claude reports Fable at 100%. It prints `claude-opus-5 max claude`;
    plain `route` on the same fixture prints `claude-opus-5 high claude`.
- `marestail gate --tier fast` printed GATE PASSED.

## Left / next role must know
- `node qa/e2e.mjs` will FAIL until the qa role updates the frozen e2es. The 010/011 e2es still expect route lines with no token,
  and the spec requires the token. Every expected route line needs ` <provider id>`: the 010 ROUTE_ROWS, the 011 ROUTE_ROWS, and 011's
  default-path and `route while live` checks. `none` rows stay as they are.
- `qa/012-route-high.e2e.mjs` still has to be written by the qa role. 06-proposal.md has a full working draft that passed locally.
- Assumptions 1 and 2 from the specifier are still implemented as written and still need a human to confirm them.

## Config change
None to the gate. The qa role has to apply the e2e changes in 06-proposal.md: the feature's "End-to-end checks" scenario requires them,
and a coder can't make them.

## Audit
- route --high walks the chain -> src/domain/index.test.ts::pins the chain entry by entry
- Arguments -> src/main.test.ts::runIfMain %j uses the --high chain only when an exact --high follows route
- route --high on a terminal still prints one line -> src/main.test.ts::runIfMain route --high prints one line on two terminals without live mode
- Plain route prints the account token -> src/app/index.test.ts::probes every provider once and routes by the next local midnight of the given zone
- The decisions, unit level -> src/domain/index.test.ts::pins the chain entry by entry
- Nothing else changes -> src/app/index.test.ts::routes as the 010 rules say with no state file and never creates one
- README documents route --high and the token -> src/main.test.ts::README documents route --high and the account token
- End-to-end checks -> src/main.test.ts::walks the chain past a tripped Fable window through node src/main.ts route --high, while plain route keeps 010 with the token
