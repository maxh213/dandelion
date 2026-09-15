Feature: 012 - dandelion route --high picks the strongest model that has quota

  Assumptions (the task is silent or self-contradictory here):
  - `--high` applies when the first argument is `route` and any later argument is exactly `--high`; other later arguments stay ignored.
  - A chain entry's windows: a matcher entry takes the windows whose label contains the matcher in any case, plus every rolling window.
    An "(all)" entry takes every window the provider reports, kind "other" included, EXCEPT windows matched by another chain entry of
    the same provider. So claude-opus-5 is not gated on "weekly Fable": the literal rule would make rank 3 unreachable, since any claude
    account under 90 on all windows is also under 90 on session and Fable, and so rank 1 would already have fired.
  - A matcher window the provider does not report counts as usedPct 0. Available = eligible, status "ok", at least one window, and every
    gating window has usedPct < 90 as a raw float (90 trips, 89.9 does not). resetsAt is never read.
  - Two accounts at one rank: the higher left wins, where left = 100 minus the highest usedPct over its gating windows. A tie goes to
    claude, then claude-work.
  - Output is "<line> <provider id>" for both `route` and `route --high`; "none" stays alone. The 010 decision is unchanged.
  - The --high chain, one exported domain constant, separate from the 010 routing table:
    | rank | providers           | matcher | line                        |
    | 1    | claude, claude-work | fable   | claude-fable-5-1 max        |
    | 2    | cursor              | (all)   | kimi-k3-max                 |
    | 3    | claude, claude-work | (all)   | claude-opus-5 max           |
    | 4    | grok                | (all)   | grok-4.6 xhigh              |
    | 5    | agy                 | (all)   | gemini-3.8-flash-high high  |
    kimi, codex and kilo are never in the chain.

  Background:
    Given the fixtures, HOME, TZ and DANDELION_* variables of features/011-route-eligibility-toggle.feature, with every reset 72 h away
    And "claude S/W/F" means the claude transcript "Current session: S% used", "Current week (all models): W% used" and
      "Current week (Fable): F% used", each with a reset; F "-" leaves out the Fable line; "work" is claude-work the same way
    And "cursor C" sets total, auto and api to C%, "cursor T/A/P" sets them apart, "grok G" is credits G%, "agy R/W" is Five Hour
      Limit R% and Weekly Limit W%, "kimi H/W" is 5h H% and weekly W%, and every provider not listed is unavailable

  Scenario Outline: route --high walks the chain
    Given the usages <usages> and the state file <state>
    When the user runs `node src/main.ts route --high`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is <code>

    Examples:
      | case                                          | usages                                         | state                  | line                             | code |
      | personal Fable tripped, all-models not        | claude 3/86/100, work 0/12/23                  | missing                | claude-fable-5-1 max claude-work | 0    |
      | higher left on gating windows wins            | claude 85/10/40, work 10/10/70                 | missing                | claude-fable-5-1 max claude-work | 0    |
      | pops back to personal                         | claude 85/10/40, work 10/10/95                 | missing                | claude-fable-5-1 max claude      | 0    |
      | equal left goes to personal                   | claude 20/10/20, work 20/60/0                  | missing                | claude-fable-5-1 max claude      | 0    |
      | no Fable line counts as 0                     | claude 10/50/-                                 | missing                | claude-fable-5-1 max claude      | 0    |
      | all-models does not gate fable                | claude 10/95/10, cursor 10                     | missing                | claude-fable-5-1 max claude      | 0    |
      | session gates fable                           | claude 90/10/10, cursor 10                     | missing                | kimi-k3-max cursor               | 0    |
      | both Fable windows tripped                    | claude 10/10/90, work 10/10/95, cursor 50      | missing                | kimi-k3-max cursor               | 0    |
      | one cursor window trips cursor                | claude 10/40/95, work 10/95/95, cursor 10/90/10 | missing               | claude-opus-5 max claude         | 0    |
      | opus: higher left wins                        | claude 10/70/95, work 10/40/90, cursor 90      | missing                | claude-opus-5 max claude-work    | 0    |
      | claude and cursor tripped, grok 60            | claude 95/10/10, cursor 95, grok 60            | missing                | grok-4.6 xhigh grok              | 0    |
      | grok tripped, agy left                        | grok 90, agy 10/20                             | missing                | gemini-3.8-flash-high high agy   | 0    |
      | quality before headroom                       | claude 10/50/-, agy 0/0                        | missing                | claude-fable-5-1 max claude      | 0    |
      | ineligible work skipped                       | claude 10/10/95, work 10/10/10, cursor 50      | {"claude-work": false} | kimi-k3-max cursor               | 0    |
      | kimi is never in the chain                    | kimi 0/0                                       | missing                | none                             | 1    |
      | everything tripped or unavailable             | claude 90/90/90, cursor 99, grok 90, agy 10/90, kimi 0/0 | missing      | none                             | 1    |

  Scenario Outline: Arguments
    Given the usages claude 10/50/-, agy 0/0
    When the user runs `NO_COLOR=1 node src/main.ts <args>` with stdout not a terminal
    Then <result>

    Examples:
      | args               | result                                                                      |
      | route --high       | stdout is exactly "claude-fable-5-1 max claude" and a newline, exit 0       |
      | route extra --high | stdout is exactly "claude-fable-5-1 max claude" and a newline, exit 0       |
      | route              | stdout is exactly "gemini-3.1-pro-high medium agy" and a newline, exit 0    |
      | route --High       | stdout is exactly "gemini-3.1-pro-high medium agy" and a newline, exit 0    |
      | --once route --high | the output is the 009 dashboard, its first line starts "DANDELION", exit 0 |

  Scenario: route --high on a terminal still prints one line
    Given the usages claude 10/50/-
    When the user runs `dandelion route --high` on a terminal through the 010 symlink
    Then the terminal shows only "claude-fable-5-1 max claude", with no escape sequence and no alternate screen, and the exit code is 0

  Scenario Outline: Plain route prints the account token
    When the user runs `node src/main.ts route` with the 010 usages <usages>
    Then stdout is exactly "<line>" and a newline, stderr is empty and the exit code is 0

    Examples:
      | usages                                             | line                                     |
      | claude 0/86@2, agy 0/0@72                          | claude-opus-5 max claude                 |
      | claude 20/30@72, claude-work 10/5@72, agy 15/20@72 | claude-opus-5 high claude-work           |
      | agy 0/90@2, kimi 0/90@2                            | gemini-3.1-pro-high high agy             |
      | kimi 10/10@72, grok 50@72                          | kimi-code/kimi-for-coding-highspeed kimi |
      | kimi 90/10@72, grok 50@72                          | grok-4.6 grok                            |
      | claude 0/86@2, cursor 60@2                         | kimi-k3-max cursor                       |
    And every other 010 and 011 route row prints its old line plus " " and the chosen provider id, and "none" rows still print "none"

  Scenario: The decisions, unit level
    Given the unit tests of "src/domain/index.test.ts", where a window is "label kind usedPct"
    Then the chain constant is pinned entry by entry: rank, providers, matcher and line exactly as in the table above
    And the --high walker returns, among others:
      | candidates                                                                                              | ineligible  | line                             |
      | claude: session rolling 10, weekly Fable weekly 89.9                                                    |             | claude-fable-5-1 max claude      |
      | claude: session rolling 10, weekly FABLE weekly 90; cursor: total weekly 10                             |             | kimi-k3-max cursor               |
      | claude: session rolling 10, weekly weekly 50, weekly Fable weekly 100                                   |             | claude-opus-5 max claude         |
      | agy: Gemini Models · Daily Limit other 90, Gemini Models · Weekly Limit weekly 10                       |             | none                             |
      | cursor: ok with no windows; grok: credits weekly 50                                                     |             | grok-4.6 xhigh grok              |
      | claude: error; claude-work: unavailable; grok: credits weekly 89                                        |             | grok-4.6 xhigh grok              |
      | claude-work: session rolling 0, weekly Fable weekly 0; cursor: total weekly 0                           | claude-work | kimi-k3-max cursor               |
      | kimi: 5h rolling 0; codex: weekly weekly 0; kilo: no windows                                            |             | none                             |
      | grok: credits weekly 50 resetting 1 h from now; cursor: total weekly 60                                 |             | kimi-k3-max cursor               |
    And every 010 and 011 unit row of the plain decision returns its old line plus " " and the chosen provider id
    And a test in "src/main.test.ts" pins that `route --high` uses the chain and `route` the 010 decision

  Scenario: Nothing else changes
    Then `--once` and live mode are byte-for-byte those of 011 apart from the clock, the 010 routing table and decision rules are unchanged,
      the eligibility toggle behaves as in 011, and the claude probe still reads session, "weekly" and "weekly <model>" windows as in 002

  Scenario: README documents route --high and the token
    When I read "README.md"
    Then Run Commands list `dandelion route --high` (and `npm start -- route --high`)
    And the Route section gives the chain in order, each entry's gating windows (fable: the Fable weekly plus session; (all): every
      window except another entry's), the 90% trip, that ineligible, unavailable and failed providers are skipped, and "none" with exit 1
    And it says both route forms print "<line> <provider id>", and that claude-work means launching claude with CLAUDE_CONFIG_DIR set to
      DANDELION_CLAUDE_WORK_CONFIG_DIR, default ~/.claude-work

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, the 001 to 009 e2es are unchanged, and the 010 and 011 e2es change only by the added provider token
    And "qa/012-route-high.e2e.mjs" uses temp dirs prefixed "dandelion-qa-012-", sets DANDELION_STATE_FILE in every child env, and covers
      every row of "route --high walks the chain", "Arguments" and "Plain route prints the account token", asserting stdout, stderr and
      exit code exactly (the dashboard row by its first line and exit code)
    And no e2e runs a real provider binary or reaches a real API, and every temp dir is removed
