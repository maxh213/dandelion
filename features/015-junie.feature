Feature: 015 - Junie credits from its session log, routed as gemini-3.8-flash high

  Assumptions (the task is silent here):
  - Env names follow the repo's rename: DANDELION_JUNIE_HOME (default "~/.junie" when unset or empty) and DANDELION_JUNIE_REFERENCE.
  - The task's "grok-4.7 grok" predates commit a81d626; grok's route line is "grok-4.7 xhigh" today, so the grok cases print
    "grok-4.7 xhigh grok".
  - Index lines without a string "sessionId" or a finite number "updatedAt" are skipped. A snapshot line also needs "endedAtMs" to be a
    finite number; otherwise it is skipped like any other unusable line. Within one events file the line nearest the end wins.
  - usedPct is rounded half-up, then clamped to 0..100. The unavailable plan label is "junie", so the caption is "junie · junie".
  - Without a reference the panel is ok: the note row, then the snapshot line, then the caption.
  - "junie U%" below means a junie home whose only session's events hold one JetBrains snapshot with balanceLeft 1000000 - 10000 * U
    (30% uses 701512.73275) and endedAtMs 1 hour before now, with DANDELION_JUNIE_REFERENCE unset.

  Background:
    Given the current time is "2026-09-18T19:00:00Z"
    And every other provider is set up as in features/014-route-session-trip.feature, unavailable unless listed
    And DANDELION_JUNIE_HOME is a directory J whose "sessions/index.jsonl" holds:
      """
      {"sessionId":"session-old","createdAt":1789735398143,"updatedAt":1789735405438,"projectDir":"/w","taskName":"Old","status":"Sending LLM request"}
      not json at all
      {"sessionId":"session-new","createdAt":1789735553568,"updatedAt":1789735558242,"projectDir":"/w/d","taskName":"Respond with Pong Only"}
      """
    And "sessions/session-old/events.jsonl" holds one JetBrains snapshot line with "endedAtMs":1789730000000 and "balanceLeft":900000
    And "sessions/session-new/events.jsonl" holds, in order: two lines of other event kinds without "completion", the task's JetBrains
      line with "endedAtMs":1789735651253 and "balanceLeft":704863.73775, a line whose quota type ends "TaskQuotaSnapshot.Unknown" with no
      balance, "not json at all", and a JetBrains line with "endedAtMs":1789736030118 and "balanceLeft":701512.73275

  Scenario: Junie panel shows the newest session's newest snapshot between cursor and kilo
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the process exits with code 0
    And the panels appear in the order "claude", "claude-work", "agy", "kimi", "grok", "codex", "cursor", "junie", "kilo"
    And the junie panel is exactly: rule, "junie", then
      """
      credits                             ######--------------  30%
      snapshot 6h6m old
      701513 credits · junie
      """
    And the other panels are unchanged, and every line is at most 72 columns wide

  Scenario Outline: Reference, balance and staleness
    Given <change>
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the junie panel's lines under the name are exactly "<lines>"

    Examples:
      | change                                                              | lines                                                                                             |
      | DANDELION_JUNIE_REFERENCE is "2000000"                              | credits                             #############-------  65% / snapshot 6h6m old / 701513 credits · junie |
      | DANDELION_JUNIE_REFERENCE is "500000"                               | credits                             --------------------   0% / snapshot 6h6m old / 701513 credits · junie |
      | DANDELION_JUNIE_REFERENCE is "abc", "0" or "-5"                     | credits                             ######--------------  30% / snapshot 6h6m old / 701513 credits · junie |
      | DANDELION_JUNIE_REFERENCE is ""                                     | balance without a reference / snapshot 6h6m old / 701513 credits · junie                           |
      | the newest JetBrains line has "balanceLeft":1000000.4               | credits                             --------------------   0% / snapshot 6h6m old / 1000000 credits · junie |
      | the newest JetBrains line has "balanceLeft":0                       | credits                             #################### 100% / snapshot 6h6m old / 0 credits · junie |
      | session-new holds only the Unknown line and noise                   | credits                             ##------------------  10% / snapshot 7h46m old / 900000 credits · junie |
      | the newest JetBrains line has "balanceLeft":-1 or "701512"          | credits                             ######--------------  30% / snapshot 6h12m old / 704864 credits · junie |
      | the current time is "2026-09-20T12:53:51Z"                           | credits                             ######--------------  30% / stale snapshot 2d0h old / 701513 credits · junie |

  Scenario: Colours
    When the user runs `npm start -- --once` without NO_COLOR
    Then the junie gauge and "30%" carry the calm escape, and the snapshot line and caption are dim
    And with the current time "2026-09-20T12:53:51Z" every junie line is dim and the gauge carries no ramp escape

  Scenario Outline: No usable junie snapshot renders a dim unavailable panel
    Given <condition>
    When the user runs `npm start -- --once`
    Then the process exits with code 0 within 5 seconds and prints no stack trace
    And the junie panel is dim, shows no gauge and no snapshot line, and reads "junie", "no junie quota snapshot — run junie once", "junie · junie"
    And the other panels render normally in order around it

    Examples:
      | condition                                                              |
      | DANDELION_JUNIE_HOME names a path that does not exist                  |
      | DANDELION_JUNIE_HOME is an empty directory                             |
      | "sessions/index.jsonl" is empty, or holds only "not json at all"       |
      | the index names sessions whose events files are missing                |
      | every events file holds only Unknown lines, noise and bad lines        |
      | "sessions/index.jsonl" is a directory, or not readable (mode 000)      |

  Scenario: Junie home defaults to ~/.junie
    Given DANDELION_JUNIE_HOME is unset, or set to "", and HOME holds the Background tree at ".junie"
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the junie panel shows "credits" at 30% and the caption "701513 credits · junie"

  Scenario: The app never writes to junie home
    When the user runs `npm start -- --once` against the Background home and against an empty home
    Then after each run junie home holds exactly the same paths, sizes, contents and modification times as before

  Scenario: Live dashboard toggles junie like any routable panel
    Given DANDELION_STATE_FILE names a missing file in a temp dir
    When the user runs `npm start` in a terminal, selects the junie panel and presses space
    Then the junie panel shows "routing off" and the state file holds {"junie": false}
    When DANDELION_JUNIE_REFERENCE is "" and the user selects junie and presses space
    Then the junie caption line reads "not routable (no usage windows)" for 2 seconds and the state file is not written

  Scenario: Fleet summary counts junie's credits window and never takes a reset from it
    Given junie home is the Background tree with the newest snapshot at balanceLeft 150000, and no other provider is available
    When the user runs `npm start` in a terminal with NO_COLOR set
    Then the junie panel shows "credits" at 85%
    And the fleet summary line reads exactly "1/1 windows above 80% · next reset: none"
    When DANDELION_JUNIE_REFERENCE is "" and the user runs `npm start` again
    Then the fleet summary line reads exactly "all windows below 80% · next reset: none"

  Scenario Outline: route with junie
    Given the usages <usages>, junie <junie> and the state file <state>
    When the user runs `node src/main.ts route`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is <code>

    Examples:
      | usages               | junie                  | state            | line                          | code |
      | none                 | 30%                    | missing          | gemini-3.8-flash high junie   | 0    |
      | none                 | 100%                   | missing          | gemini-3.8-flash high junie   | 0    |
      | grok 50@72           | 30%                    | missing          | gemini-3.8-flash high junie   | 0    |
      | grok 0@72            | 0%                     | missing          | grok-4.7 xhigh grok           | 0    |
      | cursor 0@72          | 0%                     | missing          | kimi-k3-max cursor            | 0    |
      | claude 0/86@2        | 0%                     | missing          | claude-opus-5 max claude      | 0    |
      | grok 50@72           | with reference ""      | missing          | grok-4.7 xhigh grok           | 0    |
      | none                 | with reference ""      | missing          | none                          | 1    |
      | none                 | 0%                     | {"junie": false} | none                          | 1    |
      | none                 | unavailable            | missing          | none                          | 1    |

  Scenario: The 014 live case with junie
    Given the usages of "The live case that prompted the task" in features/014-route-session-trip.feature
    When junie is 30% and the user runs `node src/main.ts route`
    Then stdout is exactly "grok-4.7 xhigh grok" and a newline, exit 0 (grok 91 left beats junie 70)
    When junie is 0% instead
    Then stdout is exactly "gemini-3.8-flash high junie" and a newline, exit 0
    When junie is 0% and DANDELION_JUNIE_REFERENCE is ""
    Then stdout is exactly "grok-4.7 xhigh grok" and a newline, exit 0
    When junie is 0% and the state file holds {"junie": false}
    Then stdout is exactly "grok-4.7 xhigh grok" and a newline, exit 0
    When junie is 0% and the user runs `node src/main.ts route --high`
    Then stdout is exactly "claude-fable-5-1 max claude" and a newline, exit 0

  Scenario: route --high never uses junie
    Given only junie is available, at 0%
    When the user runs `node src/main.ts route --high`
    Then stdout is exactly "none" and a newline, stderr is empty and the exit code is 1

  Scenario: Nothing else changes
    Then every row of the 010 to 014 features prints the line and exit code it did before, `route --high` is unchanged,
      kilo is never routed and codex still has no windows, and package.json still has no "dependencies" section
    And the dashboard's route boxes show the same lines `route` and `route --high` print, junie included

  Scenario: README documents junie
    When I read "README.md"
    Then the intro and the provider list name `junie` between `cursor` and `kilo`, saying it reads the newest completion snapshot from
      `<junie home>/sessions/<id>/events.jsonl` without running junie, shows credits used against a reference and the snapshot's age,
      dims a snapshot older than 48h as stale, and says to run junie once without one
    And it says "All nine probes run in parallel"
    And the ledger lists `DANDELION_JUNIE_HOME` (default `~/.junie`, never written) and `DANDELION_JUNIE_REFERENCE` (default `1000000`,
      empty means no reference, any other non-positive-number uses the default)
    And the Route section lists junie among routed providers and `junie credits` among weekly windows, the table has the row
      "| junie | `gemini-3.8-flash high` | `gemini-3.8-flash high` |" after cursor, and it says `--high` does not use junie

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, the 001 to 014 e2es included, whether or not the tester has a real ~/.junie
    And no e2e runs a real junie binary, and every temp dir is removed
