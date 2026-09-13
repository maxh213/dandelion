# QA Procedure: 002 - Claude and agy windows

Set up once: a temp dir `$FX` with executable fixtures `claude`, `agy`, `kilo` that print the transcripts in `features/002-claude-agy.feature` (Background; agy rows all at `100%`). Use `PATH="$FX:$(dirname "$(command -v node)")"` so no real `claude` or `agy` runs.

1. Run `node qa/e2e.mjs`.
   - **Expected:** exits 0; `001-scaffold-kilo.e2e.mjs`, `002-readme.e2e.mjs` and the new 002 e2e all print PASS. Finishes well under 30s (no real `claude`/`agy` spawned).

2. Run `PATH="$FX:..." npm start`.
   - **Expected:** exits 0. Banner `ALLOWANCE … HH:MM:SSZ`, then panels in order `claude`, `agy`, `kilo`. Every line ≤ 72 columns.

3. Inspect the claude panel.
   - **Expected:** caption `claude code · claude`. Rows `session` (3%), `weekly` (`86%`, 17 filled cells), `weekly Fable` (100%, 20 filled), each followed by `↻ <countdown>`. No row for the "What's contributing" section.

4. Inspect the agy panel.
   - **Expected:** caption `agy · agy`. Four rows labelled `Gemini Models · Weekly Limit`, `Gemini Models · Five Hour Limit`, `Claude and GPT models · Weekly Limit`, `Claude and GPT models · Five Hour Limit`, each `0%` with an empty gauge and a `↻` countdown (weekly ≈ `7d…`).

5. Inspect the kilo panel.
   - **Expected:** unchanged from task 001: `$14.15`, 14 `█` + 6 `░`, dim caption `api balance · kilo`.

6. Replace `$FX/claude` with a script that runs `exit 1`; run step 2 again.
   - **Expected:** exits 0; claude panel dim with reason `Command failed or timed out`, no gauge; agy and kilo render normally.

7. Replace `$FX/agy` with a script printing `hello world`; run step 2 again.
   - **Expected:** agy panel dim with reason `Could not parse usage from output`; kilo still renders.

8. Run `PATH="$(mktemp -d):$(dirname "$(command -v node)")" npm start`.
   - **Expected:** exits 0; three dim unavailable panels in order claude, agy, kilo with reasons `claude CLI not found in PATH`, `agy CLI not found in PATH`, `kilo CLI not found in PATH`.
