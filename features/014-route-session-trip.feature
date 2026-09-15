Feature: 014 - dandelion route never picks an account whose rolling window is used up

  Assumptions (the task is silent here):
  - Tripped = eligible and routable (011, 010) with at least one rolling window (010 kinds: claude and claude-work "session", kimi "5h",
    agy labels ending "Five Hour Limit") whose usedPct >= 90 as a raw float. Weekly and other windows never trip. resetsAt is not read.
  - `route` drops ineligible, then non-routable, then tripped accounts, and applies 010's two rules unchanged to the rest. A tripped
    account's windows neither evaporate nor bind.
  - The 90 is the one trip constant in "src/domain/route.ts" that `route --high` already uses; no second 90 is added.
  - Every 010, 011 and 012 row keeps its line: none of them has an untripped winner displaced by the trip.

  Background:
    Given the fixtures, HOME, TZ, DANDELION_* variables and "S/W@R" usages of features/011-route-eligibility-toggle.feature, where S is
      the rolling window (claude session, kimi 5h, agy Five Hour Limit), W the weekly and R its reset in hours, with no state file
    And every provider not listed is unavailable

  Scenario Outline: route skips tripped accounts in both rules
    Given the usages <usages> and the state file <state>
    When the user runs `node src/main.ts route`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is <code>

    Examples:
      | case                                          | usages                                               | state                  | line                            | code |
      | tripped evaporator loses to untripped one     | claude 10/80@2, claude-work 95/52@2                  | missing                | claude-opus-5 max claude        | 0    |
      | work session 89: under the trip               | claude 2/13@130, claude-work 89/72@5.35, grok 9@130  | missing                | claude-opus-5 max claude-work   | 0    |
      | work session 90: the trip is inclusive        | claude 2/13@130, claude-work 90/72@5.35, grok 9@130  | missing                | grok-4.6 grok                   | 0    |
      | tripped agy never evaporates                  | agy 95/50@2, claude 0/20@72                          | missing                | claude-opus-5 high claude       | 0    |
      | kimi 5h at 95 loses rule 2 to a lower binding | kimi 95/0@72, grok 97@72                             | missing                | grok-4.6 grok                   | 0    |
      | agy Five Hour at 90 loses rule 2              | agy 90/0@72, claude 10/92@72                         | missing                | claude-opus-5 high claude       | 0    |
      | claude session at 90 loses rule 2             | claude 90/0@72, grok 95@72                           | missing                | grok-4.6 grok                   | 0    |
      | a weekly at 95 does not trip (rule 1)         | kimi 0/95@2, agy 0/0@72                              | missing                | kimi-code/kimi-for-coding-highspeed kimi | 0 |
      | a weekly at 92 does not trip (rule 2)         | grok 92@72                                           | missing                | grok-4.6 grok                   | 0    |
      | every routable account tripped                | claude 90/0@72, agy 99/0@72, kimi 100/0@72           | missing                | none                            | 1    |
      | ineligible work and tripped claude            | claude 95/80@2, claude-work 0/80@2, agy 10/10@72     | {"claude-work": false} | gemini-3.1-pro-high medium agy  | 0    |
      | only ineligible or tripped claude accounts    | claude 95/80@2, claude-work 0/80@2                   | {"claude-work": false} | none                            | 1    |

  Scenario: The live case that prompted the task
    Given the usages at local time near 11:00 (Background TZ):
      | account     | windows                                                                                  |
      | claude      | session 2% resets in 4h, weekly 13% in 130h, weekly Fable 2% in 130h                     |
      | claude-work | session 100% resets in 3h11m, weekly 72% in 5h21m, weekly Fable 52% in 5h20m             |
      | agy         | Weekly Limit 17% in 126h, Five Hour Limit 0% in 5h                                       |
      | kimi        | weekly 95% in 73h, 5h 0% in 5h                                                           |
      | grok        | credits 9% in 130h                                                                       |
      | cursor      | total 36%, auto 36%, api 33%, all in 365h                                                |
    When the user runs `node src/main.ts route`
    Then stdout is exactly "grok-4.6 grok" and a newline, stderr is empty and the exit code is 0
    When claude-work's session is 89% instead
    Then stdout is exactly "claude-opus-5 max claude-work" and a newline, exit 0
    When claude-work's session is 90% instead
    Then stdout is exactly "grok-4.6 grok" and a newline, exit 0
    When the user runs `node src/main.ts route --high` with the original usages
    Then stdout is exactly "claude-fable-5-1 max claude" and a newline, exit 0, as 012 gives

  Scenario: The route decision with the trip, unit level
    Given the unit tests of the plain route decision in "src/domain/index.test.ts", with now 2026-09-14T12:39:00.000Z, the next local
      midnight 2026-09-15T00:00:00.000Z, and the "k U @T" windows of 010
    When the decision gets claude: rolling 2 @-, weekly 13 @2026-09-19T22:39:00.000Z, weekly 2 @2026-09-19T22:39:00.000Z;
      claude-work: rolling <session> @2026-09-14T15:50:00.000Z, weekly 72 @2026-09-14T18:00:00.000Z, weekly 52 @2026-09-14T17:59:00.000Z;
      agy: weekly 17 @2026-09-19T18:39:00.000Z, rolling 0 @-; kimi: weekly 95 @2026-09-17T13:39:00.000Z, rolling 0 @-;
      grok: weekly 9 @2026-09-19T22:39:00.000Z; cursor: weekly 36 @2026-09-29T17:39:00.000Z, weekly 36 @2026-09-29T17:39:00.000Z,
      weekly 33 @2026-09-29T17:39:00.000Z
    Then it returns "<line>" for each <session>:
      | session | line                          |
      | 100     | grok-4.6 grok                 |
      | 90      | grok-4.6 grok                 |
      | 89.9    | claude-opus-5 max claude-work |
      | 89      | claude-opus-5 max claude-work |
    And unit rows pin, among others:
      | candidates                                                                                         | ineligible  | line                              |
      | claude: rolling 90 @-; grok: weekly 95 @2026-09-20T00:00:00.000Z                                   |             | grok-4.6 grok                     |
      | claude: rolling 89.9 @-; agy: rolling 89.95 @-                                                     |             | claude-opus-5 high claude         |
      | claude: rolling 89.9 @-, weekly 95 @2026-09-14T20:00:00.000Z; agy: rolling 0 @-                    |             | claude-opus-5 max claude          |
      | claude: rolling 90 @-, weekly 95 @2026-09-14T20:00:00.000Z; agy: rolling 80 @-                     |             | gemini-3.1-pro-high medium agy    |
      | agy: other 99 @-, weekly 50 @2026-09-20T00:00:00.000Z                                              |             | gemini-3.1-pro-high medium agy    |
      | claude: rolling 95 @-; claude-work: rolling 0 @-                                                   | claude-work | none                              |
      | kimi: rolling 90 @-; codex: weekly 0 @-; kilo: no windows                                          |             | none                              |
    And every 010, 011 and 012 unit row returns the line it did before, and the 012 --high rows are unchanged
    And "src/domain/route.ts" holds the number 90 exactly once, as the trip constant both decisions read

  Scenario: Nothing else changes
    Then every row of the 010, 011 and 012 features prints the line and exit code it did before, `route --high` is unchanged
    And `--once` and live mode are byte-for-byte those of 012 apart from the clock, and the eligibility toggle behaves as in 011

  Scenario: README documents the trip
    When I read "README.md"
    Then the Route section says, for both rules, that an account with a rolling window (claude session, kimi 5h, agy Five Hour Limit)
      at 90% used or more is tripped and skipped, that 90% itself trips, that weekly windows never trip, that it is the same 90% trip
      `route --high` uses, and that "none" with exit 1 follows when every account is ineligible, unavailable or tripped

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, and the 001 to 012 e2es are unchanged
    And "qa/014-route-session-trip.e2e.mjs" uses temp dirs prefixed "dandelion-qa-014-", sets DANDELION_STATE_FILE in every child env,
      and covers every row of "route skips tripped accounts in both rules" and every run of "The live case that prompted the task",
      asserting stdout, stderr and exit code exactly
    And no e2e runs a real provider binary or reaches a real API, and every temp dir is removed
