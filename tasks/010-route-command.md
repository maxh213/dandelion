# 010 — `dandelion route`: pick the subscription to burn

After this task the user can type `dandelion route` and get one line naming which CLI subscription to use right now, at what setting — e.g. `claude-opus-5 max`. It reuses the existing probes and adds a pure decision function over their windows.

## Command

- `node src/main.ts route` (and the `dandelion` bin) runs all probes once (same parallel probing and per-probe timeouts as `--once`), prints exactly one line to stdout, and exits 0. No dashboard, no ANSI, no alternate screen — scriptable output only.
- Only providers with at least one usage window participate: claude (personal + work as separate entries), agy, kimi, grok, cursor. kilo (a balance, not windows) and codex in api-key mode (no windows) are excluded from routing; document this in the README.
- Every provider unavailable/error → print `none` and exit 1.

## Decision rules (exact)

Windows gain a `kind` in the domain model: `rolling` (claude `session`, kimi `5h`, agy `Five Hour Limit`), `weekly` (labels containing `week`, plus grok `credits` and the cursor cycle windows), or `other`. Probes set it; the dashboard renderer is unchanged.

For each provider compute `left = 100 − usedPct` per window, then:

1. **Evaporation override.** Among providers having a `weekly` window that resets **before local midnight tonight** with `left < 97`: pick the one with the **highest** weekly left. Print its **max** line from the routing table. (Rationale: a weekly window ending today that you've started is use-it-or-lose-it — burn it wide open. Example: claude weekly 14% left resetting today ⇒ `claude-opus-5 max`.)
2. **Most headroom.** Otherwise, per provider take `binding = min(left over its rolling windows, left over its weekly windows)` (a missing kind counts as 100). Pick the provider with the **highest** binding; ties go to the earlier provider in the dashboard's fixed order. Print its **standard** line.
3. Rounding: compare on the raw floats; no rounding before comparison.

## Routing table (built-in constant, one entry per provider)

| provider | standard line | max line |
|---|---|---|
| claude personal | `claude-opus-5 high` | `claude-opus-5 max` |
| claude work | `claude-opus-5 high` | `claude-opus-5 max` |
| agy | `gemini-3.1-pro-high medium` | `gemini-3.1-pro-high high` |
| kimi | `kimi-code/kimi-for-coding-highspeed` | `kimi-code/kimi-for-coding-highspeed` |
| grok | `grok-4.6` | `grok-4.6` |
| cursor | `kimi-k3-max` | `kimi-k3-max` |

(The table is data in the domain layer; every value is pinned by tests. The claude entries intentionally coincide — personal first in tie order.)

## QA procedure (extend `qa/`)

Fixture probes with controllable percentages and reset times (fixtures already fake the CLIs; make the reset instants relative to now so the cases stay deterministic). Assert exactly:

- claude weekly 86% used resetting **today**, agy untouched ⇒ prints `claude-opus-5 max` (evaporation beats agy's perfect headroom).
- All weekly resets **days away**, claude-work binding highest ⇒ prints `claude-opus-5 high`.
- kimi 5h 90% used while its weekly is 10% used ⇒ kimi's binding is its 5h window; a provider with 50% used on both beats it.
- All providers unavailable ⇒ prints `none`, exit 1.
- `node src/main.ts --once` and the whole prior e2e suite are untouched and keep passing.

## Must not break

- Dashboard rendering, live mode, panel order, probe recipes, and every prior e2e. The `route` subcommand shares the probes but must not change what they return for the dashboard (window `kind` is additive).
