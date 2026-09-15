# 011 route-eligibility-toggle — architect (after 23-hardener bounce)

## Done
- No module boundary moved this round. The boundaries from 12-architect hold, and the hardener found nothing in src or tests:
  - `domain/eligibility.ts` stays one deep module: `openEligibility(env, homeDir, file)` hides the path rules, parsing,
    "exactly false", key-keeping toggles and commit-after-write behind `Eligibility { ineligible(); toggle(id) }`.
  - `app/index.ts` is the only IO edge (the `StateFile` fs adapter). `app/live.ts` gets the Eligibility injected and
    imports only `render/index.ts` and `probes/index.ts`.
  - `routeLine`, `renderRoute` and `renderDashboard` take a plain `ineligible: string[]` and know nothing about the file.
- `marestail depth`: 19 modules, 0 rule breaks. `marestail gate --tier sonar`: GATE PASSED (606 tests, 301 functions).
- I did not edit `.dependency-cruiser.cjs`. The runner treats it as frozen and already reverted one removal (f985efd),
  so another edit from this role would be reverted the same way.

## Config change
- The one open point is gate configuration, and only a human can settle it. `.dependency-cruiser.cjs` still contains
  `live-session-gets-eligibility-injected`, which I added in d1b4f91 (12-architect). My instructions then asked me to
  encode module decisions in the contracts, and they allow changes that only tighten them. The hardener bounces any
  change to gate config. These two rules conflict, and the runner's frozen baseline now includes my rule.
- A maintainer must pick one:
  a) Keep the rule: accept it as a tightening. The code already satisfies it. Tell the hardener that stricter
     contract changes made by the architect are allowed.
  b) Drop it: accept 21-proposal.md, or reset the frozen baseline of this file to 6b86a93 (blob a20a311).
     Then the task's diff has no config change.
- Either choice needs no code change. I recommend (a). The rule stops live.ts from importing a sibling state module
  directly, which is the boundary this task drew. The existing `live-session-no-io` rule does not cover that.

## Left
- The config decision above.
- QA: the qa/011 e2e, plus DANDELION_STATE_FILE set to a missing temp path in `appEnv` (qa/live-session.mjs) and in
  the 001–010 child envs.

## Next role must know
- The code needs no further change. A hardener who sees only the `.dependency-cruiser.cjs` diff should route it to the
  human decision above, not back to the coder or architect.
- `startLive` takes `eligibility: Eligibility`. A StateFile's `read` throws for a missing file.
- A pre-existing unstaged deletion of .marestail/handoffs/010-route-command/26-qa.md was left untouched.
