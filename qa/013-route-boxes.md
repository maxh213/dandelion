# QA Procedure: 013 - Route boxes at the top of the live dashboard

Earlier procedures are unchanged by 013. The live dashboard gains four lines between the fleet summary line and the first panel: two 35-cell boxes showing the `route` and `route --high` answers. `--once`, `route` and `route --high` output is unchanged.

Set up once in the repo root, in a real terminal (bash, util-linux `script`). First run the set-up blocks of `qa/010-route-command.md` and `qa/012-route-high.md`, so `$RX`, `$RH`, `$TZQ`, `$ST`, the `q` fixture, `rt`, `$RX/h` and `rh` exist and the cursor fixture still serves port 48010. Then add `bv`, which runs the live dashboard against the 012 claude fixture (`$RX/h` first on PATH), taking an optional override dir in `$PRE` and `NC=1` for NO_COLOR; `$SL` holds a kilo that waits 3 s; `$FIX` is the full healthy fixture (personal 3/86/100, work 0/12/23, the other providers healthy). `$CAP` is a capture file.

```bash
export SL="$(mktemp -d)" CAP="$(mktemp)"; printf '#!/bin/sh\nsleep 3\necho '\''Balance: $14.15'\''\n' > "$SL/kilo"; chmod +x "$SL/kilo"
FIX=(H_CLAUDE=3,86,100 H_WORK=0,12,23 Q_AGY=50,50,72 Q_KIMI=85,85,72 Q_GROK=90,72 Q_CURSOR=80,72)
bv() { env -i HOME="$RH" TZ="$TZQ" PATH="${PRE:+$PRE:}$RX/h:$RX:$NODEBIN" TERM="$TERM" ${NC:+NO_COLOR=1} DANDELION_KIMI_PORT=$KQ DANDELION_CURSOR_API_BASE=http://127.0.0.1:48010 DANDELION_STATE_FILE="$ST" "$@" sh -c 'q prep && node "$1/src/main.ts"; echo "exit=$?"' - "$PWD"; }; export -f bv
```

1. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including `013-route-boxes.e2e.mjs`. `pgrep` prints nothing.

2. Run `PRE="$SL" NC=1 bv "${FIX[@]}"` and watch from the start.
   - **Expected:** the alternate screen appears. The first frame's lines 3 to 6 are two boxes titled `+- route -…-+` and `+- route --high -…-+`, each showing `⠋ probing…` over an empty row. Within about 1 s every panel except kilo settles, while both boxes still show `probing…` with the spinner advancing. About 3 s in, kilo settles and the boxes become exactly:
     ```
     +- route -------------------------+  +- route --high ------------------+
     | claude-opus-5 high              |  | claude-fable-5-1 max            |
     | claude-work                     |  | claude-work                     |
     +---------------------------------+  +---------------------------------+
     ```
     Press `q`; `exit=0` prints.

3. Run `rh A=route "${FIX[@]}"`, then `rh "${FIX[@]}"`.
   - **Expected:** `claude-opus-5 high claude-work` with `exit=0`, then `claude-fable-5-1 max claude-work` with `exit=0`. Each line's two parts are the two rows of the matching box in step 2.

4. Run `NC=1 bv "${FIX[@]}"`. Once settled, press `j`, `j`, then space. Then press `k`. Then press `j` and space. Then `q`.
   - **Expected:** after space, on the same frame, the claude-work header shows `routing off` and the boxes are exactly:
     ```
     +- route -------------------------+  +- route --high ------------------+
     | gemini-3.1-pro-high medium      |  | kimi-k3-max                     |
     | agy                             |  | cursor                          |
     +---------------------------------+  +---------------------------------+
     ```
     After `k`, `▸` is on the claude panel and appears on no box line. After the second space, the boxes are back to the step 2 block and the tag is gone. `exit=0` prints.

5. Run `PRE="$SL" NC=1 bv "${FIX[@]}"`. Once settled, press `r` and watch the boxes for the next 3 s. Then `q`.
   - **Expected:** the banner shows `refreshing…`, no panel goes back to `probing…`, and the boxes keep showing the step 2 block the whole time, including after the round settles.

6. Run `NC=1 bv` with no fixture variables. Once settled, read the boxes. Then `q`.
   - **Expected:** codex and kilo panels are ok, every other panel is dim, and both boxes show `none` over `no subscription available`:
     ```
     +- route -------------------------+  +- route --high ------------------+
     | none                            |  | none                            |
     | no subscription available       |  | no subscription available       |
     +---------------------------------+  +---------------------------------+
     ```

7. Run `NC=1 bv Q_KIMI=10,10,72`. Once settled, read the boxes. Then `q`.
   - **Expected:** the route box shows `kimi-code/kimi-for-coding-high…` (31 cells, ending in `…`) over `kimi`; the `route --high` box shows `none` over `no subscription available`.

8. Run `NC=1 script -qfc 'bv H_CLAUDE=3,86,100 H_WORK=0,12,23 Q_AGY=50,50,72 Q_KIMI=85,85,72 Q_GROK=90,72 Q_CURSOR=80,72' "$CAP"`, wait for the boxes, then press `q`. Run `grep -ao $'\e\[[0-9;?]*[a-zA-Z]' "$CAP" | sort -u`, then `grep -c '+- route --high' "$CAP"`.
   - **Expected:** the first command lists only the screen control sequences `ESC[H`, `ESC[2J`, `ESC[?25h`, `ESC[?25l`, `ESC[?1049h` and `ESC[?1049l` — no colour or bold escapes. The count is at least `1`.

9. Run `script -qfc 'bv H_CLAUDE=3,86,100 H_WORK=0,12,23 Q_AGY=50,50,72 Q_KIMI=85,85,72 Q_GROK=90,72 Q_CURSOR=80,72' "$CAP"` (no `NC`), watch, then press `q`. Run `grep -c $'\e\[90m┌─ route ' "$CAP"; grep -c $'\e\[1m claude-opus-5 high' "$CAP"; grep -c $'\e\[1m claude-fable-5-1 max' "$CAP"`.
   - **Expected:** on screen the box borders are grey, the model lines are bold and the provider rows are plain. Each count is at least `1`.

10. Run `rh A=--once NO_COLOR=1 "${FIX[@]}" > "$RX/o013"; grep -c -- '+- route\|─ route' "$RX/o013"; head -1 "$RX/o013"`.
    - **Expected:** `0` (no box lines), then a line starting `DANDELION`. The output is the 012 dashboard for the fixture: banner and eight panels, no summary line, no `probing…`, no boxes. Byte-identity with the pre-013 `--once` is pinned by the unchanged 001 to 012 e2es in step 1.

11. Run `grep -n 'npm start' README.md`, then `rm -rf "$SL" "$CAP" "$RX/o013"`, then the clean-up in step 13 of `qa/012-route-high.md` and step 10 of `qa/010-route-command.md`.
    - **Expected:** the `npm start` bullet says the live dashboard shows the `route` and `route --high` answers in two boxes at the top, updated when a round settles or routing is toggled. Nothing is left in `/tmp` from this procedure.
