# 003 — kimi windows via its local web API

After this task the user also sees their **kimi code** subscription windows (weekly + rolling 5-hour) in the dashboard, between agy and kilo. Unlike the other probes, kimi's `/usage` is not scriptable through the CLI (`kimi -p "/usage"` just forwards text to the model); the numbers come from the local web server's REST endpoint.

## Kimi probe (verified live — this recipe works)

1. Spawn `kimi web --no-open --port <port>` with stdout+stderr redirected to a temp log file. Port: `ALLOWANCE_KIMI_PORT` env var, default `59177`.
2. Poll the log (every 500ms, up to 20s) for `token=([A-Za-z0-9._-]+)` or `Bearer ([A-Za-z0-9._-]+)`.
3. `GET http://127.0.0.1:<port>/api/v1/oauth/usage` with header `Authorization: Bearer <token>` (10s timeout).
4. Always terminate the child process afterwards (SIGTERM, then SIGKILL after 5s), even on failure.

Response JSON (verified shape):

```json
{ "data": {
    "summary": { "used": 590, "limit": 1000, "reset_at": "2026-09-18T10:00:00Z" },
    "limits": [
      { "used": 42, "limit": 100, "window": { "unit": "hour", "value": 5 } }
    ]
} }
```

- `data.summary` → window `weekly`, usedPct = used/limit × 100, resetsAt = `reset_at` when present.
- Each entry of `data.limits` whose `window.unit` is `hour` → window `5h` (rolling), usedPct = used/limit × 100, no reset instant (rolling windows don't have one).
- Any step failing (spawn error, no token in time, HTTP error, malformed JSON, missing `summary`) → `unavailable` with the reason, and the child must still be reaped.
- HTTP requests go through a small injected fetcher interface (like the runner for processes) so tests never open sockets.

## Render

- Kimi panel slot: after agy, before kilo. Header plan label `kimi code`.
- Nothing else changes visually; existing panels, order of the others, gauge math, and ramp thresholds stay as they are.

## QA procedure (extend `qa/`)

Fixture `kimi` executable that emulates `kimi web`: writes a line containing `token=test-token` to its log output, then serves the JSON above on the requested port until killed (a small node script is fine). Run the app with `ALLOWANCE_KIMI_PORT` pointing at a free port and assert the kimi panel shows the weekly window at 59% and the `5h` window at 42%. Add a second e2e where the fixture exits immediately without printing a token and assert the unavailable card renders and the app still exits 0 without hanging (bound it with an outer timeout). All previous e2es keep passing.

## Must not break

- Claude, agy, and kilo probes and panels; panel order elsewhere; the runner/fetcher injection seams; zero runtime dependencies.
- The kimi child process must never be left running after the probe finishes — pin this in a scenario (fixture writes a pid file; e2e asserts the process is gone).
