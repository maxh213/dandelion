# QA Procedure: 022 - swarm seats and headless launch

After 022, `dandelion seats <N>` hands out swarm seats and `dandelion run --headless` launches one seat without a terminal. Earlier procedures are unchanged: `route`, `route --high`, plain `run`, the dashboard, `--json`, `--line` and `--waybar` print what they printed before. Every step answers from a fixture `snapshot.json` through `--max-age 600`, so no real probe runs, and `run --headless` launches a fake CLI, so no real agent runs. `qa/022-swarm-seats.e2e.mjs` automates these steps.

Set up once in the repo root, in a real terminal (bash, GNU tools). `$SW` is a scratch folder. `$F` is a routes file made from `qa/routes.fixture.json` plus a `swarm` section that excludes the work accounts with caps of 2, a `lab` section (`model-` is `lab-a`, `vendor/` is `lab-b`) and a `-p` stdin template for every command. `snap 'js'` writes `$SW/snapshot.json` with every account unavailable except those the object `js` gives windows to, fetched now; `w(s, k)` is a rolling `session` window at s% resetting in 3 hours plus a `weekly` window at k% resetting in 72 hours. `$BIN` holds only `node`, `sh` and a fake CLI linked as `claude` and `codex`: it writes its argv, stdin, working directory, `PWD` and `CODEX_HOME` to `seen.json` in its working directory, prints `fake stdout` and `fake stderr`, and exits 7, or stays alive when an argument is `sleep`. `$BARE` holds only `node` and `sh`. `sw` runs dandelion with that state and routes file and prints `exit=…` after it.

```bash
export SW="$(mktemp -d)"
mkdir -p "$SW/bin" "$SW/bare" "$SW/home" "$SW/repo"
ln -s "$(command -v node)" "$SW/bin/node"; ln -s /bin/sh "$SW/bin/sh"
ln -s "$(command -v node)" "$SW/bare/node"; ln -s /bin/sh "$SW/bare/sh"
cat > "$SW/bin/fake-cli" <<'EOF'
#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('sleep')) setInterval(() => undefined, 1000);
else {
  const stdin = fs.readFileSync(0, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), 'seen.json'), JSON.stringify({ args, stdin, cwd: process.cwd(), pwd: process.env.PWD, home: process.env.CODEX_HOME || null }));
  process.stdout.write('fake stdout\n'); process.stderr.write('fake stderr\n'); process.exit(7);
}
EOF
chmod +x "$SW/bin/fake-cli"; ln -s fake-cli "$SW/bin/claude"; ln -s fake-cli "$SW/bin/codex"
node -e 'const fs=require("fs"),f=JSON.parse(fs.readFileSync("qa/routes.fixture.json"));const t={before:[],after:["-p"],stdin:true};f.swarm={exclude:["claude-work","claude-animus","codex-animus"],cap:{default:2}};f.lab={"model-":"lab-a","vendor/":"lab-b"};f.headless=Object.fromEntries(["claude","codex","cursor-agent","agy","kimi","grok","junie","hermes","kilo"].map(c=>[c,t]));fs.writeFileSync(process.argv[1],JSON.stringify(f))' "$SW/f.json"
F="$SW/f.json"; BIN="$SW/bin"; BARE="$SW/bare"
snap() { node -e 'const ids="claude claude-work claude-animus claude-deepseek claude-ollama agy kimi grok codex codex-animus cursor junie hermes kilo".split(" "),at=(h)=>new Date(Date.now()+h*36e5).toISOString(),w=(s,k)=>[{label:"session",kind:"rolling",usedPct:s,resetsAt:at(3)},{label:"weekly",kind:"weekly",usedPct:k,resetsAt:at(72)}],u=eval("("+process.argv[1]+")"),now=new Date().toISOString();require("fs").writeFileSync(process.argv[2],JSON.stringify(ids.map(id=>u[id]?{id,displayName:id,status:"ok",windows:u[id],fetchedAt:now}:{id,displayName:id,status:"unavailable",reason:"qa",windows:[],fetchedAt:now})))' "$1" "$SW/snapshot.json"; }
sw() { env -i HOME="$SW/home" TZ=UTC NO_COLOR=1 PATH="${P:-$BIN}" DANDELION_KIMI_PORT=1 DANDELION_STATE_FILE="$SW/eligibility.json" DANDELION_ROUTES_FILE="${R:-$F}" node src/main.ts "$@"; echo "exit=$?"; }
echo '{}' > "$SW/eligibility.json"
```

