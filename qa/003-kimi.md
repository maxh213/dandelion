# QA Procedure: 003 - Kimi windows

Set up once in the repo root (bash). Run the set-up block of `qa/002-claude-agy.md` first so `$FX` holds the `claude`, `agy` and `kilo` fixtures and `$NODEDIR` is set. Then add the `kimi` fixture. It reads its behaviour from `$FX/mode`, writes its pid to `$FX/kimi.pid`, and sets `reset_at` to 5 days and 5 minutes from now.

```bash
export KP=$((40000 + RANDOM % 20000))
cat > "$FX/kimi" <<'EOF'
#!/usr/bin/env node
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const dir = __dirname, mode = fs.readFileSync(path.join(dir, 'mode'), 'utf8').trim();
fs.writeFileSync(path.join(dir, 'kimi.pid'), String(process.pid));
const a = process.argv.slice(2), port = Number(a[a.indexOf('--port') + 1]);
if (a[0] !== 'web' || !a.includes('--no-open') || !port) process.exit(2);
if (mode === 'notoken') process.exit(0);
if (mode === 'stubborn') process.on('SIGTERM', () => {});
const reset = new Date(Date.now() + 7500 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const body = JSON.stringify({ data: { summary: { used: 590, limit: 1000, reset_at: reset },
  limits: [{ used: 42, limit: 100, window: { unit: 'hour', value: 5 } }] } });
http.createServer((req, res) => {
  const ok = req.headers.authorization === 'Bearer test-token' && req.url === '/api/v1/oauth/usage';
  const status = mode === '500' ? 500 : ok ? 200 : 401;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(status === 200 ? (mode === 'badjson' ? '{"data":' : body) : '{}');
}).listen(port, '127.0.0.1', () => console.log('kimi web ready: http://127.0.0.1:' + port + '/?token=test-token'));
EOF
chmod +x "$FX/kimi"
alive() { kill -0 "$(cat "$FX/kimi.pid")" 2>/dev/null && echo ALIVE || echo GONE; }
run() { echo "$1" > "$FX/mode"; rm -f "$FX/kimi.pid"; time timeout "$2" env PATH="$FX:$NODEDIR" ALLOWANCE_KIMI_PORT=$KP NO_COLOR=1 npm start; echo "exit=$?"; alive; }
```

1. Run `node qa/e2e.mjs`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including the 001, 002 and new 003 kimi e2es. Afterwards `pgrep -f allowance-qa` prints nothing.

2. Run `run ok 30`.
   - **Expected:** `exit=0` and `GONE`. Panels appear in the order `claude`, `agy`, `kimi`, `kilo`. The kimi panel reads `weekly                              ############--------  59% ↻ 5d0h` (or `↻ 4d23h` once 5 minutes have passed), then `5h                                  ########------------  42%` with no `↻`, then the caption `kimi code · kimi`. The claude, agy and kilo panels look as in step 2 of `qa/002-claude-agy.md`. No line is over 72 columns.

3. Run `echo ok > "$FX/mode"; PATH="$FX:$NODEDIR" ALLOWANCE_KIMI_PORT=$KP npm start`.
   - **Expected:** the kimi `weekly` gauge and percent are the warm colour and the `5h` ones are calm, like the other panels' ramp. The caption is dim.

4. Run `run notoken 30`.
   - **Expected:** `exit=0` well before the 30s timeout, and `GONE`. The kimi panel is dim with no gauge, the reason `kimi web printed no token within 20s` and the caption `kimi code · kimi`. The claude, agy and kilo panels render normally.

5. Run `run 500 30`.
   - **Expected:** `exit=0`, `GONE`. The kimi panel reason is `kimi usage request failed: HTTP 500`.

6. Run `run badjson 30`.
   - **Expected:** `exit=0`, `GONE`. The kimi panel reason is `Could not parse usage from response`.

7. Run `run stubborn 30`.
   - **Expected:** `exit=0` and `GONE`, even though the fixture ignores SIGTERM. The run takes about 5s longer than step 2. The kimi panel renders ok at 59% and 42%.

8. Run `mv "$FX/kimi" "$FX/kimi.off"; run ok 10; mv "$FX/kimi.off" "$FX/kimi"`.
   - **Expected:** `exit=0`. The kimi panel reason is `kimi CLI not found in PATH` and it still sits between agy and kilo. (`alive` prints `GONE` because there is no pid file.)
