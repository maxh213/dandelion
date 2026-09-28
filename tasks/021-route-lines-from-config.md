# 021 — read route lines from routes.json, and route claude as Opus 5.5

After this task, changing which model dandelion routes to is a one-line edit to `routes.json`. There is no code change, no test change and no pipeline run. The first edit ships with the task: every claude line moves from `claude-opus-5` to `claude-opus-5-5`, so `dandelion route` prints `claude-opus-5-5 high claude` where it printed `claude-opus-5 high claude`.

Why: task 020 moved three model strings and took a 44-step run, because the strings are pinned in route.ts, the README, unit tests, features 010–020, the qa procedures and e2e files, and the perf benches. The model strings are data that changes every few weeks. The routing rules rarely change, so they stay in code.

Build on 020 (branch `marestail/020-route-kimi-k3-grok-47`, merged first); the lines below are the post-020 lines.

## The file

`routes.json` at the repo root, found relative to the app (not the working directory), so `node ~/workspace/dandelion-stable/src/main.ts route` from any folder reads dandelion-stable's file. `DANDELION_ROUTES_FILE` points at a different file instead; unset or empty means the shipped one.

Shipped content:

```json
{
  "route": {
    "claude":      { "standard": "claude-opus-5-5 high",       "max": "claude-opus-5-5 max" },
    "claude-work": { "standard": "claude-opus-5-5 high",       "max": "claude-opus-5-5 max" },
    "agy":         { "standard": "gemini-3.8-flash-high high", "max": "gemini-3.1-pro-high high" },
    "kimi":        { "standard": "kimi-code/k3 max",           "max": "kimi-code/k3 max" },
    "grok":        { "standard": "grok-4.7 xhigh",             "max": "grok-4.7 xhigh" },
    "cursor":      { "standard": "kimi-k3-max",                "max": "kimi-k3-max" },
    "junie":       { "standard": "gemini-3.8-flash high",      "max": "gemini-3.8-flash high" },
    "hermes":      { "standard": "x-ai/grok-4.7 xhigh",        "max": "x-ai/grok-4.7 xhigh" }
  },
  "high": {
    "fable":  "claude-fable-5-1 max",
    "cursor": "kimi-k3-max",
    "opus":   "claude-opus-5-5 max",
    "grok":   "grok-4.7 xhigh",
    "agy":    "gemini-3.8-flash-high high"
  }
}
```

- `route` holds the lines for plain `route`: `standard` for the headroom rule, `max` for evaporation. The provider ids are the ones dandelion routes today; codex and kilo stay unrouted and are not in the file.
- `high` holds one line per `--high` chain entry, named `fable`, `cursor`, `opus`, `grok` and `agy` for ranks 1–5. The chain's order, providers, the `fable` window matcher and the 90% trip stay in code; only the printed strings move to the file.
- Lines are opaque strings. dandelion prints them as written and never checks model names.

## When the file is wrong

A route pointing at a model nobody asked for is worse than no route, so a bad file is an error, never a silent fallback:

- Missing file, unreadable file, or invalid JSON: `route` and `route --high` print nothing on stdout, print `dandelion: routes file <path>: <what is wrong>` on stderr, and exit 2. Exit 1 stays reserved for `none`.
- A routed provider id or a `high` entry that is missing, a `standard`/`max`/line that is not a non-empty string, or a key dandelion does not know (a typo such as `claude-wrok`): the same error, naming the key.
- A line that is not one or two words separated by a single space (`<model>` or `<model> <effort>`), such as `claude-opus-5-5 high extra` or a line with a leading space: the same error, naming the key. marestail splits the printed line on whitespace and needs two or three words in total including the provider id (see below), so a three-word line in the file would crash a marestail run in the middle of a step.
- The live dashboard still shows every usage panel; the two route boxes show the same message in place of a line. `--once` shows it too.

## How marestail reads it

marestail is the main consumer (`marestail/route.py`, checked on 2026-09-28). This task must keep it working without a marestail change:

- marestail runs `dandelion route` or `dandelion route --high` with its working directory set to **the repo being worked on**, not dandelion. It runs `dandelion` from PATH, which is an `npm link` symlink to `~/workspace/dandelion/src/main.ts`, or `$MARESTAIL_DANDELION`, which is usually `~/workspace/dandelion-stable/src/main.ts`. So `routes.json` is found from the real path of `main.ts` after following symlinks. It is never found from the working directory or from the symlink's own folder. A QA case runs `route` through a symlinked bin from an unrelated working directory and gets the lines from the checkout's `routes.json`.
- It takes the last non-empty stdout line, `none` means no quota, and anything else is split on whitespace into `<model> [effort] <provider>`: two or three words, with the second word as the effort. The line-shape rule above keeps every configured line inside that.
- The provider id must be one marestail has a backend for. marestail main knows claude, claude-work, agy, kimi, grok and cursor. The `marestail/green-the-repo` branch adds junie and hermes. This task adds no provider ids.
- A non-zero exit other than `none` is treated like having no quota: marestail waits 10 minutes and retries, up to 12 times, and logs the stderr. So a broken `routes.json` stalls a routed marestail run for up to two hours instead of stopping it; the stderr message is what tells the person why. Making marestail stop at once on exit 2 is a marestail change and is out of scope here.
- `MARESTAIL_DANDELION=~/workspace/dandelion-stable/src/main.ts` runs read dandelion-stable's `routes.json`, so after this merges, moving dandelion-stable forward is what switches marestail to Opus 5.5.

## Living surfaces

- route.ts loses `CLAUDE_LINES`, the line strings in `ROUTING_TABLE` and every `line` in `HIGH_CHAIN`. It gets the lines from the loaded file through a port, the way eligibility reads its state file.
- Unit tests, features, qa procedures, e2e files and perf benches stop asserting real model names. They route with fixture files of made-up lines (for example `model-a high` and `model-b max`) through `DANDELION_ROUTES_FILE`. Every existing scenario keeps its inputs and its outcome, whether that is which provider wins, which rule fired or `none`; only where the line text comes from changes. This part is the reason for the task: after it, a model change touches `routes.json` only.
- Exactly one test reads the shipped `routes.json`. It checks that the file is valid under the rules above, meaning every routed provider and every `high` entry is present. It does not check the model names.
- The README documents the file, its shape, `DANDELION_ROUTES_FILE`, the exit-2 errors, and "to change a routed model, edit routes.json". Its route and `--high` tables name providers and ranks and point at `routes.json` for the lines, rather than repeating them. Its example output can use a real line from the shipped file.
- Historical task files tasks/001–020 keep the strings that were true when they ran.

## Must not break

- Decision logic: evaporation with the sub-97% weekly rule, headroom bindings, the inclusive 90% rolling trip, the `--high` chain order, providers, matcher and trip, eligibility toggles and the state file, ties by dashboard order, `none` with exit 1.
- Output shape: `<line> <provider id>`, `none` alone. marestail parses it (`--model dandelion/route`), so apart from the claude lines, the shipped file prints exactly the strings 020 prints today.
- Every probe, the dashboard layout, and the route boxes apart from the error case.
