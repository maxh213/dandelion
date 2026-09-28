# QA Procedure: 021 - route lines from routes.json, claude as Opus 5.5

After 021, `route` and `route --high` print lines read from `routes.json` at the repo root, or from `DANDELION_ROUTES_FILE`. Earlier procedures keep their inputs and outcomes but route with a fixture file of made-up lines. Only step 1 names real models. It records what shipped with 021, so the e2e for this procedure reads the expected lines from `routes.json` instead of pinning them.

Set up once in the repo root, in a real terminal (bash, GNU tools). Run the set-up blocks of `qa/020-route-kimi-k3-grok-47.md`, `qa/012-route-high.md` and `qa/013-route-boxes.md`, so `rt`, `rh`, `hx`, `hs`, `jh`, `bv`, `$FIX`, `$RX`, `$RH`, `$TZQ`, `$NODEBIN`, `$JH` and `$CAP` exist. `$F` selects the fixture file F of `features/021-route-lines-from-config.feature`, and `$R` selects R, which is F with the keys of `route` and of `high` each in reverse order. `bad 'js'` writes `$RF/bad.json`, which is F changed by `js` (`f` is the parsed file). `re` runs `route`, then `route --high`, on `$RF/bad.json`, and after each prints its stderr, so the output is `exit=…`, a stderr line, `exit=…`, a stderr line.

```bash
export RF="$(mktemp -d)"
cat > "$RF/f.json" <<'EOF'
{ "route": {
    "claude":      { "standard": "model-a high",         "max": "model-a max" },
    "claude-work": { "standard": "model-b high",         "max": "model-b max" },
    "agy":         { "standard": "model-c high",         "max": "model-c max" },
    "kimi":        { "standard": "model-d",              "max": "model-d max" },
    "grok":        { "standard": "model-e xhigh",        "max": "model-e xhigh" },
    "cursor":      { "standard": "model-f",              "max": "model-f" },
    "junie":       { "standard": "model-g high",         "max": "model-g high" },
    "hermes":      { "standard": "vendor/model-h xhigh", "max": "vendor/model-h xhigh" } },
  "high": { "fable": "model-h1 max", "cursor": "model-h2", "opus": "model-h3 max", "grok": "model-h4 xhigh", "agy": "model-h5 high" } }
EOF
F="DANDELION_ROUTES_FILE=$RF/f.json"
node -e 'const fs=require("fs"),f=JSON.parse(fs.readFileSync(process.argv[1])),rv=o=>Object.fromEntries(Object.entries(o).reverse());fs.writeFileSync(process.argv[2],JSON.stringify({high:rv(f.high),route:rv(f.route)}))' "$RF/f.json" "$RF/r.json"
R="DANDELION_ROUTES_FILE=$RF/r.json"
bad() { node -e 'const fs=require("fs"),f=JSON.parse(fs.readFileSync(process.argv[1]));eval(process.argv[2]);fs.writeFileSync(process.argv[3],JSON.stringify(f))' "$RF/f.json" "$1" "$RF/bad.json"; }
re() { for m in route 'route --high'; do rt A="$m" DANDELION_ROUTES_FILE="${1:-$RF/bad.json}" Q_GROK=50,72 2>"$RF/err"; cat "$RF/err"; done; }
```

1. Run `node -e 'const fs=require("fs");const t=fs.readFileSync("tasks/021-route-lines-from-config.md","utf8").split("```json")[1].split("```")[0];require("assert").deepStrictEqual(JSON.parse(fs.readFileSync("routes.json")),JSON.parse(t));console.log("SAME")'`. Then run `rt DANDELION_ROUTES_FILE= Q_CLAUDE=0,3,2 Q_AGY=10,10,72`, `rt DANDELION_ROUTES_FILE= Q_CLAUDE=0,86,2`, `rh DANDELION_ROUTES_FILE= H_CLAUDE=10,10,95` and `rt DANDELION_ROUTES_FILE= Q_GROK=50,72`. Each call empties `DANDELION_ROUTES_FILE`, so it reads the shipped file even if a helper from an earlier procedure sets a fixture.
   - **Expected (true when 021 shipped):** `SAME`, then `claude-opus-5-5 high claude`, `claude-opus-5-5 max claude`, `claude-opus-5-5 max claude` and `grok-4.7 xhigh grok`, each followed by `exit=0`.

2. Run `rt "$F" Q_CLAUDE=0,86,2 Q_AGY=0,0,72`, `rt "$F" Q_CLAUDE=0,3,2 Q_AGY=10,10,72`, `rt "$F" Q_CLAUDE=20,30,72 Q_WORK=10,5,72 Q_AGY=15,20,72`, `rt "$F" Q_AGY=0,90,2 Q_KIMI=0,90,2`, `rt "$F" Q_KIMI=10,10,72 Q_GROK=50,72`, `rt "$F" Q_GROK=50,72`, `rt "$F" Q_CURSOR=40,72` and `rt "$F"`.
   - **Expected:** `model-a max claude`, `model-a high claude`, `model-b high claude-work`, `model-c max agy`, `model-d kimi`, `model-e xhigh grok` and `model-f cursor`, each with `exit=0`. The last prints `none` then `exit=1`.

