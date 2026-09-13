# 004 — grok window from its local billing log

After this task the user also sees their **grok** subscription window (credit usage + reset) in the dashboard, after kimi and before kilo. Grok's CLI has no scriptable quota command (`grok usage` is per-session token accounting), but every grok run logs the billing snapshot it fetches; the probe reads the most recent one.

## Grok probe (verified against the real log)

Read the newline-delimited JSON log at `<grok home>/logs/unified.jsonl`, where grok home is `ALLOWANCE_GROK_HOME` env var, default `~/.grok`. Scan **backwards** (newest last) for the most recent line whose `msg` is `billing: fetched credits config`. Verified event shape:

```json
{
  "ts": "2026-09-10T17:14:22.812Z",
  "msg": "billing: fetched credits config",
  "ctx": {
    "config": {
      "creditUsagePercent": 75.0,
      "currentPeriod": { "type": "USAGE_PERIOD_TYPE_WEEKLY",
        "start": "2026-09-06T21:15:36.133376+00:00",
        "end": "2026-09-13T21:15:36.133376+00:00" }
    },
    "subscriptionTier": "SuperGrok Heavy"
  }
}
```

- Window `credits`: usedPct = `creditUsagePercent`, resetsAt = `currentPeriod.end`.
- Plan label = `subscriptionTier` when present (e.g. `SuperGrok Heavy`), else `grok`.
- The event's own `ts` is the data's age: surface it on the panel as `snapshot <countdown-ish age>` (e.g. `snapshot 3d old`) — age = injected now minus `ts`. When the newest event is older than 48h, render the panel in the dim/stale style and prefix the reason line with `stale`.
- Log file missing, unreadable, or no billing event found → `unavailable` with reason `no grok billing snapshot — run grok once`.
- Read through an injected file-reader seam (same philosophy as runner/fetcher); never crash on malformed lines — skip them.

## Render

- Grok panel slot: after kimi, before kilo. Header shows the subscription tier as the plan label.
- The panel carries a `snapshot <age>` caption in dim text under the window rows.

## QA procedure (extend `qa/`)

Fixture grok home: write `logs/unified.jsonl` containing a couple of noise lines plus two billing events (an older one at 60% and the newest at 75% with the shape above). Run the app with `ALLOWANCE_GROK_HOME` pointed at the fixture and assert the grok panel shows `75%` (newest wins) and the tier label. A second e2e with an empty fixture home asserts the unavailable card with the `run grok once` reason. All previous e2es keep passing.

## Must not break

- All existing probes, panels, and their order; injection seams; zero runtime dependencies; the app must never write to the grok home.
