# Performance

The marestail perf role maintains this file: one row per task, one column per measured target and metric.

Percentages compare each task's HEAD against its start commit, measured back to back in the same run, not against the row above.

| Task | Commit | Date | Rows | cli one-shot kilo ok p50 | cli one-shot kilo ok p95 | cli one-shot kilo missing p50 | cli one-shot kilo missing p95 | runApp kilo ok (in-process, per call) p50 | runApp kilo ok (in-process, per call) p95 | renderDashboard ok (in-process, per call) p50 | renderDashboard ok (in-process, per call) p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 001-scaffold-kilo | 41c96ae | 2026-09-13 | — | 95.437638ms (new) | 99.927073ms (new) | 92.454581ms (new) | 114.168037ms (new) | 4.276821us (new) | 5.8078125us (new) | 1.330612us (new) | 1.832112us (new) |
