Feature: 002 - Claude and agy windows join the dashboard

  Row layout (every window row, one line, no trailing spaces):
    label padded to 35 cells; a label longer than 35 cells becomes its first 34 cells,
    trailing spaces removed, then "…", padded to 35 | 1 space | 20-cell gauge |
    1 space | percent right-aligned in 4 cells | when resetsAt is known: 1 space, "↻ ", countdown.
    Filled cells = round-half-up(usedPct / 5). Longest row (countdown "9999d23h") is 72 cells.

  Background:
    Given the current time is "2026-09-13T10:00:00Z"
    And a `kilo` CLI in the PATH whose `kilo profile` output contains "Balance: $14.15"
    And a `claude` CLI in the PATH whose `claude -p "/usage"` stdout is:
      """
      Current session: 3% used · resets Sep 13, 7:40pm (Europe/London)
      Current week (all models): 86% used · resets Sep 13, 11pm (Europe/London)
      Current week (Fable): 100% used · resets Sep 13, 11pm (Europe/London)

      What's contributing to your usage
      Current nonsense: 42% used
      """
    And an `agy` CLI in the PATH whose `agy -p "/usage"` stdout is the tab-separated rows:
      """
      Gemini Models	Weekly Limit Remaining	100%	2026-09-20T17:13:45Z
      Gemini Models	Five Hour Limit Remaining	100%	2026-09-13T22:13:45Z
      Claude and GPT models	Weekly Limit Remaining	100%	2026-09-20T17:13:45Z
      Claude and GPT models	Five Hour Limit Remaining	25%	2026-09-13T22:13:45Z
      """

  Scenario: Three providers render in fixed order
    When the user runs `npm start`
    Then the process exits with code 0
    And the output is the banner, then the panels "claude", "agy", "kilo" in that order
    And each ok panel is: rule, provider name, its rows, dim caption
    And the claude panel caption is "claude code · claude"
    And the agy panel caption is "agy · agy"
    And the kilo panel still shows "$14.15" with 14 filled and 6 empty gauge cells and caption "api balance · kilo"
    And every line is at most 72 columns wide

  Scenario: Claude windows parse from /usage
    When the user runs `npm start`
    Then the claude panel shows these rows in this order:
      | label        | filled cells | percent | countdown |
      | session      | 1            | 3%      | ↻ 8h40m   |
      | weekly       | 17           | 86%     | ↻ 12h0m   |
      | weekly Fable | 20           | 100%    | ↻ 12h0m   |
    And no row is shown for "Current nonsense"
    And with NO_COLOR set the weekly row is exactly:
      """
      weekly                              #################---  86% ↻ 12h0m
      """

  Scenario: Agy remaining percent renders as used percent
    When the user runs `npm start`
    Then the agy panel shows these rows in this order:
      | label                                   | filled cells | percent | countdown |
      | Gemini Models · Weekly Limit            | 0            | 0%      | ↻ 7d7h    |
      | Gemini Models · Five Hour Limit         | 0            | 0%      | ↻ 12h13m  |
      | Claude and GPT models · Weekly Limit    | 0            | 0%      | ↻ 7d7h    |
      | Claude and GPT models · Five Hour Limit | 15           | 75%     | ↻ 12h13m  |
    And with NO_COLOR set the last two agy rows are exactly:
      """
      Claude and GPT models · Weekly Lim… --------------------   0% ↻ 7d7h
      Claude and GPT models · Five Hour…  ###############-----  75% ↻ 12h13m
      """

  Scenario: Window rows under NO_COLOR stay ASCII except the separator glyphs
    Given the environment variable NO_COLOR is set
    When the user runs `npm start`
    Then the output contains no escape character "\x1b"
    And every gauge uses `#` for filled and `-` for empty cells
    And "Gemini Models · Weekly Limit        --------------------   0% ↻ 7d7h" is a line of the output
    And the glyphs "↻", "·" and "…" are printed unchanged and are the only non-ASCII characters in the output

  Scenario: Utilization style colours the gauge and percent of each row
    Given NO_COLOR is not set
    When the user runs `npm start`
    Then in every window row the 20 gauge cells and the percent are wrapped in the escape of the row's style token
    And the label and the countdown carry no escape
    And the escape before the "session" gauge (3%, calm) differs from the one before the "weekly" gauge (86%, hot)
    And the escape before the "weekly Fable" gauge (100%, critical) differs from both
    And the tokens calm, warm, hot and critical map to four distinct escapes

  Scenario Outline: Utilization style ramp thresholds
    Given a window with usedPct <pct>
    When the renderer renders its row with colour on
    Then the row's gauge carries the "<token>" escape

    Examples:
      | pct | token    |
      | 0   | calm     |
      | 49  | calm     |
      | 50  | warm     |
      | 79  | warm     |
      | 80  | hot      |
      | 94  | hot      |
      | 95  | critical |
      | 100 | critical |

  Scenario Outline: Claude reset time resolves zone and year
    Given a claude line "Current week (all models): 50% used · resets <reset>"
    When the claude probe parses it at now "2026-09-13T10:00:00Z"
    Then the weekly window resetsAt is "<instant>"

    Examples:
      | reset                            | instant              |
      | Sep 13, 11pm (Europe/London)     | 2026-09-13T22:00:00Z |
      | Sep 13, 7:40pm (Europe/London)   | 2026-09-13T18:40:00Z |
      | Sep 14, 9am                      | 2026-09-14T09:00:00Z |
      | Sep 12, 12am                     | 2026-09-12T00:00:00Z |
      | Sep 13, 12pm                     | 2026-09-13T12:00:00Z |
      | Sep 10, 9am                      | 2027-09-10T09:00:00Z |
      | Jan 2, 1:05am (America/New_York) | 2027-01-02T06:05:00Z |

  Scenario: Claude window without a reset renders no countdown
    Given the `claude` CLI prints:
      """
      Current week (all models): 50% used
      Current week (Fable): 60% used · resets someday
      """
    When the user runs `npm start` with NO_COLOR set
    Then the claude panel has exactly the rows "weekly" and "weekly Fable" and no "session" row
    And the weekly window has no resetsAt and its row is exactly:
      """
      weekly                              ##########----------  50%
      """
    And the "weekly Fable" row ends in " 60%" with no "↻"

  Scenario Outline: Claude probe failures render a dim unavailable panel
    Given the `claude` CLI <condition>
    When the user runs `npm start`
    Then the process exits with code 0 within <seconds> seconds
    And the claude panel is dim, shows no gauge, and shows the reason "<reason>" and caption "claude code · claude"
    And the agy and kilo panels still render normally below it

    Examples:
      | condition                                                   | reason                            | seconds |
      | is not in the PATH                                          | claude CLI not found in PATH      | 10      |
      | hangs indefinitely                                          | Command timed out after 90s       | 95      |
      | exits with code 1                                           | Command failed or timed out       | 10      |
      | prints "Current session: 3% used" and no week line          | Could not parse usage from output | 10      |
      | prints only "Current week (Fable): 100% used" (no all models) | Could not parse usage from output | 10      |

  Scenario Outline: Agy probe failures render a dim unavailable panel
    Given the `agy` CLI <condition>
    When the user runs `npm start`
    Then the process exits with code 0 within <seconds> seconds
    And the agy panel is dim, shows no gauge, and shows the reason "<reason>" and caption "agy · agy"
    And the claude and kilo panels still render normally

    Examples:
      | condition          | reason                            | seconds |
      | is not in the PATH | agy CLI not found in PATH         | 10      |
      | hangs indefinitely | Command timed out after 60s       | 65      |
      | exits with code 1  | Command failed or timed out       | 10      |
      | prints nothing     | Could not parse usage from output | 10      |
      | prints "hello world" | Could not parse usage from output | 10    |

  Scenario Outline: Agy skips malformed rows and keeps valid ones
    Given the `agy` CLI prints "Gemini Models<TAB>Weekly Limit Remaining<TAB>40%<TAB>2026-09-20T17:13:45Z" then the row "<bad>"
    When the user runs `npm start`
    Then the agy panel is ok and shows the row "Gemini Models · Weekly Limit" at 60% with "↻ 7d7h"
    And <outcome>

    Examples:
      | bad                                                          | outcome                                                               |
      | Gemini Models<TAB>Five Hour Limit Remaining<TAB>100%          | no second row is shown                                                |
      | Gemini Models<TAB>Five Hour Limit Remaining<TAB>lots<TAB>2026-09-13T22:13:45Z | no second row is shown                                   |
      | Gemini Models<TAB>Five Hour Limit Remaining<TAB>100%<TAB>not-a-date | a second row "Gemini Models · Five Hour Limit" at 0% with no "↻" is shown |

  Scenario: Probes run in parallel
    Given the `claude`, `agy` and `kilo` CLIs all hang indefinitely
    When the user runs `npm start`
    Then the process exits with code 0 within 95 seconds
    And three dim unavailable panels render in order "claude", "agy", "kilo" with reasons "Command timed out after 90s", "Command timed out after 60s", "Command timed out after 20s"

  Scenario: No CLI on the PATH at all
    Given the PATH contains no `claude`, `agy`, or `kilo`
    When the user runs `npm start`
    Then the process exits with code 0
    And three dim unavailable panels render in order:
      | name   | reason                       | caption              |
      | claude | claude CLI not found in PATH | claude code · claude |
      | agy    | agy CLI not found in PATH    | agy · agy            |
      | kilo   | kilo CLI not found in PATH   | api balance · kilo   |

  Scenario: Task 001 end-to-end checks keep passing
    When the user runs `node qa/e2e.mjs`
    Then "qa/001-scaffold-kilo.e2e.mjs", "qa/002-readme.e2e.mjs" and "qa/002-claude-agy.e2e.mjs" pass
    And no e2e invokes a real `claude` or `agy` binary
