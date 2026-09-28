# QA Procedure: 021 - route lines from routes.json, claude as Opus 5.5

After 021, `route` and `route --high` print lines read from `routes.json` at the repo root, or from `DANDELION_ROUTES_FILE`. Earlier procedures keep their inputs and outcomes but route with a fixture file of made-up lines. Only step 1 names real models. It records what shipped with 021, so the e2e for this procedure reads the expected lines from `routes.json` instead of pinning them.

Set up once in the repo root, in a real terminal (bash, GNU tools). Run the set-up blocks of `qa/020-route-kimi-k3-grok-47.md`, `qa/012-route-high.md` and `qa/013-route-boxes.md`, so `rt`, `rh`, `hx`, `hs`, `jh`, `bv`, `$FIX`, `$RX`, `$RH`, `$TZQ`, `$NODEBIN` and `$JH` exist. `$F` selects the fixture file F of `features/021-route-lines-from-config.feature`. `bad 'js'` writes `$RF/bad.json`, which is F changed by `js` (`f` is the parsed file). `re` runs `route` and `route --high` on `$RF/bad.json`, and prints each stdout, then each stderr.

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
bad() { node -e 'const fs=require("fs"),f=JSON.parse(fs.readFileSync(process.argv[1]));eval(process.argv[2]);fs.writeFileSync(process.argv[3],JSON.stringify(f))' "$RF/f.json" "$1" "$RF/bad.json"; }
re() { for m in route 'route --high'; do rt A="$m" DANDELION_ROUTES_FILE="${1:-$RF/bad.json}" Q_GROK=50,72 2>"$RF/err"; cat "$RF/err"; done; }
```

1. Run `node -e 'const fs=require("fs");const t=fs.readFileSync("tasks/021-route-lines-from-config.md","utf8").split("```json")[1].split("```")[0];require("assert").deepStrictEqual(JSON.parse(fs.readFileSync("routes.json")),JSON.parse(t));console.log("SAME")'`. Then run `rt Q_CLAUDE=0,3,2 Q_AGY=10,10,72`, `rt DANDELION_ROUTES_FILE= Q_CLAUDE=0,86,2`, `rh H_CLAUDE=10,10,95` and `rt Q_GROK=50,72`.
   - **Expected (true when 021 shipped):** `SAME`, then `claude-opus-5-5 high claude`, `claude-opus-5-5 max claude`, `claude-opus-5-5 max claude` and `grok-4.7 xhigh grok`, each followed by `exit=0`.

2. Run `rt "$F" Q_CLAUDE=0,86,2 Q_AGY=0,0,72`, `rt "$F" Q_CLAUDE=0,3,2 Q_AGY=10,10,72`, `rt "$F" Q_CLAUDE=20,30,72 Q_WORK=10,5,72 Q_AGY=15,20,72`, `rt "$F" Q_AGY=0,90,2 Q_KIMI=0,90,2`, `rt "$F" Q_KIMI=10,10,72 Q_GROK=50,72`, `rt "$F" Q_GROK=50,72`, `rt "$F" Q_CURSOR=40,72` and `rt "$F"`.
   - **Expected:** `model-a max claude`, `model-a high claude`, `model-b high claude-work`, `model-c max agy`, `model-d kimi`, `model-e xhigh grok` and `model-f cursor`, each with `exit=0`. The last prints `none` then `exit=1`.

3. Run `hs; hx "$F"`, then `hs ok 22; hx "$F"`, then `jh "$JH" 1000000; hx "$F"`, then `jh "$JH" 701512.73275; hs`.
   - **Expected:** `model-e xhigh grok`, `vendor/model-h xhigh hermes` and `model-g high junie`, each with `exit=0`.

4. Run `rh "$F" H_CLAUDE=3,86,10`, `rh "$F" H_CLAUDE=95,10,10 Q_CURSOR=60,72`, `rh "$F" H_CLAUDE=10,10,95`, `rh "$F" H_CLAUDE=95,10,10 Q_CURSOR=95,72 Q_GROK=60,72`, `rh "$F" Q_AGY=10,10,72` and `rh "$F"`.
   - **Expected:** `model-h1 max claude`, `model-h2 cursor`, `model-h3 max claude`, `model-h4 xhigh grok` and `model-h5 high agy`, each with `exit=0`, then `none` and `exit=1`.

5. Mimic `npm link` and a run from another repo. Run `mkdir -p "$RF/d/cwd" "$RF/d/lib" "$RF/d/bin"; ln -s "$PWD" "$RF/d/lib/dandelion"; ln -s "$RF/d/lib/dandelion/src/main.ts" "$RF/d/bin/dandelion"; for d in cwd lib bin .; do sed 's/model-/decoy-/g' "$RF/f.json" > "$RF/d/$d/routes.json"; done`. Add `dl() { (cd "$RF/d/cwd" && env -i HOME="$RH" TZ="$TZQ" PATH="$RF/d/bin:$RX:$NODEBIN" Q_GROK=50,72 "$@" sh -c 'q prep && dandelion route; echo "exit=$?"'); }`. Then run `dl`, `dl DANDELION_ROUTES_FILE=` and `dl DANDELION_ROUTES_FILE=routes.json`.
   - **Expected:** the first two print the grok line of the checkout's `routes.json` then ` grok` (`grok-4.7 xhigh grok` at 021), with no `decoy`. The last prints `decoy-e xhigh grok`, from the working directory's file. Each is followed by `exit=0`.

6. Run `re "$RF/nope.json"`, `re "$RF"`, then `printf '{"route":' > "$RF/bad.json"; re`, then `: > "$RF/bad.json"; re`, then `echo '[]' > "$RF/bad.json"; re`, then `rt DANDELION_ROUTES_FILE="$RF/nope.json"`.
   - **Expected:** each `re` prints `exit=2`, `exit=2`, then two stderr lines that start `dandelion: routes file <the path given>: `, with nothing else on stdout. The last `rt` prints only `exit=2`, not `none`: a bad file wins over no quota.

7. For each `js` below, run `bad 'js'; re`.
   `delete f.route.hermes` · `delete f.high.opus` · `delete f.route.agy.max` · `f.route.claude="model-a high"` · `f.route.kimi.standard=""` · `f.high.grok=4` · `f.route["claude-wrok"]=f.route.claude` · `f.route.codex=f.route.cursor` · `f.high.sonnet="model-x"` · `f.extra={}` · `f.route.cursor.maxx="model-f"` · `f.route.claude.max="model-a max extra"` · `f.high.fable=" model-h1 max"` · `f.route.grok.standard="model-e xhigh "` · `f.route.junie.max="model-g  high"` · `f.route.hermes.standard="vendor/model-h\txhigh"`
   - **Expected:** each prints `exit=2`, `exit=2`, then two lines `dandelion: routes file $RF/bad.json: …`. Those lines name, in order, `hermes`, `opus`, `agy`, `claude`, `kimi`, `grok`, `claude-wrok`, `codex`, `sonnet`, `extra`, `maxx`, `claude`, `fable`, `grok`, `junie` and `hermes`.

8. Run `mkdir "$RF/c"; cp -r src package.json "$RF/c"`. Then run `env -i HOME="$RH" TZ="$TZQ" PATH="$RX:$NODEBIN" Q_GROK=50,72 sh -c 'q prep && node "$1/src/main.ts" route; echo "exit=$?"' - "$RF/c"`, then the same with `DANDELION_ROUTES_FILE="$RF/f.json"` after `Q_GROK=50,72`. Then run `cp routes.json "$RF/c/"; node -e 'const p=process.argv[1],f=JSON.parse(require("fs").readFileSync(p));f.route.claude.standard="model-z high";require("fs").writeFileSync(p,JSON.stringify(f))' "$RF/c/routes.json"`, and the first command again with `Q_CLAUDE=0,3,2 Q_AGY=10,10,72` in place of `Q_GROK=50,72`.
   - **Expected:** first, stdout is only `exit=2` and stderr is `dandelion: routes file <real path of $RF/c>/routes.json: …`. Then `model-e xhigh grok` and `exit=0`. Last, `model-z high claude` and `exit=0`: a one-line edit changes the routed model.

9. Run `bad 'f.route["claude-wrok"]=f.route.claude'; NC=1 bv "${FIX[@]}" DANDELION_ROUTES_FILE="$RF/bad.json"`. Wait for it to settle, read the screen, then press `q`. Run it again with `"$F"` in place of `DANDELION_ROUTES_FILE=…`.
   - **Expected:** first, every panel shows what the second run shows. Both boxes are dim and show `routes file error` over a row containing `claude-wrok`. `q` prints `exit=0`. Second run: the route box shows `model-b high` over `claude-work`, and the `route --high` box shows `model-h1 max` over `claude-work`.

10. Run `rh A=--once NO_COLOR=1 "${FIX[@]}" DANDELION_ROUTES_FILE="$RF/bad.json" > "$RF/o1" 2> "$RF/e1"; rh A=--once NO_COLOR=1 "${FIX[@]}" "$F" > "$RF/o2" 2> "$RF/e2"; diff <(sed 1d "$RF/o1") <(sed 1d "$RF/o2"); cat "$RF/e1"; wc -c < "$RF/e2"`.
    - **Expected:** `diff` is empty, or shows only `↻` countdowns that ticked. Both outputs end `exit=0`. `e1` is one line that starts `dandelion: routes file ` and contains `claude-wrok`. `wc` prints `0`.

11. Run `grep -rlE 'claude-opus|claude-fable|gemini-3|kimi-code/|kimi-k3|grok-4\.' src perf qa; grep -n 'routes.json\|DANDELION_ROUTES_FILE' README.md; git diff --stat origin/main -- tasks features/0[01]* features/020*`.
    - **Expected:** `grep -rl` lists only `qa/021-route-lines-from-config.md`. The README documents `routes.json`, its shape, `DANDELION_ROUTES_FILE`, the exit-2 errors and "to change a routed model, edit routes.json". Its route and `--high` tables name providers and ranks, but not lines. `git diff` lists only `tasks/021-route-lines-from-config.md` (if any file).

12. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa`.
    - **Expected:** exits 0 and every `*.e2e.mjs` prints PASS, including `021-route-lines-from-config.e2e.mjs`. `pgrep` prints nothing.

13. Run `rm -rf "$RF"`, then the clean-up of `qa/013-route-boxes.md` and `qa/020-route-kimi-k3-grok-47.md`.
    - **Expected:** nothing is left from this procedure.
