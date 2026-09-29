# Dandelion Dashboard

Dandelion is a terminal dashboard that shows how much of your AI allowances you have left: subscription usage windows for `claude`, `agy`, `kimi`, `grok`, `codex` and `cursor`, the credits balance for `junie`, the Nous Portal credits for `hermes`, and the API balance for `kilo`.

Called dandelion because dandelion seeds can lay dormant for a period of time before bursting into life. It's why they're such a prolific weed. But anyway this fits the naming convention I started with marestail and also it's sort of similar to you'll use up a session window for an llm then it will come back lol.

## Providers

Panels always appear in this order. A provider whose CLI is missing, fails, times out or prints unexpected output renders as a dim panel with the reason.

- `claude` (claude · personal) - runs `claude -p "/usage"` (90s timeout) and shows the session, weekly and per-model weekly windows with a reset countdown.
- `claude-work` (claude · work) - runs the same command with `CLAUDE_CONFIG_DIR` set to the work config dir and shows the same windows for the work account. Without that dir it is unavailable and never runs claude.
- `agy` - runs `agy -p "/usage"` (60s timeout) and shows each model group's windows; agy reports remaining percent, shown as used percent.
- `kimi` (kimi code) - starts `kimi web --no-open --port <port>`, waits up to 20s for the token it prints, and reads `kimi web`'s local usage endpoint `/api/v1/oauth/usage` (10s request timeout). It shows the weekly window with a reset countdown and each rolling `5h` window. The server is then shut down with SIGTERM, then SIGKILL after 5s.
- `grok` - reads the newest billing snapshot from `<grok home>/logs/unified.jsonl` without running grok, and shows the credits window with a reset countdown, the subscription tier and the snapshot's age. A snapshot older than 48h is shown dim as stale. Without a snapshot the panel says to run grok once.
- `codex` - runs `codex login status` (15s timeout). Logged in with an API key, it shows "api-key billing · no usage windows", because API usage has no windows. Logged in with ChatGPT, it starts `codex app-server` and reads `account/rateLimits/read` over JSON-RPC on stdio (30s timeout), then shows the primary and secondary windows with a reset countdown. The server is then shut down with SIGTERM, then SIGKILL after 5s.
- `cursor` - reads the access token from the cursor-agent auth file without running cursor-agent, and POSTs to the dashboard API's `GetCurrentPeriodUsage` and `GetPlanInfo` (15s timeout each) to show the total, auto and api windows with a reset countdown and the plan name and price. The token is never printed or written.
- `junie` - reads the newest completion snapshot from `<junie home>/sessions/<id>/events.jsonl` without running junie, visiting sessions from `<junie home>/sessions/index.jsonl` newest first, and shows the credits used against a reference, the balance and the snapshot's age. A snapshot older than 48h is shown dim as stale. Without a snapshot the panel says to run junie once.
- `hermes` - reads the Nous Portal tokens from the hermes auth file without running hermes, GETs `/api/oauth/account` (15s timeout) for the credits window with a reset countdown and remaining versus the monthly grant, and never prints the tokens. Without a token the panel says to run `hermes portal login`; when the token is expired it says to run `hermes once`.
- `kilo` (api balance) - runs `kilo profile` (20s timeout) and shows the balance against a reference.

All ten probes run in parallel. Window gauges are coloured by usage: below 50% calm, 50-79% warm, 80-94% hot, 95% and above critical.

## Run Commands

- `npm start` - Run the live dashboard: panels fill in as each probe settles, a fleet summary line shows how many windows are above 80% and the next reset, and everything is re-probed every `DANDELION_REFRESH_SECONDS`. Two boxes at the top show the answers `dandelion route` and `dandelion route --high` would print; they update when a round settles or routing is toggled. The frame fits the terminal: the `route` and `route --high` boxes stay at the top, and the provider list scrolls with `↑↓/jk` so earlier panels, personal `claude` included, stay reachable. Keys: `↑↓/jk select` a panel, `space routing on/off` for the selected provider, `r` refresh, `q` quit (or Ctrl-C), `?` help.
- `npm start -- --once` - Run the dashboard once and exit
- `dandelion` - Run the live dashboard from anywhere after `npm link`; `dandelion --once` runs it once and exits
- `dandelion route` (or `npm start -- route`) - Run every probe once and print one line naming the subscription to use right now, such as `claude-opus-5-5 max claude`, then exit; it prints `none` and exits 1 when no provider can be routed, and exits 2 when `routes.json` is bad. It never draws the dashboard, even on a terminal.
- `dandelion route --high` (or `npm start -- route --high`) - Run every probe once and print one line naming the strongest model that still has quota, such as `claude-fable-5-1 max claude-work`, then exit; it prints `none` and exits 1 when no chain entry is available, and exits 2 when `routes.json` is bad. It never draws the dashboard, even on a terminal.
- `npm test` - Run unit tests
- `npm run qa` - Run E2E tests

The app runs once when stdout or stdin is not a terminal, as if `--once` were given.

