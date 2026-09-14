# QA Procedure: 008 - Work claude account

After 008, every earlier procedure shows a `claude-work` panel right after `claude`, and the claude caption reads `claude · personal · claude` instead of `claude code · claude`. In `qa/007-live-refresh.md` the fleet has 3 more windows. With `$SUM` both claude panels show the `$SUM` transcript, so steps 5 and 10 there read `4/14` instead of `2/11`.

Set up once in the repo root, in a real terminal. First run the set-up blocks of `qa/002-claude-agy.md` to `qa/007-live-refresh.md`, so `$FX`, `$NODEBIN`, `$NPM` and `lv` exist. Then replace the `claude` fixture with one that logs `CLAUDE_CONFIG_DIR` (`-` when unset) to `$FX/claude.calls`. It prints the work transcript when that variable is set, and the 002 personal transcript otherwise. Finally create the work config dir `$WD`.

```bash
unset CLAUDE_CONFIG_DIR; export WD="$(mktemp -d)" ALLOWANCE_CLAUDE_WORK_CONFIG_DIR
ALLOWANCE_CLAUDE_WORK_CONFIG_DIR="$WD"
cat > "$FX/claude" <<EOF
#!/bin/sh
echo "\${CLAUDE_CONFIG_DIR:--}" >> "$FX/claude.calls"
if [ -n "\$CLAUDE_CONFIG_DIR" ]; then
printf '%s\n' 'Current session: 0% used · resets Sep 13, 11:10pm (Europe/London)' 'Current week (all models): 12% used · resets Sep 15, 6pm (Europe/London)' 'Current week (Fable): 23% used · resets Sep 15, 6pm (Europe/London)'
else
printf '%s\n' 'Current session: 3% used · resets Sep 13, 7:40pm (Europe/London)' 'Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)' 'Current week (Fable): 100% used · resets Sep 13, 11pm (Europe/London)'
fi
EOF
chmod +x "$FX/claude"
```

1. Run `node qa/e2e.mjs; pgrep -fa allowance-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including `008-claude-work.e2e.mjs`. `pgrep` prints nothing.

2. Run `rm -f "$FX/claude.calls"; NO_COLOR=1 lv --once | tee /tmp/008.txt; awk 'length>72' /tmp/008.txt; cat "$FX/claude.calls"`.
   - **Expected:** `exit=0`. The panels are `claude`, `claude-work`, `agy`, `kimi`, `grok`, `codex`, `cursor`, `kilo`, in that order. The claude panel shows `weekly` at ` 86%` above the caption `claude · personal · claude`. The claude-work panel shows `session` at `  0%` with an empty gauge, `weekly` as `##------------------  12%`, `weekly Fable` as `#####---------------  23%`, and then the caption `claude · work · claude-work`. Each of these rows ends in `↻ ` and a countdown. The other panels match step 2 of `qa/006-cursor.md`. `awk` prints nothing. `claude.calls` has exactly two lines, `-` and the `$WD` path, in either order.

3. Run `lv --once`.
   - **Expected:** all three claude-work gauges are the calm colour, the same as claude's `session` gauge. Claude's `weekly` and `weekly Fable` keep their hot and critical colours. Both claude captions are grey.

4. Run `rm -f "$FX/claude.calls"; ALLOWANCE_CLAUDE_WORK_CONFIG_DIR="$WD-missing" NO_COLOR=1 lv --once; cat "$FX/claude.calls"`.
   - **Expected:** `exit=0`. The claude-work panel is dim with no gauge, the reason `no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude` and the caption `claude · work · claude-work`. The claude panel is the same as in step 2. `claude.calls` has the single line `-`.

5. Run `H="$(mktemp -d)"; rm -f "$FX/claude.calls"; HOME="$H" ALLOWANCE_CLAUDE_WORK_CONFIG_DIR= NO_COLOR=1 lv --once | grep -A1 '^claude-work$'; mkdir "$H/.claude-work"; HOME="$H" ALLOWANCE_CLAUDE_WORK_CONFIG_DIR= NO_COLOR=1 lv --once | grep -A1 '^claude-work$'; cat "$FX/claude.calls"`.
   - **Expected:** the first run prints `claude-work` and then the `no work claude config — …` reason. The second run prints `claude-work` and then a `session` row. `claude.calls` holds `-`, `-` and `$H/.claude-work` (the last two in either order).

6. Run `NO_COLOR=1 lv`, wait for every panel to settle, then press `q`.
   - **Expected:** the first frame shows eight `probing…` panels in the step 2 order. After they settle, line 2 starts with `2/14 windows above 80% · next reset: `. Pressing `q` restores the terminal and prints `exit=0`.

7. Run `grep -n "claude-work\|ALLOWANCE_CLAUDE_WORK_CONFIG_DIR\|eight probes" README.md; grep -c '"dependencies"' package.json; rm -rf "$WD" "$H" /tmp/008.txt`.
   - **Expected:** README lists `claude-work` after `claude`, says "All eight probes run in parallel", and lists `ALLOWANCE_CLAUDE_WORK_CONFIG_DIR` with default `~/.claude-work`. The count is `0`.
