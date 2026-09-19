# QA Procedure: 016 - Hermes credits panel and route line

After 016, a `hermes` panel sits between `junie` and `kilo` in every earlier procedure. Where the auth file is missing it is dim with `no hermes auth — run hermes portal login`. Grok still prints `grok-4.6 xhigh grok`.

Set up once in the repo root, in a real terminal (bash, GNU tools). First run the set-up blocks of `qa/010-route-command.md`, `qa/011-route-eligibility-toggle.md`, `qa/014-route-session-trip.md` and `qa/015-junie.md`, so `$RX`, `$ST`, `$JH`, `rt`, `rq`, `live`, `jh` and `snap` exist. Then add a dummy auth file and a local portal fixture on port 48016 that logs each request to `$HF/requests.log`. `hx` is the 014 live case plus junie 30% and this hermes fixture.

```bash
export HF="$RX/hermes" HA="$HF/auth.json"; mkdir -p "$HF"
ha() { local exp; [ "$1" = past ] && exp=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%S+00:00) || exp=$(date -u -d '+1 day' +%Y-%m-%dT%H:%M:%S+00:00)
  printf '{"version":1,"providers":{"nous":{"access_token":"qa-dummy-hermes-access-016","refresh_token":"qa-dummy-refresh-016","client_id":"hermes-cli","portal_base_url":"https://portal.nousresearch.com","agent_key":"qa-dummy-hermes-agent-key-016","agent_key_expires_at":"%s","expires_at":"%s"}},"active_provider":"nous"}\n' "$exp" "$exp" > "$HA"; }
cat > "$HF/server.mjs" <<'EOF'
import http from 'node:http'; import fs from 'node:fs';
const dir = process.env.HF, mode = process.env.HERMES_FIXTURE_MODE || 'ok';
const remaining = Number(process.env.HERMES_REMAINING ?? 5.5), hours = Number(process.env.HERMES_RESET_HOURS ?? 72);
http.createServer((req, res) => {
  fs.appendFileSync(`${dir}/requests.log`, `${req.method} ${req.url} ${req.headers.authorization} ${req.headers.accept}\n`);
  if (mode === 'hang') return;
  if (mode === 'unauthorized') return res.writeHead(401).end(JSON.stringify({ error: `bad token ${req.headers.authorization}` }));
  const end = new Date(Date.now() + hours * 3600000).toISOString();
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
    user: { email: 'qa@example.com' }, organisation: { id: 'o', slug: 'o', name: 'O' },
    subscription: { plan: 'Plus', tier: 2, monthly_charge: 20, monthly_credits: 22, current_period_end: end,
      credits_remaining: remaining, rollover_credits: 6.591792646666667 },
    purchased_credits_remaining: 0, tool_access: { enabled: false }, managed_tools: false,
    paid_service_access: { allowed: true, paid_access: true, reason: 'usable_credits',
      subscription_credits_remaining: remaining, purchased_credits_remaining: 0, total_usable_credits: remaining }
  }));
}).listen(48016, '127.0.0.1');
EOF
hs() { pkill -f "$HF/server.mjs" || true; : > "$HF/requests.log"; HF="$HF" HERMES_FIXTURE_MODE="${1:-ok}" HERMES_REMAINING="${2:-5.5}" HERMES_RESET_HOURS="${3:-72}" node "$HF/server.mjs" & sleep 0.5; }
he() { rt DANDELION_HERMES_AUTH_FILE="${AUTH:-$HA}" DANDELION_HERMES_PORTAL_BASE=http://127.0.0.1:48016 "$@"; }
hx() { live Q_WORK=100,72,5.35 DANDELION_JUNIE_HOME="$JH" DANDELION_HERMES_AUTH_FILE="$HA" DANDELION_HERMES_PORTAL_BASE=http://127.0.0.1:48016 "$@"; }
ha; hs; jh "$JH" 701512.73275
```

1. Run `snap "$HA" > /tmp/h1; : > "$HF/requests.log"; he NO_COLOR=1 A=--once 2>&1 | tee /tmp/h.out; snap "$HA" > /tmp/h2; diff /tmp/h1 /tmp/h2 && echo SAME; grep -cE 'qa-dummy-hermes-(agent-key|access)-016' /tmp/h.out; cat "$HF/requests.log"`.
   - **Expected:** `exit=0`. Panels appear in the order claude, claude-work, agy, kimi, grok, codex, cursor, junie, hermes, kilo. The hermes panel is the rule, `hermes`, `credits                             ###############-----  75% ↻ 3d0h` (or `2d23h`), then `Plus · $5.50 of $22 · hermes`. No line is over 72 columns. Then `SAME`, then `0`, then exactly one request line: `GET /api/oauth/account Bearer qa-dummy-hermes-agent-key-016 application/json`.

