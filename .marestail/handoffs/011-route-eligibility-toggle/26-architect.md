# 011 route-eligibility-toggle — architect (after 25-hardener bounce)

## Done
- No module boundary, interface, source, test or README change this round. `git diff b232457..HEAD` still shows no change
  outside .dependency-cruiser.cjs and .marestail. The boundaries from 12-architect stand:
  - `domain/eligibility.ts`: one entry, `openEligibility(env, homeDir, file)` → `Eligibility { ineligible(); toggle(id) }`,
    hiding path rules, parsing, "exactly false", key-keeping rewrites and commit-after-write.
  - `app/index.ts` is the only IO edge (`StateFile` fs adapter); `app/live.ts` gets the Eligibility injected.
  - `routeLine`, `renderRoute`, `renderDashboard` take a plain `ineligible: string[]`.
- `marestail depth`: 19 modules, 0 rule breaks. `marestail gate --tier sonar`: GATE PASSED.
- I did not edit `.dependency-cruiser.cjs`. It is frozen: the runner reverted 20-coder's removal (f985efd), so a removal
  from this role would be reverted the same way, and adding to it is forbidden by the finishing rules.

## Config change
- Unchanged from 24-architect, and still a human decision. The task diff 6b86a93..HEAD adds the rule
  `live-session-gets-eligibility-injected` (blob a20a311 -> d33befa), added by me in d1b4f91. No maintainer approval
  exists in writing, so I cannot record one.
- The loop: the hardener bounces any gate config change; the runner freezes the file with the rule in it; no agent role
  can move it either way. Every further bounce to architect or coder will end the same.
- A maintainer picks one:
  a) Keep the rule as a tightening (the code already satisfies it) and tell the hardener so in writing.
  b) Accept 21-proposal.md, or reset the frozen baseline to 6b86a93, so the file ends the task at blob a20a311.
- Neither choice needs a code change. I recommend (a): earlier architect tasks (e633329, 3a53b09, 566bd96) tightened
  this same file the same way, and `live-session-no-io` alone does not stop live.ts importing a sibling state module.

## Left
- The config decision above; the runner should escalate it rather than bounce again.
- QA: the qa/011 e2e, plus DANDELION_STATE_FILE set to a missing temp path in `appEnv` (qa/live-session.mjs) and in the
  001–010 child envs.

## Next role must know
- The code needs no further change. Route the `.dependency-cruiser.cjs` point to a maintainer, not to coder or architect.
- `startLive` takes `eligibility: Eligibility`. A StateFile's `read` throws for a missing file.
- A pre-existing unstaged deletion of .marestail/handoffs/010-route-command/26-qa.md was left untouched.
