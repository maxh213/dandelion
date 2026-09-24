Feature: 020 - route kimi as kimi-code/k3 max and grok as grok-4.7 xhigh, hermes as x-ai/grok-4.7 xhigh

  Assumptions:
  - `kimi-code/k3` is configured with default effort max; printing the effort token `max` is belt-and-braces, so a consumer that drops it still launches K3 at max.
  - Only the three model lines and the strings that assert them move. Decision logic, window kinds, the 90% trip, eligibility, dashboard order, panel captions and probe recipes are unchanged.

  Background:
    Given the fixtures, HOME, TZ and DANDELION_* variables of features/018-kimi-usage.feature
    And every provider not listed is unavailable

  Scenario Outline: route prints the moved model lines
    Given the usages <usages>, junie <junie>, hermes <hermes> and the state file missing
    When the user runs `node src/main.ts route`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is 0

    Examples:
      | case                | usages                       | junie | hermes | line                       |
      | kimi free           | kimi 10/10@72, grok 50@72    | none  | none   | kimi-code/k3 max kimi      |
      | grok free           | grok 50@72                   | none  | none   | grok-4.7 xhigh grok        |
      | hermes free         | none                         | none  | 75%    | x-ai/grok-4.7 xhigh hermes |
      | grok beats hermes   | grok 50@72                   | none  | 75%    | grok-4.7 xhigh grok        |
      | junie tie-breaker   | none                         | 0%    | 0%     | gemini-3.8-flash high junie |

  Scenario Outline: route --high prints the new grok line at rank 4
    Given the usages <usages> and the state file missing
    When the user runs `node src/main.ts route --high`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is 0

    Examples:
      | case              | usages                                    | line                |
      | grok rank 4       | claude 95/10/10, cursor 95, grok 60       | grok-4.7 xhigh grok |

  Scenario Outline: Affected earlier rows keep working with the new strings
    Given the usages <usages>, junie <junie>, hermes <hermes> and the state file missing
    When the user runs `node src/main.ts <args>`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is 0

    Examples:
      | case                              | args         | usages                                             | junie | hermes | line                       |
      | 014 live case                     | route        | claude 2/13@130, work 100/72@5.35, agy 0/17@126, kimi 0/95@73, grok 9@130, cursor 36/365 | 30%   | 75%    | grok-4.7 xhigh grok        |
      | 014 live case, work at 89         | route        | claude 2/13@130, work 89/72@5.35, agy 0/17@126, kimi 0/95@73, grok 9@130, cursor 36/365  | 30%   | 75%    | claude-opus-5 max claude-work |
      | 016 hermes evaporates             | route        | none                                               | none  | 60%    | x-ai/grok-4.7 xhigh hermes |
      | 018 kimi trips                    | route        | kimi 90/10@72, grok 50@72                          | none  | none   | grok-4.7 xhigh grok        |
      | 018 kimi weekly evaporates        | route        | kimi 0/95@2, agy 0/0@72                            | none  | none   | kimi-code/k3 max kimi      |
      | 012 high grok rank 4              | route --high | claude 95/10/10, cursor 95, grok 60                | none  | none   | grok-4.7 xhigh grok        |

  Scenario: The dashboard route boxes show the new lines
    Given the usages of "The 014 live case with junie and hermes" in features/016-hermes.feature, with hermes 75% and junie 30%
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the route boxes at the top show `grok-4.7 xhigh` over `grok` for plain route and `claude-fable-5-1 max` over `claude` for `--high`

  Scenario: README, unit tests and perf expectations reflect the new lines
    When I read "README.md"
    Then the Route routing table has the rows
      | provider | standard line        | max line             |
      | kimi     | `kimi-code/k3 max`   | `kimi-code/k3 max`   |
      | grok     | `grok-4.7 xhigh`     | `grok-4.7 xhigh`     |
      | hermes   | `x-ai/grok-4.7 xhigh`| `x-ai/grok-4.7 xhigh`|
    And the `--high` chain table has rank 4 line `grok-4.7 xhigh`
    And the unit tests in "src/domain/index.test.ts" assert the new kimi, grok and hermes routing-table rows, the new routeLine rows, and the new highRouteLine rank-4 row
    And the unit tests in "src/main.test.ts" that pin the README tables and the route boxes assert the new strings
    And the perf expectations in "perf/bench_route", "perf/bench_trip" and "perf/bench_eligibility" assert the new lines

  Scenario: Nothing else changes
    Then every line of the 010 to 018 features that did not contain `kimi-for-coding-highspeed`, `grok-4.6` or `x-ai/grok-4.6` is unchanged,
      the claude, claude-work, agy, cursor, junie and kilo lines are unchanged, decision logic is unchanged,
      the dashboard order, panel captions and probe recipes are unchanged, and `none` with exit 1 still works
