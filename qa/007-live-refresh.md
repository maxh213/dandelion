# QA Procedure: 007 - Live dashboard

After 007, every earlier procedure's `npm start` / `"$NPM" start` means `"$NPM" start --silent -- --once`. Their expected output is unchanged.

Set up once in the repo root, in a real terminal (bash, util-linux `script`). First run the set-up blocks of `qa/002-claude-agy.md` to `qa/006-cursor.md`, so `$FX`, `$NODEBIN`, `$NPM`, `$KP`, `$GH` and `$CF` exist. Then start the cursor fixture and add two override dirs. `$SLOW` holds a `kilo` that waits 60s. `$SK` holds a `kimi` that waits 3s and then runs the 003 fixture. Finally define `lv`, which runs the app against all fixtures. Put an override dir in `PRE` to use it, and put extra arguments after `--`.

```bash
unset NO_COLOR; echo ok > "$FX/mode"; CF="$CF" CURSOR_FIXTURE_MODE=ok node "$CF/server.mjs" & sleep 0.5
export SLOW="$(mktemp -d)"; printf '#!/usr/bin/env node\nsetTimeout(() => console.log("Balance: $14.15"), 60000);\n' > "$SLOW/kilo"; chmod +x "$SLOW/kilo"
export SK="$(mktemp -d)"; printf '#!/usr/bin/env node\nsetTimeout(() => require("%s"), 3000);\n' "$FX/kimi" > "$SK/kimi"; chmod +x "$SK/kimi"
export FX NODEBIN NPM KP GH CF; export CAP="$(mktemp)"
lv() { rm -f "$FX/codex.calls"; env CODEX_FIXTURE_MODE=apikey PATH="${PRE:+$PRE:}$FX:$NODEBIN" ALLOWANCE_KIMI_PORT=$KP ALLOWANCE_GROK_HOME="$GH" ALLOWANCE_CURSOR_AUTH_FILE="$CF/auth.json" ALLOWANCE_CURSOR_API_BASE=http://127.0.0.1:48006 "$NPM" start --silent -- "$@"; echo "exit=$?"; }; export -f lv
```

1. Run `node qa/e2e.mjs; pgrep -fa allowance-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including `007-live-refresh.e2e.mjs` and `007-slow-probe.e2e.mjs`. `pgrep` prints nothing.

2. Run `NO_COLOR=1 lv --once`.
   - **Expected:** `exit=0`. The banner and seven panels print inline exactly as in step 2 of `qa/006-cursor.md`. There is no summary line and no `probing…`, and the screen does not clear.

3. Run `NO_COLOR=1 lv | cat`, then `NO_COLOR=1 lv < /dev/null`.
   - **Expected:** each prints the same output as step 2 and then `exit=0` right away, without waiting for input.

4. Run `PRE="$SK" NO_COLOR=1 ALLOWANCE_REFRESH_SECONDS=300 lv`.
   - **Expected:** a blank alternate screen appears and the cursor hides. The first frame shows seven pending panels in order claude, agy, kimi, grok, codex, cursor, kilo. Each is a `=` rule, the id, and a spinning `⠋⠙⠹…` with `probing…`. Within 1s every panel except kimi shows its data, while kimi keeps spinning. About 3s in, kimi shows `weekly` 59% and `5h` 42%, and nothing else on screen changes.

5. Keep watching the same run for 70 seconds without pressing anything.
   - **Expected:** line 2 reads `2/13 windows above 80% · next reset: claude session in <countdown>`. That countdown equals the `↻` on claude's `session` row. The banner ends in `data 0h0m old · HH:MM:SSZ`. The clock advances every second. After about 60s the banner shows `data 0h1m old`, and every `↻` in minutes, including the summary's, has dropped by 1m. No `refreshing…` appears.

6. In a second terminal, run `grep -c '^login' "$FX/codex.calls"`. Back in the dashboard, press `r` twice quickly, then wait 5s and run the same `grep` again.
   - **Expected:** the first count is `1`. `refreshing… · ` appears in the banner at once, while kimi keeps its rows and nothing shows `probing…`. The marker is gone after about 3s. The second count is `2`.

7. Press `?`, then `?` again, then `x`, `R` and Enter.
   - **Expected:** a last line `keys: r refresh · q quit · ? help` appears, then disappears. `x`, `R` and Enter change nothing, and the grep from step 6 still prints `2`.

8. Press `q`.
   - **Expected:** the original shell screen and its scrollback come back, the cursor is visible, and `exit=0` prints. Typing echoes normally, and `stty -a | grep -c -- -icanon` prints `0`.

9. Run `ALLOWANCE_REFRESH_SECONDS=10 lv` and watch for 15s after the last panel settles.
   - **Expected:** about 10s after the last panel settled, the banner shows `refreshing… · `. No panel goes back to `probing…` or blanks. The marker disappears when the round ends. Then press Ctrl-C. The result is the same as step 8, with `exit=0`.

10. Run `PRE="$SK" ALLOWANCE_REFRESH_SECONDS=4 script -qfc 'lv' "$CAP"`. Press `?` right away. Wait about 10s, until `refreshing…` has shown at least once, then press `q`. Now run:
    `for s in $'⠋ probing…\e[0m' $'\e[90mkeys: r refresh · q quit · ? help\e[0m' $'\e[90m2/13 windows above 80% · next reset: claude session in ' $'\e[0m\e[90mrefreshing…\e[0m\e[1m · data 0h0m old · ' $'\e[?25h\e[?1049l'; do grep -aFc "$s" "$CAP"; done`
    - **Expected:** on screen the spinner, summary, footer and `refreshing…` are grey, the banner text is bold, and the gauges have their ramp colours. `exit=0` is printed. Every one of the five counts is at least `1`.

11. Run `PRE="$SLOW" NO_COLOR=1 lv`.
    - **Expected:** within 5s, every panel except kilo shows its data, and kilo still spins `probing…`. After 20 to 25s, kilo turns dim with `Command timed out after 20s` and `api balance · kilo`. Press `q` and `exit=0` prints.

12. Run `time PRE="$SLOW" NO_COLOR=1 lv --once`.
    - **Expected:** `exit=0` after 20 to 30s real time. The kilo panel shows `Command timed out after 20s`, and the other six panels are as in step 2.

13. Run `echo silent > "$FX/mode"; rm -f "$FX/kimi.pid"; lv`. Within 3s, while kimi shows `probing…`, press `q`. Then run `kill -0 "$(cat "$FX/kimi.pid")" 2>/dev/null && echo ALIVE || echo GONE; pgrep -fa "$FX/kimi"; echo ok > "$FX/mode"`.
    - **Expected:** `exit=0` prints within 7s of pressing `q`. `GONE` prints, and `pgrep` prints nothing.

14. Run `ALLOWANCE_REFRESH_SECONDS=abc lv`, watch for 20s after all panels settle, then press `q`.
    - **Expected:** no `refreshing…` appears, because the interval falls back to 300s. `exit=0` prints.

15. Run `grep -n "ALLOWANCE_REFRESH_SECONDS\|--once" README.md; grep -c '"dependencies"' package.json; pkill -f "$CF/server.mjs"; rm -rf "$SLOW" "$SK" "$CAP"`.
    - **Expected:** README lists `npm start -- --once` and `ALLOWANCE_REFRESH_SECONDS` (default `300`). The count is `0`.
