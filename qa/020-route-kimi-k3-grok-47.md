# QA Procedure: 020 - route kimi as kimi-code/k3 max and grok as grok-4.7 xhigh, hermes as x-ai/grok-4.7 xhigh

Earlier procedures are unchanged except for the three printed model lines and the strings that pin them. Before step 9, QA must move those pins in living surfaces (coder cannot edit `qa/`).

Replacements (every occurrence of an expected route string):
- `kimi-code/kimi-for-coding-highspeed` → `kimi-code/k3 max`
- `grok-4.6 xhigh` → `grok-4.7 xhigh`
- `x-ai/grok-4.6 xhigh` → `x-ai/grok-4.7 xhigh`

Files: `features/010`, `012`, `014`, `015`, `016`, `017`, `018`; `qa/010`–`018` (`.md` and `.e2e.mjs`). Leave `tasks/001`–`019` alone.

Set up once in the repo root, in a real terminal. Run the set-up blocks of `qa/010-route-command.md` and `qa/018-kimi-usage.md`, so `$RX`, `$RH`, `$TZQ`, `$KQ`, `$ST`, the `q` fixture, the `$K2` 2.0 kimi fixture, `rt`, `kr` and `hx` exist. The 2.0 kimi fixture is used so the kimi probe reports windows.

1. Run `rt Q_KIMI=10,10,72 Q_GROK=50,72`.
   - **Expected:** `kimi-code/k3 max kimi`, then `exit=0`.

2. Run `rt Q_GROK=50,72`.
   - **Expected:** `grok-4.7 xhigh grok`, then `exit=0`.

3. Run `hx`, then `hs ok 22; hx`.
   - **Expected:** `grok-4.7 xhigh grok`, then `x-ai/grok-4.7 xhigh hermes`, each with `exit=0`.

4. Run `rt Q_CLAUDE=95,10,10 Q_CURSOR=95,72 Q_GROK=60,72 A='route --high'`.
   - **Expected:** `grok-4.7 xhigh grok`, then `exit=0`.

5. Run `rt Q_KIMI=90,10,72 Q_GROK=50,72`, then `rt Q_KIMI=0,95,2 Q_AGY=0,0,72`.
   - **Expected:** `grok-4.7 xhigh grok` (kimi's 5h window is tripped), then `kimi-code/k3 max kimi` (weekly 95% evaporates before midnight), each with `exit=0`.

6. Run `rt NO_COLOR=1 A=--once Q_KIMI=0,0,72 Q_CLAUDE=0,20,72 Q_GROK=9,130 DANDELION_JUNIE_HOME="$H0/empty" DANDELION_HERMES_AUTH_FILE="$H0/missing-hermes.json" | head -15`.
   - **Expected:** the first two route boxes show `kimi-code/k3 max` over `kimi` for plain route and `claude-fable-5-1 max` over `claude` for `--high`; no box contains `kimi-for-coding-highspeed` or `grok-4.6`.

7. Run `grep -n 'kimi-code/k3 max\|grok-4.7 xhigh\|x-ai/grok-4.7 xhigh' README.md`.
   - **Expected:** the README Route routing table shows `kimi-code/k3 max` for kimi, `grok-4.7 xhigh` for grok, and `x-ai/grok-4.7 xhigh` for hermes; the `--high` chain shows `grok-4.7 xhigh` at rank 4.

8. Apply the replacements above to the living-surface files listed in the preamble.
   - **Expected:** `rg 'kimi-for-coding-highspeed|grok-4\.6|x-ai/grok-4\.6' features/01{0,2,4,5,6,7,8}* qa/01{0,2,4,5,6,7,8}*` prints nothing. `tasks/001`–`019` still hold the old strings.

9. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa; git diff --stat HEAD -- 'qa/00*.e2e.mjs'`.
   - **Expected:** exits 0 and every `*.e2e.mjs` prints PASS. `pgrep` prints nothing. `git diff` shows only the living-surface expectation edits from step 8 (or nothing if already committed).

10. Run `pkill -f "$K2/kimi" || true; rm -rf "$K2"`, then the clean-up of `qa/018-kimi-usage.md`.
   - **Expected:** nothing is left from this procedure.
