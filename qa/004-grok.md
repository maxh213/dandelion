# QA Procedure: 004 - Grok window

After 004, a `grok` panel sits between `kimi` and `kilo` in every earlier procedure. If `ALLOWANCE_GROK_HOME` is unset, it shows your real `~/.grok` snapshot, or the dim reason `no grok billing snapshot — run grok once` if there is none. Step 9 below replaces step 13 of `qa/003-kimi.md`.

Set up once in the repo root (bash, GNU `date`). First run the set-up blocks of `qa/002-claude-agy.md` and `qa/003-kimi.md`, so `$FX`, `$NODEDIR`, `$KP` and `run` exist. `ev PCT AGE TIER` prints one billing event: `ts` is `AGE` ago and `end` is 11h15m from now. `log` writes a fixture log to `$GH`. `snap` fingerprints grok home.

```bash
export GH="$(mktemp -d)"; echo ok > "$FX/mode"
ev() { printf '{"ts":"%s","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":%s,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"2026-09-06T21:15:36.133376+00:00","end":"%s"}},"subscriptionTier":"%s"}}\n' \
  "$(date -u -d "-$2" +%Y-%m-%dT%H:%M:%S.000Z)" "$1" "$(date -u -d '+11 hours +15 minutes' +%Y-%m-%dT%H:%M:%S.133376+00:00)" "$3"; }
log() { mkdir -p "$GH/logs"; { echo '{"ts":"2026-09-11T08:00:00Z","msg":"session started","ctx":{}}'; ev 60 '30 hours' SuperGrok; echo 'not json at all'; ev 75 "$1" 'SuperGrok Heavy'; echo '{"msg":"tool call finished","ctx":{}}'; } > "$GH/logs/unified.jsonl"; }
snap() { find "$GH" -printf '%p %s %T@ %m\n' | sort; find "$GH" -type f -exec md5sum {} + 2>/dev/null | sort; }
grok() { PATH="$FX:$NODEDIR" ALLOWANCE_KIMI_PORT=$KP ALLOWANCE_GROK_HOME="$GH" NO_COLOR=1 npm start --silent; echo "exit=$?"; }
```

1. Run `node qa/e2e.mjs; pgrep -fa allowance-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including 001, 002, 003 and the new `004-grok.e2e.mjs`. `pgrep` prints nothing.

2. Run `log '1 hour'; grok`.
   - **Expected:** `exit=0`. The panels appear in the order `claude`, `agy`, `kimi`, `grok`, `kilo`. The grok panel is the rule, `grok`, `credits                             ###############-----  75% ↻ 11h15m` (or `↻ 11h14m`), `snapshot 1h0m old` (or `1h1m`), then `SuperGrok Heavy · grok`. 75%, not the older 60%, proves the newest event wins. No line is over 72 columns.

3. Run the step 2 command without `NO_COLOR=1`.
   - **Expected:** the grok gauge and `75%` are the warm colour. The snapshot line and the caption are dim.

4. Run `log '47 hours'; grok`.
   - **Expected:** the snapshot line reads `snapshot 1d23h old`, with no `stale`.

5. Run `log '3 days'; grok`, then run it again without `NO_COLOR=1`.
   - **Expected:** the line under the row reads `stale snapshot 3d0h old`, and the `credits` row still shows 75%. In colour, the whole grok panel (rule, name, row, snapshot line, caption) is dim grey and the gauge has no warm colour. The other panels keep their colours.

6. Run `ev 33.5 '1 hour' '' > "$GH/logs/unified.jsonl"; echo '{"ts":"x","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":99}}}' >> "$GH/logs/unified.jsonl"; grok`.
   - **Expected:** `exit=0`. The grok row shows `#######-------------  34%`, and the caption is `grok · grok` because the tier is empty. The later event with the bad `ts` is skipped, so `99%` does not appear.

7. For each of these, run it and then `grok`: `rm -rf "$GH"/*`; `mkdir -p "$GH/logs"; : > "$GH/logs/unified.jsonl"`; `echo 'not json' > "$GH/logs/unified.jsonl"; chmod 000 "$GH/logs/unified.jsonl"`; `rm -rf "$GH/logs"; mkdir -p "$GH/logs/unified.jsonl"`.
   - **Expected:** each run exits 0 within 5s. The grok panel is dim, shows no gauge and no snapshot line, and reads `grok`, `no grok billing snapshot — run grok once`, `grok · grok`. Kimi and kilo render normally around it. Run `chmod -R u+rwx "$GH"` afterwards.

8. Run `rm -rf "$GH"/*; log '1 hour'; snap > /tmp/g1; grok >/dev/null; snap > /tmp/g2; diff /tmp/g1 /tmp/g2 && echo SAME`.
   - **Expected:** prints `SAME`, so the app changed nothing under grok home. Repeat with an empty `$GH` for the same result.

9. Run `PATH="$(mktemp -d):$NODEDIR" ALLOWANCE_GROK_HOME="$(mktemp -d)" npm start; echo "exit=$?"`.
   - **Expected:** `exit=0`. Five dim panels appear in the order claude, agy, kimi, grok, kilo. The reasons are `claude CLI not found in PATH`, `agy CLI not found in PATH`, `kimi CLI not found in PATH`, `no grok billing snapshot — run grok once` and `kilo CLI not found in PATH`.

10. Run `rm -rf "$GH"/* /tmp/gh-home; log '1 hour'; mkdir -p /tmp/gh-home; cp -r "$GH" /tmp/gh-home/.grok; HOME=/tmp/gh-home PATH="$FX:$NODEDIR" ALLOWANCE_KIMI_PORT=$KP NO_COLOR=1 npm start --silent`.
    - **Expected:** with `ALLOWANCE_GROK_HOME` unset, the grok panel still shows `75%` and `SuperGrok Heavy · grok`, read from `$HOME/.grok`. The same happens with `ALLOWANCE_GROK_HOME=` (empty).
