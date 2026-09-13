Feature: 002 - Claude and agy windows join the dashboard

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
    And the output shows the banner, then the panels "claude", "agy", "kilo" in that order
    And the claude panel caption is "claude code · claude"
    And the agy panel caption is "agy · agy"
    And the kilo panel still shows "$14.15" with 14 filled and 6 empty gauge cells and caption "api balance · kilo"
    And every line is at most 72 columns wide

  Scenario: Claude windows parse from /usage
    When the user runs `npm start`
    Then the claude panel shows these rows in this order:
      | label          | filled cells | percent | countdown |
      | session        | 1            | 3%      | ↻ 8h40m   |
      | weekly         | 17           | 86%     | ↻ 12h0m   |
      | weekly Fable   | 20           | 100%    | ↻ 12h0m   |
    And no row is shown for "Current nonsense"

  Scenario: Agy remaining percent renders as used percent
    When the user runs `npm start`
    Then the agy panel shows these rows in this order:
      | label                                | filled cells | percent | countdown |
      | Gemini Models · Weekly Limit         | 0            | 0%      | ↻ 7d7h    |
      | Gemini Models · Five Hour Limit      | 0            | 0%      | ↻ 12h13m  |
      | Claude and GPT models · Weekly Limit | 0            | 0%      | ↻ 7d7h    |
      | Claude and GPT models · Five Hour Limit | 15        | 75%     | ↻ 12h13m  |

  Scenario Outline: Claude reset time resolves zone and year
    Given a claude line "Current week (all models): 50% used · resets <reset>"
    When the claude probe parses it at now "2026-09-13T10:00:00Z"
    Then the weekly window resetsAt is "<instant>"

    Examples:
      | reset                          | instant              |
      | Sep 13, 11pm (Europe/London)   | 2026-09-13T22:00:00Z |
      | Sep 13, 7:40pm (Europe/London) | 2026-09-13T18:40:00Z |
      | Sep 14, 9am                    | 2026-09-14T09:00:00Z |
      | Sep 12, 12am                   | 2026-09-12T00:00:00Z |
      | Sep 10, 9am                    | 2027-09-10T09:00:00Z |
      | Jan 2, 1:05am (America/New_York) | 2027-01-02T06:05:00Z |

  Scenario Outline: Utilization style ramp
    Given a window with usedPct <pct>
    When the renderer styles its row
    Then the style token is "<token>"

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

  Scenario Outline: Claude probe failures render a dim unavailable panel
    Given the `claude` CLI <condition>
    When the user runs `npm start`
    Then the process exits with code 0
    And the claude panel is dim, shows no gauge, and shows the reason "<reason>"
    And the agy and kilo panels still render normally below it

    Examples:
      | condition                                          | reason                               |
      | is not in the PATH                                 | claude CLI not found in PATH         |
      | hangs indefinitely                                 | Command timed out after 90s          |
      | exits with code 1                                  | Command failed or timed out          |
      | prints "Current session: 3% used" and no week line | Could not parse usage from output    |

  Scenario Outline: Agy probe failures render a dim unavailable panel
    Given the `agy` CLI <condition>
    When the user runs `npm start`
    Then the process exits with code 0
    And the agy panel is dim, shows no gauge, and shows the reason "<reason>"
    And the claude and kilo panels still render normally

    Examples:
      | condition                         | reason                            |
      | is not in the PATH                | agy CLI not found in PATH         |
      | hangs indefinitely                | Command timed out after 60s       |
      | exits with code 1                 | Command failed or timed out       |
      | prints nothing                    | Could not parse usage from output |
      | prints "hello world"              | Could not parse usage from output |

  Scenario: No CLI on the PATH at all
    Given the PATH contains no `claude`, `agy`, or `kilo`
    When the user runs `npm start`
    Then the process exits with code 0
    And three dim unavailable panels render in order "claude", "agy", "kilo"
    And the kilo panel still shows the reason "kilo CLI not found in PATH"

  Scenario: Task 001 end-to-end checks keep passing
    When the user runs `node qa/e2e.mjs`
    Then "qa/001-scaffold-kilo.e2e.mjs" and "qa/002-readme.e2e.mjs" pass
    And no e2e invokes a real `claude` or `agy` binary