## Route

`route` must be the first argument; later arguments are ignored, except that `--high` anywhere after it switches to the quality chain below. It routes among `claude`, `claude-work`, `agy`, `kimi`, `grok`, `cursor`, `junie` and `hermes`, in dashboard order, taking each one that is ok and has at least one usage window. `kilo` is never routed, because it reports a balance rather than windows, and `codex` is never routed, because it has no subscription windows to route on.

Each window is rolling (claude session, kimi 5h, agy Five Hour Limit), weekly (any other label containing "week", grok credits, cursor total, auto and api, junie credits, hermes credits) or other, which route ignores. A window's left is 100 minus its used percent, compared without rounding.

1. Evaporation: a weekly window evaporates when it resets after now and before the next local midnight with less than 97% left. If any provider has one, route prints the max line of the provider whose evaporating window has the most left.
2. Most headroom: otherwise each provider's binding is the lowest left over its rolling and weekly windows (100 when it has neither), and route prints the standard line of the provider with the highest binding.

Ties go to the provider earlier in dashboard order.

The trip: before both rules, route skips every tripped account. An account is tripped when any of its rolling windows (claude and claude-work session, kimi 5h, agy Five Hour Limit) is 90% used or more; 90% itself trips, and weekly and other windows never trip. A tripped account's evaporating weekly window is ignored by rule 1 and its binding is ignored by rule 2. It is the same 90% trip `route --high` uses. When no account is left once ineligible, unavailable and tripped accounts are skipped, route prints `none` and exits 1.

Eligibility: ineligible providers are dropped before both rules, so an ineligible provider is never routed, not even by evaporation. In the live dashboard, select a panel with `↑↓/jk` and press space to toggle its routing on or off; an ineligible panel shows `routing off` and keeps showing its usage. Non-routable panels (no usage windows, unavailable or failed) cannot be toggled and flash `not routable (no usage windows)` instead. The choice is kept in the state file (`DANDELION_STATE_FILE`), a JSON object where `false` marks a provider ineligible; a missing, unreadable or corrupt file makes every provider eligible. `--once` and `route` read the state file and never write it.

The standard and max lines of each provider are in `routes.json` (see below):

| provider | standard line | max line |
|---|---|---|
| claude | `route.claude.standard` | `route.claude.max` |
| claude-work | `route.claude-work.standard` | `route.claude-work.max` |
| agy | `route.agy.standard` | `route.agy.max` |
| kimi | `route.kimi.standard` | `route.kimi.max` |
| grok | `route.grok.standard` | `route.grok.max` |
| cursor | `route.cursor.standard` | `route.cursor.max` |
| junie | `route.junie.standard` | `route.junie.max` |
| hermes | `route.hermes.standard` | `route.hermes.max` |

Account token: both `route` and `route --high` print `<line> <provider id>`, such as the `route.claude-work.standard` line followed by `claude-work`, because several providers can share a line and the account decides how to launch it; `none` stays alone. `claude` launches claude as usual, `claude-work` means launching claude with `CLAUDE_CONFIG_DIR` set to `DANDELION_CLAUDE_WORK_CONFIG_DIR` (default `~/.claude-work`), and every other id launches its own CLI.

Route --high: quality first, with no evaporation rule and no headroom comparison. It walks this chain from rank 1 down and prints the line of the first available entry, taken from `routes.json`:

| rank | providers | gating windows | line |
|---|---|---|---|
| 1 | claude, claude-work | `fable`: the Fable weekly window plus session | `high.fable` |
| 2 | cursor | (all) | `high.cursor` |
| 3 | claude, claude-work | (all) | `high.opus` |
| 4 | grok | (all) | `high.grok` |
| 5 | agy | (all) | `high.agy` |

An entry with a matcher is gated on the windows whose label contains the matcher in any case, plus every rolling window; a matched window the account does not report counts as 0% used. An (all) entry is gated on every window the provider reports, except the windows another entry of the same provider matches, so the rank 3 entry ignores the Fable window. The 90% trip: an entry is available on an account only when the account is eligible, ok with at least one window, and every gating window is under 90% used; at 90% it pops down to the next entry. Ineligible, unavailable and failed providers are skipped, and `kimi`, `codex`, `junie`, `hermes` and `kilo` are never in the chain, so `--high` does not use junie. `--high` does not use hermes. When both claude accounts are available at one rank, the one with more left (100 minus its highest gating used percent) wins, and a tie goes to `claude`. When no entry is available it prints `none` and exits 1.

## routes.json

To change a routed model, edit routes.json. The lines `route` and `route --high` print are data in `routes.json` at the repo root; the rules, the tie order, the `--high` chain order, its providers, the `fable` matcher and the 90% trip stay in code, so the order of keys in the file means nothing. dandelion finds the file from the real path of `src/main.ts` after following symlinks, never from the working directory, so `dandelion route` through an `npm link` symlink reads the checkout's file from any folder. `DANDELION_ROUTES_FILE` points at a different file.

