# QA Procedure: 014 - route skips tripped accounts

Earlier procedures are unchanged by 014.

Set up once in the repo root, in a real terminal. First run the set-up blocks of `qa/010-route-command.md` and `qa/011-route-eligibility-toggle.md`, so `$RX`, `$RH`, `$TZQ`, `$ST`, the `q` fixture and `rt` exist. Each `Q_*` variable is `rolling,weekly,resetHours` as in 010 (`weekly,resetHours` for grok and cursor); hours may be fractional. `rq VAR=value…` is `rt` with the state file. `live VAR=value…` adds the live case of the task, with claude-work left for each step to set.

```bash
rm -rf "$RX/state"
rq() { rt DANDELION_STATE_FILE="$ST" "$@"; }
live() { rq Q_CLAUDE=2,13,130 Q_AGY=0,17,126 Q_KIMI=0,95,73 Q_GROK=9,130 Q_CURSOR=36,365 "$@"; }
```

1. Run `live Q_WORK=100,72,5.35 2>/tmp/014.err; wc -c < /tmp/014.err`.
   - **Expected:** `grok-4.6 xhigh grok`, `exit=0`, then `0`. Before 014 this printed `claude-opus-5 max claude-work`.

2. Run `live Q_WORK=89,72,5.35`, then `live Q_WORK=90,72,5.35`.
   - **Expected:** `claude-opus-5 max claude-work` (89% is under the trip), then `grok-4.6 xhigh grok` (90% trips). Each is followed by `exit=0`.

3. Run `live A='route --high' Q_WORK=100,72,5.35`.
   - **Expected:** `claude-fable-5-1 max claude`, `exit=0`: `--high` is unchanged.

4. Run `rq Q_CLAUDE=10,80,2 Q_WORK=95,52,2`, then `rq Q_AGY=95,50,2 Q_CLAUDE=0,20,72`.
   - **Expected:** `claude-opus-5 max claude` (work would evaporate with 48 left but is tripped), then `claude-opus-5 high claude` (a tripped agy never evaporates). Each is followed by `exit=0`.

5. Run `rq Q_KIMI=95,0,72 Q_GROK=97,72`, then `rq Q_AGY=90,0,72 Q_CLAUDE=10,92,72`, then `rq Q_CLAUDE=90,0,72 Q_GROK=95,72`.
   - **Expected:** `grok-4.6 xhigh grok`, then `claude-opus-5 high claude`, then `grok-4.6 xhigh grok`, each with `exit=0`. The tripped account had the highest binding each time.

6. Run `rq Q_KIMI=0,95,2 Q_AGY=0,0,72`, then `rq Q_GROK=92,72`.
   - **Expected:** `kimi-code/kimi-for-coding-highspeed kimi`, then `grok-4.6 xhigh grok`, each with `exit=0`. Weekly windows at 95% and 92% do not trip.

7. Run `rq Q_CLAUDE=90,0,72 Q_AGY=99,0,72 Q_KIMI=100,0,72 2>/tmp/014.err; wc -c < /tmp/014.err`.
   - **Expected:** `none`, `exit=1`, then `0`.

8. Run `mkdir -p "$RX/state"; echo '{"claude-work": false}' > "$ST"; rq Q_CLAUDE=95,80,2 Q_WORK=0,80,2 Q_AGY=10,10,72; rq Q_CLAUDE=95,80,2 Q_WORK=0,80,2; rm -r "$RX/state"`.
   - **Expected:** `gemini-3.1-pro-high medium agy` with `exit=0`, then `none` with `exit=1`. Neither claude account is printed.

9. Run `rq Q_CLAUDE=0,86,2 Q_AGY=0,0,72`, then `live NO_COLOR=1 A=--once Q_WORK=100,72,5.35 | head -1`.
   - **Expected:** `claude-opus-5 max claude` with `exit=0`, as in 012. Then a line starting `DANDELION`.

10. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa; git diff --stat f543798 -- 'qa/0[01]*.e2e.mjs'; grep -n '90%\|trip' README.md`.
    - **Expected:** exits 0, and every `*.e2e.mjs` prints PASS, including `014-route-session-trip.e2e.mjs`. `pgrep` and `git diff` print nothing. The Route section says that a rolling window (claude session, kimi 5h, agy Five Hour Limit) at 90% or more trips the account for both rules, that weekly windows do not trip, and that this is the same trip `route --high` uses.

11. Run `rm -f /tmp/014.err`, then the clean-up in step 13 of 012.
    - **Expected:** nothing is left in `/tmp` from this procedure.
