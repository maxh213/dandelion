# 018 — parse kimi 2.0 usage so the panel shows the live windows

The kimi panel currently renders dim with `Could not parse usage from response` and caption `kimi code · kimi` even when kimi has a working subscription. Task 003's probe still expects `{ data: { summary: { used, limit, reset_at }, limits: [{ used, limit, window: { unit: "hour" } }] } }`. Kimi 2.0.0's local web server no longer returns that shape, so `weeklyWindow` throws `USAGE_PARSE_FAILURE` on every successful fetch.

This task changes no other provider. After it, a live `kimi web` usage body like the one below paints weekly + 5h gauges, and `dandelion route` can use kimi again.

## Live body (verified 2026-09-19 against kimi 2.0.0)

Spawn `kimi web --no-open --port 59199`, take the token from `Local: http://127.0.0.1:59199/#token=…` (or the `Token:` line), then `GET /api/v1/oauth/usage` with `Authorization: Bearer <token>`. Verified JSON (extra fields must be tolerated):

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "kind": "ok",
    "quota": {
      "usages": {
        "limit5h": { "usedRatio": 0, "resetAt": "2026-09-19T14:58:50Z" },
        "limit7d": { "usedRatio": 0, "resetAt": "2026-09-25T12:58:50Z" }
      },
      "extraUsage": null
    }
  },
  "request_id": "01M2WR59QVZ5WJFMF4A6TWESJB"
}
```

The old 003 fields (`data.summary.used`, `data.summary.limit`, `data.limits[].window.unit`) are absent. `usedRatio` is a number in 0..1 (this capture is `0` because the windows were unused; that must still paint `0%`, not fail to parse). The spawn / token / Bearer GET / SIGTERM-then-SIGKILL recipe is unchanged.

## Parse

- `code` not `0` → `unavailable` with reason `kimi usage request failed` plus `msg` when it is a non-empty string (same family as HTTP failures, not `USAGE_PARSE_FAILURE`).
- `data.kind` other than `"ok"`, or missing `quota.usages` as an object → `Could not parse usage from response`.
- `quota.usages.limit7d` with a finite `usedRatio` ≥ 0 → window `weekly`, kind `weekly`, `usedPct` = `round(100 * usedRatio)` clamped to 0..100, `resetsAt` = `resetAt` when `validInstant` accepts it. `0` → `0%`; `0.595` → `60%`; `1` → `100%`; `1.2` → `100%`.
- `quota.usages.limit5h` with a finite `usedRatio` ≥ 0 → window `5h`, kind `rolling`, `usedPct` the same way. Rolling windows still have no `resetsAt` in the panel (keep today's render), even though the payload has `resetAt`.
- Skip a key whose `usedRatio` is missing, not a number, or negative. If both keys are skipped, `Could not parse usage from response`.
- `extraUsage` is `null` in the live body; ignore it. Do not invent a third window.
- Still go through the injected fetcher; never print or persist the token.

## Render and route

Unchanged except the windows now exist: weekly with countdown, then `5h` gauge, caption `kimi code · kimi`. Kimi stays after agy and before grok. Route still uses kimi's `5h` as the rolling trip window and the weekly as the binding; `--high` still does not use kimi.

## Tests and QA

Replace 003's fixture JSON and `src/probes/kimi.test.ts` bodies with the 2.0 shape. Keep the same panel numbers the e2es already assert by using `usedRatio` `0.59` (weekly 59%) and `0.42` (5h 42%) in the happy-path fixture, and `resetAt` instants in place of `reset_at`.

Pin in unit tests (injected launcher/fetcher, no sockets):

- The verified live body (`usedRatio` `0` on both keys) → `ok` with weekly `0%` (`resetsAt` `2026-09-19T14:58:50Z`) and `5h` `0%`.
- `limit7d.usedRatio` `0.595` and `limit5h.usedRatio` `0.42` → weekly `60%`, `5h` `42%`.
- `code` `1` `msg` `"quota denied"` → unavailable, reason contains `kimi usage request failed` and `quota denied`.
- Missing `usages`, `kind` `"error"`, truncated JSON, string `usedRatio` → `Could not parse usage from response`, child still stopped.
- Spawn, token scrape, Bearer GET, and SIGTERM/SIGKILL behaviour from 003 stay.

QA: the existing kimi fixture in `qa/` serves the new JSON; the 003 e2e still shows weekly 59% and 5h 42%. A second fixture serving the live `usedRatio` `0` body shows `0%` on both rows, not the parse-failure card. Previous e2es keep passing; the kimi child is still gone afterwards.

## Must not break

- Claude, claude-work, agy, grok, cursor, junie, hermes, kilo probes and panel order; injection seams; zero runtime dependencies; kilo still never routed.
- 010–017: route tokens, `--high`, trip at 90% on rolling windows, junie and hermes slots.
