# QA Procedure: 015 - Junie credits panel and route line

After 015, a `junie` panel sits between `cursor` and `kilo` in every earlier procedure. Where junie home has no snapshot it is dim with the reason `no junie quota snapshot — run junie once`. The task's `grok-4.6 grok` is written `grok-4.6 xhigh grok` here, as grok routes since commit a81d626.

Set up once in the repo root, in a real terminal (bash, GNU tools). First run the set-up blocks of `qa/010-route-command.md`, `qa/011-route-eligibility-toggle.md` and `qa/014-route-session-trip.md`, so `$RX`, `$ST`, `rt`, `rq` and `live` exist. `jh DIR BAL` writes a junie home: an older session with a snapshot of `900000` credits 3 hours ago, and a newer one with noise, an `Unknown` completion, a bad line and the `BAL` snapshot 1 hour ago. `snap` fingerprints a tree.

```bash
export JH="$RX/junie" JE="$RX/junie-empty"; mkdir -p "$JE"
jl() { printf '{"kind":"SessionA2uxEvent","event":{"state":"IN_PROGRESS"},"completion":{"endedAtMs":%s,"taskCostUsd":0.03,"quota":{"type":"com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.%s","balanceUnit":"CREDITS","balanceLeft":%s}},"timestampMs":%s}\n' "$1" "$2" "$3" "$1"; }
jh() { local d="$1" now=$(date +%s%3N); rm -rf "$d"; mkdir -p "$d/sessions/s-old" "$d/sessions/s-new"
  printf '{"sessionId":"s-old","createdAt":%s,"updatedAt":%s,"status":"Sending LLM request"}\nnot json at all\n{"sessionId":"s-new","createdAt":%s,"updatedAt":%s,"taskName":"Pong"}\n' $((now-11000000)) $((now-10000000)) $((now-4000000)) $((now-3000000)) > "$d/sessions/index.jsonl"
  jl $((now-10800000)) JetBrains 900000 > "$d/sessions/s-old/events.jsonl"
  { echo '{"kind":"SessionA2uxEvent","event":{"state":"IN_PROGRESS"},"timestampMs":1}'; echo '{"kind":"Other"}'
    printf '{"completion":{"endedAtMs":%s,"quota":{"type":"com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.Unknown"}}}\n' $((now-3700000))
    echo 'not json at all'; jl $((now-3600000)) JetBrains "$2"; } > "$d/sessions/s-new/events.jsonl"; }
snap() { find "$1" -printf '%p %s %T@ %m\n' | sort; find "$1" -type f -exec md5sum {} + | sort; }
jh "$JH" 701512.73275
```

1. Run `snap "$JH" > /tmp/j1; rt NO_COLOR=1 A=--once DANDELION_JUNIE_HOME="$JH" Q_CLAUDE=0,20,72 Q_GROK=9,130; snap "$JH" > /tmp/j2; diff /tmp/j1 /tmp/j2 && echo SAME`.
   - **Expected:** `exit=0`. Panels appear in the order claude, claude-work, agy, kimi, grok, codex, cursor, junie, kilo. The junie panel is the rule, `junie`, `credits                             ######--------------  30%` with no `↻` countdown, `snapshot 1h0m old` (or `1h1m`), then `701513 credits · junie`. 30%, not 10%, proves the newest session wins. No line is over 72 columns. Then `SAME`.

2. Run the step 1 `rt` command without `NO_COLOR=1`.
   - **Expected:** the junie gauge and `30%` are calm (green); the snapshot line and caption are dim.

3. Run `rt NO_COLOR=1 A=--once DANDELION_JUNIE_HOME="$JH" DANDELION_JUNIE_REFERENCE=`, then the same with `DANDELION_JUNIE_REFERENCE=abc`, then with `DANDELION_JUNIE_REFERENCE=2000000`.
   - **Expected:** first the junie panel reads `balance without a reference`, `snapshot 1h0m old`, `701513 credits · junie` with no gauge. Then `credits` at `30%` (bad value uses the default). Then `credits` at `65%`.

4. Run `jh "$JH" 1000000; rt NO_COLOR=1 A=--once DANDELION_JUNIE_HOME="$JH"`, then `jh "$JH" 0` and the same `rt`, then `jh "$JH" 701512.73275`.
   - **Expected:** `0%` with caption `1000000 credits · junie`, then `100%` with caption `0 credits · junie`.

5. Run `sed -i '$d' "$JH/sessions/s-new/events.jsonl"; rt NO_COLOR=1 A=--once DANDELION_JUNIE_HOME="$JH"; jh "$JH" 701512.73275`.
   - **Expected:** with the newer session's only snapshot removed, the panel falls back to the older session: `10%`, `snapshot 3h0m old` (or `3h1m`), `900000 credits · junie`.

