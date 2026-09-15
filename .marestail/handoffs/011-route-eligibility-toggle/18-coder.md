# 011 route-eligibility-toggle — coder (mutation fixes after 17-hardener)

## Done
- `marestail gate --tier full`: GATE PASSED. All mutants are killed and sonar is clean (606 tests, 301 functions).
- Hardener 1: new row `a directory that cannot be written` (chmod 0555) in the "cannot be written" test. writeFileSync fails
  after mkdir succeeds, so `rmSync(temp, { force: true })` must not throw. Each row now has its own unblock step.
- Hardener 2 and 3: `StateFile.read(path): string` throws on failure. The app adapter is `String(readFileSync(path))`.
  In domain/eligibility.ts, a single `readState` try/catch parses the file and checks for a plain object. A missing file,
  an unreadable one or bad JSON all give `{}`. The domain test's fake `read` throws when the file is missing.
- Hardener 4: `move(step)` is split into `moveDown` and `moveUp`.
- Hardener 5: `Session.selected` is a number and -1 means nothing is selected. `toggleSelected` keeps only the
  `usage !== undefined` guard, because `results[-1]` is undefined.
- No behaviour changed and no assertion was dropped.

## Config change
- Hardener 6: `live-session-gets-eligibility-injected` in `.dependency-cruiser.cjs` was added by 12-architect.
  I left it as is, because removing it would also change gate config, which this role must not do. A maintainer
  should decide whether to keep it. It only tightens the rules, and the code keeps it.

## Left
- QA: the qa/011 e2e, plus DANDELION_STATE_FILE set to a missing temp path in `appEnv` (qa/live-session.mjs) and in the
  001–010 child envs.

## Next role must know
- `startLive` takes `eligibility: Eligibility`. `routeLine`, `renderRoute` and `renderDashboard` take `ineligible: string[]`.
- A StateFile's `read` throws for a missing file. It does not return undefined.
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
