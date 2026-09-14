# 011 route-eligibility-toggle — architect

## Done
- Merged the eligibility state into one deep domain object. `domain/eligibility.ts` used to export six functions:
  path, parse, ineligible ids, toggle, serialize and the state type. Callers stitched these together in two places.
  Now it exports `openEligibility(env, homeDir, file)` plus two types:
  - `StateFile { read(path); replace(path, text) }`, the IO port.
  - `Eligibility { ineligible(); toggle(id): boolean }`, the object callers use.
  It hides the path rules, the "not a plain object is corrupt" parsing, "exactly false", key-keeping toggles, the
  JSON layout, and committing to memory only after a successful write. It reads once, when opened.
- `app/index.ts` is the IO edge. It keeps only the fs adapter: `readText`, plus `replaceFile` (mkdir, temp file,
  rename, unlink on failure) as `realStateFile`. `runApp` and `runRoute` call `.ineligible()` and never toggle.
  `runLive` injects the opened Eligibility.
- `app/live.ts` lost the `state` and `saveState(state)` ports and holds no copy of the state. Its toggle is now
  `eligibility.toggle(id) ? draw : flash "routing state not saved"`, so commit-on-success is no longer split
  between live.ts and app/index.ts.
- `render/index.ts` re-exports two domain values (`isRoutable`, `openEligibility`) and two types, down from six.
  It stays the path: the app-layer contract forbids app → domain, and loosening it is not allowed.
- New contract `live-session-gets-eligibility-injected` in `.dependency-cruiser.cjs`: `app/live.ts` may import only
  `render/index.ts` and `probes/index.ts`. A future sibling state module cannot be pulled in; it must be injected.
- Tests: the domain eligibility unit tests now go through `openEligibility` with a fake StateFile. They keep every
  earlier row and add one for a failed write keeping the old state. The live tests use a real Eligibility over a
  `replace` spy and assert the same JSON states as before. No assertion was dropped.
- `marestail gate --tier sonar`: GATE PASSED (605 tests, 305 functions).

## Left
- The qa/ work from 09-coder is still open: the 011 e2e, and DANDELION_STATE_FILE in `appEnv` and in the 001–010 child envs.

## Next role must know
- `startLive` takes `eligibility: Eligibility`, not `state` and `saveState`.
- `routeLine`, `renderRoute` and `renderDashboard` still take a plain `ineligible: string[]`. The decision and the
  renderers stay general and know nothing about the file.
- `render/terminal.ts` (297 lines) stays one module. Panels and the live frame change for the same reason: how the
  dashboard looks.
- A pre-existing unstaged deletion of .marestail/handoffs/010-route-command/26-qa.md was left untouched.
