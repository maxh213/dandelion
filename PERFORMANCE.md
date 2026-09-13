# Performance

The marestail perf role maintains this file: one row per task, one column per measured target and metric.

Percentages compare each task's HEAD against its start commit, measured back to back in the same run, not against the row above.

| Task | Commit | Date | Rows | cli one-shot kilo ok p50 | cli one-shot kilo ok p95 | cli one-shot kilo missing p50 | cli one-shot kilo missing p95 | runApp kilo ok (in-process, per call) p50 | runApp kilo ok (in-process, per call) p95 | renderDashboard ok (in-process, per call) p50 | renderDashboard ok (in-process, per call) p95 | cli one-shot claude+agy+kilo ok p50 | cli one-shot claude+agy+kilo ok p95 | runApp claude+agy+kilo ok (in-process, per call) p50 | runApp claude+agy+kilo ok (in-process, per call) p95 | renderDashboard three providers with windows (in-process, per call) p50 | renderDashboard three providers with windows (in-process, per call) p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 001-scaffold-kilo | 41c96ae | 2026-09-13 | — | 95.437638ms (new) | 99.927073ms (new) | 92.454581ms (new) | 114.168037ms (new) | 4.276821us (new) | 5.8078125us (new) | 1.330612us (new) | 1.832112us (new) | — | — | — | — | — | — |
| 002-claude-agy | 40fd754 | 2026-09-13 | — | 104.300501ms (+4.1%) | 153.05901ms (+1.9%) | 101.75363ms (+9.1%) | 146.732672ms (+45.6%) ⚠ | 7.307944us (+63.8%) ⚠ | 7.924192us (+25.4%) ⚠ | 1.310366us (-8.4%) | 1.6999205us (+6.4%) | 117.705163ms (+25.8%) ⚠ | 141.016294ms (+19.5%) ⚠ | 65.04499475us (+1359.7%) ⚠ | 75.5757625us (+1269.7%) ⚠ | 12.423164us (new) | 12.709492us (new) |
