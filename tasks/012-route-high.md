# 012 — `dandelion route --high`: quality-ranked fallback chain

After this task the user can type `dandelion route --high` and get the *strongest* model+effort combo that currently has quota, falling down a fixed quality chain when a subscription trips 90% or is toggled off. Plain `route` keeps its 010 semantics (evaporation override, then most headroom) — `--high` is quality-first: no evaporation rule, no headroom comparison, just the first available entry in the chain.

## The chain (data in the domain layer, ordered, every value pinned by tests)

| rank | provider(s) | gating windows | line |
|---|---|---|---|
| 1 | claude personal, claude work | `fable` | `claude-fable-5-1 max` |
| 2 | cursor | *(all)* | `kimi-k3-max` |
| 3 | claude personal, claude work | *(all)* | `claude-opus-5 max` |
| 4 | grok | *(all)* | `grok-4.6 xhigh` |
| 5 | agy | *(all)* | `gemini-3.8-flash-high high` |

(`claude-fable-5-1` is verified as a real model id on this machine's claude CLI; `kimi-k3-max` is cursor's K3 model id, also verified. The chain is one exported constant so the user can retune it later. Two claude entries at the same rank: the account with the higher left on its gating windows wins; tie goes to panel order — personal first.)

## Fable is its own window — gate on it specifically

The claude `/usage` output carries a **separate Fable weekly window** (`Current week (Fable): N% used · resets …`) which the 002 probe already parses into a window labelled `weekly Fable` — a fable entry must be gated on *that* window, not the all-models one. An entry's `gating windows` is a case-insensitive label matcher: the entry's windows are the provider windows whose label contains the matcher (`fable`), plus — always — the provider's rolling/session window (the 5h rate limiter gates every model). An entry with `*(all)*` is gated on every window the provider reports. If the named window is absent from the account's `/usage`, it counts as 0% used (the account simply hasn't touched that model this week).

## Availability rule — pop down over 90%

For an entry to be *available* its provider must be eligible (011's toggle state — skipped silently when off) and **every gating window must be under 90% used**: as soon as any one of them trips 90%, the walker pops down to the next chain entry. unavailable/error probes count as tripped. kilo and codex-in-api-key-mode never appear in the chain (no windows). Live example of why the matcher matters: the user's personal account is 86% all-models but **100% Fable** — the fable rank must not fire there, while the work account at 23% Fable is fair game.

- Walk the chain from rank 1 down; print the first available entry's line and exit 0.
- Nothing available: print `none`, exit 1.
- Same output discipline as plain `route`: exactly one line, no ANSI, no dashboard.
- README's route section documents `--high`, the chain order, the per-entry gating windows, and the 90% trip.

## Account token

Both `route` and `route --high` print a **third token: the provider id** of the chosen account — `claude-fable-5-1 max claude-work`, `kimi-k3-max cursor`, `grok-4.6 xhigh grok`. Several providers can share one model line (the two claude accounts), and the account decides how to launch it; without the token the output is ambiguous. The README's route section documents the mapping, including that `claude-work` means launching with `CLAUDE_CONFIG_DIR` (default `~/.claude-work`, from `DANDELION_CLAUDE_WORK_CONFIG_DIR`). This also updates plain `route` output from 010 (its table gains the same third token; its existing e2e assertions are updated to match — decision logic unchanged).

## QA procedure (extend `qa/`)

Fixture claude transcripts carry both `Current week (all models)` and `Current week (Fable)` lines with controllable percentages (reset instants irrelevant — no evaporation in `--high`). Assert exactly:

- Personal 86% all-models / **100% Fable**, work 12% all-models / 23% Fable ⇒ `claude-fable-5-1 max claude-work` (personal's fable window is tripped even though its all-models window is not).
- Personal 40% Fable, work 70% Fable ⇒ `claude-fable-5-1 max claude-work`; then work 95% Fable ⇒ `claude-fable-5-1 max claude` (pops back to personal).
- Personal transcript has **no Fable line** (window counts 0%) and its other windows are under 90% ⇒ fable rank fires on personal.
- Both accounts' Fable ≥ 90%, cursor healthy ⇒ `kimi-k3-max cursor`.
- Cursor also ≥ 90% on any window, claude personal all-windows under 90% ⇒ `claude-opus-5 max claude`.
- Claude and cursor tripped, grok binding 60% ⇒ `grok-4.6 xhigh grok`.
- Everything tripped or error ⇒ `none`, exit 1.
- With `{"claude-work": false}` in the state file and personal's Fable tripped, cursor healthy ⇒ `kimi-k3-max cursor` (work skipped, personal unavailable).
- Plain `route` prints the account token too (`<line> <provider>`); its decision rules from 010 are unchanged, and its existing e2es are updated only for the added token.

## Must not break

- Plain `route` decision rules and output; eligibility toggle (011); dashboard and live mode; the routing table from 010 (the `--high` chain is a separate constant, not a replacement); claude probe parsing of all three `/usage` window lines (002).
