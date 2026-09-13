# 002 — claude and agy windows join the dashboard

After this task the user sees three providers in the dashboard: claude (subscription windows), agy (subscription windows), and the existing kilo balance card. Both new probes are subprocess-and-parse probes like kilo's, reusing the injected runner.

## Claude probe (verified live)

Run `claude -p "/usage"` (90s timeout — it boots a model session). stdout begins:

```
Current session: 3% used · resets Sep 13, 7:40pm (Europe/London)
Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)
Current week (Fable): 100% used · resets Sep 13, 11pm (Europe/London)
```

(trailing sections about "What's contributing" exist — ignore everything except lines starting `Current `.)

- `Current session: N% used` → window `session`, usedPct N (this is the rolling 5-hour window).
- `Current week (all models): N% used` → window `weekly`, usedPct N.
- `Current week (<model>): N% used` → window `weekly <model>`, usedPct N. Any number of these lines may appear.
- `resets Sep 13, 11pm (Europe/London)` → `resetsAt`. Parse month-name day, 12-hour clock with optional minutes, IANA zone in parentheses; when the zone is absent treat it as UTC. The date has no year: pick the next occurrence of that month/day relative to now (if the parsed instant is more than 2 days in the past, roll the year forward).
- Non-zero exit, timeout, or no `Current week` line → `unavailable` with reason.

## Agy probe (verified live)

Run `agy -p "/usage"` (60s timeout). stdout is tab-separated rows, no header:

```
Gemini Models	Weekly Limit Remaining	100%	2026-09-20T17:13:45Z
Gemini Models	Five Hour Limit Remaining	100%	2026-09-13T22:13:45Z
Claude and GPT models	Weekly Limit Remaining	100%	2026-09-20T17:13:45Z
Claude and GPT models	Five Hour Limit Remaining	100%	2026-09-13T22:13:45Z
```

Columns: model group, window label, **remaining** percent, reset instant (ISO 8601). Map to windows: label `<group> · <window label minus the word "Remaining">` (e.g. `Gemini Models · Weekly Limit`), usedPct = 100 − remaining, resetsAt = column 4. Zero rows, garbage, or non-zero exit → `unavailable`.

## Render

- Provider panels stack vertically in this fixed order: claude, agy, kilo.
- Window rows inside a panel: label left-aligned, 20-cell gauge, `NN%` right of the gauge, then `↻ <countdown>` when the window resets (countdown uses the existing domain formatter against an injected now).
- Utilization styling ramp by usedPct: below 50% `calm`, 50–79% `warm`, 80–94% `hot`, 95%+ `critical`. Keep the four styles as named tokens in the renderer; scenarios pin the thresholds, not the escape codes.
- Panel header carries the provider name and its plan label when known: hardcode `claude → claude code`, `agy → agy` for now (kilo keeps `api balance`).

## QA procedure (extend `qa/`)

Fixture `claude` and `agy` executables printing the transcripts above; run the app; assert all three providers render in the fixed order, `86%` appears for claude weekly, and agy's `100%` remaining renders as `0%` used. Keep the two task-001 e2es passing.

## Must not break

- Kilo card, banner, gauge math, unavailable-state behavior, and the layer direction from task 001.
- Still no runtime dependencies; all spawning stays behind the injected runner.
