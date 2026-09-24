Feature: 018 - Parse kimi 2.0 usage so the panel shows the live windows

  Assumptions (the task is silent here):
  - `code` is an error envelope on a 2xx JSON body. When `code` is present and is not the number `0`, the
    panel is unavailable with the request-failed family: `kimi usage request failed: ${msg}` when `msg` is a
    non-empty string, else `kimi usage request failed` (same colon form as `kimi usage request failed: HTTP
    500`). Missing `code` is not an envelope error; parsing continues at `data.kind` / `quota.usages`. A
    non-number `code` (including `"0"` and `null`) is not the number `0`. Truncated JSON never reaches this
    check. HTTP 4xx/5xx, network and timeout still throw in `successBody` before the body is read.
  - `quota.usages` must be a non-array object (`isRecord`). `data.kind` must be exactly `"ok"`. Extra JSON
    fields (`request_id`, `msg`, `extraUsage`, unknown keys under `usages`) are ignored. `extraUsage` never
    becomes a window. At most two windows: `limit7d` then `limit5h`, even when the JSON lists `limit5h` first.
  - `usedPct` = clamp(Math.round(100 * usedRatio), 0, 100) for a finite `usedRatio` >= 0. Skip a key whose
    `usedRatio` is missing, not a number, non-finite, or negative. If both keys are skipped, parse failure.
    `limit7d.resetAt` becomes weekly `resetsAt` when `validInstant` accepts it; `limit5h.resetAt` is never
    copied onto the rolling window. The task's unit-test bullet that sets weekly `resetsAt` to
    `2026-09-19T14:58:50Z` copies the live `limit5h.resetAt`; weekly uses `limit7d.resetAt`
    `2026-09-25T12:58:50Z`.
  - The 003 spawn / token scrape / Bearer GET / SIGTERM then SIGKILL after 5s / `DANDELION_KIMI_PORT` recipe
    is unchanged. `#token=` in `Local: http://127.0.0.1:<port>/#token=…` matches the existing `token=` scrape.
    The 003 `{ data: { summary, limits } }` shape is not a 2.0 body and is parse failure.
  - Row layout is still 35-cell label, 20-cell gauge, 4-cell percent. `kimi H/W@R` is still 5h H% and weekly
    W% resetting in R hours. Grok still prints `grok-4.7 xhigh grok`.

  Background:
    Given the current time is "2026-09-13T10:00:00Z"
    And every other provider is unavailable unless a scenario lists it
    And DANDELION_KIMI_PORT is "48123"
    And a `kimi` CLI in the PATH that, when run as `kimi web --no-open --port 48123`, writes its pid to a pid
      file, prints "Local: http://127.0.0.1:48123/#token=test-token", and until killed answers GET
      http://127.0.0.1:48123/api/v1/oauth/usage carrying "Authorization: Bearer test-token" with:
      """
      { "code": 0, "msg": "success", "data": { "kind": "ok", "quota": { "usages": {
          "limit5h": { "usedRatio": 0.42, "resetAt": "2026-09-13T15:00:00Z" },
          "limit7d": { "usedRatio": 0.59, "resetAt": "2026-09-18T10:00:00Z" }
        }, "extraUsage": null } }, "request_id": "01M2WR59QVZ5WJFMF4A6TWESJB" }
      """
    And it answers any other request with HTTP 401

  Scenario: Kimi panel paints weekly and 5h from the 2.0 body
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the process exits with code 0
    And the panels appear in the order "claude", "claude-work", "agy", "kimi", "grok", "codex", "cursor",
      "junie", "hermes", "kilo"
    And the kimi panel is: rule, "kimi", these two rows exactly, dim caption "kimi code · kimi"
      """
      weekly                              ############--------  59% ↻ 5d0h
      5h                                  ########------------  42%
      """
    And the 5h row has no "↻", even though the payload's limit5h.resetAt is a valid instant
    And "test-token" appears nowhere in stdout or stderr
    And every line is at most 72 columns wide
    And the pid in the pid file no longer names a running process

  Scenario: The verified live body paints 0% on both rows
    Given the current time is "2026-09-19T12:58:50Z"
    And the kimi usage response is the verified 2.0.0 body
      """
      { "code": 0, "msg": "success", "data": { "kind": "ok", "quota": { "usages": {
          "limit5h": { "usedRatio": 0, "resetAt": "2026-09-19T14:58:50Z" },
          "limit7d": { "usedRatio": 0, "resetAt": "2026-09-25T12:58:50Z" }
        }, "extraUsage": null } }, "request_id": "01M2WR59QVZ5WJFMF4A6TWESJB" }
      """
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the kimi panel is ok and its rows are exactly
      """
      weekly                              --------------------   0% ↻ 6d0h
      5h                                  --------------------   0%
      """
    And the panel is not the dim parse-failure card
    And the child is gone

  Scenario Outline: Token is found on either log stream and form
    Given the `kimi` fixture prints "<line>" to <stream> instead, and accepts "Bearer abc.D-9_z"
    When the user runs `npm start -- --once`
    Then the kimi panel shows the "weekly" row at 59% and the "5h" row at 42%
    And "abc.D-9_z" appears nowhere in stdout, stderr or the reason

    Examples:
      | line                                              | stream |
      | Local: http://127.0.0.1:48123/#token=abc.D-9_z    | stdout |
      | open http://127.0.0.1:48123/?token=abc.D-9_z      | stdout |
      | Authorization: Bearer abc.D-9_z                   | stderr |

  Scenario Outline: usedRatio to percent
    Given the kimi usage response is a 2.0 envelope whose limit7d.usedRatio is <weekly> and
      limit5h.usedRatio is <rolling>
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the kimi panel is ok and its rows are exactly
      """
      weekly                              <weekly_row>
      5h                                  <rolling_row>
      """

    Examples:
      | weekly | rolling | weekly_row                                                        | rolling_row                              |
      | 0      | 0       | --------------------   0% ↻ 5d0h                                  | --------------------   0%                |
      | 0.59   | 0.42    | ############--------  59% ↻ 5d0h                                  | ########------------  42%                |
      | 0.595  | 0.42    | ############--------  60% ↻ 5d0h                                  | ########------------  42%                |
      | 1      | 1       | #################### 100% ↻ 5d0h                                  | #################### 100%                |
      | 1.2    | 0       | #################### 100% ↻ 5d0h                                  | --------------------   0%                |

  Scenario Outline: One usable key is enough; a bad key is skipped
    Given the kimi usage response is a 2.0 envelope with <usages>
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the kimi panel is ok and its only row is exactly "<row>"

    Examples:
      | usages                                                                 | row                                                               |
      | limit7d usedRatio 0.59, no limit5h                                     | weekly                              ############--------  59% ↻ 5d0h |
      | limit5h usedRatio 0.42, no limit7d                                     | 5h                                  ########------------  42%     |
      | limit7d usedRatio 0.59, limit5h usedRatio "x"                          | weekly                              ############--------  59% ↻ 5d0h |
      | limit7d usedRatio -1, limit5h usedRatio 0.42                           | 5h                                  ########------------  42%     |
      | limit7d usedRatio 0.59 and resetAt "soon", no limit5h                  | weekly                              ############--------  59%     |

  Scenario Outline: Kimi 2.0 failures render a dim unavailable panel and reap the child
    Given the `kimi` fixture <condition>
    When the user runs `npm start -- --once` under an outer timeout of 40 seconds
    Then the process exits with code 0 <timing>
    And the kimi panel is dim, shows no gauge, and shows the reason "<reason>" and caption "kimi code · kimi"
    And the other panels still render in order around it
    And no process started as the kimi fixture is still running

    Examples:
      | condition                                                                 | reason                                   | timing                 |
      | is not in the PATH                                                        | kimi CLI not found in PATH               | within 5 seconds       |
      | exits immediately without printing a token                                | kimi web exited without printing a token | within 5 seconds       |
      | keeps running but never prints a token                                    | kimi web printed no token within 20s     | after 20 to 30 seconds |
      | prints the token but serves no HTTP on the port                           | kimi usage request failed                | within 5 seconds       |
      | prints the token and answers HTTP 500                                     | kimi usage request failed: HTTP 500      | within 5 seconds       |
      | prints the token and never answers the request                            | kimi usage request timed out after 10s   | after 10 to 20 seconds |
      | prints the token and answers HTTP 200 with code 1, msg "quota denied", and a full usages object | kimi usage request failed: quota denied | within 5 seconds |
      | prints the token and answers HTTP 200 with code 1 and msg ""              | kimi usage request failed                | within 5 seconds       |
      | prints the token and answers "{\"data\":"                                 | Could not parse usage from response      | within 5 seconds       |
      | prints the token and answers the 2.0 envelope with kind "error"           | Could not parse usage from response      | within 5 seconds       |
      | prints the token and answers the 2.0 envelope with no quota.usages        | Could not parse usage from response      | within 5 seconds       |
      | prints the token and answers the 2.0 envelope with usages []              | Could not parse usage from response      | within 5 seconds       |
      | prints the token and answers {"data":{"summary":{"used":590,"limit":1000},"limits":[{"used":42,"limit":100,"window":{"unit":"hour"}}]}} | Could not parse usage from response | within 5 seconds |
      | prints the token and answers the 2.0 envelope with both usedRatio values "0.59" | Could not parse usage from response | within 5 seconds |
      | DANDELION_KIMI_PORT is "abc"                                              | DANDELION_KIMI_PORT must be an integer from 1 to 65535 | within 5 seconds |

  Scenario: A kimi child that ignores SIGTERM is killed after 5 seconds
    Given the `kimi` fixture serves the Background JSON but ignores SIGTERM
    When the user runs `npm start -- --once` under an outer timeout of 15 seconds
    Then the process exits with code 0 before the outer timeout
    And the kimi panel renders ok with "weekly" at 59% and "5h" at 42%
    And the pid in the pid file no longer names a running process

  Scenario: Unit tests pin the 2.0 parse with an injected launcher and fetcher
    Given the unit tests of "src/probes/kimi.test.ts", with no sockets
    Then the verified live body yields status "ok", windows
      [{ label: "weekly", kind: "weekly", usedPct: 0, resetsAt: "2026-09-25T12:58:50Z" },
       { label: "5h", kind: "rolling", usedPct: 0 }]
      and the child is stopped
    And limit7d.usedRatio 0.595 with limit5h.usedRatio 0.42 yields weekly 60 and 5h 42
    And code 1 msg "quota denied" yields unavailable whose reason contains "kimi usage request failed" and
      "quota denied", and the child is stopped
    And missing usages, kind "error", truncated JSON, and a string usedRatio on both keys each yield
      "Could not parse usage from response" and still stop the child
    And launch is still `kimi web --no-open --port <port>`, the GET is still
      `http://127.0.0.1:<port>/api/v1/oauth/usage` with `Authorization: Bearer <token>` and timeout 10000,
      default port 59177, and SIGTERM then SIGKILL after 5s stay as in 003

  Scenario Outline: route still uses kimi's 5h as the rolling trip window and weekly as the binding
    Given the usages <usages> and the state file missing
    When the user runs `node src/main.ts <args>`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is <code>

    Examples:
      | args         | usages                                      | line                                      | code |
      | route        | kimi 10/10@72, grok 50@72                   | kimi-code/k3 max kimi  | 0    |
      | route        | kimi 90/10@72, grok 50@72                   | grok-4.7 xhigh grok                       | 0    |
      | route        | kimi 95/0@72, grok 97@72                    | grok-4.7 xhigh grok                       | 0    |
      | route        | kimi 0/95@2, agy 0/0@72                     | kimi-code/k3 max kimi  | 0    |
      | route        | kimi 0/0@72                                 | kimi-code/k3 max kimi  | 0    |
      | route --high | kimi 0/0@72                                 | none                                      | 1    |

  Scenario: The 014 live case and later route rows stay
    Given the usages of "The live case that prompted the task" in features/014-route-session-trip.feature,
      with junie 30% and hermes 75%
    When the user runs `node src/main.ts route`
    Then stdout is exactly "grok-4.7 xhigh grok" and a newline, exit 0
    When the user runs `node src/main.ts route --high`
    Then stdout is exactly "claude-fable-5-1 max claude" and a newline, exit 0
    When only hermes is available, at 0%, and the user runs `node src/main.ts route`
    Then stdout is exactly "x-ai/grok-4.7 xhigh hermes" and a newline, exit 0

  Scenario: Nothing else changes
    Then claude, claude-work, agy, grok, cursor, junie, hermes and kilo probes, captions, panel order and
      injection seams are those of 017, kilo is never routed, package.json still has no "dependencies"
      section, and every 010 to 017 route row prints the line and exit code it did before
    And the GET still goes through the injected fetcher; the token is never printed or persisted

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, including 001 to 017
    And the 003 kimi e2e still shows weekly 59% and 5h 42%, from a 2.0 fixture with usedRatio 0.59 and 0.42
    And a second kimi fixture serving the verified live usedRatio 0 body shows 0% on both rows, not the
      parse-failure card
    And every kimi fixture in qa/ serves the 2.0 envelope (Q_KIMI rolling/weekly as usedRatio/100), so the
      010 to 017 route e2es keep their lines
    And after each kimi run the child is gone, no e2e invokes a real kimi binary, and dummy tokens stay out
      of stdout and stderr
