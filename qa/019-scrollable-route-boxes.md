# QA Procedure: 019 - Live dashboard fits the terminal; scrollable panel list

Earlier procedures are unchanged by 019. Every live frame is now at most `process.stdout.rows` lines (default 24): the banner, fleet summary and the two route boxes are always the first six lines, the provider panels scroll as a region under them with `↑↓/jk` (the selected panel's header is the region's first line; with nothing selected the region starts at personal `claude`), and the help footer, when on, is the last line. `--once`, `route` and `route --high` are unchanged and never clipped.

Set up once in the repo root, in a real terminal (bash, util-linux `script`, perl). First run the set-up blocks of `qa/010-route-command.md`, `qa/012-route-high.md` and `qa/013-route-boxes.md`, so `$RX`, `$RH`, `$NODEBIN`, `$TZQ`, `$ST`, `rh`, `bv`, `$FIX` and `$CAP` exist and the cursor fixture still serves port 48010. Then replace `$RX/kimi` — the 010 `q` symlink serves the pre-018 envelope, which the current probe rejects with `Could not parse usage from response` — with the kimi 2.0 server from the set-up block of `qa/018-kimi-usage.md` (only its `rm -f "$RX/kimi"`, `cat > "$RX/kimi" <<'EOF' … EOF` and `chmod` lines; the `$K2` mode-file fixture is not needed), so `Q_KIMI=85,85,72` paints kimi healthy. Then add `bv12`, which runs the live dashboard under NO_COLOR on a 12-row × 80-column pty, and `lf`, which prints the last frame of the `$CAP` capture (everything after the last `ESC[H ESC[2J`, up to the restore sequence):

```bash
bv12() { NC=1 script -qfc "stty rows 12 cols 80; $*" "$CAP"; }
lf() { perl -0777 -ne 's/\r\n/\n/g; my @f = split /\e\[H\e\[2J/; my $l = $f[-1] // ""; $l =~ s/\e\[\?25h.*//s; print $l; }' "$CAP"; }
```

1. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including a new `019-scrollable-route-boxes.e2e.mjs`. `pgrep` prints nothing. (Every 001–018 assertion, fixture and key press keeps its bytes; the one permitted edit to existing qa/ files is the launcher line, because a piped `script` pty reports 0×0 and the 24-row fallback would clip live frames: `qa/live-session.mjs` `startLive` gains rows and columns parameters, defaulting to 60×80, and prefixes its `script` command with `stty rows … cols …; `, while the private `startLive` copies in 011, 015, 016 and 017 hardcode the `stty rows 60 cols 80; ` prefix. The 019 e2e alone calls the shared launcher with 12×80.)

2. Unit-render a settled live view with `rows: 12`, `selected: -1` and every provider of the 018 set present. The fixture carries the probes' real planLabels (claude `claude · personal`, claude-work `claude · work`, agy `agy`, kimi `kimi code`, grok `SuperGrok`, codex `codex`, cursor `Ultra`, junie `junie`, hermes `hermes`, kilo `api balance`) and grok's snapshot line, so every panel height is the live one. Run:
   ```bash
   node --input-type=module -e '
   import { renderLiveFrame, renderDashboard } from "./src/render/terminal.ts";
   const NOW = new Date().toISOString();
   const LATER = new Date(Date.now() + 72 * 3600000).toISOString();
   const win = (label, kind, usedPct) => ({ label, kind, usedPct, resetsAt: LATER });
   const ok = (id, planLabel, windows, extra = {}) => ({ id, displayName: id, planLabel, windows, fetchedAt: NOW, status: "ok", ...extra });
   const dim = (id, planLabel, reason) => ({ id, displayName: id, planLabel, windows: [], fetchedAt: NOW, status: "unavailable", reason });
   const usages = [
     ok("claude", "claude · personal", [win("session", "rolling", 3), win("weekly", "weekly", 86), win("weekly Fable", "weekly", 100)]),
     ok("claude-work", "claude · work", [win("session", "rolling", 0), win("weekly", "weekly", 12), win("weekly Fable", "weekly", 23)]),
     ok("agy", "agy", [win("Gemini Models · Five Hour Limit", "rolling", 50), win("Gemini Models · Weekly Limit", "weekly", 50)]),
     ok("kimi", "kimi code", [win("weekly", "weekly", 85), win("5h", "rolling", 85)]),
     ok("grok", "SuperGrok", [win("credits", "weekly", 90)], { snapshotAt: NOW }),
     ok("codex", "codex", [], { note: "api-key billing · no usage windows" }),
     ok("cursor", "Ultra", [win("total", "weekly", 80), win("auto", "weekly", 80), win("api", "weekly", 80)]),
     dim("junie", "junie", "no junie quota snapshot — run junie once"),
     dim("hermes", "hermes", "no hermes auth — run hermes portal login"),
     ok("kilo", "api balance", [], { balance: { amount: 14.15, currency: "$", reference: 20 } })
   ];
   const view = { slots: usages.map((usage) => ({ id: usage.id, usage })), spinner: 0, refreshing: false, footer: false, ineligible: [], zone: "UTC", settled: usages, selected: -1, rows: 12 };
   const lines = renderLiveFrame(view, true, NOW).split("\n");
   console.log("lines:", lines.length, "| line3:", JSON.stringify(lines[2]), "| line8:", JSON.stringify(lines[7]), "| kilo present:", lines.some((l) => l.includes("kilo")));
   const once = renderDashboard(usages, true, NOW, []);
   console.log("once lines:", once.split("\n").length, "| once boxes:", once.includes("+- route"), "| once ids:", ["claude", "claude-work", "agy", "kimi", "grok", "codex", "cursor", "junie", "hermes", "kilo"].every((id) => once.includes("\n" + id + "\n")));
   '
   ```
   - **Expected:** `lines: 12`, line 3 starts `+- route ` and holds both box titles, `line8: "claude"` (line 1 is the banner, line 2 the summary, lines 3–6 the two boxes, then the personal claude panel), `kilo present: false`. Then `once lines: 50`, `once boxes: false` and `once ids: true`: `--once` for the same usages still contains every provider and no boxes, and is not clipped.

