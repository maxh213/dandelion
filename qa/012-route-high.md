# QA Procedure: 012 - dandelion route --high

Earlier procedures are unchanged by 012, except that every `route` line now ends in a space and the provider id (for example `claude-opus-5 max claude`). `none` is unchanged.

Set up once in the repo root, in a real terminal. First run the set-up blocks of `qa/010-route-command.md` and `qa/011-route-eligibility-toggle.md`, so `$RX`, `$RH`, `$TZQ`, `$ST`, the `q` fixture and `rt` exist. Then add a claude fixture that reads `H_CLAUDE` (or `H_WORK` for the work account) as `session,allModels,fable`. A fable of `-` leaves out the Fable line, and an unset variable makes the account unavailable. `rh VAR=value…` runs `node src/main.ts route --high` with that fixture first on the PATH. Other providers use the `Q_*` variables of 010: `Q_CURSOR=pct,72`, `Q_GROK=pct,72`, `Q_AGY=rolling,weekly,72` and `Q_KIMI=rolling,weekly,72`.

```bash
mkdir -p "$RX/h"; cat > "$RX/h/claude" <<'EOF'
#!/usr/bin/env node
const v = process.env[process.env.CLAUDE_CONFIG_DIR ? 'H_WORK' : 'H_CLAUDE']; if (!v) process.exit(1);
const [s, w, f] = v.split(','), d = new Date(Date.now() + 72 * 3600000), H = d.getUTCHours();
const r = `resets ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[d.getUTCMonth()]} ${d.getUTCDate()}, ${H % 12 || 12}${H < 12 ? 'am' : 'pm'} (UTC)`;
console.log(`Current session: ${s}% used · ${r}\nCurrent week (all models): ${w}% used · ${r}` + (f === '-' ? '' : `\nCurrent week (Fable): ${f}% used · ${r}`));
EOF
chmod +x "$RX/h/claude"; rm -f "$ST"
rh() { env -i HOME="$RH" TZ="$TZQ" PATH="$RX/h:$RX:$NODEBIN" DANDELION_KIMI_PORT=$KQ DANDELION_CURSOR_API_BASE=http://127.0.0.1:48010 DANDELION_STATE_FILE="$ST" "$@" sh -c 'q prep && node "$1/src/main.ts" ${A-route --high}; echo "exit=$?"' - "$PWD"; }
```

1. Run `rh H_CLAUDE=3,86,100 H_WORK=0,12,23`.
   - **Expected:** `claude-fable-5-1 max claude-work`, then `exit=0`. Personal's Fable window is at 100%, even though its all-models window is only at 86%.

2. Run `rh H_CLAUDE=85,10,40 H_WORK=10,10,70`, then `rh H_CLAUDE=85,10,40 H_WORK=10,10,95`.
   - **Expected:** `claude-fable-5-1 max claude-work` (work has 30 left, personal only 15 because of its session), then `claude-fable-5-1 max claude` (work tripped its Fable window, so it pops back to personal). Each is followed by `exit=0`.

3. Run `rh H_CLAUDE=10,50,-`, then `rh H_CLAUDE=10,95,10`.
   - **Expected:** `claude-fable-5-1 max claude` twice, each with `exit=0`. With no Fable line the window counts as 0%, and all-models does not gate fable.

4. Run `rh H_CLAUDE=10,10,90 H_WORK=10,10,95 Q_CURSOR=50,72`, then `rh H_CLAUDE=90,10,10 Q_CURSOR=10,72`.
   - **Expected:** `kimi-k3-max cursor` twice, each with `exit=0`. In the second run, personal's session at 90% trips every claude entry.

5. Run `rh H_CLAUDE=10,40,95 H_WORK=10,95,95 Q_CURSOR=90,72`.
   - **Expected:** `claude-opus-5 max claude`, `exit=0`. Cursor is tripped. Opus ignores the Fable window, and work's all-models window is tripped.

6. Run `rh H_CLAUDE=95,10,10 Q_CURSOR=95,72 Q_GROK=60,72`, then `rh Q_GROK=90,72 Q_AGY=10,20,72`.
   - **Expected:** `grok-4.6 xhigh grok`, then `gemini-3.8-flash-high high agy`, each with `exit=0`.

7. Run `rh H_CLAUDE=90,90,90 Q_CURSOR=99,72 Q_GROK=90,72 Q_AGY=10,90,72 Q_KIMI=0,0,72 2>/tmp/012.err; wc -c < /tmp/012.err`.
   - **Expected:** `none`, `exit=1`, then `0`. kimi is healthy but is never in the chain.

8. Run `mkdir -p "$RX/state"; echo '{"claude-work": false}' > "$ST"; rh H_CLAUDE=10,10,95 H_WORK=10,10,10 Q_CURSOR=50,72; rm -r "$RX/state"`.
   - **Expected:** `kimi-k3-max cursor`, `exit=0`. Work is skipped and personal's Fable window is tripped.

9. Run `rh H_CLAUDE=10,50,- Q_AGY=0,0,72 | od -c | head -3`, then `rh A=route H_CLAUDE=10,50,- Q_AGY=0,0,72`, then `rh A='route extra --high' H_CLAUDE=10,50,-`, then `rh NO_COLOR=1 A='--once route --high' H_CLAUDE=10,50,- | head -1`.
   - **Expected:** `od` shows exactly `c l a u d e - f a b l e - 5 - 1   m a x   c l a u d e \n` then `e x i t = 0 \n`, with no `033`. Then `gemini-3.1-pro-high medium agy` (plain route still picks the most headroom). Then `claude-fable-5-1 max claude`. Then a line starting `DANDELION`.

10. Run `rt Q_CLAUDE=0,86,2 Q_AGY=0,0,72`, then `rt Q_KIMI=10,10,72 Q_GROK=50,72`, then `rt Q_CLAUDE=20,30,72 Q_WORK=10,5,72 Q_AGY=15,20,72`.
    - **Expected:** `claude-opus-5 max claude`, then `kimi-code/kimi-for-coding-highspeed kimi`, then `claude-opus-5 high claude-work`, each with `exit=0`. The lines match 010 plus the token.

11. Run `env -i HOME="$RH" TZ="$TZQ" PATH="$RB:$RX/h:$RX:$NODEBIN" DANDELION_KIMI_PORT=$KQ DANDELION_CURSOR_API_BASE=http://127.0.0.1:48010 DANDELION_STATE_FILE="$ST" H_CLAUDE=10,50,- sh -c 'q prep && dandelion route --high; echo "exit=$?"'` without redirecting.
    - **Expected:** the screen does not clear, no dashboard appears, and the only output is `claude-fable-5-1 max claude` then `exit=0`.

12. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa; git diff --stat d1df61f -- 'qa/00*.e2e.mjs'; grep -n 'high\|fable\|90%\|CLAUDE_CONFIG_DIR' README.md`.
    - **Expected:** exits 0, and every `*.e2e.mjs` prints PASS, including `012-route-high.e2e.mjs`. `pgrep` and `git diff` print nothing. The README lists `dandelion route --high`, the five-entry chain with its gating windows, the 90% trip, and the provider token, including what `claude-work` means.

13. Run `rm -rf "$RX/h" /tmp/012.err`, then the clean-up in step 16 of 011 and step 10 of 010.
    - **Expected:** the 010 dashboard check still matches, and nothing is left in `/tmp` from this procedure.