```json
{
  "route": {
    "claude": { "standard": "<line>", "max": "<line>" },
    "claude-work": { "standard": "<line>", "max": "<line>" },
    "agy": { "standard": "<line>", "max": "<line>" },
    "kimi": { "standard": "<line>", "max": "<line>" },
    "grok": { "standard": "<line>", "max": "<line>" },
    "cursor": { "standard": "<line>", "max": "<line>" },
    "junie": { "standard": "<line>", "max": "<line>" },
    "hermes": { "standard": "<line>", "max": "<line>" }
  },
  "high": { "fable": "<line>", "cursor": "<line>", "opus": "<line>", "grok": "<line>", "agy": "<line>" }
}
```

`route` holds one entry per routed provider: `standard` for the headroom rule and `max` for evaporation. `high` holds one line per `--high` rank, named `fable`, `cursor`, `opus`, `grok` and `agy` for ranks 1 to 5. A line is `<model>` or `<model> <effort>`: one or two words, one space apart. dandelion prints lines as written and never checks model names.

`route`, `route --high` and `--once` read and check the whole file once per run; the live dashboard reads it once at start. A bad file is an error, never a fallback: when the file is missing, unreadable or not valid JSON, or when an entry is missing, a key is unknown (`codex` and `kilo` included), a line is not a non-empty string, or a line has the wrong shape, `route` and `route --high` print nothing on stdout, print `dandelion: routes file <path>: <what is wrong>` on stderr and exit 2, even when nothing could be routed. Exit 1 stays reserved for `none`. `--once` prints its dashboard as usual, the same line on stderr, and exits 0. The live dashboard keeps every panel, and both route boxes show `routes file error` over the start of what is wrong.

## Env-var Ledger

- `DANDELION_KILO_REFERENCE` - The reference amount (in dollars) used to calculate the gauge fill percentage for the `kilo` probe. Defaults to `20`. If set to an empty string, no reference gauge is shown. If set to a custom number, the gauge will fill relative to that amount.
- `DANDELION_CLAUDE_WORK_CONFIG_DIR` - The work claude config dir the `claude-work` probe passes to claude as `CLAUDE_CONFIG_DIR`. Defaults to `~/.claude-work` when unset or empty. When it is not a directory the panel says to log in with `CLAUDE_CONFIG_DIR=~/.claude-work claude`.
- `DANDELION_KIMI_PORT` - The local port `kimi web` is started on for the `kimi` probe. Defaults to `59177`. Any value other than an integer from 1 to 65535 makes the kimi panel unavailable.
- `DANDELION_GROK_HOME` - The grok home directory the `grok` probe reads `logs/unified.jsonl` from. Defaults to `~/.grok` when unset or empty. The app never writes to it.
- `DANDELION_CURSOR_AUTH_FILE` - The cursor-agent auth file the `cursor` probe reads `accessToken` from. Defaults to `~/.config/cursor/auth.json` when unset or empty. Without a token the panel says to run `cursor-agent login`.
- `DANDELION_CURSOR_API_BASE` - The base URL of the cursor dashboard API the `cursor` probe POSTs to. Defaults to `https://api2.cursor.sh` when unset or empty.
- `DANDELION_JUNIE_HOME` - The junie home directory the `junie` probe reads `sessions/index.jsonl` and each session's `events.jsonl` from. Defaults to `~/.junie` when unset or empty. The app never writes to it.
- `DANDELION_JUNIE_REFERENCE` - The number of credits a full junie balance holds, used for the `junie` credits window. Defaults to `1000000`. If set to an empty string, there is no reference: the panel shows the balance without a window and junie is not routed. Any other value that is not a positive number uses the default.
- `DANDELION_HERMES_AUTH_FILE` - The hermes auth file the `hermes` probe reads Nous Portal tokens from. Defaults to `~/.hermes/auth.json` when unset or empty. Without a token the panel says to run `hermes portal login`. The tokens are never printed or written.
- `DANDELION_HERMES_PORTAL_BASE` - The base URL of the Nous Portal the `hermes` probe GETs `/api/oauth/account` from. Defaults to `https://portal.nousresearch.com` when unset or empty.
- `DANDELION_REFRESH_SECONDS` - Seconds the live dashboard waits after a round of probes settles before it probes again. Defaults to `300`; any value that is not a positive integer uses the default.
- `DANDELION_STATE_FILE` - The route eligibility state file the live dashboard writes when space toggles a provider, and `route` and `--once` read. Defaults to `$XDG_STATE_HOME/dandelion/eligibility.json`, else `~/.local/state/dandelion/eligibility.json`, when unset or empty. Writes go to a temp file in the same directory, then rename over it.
- `DANDELION_ROUTES_FILE` - The routes file `route`, `route --high`, `--once` and the live dashboard read their lines from. Defaults to `routes.json` next to `package.json` in the checkout `src/main.ts` really lives in, when unset or empty. A relative path is taken from the working directory.
- `NO_COLOR` - If set, disables ANSI colors and uses ASCII fallback rendering.
