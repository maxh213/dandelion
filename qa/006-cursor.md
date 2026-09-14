# QA Procedure: 006 - Cursor panel

After 006, a `cursor` panel sits between `codex` and `kilo` in every earlier procedure. Where `ALLOWANCE_CURSOR_AUTH_FILE` names no file, it is dim with the reason `no cursor auth — run cursor-agent login`. Step 9 below replaces step 9 of `qa/005-codex.md`.

Set up once in the repo root (bash). First run the set-up blocks of `qa/002-claude-agy.md` to `qa/005-codex.md`, so `$FX`, `$NODEBIN`, `$NPM`, `$KP`, `$GH`, `log` and the `codex` fixture exist. Then add a dummy auth file and a local dashboard fixture on port 48006. `CURSOR_FIXTURE_MODE` picks the fixture's behaviour, and it logs every request to `$CF/requests.log`. The cycle ends 3 days after each request.

Modes: `ok`, `planfail` (GetPlanInfo answers 500), `unauthorized` (usage answers 401 and echoes the token), `hang` (usage never answers).

```bash
export CF="$(mktemp -d)"; echo '{"accessToken":"qa-dummy-cursor-token-006","refreshToken":"qa-dummy-refresh-006"}' > "$CF/auth.json"
cat > "$CF/server.mjs" <<'EOF'
import http from 'node:http'; import fs from 'node:fs';
const mode = process.env.CURSOR_FIXTURE_MODE, dir = process.env.CF;
http.createServer((req, res) => { let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
  fs.appendFileSync(`${dir}/requests.log`, `${req.method} ${req.url} ${req.headers.authorization} ${req.headers['content-type']} ${body}\n`);
  const end = String(Date.now() + 3 * 86400000), send = (s, o) => res.writeHead(s).end(JSON.stringify(o));
  if (req.url.endsWith('/GetCurrentPeriodUsage')) {
    if (mode === 'hang') return;
    if (mode === 'unauthorized') return send(401, { error: `bad token ${req.headers.authorization}` });
    return send(200, { billingCycleStart: '1788108306000', billingCycleEnd: end, planUsage: { totalSpend: 101050, includedSpend: 40000,
      limit: 40000, autoPercentUsed: 32.36, apiPercentUsed: 15.81, totalPercentUsed: 31.09 } });
  }
  if (mode === 'planfail') return send(500, {});
  send(200, { planInfo: { planName: 'Ultra', includedAmountCents: 40000, price: '$200/mo', billingCycleEnd: end } });
}); }).listen(48006, '127.0.0.1');
EOF
cu() { pkill -f "$CF/server.mjs"; : > "$CF/requests.log"; CF="$CF" CURSOR_FIXTURE_MODE="$1" node "$CF/server.mjs" & sleep 0.5; local nc=(NO_COLOR=1); [ "$3" = color ] && nc=(); time timeout 60 env -u NO_COLOR CODEX_FIXTURE_MODE=apikey PATH="$FX:$NODEBIN" ALLOWANCE_KIMI_PORT=$KP ALLOWANCE_GROK_HOME="$GH" ALLOWANCE_CURSOR_AUTH_FILE="${2:-$CF/auth.json}" ALLOWANCE_CURSOR_API_BASE=http://127.0.0.1:48006 "${nc[@]}" "$NPM" start --silent 2>&1 | tee "$CF/out.txt"; echo "exit=${PIPESTATUS[0]}"; pkill -f "$CF/server.mjs"; cat "$CF/requests.log"; grep -c qa-dummy-cursor-token-006 "$CF/out.txt"; }
```

1. Run `node qa/e2e.mjs; pgrep -fa allowance-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including 001 to 005 and the new `006-cursor.e2e.mjs`. `pgrep` prints nothing.

2. Run `cu ok`.
   - **Expected:** `exit=0`. The panels appear in the order `claude`, `agy`, `kimi`, `grok`, `codex`, `cursor`, `kilo`. The cursor panel is the rule, `cursor`, `total                               ######--------------  31% ↻ 3d0h` (or `2d23h`), `auto` at `32%` and `api` at `16%` with the same countdown, then `Ultra · $200/mo · cursor`. No line is over 72 columns. The final count is `0`.

3. Look at the request log printed by step 2.
   - **Expected:** exactly two lines, `POST /aiserver.v1.DashboardService/GetCurrentPeriodUsage Bearer qa-dummy-cursor-token-006 application/json {}` and the same for `/aiserver.v1.DashboardService/GetPlanInfo`, in either order.

4. Run `cu ok "" color`.
   - **Expected:** the three cursor gauges and percents are calm (green). The caption is dim.

5. Run `cu planfail`.
   - **Expected:** `exit=0`. The cursor panel still shows the three rows, and the caption is `cursor · cursor`.

6. Run `cu unauthorized`.
   - **Expected:** `exit=0` in under 5s. The cursor panel is dim with the reason `cursor usage request failed: HTTP 401` and the caption `cursor · cursor`. The other six panels render normally. The final count is `0`: the token echoed by the server is not printed.

7. Run `cu ok "$CF/missing.json"`, then `echo '{"refreshToken":"r"}' > "$CF/bad.json"; cu ok "$CF/bad.json"`.
   - **Expected:** each exits 0 in under 5s. The cursor panel is dim with the reason `no cursor auth — run cursor-agent login` and the caption `cursor · cursor`. The request log is empty.

8. Run `cu hang`.
   - **Expected:** `exit=0` after 15 to 25s real time. The cursor panel is dim with the reason `cursor usage request timed out after 15s`. The other panels render normally.

9. Run `env PATH="$(mktemp -d):$NODEBIN" ALLOWANCE_GROK_HOME="$(mktemp -d)" ALLOWANCE_CURSOR_AUTH_FILE="$CF/missing.json" "$NPM" start; echo "exit=$?"`.
   - **Expected:** `exit=0`. Seven dim panels appear in the order claude, agy, kimi, grok, codex, cursor, kilo. The cursor reason is `no cursor auth — run cursor-agent login` and its caption is `cursor · cursor`.

10. Run `git grep -n qa-dummy-cursor-token-006 -- ':!features' ':!qa'; git status --short`.
    - **Expected:** `git grep` prints nothing. `git status` shows no new file written by the runs.

11. If you are logged in with `cursor-agent login`, run `NO_COLOR=1 npm start | tee /tmp/cu.txt` with your normal PATH, then `grep -c "$(node -p 'require(require("os").homedir()+"/.config/cursor/auth.json").accessToken')" /tmp/cu.txt`.
    - **Expected:** a cursor panel with your plan (for example `Ultra · $200/mo · cursor`) and `total`, `auto` and `api` rows with a reset countdown. The count is `0`.
