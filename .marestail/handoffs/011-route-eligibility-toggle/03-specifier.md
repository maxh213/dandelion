# 011 route-eligibility-toggle — specifier (after critic bounce)

## Assumptions (added to 01's)
- Pending panels and "nothing selected" ignore space completely: no write, no flash. Unavailable, error and windowless ok panels flash.
- Corrupt = not JSON, or JSON that is not an object (null, [false], 5, "x"). All of these mean every provider is eligible.
- In an all-dim panel (unavailable, error, stale ok), the tag adds no escape codes and stays inside the one dim span. When selected, the bold rule ends with \e[0m and the dim span reopens at the header line. The exact bytes are in "Tag bytes in an all-dim panel".
- The flash draws at once and belongs to the pressed panel, not to ▸. A frame is drawn when 2 s end. Only one flash shows at a time: a new flash replaces it and restarts the 2 s, and a successful toggle leaves it alone.
- Live mode reads the state file once at start and never rereads it. Edits made while it runs are overwritten by its next write.
- A failed write leaves no temp file and changes nothing in memory, so the next successful toggle writes the value from before the failure, flipped once.

## Done
- Fixed all 10 critic points in features/011 and qa/011: the preamble, corrupt rows, the all-dim bytes outline, the flash scenario, reread and overwrite, write-failure rows, and QA steps 8, 9, 11 and 14. The e2e list now includes the corrupt `--once` byte comparison and the appEnv/earlier-e2e DANDELION_STATE_FILE rule.
- Gate passes (no code changed).

## Next role must know
- Dependency rules: file IO only in `src/app/index.ts`, and `src/app/live.ts` imports no Node built-ins, so inject load/save ports. Path and eligibility parsing can be a domain leaf. `render/route.ts` must not import `render/index.ts`.
- `press()` in live.ts loops over each character of a chunk. Down/Up arrive as the 3-char chunks "\e[B"/"\e[A", so match them as whole sequences.
- For the "cannot be written" rows: rename(tmp, non-empty dir) fails on Linux, so the temp file must be unlinked on failure.
- HELP_FOOTER unit pins change. The README needs the live keys, the Route paragraph, and DANDELION_STATE_FILE in the env ledger.
- QA must set DANDELION_STATE_FILE to a missing temp path in `appEnv` (qa/live-session.mjs) and in every 001–010 e2e child env.
- A pre-existing unstaged deletion of .marestail/handoffs/010-route-command/26-qa.md was left untouched.
