# QA Procedure: 005 - Codex panel

After 005, a `codex` panel sits between `grok` and `kilo` in every earlier procedure. Where `$FX` has no `codex`, it is dim with the reason `codex CLI not found in PATH`. Step 9 below replaces step 9 of `qa/004-grok.md`.

Set up once in the repo root (bash, GNU `date`). First run the set-up blocks of `qa/002-claude-agy.md`, `qa/003-kimi.md` and `qa/004-grok.md`, so `$FX`, `$NODEDIR`, `$KP`, `$GH` and `log` exist. Then add the `codex` fixture. `CODEX_FIXTURE_MODE` picks its behaviour. It logs every call to `$FX/codex.calls` and writes the app-server pid to `$FX/codex.pid`. Reset times are 2h30m and 3 days from now.

Modes: `apikey`, `chatgpt`, `notlogged` (exits 1), `rpcerror` (auth error for id 2), `silent` (never answers id 2), `crash` (app-server exits at once), `stubborn` (ignores SIGTERM).

```bash
cat > "$FX/codex" <<'EOF'
#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), dir = __dirname;
const mode = process.env.CODEX_FIXTURE_MODE, a = process.argv.slice(2).join(' ');
fs.appendFileSync(path.join(dir, 'codex.calls'), a + '\n');
if (a === 'login status') {
  if (mode === 'apikey') console.error('Logged in using an API key - sk-proj-***n5zQA');
  else if (mode === 'notlogged') { console.error('Not logged in'); process.exit(1); }
  else console.error('Logged in using ChatGPT');
  process.exit(0);
}
if (a !== 'app-server') process.exit(2);
fs.writeFileSync(path.join(dir, 'codex.pid'), String(process.pid));
if (mode === 'crash') process.exit(3);
if (mode === 'stubborn') process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
const s = Math.floor(Date.now() / 1000), say = (o) => console.log(JSON.stringify(o));
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === 1) say({ id: 1, result: { userAgent: 'fixture' } });
  if (m.id !== 2 || mode === 'silent') return;
  say({ method: 'remoteControl/status/changed', params: { status: 'disabled' } });
  if (mode === 'rpcerror') return say({ error: { code: -32600, message: 'chatgpt authentication required to read rate limits' }, id: 2 });
  say({ id: 2, result: { rateLimits: { limitId: 'codex', planType: 'plus',
    primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: s + 9000 },
    secondary: { usedPercent: 86, windowDurationMins: 10080, resetsAt: s + 259200 } } } });
});
EOF
chmod +x "$FX/codex"; log '1 hour'
cx() { rm -f "$FX/codex.pid" "$FX/codex.calls"; time timeout 60 env CODEX_FIXTURE_MODE="$1" PATH="$FX:$NODEDIR" ALLOWANCE_KIMI_PORT=$KP ALLOWANCE_GROK_HOME="$GH" NO_COLOR=1 npm start --silent; echo "exit=$?"; [ -f "$FX/codex.pid" ] && { kill -0 "$(cat "$FX/codex.pid")" 2>/dev/null && echo ALIVE || echo GONE; }; cat "$FX/codex.calls"; }
```

1. Run `node qa/e2e.mjs; pgrep -fa allowance-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including 001 to 004 and the new `005-codex.e2e.mjs`. `pgrep` prints nothing.

2. Run `cx chatgpt`.
   - **Expected:** `exit=0`, then `GONE`. The panels appear in the order `claude`, `agy`, `kimi`, `grok`, `codex`, `kilo`. The codex panel is the rule, `codex`, `5h                                  ########------------  42% ↻ 2h30m` (or `2h29m`), `weekly                              #################---  86% ↻ 3d0h` (or `2d23h`), then `codex · codex`. The calls are `login status` then `app-server`. No line is over 72 columns.

3. Run the step 2 command without `NO_COLOR=1`.
   - **Expected:** the `5h` gauge and `42%` are calm (green) and the `weekly` ones are hot (red). The caption is dim.

4. Run `cx apikey`.
   - **Expected:** `exit=0`. No `GONE` or `ALIVE` line is printed, because no app-server was started. The only call is `login status`. The codex panel is the rule, `codex`, `api-key billing · no usage windows`, `codex · codex`, with no gauge and no percent.

5. Run `cx rpcerror`.
   - **Expected:** `exit=0` in under 5s real time, then `GONE`. The codex panel is dim with the reason `chatgpt authentication required to read rate limits` and the caption `codex · codex`. The other five panels render normally.

6. Run `cx notlogged`, then `cx crash`.
   - **Expected:** each exits 0 in under 5s. The dim reasons are `codex is not logged in` (with no `app-server` call) and `codex app-server exited without answering` (then `GONE`).

7. Run `cx silent`.
   - **Expected:** `exit=0` after about 30s (30 to 40s real time), then `GONE`. The codex panel is dim with the reason `codex app-server did not answer within 30s`. The other panels render normally.

8. Run `cx stubborn`.
   - **Expected:** `exit=0` and `GONE`, even though the app-server ignores SIGTERM. The run takes about 5s longer than step 2, and the panel still shows 42% and 86%.

9. Run `PATH="$(mktemp -d):$NODEDIR" ALLOWANCE_GROK_HOME="$(mktemp -d)" npm start; echo "exit=$?"`.
   - **Expected:** `exit=0`. Six dim panels appear in the order claude, agy, kimi, grok, codex, kilo. The codex reason is `codex CLI not found in PATH` and its caption is `codex · codex`.

10. If a real `codex` is installed, run `NO_COLOR=1 npm start` with your normal PATH.
    - **Expected:** a codex panel matching your login. With an API key it shows `api-key billing · no usage windows`. With a ChatGPT login it shows your windows, or a dim server message. Afterwards `pgrep -fa 'codex app-server'` shows no process started by the app.
