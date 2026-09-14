# QA Procedure: 009 - Rename to dandelion

After 009, read every earlier procedure with `DANDELION` for the banner wordmark and `DANDELION_*` for each `ALLOWANCE_*` variable. Nothing else in them changes.

Set up once in the repo root, in a real terminal. First run the set-up blocks of `qa/002-claude-agy.md` to `qa/008-claude-work.md`, renaming every `ALLOWANCE_` to `DANDELION_` as you go, so `$FX`, `$NODEBIN`, `$WD` and `lv` exist. Then clear the old names: `for v in $(env | grep -o '^ALLOWANCE_[A-Z_]*'); do unset "$v"; done`.

1. Run `node qa/e2e.mjs; pgrep -fa 'allowance-qa|dandelion-qa'`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including `009-rename-dandelion.e2e.mjs`. `pgrep` prints nothing.

2. Run `NO_COLOR=1 lv --once | tee /tmp/009.txt; head -1 /tmp/009.txt; grep -ci allowance /tmp/009.txt; awk 'length>72' /tmp/009.txt`.
   - **Expected:** `exit=0`. The first line is `DANDELION`, then spaces, then `10:00:00Z`-style time at the right edge, the same width as before. The panels match step 2 of `qa/008-claude-work.md`. `grep` prints `0`. `awk` prints nothing.

3. Run `PATH="$FX:$NODEBIN" NO_COLOR=1 node src/main.ts --once > /tmp/009b.txt; echo "exit=$?"; diff <(sed 1d /tmp/009.txt) <(sed 1d /tmp/009b.txt)`.
   - **Expected:** `exit=0`. `diff` prints nothing, or only differences in countdowns and ages that ticked over between the runs.

4. Run `head -1 src/main.ts; ls -l src/main.ts; node -p 'const p=require("./package.json"); [p.name, JSON.stringify(p.bin), p.dependencies]'`.
   - **Expected:** `#!/usr/bin/env node`; the mode shows `x` bits; `[ 'dandelion', '{"dandelion":"src/main.ts"}', undefined ]`.

5. Run `B="$(mktemp -d)"; ln -s "$PWD/src/main.ts" "$B/dandelion"; PATH="$B:$FX:$NODEBIN" NO_COLOR=1 dandelion --once | head -3; echo "exit=${PIPESTATUS[0]}"`.
   - **Expected:** `exit=0`. The dashboard prints, starting with the `DANDELION` banner. An empty output here is a failure.

6. Run `DANDELION_KIMI_PORT=abc NO_COLOR=1 lv --once | grep -A2 '^kimi$'; ALLOWANCE_KIMI_PORT=abc NO_COLOR=1 lv --once | grep -c ALLOWANCE_KIMI_PORT`.
   - **Expected:** the first run shows the kimi reason `DANDELION_KIMI_PORT must be an integer from 1 to 65535`. The second prints `0`: the old name is ignored.

7. Run `DANDELION_CLAUDE_WORK_CONFIG_DIR="$WD-missing" NO_COLOR=1 lv --once | grep -A1 '^claude-work$'; HOME="$(mktemp -d)" ALLOWANCE_CLAUDE_WORK_CONFIG_DIR="$WD" NO_COLOR=1 lv --once | grep -A1 '^claude-work$'`.
   - **Expected:** both print `claude-work` followed by the `no work claude config — …` reason: the new name is read, the old one is not.

8. Run `DANDELION_REFRESH_SECONDS=2 NO_COLOR=1 lv`, watch for about 10 seconds, then press `q`.
   - **Expected:** after the panels settle the frame starts `DANDELION`, the `data … old` age resets roughly every 2 seconds after each round settles, and `q` restores the terminal and prints `exit=0`.

9. Run `head -3 README.md; grep -n 'DANDELION_\|dandelion' README.md; grep -c 'ALLOWANCE\|Allowance' README.md; git grep -n ALLOWANCE -- src qa perf package.json package-lock.json; rm -rf "$B" /tmp/009.txt /tmp/009b.txt`.
   - **Expected:** the title is `# Dandelion Dashboard` and the intro starts `Dandelion is`. The ledger lists all seven `DANDELION_*` names, and the run commands mention `dandelion`. The count is `0`. `git grep` prints nothing.
