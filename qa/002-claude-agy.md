# QA Procedure: 002 - Claude and agy windows

Set up once in the repo root (bash). The fixtures print the transcripts from `features/002-claude-agy.feature`. The agy dates are relative to your clock, so its countdowns are predictable.

```bash
export FX="$(mktemp -d)" NODEDIR="$(dirname "$(command -v node)")"
cat > "$FX/kilo" <<'EOF'
#!/bin/sh
echo 'Balance: $14.15'
EOF
cat > "$FX/claude" <<'EOF'
#!/bin/sh
cat <<'OUT'
Current session: 3% used · resets Sep 13, 7:40pm (Europe/London)
Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)
Current week (Fable): 100% used · resets Sep 13, 11pm (Europe/London)
OUT
EOF
cat > "$FX/agy" <<'EOF'
#!/bin/sh
W=$(date -u -d "+7 days +5 minutes" +%Y-%m-%dT%H:%M:%SZ)
H=$(date -u -d "+2 hours +5 minutes" +%Y-%m-%dT%H:%M:%SZ)
printf 'Gemini Models\tWeekly Limit Remaining\t100%%\t%s\n' "$W"
printf 'Claude and GPT models\tFive Hour Limit Remaining\t25%%\t%s\n' "$H"
EOF
chmod +x "$FX"/*
```

Countdown rule: the claude dates carry no year. Every claude row ends in `↻ ` followed by `NhNm` or `NdNh`.

1. Run `node qa/e2e.mjs`.
   - **Expected:** exits 0. `001-scaffold-kilo.e2e.mjs`, `002-readme.e2e.mjs` and `002-claude-agy.e2e.mjs` each print PASS. It finishes in under 30s because no real `claude` or `agy` runs.

2. Run `PATH="$FX:$NODEDIR" npm start`.
   - **Expected:** exits 0. The banner `ALLOWANCE … HH:MM:SSZ` comes first, then the panels `claude`, `agy` and `kilo` in that order. Each panel is a rule, the name, its rows and a dim caption. No line is over 72 columns (`PATH="$FX:$NODEDIR" npm start | awk 'length>72'` prints nothing).

3. Look at the claude panel in the step 2 output.
   - **Expected:** the caption is `claude code · claude`. The rows are `session` (`  3%`, 1 filled cell), `weekly` (` 86%`, 17 filled) and `weekly Fable` (`100%`, 20 filled). There is no "What's contributing" row.

4. Look at the agy panel.
   - **Expected:** the caption is `agy · agy`. The row `Gemini Models · Weekly Limit` shows an empty gauge, `  0%` and `↻ 7d0h`. The row `Claude and GPT models · Five Hour…` shows 15 filled cells, ` 75%` and `↻ 2h4m` or `↻ 2h5m`. The percents sit in the same column.

5. Look at the ramp colours in the step 2 output.
   - **Expected:** the gauge and percent of `session` (3%), `weekly` (86%) and `weekly Fable` (100%) are three visibly different colours. Labels and countdowns are uncoloured.

6. Run `PATH="$FX:$NODEDIR" NO_COLOR=1 npm start`.
   - **Expected:** no colour at all. The gauges use `#` and `-`. The weekly row reads `weekly                              #################---  86% ↻ …`. The kilo gauge shows 14 `#` and 6 `-`. `↻`, `·` and `…` still appear as they are.

7. Run `mv "$FX/claude" "$FX/claude.ok"; printf '#!/bin/sh\nexit 1\n' > "$FX/claude"; chmod +x "$FX/claude"; PATH="$FX:$NODEDIR" npm start; mv "$FX/claude.ok" "$FX/claude"`.
   - **Expected:** exits 0. The claude panel is dim with no gauge, the reason `Command failed or timed out` and the caption `claude code · claude`. The agy and kilo panels render normally.

8. Run `mv "$FX/agy" "$FX/agy.ok"; printf '#!/bin/sh\necho hello world\n' > "$FX/agy"; chmod +x "$FX/agy"; PATH="$FX:$NODEDIR" npm start; mv "$FX/agy.ok" "$FX/agy"`.
   - **Expected:** the agy panel is dim with the reason `Could not parse usage from output` and the caption `agy · agy`. The claude and kilo panels still render.

9. Run `PATH="$(mktemp -d):$NODEDIR" npm start`.
   - **Expected:** exits 0. Three dim panels appear in the order claude, agy, kilo, with the reasons `claude CLI not found in PATH`, `agy CLI not found in PATH` and `kilo CLI not found in PATH`.
