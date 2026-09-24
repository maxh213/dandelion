# QA Procedure: 017 - TypeScript practices, no user-visible change

After 017, every earlier procedure is unchanged. A user of the dashboard or `dandelion route` cannot tell this pass ran.

Set up once in the repo root, in a real terminal (bash, GNU tools). First run the set-up block of `qa/016-hermes.md`, so `$RX`, `$RH`, `$RB`, `$NODEBIN`, `$KQ`, `$TZQ`, `$ST`, `$JH`, `$HA`, `$HF`, `rt`, `rq`, `live`, `hx`, `he`, `hs`, `ha`, `jh` and `snap` exist. `bare` is `--once` with only node and sh on PATH and empty grok/junie homes.

```bash
export H0="$(mktemp -d)"; mkdir -p "$H0/.claude-work" "$H0/empty"
bare() { env -i HOME="$H0" PATH="$NODEBIN" NO_COLOR=1 DANDELION_GROK_HOME="$H0/empty" DANDELION_JUNIE_HOME="$H0/empty" DANDELION_CURSOR_AUTH_FILE="$H0/missing-cursor.json" DANDELION_HERMES_AUTH_FILE="$H0/missing-hermes.json" DANDELION_CLAUDE_WORK_CONFIG_DIR="$H0/.claude-work" node src/main.ts --once; echo "exit=$?"; }
ha; hs; jh "$JH" 701512.73275
```

1. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including every 001–016 file. `pgrep` prints nothing.

2. Run `snap "$HA" > /tmp/017.h1; he NO_COLOR=1 A=--once DANDELION_JUNIE_HOME="$JH" 2>&1 | tee /tmp/017.once; snap "$HA" > /tmp/017.h2; diff /tmp/017.h1 /tmp/017.h2 && echo SAME; grep -cE 'qa-dummy-hermes-(agent-key|access)-016' /tmp/017.once; awk 'length>72' /tmp/017.once`.
   - **Expected:** `exit=0`. Panels appear in the order claude, claude-work, agy, kimi, grok, codex, cursor, junie, hermes, kilo. Junie shows `credits                             ######--------------  30%`, `snapshot 1h0m old` (or `1h1m`), `701513 credits · junie`. Hermes shows `credits                             ###############-----  75% ↻ 3d0h` (or `2d23h`), then `Plus · $5.50 of $22 · hermes`. Kilo shows `$14.15` then 14 `#` and 6 `-`, caption `api balance · kilo`. Codex shows `api-key billing · no usage windows`. Then `SAME`, then `0`, then `awk` prints nothing.

3. Run `he NO_COLOR=1 A=--once DANDELION_JUNIE_HOME="$JH" > /tmp/017.b; env -i HOME="$RH" TZ="$TZQ" PATH="$RB:$RX:$NODEBIN" NO_COLOR=1 DANDELION_KIMI_PORT=$KQ DANDELION_CURSOR_API_BASE=http://127.0.0.1:48010 DANDELION_JUNIE_HOME="$JH" DANDELION_HERMES_AUTH_FILE="$HA" DANDELION_HERMES_PORTAL_BASE=http://127.0.0.1:48016 sh -c 'q prep && dandelion --once; echo "exit=$?"' ; diff <(sed 1d /tmp/017.once) <(sed 1d /tmp/017.b)`.
   - **Expected:** `dandelion --once` prints `exit=0`. `diff` is empty, or only the banner clock and `↻` countdowns that ticked. Empty output from `dandelion` is a failure.

4. Run `hs; hx`, then `hs ok 22; hx`, then `jh "$JH" 1000000; hx`, then `jh "$JH" 701512.73275`.
   - **Expected:** `grok-4.6 xhigh grok` with `exit=0`, then `x-ai/grok-4.6 xhigh hermes` with `exit=0`, then `gemini-3.8-flash high junie` with `exit=0`.

5. Run `hs; hx A='route --high'`, then `he A='route --high'`, then `AUTH="$HF/missing.json" he A=route`.
   - **Expected:** `claude-fable-5-1 max claude` with `exit=0`, then `none` with `exit=1` (`--high` never uses hermes), then `none` with `exit=1` (nothing windowed is available).

