# QA Procedure: 010 - dandelion route

Earlier procedures are unchanged by 010.

Set up once in the repo root, in a real terminal. First run the set-up block of `qa/005-codex.md`, so `$NODEBIN` exists (node and sh only). Then build one fixture `q` that acts as claude, agy, kimi, codex and kilo by its name, writes the grok snapshot and cursor auth, and serves the cursor API on port 48010. Each provider reads `Q_<NAME>` as `rolling,weekly,resetHours` (`weekly,resetHours` for grok and cursor). An unset variable makes it unavailable. `TZQ` puts local time near 11:00, so `resetHours` 2 is today and 14 is after midnight. `rt VAR=value…` runs `node src/main.ts route` with only those variables; `A='args'` among them replaces `route` with those arguments. `$RB` holds a `dandelion` symlink to `src/main.ts`.

```bash
export RX="$(mktemp -d)" RH="$(mktemp -d)" RB="$(mktemp -d)" KQ=$((40000 + RANDOM % 20000)); mkdir -p "$RH/.claude-work"; ln -s "$PWD/src/main.ts" "$RB/dandelion"
export TZQ="Etc/GMT$(printf %+d $(( 10#$(date -u +%H) - 11 )))"
cat > "$RX/q" <<'EOF'
#!/usr/bin/env node
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const me = path.basename(process.argv[1]), a = process.argv.slice(2), home = process.env.HOME, dir = __dirname;
const q = (n) => process.env[n] && process.env[n].split(',').map(Number);
const at = (h) => new Date(Date.now() + h * 3600000), iso = (h) => at(h).toISOString();
const M = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const txt = (h) => { const d = at(h), H = d.getUTCHours(); return `${M[d.getUTCMonth()]} ${d.getUTCDate()}, ${H % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')}${H < 12 ? 'am' : 'pm'} (UTC)`; };
if (me === 'codex') { console.error('Logged in using an API key - sk-proj-***n5zQA'); process.exit(0); }
if (me === 'kilo') { console.log('Balance: $14.15'); process.exit(0); }
if (me === 'claude') { const v = q(process.env.CLAUDE_CONFIG_DIR ? 'Q_WORK' : 'Q_CLAUDE'); if (!v) process.exit(1);
  console.log(`Current session: ${v[0]}% used · resets ${txt(4)}\nCurrent week (all models): ${v[1]}% used · resets ${txt(v[2])}`); process.exit(0); }
if (me === 'agy') { const v = q('Q_AGY'); if (!v) process.exit(1);
  console.log(`Gemini Models\tFive Hour Limit Remaining\t${100 - v[0]}%\t${iso(4)}\nGemini Models\tWeekly Limit Remaining\t${100 - v[1]}%\t${iso(v[2])}`); process.exit(0); }
if (me === 'kimi') { const v = q('Q_KIMI'); if (!v) process.exit(1); const port = Number(a[a.indexOf('--port') + 1]);
  const data = { summary: { used: v[1] * 10, limit: 1000, reset_at: iso(v[2]) }, limits: [{ used: v[0], limit: 100, window: { unit: 'hour', value: 5 } }] };
  return http.createServer((req, res) => res.end(JSON.stringify({ data }))).listen(port, '127.0.0.1', () => console.log(`kimi web ready: http://127.0.0.1:${port}/?token=t`)); }
if (a[0] === 'serve') return http.createServer((req, res) => { const v = fs.readFileSync(path.join(dir, 'cursor.q'), 'utf8').split(',').map(Number);
  res.end(JSON.stringify(req.url.endsWith('/GetPlanInfo') ? { planInfo: { planName: 'Ultra' } } : { billingCycleEnd: String(at(v[1]).getTime()),
    planUsage: { totalPercentUsed: v[0], autoPercentUsed: v[0], apiPercentUsed: v[0] } })); }).listen(48010, '127.0.0.1');
fs.rmSync(`${home}/.grok`, { recursive: true, force: true }); fs.rmSync(`${home}/.config`, { recursive: true, force: true });
const g = q('Q_GROK'), c = process.env.Q_CURSOR;
if (g) { fs.mkdirSync(`${home}/.grok/logs`, { recursive: true }); fs.writeFileSync(`${home}/.grok/logs/unified.jsonl`, JSON.stringify({ ts: iso(0), msg: 'billing: fetched credits config',
  ctx: { config: { creditUsagePercent: g[0], currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: iso(-100), end: iso(g[1]) } }, subscriptionTier: 'SuperGrok' } }) + '\n'); }
