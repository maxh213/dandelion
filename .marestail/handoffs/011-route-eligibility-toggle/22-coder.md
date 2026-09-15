# 011 route-eligibility-toggle — coder (after the frozen-file revert)

## Done
- The runner treats .dependency-cruiser.cjs as frozen. It reverted my 20-coder removal and filed it as 21-proposal.md, so the
  `live-session-gets-eligibility-injected` rule is back in the file. I left the file alone.
- No source or test change was needed. `src/app/live.ts` imports only `render/index.ts` and `probes/index.ts`, which satisfies
  the rule, and `app/index.ts` injects the Eligibility.
- `marestail gate --tier fast`: GATE PASSED (606 tests, 301 functions, 0 above CRAP 4, dependency rules kept, docs match).

## Config change
- None requested. Whether the stricter rule stays is for a maintainer to decide, as 21-proposal.md says. Keeping it or
  removing it needs no code change.

## Left
- QA: the qa/011 e2e, plus DANDELION_STATE_FILE set to a missing temp path in `appEnv` (qa/live-session.mjs) and in the
  001–010 child envs.

## Next role must know
- The hardener's remaining point (19-hardener 1) is about a frozen file the runner controls, so the coder cannot resolve it.
- `startLive` takes `eligibility: Eligibility`. `routeLine`, `renderRoute` and `renderDashboard` take `ineligible: string[]`.
- A StateFile's `read` throws for a missing file; it does not return undefined.
- A pre-existing unstaged deletion of .marestail/handoffs/010-route-command/26-qa.md was left untouched.

## Audit
- route skips ineligible providers before both rules -> src/app/index.test.ts::routes around ineligible providers and never writes: %s
- The default state file path -> src/app/index.test.ts::reads the default state path under %s
- --once shows the tag and never writes -> src/app/index.test.ts::tags ineligible panels in --once output, changes no other line and never writes
- Tag bytes in an all-dim panel -> src/render/terminal.test.ts::keeps the tag inside the dim span of an all-dim panel: %s
- Toggle a provider off and on in live mode -> src/app/index.test.ts::toggles claude off and on with j and space, writing only the state file, and keeps the choice across restarts
- A rewrite keeps unknown keys and overwrites edits made while running -> src/app/index.test.ts::rewrites the state read at start with unknown keys kept, overwriting edits made while running
- Non-routable panels flash and write nothing -> src/app/live.test.ts::flashes a settled non-routable panel for 2 s without saving, and forgets the flash on quit
- The flash stays put, and a second flash restarts it -> src/app/live.test.ts::keeps a flash on the pressed panel and restarts the 2 s on a new flash
- Space on a pending panel or with nothing selected does nothing -> src/app/live.test.ts::does nothing on space with nothing selected or on a pending panel
- A state file that cannot be written -> src/app/index.test.ts::flashes routing state not saved and leaves no temp file behind with %s
- Moving the selection -> src/app/live.test.ts::moves the selection one panel per key and stops at the ends: %s
- Colours and footer in live mode -> src/render/terminal.test.ts::dims the tag on its own and bolds the selected rule of a fresh panel
- The route decision with eligibility, unit level -> src/domain/index.test.ts::drops an ineligible provider before the evaporation rule
- Nothing else changes -> src/app/index.test.ts::routes as the 010 rules say with no state file and never creates one
- README documents eligibility -> src/main.test.ts::README documents route eligibility
- End-to-end checks -> src/live-terminal.test.ts::toggleWritesState: j then space writes claude false and tags its header; space again flips it back
