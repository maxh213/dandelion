# QA Procedure: 020 - new route lines for kimi, grok and hermes

Steps 1–7 check the kimi, grok and hermes cases. Since 021 they route with the made-up lines of `qa/routes.fixture.json`, so kimi prints `model-d` or `model-d max`, grok `model-e xhigh`, hermes `vendor/model-h xhigh`, and `--high` rank 4 `model-h4 xhigh`. The real lines task 020 moved, old and new, are in the Lines table of task 020 (`tasks/020-*.md`). Steps 8–9 update frozen living surfaces and are runnable only after those paths are writable for QA (see Config change in the specifier handoff).

Replacements for steps 8–9: every expected route string in the "from" column of that Lines table becomes the one in its "to" column.

Files for steps 8–9: `features/010`, `012`, `014`, `015`, `016`, `017`, `018`; `qa/010`–`018` (`.md` and `.e2e.mjs`). Leave `tasks/001`–`019` alone.

Set up once in the repo root, in a real terminal. Run the set-up blocks of `qa/010-route-command.md` and `qa/018-kimi-usage.md`, so `$RX`, `$RH`, `$TZQ`, `$KQ`, `$ST`, the `q` fixture, the `$K2` 2.0 kimi fixture, `rt`, `kr` and `hx` exist. `rt` routes with the made-up lines of `qa/routes.fixture.json`. The 2.0 kimi fixture is used so the kimi probe reports windows.

1. Run `rt Q_KIMI=10,10,72 Q_GROK=50,72`.
   - **Expected:** `model-d kimi`, then `exit=0`.

2. Run `rt Q_GROK=50,72`.
   - **Expected:** `model-e xhigh grok`, then `exit=0`.

3. Run `hx`, then `hs ok 22; hx`.
   - **Expected:** `model-e xhigh grok`, then `vendor/model-h xhigh hermes`, each with `exit=0`.

4. Run `rt Q_CLAUDE=95,10,10 Q_CURSOR=95,72 Q_GROK=60,72 A='route --high'`.
   - **Expected:** `model-h4 xhigh grok`, then `exit=0`.

5. Run `rt Q_KIMI=90,10,72 Q_GROK=50,72`, then `rt Q_KIMI=0,95,2 Q_AGY=0,0,72`.
   - **Expected:** `model-e xhigh grok` (kimi's 5h window is tripped), then `model-d max kimi` (weekly 95% evaporates before midnight), each with `exit=0`.

6. Run `rt A= NO_COLOR=1 TERM="$TERM" Q_KIMI=0,0,72 Q_CLAUDE=0,20,72 Q_GROK=9,130 DANDELION_JUNIE_HOME="$H0/empty" DANDELION_HERMES_AUTH_FILE="$H0/missing-hermes.json"`. This is the live dashboard, because `--once` has no route boxes (013). Once it settles, read lines 3 to 6, then press `q`.
   - **Expected:** the two route boxes show `model-d` over `kimi` for plain route and `model-h1 max` over `claude` for `--high`; no box contains a line from the "from" column of the Lines table of task 020.

7. Run `grep -n 'route\.kimi\.\|route\.grok\.\|route\.hermes\.\|high\.grok' README.md`.
   - **Expected:** the README Route routing table names `route.kimi.standard` and `route.kimi.max` for kimi, `route.grok.standard` and `route.grok.max` for grok, and `route.hermes.standard` and `route.hermes.max` for hermes; the `--high` chain names `high.grok` at rank 4. The tables name no model lines; those live in `routes.json`.

8. After living surfaces are writable for QA, apply the replacements above.
   - **Expected:** an `rg` for each line in the "from" column of the Lines table over `features/01{0,2,4,5,6,7,8}* qa/01{0,2,4,5,6,7,8}*` prints nothing. `tasks/001`–`019` still hold the old strings. Skip this step while the runner still freezes those paths.

9. After step 8, run `node qa/e2e.mjs; pgrep -fa dandelion-qa; git diff --stat HEAD -- 'qa/00*.e2e.mjs'`.
   - **Expected:** exits 0 and every `*.e2e.mjs` prints PASS. `pgrep` prints nothing. `git diff` shows only the living-surface expectation edits from step 8 (or nothing if already committed). Skip while step 8 is skipped.

10. Run `pkill -f "$K2/kimi" || true; rm -rf "$K2"`, then the clean-up of `qa/018-kimi-usage.md`.
   - **Expected:** nothing is left from this procedure.