1. Run `snap '{codex:w(10,10),agy:w(10,10),claude:w(83,10),"claude-work":w(0,0)}'; echo '{"agy":false}' > "$SW/eligibility.json"; sw seats 6 --json --max-age 600`, then `echo '{}' > "$SW/eligibility.json"`.
   - **Expected:** one line of JSON, then `exit=0`. Its keys are `generatedAt`, `mode` (`pack`), `requested` (6), `trip` (80), `seats` and `accounts`, in that order. `seats` is two `model-i high codex` seats, each with `model` `model-i`, `effort` `high`, `command` `codex`, `lab` `lab-a`, `kind` `headroom`, `rank` and `rankName` `null`, `held` `false`. `accounts` lists all fourteen accounts in dashboard order, each with `id`, `command`, `cap`, `held`, `target`, `score`, `evaporating`, `balance`, `skip` and `windows`. codex has `cap` 2, `target` 2, `score` 90 and `skip` `null`; claude's `skip` is `tripped` with text `tripped at 83%, back <weekday> <hh:mm>` and a `backAt`; claude-work's is `excluded`, agy's is `ineligible` with text `routing off`, and kilo has `score` `null`, `balance` `null` and `skip` `unavailable`.

2. Run `snap '{codex:w(10,10),claude:w(83,10)}'; sw seats 1 --max-age 600; sw seats 1 --why --max-age 600`.
   - **Expected:** `model-i high codex` and `exit=0`. Then `model-i high codex`, `# skip claude: tripped at 83%, back <weekday> <hh:mm>`, one `# skip <id>: …` line for every other account but codex in dashboard order, and `exit=0`.

3. Run `snap '{claude:[...w(0,0),{label:"weekly Fable",kind:"weekly",usedPct:5,resetsAt:at(72)}],codex:w(10,10),cursor:[{label:"total",kind:"weekly",usedPct:5,resetsAt:at(72)}],grok:[{label:"credits",kind:"weekly",usedPct:5,resetsAt:at(72)}],agy:w(5,5)}'`, then `sw seats 2 --json --max-age 600 --held codex=2`, `sw seats 2 --json --max-age 600` and `sw seats 6 --spread --max-age 600`.
   - **Expected:** the first JSON's `seats` are two codex seats with `held: true`; the second's go to claude, then agy, all `held: false`, so the held call kept codex instead of churning. The `--spread` call prints `model-h1 max claude`, `model-i xhigh codex`, `model-h2 cursor`, `model-h3 max claude`, `model-h4 xhigh grok` and `model-h5 high agy`, one per rank in chain order, then `exit=0`.

4. Run `snap '{}'; sw seats 3 --max-age 600; sw seats 3 --json --max-age 600 | head -c 80; echo`, then each of `sw seats 0`, `sw seats 3 --pack --spread`, `sw seats 201`, `sw seats`, `sw seats 3 --bogus`, `sw seats 3 --held claude-wrok=1`, `sw seats 3 --cap codex=21`, `sw seats 3 --trip 91`, then `R="$SW/nope.json" sw seats 3 --json --max-age 600`, then `node -e 'const fs=require("fs"),f=JSON.parse(fs.readFileSync(process.argv[1]));f.swarm.trip=95;fs.writeFileSync(process.argv[2],JSON.stringify(f))' "$F" "$SW/bad.json"; R="$SW/bad.json" sw seats 3 --max-age 600`.
   - **Expected:** `none` and `exit=1`; JSON whose `seats` is `[]` (with `exit=1` from the first command). Each usage error prints one stderr line starting `dandelion: seats: `, nothing on stdout, and `exit=2`. The missing routes file prints only `dandelion: routes file $SW/nope.json: cannot be read` and `exit=2`. The bad trip prints only `dandelion: routes file $SW/bad.json: swarm.trip is not a whole percent from 50 to 90` and `exit=2`.