3. Run `hs; hx "$F"`, then `hs ok 22; hx "$F"`, then `jh "$JH" 1000000; hx "$F"`, then `jh "$JH" 701512.73275; hs`.
   - **Expected:** `model-e xhigh grok`, `vendor/model-h xhigh hermes` and `model-g high junie`, each with `exit=0`.

4. Run `rh "$F" H_CLAUDE=3,86,10`, `rh "$F" H_CLAUDE=95,10,10 Q_CURSOR=60,72`, `rh "$F" H_CLAUDE=10,10,95`, `rh "$F" H_CLAUDE=95,10,10 Q_CURSOR=95,72 Q_GROK=60,72`, `rh "$F" Q_AGY=10,10,72` and `rh "$F"`.
   - **Expected:** `model-h1 max claude`, `model-h2 cursor`, `model-h3 max claude`, `model-h4 xhigh grok` and `model-h5 high agy`, each with `exit=0`, then `none` and `exit=1`.

5. Key order in the file must not matter. Run `head -c 120 "$RF/r.json"; echo`, then `rt "$R" Q_AGY=0,90,2 Q_KIMI=0,90,2`, `hs ok 22; jh "$JH" 1000000; hx "$R"; jh "$JH" 701512.73275; hs`, `rh "$R" H_CLAUDE=3,86,10 Q_AGY=10,10,72` and `rh "$R" H_CLAUDE=10,10,95 Q_GROK=60,72`.
   - **Expected:** the `head` output starts `{"high":{"agy":` and has `"route":{"hermes":`. Then `model-c max agy`, `model-g high junie`, `model-h1 max claude` and `model-h3 max claude`, each with `exit=0`. A build that takes tie or chain order from the file prints `model-d max kimi`, `vendor/model-h xhigh hermes`, `model-h5 high agy` or `model-h4 xhigh grok` instead.

6. Mimic `npm link` and a run from another repo. Run `mkdir -p "$RF/d/cwd" "$RF/d/lib" "$RF/d/bin"; ln -s "$PWD" "$RF/d/lib/dandelion"; ln -s "$RF/d/lib/dandelion/src/main.ts" "$RF/d/bin/dandelion"; for d in cwd lib bin .; do sed 's/model-/decoy-/g' "$RF/f.json" > "$RF/d/$d/routes.json"; done`. Add `dl() { (cd "$RF/d/cwd" && env -i HOME="$RH" TZ="$TZQ" PATH="$RF/d/bin:$RX:$NODEBIN" Q_GROK=50,72 "$@" sh -c 'q prep && dandelion route; echo "exit=$?"'); }`. Then run `dl`, `dl DANDELION_ROUTES_FILE=` and `dl DANDELION_ROUTES_FILE=routes.json`.
   - **Expected:** the first two print the grok line of the checkout's `routes.json` then ` grok`, with no `decoy`. The last prints `decoy-e xhigh grok`, from the working directory's file. Each is followed by `exit=0`.

7. Run `re "$RF/nope.json"`, `re "$RF"`, then `printf '{"route":' > "$RF/bad.json"; re`, then `: > "$RF/bad.json"; re`, then `echo '[]' > "$RF/bad.json"; re`, then `echo null > "$RF/bad.json"; re`, then `bad 'f.route=[]'; re`, then `bad 'f.high="x"'; re`, then `rt DANDELION_ROUTES_FILE="$RF/nope.json" 2>/dev/null`.
   - **Expected:** each `re` prints `exit=2`, a stderr line, `exit=2`, a stderr line, and nothing else. Each stderr line is one line starting `dandelion: routes file <the path given>: `, with no stack trace. For `f.route=[]` the lines name `route`; for `f.high="x"` they name `high`. The last `rt`, whose stderr is discarded, prints only `exit=2`, not `none`: a bad file wins over no quota.

8. For each `js` below, run `bad 'js'; re`.
   `delete f.route.hermes` · `delete f.high.opus` · `delete f.route.agy.max` · `f.route.claude="model-a high"` · `f.route.kimi.standard=""` · `f.high.grok=4` · `f.route["claude-wrok"]=f.route.claude` · `f.route.codex=f.route.cursor` · `f.high.sonnet="model-x"` · `f.extra={}` · `f.route.cursor.maxx="model-f"` · `f.route.claude.max="model-a max extra"` · `f.high.fable=" model-h1 max"` · `f.route.grok.standard="model-e xhigh "` · `f.route.junie.max="model-g  high"` · `f.route.hermes.standard="vendor/model-h\txhigh"`
   - **Expected:** each prints `exit=2`, a line `dandelion: routes file $RF/bad.json: …`, `exit=2`, and such a line again. Those lines name, in order, `hermes`, `opus`, `agy`, `claude`, `kimi`, `grok`, `claude-wrok`, `codex`, `sonnet`, `extra`, `maxx`, `claude`, `fable`, `grok`, `junie` and `hermes`.

