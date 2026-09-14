# 011 — toggle route eligibility per account in the dashboard

After this task the user can exclude an account from `dandelion route` without uninstalling anything: highlight a provider in the live dashboard, press space, and that provider stops being a routing candidate until they toggle it back. Examples: codex has no active sub right now — switch it off; claude-work goes off on weekends and back on Monday.

## User outcome

- In live mode, `↑`/`↓` (and `j`/`k`) move a selection cursor between provider panels; the selected panel is visibly marked (e.g. a `▸` marker and the bright border style).
- `space` toggles **route eligibility** for the selected provider. The change is instant: the panel gains/loses a dim `routing off` tag in its header line.
- Toggling a provider that has no usage windows (kilo balance, codex in api-key mode) changes nothing and the caption flashes `not routable (no usage windows)` for two seconds — these providers are never route candidates anyway.
- The choice **persists** across restarts in a state file (below). `--once` output shows the same `routing off` tags, and `--once` never writes state.
- The `?` help footer lists the new keys: `↑↓/jk select · space routing on/off · r refresh · q quit`.
- Panels always keep showing live usage data — eligibility affects routing only, never what the dashboard displays.

## State file

- Path: `DANDELION_STATE_FILE` env var, default `$XDG_STATE_HOME/dandelion/eligibility.json` (or `~/.local/state/dandelion/eligibility.json` when XDG_STATE_HOME is unset). Documented in the README env ledger.
- Content: a flat JSON object mapping provider id → boolean, e.g. `{ "codex": false, "claude-work": false }`. A missing key means eligible (default on). Unknown keys are ignored but preserved on rewrite.
- Writes are atomic (write temp file in the same directory, then rename) and create the parent directory as needed.
- A missing, unreadable, or corrupt file means *all providers eligible* — never crash, never block the dashboard over state.

## Route integration

- `dandelion route` reads the same state file and drops ineligible providers **before** both decision rules (evaporation override and most-headroom) — an ineligible provider can never be selected, even by evaporation.
- If every windowed provider is ineligible or unavailable, the existing `none` + exit 1 path applies.
- README's route section gains one paragraph on eligibility and the state file.

## QA procedure (extend `qa/`)

- Fixture state file with `{"codex": false}` and fixtures that would make codex win: `route` must not print the codex line; remove the file and it does.
- All windowed providers ineligible ⇒ `none`, exit 1.
- Corrupt state file ⇒ dashboard and route both behave as all-eligible, exit 0.
- Pty e2e: launch live mode with the full fixture set, send `j` then `space`, assert the state file gains the selected provider as `false` and the next rendered frame shows its `routing off` tag; send `space` again and assert it flips back.
- Toggling kilo (no windows) leaves the state file empty and shows the `not routable` flash.
- All prior e2es (dashboard, route decision rules) pass unchanged — with no state file present, every provider is eligible.

## Must not break

- Route decision rules from 010 (identical outputs when no state file exists); live-mode keys and fleet summary from 007; panel order; probe behaviour; `--once` byte-compatibility except the added tag on ineligible panels (and there are none by default).
