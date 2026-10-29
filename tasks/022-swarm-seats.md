# 022 — hand out swarm seats, and launch one seat headless

After this task dandelion can feed a swarm. `dandelion seats <N>` answers "which N agent slots should run right now, on which accounts and models", spread across accounts by route's own rules plus a stricter swarm trip line. `dandelion run --headless` launches one of those slots with a prompt file in a given directory, with nobody at the keyboard. brush-cutter is the only consumer: it calls these two commands and never runs an agent CLI itself.

Why: `route` answers for one launch. A swarm holds many launches at once and must not burn an account down to the 90% trip, because the band between the swarm trip and 90% is left for the user's own sessions. It also must not churn: asking again a minute later with the same quota should keep the seats it already holds. And each CLI has its own way to run without a terminal, which belongs next to the launch table, not in every consumer.

## The routes.json sections

Three optional sections join `route` and `high`. They are checked as strictly as the rest of the file: an unknown key, a wrong type or an out-of-range number is the usual `dandelion: routes file <path>: <what is wrong>` with exit 2, for every command that reads the file. A missing section or key takes its default: `trip` 80, `minLeft` 5, `exclude` [], `cap.default` 2 (kilo 1 unless it has its own key), `burnPerSeatHour.default` 10, `lab` {}, `headless` {}.

Shipped content for the first two:

```json
"swarm": {
  "trip": 80,
  "minLeft": 5,
  "exclude": ["claude-work", "claude-animus", "codex-animus"],
  "cap": { "claude": 4, "codex": 3, "cursor": 3, "agy": 3, "kilo": 1, "default": 2 },
  "burnPerSeatHour": { "default": 10 }
},
"lab": {
  "claude-": "anthropic", "gpt-": "openai", "gemini-": "google", "grok-": "xai", "x-ai/": "xai",
  "kimi": "moonshot", "deepseek": "deepseek", "glm-": "zhipu", "auto": "cursor"
}
```

- `swarm.trip` is a whole percent from 50 to 90. `minLeft` and every `burnPerSeatHour` value are numbers from 0 to 100. Every `cap` value is a whole number from 0 to 20. `cap` and `burnPerSeatHour` keys are account ids or `default`; `exclude` holds account ids.
- `lab` keys are model-name prefixes and values are lab names (`^[a-z0-9-]+$`). A seat's lab comes from its model, not its CLI: claude-deepseek runs the claude CLI on a DeepSeek model, so its lab is `deepseek`. The longest matching prefix wins, and a model with no match has lab `unknown`.
- `headless` keys are CLI command names (`claude`, `codex`, `cursor-agent`, `agy`, `kimi`, `grok`, `junie`, `hermes`, `kilo`). A template is `{ "before": string[], "after": string[], "stdin": boolean }`. The shipped file holds only the templates proven to work on this machine by running each CLI for real (see the README Seats section for which ones and which CLIs are left out).
- The shipped `exclude` keeps the work accounts out of every swarm. A caller lifts that for one call with `--include`.

## `dandelion seats <N>`

```
dandelion seats <N> [--pack | --spread] [--json] [--why] [--max-age <s>]
                    [--held <id>=<n>[,<id>=<n>...]] [--include <id>[,...]] [--exclude <id>[,...]]
                    [--trip <pct>] [--cap <id>=<n>[,...]]
```

`<N>` is the total number of seats wanted, held ones included, from 1 to 200. `--pack` is the default. Both flags, a bad `N`, an unknown flag, an unknown account id or an out-of-range value (`--held` n 0–200, `--cap` n 0–20, `--trip` 50–90) prints `dandelion: seats: <what is wrong>` on stderr and exits 2. Probing, `--max-age`, the eligibility state file, `limit` and routes.json errors work exactly as for `route`. `seats` is stateless: the caller says which seats it holds with `--held`, and seats answers with the full target.

An account gets no seat, for the first reason that applies: `excluded` (in `swarm.exclude` or `--exclude`, and not in `--include`), `ineligible` (routing off), `unavailable` (not ok, or no usage windows; kilo needs no windows), `limited` (route's `limit`), `tripped` (a rolling window at or above the swarm trip), `no-headless` (its CLI has no template), `not-in-chain` (`--spread` only), `spent` (no room for one seat under the headroom rule, or cap 0) and, for kilo only, `balance` (not strictly above $10).

Headroom rule: an account can hold k seats while `binding − k × burn ≥ minLeft` and `k ≤ cap`, where binding is route's binding, burn comes from `burnPerSeatHour`, and cap from `--cap`, then `swarm.cap`. The next seat goes where `binding − (seats already given + 1) × burn` is highest, ties in dashboard order.

Allocation keeps held seats first (dropping the lowest-scoring ones when they add up to more than N). `--pack` then serves accounts with an evaporating weekly window, most left first, with their max line; then hands out the rest one at a time on headroom with the standard line; and gives kilo seats only when no windowed account can take another. `--spread` gives every `--high` rank a seat, in chain order, before any rank gets two, each on its best account, with that rank's `high` line.

Plain output is one `<model> [effort] <account>` line per seat, the same shape as a route line, so `run --headless --seat` takes it as is. `--why` adds one `# skip <id>: <text>` line per skipped account. `--json` prints the one-line contract object (`generatedAt`, `mode`, `requested`, `trip`, `seats`, `accounts`) that brush-cutter parses; README Seats documents every field. No seats prints `none` (or JSON with an empty `seats`) and exits 1.

`seats` joins `route`, `run`, `help`, `--help` and `-h` as a first argument that owns its own options, so `dandelion seats 3 --json` prints seats JSON, not the dashboard JSON.

## `dandelion run --headless`

```
dandelion run --headless [--seat "<model> [effort] <account>"] --prompt-file <path> --cwd <dir> [--timeout <seconds>] [--high] [--max-age <s>]
```

With `--seat` there is no probing or routing: that line is launched. Without it the route is resolved as plain `run` resolves it. argv is `<command> ...before ...model and effort flags ...after`, where `{prompt}` in `after` becomes the prompt file's contents and `{promptFile}` its absolute path; with `"stdin": true` the prompt file is the child's stdin. The env is the current env plus the account's (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), the working directory is `--cwd`, and stdout and stderr pass through.

Exit codes: the child's; 124 on `--timeout` (SIGTERM, then SIGKILL after 5s); 127 when the CLI is not on PATH; 1 for `none` or a kilo balance at or below $10 at launch; 2 for usage errors, a missing prompt file or cwd, an unknown account, a bad line, a bad routes.json, a command without a headless template, or a `{prompt}` template with a prompt over 120000 bytes. SIGTERM, SIGHUP and SIGINT are forwarded to the child while it runs. Plain `run` is unchanged.

## Must not break

- `route`, `route --high`, `run`, the dashboard, `--json`, `--line` and `--waybar`: every rule, the 90% trip, the `--high` chain and every output stay as they are.
- A routes.json without the new sections reads exactly as before.
- Out of scope: seat leases or heartbeats, burn rates learned from history, seats in the live TUI, and per-model caps.
