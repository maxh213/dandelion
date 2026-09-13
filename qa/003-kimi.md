# QA Procedure: 003 - Kimi windows

After 003, two expected results in `qa/002-claude-agy.md` change. In step 2, a `kimi` panel (dim, reason `kimi CLI not found in PATH`, since `$FX` has no `kimi` yet) sits between `agy` and `kilo`. Step 9 shows four dim panels in the order claude, agy, kimi, kilo, and the kimi reason is `kimi CLI not found in PATH`. Step 13 below replaces that step 9.

Set up once in the repo root (bash). Run the set-up block of `qa/002-claude-agy.md` first so `$FX` holds the `claude`, `agy` and `kilo` fixtures and `$NODEDIR` is set. Then add the `kimi` fixture. It reads its behaviour from `$FX/mode`, writes its pid to `$FX/kimi.pid`, and sets `reset_at` to 5 days and 5 minutes from now.

Modes: `ok`, `notoken` (exits at once), `silent` (stays alive, prints nothing), `nohttp` (prints the token, never listens), `hang` (accepts the request, never answers), `500`, `badjson`, `zero` (summary limit 0), `odd` (1200/1000 with `reset_at` "soon", a bad hour entry, a 1-hour entry), `stubborn` (ignores SIGTERM).

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
setInterval(() => {}, 1000);
if (mode === 'silent') return;
if (mode === 'stubborn') process.on('SIGTERM', () => {});
const ready = 'kimi web ready: http://127.0.0.1:' + port + '/?token=test-token';
if (mode === 'nohttp') return console.log(ready);
const reset = new Date(Date.now() + 7500 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const data = { ok: { summary: { used: 590, limit: 1000, reset_at: reset },
    limits: [{ used: 42, limit: 100, window: { unit: 'hour', value: 5 } }] },
  zero: { summary: { used: 1, limit: 0 } },
  odd: { summary: { used: 1200, limit: 1000, reset_at: 'soon' },
    limits: [{ used: 'x', limit: 100, window: { unit: 'hour', value: 5 } }, { used: 7, limit: 10, window: { unit: 'hour', value: 1 } }] } };
http.createServer((req, res) => {
  if (mode === 'hang') return;
  const ok = req.headers.authorization === 'Bearer test-token' && req.url === '/api/v1/oauth/usage';
  const status = mode === '500' ? 500 : ok ? 200 : 401;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(status !== 200 ? '{}' : mode === 'badjson' ? '{"data":' : JSON.stringify({ data: data[mode] ?? data.ok }));
}).listen(port, '127.0.0.1', () => console.log(ready));
EOF
chmod +x "$FX/kimi"
alive() { kill -0 "$(cat "$FX/kimi.pid")" 2>/dev/null && echo ALIVE || echo GONE; }
run() { echo "$1" > "$FX/mode"; rm -f "$FX/kimi.pid"; time timeout "$2" env PATH="$FX:$NODEDIR" ALLOWANCE_KIMI_PORT=$KP NO_COLOR=1 npm start; echo "exit=$?"; alive; }
```

1. Run `node qa/e2e.mjs; pgrep -fa allowance-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including the 001, 002 and new 003 kimi e2es. The e2es create their fixture dirs under the temp prefix `allowance-qa-` (003 uses `allowance-qa-003-`), so `pgrep` prints nothing: no fixture process is left.

2. Run `run ok 30`.
   - **Expected:** `exit=0` and `GONE`. Panels appear in the order `claude`, `agy`, `kimi`, `kilo`. The kimi panel reads `weekly                              ############--------  59% ↻ 5d0h` (or `↻ 4d23h` once 5 minutes have passed), then `5h                                  ########------------  42%` with no `↻`, then the caption `kimi code · kimi`. The claude, agy and kilo panels look as in step 2 of `qa/002-claude-agy.md`. No line is over 72 columns.

3. Run `echo ok > "$FX/mode"; PATH="$FX:$NODEDIR" ALLOWANCE_KIMI_PORT=$KP npm start`.
   - **Expected:** the kimi `weekly` gauge and percent are the warm colour and the `5h` ones are calm, like the other panels' ramp. The caption is dim.

4. Run `run odd 30`.
   - **Expected:** `exit=0`, `GONE`. The kimi rows are exactly `weekly                              #################### 120%` (no `↻`) and `5h                                  ##############------  70%`. No `NaN` or `Infinity` appears anywhere.

5. Run `run zero 30`, `run 500 30` and `run badjson 30`.
   - **Expected:** each prints `exit=0` and `GONE` in under 5s real time. The kimi panel is dim with no gauge and the caption `kimi code · kimi`. The reasons are `Could not parse usage from response`, `kimi usage request failed: HTTP 500` and `Could not parse usage from response`.

6. Run `run notoken 40`.
   - **Expected:** `exit=0` in under 5s real time, and `GONE`. The kimi reason is `kimi web exited without printing a token`. The claude, agy and kilo panels render normally.

7. Run `run silent 40`.
   - **Expected:** `exit=0` after about 20s (20 to 30s real time), and `GONE`. The kimi reason is `kimi web printed no token within 20s`.

8. Run `run nohttp 40`.
   - **Expected:** `exit=0` in under 5s real time, and `GONE`. The kimi reason is `kimi usage request failed`.

9. Run `run hang 40`.
   - **Expected:** `exit=0` after about 10s (10 to 20s real time), and `GONE`. The kimi reason is `kimi usage request timed out after 10s`.

10. Run `run stubborn 30`.
    - **Expected:** `exit=0` and `GONE`, even though the fixture ignores SIGTERM. The run takes about 5s longer than step 2. The kimi panel renders ok at 59% and 42%.

11. Run `echo ok > "$FX/mode"; rm -f "$FX/kimi.pid"; PATH="$FX:$NODEDIR" ALLOWANCE_KIMI_PORT=abc NO_COLOR=1 npm start; echo "exit=$?"; ls "$FX/kimi.pid"`.
    - **Expected:** `exit=0`. The kimi panel is dim with the reason `ALLOWANCE_KIMI_PORT must be an integer from 1 to 65535`. `ls` reports no such file, because kimi was never started. Repeat with `0` and `70000` for the same result.

12. Run `mv "$FX/kimi" "$FX/kimi.off"; run ok 10; mv "$FX/kimi.off" "$FX/kimi"`, then `pgrep -fa "$FX/kimi"`.
    - **Expected:** `exit=0`. The kimi panel reason is `kimi CLI not found in PATH` and it still sits between agy and kilo. (`alive` prints `GONE` because there is no pid file.) `pgrep` prints nothing.

13. Run `PATH="$(mktemp -d):$NODEDIR" npm start; echo "exit=$?"`.
    - **Expected:** `exit=0`. Four dim panels appear in the order claude, agy, kimi, kilo, with the reasons `claude CLI not found in PATH`, `agy CLI not found in PATH`, `kimi CLI not found in PATH` and `kilo CLI not found in PATH`.