2. Run `he A=--once` without `NO_COLOR=1`.
   - **Expected:** the hermes gauge and `75%` are warm (yellow); the caption is dim.

3. Run `hs; hx`.
   - **Expected:** `grok-4.6 xhigh grok` with `exit=0` (91 beats junie 70 and hermes 25).

4. Run `hs ok 22; hx`, then `jh "$JH" 1000000; hx`, then `jh "$JH" 701512.73275`.
   - **Expected:** `x-ai/grok-4.6 xhigh hermes` with `exit=0` (100 left), then `gemini-3.8-flash high junie` with `exit=0` (tie at 100 left, junie is earlier).

5. Run `hs ok 8.8 1; hx`.
   - **Expected:** `x-ai/grok-4.6 xhigh hermes` with `exit=0` (60% used, reset in 1h, evaporates; hermes never trips).

6. Run `mkdir -p "$RX/state"; echo '{"hermes": false}' > "$ST"; hs ok 22; hx; rm -r "$RX/state"`, then `hx A='route --high'`, then `he A='route --high'`.
   - **Expected:** `grok-4.6 xhigh grok` with `exit=0` (hermes skipped), then `claude-fable-5-1 max claude` with `exit=0`, then `none` with `exit=1`: `--high` never uses hermes.

7. Run `hs; mkdir -p "$RX/state"; rq A= DANDELION_HERMES_AUTH_FILE="$HA" DANDELION_HERMES_PORTAL_BASE=http://127.0.0.1:48016`. Press `k` twice so hermes is selected (kilo, then hermes), press space, then `q`. Run `cat "$ST"`. Run `rm -r "$RX/state"; rq A= DANDELION_HERMES_AUTH_FILE="$HF/missing.json" DANDELION_HERMES_PORTAL_BASE=http://127.0.0.1:48016`, select hermes, press space, `q`.
   - **Expected:** before space the route box shows `x-ai/grok-4.6 xhigh` / `hermes`. After space the hermes panel shows `routing off`, the route box shows `none`, and the file holds `"hermes": false`. The second time the hermes caption flashes `not routable (no usage windows)` for about 2s and the route box does not change.

8. Run `hs ok 3.3; rq A= NO_COLOR=1 DANDELION_HERMES_AUTH_FILE="$HA" DANDELION_HERMES_PORTAL_BASE=http://127.0.0.1:48016`, look at the fleet summary line, press `q`. Run it again after `hs ok 5.5`.
   - **Expected:** only hermes has a window. First hermes shows `credits` at `85%` and the summary line reads exactly `1/1 windows above 80% · next reset: hermes credits in 3d0h` (or `2d23h`). The second time it reads exactly `all windows below 80% · next reset: hermes credits in 3d0h` (or `2d23h`).

9. Run `: > "$HF/requests.log"; ha past; he NO_COLOR=1 A=--once 2>&1 | tee /tmp/h.exp; echo LOG; cat "$HF/requests.log"; ha; AUTH="$HF/missing.json" he NO_COLOR=1 A=--once 2>&1 | tee /tmp/h.miss; echo LOG; cat "$HF/requests.log"; hs unauthorized; : > "$HF/requests.log"; he NO_COLOR=1 A=--once 2>&1 | tee /tmp/h.401; grep -cE 'qa-dummy-hermes-(agent-key|access)-016' /tmp/h.401; cat "$HF/requests.log"; ha; hs`.
   - **Expected:** first the hermes panel is dim with `hermes token expired — run hermes once` and `hermes · hermes`, and LOG is empty. Then `no hermes auth — run hermes portal login` and `hermes · hermes`, LOG still empty. Then `hermes account request failed: HTTP 401` within 5s, grep prints `0`, and the log is `GET /api/oauth/account Bearer qa-dummy-hermes-agent-key-016 application/json`.

10. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa; grep -n 'hermes\|HERMES' README.md`.
    - **Expected:** exits 0 and every `*.e2e.mjs` prints PASS, including the 016 hermes e2es. `pgrep` prints nothing. README has the hermes provider bullet between junie and kilo, "All ten probes run in parallel", both ledger entries, the route table row `x-ai/grok-4.6 xhigh`, `hermes credits` among weekly windows, and says `--high` does not use hermes.

11. Run `pkill -f "$HF/server.mjs"; rm -f /tmp/h1 /tmp/h2 /tmp/h.out /tmp/h.exp /tmp/h.miss /tmp/h.401`, then the clean-up of `qa/015-junie.md`.
    - **Expected:** nothing is left in `/tmp` from this procedure. The auth file was never rewritten by the app.
