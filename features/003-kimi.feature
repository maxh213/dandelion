Feature: 003 - Kimi windows via its local web API

  Row layout, gauge math, ramp colours and NO_COLOR rules are those of features/002-claude-agy.feature.
  Kimi usage percent = used / limit * 100, rounded half-up to a whole number.

  Background:
    Given the current time is "2026-09-13T10:00:00Z"
    And the `claude`, `agy` and `kilo` CLIs of features/002-claude-agy.feature are in the PATH
    And ALLOWANCE_KIMI_PORT is "48123"
    And a `kimi` CLI in the PATH that, when run as `kimi web --no-open --port 48123`, writes its pid to a pid file,
      prints "kimi web ready: http://127.0.0.1:48123/?token=test-token",
      and until killed answers GET http://127.0.0.1:48123/api/v1/oauth/usage carrying "Authorization: Bearer test-token" with:
      """
      { "data": {
          "summary": { "used": 590, "limit": 1000, "reset_at": "2026-09-18T10:00:00Z" },
          "limits": [ { "used": 42, "limit": 100, "window": { "unit": "hour", "value": 5 } } ]
      } }
      """
    And it answers any other request with HTTP 401

  Scenario: Kimi panel renders between agy and kilo
    When the user runs `npm start` with NO_COLOR set
    Then the process exits with code 0
    And the panels appear in the order "claude", "agy", "kimi", "kilo"
    And the kimi panel is: rule, "kimi", these two rows exactly, dim caption "kimi code · kimi"
      """
      weekly                              ############--------  59% ↻ 5d0h
      5h                                  ########------------  42%
      """
    And the claude, agy and kilo panels are unchanged from features/002-claude-agy.feature
    And every line is at most 72 columns wide

  Scenario: Kimi child is gone once the dashboard prints
    When the user runs `npm start`
    Then the process exits with code 0
    And the pid in the pid file no longer names a running process

  Scenario Outline: Token is found on either log stream and form
    Given the `kimi` fixture prints "<line>" to <stream> instead, and accepts "Bearer abc.D-9_z"
    When the user runs `npm start`
    Then the kimi panel shows the "weekly" row at 59% and the "5h" row at 42%

    Examples:
      | line                                           | stream |
      | open http://127.0.0.1:48123/?token=abc.D-9_z   | stdout |
      | Authorization: Bearer abc.D-9_z                | stderr |

  Scenario Outline: Kimi response variations
    Given the kimi usage response is <body>
    When the user runs `npm start` with NO_COLOR set
    Then the kimi panel is ok and its rows are exactly:
      """
      <rows>
      """

    Examples:
      | body                                                                                                                      | rows                                                              |
      | {"data":{"summary":{"used":500,"limit":1000}}}                                                                            | weekly                              ##########----------  50%     |
      | {"data":{"summary":{"used":1,"limit":3},"limits":[]}}                                                                     | weekly                              #######-------------  33%     |
      | {"data":{"summary":{"used":2,"limit":3},"limits":[{"used":9,"limit":10,"window":{"unit":"day","value":1}}]}}              | weekly                              #############-------  67%     |

  Scenario Outline: Kimi probe failures render a dim unavailable panel and reap the child
    Given the `kimi` fixture <condition>
    When the user runs `npm start` under an outer timeout of <seconds> seconds
    Then the process exits with code 0 before the outer timeout
    And the kimi panel is dim, shows no gauge, and shows the reason "<reason>" and caption "kimi code · kimi"
    And the claude, agy and kilo panels still render normally, in order around it
    And no process started as the kimi fixture is still running

    Examples:
      | condition                                                    | reason                                   | seconds |
      | is not in the PATH                                           | kimi CLI not found in PATH               | 10      |
      | exits immediately without printing a token                   | kimi web printed no token within 20s     | 30      |
      | keeps running but never prints a token                       | kimi web printed no token within 20s     | 35      |
      | prints the token but serves no HTTP on the port              | kimi usage request failed                | 35      |
      | prints the token and answers HTTP 500                        | kimi usage request failed: HTTP 500      | 10      |
      | prints the token and never answers the request               | kimi usage request timed out after 10s   | 25      |
      | prints the token and answers "{\"data\":"                    | Could not parse usage from response      | 10      |
      | prints the token and answers {"data":{"limits":[]}}          | Could not parse usage from response      | 10      |
      | prints the token and answers {"data":{"summary":{"used":1}}} | Could not parse usage from response      | 10      |

  Scenario: A kimi child that ignores SIGTERM is killed after 5 seconds
    Given the `kimi` fixture serves the usage JSON but ignores SIGTERM
    When the user runs `npm start` under an outer timeout of 15 seconds
    Then the process exits with code 0 before the outer timeout
    And the kimi panel renders ok with "weekly" at 59% and "5h" at 42%
    And the pid in the pid file no longer names a running process

  Scenario: Kimi port defaults to 59177
    Given ALLOWANCE_KIMI_PORT is unset
    When the user runs `npm start`
    Then the `kimi` fixture is invoked with the arguments "web --no-open --port 59177"
    And the usage request goes to "http://127.0.0.1:59177/api/v1/oauth/usage"

  Scenario: Kimi probes in parallel with the others
    Given the `claude`, `agy` and `kilo` CLIs all hang indefinitely and `kimi` never prints a token
    When the user runs `npm start`
    Then the process exits with code 0 within 95 seconds
    And the panels appear in the order "claude", "agy", "kimi", "kilo", all dim unavailable

  Scenario: No CLI on the PATH at all
    Given the PATH contains no `claude`, `agy`, `kimi` or `kilo`
    When the user runs `npm start`
    Then the process exits with code 0
    And four dim unavailable panels render in order:
      | name   | reason                       | caption              |
      | claude | claude CLI not found in PATH | claude code · claude |
      | agy    | agy CLI not found in PATH    | agy · agy            |
      | kimi   | kimi CLI not found in PATH   | kimi code · kimi     |
      | kilo   | kilo CLI not found in PATH   | api balance · kilo   |

  Scenario: README documents kimi
    When I read "README.md"
    Then the provider list names `kimi` (kimi code) between `agy` and `kilo`, and says it reads `kimi web`'s local usage endpoint
    And the env-var ledger lists `ALLOWANCE_KIMI_PORT` with default `59177`

  Scenario: Earlier end-to-end checks keep passing
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, including the 001 and 002 e2es and the new 003 kimi e2es
    And no e2e invokes a real `claude`, `agy`, `kimi` or `kilo` binary or leaves a fixture process running
    And package.json still has no "dependencies" section
