# Allowance Dashboard

Allowance is a terminal dashboard that displays API balances from various providers.

## Run Commands

- `npm start` - Run the dashboard once and exit
- `npm test` - Run unit tests
- `npm run qa` - Run E2E tests

## Env-var Ledger

- `ALLOWANCE_KILO_REFERENCE` - The reference amount (in dollars) used to calculate the gauge fill percentage for the `kilo` probe. Defaults to `20`. If set to an empty string, no reference gauge is shown. If set to a custom number, the gauge will fill relative to that amount.
- `NO_COLOR` - If set, disables ANSI colors and uses ASCII fallback rendering.
