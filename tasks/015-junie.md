# 015 — junie credits from its session log, routed as `gemini-3.8-flash high`

After this task the user also sees their **junie** (JetBrains Junie CLI) credit balance in the dashboard, after cursor and before kilo, and `dandelion route` can answer `gemini-3.8-flash high junie`. Junie's `/quota` is an alias of the interactive `/stats` screen and cannot be scripted: `junie --task "/quota"` forwards the text to the model and spends credits. But every task Junie finishes appends a completion record with the account's balance to that session's event log; the probe reads the newest one, the way the grok probe reads grok's billing log.

## Junie probe (verified against the real files, Junie 26.9.14)

Junie home is `DANDELION_JUNIE_HOME`, default `~/.junie`. Read through the injected file-reader seam; never crash on malformed lines, skip them; never write to the junie home.

1. Read `<junie home>/sessions/index.jsonl`, one JSON object per line. Verified line shapes (extra fields must be tolerated):

```json
{"sessionId":"session-260918-134553-1s9i","createdAt":1789735553568,"updatedAt":1789735558242,"projectDir":"/home/max/workspace/dandelion","taskName":"Respond with Pong Only"}
{"sessionId":"session-260918-134317-13tz","createdAt":1789735398143,"updatedAt":1789735405438,"projectDir":"/home/max/workspace","taskName":"Quota Management Task","status":"Sending LLM request"}
```

2. Visit the sessions newest `updatedAt` first. For each, read `<junie home>/sessions/<sessionId>/events.jsonl` and scan **backwards** (newest last) for the most recent line whose `completion.quota.type` ends with `TaskQuotaSnapshot.JetBrains` and whose `completion.quota.balanceLeft` is a finite number of at least 0. Stop at the first session that has one. Verified event shape, one line, shortened here to the fields that matter:

```json
{"kind":"SessionA2uxEvent","event":{"state":"IN_PROGRESS","agentEvent":{"kind":"ResultBlockUpdatedEvent","agent":{"kind":"MainAgent","id":"main","name":"main","type":"LINEAR"},"stepId":"ba8fc998-1b74-4ede-a146-bd311cd11ec0","cancelled":false,"result":"### Summary\n- pong","title":"Optimal Response: pong","changes":[],"errorCode":"Submit"}},"completion":{"endedAtMs":1789735651253,"taskCostUsd":0.0334116,"quota":{"type":"com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.JetBrains","balanceUnit":"CREDITS","balanceLeft":704863.73775}},"timestampMs":1789735651257}
```

   A later task in the same file recorded `"endedAtMs":1789736030118` and `"balanceLeft":701512.73275`. Older Junie versions recorded `"quota":{"type":"com.intellij.ml.llm.matterhorn.ej.app.cli.standalone.tui.app.state.session.TaskQuotaSnapshot.Unknown"}` with no balance; such lines are skipped, and a session with only those yields nothing. Most lines in the file are other event kinds without a `completion` and are skipped too.

3. The snapshot is `balanceLeft` credits at `endedAtMs` (milliseconds since epoch). Surface the age as the panel's `snapshot <age> old` caption, exactly as grok does, dim and prefixed `stale` when older than 48h.

4. `DANDELION_JUNIE_REFERENCE` is the number of credits a full balance holds. Default `1000000`; an empty string means no reference. Any other value that is not a positive number uses the default.
   - With a reference, the probe reports one window: label `credits`, kind `weekly` (a 30-day allowance with no known reset, so it carries no `resetsAt` and never evaporates), `usedPct` = `round(100 - 100 * balanceLeft / reference)` clamped to 0..100. `701512.73275` against the default is `30%`; `1000000` or more is `0%`; `0` is `100%`.
   - Without a reference, the probe reports no windows and the panel's row is the note `balance without a reference`; the panel is then not routable.
   - Plan label = the balance rounded to whole credits plus ` credits`, e.g. `701513 credits`, so the caption reads `701513 credits · junie`.

5. Junie home missing, no index, no session with a JetBrains snapshot → `unavailable` with reason `no junie quota snapshot — run junie once`.

## Render

- Junie panel slot: after cursor, before kilo. Nine probes now run in parallel; the fleet summary counts the `credits` window like any other.
- Window row as usual (`credits`, gauge, percent, no countdown), then the `snapshot <age> old` line, then the caption.
- In the live dashboard, space toggles junie's routing like any routable panel; without a reference it flashes `not routable (no usage windows)`.

## Route

- Add junie to the routing table after cursor with standard line `gemini-3.8-flash high` and max line `gemini-3.8-flash high`, so both rules print `gemini-3.8-flash high junie`. Ties still go to the provider earlier in dashboard order.
- Rule 1 never fires on junie (no `resetsAt`). Rule 2 uses the `credits` window as junie's binding: at `30%` used, junie has 70 left. Junie never trips (its window is not rolling).
- Concrete cases: the 014 live-case fixture plus junie at 30% used still prints `grok-4.6 grok` (91 beats 70); the same fixture with junie at `0%` used prints `gemini-3.8-flash high junie` (100 left); with `DANDELION_JUNIE_REFERENCE=` (empty) junie is not routed and the line is `grok-4.6 grok` again; `{"junie": false}` in the state file skips junie.
- `route --high` is unchanged: junie is not in the chain.

## README

Add the provider bullet, the `DANDELION_JUNIE_HOME` and `DANDELION_JUNIE_REFERENCE` ledger entries, the route table row, and junie in the lists of routed providers and weekly windows (`junie credits`). Say that `--high` does not use junie.

## QA procedure (extend `qa/`)

Fixture junie home: `sessions/index.jsonl` naming two sessions, an older one (smaller `updatedAt`) whose `events.jsonl` has a JetBrains snapshot at `900000` credits, and a newer one whose `events.jsonl` has a few noise lines, an `Unknown` completion, `not json at all`, and the JetBrains line above with `701512.73275`. Run the app with `DANDELION_JUNIE_HOME` at the fixture and assert the junie panel shows `credits` at `30%` (newest session wins), the caption `701513 credits · junie` and the snapshot age. Assert `route` with the QA fixtures of the other providers prints the line this task's rules give for them. A second e2e with an empty fixture home asserts the unavailable card with the `run junie once` reason. A third with `DANDELION_JUNIE_REFERENCE=` asserts the `balance without a reference` note and that `route` skips junie. All previous e2es keep passing; snapshot the fixture tree before and after and assert nothing was written.

## Must not break

- All existing probes, panels and their order; the injection seams; zero runtime dependencies; kilo is still never routed and codex still has no windows.
- 010's rules, the account token on every line and the exit codes; 011's eligibility toggle and state file; 012's `--high` chain and output; 013's route boxes; 014's trip.
