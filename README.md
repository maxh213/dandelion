# Dandelion Dashboard

Dandelion is a terminal dashboard that shows how much of your AI allowances you have left: subscription usage windows for `claude`, `agy`, `kimi`, `grok`, `codex` and `cursor`, and the API balance for `kilo`.

## Providers

Panels always appear in this order. A provider whose CLI is missing, fails, times out or prints unexpected output renders as a dim panel with the reason.

- `claude` (claude · personal) - runs `claude -p "/usage"` (90s timeout) and shows the session, weekly and per-model weekly windows with a reset countdown.
- `claude-work` (claude · work) - runs the same command with `CLAUDE_CONFIG_DIR` set to the work config dir and shows the same windows for the work account. Without that dir it is unavailable and never runs claude.
- `agy` - runs `agy -p "/usage"` (60s timeout) and shows each model group's windows; agy reports remaining percent, shown as used percent.
- `kimi` (kimi code) - starts `kimi web --no-open --port <port>`, waits up to 20s for the token it prints, and reads `kimi web`'s local usage endpoint `/api/v1/oauth/usage` (10s request timeout). It shows the weekly window with a reset countdown and each rolling `5h` window. The server is then shut down with SIGTERM, then SIGKILL after 5s.
- `grok` - reads the newest billing snapshot from `<grok home>/logs/unified.jsonl` without running grok, and shows the credits window with a reset countdown, the subscription tier and the snapshot's age. A snapshot older than 48h is shown dim as stale. Without a snapshot the panel says to run grok once.
- `codex` - runs `codex login status` (15s timeout). Logged in with an API key, it shows "api-key billing · no usage windows", because API usage has no windows. Logged in with ChatGPT, it starts `codex app-server` and reads `account/rateLimits/read` over JSON-RPC on stdio (30s timeout), then shows the primary and secondary windows with a reset countdown. The server is then shut down with SIGTERM, then SIGKILL after 5s.
- `cursor` - reads the access token from the cursor-agent auth file without running cursor-agent, and POSTs to the dashboard API's `GetCurrentPeriodUsage` and `GetPlanInfo` (15s timeout each) to show the total, auto and api windows with a reset countdown and the plan name and price. The token is never printed or written.
- `kilo` (api balance) - runs `kilo profile` (20s timeout) and shows the balance against a reference.

All eight probes run in parallel. Window gauges are coloured by usage: below 50% calm, 50-79% warm, 80-94% hot, 95% and above critical.

## Run Commands

- `npm start` - Run the live dashboard: panels fill in as each probe settles, a fleet summary line shows how many windows are above 80% and the next reset, and everything is re-probed every `DANDELION_REFRESH_SECONDS`. Keys: `↑↓/jk select` a panel, `space routing on/off` for the selected provider, `r` refresh, `q` quit (or Ctrl-C), `?` help.
- `npm start -- --once` - Run the dashboard once and exit
- `dandelion` - Run the live dashboard from anywhere after `npm link`; `dandelion --once` runs it once and exits
- `dandelion route` (or `npm start -- route`) - Run every probe once and print one line naming the subscription to use right now, such as `claude-opus-5 max`, then exit; it prints `none` and exits 1 when no provider can be routed. It never draws the dashboard, even on a terminal.
- `npm test` - Run unit tests
- `npm run qa` - Run E2E tests

The app runs once when stdout or stdin is not a terminal, as if `--once` were given.

## Route

`route` must be the first argument; later arguments are ignored. It routes among `claude`, `claude-work`, `agy`, `kimi`, `grok` and `cursor`, in dashboard order, taking each one that is ok and has at least one usage window. `kilo` is never routed, because it reports a balance rather than windows, and `codex` is never routed, because it has no subscription windows to route on.

Each window is rolling (claude session, kimi 5h, agy Five Hour Limit), weekly (any other label containing "week", grok credits, cursor total, auto and api) or other, which route ignores. A window's left is 100 minus its used percent, compared without rounding.

1. Evaporation: a weekly window evaporates when it resets after now and before the next local midnight with less than 97% left. If any provider has one, route prints the max line of the provider whose evaporating window has the most left.
2. Most headroom: otherwise each provider's binding is the lowest left over its rolling and weekly windows (100 when it has neither), and route prints the standard line of the provider with the highest binding.

Ties go to the provider earlier in dashboard order.

Eligibility: ineligible providers are dropped before both rules, so an ineligible provider is never routed, not even by evaporation. In the live dashboard, select a panel with `↑↓/jk` and press space to toggle its routing on or off; an ineligible panel shows `routing off` and keeps showing its usage. Non-routable panels (no usage windows, unavailable or failed) cannot be toggled and flash `not routable (no usage windows)` instead. The choice is kept in the state file (`DANDELION_STATE_FILE`), a JSON object where `false` marks a provider ineligible; a missing, unreadable or corrupt file makes every provider eligible. `--once` and `route` read the state file and never write it.

| provider | standard line | max line |
|---|---|---|
| claude | `claude-opus-5 high` | `claude-opus-5 max` |
| claude-work | `claude-opus-5 high` | `claude-opus-5 max` |
| agy | `gemini-3.1-pro-high medium` | `gemini-3.1-pro-high high` |
| kimi | `kimi-code/kimi-for-coding-highspeed` | `kimi-code/kimi-for-coding-highspeed` |
| grok | `grok-4.6` | `grok-4.6` |
| cursor | `kimi-k3-max` | `kimi-k3-max` |

## Env-var Ledger

- `DANDELION_KILO_REFERENCE` - The reference amount (in dollars) used to calculate the gauge fill percentage for the `kilo` probe. Defaults to `20`. If set to an empty string, no reference gauge is shown. If set to a custom number, the gauge will fill relative to that amount.
- `DANDELION_CLAUDE_WORK_CONFIG_DIR` - The work claude config dir the `claude-work` probe passes to claude as `CLAUDE_CONFIG_DIR`. Defaults to `~/.claude-work` when unset or empty. When it is not a directory the panel says to log in with `CLAUDE_CONFIG_DIR=~/.claude-work claude`.
- `DANDELION_KIMI_PORT` - The local port `kimi web` is started on for the `kimi` probe. Defaults to `59177`. Any value other than an integer from 1 to 65535 makes the kimi panel unavailable.
- `DANDELION_GROK_HOME` - The grok home directory the `grok` probe reads `logs/unified.jsonl` from. Defaults to `~/.grok` when unset or empty. The app never writes to it.
- `DANDELION_CURSOR_AUTH_FILE` - The cursor-agent auth file the `cursor` probe reads `accessToken` from. Defaults to `~/.config/cursor/auth.json` when unset or empty. Without a token the panel says to run `cursor-agent login`.
- `DANDELION_CURSOR_API_BASE` - The base URL of the cursor dashboard API the `cursor` probe POSTs to. Defaults to `https://api2.cursor.sh` when unset or empty.
- `DANDELION_REFRESH_SECONDS` - Seconds the live dashboard waits after a round of probes settles before it probes again. Defaults to `300`; any value that is not a positive integer uses the default.
- `DANDELION_STATE_FILE` - The route eligibility state file the live dashboard writes when space toggles a provider, and `route` and `--once` read. Defaults to `$XDG_STATE_HOME/dandelion/eligibility.json`, else `~/.local/state/dandelion/eligibility.json`, when unset or empty. Writes go to a temp file in the same directory, then rename over it.
- `NO_COLOR` - If set, disables ANSI colors and uses ASCII fallback rendering.
