# 006 — cursor windows via the dashboard API

After this task the user also sees their **cursor-agent** plan usage (after codex, before kilo). Cursor's print mode forwards `/usage` to the model instead of answering it, so the probe calls the same backend RPC the CLI's interactive `/usage` uses, with the CLI's own stored token.

## Cursor probe (verified live)

1. Read the access token from the JSON file at `ALLOWANCE_CURSOR_AUTH_FILE`, default `~/.config/cursor/auth.json` — shape: `{"accessToken": "...", "refreshToken": "..."}`. Missing/unreadable/no token → `unavailable` (`no cursor auth — run cursor-agent login`).
2. POST JSON `{}` with header `Authorization: Bearer <token>` and `Content-Type: application/json`, 15s timeout each, through the injected fetcher:
   - `https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
   - `https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo`

Verified response shapes (extra fields must be tolerated):

```json
{ "billingCycleStart": "1788108306000", "billingCycleEnd": "1790786706000",
  "planUsage": { "totalSpend": 101050, "includedSpend": 40000, "limit": 40000,
    "autoPercentUsed": 32.36, "apiPercentUsed": 15.81, "totalPercentUsed": 31.09 } }
```
```json
{ "planInfo": { "planName": "Ultra", "includedAmountCents": 40000, "price": "$200/mo",
  "billingCycleEnd": "1790786706000" } }
```

- Windows: `total` = `totalPercentUsed`, `auto` = `autoPercentUsed`, `api` = `apiPercentUsed` — each with resetsAt = `billingCycleEnd` (milliseconds since epoch, as a string).
- Plan label = `planName` + price, e.g. `Ultra · $200/mo`, from GetPlanInfo; if that call fails, fall back to `cursor`.
- If GetCurrentPeriodUsage fails → `unavailable` with the HTTP status in the reason.
- Never print or persist the token; the reason strings must not contain it.

## Render

- Cursor panel slot: after codex, before kilo. Header shows the plan label.
- Window rows as usual; the `total` row first.

## QA procedure (extend `qa/`)

Fixture auth file (dummy token) plus a tiny local HTTP fixture — point the probe's base URL at it with an env override `ALLOWANCE_CURSOR_API_BASE` (add it, document it in the README ledger) — serving the two responses above. Assert the panel shows `Ultra · $200/mo`, `31%` total, and the reset countdown. A second e2e with a missing auth file asserts the unavailable card. All previous e2es keep passing.

## Must not break

- All existing probes, panels, and order; injection seams; zero runtime dependencies; no secrets in any output, log, or committed fixture.
