# QA Procedure: 011 - Route eligibility toggle

Earlier procedures are unchanged by 011, except that the live help footer now reads `keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help`.

Set up once in the repo root, in a real terminal. First run the set-up block of `qa/010-route-command.md`, so `$RX`, `$RH`, `$TZQ`, the `q` fixture and `rt` exist. `$ST` is the state file. `lv VAR=value…` runs the live dashboard with `rt`'s env and the state file. `once VAR=value…` runs `--once`.

```bash
export ST="$RX/state/eligibility.json"
lv() { rt A= NO_COLOR=1 TERM="$TERM" DANDELION_STATE_FILE="$ST" "$@"; }
once() { rt A=--once NO_COLOR=1 DANDELION_STATE_FILE="$ST" "$@"; }
```

1. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including `011-route-eligibility-toggle.e2e.mjs`. `pgrep` prints nothing.

2. Run `rt DANDELION_STATE_FILE="$ST" Q_CLAUDE=0,86,2 Q_AGY=0,0,72; ls "$RX/state"`.
   - **Expected:** `claude-opus-5 max`, `exit=0`, then `ls` says there is no such directory: route never creates the state file.

3. Run `mkdir -p "$RX/state"; echo '{"claude": false}' > "$ST"`, then run step 2's `rt` again. Then run `rm "$ST"` and run it once more.
   - **Expected:** `gemini-3.1-pro-high medium` with `exit=0`, even though claude's weekly would evaporate. After the removal, `claude-opus-5 max` with `exit=0`.

4. Run `echo '{"claude-work": false, "nope": 1}' > "$ST"; rt DANDELION_STATE_FILE="$ST" Q_CLAUDE=20,30,72 Q_WORK=10,5,72 Q_AGY=15,20,72`.
   - **Expected:** `gemini-3.1-pro-high medium`, `exit=0`. Without the file, 010 gave `claude-opus-5 high`.

5. Run `echo '{"claude": false}' > "$ST"; rt DANDELION_STATE_FILE="$ST" Q_CLAUDE=0,86,2`.
   - **Expected:** `none`, `exit=1`.

6. Run `printf '{not json' > "$ST"; rt DANDELION_STATE_FILE="$ST" Q_CLAUDE=0,86,2 Q_AGY=0,0,72; once Q_CLAUDE=0,86,2 | grep -c 'routing off'`.
   - **Expected:** `claude-opus-5 max`, `exit=0`. Then `0`: a corrupt file means everything is eligible, with no error printed.

7. Run `mkdir -p "$RX/xdg/dandelion" "$RH/.local/state/dandelion"; echo '{"claude": false}' | tee "$RX/xdg/dandelion/eligibility.json" > "$RH/.local/state/dandelion/eligibility.json"; rt XDG_STATE_HOME="$RX/xdg" Q_CLAUDE=0,86,2 Q_AGY=0,0,72; rm "$RX/xdg/dandelion/eligibility.json"; rt Q_CLAUDE=0,86,2 Q_AGY=0,0,72; rm -r "$RH/.local"`.
   - **Expected:** `gemini-3.1-pro-high medium` twice, each with `exit=0`: first from the XDG path, then from the `~/.local/state` default.

8. Run `echo '{"claude": false}' > "$ST"; M=$(stat -c %Y "$ST"); sleep 1; once Q_CLAUDE=0,86,2 | grep -B1 -A1 'routing off'; [ "$(stat -c %Y "$ST")" = "$M" ] && echo untouched`.
   - **Expected:** the line under the claude rule is `claude`, spaces, then `routing off` ending at column 72. The claude rows are unchanged, and no `▸` appears. `exit=0`, then `untouched`.

9. Run `rm -rf "$RX/state"; lv Q_CLAUDE=0,86,2 Q_AGY=0,0,72`. Once every panel settles, press `?`, then `j`.
   - **Expected:** the footer is `keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help`. After `j`, claude's header reads `▸ claude` and no other panel has `▸`.

10. Press space. In a second terminal, run `cat "$RX/state/eligibility.json"; ls -A "$RX/state"` (first `export RX=<the value from terminal 1>`). Back in the dashboard, press space again, then run the same commands.
    - **Expected:** the claude header gets `routing off` at the right edge at once, and the claude rows and summary stay the same. The file reads `{ "claude": false }` over three lines, and `ls` shows only `eligibility.json`. After the second space, the tag is gone and the file holds `"claude": true`.

11. Press space once more so claude is off, then `q`. Run `rt DANDELION_STATE_FILE="$ST" Q_CLAUDE=0,86,2 Q_AGY=0,0,72`, then `lv Q_CLAUDE=0,86,2 Q_AGY=0,0,72` and wait for it to settle.
    - **Expected:** `exit=0`, then `gemini-3.1-pro-high medium`. The new dashboard shows claude with `routing off` and no `▸` anywhere: the choice survived the restart.

12. In the same dashboard, press `k`, then space. Then press `k` twice more, so codex is selected, and press space.
    - **Expected:** `k` selects kilo. Its caption line reads `not routable (no usage windows)` for 2 to 3 seconds, then `api balance · kilo` again. codex does the same and returns to `codex · codex`. In the second terminal, the file still holds only `"claude": false`.

13. Press Down repeatedly past kilo, then Up and `k` past claude.
    - **Expected:** the `▸` stops on kilo, then stops on claude, and never wraps. Press `q`, and `exit=0` prints.

14. Run `rt A= TERM="$TERM" DANDELION_STATE_FILE="$ST" Q_CLAUDE=0,86,2 Q_AGY=0,0,72` and press `j` once it settles, then `q`.
    - **Expected:** claude's rule is bright/bold, while every other rule is grey. `routing off` is grey, and `▸ claude` is in normal text.

15. Run `lv DANDELION_STATE_FILE="$RX/q/eligibility.json" Q_CLAUDE=0,86,2`. Once it settles, press `j`, then space, then `q`.
    - **Expected:** claude's caption reads `routing state not saved` for 2 to 3 seconds, and no `routing off` tag appears. The dashboard keeps running, and `q` prints `exit=0`.

16. Run `grep -n 'DANDELION_STATE_FILE\|eligib\|space' README.md; rm -rf "$RX/state" "$RX/xdg"`, then run the 010 clean-up in its step 10.
    - **Expected:** the ledger lists `DANDELION_STATE_FILE` with both defaults. Run Commands list the select and routing keys. The Route section has the eligibility paragraph.