5. Run `P="$BARE" sw seats 3 --json | head -c 120; echo`.
   - **Expected:** seats JSON starting `{"generatedAt":` with `seats` and `accounts`, and no `providers` key: `seats` owns `--json`. Every probe fails on the bare PATH, so `seats` is empty.

6. Headless launch. Run `printf 'Create ok.txt with $& and {promptFile} in it.\n' > "$SW/prompt.md"; node -e 'const fs=require("fs"),f=JSON.parse(fs.readFileSync(process.argv[1]));f.headless.codex={before:["exec"],after:["--yes","{promptFile}","{prompt}"],stdin:true};f.headless.claude={before:[],after:["-p"],stdin:false};fs.writeFileSync(process.argv[2],JSON.stringify(f))' "$F" "$SW/h.json"`, then `R="$SW/h.json" sw run --headless --seat "model-i high codex-animus" --prompt-file "$SW/prompt.md" --cwd "$SW/repo" --timeout 30; cat "$SW/repo/seen.json"; echo`.
   - **Expected:** `fake stdout` on stdout, `fake stderr` on stderr, `exit=7`. `seen.json` has `args` `["exec","--model","model-i","-c","model_reasoning_effort=high","--yes","<$SW>/prompt.md","Create ok.txt with $& and {promptFile} in it.\n"]` (the prompt is inserted literally), `stdin` equal to the prompt, `cwd` and `pwd` both `$SW/repo`, and `home` ending in `/.codex-animus`.

7. Run `R="$SW/h.json" sw run --headless --seat "model-a high claude" --prompt-file "$SW/prompt.md" --cwd "$SW/home"; cat "$SW/home/seen.json"; echo`, then `time (R="$SW/h.json" sw run --headless --seat "sleep claude" --prompt-file "$SW/prompt.md" --cwd "$SW/repo" --timeout 1)`, then `P="$BARE" R="$SW/h.json" sw run --headless --seat "model-a high claude" --prompt-file "$SW/prompt.md" --cwd "$SW/repo"`, then `snap '{}'; R="$SW/h.json" sw run --headless --prompt-file "$SW/prompt.md" --cwd "$SW/repo" --max-age 600`.
   - **Expected:** `exit=7` and a `seen.json` whose `stdin` is empty (a template without `stdin` gives the CLI an empty stdin). Then `exit=124` after about one second. Then `dandelion: claude: command not found` and `exit=127`. Then `none` and `exit=1`.

8. Run each of these with `R="$SW/h.json" sw run --headless`: `--seat "model-a high claude" --cwd "$SW/repo"`, `--seat "model-a high claude" --prompt-file "$SW/nope.md" --cwd "$SW/repo"`, `--seat "model-a high claude" --prompt-file "$SW/prompt.md" --cwd "$SW/nope"`, `--seat "model-a high claudee" --prompt-file "$SW/prompt.md" --cwd "$SW/repo"`, `--seat "model-c high agy" --prompt-file "$SW/prompt.md" --cwd "$SW/repo"`.
   - **Expected:** each prints nothing on stdout, one stderr line and `exit=2`: `dandelion: run: --prompt-file is required`, `dandelion: run: prompt file $SW/nope.md cannot be read`, `dandelion: run: --cwd $SW/nope is not a directory`, `dandelion: run: unknown account claudee`, `dandelion: run: no headless template for agy`.

9. Run `pgrep -fa "$SW"; rm -rf "$SW"`.
   - **Expected:** `pgrep` prints nothing: no fake CLI outlived its launch, the timed-out one included. Nothing is left from this procedure.