9. Run `mkdir "$RF/c"; cp -r src package.json "$RF/c"`. Then run `env -i HOME="$RH" TZ="$TZQ" PATH="$RX:$NODEBIN" Q_GROK=50,72 sh -c 'q prep && node "$1/src/main.ts" route; echo "exit=$?"' - "$RF/c"`, then the same with `DANDELION_ROUTES_FILE="$RF/f.json"` after `Q_GROK=50,72`. Then run `cp routes.json "$RF/c/"; node -e 'const p=process.argv[1],f=JSON.parse(require("fs").readFileSync(p));f.route.claude.standard="model-z high";require("fs").writeFileSync(p,JSON.stringify(f))' "$RF/c/routes.json"`, and the first command again with `Q_CLAUDE=0,3,2 Q_AGY=10,10,72` in place of `Q_GROK=50,72`.
   - **Expected:** first, stdout is only `exit=2` and stderr is `dandelion: routes file <real path of $RF/c>/routes.json: …`. Then `model-e xhigh grok` and `exit=0`. Last, `model-z high claude` and `exit=0`: a one-line edit changes the routed model.

10. Run `bad 'f.route["claude-wrok"]=f.route.claude'; NC=1 bv "${FIX[@]}" DANDELION_ROUTES_FILE="$RF/bad.json"`. Wait for it to settle, read the screen, then press `q`. Run it again with `"$F"` in place of `DANDELION_ROUTES_FILE=…`. Then, without `NC`, run `script -qfc 'bv H_CLAUDE=3,86,100 H_WORK=0,12,23 Q_AGY=50,50,72 Q_KIMI=85,85,72 Q_GROK=90,72 Q_CURSOR=80,72 DANDELION_ROUTES_FILE="$RF/bad.json"' "$CAP"`, wait for it to settle, press `q`, and run `S="$(printf '%15s' '')"; grep -acF $'\e[90m│ routes file error'"$S"$'│\e[0m' "$CAP"; grep -acE $'\e\\[90m│ [^\e]*claude-wrok[^\e]*│\e\\[0m' "$CAP"; grep -acF $'\e[1m routes file error' "$CAP"; grep -ac $'\e\\[90m┌─ route ' "$CAP"`.
   - **Expected:** first run: every panel shows what the second run shows. Both boxes show `routes file error` over a row containing `claude-wrok`, and each box's row 1 is exactly `| routes file error` then 15 spaces then `|`. `q` prints `exit=0`. Second run: the route box shows `model-b high` over `claude-work`, and the `route --high` box shows `model-h1 max` over `claude-work`. Colour run: on screen both boxes are grey from border to border, with nothing bold in them. The four counts are at least `1`, at least `1`, `0` and at least `1`.

11. Run `rh A=--once NO_COLOR=1 "${FIX[@]}" DANDELION_ROUTES_FILE="$RF/bad.json" > "$RF/o1" 2> "$RF/e1"; rh A=--once NO_COLOR=1 "${FIX[@]}" "$F" > "$RF/o2" 2> "$RF/e2"; diff <(sed 1d "$RF/o1") <(sed 1d "$RF/o2"); tail -n1 "$RF/o1" "$RF/o2"; cat "$RF/e1"; wc -c < "$RF/e2"`.
    - **Expected:** `diff` is empty, or shows only `↻` countdowns that ticked. `tail` prints `exit=0` under each of the two file names. `e1` is one line that starts `dandelion: routes file ` and contains `claude-wrok`. `wc` prints `0`.

12. Run `grep -rlE 'claude-opus|claude-fable|gemini-3|kimi-code/|kimi-k3|grok-4\.' src perf qa; grep -n 'routes.json\|DANDELION_ROUTES_FILE' README.md; git diff --stat d99c410 -- 'tasks/0[01]*' 'tasks/020*' 'features/0[01]*' 'features/020*'`.
    - **Expected:** `grep -rl` lists only `qa/021-route-lines-from-config.md`. The README documents `routes.json`, its shape, `DANDELION_ROUTES_FILE`, the exit-2 errors and "to change a routed model, edit routes.json". Its route and `--high` tables name providers and ranks, but not lines. `git diff` prints nothing: the historical tasks and features are as they were when 021 was queued (`d99c410`).

13. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa`.
    - **Expected:** exits 0 and every `*.e2e.mjs` prints PASS, including `021-route-lines-from-config.e2e.mjs`. `pgrep` prints nothing.

14. Run `rm -rf "$RF"`, then the clean-up of `qa/013-route-boxes.md` and `qa/020-route-kimi-k3-grok-47.md`.
    - **Expected:** nothing is left from this procedure.
