# 004-grok — specifier

## Assumptions
- Age uses the existing `formatCountdown` format (`18h0m`, `2d16h`), floored at 0, so the line reads `snapshot 2d16h old`. The task's `3d old` is only an example.
- Stale means an age strictly over 48h. A stale panel stays `ok` with its row, but it is dim throughout with no ramp escape, and the snapshot line becomes `stale snapshot <age> old`. No separate reason line is added.
- The snapshot line goes under the rows and above the plan caption. The caption is `<tier> · grok`, or `grok · grok` with no tier and when unavailable (like `agy · agy`).
- The newest *usable* event wins. It is usable when `ts` is a valid instant and `creditUsagePercent` is a finite number >= 0. Unusable billing events are skipped like malformed lines. usedPct is rounded half-up and not capped, as in kimi.
- A bad or missing `currentPeriod.end` means no countdown. It does not make the panel unavailable.
- An unset or empty `ALLOWANCE_GROK_HOME` means `~/.grok` (os home dir), the same rule as `ALLOWANCE_KIMI_PORT`.
- The Background uses a fixed now of 2026-09-13T10:00:00Z. The task's verified example `ts` is 2d16h old at that time, so it appears as the stale example.

## Done
- `features/004-grok.feature`: order claude, agy, kimi, grok, kilo; the exact NO_COLOR panel; colours; the age/stale boundaries; event variations; skipped bad events; seven unavailable conditions; the default home; no writes to grok home; five-panel "No CLI" (replaces 003's); README; the e2e contents.
- `qa/004-grok.md`: 10 manual steps using a date-relative fixture log.

## Left for coder
- Probe in `src/probes/grok.ts` behind an injected file-reader seam on `ProbeIo` (for example `reader.read(path): Promise<string | undefined>`). The real reader lives in `src/app`. Read only; never write.
- Render: the snapshot line, and the stale dim style. This likely needs a domain field (for example `snapshotAt` on the ok usage). The renderer compares it to `now`.
- README provider list, intro, "All five probes", and the `ALLOWANCE_GROK_HOME` ledger entry.
- `qa/004-grok.e2e.mjs` exactly as pinned in the last scenario. I did not add it now because it would fail until the probe exists. Its fresh-run ts must be relative to the real clock (1h ago) so the panel is not stale.
- Older e2es don't set `ALLOWANCE_GROK_HOME`, so they read the tester's real `~/.grok`. They make no grok assertions, so they still pass. Setting it to an empty temp dir in them is fine.

## Notes
- JS `Date` parses `2026-09-13T21:15:36.133376+00:00` (microseconds, offset) correctly. I checked with node.
- The working tree already had `.marestail/handoffs/003-kimi/18-qa.md` deleted before I started. I left it unstaged.
