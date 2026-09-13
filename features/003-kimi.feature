Feature: 003 - Kimi windows via its local web API

  Row layout, gauge math, ramp colours and NO_COLOR rules are those of features/002-claude-agy.feature.
  Kimi usage percent = used / limit * 100, rounded half-up to a whole number, not capped at 100.
  A usable number is a finite JSON number; used must be >= 0 and limit must be > 0.
  A response of any shape never crashes the app: a bad `data` or `summary` makes the kimi panel unavailable,
  and a bad `limits` value or entry is ignored.
  The 003 scenarios "Kimi probes in parallel with the others" and "No CLI on the PATH at all" replace
  the 002 scenarios "Probes run in parallel" and "No CLI on the PATH at all": there are now four panels.

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

  Scenario Outline: Kimi summary variations
    Given the kimi usage response is <body>
    When the user runs `npm start` with NO_COLOR set
    Then the kimi panel is ok and its only row is exactly "<row>"

    Examples:
      | body                                                                                                         | row                                                               |
      | {"data":{"summary":{"used":500,"limit":1000}}}                                                               | weekly                              ##########----------  50%     |
      | {"data":{"summary":{"used":1,"limit":3},"limits":[]}}                                                        | weekly                              #######-------------  33%     |
      | {"data":{"summary":{"used":2,"limit":3},"limits":[{"used":9,"limit":10,"window":{"unit":"day","value":1}}]}} | weekly                              #############-------  67%     |
      | {"data":{"summary":{"used":125,"limit":1000}}}                                                               | weekly                              ###-----------------  13%     |
      | {"data":{"summary":{"used":0,"limit":1000}}}                                                                 | weekly                              --------------------   0%     |
      | {"data":{"summary":{"used":1200,"limit":1000}}}                                                              | weekly                              #################### 120%     |
      | {"data":{"summary":{"used":590,"limit":1000,"reset_at":"soon"}}}                                             | weekly                              ############--------  59%     |
      | {"data":{"summary":{"used":590,"limit":1000,"reset_at":42}}}                                                 | weekly                              ############--------  59%     |
      | {"data":{"summary":{"used":590,"limit":1000},"limits":"x"}}                                                  | weekly                              ############--------  59%     |
      | {"data":{"summary":{"used":590,"limit":1000},"limits":{}}}                                                   | weekly                              ############--------  59%     |
      | {"data":{"summary":{"used":590,"limit":1000},"limits":[null]}}                                               | weekly                              ############--------  59%     |
      | {"data":{"summary":{"used":590,"limit":1000},"limits":[{"used":42,"limit":100}]}}                            | weekly                              ############--------  59%     |
      | {"data":{"summary":{"used":590,"limit":1000},"limits":[{"used":42,"limit":100,"window":null}]}}              | weekly                              ############--------  59%     |

  Scenario: Every hour entry is labelled 5h and shown in response order; bad hour entries are skipped
    Given the kimi usage response is:
      """
      { "data": {
          "summary": { "used": 590, "limit": 1000 },
          "limits": [
            { "used": 42, "limit": 100, "window": { "unit": "hour", "value": 5 } },
            { "used": 1, "limit": 0, "window": { "unit": "hour", "value": 5 } },
            { "used": "x", "limit": 100, "window": { "unit": "hour", "value": 5 } },
            { "used": 3, "window": { "unit": "hour", "value": 5 } },
            { "used": -1, "limit": 100, "window": { "unit": "hour", "value": 5 } },
            { "used": 7, "limit": 10, "window": { "unit": "hour", "value": 1 } },
            { "used": 9, "limit": 10, "window": { "unit": "day", "value": 7 } }
          ]
      } }
      """
    When the user runs `npm start` with NO_COLOR set
    Then the kimi panel is ok and its rows are exactly:
      """
      weekly                              ############--------  59%
      5h                                  ########------------  42%
      5h                                  ##############------  70%
      """

  Scenario Outline: Kimi probe failures render a dim unavailable panel and reap the child
    Given the `kimi` fixture <condition>
    When the user runs `npm start` under an outer timeout of 40 seconds
    Then the process exits with code 0 <timing>
    And the kimi panel is dim, shows no gauge, and shows the reason "<reason>" and caption "kimi code · kimi"
    And the claude, agy and kilo panels still render normally, in order around it
    And no process started as the kimi fixture is still running

    Examples:
      | condition                                                        | reason                                   | timing                     |
      | is not in the PATH                                               | kimi CLI not found in PATH               | within 5 seconds           |
      | exits immediately without printing a token                       | kimi web exited without printing a token | within 5 seconds           |
      | keeps running but never prints a token                           | kimi web printed no token within 20s     | after 20 to 30 seconds     |
      | prints the token but serves no HTTP on the port                  | kimi usage request failed                | within 5 seconds           |
      | prints the token and answers HTTP 500                            | kimi usage request failed: HTTP 500      | within 5 seconds           |
      | prints the token and never answers the request                   | kimi usage request timed out after 10s   | after 10 to 20 seconds     |
      | prints the token and answers "{\"data\":"                        | Could not parse usage from response      | within 5 seconds           |
      | prints the token and answers {"data":{"limits":[]}}              | Could not parse usage from response      | within 5 seconds           |
      | prints the token and answers null                                | Could not parse usage from response      | within 5 seconds           |
      | prints the token and answers []                                  | Could not parse usage from response      | within 5 seconds           |
      | prints the token and answers {"data":null}                       | Could not parse usage from response      | within 5 seconds           |
      | prints the token and answers {"data":{"summary":null}}           | Could not parse usage from response      | within 5 seconds           |
      | prints the token and answers {"data":{"summary":"x"}}            | Could not parse usage from response      | within 5 seconds           |
      | prints the token and answers {"data":{"summary":{"used":1}}}     | Could not parse usage from response      | within 5 seconds           |
      | prints the token and answers {"data":{"summary":{"used":1,"limit":0}}}      | Could not parse usage from response | within 5 seconds    |
      | prints the token and answers {"data":{"summary":{"used":-1,"limit":1000}}}  | Could not parse usage from response | within 5 seconds    |
      | prints the token and answers {"data":{"summary":{"used":"590","limit":1000}}} | Could not parse usage from response | within 5 seconds  |
      | prints the token and answers {"data":{"summary":{"used":590,"limit":"1000"}}} | Could not parse usage from response | within 5 seconds  |

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

  Scenario Outline: ALLOWANCE_KIMI_PORT values
    Given ALLOWANCE_KIMI_PORT is set to "<value>"
    When the user runs `npm start`
    Then the process exits with code 0
    And <outcome>

    Examples:
      | value   | outcome                                                                                                                  |
      |         | the `kimi` fixture is invoked with "web --no-open --port 59177"                                                          |
      | 65535   | the `kimi` fixture is invoked with "web --no-open --port 65535"                                                          |
      | abc     | `kimi` is not started and the kimi panel is dim with the reason "ALLOWANCE_KIMI_PORT must be an integer from 1 to 65535" |
      | 0       | `kimi` is not started and the kimi panel is dim with the reason "ALLOWANCE_KIMI_PORT must be an integer from 1 to 65535" |
      | 70000   | `kimi` is not started and the kimi panel is dim with the reason "ALLOWANCE_KIMI_PORT must be an integer from 1 to 65535" |
      | 48123.5 | `kimi` is not started and the kimi panel is dim with the reason "ALLOWANCE_KIMI_PORT must be an integer from 1 to 65535" |

  Scenario: Kimi probes in parallel with the others
    Given the `claude`, `agy` and `kilo` CLIs all hang indefinitely and `kimi` keeps running but never prints a token
    When the user runs `npm start`
    Then the process exits with code 0 within 95 seconds
    And four dim unavailable panels render in order "claude", "agy", "kimi", "kilo" with reasons "Command timed out after 90s", "Command timed out after 60s", "kimi web printed no token within 20s", "Command timed out after 20s"

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
    Then the intro sentence names `claude`, `agy` and `kimi` as the subscription usage windows and `kilo` as the API balance
    And the provider list names `kimi` (kimi code) between `agy` and `kilo`, says it reads `kimi web`'s local usage endpoint, and states a 20s token wait, a 10s request timeout, and a SIGTERM then SIGKILL after 5s shutdown
    And it says "All four probes run in parallel" and no longer says "All three probes run in parallel"
    And the env-var ledger lists `ALLOWANCE_KIMI_PORT` with default `59177`

  Scenario: Earlier end-to-end checks keep passing
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, including the 001 and 002 e2es and the new 003 kimi e2es
    And every 003 e2e creates its fixture dir with the temp prefix "allowance-qa-003-"
    And "qa/003-kimi.e2e.mjs" runs `npm start` twice with PATH set to only its fixture dir and node's dir, ALLOWANCE_KIMI_PORT set to a free port, and an outer spawn timeout
    And in the first run its `kimi` fixture serves the Background JSON, and it asserts exit code 0, the kimi panel between agy and kilo, a "weekly" row at "59%" and a "5h" row at "42%"
    And in the second run its `kimi` fixture writes its pid file and exits at once without printing a token, and it asserts exit code 0 before the outer timeout and a dim kimi panel with the reason "kimi web exited without printing a token"
    And after each run it reads the fixture's pid file and asserts that pid no longer names a running process
    And after the run no process whose command line contains "allowance-qa" is running
    And no e2e invokes a real `claude`, `agy`, `kimi` or `kilo` binary
    And package.json still has no "dependencies" section
