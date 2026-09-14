# 011 route-eligibility-toggle — cleaner

## Done
- The gate already passed on the coder's commit (sonar clean, 0 functions above CRAP 4). The changes are for readability only and change no behaviour.
- `domain/route.ts`: the eligibility check is its own step, `eligibleUsages(usages, ineligible)`. `routeLine` runs it before
  `candidatesOf`, so candidates are dropped before both rules. `candidatesOf` is back to its 010 shape.
- `domain/eligibility.ts`: `parsedJson` uses `text ?? ''` instead of `String(text)`. A missing file still fails to parse and gives `{}`.
- `app/live.ts`: `toggleSelected` returns early when nothing is selected, instead of checking `undefined` on both sides.
- `render/terminal.ts`: `livePanel` takes the spinner again rather than the whole view.
- No tests changed. `marestail gate --tier sonar`: GATE PASSED (604 tests, 306 functions).

## Left
- The qa/ work from 09-coder is still open: the 011 e2e, and DANDELION_STATE_FILE set in `appEnv` and in the 001–010 child envs.
- The eligibility helpers still reach `app` through `render/index.ts`, because `app` may not import domain. The architect may want to review this.

## Next role must know
- Everything in 09-coder.md still holds. `routeLine` and `renderRoute` take a required `ineligible` array.
- A pre-existing unstaged deletion of .marestail/handoffs/010-route-command/26-qa.md was left untouched.