if (c) { fs.writeFileSync(path.join(dir, 'cursor.q'), c); fs.mkdirSync(`${home}/.config/cursor`, { recursive: true }); fs.writeFileSync(`${home}/.config/cursor/auth.json`, '{"accessToken":"qa-010"}'); }
EOF
chmod +x "$RX/q"; for n in claude agy kimi codex kilo; do ln -s q "$RX/$n"; done
env PATH="$NODEBIN" node "$RX/q" serve & sleep 0.5
rt() { env -i HOME="$RH" TZ="$TZQ" PATH="$RX:$NODEBIN" DANDELION_KIMI_PORT=$KQ DANDELION_CURSOR_API_BASE=http://127.0.0.1:48010 "$@" sh -c 'q prep && node "$1/src/main.ts" ${A-route}; echo "exit=$?"' - "$PWD"; }
```

1. Run `rt Q_CLAUDE=0,86,2 Q_AGY=0,0,72`.
   - **Expected:** `claude-opus-5 max`, then `exit=0`. Nothing else.

2. Run each line below and compare with the expected output, which is followed by `exit=0` each time.
   ```bash
   rt Q_CLAUDE=0,86,2 Q_CURSOR=60,2                       # kimi-k3-max
   rt Q_AGY=0,90,2 Q_KIMI=0,90,2                          # gemini-3.1-pro-high high
   rt Q_CLAUDE=0,3,2 Q_AGY=10,10,72                       # claude-opus-5 high
   rt Q_CLAUDE=0,86,14 Q_AGY=10,10,72                     # gemini-3.1-pro-high medium
   ```
   - **Expected:** each prints the line in its comment. The last two prove that a weekly with 97% left, or one resetting after local midnight, does not evaporate.

3. Run `rt Q_CLAUDE=20,30,72 Q_WORK=10,5,72 Q_AGY=15,20,72`, then `rt Q_CLAUDE=20,30,72 Q_AGY=5,5,72`.
   - **Expected:** `claude-opus-5 high`, then `gemini-3.1-pro-high medium`, each followed by `exit=0`.

4. Run `rt Q_KIMI=90,10,72 Q_AGY=50,50,72`, then `rt Q_KIMI=90,10,72 Q_GROK=50,72`, then `rt Q_KIMI=10,10,72 Q_GROK=50,72`, then `rt Q_AGY=20,20,72 Q_KIMI=20,20,72`.
   - **Expected:** `gemini-3.1-pro-high medium` (kimi is bound by its 5h window), then `grok-4.6` (grok has no rolling window, so 100 counts), then `kimi-code/kimi-for-coding-highspeed`, then `gemini-3.1-pro-high medium`, each followed by `exit=0`.

5. Run `rt Q_CURSOR=40,72`, then `rt 2>/tmp/010.err; wc -c < /tmp/010.err`.
   - **Expected:** `kimi-k3-max` and `exit=0`. Then `none`, `exit=1` and `0` (stderr is empty): codex and kilo are "ok" but never routed.

6. Run `rt Q_CLAUDE=0,86,2 2>/tmp/010.err | od -c | head -3; wc -c < /tmp/010.err`.
   - **Expected:** `od` shows exactly `c l a u d e - o p u s - 5   m a x \n` and then `e x i t = 0 \n`, with no `033`. `wc` prints `0`.

7. Run `env -i HOME="$RH" TZ="$TZQ" PATH="$RB:$RX:$NODEBIN" DANDELION_KIMI_PORT=$KQ DANDELION_CURSOR_API_BASE=http://127.0.0.1:48010 Q_CLAUDE=0,86,2 sh -c 'q prep && dandelion route; echo "exit=$?"'` in the terminal, without redirecting.
   - **Expected:** the screen does not clear, no dashboard appears, and the only output is `claude-opus-5 max` then `exit=0`.

8. Run `rt A='route extra' Q_CLAUDE=0,86,2`, then `rt NO_COLOR=1 A='--once route' Q_CLAUDE=0,86,2 | head -1`, then `rt NO_COLOR=1 A=routes Q_CLAUDE=0,86,2 | head -1`.
   - **Expected:** `claude-opus-5 max` and `exit=0`. Then twice a line starting `DANDELION` followed by a time: only a first argument of `route` routes.

9. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa; git diff --stat ec04f8e -- 'qa/00*.e2e.mjs'`.
   - **Expected:** exits 0 and every `*.e2e.mjs` prints PASS, including `010-route-command.e2e.mjs`. `pgrep` and `git diff` print nothing.

10. Run the set-up block of `qa/009-rename-dandelion.md` (which runs those of 002 to 008), then its step 2, then `grep -n 'route\|kilo\|codex' README.md`, then `pkill -f "$RX/q serve"; rm -rf "$RX" "$RH" "$RB" "$B" "$H0" /tmp/010.err /tmp/009.txt`.
    - **Expected:** the dashboard matches 009 step 2 exactly; no row shows a window kind. The README documents `dandelion route`, both rules, the routing table, and that kilo and codex are never routed.
