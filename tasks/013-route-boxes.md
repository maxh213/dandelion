# 013 — Route boxes at the top of the live dashboard

After this task, a user watching the live dashboard (`npm start` / `dandelion` on a terminal) sees two boxes side by side at the top: the answer `dandelion route` would print and the answer `dandelion route --high` would print. They no longer need a second terminal to ask which subscription to use.

## Where and what

The boxes go between the fleet summary line and the first provider panel. Together they fill the dashboard's 72-cell width: two 35-cell boxes with a 2-cell gap.

```
DANDELION                                   data 0h1m old · 14:02:11Z
all windows below 80% · next reset: claude session in 2h10m
┌─ route ─────────────────────────┐  ┌─ route --high ──────────────────┐
│ claude-opus-5 high              │  │ claude-fable-5-1 max            │
│ claude-work                     │  │ claude-work                     │
└─────────────────────────────────┘  └─────────────────────────────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
claude
...
```

- The left box is titled `route` and the right box `route --high`. The title sits in the top border.
- Row 1 is the model line (`claude-opus-5 high`, `kimi-k3-max`) and row 2 is the provider id (`claude-work`, `cursor`). Together they are exactly the two parts of what the CLI prints, so `claude-opus-5 high claude-work` shows as `claude-opus-5 high` over `claude-work`.
- Text has one space of padding on each side, which leaves 31 cells. A longer line is cut with `…`, the same way window labels already are: `kimi-code/kimi-for-coding-highspeed` shows as `kimi-code/kimi-for-coding-high…`.
- When a rule gives no route, row 1 is `none` and row 2 is `no subscription available`, both dim.
- Borders are dim. The model line is bold. With `NO_COLOR`, borders use `+`, `-` and `|`, and there is no ANSI at all, as in the rest of the dashboard.

## When the boxes change

- **Before the first round settles:** both boxes show `⠋ probing…` in row 1, animated with the existing spinner, and an empty row 2. A route needs every probe's result, the same as the CLI.
- **When a round settles:** both boxes are recomputed from that round's results, the current eligibility state and the current time, using the same local time zone the `route` command uses.
- **During a refresh round (`r` or the timer):** the boxes keep the previous round's answers until the new round settles. The banner already says `refreshing…`.
- **When space toggles a provider's routing on or off:** both boxes are recomputed straight away from the settled results. Turning off the account a box names moves that box to its next answer on the same frame.

**The invariant:** for the same probe results, eligibility state and time, each box shows exactly what `dandelion route` and `dandelion route --high` print. Reuse the domain's `routeLine` and `highRouteLine`. Never duplicate the decision rules.

## Must not break

- `dandelion route` and `route --high` output and exit codes (tasks 010, 011 and 012).
- `--once` and non-terminal output. The boxes are live-only, so the one-shot dashboard is unchanged.
- Panel order, selection with `↑↓/jk`, the space toggle and its flashes, `r`, `q`, `?`, and the fleet summary line. The boxes are not selectable, and `↑↓/jk` still moves only over provider panels.
- The dependency contract: decisions stay in domain, drawing stays in render, and app only wires them together.

## README

In the `npm start` description in Run Commands, say that the live dashboard shows the `route` and `route --high` answers in two boxes at the top, and that they update when a round settles or routing is toggled.

## QA procedure

Use fake provider CLIs and fixtures, the same way the 010, 011 and 012 e2es do, and drive the live session through `qa/live-session.mjs`.

- The fixture from 012 (personal 86% all models / 100% Fable, work 12% all models / 23% Fable, the other providers healthy): after the round settles, the `route` box shows the same two parts `dandelion route` prints for those fixtures, and the `route --high` box shows `claude-fable-5-1 max` over `claude-work`.
- Before any probe settles, both boxes show `probing…`.
- Select the `claude-work` panel and press space. Without a refresh, on the same frame, the `route --high` box changes to `kimi-k3-max` over `cursor`: work is off and personal's Fable is tripped. Pressing space again brings back `claude-fable-5-1 max` over `claude-work`.
- Everything tripped or failing: both boxes show `none` over `no subscription available`.
- A kimi-only routable fixture: the `route` box shows `kimi-code/kimi-for-coding-high…` over `kimi`.
- `NO_COLOR=1`: the boxes are drawn with `+-|` and the frame has no escape codes other than the screen control sequences.
- `dandelion --once` output for the same fixture is byte-identical to its output before this task.
