# QA Procedure: 018 - Kimi 2.0 usage windows

After 018, the kimi panel paints weekly and 5h from kimi 2.0.0's `{ code, data: { kind, quota: { usages: { limit7d, limit5h } } } }` body. Earlier procedures that spawn kimi must serve that envelope (`usedRatio` = percent/100, `resetAt` instead of `reset_at`) or kimi is dim. 003's 59% / 42% numbers stay. `--high` still does not use kimi.

Set up once in the repo root, in a real terminal (bash, GNU tools). First run the set-up block of `qa/017-ts-practices.md`, so `$RX`, `$RH`, `$RB`, `$NODEBIN`, `$KQ`, `$TZQ`, `$ST`, `$JH`, `$HA`, `$H0`, `rt`, `rq`, `live`, `hx` and `jh` exist. Replace `$RX/kimi` (a symlink to `q`) with a 2.0 server that reads `Q_KIMI` as `rolling,weekly,resetHours`. Then add a mode-file fixture `$K2` for panel cases. Weekly `resetAt` is 7205 minutes from now (5 days 5 minutes), as in `qa/003-kimi.e2e.mjs`, so the countdown is `5d0h` (or `4d23h`).

```bash
rm -f "$RX/kimi"
cat > "$RX/kimi" <<'EOF'
#!/usr/bin/env node
const http = require('node:http');
const a = process.argv.slice(2), port = Number(a[a.indexOf('--port') + 1]);
if (a[0] !== 'web' || !a.includes('--no-open') || !port) process.exit(2);
const v = process.env.Q_KIMI && process.env.Q_KIMI.split(',').map(Number);
if (!v) process.exit(1);
const iso = (h) => new Date(Date.now() + h * 3600000).toISOString();
const body = { code: 0, msg: 'success', data: { kind: 'ok', quota: { usages: {
  limit5h: { usedRatio: v[0] / 100, resetAt: iso(5) },
  limit7d: { usedRatio: v[1] / 100, resetAt: iso(v[2]) }
}, extraUsage: null } }, request_id: 'qa-018' };
http.createServer((req, res) => res.end(JSON.stringify(body)))
  .listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/#token=t'));
EOF
chmod +x "$RX/kimi"
export K2="$(mktemp -d)"
cat > "$K2/kimi" <<'EOF'
#!/usr/bin/env node
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const dir = __dirname, mode = fs.readFileSync(path.join(dir, 'mode'), 'utf8').trim();
fs.writeFileSync(path.join(dir, 'kimi.pid'), String(process.pid));
const a = process.argv.slice(2), port = Number(a[a.indexOf('--port') + 1]);
if (a[0] !== 'web' || !a.includes('--no-open') || !port) process.exit(2);
if (mode === 'notoken') process.exit(0);
setInterval(() => {}, 1000);
if (mode === 'silent') return;
if (mode === 'stubborn') process.on('SIGTERM', () => {});
const ready = 'Local: http://127.0.0.1:' + port + '/#token=test-token';
if (mode === 'nohttp') return console.log(ready);
const reset = new Date(Date.now() + 7205 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const env = (w, r, extra) => ({ code: 0, msg: 'success', data: { kind: 'ok', quota: { usages: {
  limit5h: { usedRatio: r, resetAt: reset }, limit7d: { usedRatio: w, resetAt: reset }
}, extraUsage: null } }, request_id: '01M2WR59QVZ5WJFMF4A6TWESJB', ...extra });
const live = { code: 0, msg: 'success', data: { kind: 'ok', quota: { usages: {
  limit5h: { usedRatio: 0, resetAt: '2026-09-19T14:58:50Z' },
  limit7d: { usedRatio: 0, resetAt: '2026-09-25T12:58:50Z' }
}, extraUsage: null } }, request_id: '01M2WR59QVZ5WJFMF4A6TWESJB' };
const bodies = {
  ok: env(0.59, 0.42), round: env(0.595, 0.42), live,
  denied: { ...env(0.59, 0.42), code: 1, msg: 'quota denied' },
  nouse: env(0.59, 0.42, { data: { kind: 'ok', quota: {} } }),
  kinderr: env(0.59, 0.42, { data: { kind: 'error', quota: { usages: {} } } }),
  stratio: env('0.59', '0.42'),
  old: { data: { summary: { used: 590, limit: 1000, reset_at: reset }, limits: [{ used: 42, limit: 100, window: { unit: 'hour', value: 5 } }] } }
};
http.createServer((req, res) => {
  if (mode === 'hang') return;
  const ok = req.headers.authorization === 'Bearer test-token' && req.url === '/api/v1/oauth/usage';
  const status = mode === '500' ? 500 : ok ? 200 : 401;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(status !== 200 ? '{}' : mode === 'badjson' ? '{"data":' : JSON.stringify(bodies[mode] ?? bodies.ok));
}).listen(port, '127.0.0.1', () => console.log(ready));
EOF
chmod +x "$K2/kimi"
alive() { kill -0 "$(cat "$K2/kimi.pid")" 2>/dev/null && echo ALIVE || echo GONE; }
kic() { env -i HOME="$H0" PATH="$K2:$NODEBIN" DANDELION_KIMI_PORT="${DANDELION_KIMI_PORT:-$KQ}" DANDELION_GROK_HOME="$H0/empty" DANDELION_JUNIE_HOME="$H0/empty" DANDELION_CURSOR_AUTH_FILE="$H0/missing-cursor.json" DANDELION_HERMES_AUTH_FILE="$H0/missing-hermes.json" DANDELION_CLAUDE_WORK_CONFIG_DIR="$H0/.claude-work" "$@"; }
kiso() { kic NO_COLOR=1 "$@"; }
kr() { echo "$1" > "$K2/mode"; rm -f "$K2/kimi.pid"; time timeout "$2" env -i HOME="$H0" PATH="$K2:$NODEBIN" NO_COLOR=1 DANDELION_KIMI_PORT=$KQ DANDELION_GROK_HOME="$H0/empty" DANDELION_JUNIE_HOME="$H0/empty" DANDELION_CURSOR_AUTH_FILE="$H0/missing-cursor.json" DANDELION_HERMES_AUTH_FILE="$H0/missing-hermes.json" DANDELION_CLAUDE_WORK_CONFIG_DIR="$H0/.claude-work" node "$PWD/src/main.ts" --once; echo "exit=$?"; alive; }
```

1. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including 003 (weekly 59% and 5h 42% from 2.0 `usedRatio` 0.59 / 0.42) and 010–017. `pgrep` prints nothing: the kimi child is gone.

2. Run `kr ok 30`.
   - **Expected:** `exit=0` and `GONE`. Panels appear in the order claude, claude-work, agy, kimi, grok, codex, cursor, junie, hermes, kilo. The kimi panel reads `weekly                              ############--------  59% ↻ 5d0h` (or `↻ 4d23h`), then `5h                                  ########------------  42%` with no `↻`, then `kimi code · kimi`. No line is over 72 columns. `test-token` is not in the output.

3. Run `echo ok > "$K2/mode"; kic node src/main.ts --once` without `NO_COLOR`.
   - **Expected:** the kimi `weekly` gauge and `59%` are warm (yellow) and the `5h` ones are calm (green). The caption is dim.

4. Run `kr live 30`.
   - **Expected:** `exit=0` and `GONE`. Both rows are `0%`, not the parse-failure card. Weekly has a `↻` countdown (reset `2026-09-25T12:58:50Z`). 5h is `5h                                  --------------------   0%` with no `↻` (the payload's `limit5h.resetAt` is not shown, so there is no `↻ 0h0m`).

5. Run `kr round 30`.
   - **Expected:** `exit=0` and `GONE`. Weekly is `60%` (`0.595` rounds half-up), 5h is `42%`.

6. Run `kr denied 30`, then `kr nouse 30`, `kr kinderr 30`, `kr badjson 30`, `kr stratio 30`, `kr old 30`.
   - **Expected:** each prints `exit=0` and `GONE` in under 5s. The kimi panel is dim with no gauge and caption `kimi code · kimi`. Reasons: `kimi usage request failed: quota denied`, then five times `Could not parse usage from response` (`old` is the 003 summary/limits shape).

7. Run `kr notoken 40`, `kr 500 30`, `kr nohttp 30`.
   - **Expected:** each `exit=0` and `GONE` in under 5s. Reasons: `kimi web exited without printing a token`, `kimi usage request failed: HTTP 500`, `kimi usage request failed`.

8. Run `kr stubborn 30`.
   - **Expected:** `exit=0` and `GONE`, even though the fixture ignores SIGTERM. The run takes about 5s longer than step 2. The kimi panel is ok at 59% and 42%.

9. Run `rt Q_KIMI=10,10,72 Q_GROK=50,72`, then `rt Q_KIMI=90,10,72 Q_GROK=50,72`, then `rt Q_KIMI=0,95,2 Q_AGY=0,0,72`, then `rt Q_KIMI=0,0,72`, then `rt A='route --high' Q_KIMI=0,0,72`.
   - **Expected:** `kimi-code/k3 max kimi` `exit=0`, then `grok-4.7 xhigh grok` `exit=0` (5h at 90% trips), then `kimi-code/k3 max kimi` `exit=0` (weekly 95% evaporates; weekly does not trip), then `kimi-code/k3 max kimi` `exit=0`, then `none` `exit=1` (`--high` never uses kimi).

10. Run `hx`, then `hs ok 22; hx`, then `jh "$JH" 701512.73275`.
    - **Expected:** `grok-4.7 xhigh grok` `exit=0` (014 live case: kimi weekly 95% / 5h 0% from the 2.0 `Q_KIMI` body, junie 30%, hermes 75%), then `x-ai/grok-4.7 xhigh hermes` `exit=0`.

11. Run `echo ok > "$K2/mode"; rm -f "$K2/kimi.pid"; DANDELION_KIMI_PORT=abc kiso node src/main.ts --once; echo "exit=$?"; ls "$K2/kimi.pid"`.
    - **Expected:** `exit=0`. The kimi panel is dim with `DANDELION_KIMI_PORT must be an integer from 1 to 65535`. `ls` reports no such file.

12. Run `pkill -f "$K2/kimi" || true; rm -rf "$K2"`, then the clean-up of `qa/017-ts-practices.md`. Restore `$RX/kimi` as a symlink to `q` if you still need 017's `q`.
    - **Expected:** nothing is left from this procedure. Dummy tokens never appeared in the output.