3. Run `bv12 bv "${FIX[@]}"`. Watch until the round settles (both boxes show the `claude-opus-5 high` / `claude-fable-5-1 max` answers over `claude-work`), before pressing any key. Read the frame on screen. Press `q`, then run `lf | grep -c ''`, `lf | sed -n '3p;8p'` and `lf | grep -c kilo`.
   - **Expected:** on screen the frame is 12 lines: banner, summary, the two boxes on lines 3–6, then the personal `claude` panel; it does not start on `claude-work` and no `kilo` line is visible. After `q`: `exit=0` prints, the count is `12`, line 3 starts with `+- route`, line 8 is `claude`, and the `kilo` count is `0`.

4. Run `bv12 bv "${FIX[@]}"` again. Once settled, press `j` ten times and read the frame on screen. Press `q`, then run `lf | grep -c ''`, `lf | sed -n '3p;7p'` and `lf | grep -xc claude`.
   - **Expected:** on screen the boxes stay on lines 3–6 and the region below shows `▸ kilo`, its balance row and its caption; personal `claude` is gone. After `q`: the count is `9` (no padding at the end of the list), line 3 starts with `+- route`, line 7 is `▸ kilo`, and the exact-`claude` count is `0`.

5. Run `bv12 bv "${FIX[@]}"` again. Once settled, press `j` ten times, then `k` nine times, then `?`. Read the frame on screen. Press `q`, then run `lf | grep -c ''`, `lf | sed -n '7p'`, `lf | tail -n 1` and `grep -ac '▸ kilo' "$CAP"`.
   - **Expected:** on screen the frame is 12 lines, the boxes are on lines 3–6, line 7 is `▸ claude` (personal, not `claude-work`) and the last line is the help footer. After `q`: `exit=0` prints, the count is `12`, line 7 is `▸ claude`, the last line is `keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help`, and the capture holds at least one `▸ kilo` frame from the walk down.

6. Run `NC=1 script -qfc 'stty rows 12 cols 80; (sleep 3; stty rows 30; sleep 3; stty rows 10; sleep 3; stty rows 4) & bv H_CLAUDE=3,86,100 H_WORK=0,12,23 Q_AGY=50,50,72 Q_KIMI=85,85,72 Q_GROK=90,72 Q_CURSOR=80,72' "$CAP"` and watch until about 10 s in, then press `q`.
   - **Expected:** the frame redraws at each resize against the new height: at 30 rows it is 30 lines (banner, summary, boxes, then the panels from the claude rule on, ending inside the grok panel, no blank padding); at 10 rows it is 10 lines with the claude panel cut after its second window row; at 4 rows it is exactly the banner, the summary and the first two box lines. The banner is line 1 throughout, the box titles are on line 3 whenever at least 6 rows remain, and `exit=0` prints.

7. Run `rh A=--once NO_COLOR=1 "${FIX[@]}" > "$RX/o019"; grep -c -- '+- route\|─ route' "$RX/o019"; wc -l < "$RX/o019"; grep -c '^DANDELION' "$RX/o019"`.
   - **Expected:** `0` box lines, `51` lines — the banner, the ten full panels (49 lines, not clipped to 12) and `rh`'s own `exit=0` line, which lands in the same redirect — and one banner line. Every panel header (claude, claude-work, agy, kimi, grok, codex, cursor, junie, hermes, kilo) appears, in that order, as in the 013 `--once` shape.

8. Run `grep -n -A3 'npm start' README.md`, then `rm -f "$RX/o019" "$CAP"`, then the clean-up in step 11 of `qa/013-route-boxes.md`, step 13 of `qa/012-route-high.md` and step 10 of `qa/010-route-command.md`.
   - **Expected:** the `npm start` bullet says the live dashboard fits the terminal: the `route` and `route --high` boxes stay at the top, and the provider list scrolls with `↑↓/jk` so earlier panels (including personal `claude`) stay reachable. Nothing is left in `/tmp` from this procedure.
