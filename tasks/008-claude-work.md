# 008 — second claude account (work) as its own panel

The user runs two claude logins on one machine: personal (default `~/.claude`) and work (`CLAUDE_CONFIG_DIR=$HOME/.claude-work claude`, from their `claude-afk-work` alias). After this task the dashboard shows both accounts as separate panels, each with its own windows — verified today that the two accounts report different percentages and reset times.

## Claude-work probe

Identical recipe and parsing to the personal claude probe from task 002 (`claude -p "/usage"`, 90s timeout, `Current session` / `Current week` lines, reset parsing), with two differences:

1. The spawn env includes `CLAUDE_CONFIG_DIR=<dir>`, where `<dir>` is the `ALLOWANCE_CLAUDE_WORK_CONFIG_DIR` env var, default `~/.claude-work`. Extend the injected runner seam so a probe can pass per-spawn environment variables if it cannot already.
2. Before spawning, check the config directory exists (through the injected file seam). Missing → `unavailable` with reason `no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude`. Never run the claude binary against a missing config dir (it would try to onboard).

The personal probe is unchanged (no `CLAUDE_CONFIG_DIR` override).

Verified live output for the work account today (use as fixture material):

```
Current session: 0% used · resets Sep 13, 11:10pm (Europe/London)
Current week (all models): 12% used · resets Sep 15, 6pm (Europe/London)
Current week (Fable): 23% used · resets Sep 15, 6pm (Europe/London)
```

## Render

- Panel order is now: **claude (personal), claude-work, agy, kimi, grok, codex, cursor, kilo**. Nothing else moves.
- Plan labels: the personal claude panel's header changes from `claude code` to `claude · personal`; the new panel's header is `claude · work`. This label change is part of the task — pin it in scenarios.
- Both claude panels use the same window rows, gauges, and ramp rules as before.

## QA procedure (extend `qa/`)

Fixture `claude` that prints one transcript when `CLAUDE_CONFIG_DIR` is unset (personal: weekly 86%) and the work transcript above when it is set (weekly 12%), plus a fixture `~/.claude-work` directory pointed to by `ALLOWANCE_CLAUDE_WORK_CONFIG_DIR`. Assert: both panels render in order, personal shows `86%` under `claude · personal`, work shows `12%` under `claude · work`. Add an e2e where the work config dir does not exist: the work panel renders the unavailable reason and the personal panel is unaffected. All previous e2es keep passing (note the personal panel's label change — update assertions that pinned `claude code`).

## Must not break

- The personal claude probe recipe and its window parsing; every other provider's panel and their relative order; live mode from task 007 (fleet summary simply counts one more provider's windows); zero runtime dependencies.
