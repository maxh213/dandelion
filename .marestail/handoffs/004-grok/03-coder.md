# 004-grok — coder

## Done
- `src/probes/grok.ts`: `probeGrok` reads `<grok home>/logs/unified.jsonl` through a new `FileReader` seam (`homeDir()`, `read(path)`). The home is `ALLOWANCE_GROK_HOME`, or `homeDir()/.grok` when it is unset or empty. The probe scans the log from its last line back and picks the newest usable billing event. Unusable events are skipped, and "no event" gives the unavailable reason. It only reads.
- The probe duplicates the `field`/instant/count helpers from kimi.ts, because the dependency rules forbid probes importing each other. It uses the same date check as kimi's `instantOf`.
- Domain: an optional `snapshotAt` on the ok usage.
- Render (`terminal.ts`): the snapshot line is `snapshot <formatCountdown(now, ts)> old`. Fresh panels dim it separately. When age > 48h, `renderPanelStale` dims the whole block, including the row, which has block glyphs and no ramp escape.
- `ProbeIo` now includes `GrokIo`. The order is claude, agy, kimi, grok, kilo. `realReader` in `src/app` uses `readFile(...).catch(() => undefined)`, so a missing file, a directory or mode 000 all read as undefined.
- README: intro, grok provider line, "All five probes", and the `ALLOWANCE_GROK_HOME` ledger entry.
- `qa/004-grok.e2e.mjs` as pinned: two runs, the prefix `allowance-qa-004-`, the ts one hour ago, and a grok home check that paths, sizes, mtimes and contents are unchanged.

## Older e2e changes (needed, please review)
- 001 and 002 inherited the tester's real `~/.grok`. On this machine that gave a 99% grok gauge, which broke 001's "unavailable panel still shows a gauge" check.
- Both now set `ALLOWANCE_GROK_HOME` to their temp fixture dir, which has no logs.
- The grok unavailable reason contains `—`, which their NO_COLOR ASCII checks rejected. `—` is now allowed there too.
- 003 is unchanged: it makes no grok or glyph assertions. The suite passes with the real HOME and with an empty HOME.

## Left / notes
- The live check against the real `~/.grok` renders `credits 99%`, `snapshot 1d5h old` and `SuperGrok Heavy · grok`.
- `marestail gate --tier fast` passed. The full e2e suite passes.

## Audit
- Grok panel renders the newest snapshot between kimi and kilo -> src/app/index.test.ts::renders the newest snapshot between kimi and kilo
- Fresh grok panel colours -> src/app/index.test.ts::colours a fresh grok panel warm with a dim snapshot line and caption
- Snapshot age and staleness -> src/app/index.test.ts::shows a snapshot taken at %s as "%s"
- A stale grok panel is dim throughout -> src/app/index.test.ts::dims a stale grok panel throughout without a ramp escape
- Billing event variations -> src/app/index.test.ts::renders the only billing event with ctx %s
- Unusable billing events are skipped in favour of an older usable one -> src/app/index.test.ts::skips unusable billing events in favour of an older usable one
- No usable grok snapshot renders a dim unavailable panel -> src/app/index.test.ts::renders a dim unavailable grok panel with %s while the others render normally
- Grok home defaults to ~/.grok -> src/probes/grok.test.ts::defaults grok home to ~/.grok for %j
- The app never writes to grok home -> src/app/index.test.ts::renders from a real grok home and a missing one without writing to either
- No CLI on the PATH at all -> src/main.test.ts::prints five dim unavailable panels when no CLI is on PATH and grok home is empty
- README documents grok -> src/main.test.ts::README documents grok
- Earlier end-to-end checks keep passing -> qa/004-grok.e2e.mjs::grokShowsNewestSnapshot