6. Run `hx NO_COLOR=1 A='--once route' | head -1`, then `hx NO_COLOR=1 A=routes | head -1`.
   - **Expected:** twice a line starting `DANDELION` followed by a time: only a first argument of `route` routes.

7. Run `hs; mkdir -p "$RX/state"; hx A= NO_COLOR=1`. Once settled, press `?`, then `k`, then space. Wait 2s. Press `q`. Run it again, press `j`, space, `q`. Run `cat "$ST"; rm -r "$RX/state"`.
   - **Expected:** the left box shows `grok-4.6 xhigh` over `grok`, the right `claude-fable-5-1 max` over `claude`. `?` adds the footer `keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help`. First `k` puts `▸` on kilo; space flashes `not routable (no usage windows)` for about 2s, then `api balance · kilo`. Second run: `j` then space shows `routing off` on claude, and the file holds `"claude": false`. Each run ends `exit=0`.

8. Run `hs ok 3.3; rq A= NO_COLOR=1 DANDELION_HERMES_AUTH_FILE="$HA" DANDELION_HERMES_PORTAL_BASE=http://127.0.0.1:48016`, look at the fleet summary and the boxes, press `q`. Run it again after `hs ok 5.5`.
   - **Expected:** only hermes has a window. First: hermes `credits` at `85%`, summary exactly `1/1 windows above 80% · next reset: hermes credits in 3d0h` (or `2d23h`), left box `x-ai/grok-4.6 xhigh` / `hermes`, right box `none` / `no subscription available`. Second: summary exactly `all windows below 80% · next reset: hermes credits in 3d0h` (or `2d23h`).

9. Run `bare 2>&1 | tee /tmp/017.bare`.
   - **Expected:** `exit=0` within 5s. Ten dim panels in order, no gauges: `claude CLI not found in PATH` / `claude · personal · claude`; `claude CLI not found in PATH` / `claude · work · claude-work`; `agy CLI not found in PATH` / `agy · agy`; `kimi CLI not found in PATH` / `kimi code · kimi`; `no grok billing snapshot — run grok once` / `grok · grok`; `codex CLI not found in PATH` / `codex · codex`; `no cursor auth — run cursor-agent login` / `cursor · cursor`; `no junie quota snapshot — run junie once` / `junie · junie`; `no hermes auth — run hermes portal login` / `hermes · hermes`; `kilo CLI not found in PATH` / `api balance · kilo`.

10. Run `: > "$HF/requests.log"; ha past; he NO_COLOR=1 A=--once 2>&1 | tee /tmp/017.exp; echo LOG; cat "$HF/requests.log"; ha; AUTH="$HF/missing.json" he NO_COLOR=1 A=--once; hs unauthorized; : > "$HF/requests.log"; he NO_COLOR=1 A=--once 2>&1 | tee /tmp/017.401; grep -cE 'qa-dummy-hermes-(agent-key|access)-016' /tmp/017.401; cat "$HF/requests.log"; ha; hs`.
    - **Expected:** first `hermes token expired — run hermes once` and `hermes · hermes`, LOG empty. Then `no hermes auth — run hermes portal login`. Then `hermes account request failed: HTTP 401` within 5s, grep prints `0`, log is `GET /api/oauth/account Bearer qa-dummy-hermes-agent-key-016 application/json`.

11. Run `node -p 'const p=require("./package.json"); [p.name, JSON.stringify(p.bin), p.scripts, p.dependencies]'; grep -n 'All ten probes\|hermes\|junie' README.md`.
    - **Expected:** `['dandelion', '{"dandelion":"src/main.ts"}', { start: 'node src/main.ts', test: 'vitest run', qa: 'node qa/e2e.mjs' }, undefined]`. README still has "All ten probes run in parallel", hermes between junie and kilo, and `--high` does not use hermes.

12. Run `pkill -f "$HF/server.mjs"; rm -rf "$H0" /tmp/017.once /tmp/017.b /tmp/017.h1 /tmp/017.h2 /tmp/017.bare /tmp/017.exp /tmp/017.401`, then the clean-up of `qa/016-hermes.md`.
    - **Expected:** nothing is left in `/tmp` from this procedure. The 001–016 e2e files were not edited.
