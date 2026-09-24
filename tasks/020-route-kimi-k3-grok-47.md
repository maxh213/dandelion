# 020 — route kimi as kimi-code/k3 max and grok as grok-4.7 xhigh

This task moves three model lines and nothing else. After it, `dandelion route` prints `kimi-code/k3 max kimi` whenever it picks kimi under either rule, so kimi code sessions always launch K3 at max effort and the router can never select the K2.7 highspeed model again. Every grok line moves from 4.6 to 4.7, including the hermes line that reaches grok through OpenRouter's x-ai namespace.

Verified on this machine, 2026-09-24: kimi 2.1.1's config (`~/.kimi-code/config.toml`) defines the alias `kimi-code/k3` (display name "K3", supported efforts low/high/max, default effort max) and still lists `kimi-code/kimi-for-coding-highspeed` as "K2.7 Code Highspeed"; `grok models` lists `grok-4.7` with the `xhigh` effort alongside `grok-4.6`.

## Lines

| where | from | to |
|---|---|---|
| kimi standard and max | `kimi-code/kimi-for-coding-highspeed` | `kimi-code/k3 max` |
| grok standard and max, `--high` rank 4 | `grok-4.6 xhigh` | `grok-4.7 xhigh` |
| hermes standard and max | `x-ai/grok-4.6 xhigh` | `x-ai/grok-4.7 xhigh` |

- Kimi's line gains an effort token: output becomes the three-word shape `kimi-code/k3 max kimi`, the same `<model> <effort> <provider>` shape claude already prints. Both rules print it: standard and max are identical, as they were for the highspeed line. The token is belt and braces — k3's configured default effort is already max, so a consumer that drops the effort word still launches K3 at max.
- The `--high` chain changes only at rank 4's string. Ranks, providers, matchers, gating windows and the 90% trip are untouched, and kimi, junie, hermes and kilo stay out of the chain.
- Dashboard order, panel captions and probes do not change: the kimi probe still reads `kimi web`, grok still reads `~/.grok`, hermes still reads the Nous Portal. This task touches printed lines, not usage parsing.

## Living surfaces

Every place that prints or asserts an old line moves to the new one: the routing table and HIGH_CHAIN in src/domain/route.ts, the README route table and `--high` table (and the main.test.ts assertions that pin them), the affected scenarios in features/010, 012, 014, 015, 016 and 018, the qa procedures and e2e expectations under qa/, and the perf expectations (bench_trip's grok strings, bench_route, bench_eligibility) so the perf judge still runs green. Historical task files tasks/001–019 keep the strings that were true when they ran.

## Tests and QA

Unit: the routing-table test rows for kimi, grok and hermes assert the new lines; routeLine and highRouteLine cases that expected an old line expect the new one, with inputs and outcomes otherwise unchanged. E2e: the same scenario inputs, only the expected strings move — kimi cases print `kimi-code/k3 max kimi`, grok cases `grok-4.7 xhigh grok`, hermes cases `x-ai/grok-4.7 xhigh hermes`, and the `none`/exit-1 cases are untouched. The route box renders `kimi-code/k3 max` over `kimi` when kimi is picked.

## Must not break

- Decision logic: evaporation with the sub-97% weekly rule, headroom bindings, the inclusive 90% rolling trip, eligibility toggles and the state file, ties by dashboard order, `none` with exit 1, the account token.
- The claude, claude-work, agy, cursor and junie lines; the whole `--high` chain apart from rank 4's string; codex and kilo stay unrouted.
- 018's kimi usage parsing, every probe, and the live UI apart from the new strings in the route boxes.
