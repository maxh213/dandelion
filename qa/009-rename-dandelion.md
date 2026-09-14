# QA Procedure: 009 - Rename to dandelion

After 009, read every earlier procedure with `DANDELION` for the banner wordmark, `DANDELION_*` for each `ALLOWANCE_*` variable and `dandelion-qa` for `allowance-qa`. Nothing else in them changes.

Set up once in the repo root, in a real terminal. First run the set-up blocks of `qa/002-claude-agy.md` to `qa/008-claude-work.md`, renaming every `ALLOWANCE_` to `DANDELION_` as you go, so `$FX`, `$NODEBIN`, `$KP`, `$GH`, `$CF`, `$WD`, `log`, `lv` and the cursor fixture on port 48006 exist. Then write a grok snapshot, clear the old names, and define two helpers. `dv CMD…` runs a command with exactly the env `lv` uses. `bare VAR=value…` runs `node src/main.ts --once` with every `DANDELION_*` name unset, an empty `HOME` and only the assignments you pass. Kimi's default port 59177 must be free.

```bash
echo ok > "$FX/mode"; log '1 hour'; for v in $(env | grep -o '^ALLOWANCE_[A-Z_]*'); do unset "$v"; done
export H0="$(mktemp -d)" B="$(mktemp -d)"; ln -s "$PWD/src/main.ts" "$B/dandelion"
dv() { env CODEX_FIXTURE_MODE=apikey PATH="${PRE:+$PRE:}$FX:$NODEBIN" DANDELION_KIMI_PORT=$KP DANDELION_GROK_HOME="$GH" DANDELION_CURSOR_AUTH_FILE="$CF/auth.json" DANDELION_CURSOR_API_BASE=http://127.0.0.1:48006 NO_COLOR=1 "$@"; }
bare() { rm -f "$FX/claude.calls"; : > "$CF/requests.log"; env $(env | grep -o '^DANDELION_[A-Z_]*' | sed 's/^/-u /') HOME="$H0" CODEX_FIXTURE_MODE=apikey PATH="$FX:$NODEBIN" NO_COLOR=1 "$@" node src/main.ts --once; echo "exit=$?"; }
```

1. Run `node qa/e2e.mjs; pgrep -fa 'allowance-qa|dandelion-qa'`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including `009-rename-dandelion.e2e.mjs`. `pgrep` prints nothing.

2. Run `NO_COLOR=1 lv --once | tee /tmp/009.txt; grep -ci allowance /tmp/009.txt; awk 'length>72' /tmp/009.txt`.
   - **Expected:** `exit=0`. The first line is `DANDELION`, spaces, then an `HH:MM:SSZ` time ending at column 72. The panels match step 2 of `qa/008-claude-work.md`. `grep` prints `0`. `awk` prints nothing.

3. Run `dv node src/main.ts --once > /tmp/009b.txt; echo "exit=$?"; diff <(sed 1d /tmp/009.txt) <(sed 1d /tmp/009b.txt)`.
   - **Expected:** `exit=0`. `diff` prints nothing, or only countdowns and ages that ticked over between the runs.

4. Run `head -1 src/main.ts; ls -l src/main.ts; node -p 'const p=require("./package.json"); [p.name, JSON.stringify(p.bin), p.dependencies]'`.
   - **Expected:** `#!/usr/bin/env node`. The mode has `x` bits. Then `[ 'dandelion', '{"dandelion":"src/main.ts"}', undefined ]`.

5. Run `PRE="$B" dv dandelion --once > /tmp/009c.txt; echo "exit=$?"; diff <(sed 1d /tmp/009.txt) <(sed 1d /tmp/009c.txt)`.
   - **Expected:** `exit=0`, and the diff is as in step 3. Empty output is a failure.

6. Run `bare DANDELION_KILO_REFERENCE=10 DANDELION_KIMI_PORT=abc DANDELION_CLAUDE_WORK_CONFIG_DIR="$WD" | grep -A2 '^kimi$\|^kilo$\|^claude-work$'; cat "$FX/claude.calls"`.
   - **Expected:** `exit=0`. The kimi panel shows `DANDELION_KIMI_PORT must be an integer from 1 to 65535`. The kilo gauge is 20 `#` and no `-`. claude-work shows the three work rows. `claude.calls` holds `-` and the `$WD` path.

7. Run `bare ALLOWANCE_KILO_REFERENCE=10 ALLOWANCE_KIMI_PORT=abc ALLOWANCE_GROK_HOME="$GH" ALLOWANCE_CURSOR_AUTH_FILE="$CF/auth.json" ALLOWANCE_CLAUDE_WORK_CONFIG_DIR="$WD"; cat "$FX/claude.calls"; wc -l < "$CF/requests.log"`.
   - **Expected:** `exit=0`, and every old name is ignored. The kilo gauge is 14 `#` and 6 `-` (default reference 20). The kimi panel shows `59%` and `42%` rows and no port reason. The grok reason is `no grok billing snapshot — run grok once`. The cursor reason is `no cursor auth — run cursor-agent login`. The claude-work reason is `no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude`. `claude.calls` is the single line `-`. `wc` prints `0`.

8. Run `bare DANDELION_CURSOR_AUTH_FILE="$CF/auth.json" ALLOWANCE_CURSOR_API_BASE=http://127.0.0.1:48006 | grep -A1 '^cursor$'; wc -l < "$CF/requests.log"`.
   - **Expected:** `exit=0`. The cursor panel is dim with a request-failure reason, not the 006 windows. `wc` prints `0`. The request goes to `api2.cursor.sh` with the dummy token, or fails at once when offline.

9. Run `rm -f "$FX/claude.calls"; ALLOWANCE_REFRESH_SECONDS=1 NO_COLOR=1 lv`. Wait 5s after every panel settles, then press `q` and run `wc -l < "$FX/claude.calls"`. Repeat with `DANDELION_REFRESH_SECONDS=1` in place of the old name.
   - **Expected:** the first run's frame starts `DANDELION`, never shows `refreshing…`, ends with `exit=0`, and `wc` prints `2`. The second run shows `refreshing…` about every second and `wc` prints `4` or more.

10. Run `head -3 README.md; grep -n 'DANDELION_\|dandelion' README.md; git grep -nI -e ALLOWANCE -e Allowance -e allowance- -e '"allowance"' -- src perf README.md package.json package-lock.json 'qa/*.mjs' ':!qa/009-rename-dandelion.e2e.mjs'; rm -rf "$B" "$H0" /tmp/009.txt /tmp/009b.txt /tmp/009c.txt`.
    - **Expected:** the title is `# Dandelion Dashboard` and the intro starts `Dandelion is`. The ledger lists all seven `DANDELION_*` names, and the run commands mention `dandelion`. `git grep` prints nothing.
