# Allowance Dashboard

Allowance is a terminal dashboard that shows how much of your AI allowances you have left: subscription usage windows for `claude` and `agy`, and the API balance for `kilo`.

## Providers

Panels always appear in this order. A provider whose CLI is missing, fails, times out or prints unexpected output renders as a dim panel with the reason.

- `claude` (claude code) - runs `claude -p "/usage"` (90s timeout) and shows the session, weekly and per-model weekly windows with a reset countdown.
- `agy` - runs `agy -p "/usage"` (60s timeout) and shows each model group's windows; agy reports remaining percent, shown as used percent.
- `kilo` (api balance) - runs `kilo profile` (20s timeout) and shows the balance against a reference.

All three probes run in parallel. Window gauges are coloured by usage: below 50% calm, 50-79% warm, 80-94% hot, 95% and above critical.

## Run Commands

- `npm start` - Run the dashboard once and exit
- `npm test` - Run unit tests
- `npm run qa` - Run E2E tests

## Env-var Ledger

- `ALLOWANCE_KILO_REFERENCE` - The reference amount (in dollars) used to calculate the gauge fill percentage for the `kilo` probe. Defaults to `20`. If set to an empty string, no reference gauge is shown. If set to a custom number, the gauge will fill relative to that amount.
- `NO_COLOR` - If set, disables ANSI colors and uses ASCII fallback rendering.