6. Run `sed -i "s/\"endedAtMs\":[0-9]*/\"endedAtMs\":$(( $(date +%s%3N) - 259200000 ))/" "$JH/sessions/s-new/events.jsonl"; rt NO_COLOR=1 A=--once DANDELION_JUNIE_HOME="$JH"`, then the same `rt` without `NO_COLOR=1`; then `jh "$JH" 701512.73275`.
   - **Expected:** the line under the row reads `stale snapshot 3d0h old`, the row still shows `30%`. In colour the whole junie panel is dim and the gauge has no green.

7. Run `snap "$JE" > /tmp/j1; rt NO_COLOR=1 A=--once DANDELION_JUNIE_HOME="$JE"; snap "$JE" > /tmp/j2; diff /tmp/j1 /tmp/j2 && echo SAME`, then the `rt` with `DANDELION_JUNIE_HOME="$RX/nowhere"`.
   - **Expected:** each exits 0 within 5s. The junie panel is dim with no gauge and no snapshot line and reads `junie`, `no junie quota snapshot — run junie once`, `junie · junie`. The other panels render around it. `SAME` is printed.

8. Run `rt Q_GROK=50,72 DANDELION_JUNIE_HOME="$JH"`, then `rt Q_GROK=50,72 DANDELION_JUNIE_HOME="$JH" DANDELION_JUNIE_REFERENCE=`, then `rt DANDELION_JUNIE_HOME="$JH" DANDELION_JUNIE_REFERENCE=`.
   - **Expected:** `gemini-3.8-flash high junie` (70 left beats 50), then `grok-4.6 xhigh grok` (junie not routable), each with `exit=0`. Then `none`, `exit=1`.

9. Run `live Q_WORK=100,72,5.35 DANDELION_JUNIE_HOME="$JH"`, then `jh "$JH" 1000000` and the same `live`, then that `live` with `DANDELION_JUNIE_REFERENCE=`.
   - **Expected:** `grok-4.6 xhigh grok` (91 beats 70), then `gemini-3.8-flash high junie` (100 left), then `grok-4.6 xhigh grok`, each with `exit=0`.

10. Run `mkdir -p "$RX/state"; echo '{"junie": false}' > "$ST"; live Q_WORK=100,72,5.35 DANDELION_JUNIE_HOME="$JH"; rm -r "$RX/state"`, then `live A='route --high' Q_WORK=100,72,5.35 DANDELION_JUNIE_HOME="$JH"`, then `rt A='route --high' DANDELION_JUNIE_HOME="$JH"`.
    - **Expected:** `grok-4.6 xhigh grok` with `exit=0` (junie skipped), then `claude-fable-5-1 max claude` with `exit=0`, then `none` with `exit=1`: `--high` never uses junie.

11. Run `mkdir -p "$RX/state"; rq A= DANDELION_JUNIE_HOME="$JH" Q_GROK=9,130`. Select the junie panel with `j`, press space, then `q`. Run `cat "$ST"`. Run it again with `DANDELION_JUNIE_REFERENCE=` added, select junie, press space, `q`, then `rm -r "$RX/state"`.
    - **Expected:** first the junie panel shows `routing off`, the route box shows `grok-4.6 xhigh grok`, and the file holds `"junie": false`. The second time the junie caption flashes `not routable (no usage windows)` for about 2s and the route box does not change.

12. Run `jh "$JH" 150000; rq A= NO_COLOR=1 DANDELION_JUNIE_HOME="$JH"`, look at the fleet summary line, press `q`. Run it again with `DANDELION_JUNIE_REFERENCE=` added, then `jh "$JH" 701512.73275`.
    - **Expected:** only junie is available. First junie shows `credits` at `85%` and the summary line reads exactly `1/1 windows above 80% · next reset: none`. The second time it reads exactly `all windows below 80% · next reset: none`.

13. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa; grep -n 'junie\|JUNIE' README.md`.
    - **Expected:** exits 0 and every `*.e2e.mjs` prints PASS, including the 015 junie e2es. `pgrep` prints nothing. README has the junie provider bullet, "All nine probes run in parallel", both ledger entries, the route table row `gemini-3.8-flash high`, `junie credits` among weekly windows, and says `--high` does not use junie.

14. Run `rm -f /tmp/j1 /tmp/j2`, then the clean-up of `qa/014-route-session-trip.md`.
    - **Expected:** nothing is left in `/tmp` from this procedure.
