# QA Procedure: 007 - Live dashboard

After 007, every earlier procedure's `npm start` / `"$NPM" start` means `"$NPM" start --silent -- --once`. Their expected output is unchanged.

Set up once in the repo root, in a real terminal (bash). First run the set-up blocks of `qa/002-claude-agy.md` to `qa/006-cursor.md`, so `$FX`, `$NODEBIN`, `$NPM`, `$KP`, `$GH` and `$CF` exist. Then start the cursor fixture, add a slow `kilo` in `$SLOW`, and define `lv`, which runs the app against all fixtures. Extra arguments go after `--`.

```bash
unset NO_COLOR; echo ok > "$FX/mode"; CF="$CF" CURSOR_FIXTURE_MODE=ok node "$CF/server.mjs" & sleep 0.5
export SLOW="$(mktemp -d)"; printf '#!/usr/bin/env node\nsetTimeout(() => console.log("Balance: $14.15"), 60000);\n' > "$SLOW/kilo"; chmod +x "$SLOW/kilo"
lv() { rm -f "$FX/codex.calls"; env CODEX_FIXTURE_MODE=apikey PATH="${PRE:+$PRE:}$FX:$NODEBIN" ALLOWANCE_KIMI_PORT=$KP ALLOWANCE_GROK_HOME="$GH" ALLOWANCE_CURSOR_AUTH_FILE="$CF/auth.json" ALLOWANCE_CURSOR_API_BASE=http://127.0.0.1:48006 "$NPM" start --silent -- "$@"; echo "exit=$?"; }
```

1. Run `node qa/e2e.mjs; pgrep -fa allowance-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including `007-live-refresh.e2e.mjs` and `007-slow-probe.e2e.mjs`. `pgrep` prints nothing.

2. Run `NO_COLOR=1 lv --once`.
   - **Expected:** `exit=0`. The banner and seven panels print inline exactly as in step 2 of `qa/006-cursor.md`. No summary line, no `probing…`, and the screen does not clear.

3. Run `NO_COLOR=1 lv | cat`, then `NO_COLOR=1 lv < /dev/null`.
   - **Expected:** each prints the same output as step 2 and `exit=0` right away, without waiting for input.

4. Run `echo ok > "$FX/mode"; ALLOWANCE_REFRESH_SECONDS=10 lv`.
   - **Expected:** the screen switches to a blank alternate screen and the cursor disappears. Seven dim panels spin (`⠋⠙⠹…`) with `probing…`, in order claude, agy, kimi, grok, codex, cursor, kilo. Each fills in on its own. Once all have settled, line 2 reads `2/13 windows above 80% · next reset: <provider> <window> in <countdown>`, and that countdown is the smallest `↻` on screen. The banner ends in `data 0hNm old · HH:MM:SSZ`, and the clock ticks.

5. Keep watching for 15 seconds.
   - **Expected:** about 10s after the last panel settled, the banner shows a dim `refreshing… · `. No panel goes back to `probing…` or blanks. The marker disappears when the round ends.

6. Press `?`, then `?` again.
   - **Expected:** a dim last line `keys: r refresh · q quit · ? help` appears, then disappears.

7. Right after a round ends, press `r` twice quickly. In a second terminal, run `wc -l < "$FX/codex.calls"` before and after.
   - **Expected:** `refreshing…` appears at once. The count goes up by exactly 1. Pressing `x` or `R` does nothing.

8. Press `q`.
   - **Expected:** the original shell screen and its scrollback come back, the cursor is visible, and `exit=0` prints. Typing echoes normally, so `stty -a | grep -c -- -icanon` prints `0`.

9. Run `lv` again and press Ctrl-C once all panels have settled.
   - **Expected:** the same as step 8, with `exit=0`.

10. Run `PRE="$SLOW" NO_COLOR=1 lv`.
    - **Expected:** within 5s, every panel except kilo shows its data, and kilo still spins `probing…`. After 20 to 25s, kilo turns dim with `Command timed out after 20s` and `api balance · kilo`. Press `q` for `exit=0`.

11. Run `time PRE="$SLOW" NO_COLOR=1 lv --once`.
    - **Expected:** `exit=0` after 20 to 30s real time. The kilo panel shows `Command timed out after 20s`, and the other six are as in step 2.

12. Run `echo silent > "$FX/mode"; rm -f "$FX/kimi.pid"; lv`. Within 3s, while kimi shows `probing…`, press `q`. Then run `kill -0 "$(cat "$FX/kimi.pid")" 2>/dev/null && echo ALIVE || echo GONE; pgrep -fa "$FX/kimi"; echo ok > "$FX/mode"`.
    - **Expected:** `exit=0` within 7s of pressing `q`. `GONE` prints, and `pgrep` prints nothing.

13. Run `ALLOWANCE_REFRESH_SECONDS=abc lv` and watch for 20s after all panels settle, then press `q`.
    - **Expected:** no `refreshing…` appears, because the interval falls back to 300s. `exit=0`.

14. Run `grep -n "ALLOWANCE_REFRESH_SECONDS\|--once" README.md; grep -c '"dependencies"' package.json; pkill -f "$CF/server.mjs"`.
    - **Expected:** README lists `npm start -- --once` and `ALLOWANCE_REFRESH_SECONDS` (default `300`). The count is `0`.
