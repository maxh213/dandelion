# 007 — live dashboard: parallel probes, auto-refresh, keys

After this task the dashboard stops being a one-shot snapshot and becomes a live instrument: all seven providers (claude, kimi, kilo, grok, codex, cursor, agy) probe in parallel, panels appear as data lands, and the view refreshes itself until the user quits.

## User outcome

`npm start` opens the live dashboard. `npm start -- --once` keeps the current one-shot behavior (probe all, print, exit 0) — scripts and the existing e2es depend on it.

## Behavior

- **Parallel probing**: all probes start together; each has its own timeout (already defined per probe). One probe failing or hanging must never delay or blank the others — panels render independently as each probe settles (Promise.allSettled semantics).
- **Pending state**: while a probe is in flight its panel shows a braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, one frame per 100ms tick) and the caption `probing…`.
- **Auto-refresh**: re-probe everything every `ALLOWANCE_REFRESH_SECONDS` (default 300). During a refresh, keep showing the previous data (no flicker to pending); a dim `refreshing…` marker appears in the banner and the banner shows the age of the oldest settled result.
- **Keys** (raw-mode stdin): `r` forces a refresh now, `q` or Ctrl-C quits cleanly (restore the terminal, exit 0), `?` toggles a one-line help footer listing the keys.
- **Fleet summary line** under the banner: `3/8 windows above 80% · next reset: claude weekly in 5h12m` — computed from settled results only; when nothing is above 80% the first segment reads `all windows below 80%`.
- **Sorting stays fixed** (provider order is unchanged); this task adds liveness, not rearrangement.
- Alternate screen: the live mode renders on the alternate screen buffer and restores the main screen on exit; `--once` prints inline as today.
- Non-TTY stdout: always behave as `--once`.

## Render

- Spinner frames, the `refreshing…` marker, the help footer, and the fleet summary line join the existing vocabulary; everything else (panels, gauges, ramp, captions) renders exactly as before.
- The summary's `next reset` picks the soonest future resetsAt across all windows of all providers; ties broken by provider order.

## QA procedure (extend `qa/`)

- All existing e2es now invoke the app with `--once` (update them; assertions unchanged).
- New e2e: with the full fixture PATH, run the app in live mode with `ALLOWANCE_REFRESH_SECONDS=1`, wait for two rendered frames on a pty (or piped stdout in non-TTY fallback — assert it prints one frame and exits only on stdin close), send `q`, assert clean exit 0 and terminal restoration sequence emitted.
- New e2e: fixture where one probe (e.g. `kilo`) sleeps longer than its timeout — assert the other panels render complete data and kilo's panel shows its timeout/error state, all within the overall bound.

## Must not break

- `--once` output bytes for a fixed fixture set (existing e2es prove it); probe recipes, panel order, gauge math, ramp thresholds, and every unavailable/error state from tasks 001–006; zero runtime dependencies; no orphaned child processes on quit (pin: quit during an in-flight kimi probe still reaps the child).
