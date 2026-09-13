Feature: 005 - Codex panel that reflects its login mode

  Row layout, gauge math, ramp colours and NO_COLOR rules are those of features/002-claude-agy.feature.
  Step 1 runs `codex login status` (15s timeout). Its text is read from stdout and stderr together; real codex prints to stderr.
  A non-zero exit always means "codex is not logged in", whatever the text, and `codex app-server` is then not started.
  On exit 0, a line starting "Logged in using an API key" means API-key mode; otherwise a line containing "ChatGPT" means ChatGPT mode.
  Status is not visible in the terminal (unavailable and error render alike), so it is pinned on the codex probe result.
  API-key mode never starts `codex app-server`.
  ChatGPT mode spawns `codex app-server` with stdin held open and writes, one JSON per line:
    {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"allowance","title":null,"version":"0.1.0"}}}
    {"jsonrpc":"2.0","method":"initialized"}
    {"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}
  It reads stdout lines until the line whose "id" is 2. Lines without that id, including non-JSON lines and notifications, are ignored.
  The whole exchange is bounded by 30s. The child is then stopped with SIGTERM, then SIGKILL after 5s, and is always gone when the dashboard prints.
  Windows come from result.rateLimits.primary then result.rateLimits.secondary. Other fields are ignored.
  A window is usable when usedPercent is a finite JSON number >= 0. usedPct = usedPercent rounded half-up, not capped at 100.
  resetsAt is a JSON number of Unix seconds; anything else means no countdown.
  Label from windowDurationMins: 10080 is "weekly", a whole number of days is "<n>d", of hours "<n>h", any other positive integer "<n>m",
  and anything else is "primary" or "secondary".
  The caption is "codex · codex" in every state.
  The 005 scenario "No CLI on the PATH at all" replaces the 004 one: there are now six panels.
  "node's bin" below is a temp dir holding only `node` and `sh` symlinks (npm runs scripts through `sh`), never node's install dir,
  so a real `codex` installed next to node (nvm, volta, npm prefix) is never on the PATH of any e2e or QA run.

  Background:
    Given the current time is "2026-09-13T10:00:00Z"
    And the `claude`, `agy`, `kimi` and `kilo` fixtures and the grok home of features/004-grok.feature are in place
    And a `codex` fixture in the PATH whose behaviour is chosen by CODEX_FIXTURE_MODE
    And in mode "chatgpt" `codex login status` prints "Logged in using ChatGPT" to stderr and exits 0
    And in mode "chatgpt" `codex app-server` answers initialize with {"id":1,"result":{"userAgent":"fixture"}}, ignores "initialized",
      emits the notification {"method":"remoteControl/status/changed","params":{"status":"disabled"}}, then answers id 2 with:
      """
      {"id":2,"result":{"rateLimits":{"limitId":"codex","planType":"plus",
        "primary":{"usedPercent":42,"windowDurationMins":300,"resetsAt":1789302600},
        "secondary":{"usedPercent":86,"windowDurationMins":10080,"resetsAt":1789552800}},
        "rateLimitsByLimitId":null}}
      """
    And in mode "apikey" `codex login status` prints "Logged in using an API key - sk-proj-***n5zQA" to stderr and exits 0

  Scenario: ChatGPT mode renders both rate-limit windows between grok and kilo
    Given CODEX_FIXTURE_MODE is "chatgpt"
    When the user runs `npm start` with NO_COLOR set
    Then the process exits with code 0
    And the panels appear in the order "claude", "agy", "kimi", "grok", "codex", "kilo"
    And the codex panel is exactly: rule, "codex", then
      """
      5h                                  ########------------  42% ↻ 2h30m
      weekly                              #################---  86% ↻ 3d0h
      codex · codex
      """
    And no `codex app-server` process is still running
    And the other panels are unchanged from features/004-grok.feature
    And every line is at most 72 columns wide

  Scenario: ChatGPT mode colours
    Given CODEX_FIXTURE_MODE is "chatgpt"
    When the user runs `npm start` without NO_COLOR
    Then the "5h" gauge and "42%" carry the calm escape, the "weekly" gauge and "86%" the hot escape, and the caption is dim

  Scenario: API-key mode is a normal ok panel with no windows
    Given CODEX_FIXTURE_MODE is "apikey"
    When the user runs `npm start` with NO_COLOR set
    Then the process exits with code 0
    And the codex probe reports status "ok" with zero windows and no balance
    And the codex panel is exactly: rule, "codex", "api-key billing · no usage windows", "codex · codex"
    And the codex panel shows no gauge, no percent and no reason, and is not dim apart from its rule and caption
    And `codex app-server` was never started

  Scenario Outline: Rate-limit window variations
    Given CODEX_FIXTURE_MODE is "chatgpt" and id 2 is answered with {"id":2,"result":{"rateLimits":<limits>}}
    When the user runs `npm start` with NO_COLOR set
    Then the codex panel is ok and its rows are exactly "<rows>"

    Examples:
      | limits                                                                                           | rows                                                                   |
      | {"primary":{"usedPercent":33.5,"windowDurationMins":300},"secondary":null}                        | 5h                                  #######-------------  34%          |
      | {"primary":null,"secondary":{"usedPercent":130,"windowDurationMins":10080,"resetsAt":"soon"}}    | weekly                              #################### 130%          |
      | {"primary":{"usedPercent":0,"windowDurationMins":1440,"resetsAt":null}}                           | 1d                                  --------------------   0%          |
      | {"primary":{"usedPercent":10,"windowDurationMins":90},"secondary":{"usedPercent":"x"}}            | 90m                                 ##------------------  10%          |
      | {"primary":{"usedPercent":10},"secondary":{"usedPercent":-1,"windowDurationMins":300}}            | primary                             ##------------------  10%          |

  Scenario: A rate-limits notification before the answer is not used
    Given CODEX_FIXTURE_MODE is "chatgpt" and before answering id 2 the fixture prints "not json" and
      {"method":"account/rateLimits/updated","params":{"rateLimits":{"primary":{"usedPercent":99,"windowDurationMins":300}}}}
    When the user runs `npm start` with NO_COLOR set
    Then the codex panel shows "5h" at 42% and "weekly" at 86%, and "99%" appears nowhere

  Scenario Outline: Codex failures render a dim panel, keep the others, and reap the child
    Given the `codex` fixture <condition>
    When the user runs `npm start` under an outer timeout of 60 seconds
    Then the process exits with code 0 <timing>
    And the codex probe reports status "<status>"
    And the codex panel is dim, shows no gauge, and shows the reason "<reason>" and the caption "codex · codex"
    And the claude, agy, kimi, grok and kilo panels still render normally, in order around it
    And no process started as the codex fixture is still running

    Examples:
      | condition | status | reason | timing |
      | is not in the PATH | unavailable | codex CLI not found in PATH | within 5 seconds |
      | prints "Not logged in" for `login status` and exits 1 | unavailable | codex is not logged in | within 5 seconds |
      | prints "Logged in using ChatGPT" for `login status` and exits 1, and `app-server` is never called | unavailable | codex is not logged in | within 5 seconds |
      | prints "Logged in using an API key - sk-proj-***n5zQA" for `login status` and exits 1 | unavailable | codex is not logged in | within 5 seconds |
      | prints "hello" for `login status` and exits 0 | unavailable | codex is not logged in | within 5 seconds |
      | hangs on `login status` | unavailable | Command timed out after 15s | after 15 to 25 seconds |
      | is in ChatGPT mode and answers id 2 with {"error":{"code":-32600,"message":"chatgpt authentication required to read rate limits"},"id":2} | error | chatgpt authentication required to read rate limits | within 5 seconds |
      | is in ChatGPT mode and answers id 2 with {"error":{"code":-32600},"id":2} | error | codex app-server error | within 5 seconds |
      | is in ChatGPT mode and answers initialize but never answers id 2 | error | codex app-server did not answer within 30s | after 30 to 40 seconds |
      | is in ChatGPT mode and its app-server exits at once without output | error | codex app-server exited without answering | within 5 seconds |
      | is in ChatGPT mode and answers id 2 with {"id":2,"result":{"rateLimits":{"primary":null,"secondary":null}}} | error | Could not parse rate limits from response | within 5 seconds |
      | is in ChatGPT mode and answers id 2 with {"id":2,"result":null} | error | Could not parse rate limits from response | within 5 seconds |

  Scenario: An app-server that ignores SIGTERM is killed after 5 seconds
    Given CODEX_FIXTURE_MODE is "chatgpt" and the app-server ignores SIGTERM and stays alive after answering
    When the user runs `npm start` under an outer timeout of 20 seconds
    Then the process exits with code 0 before the outer timeout
    And the codex panel shows "5h" at 42% and "weekly" at 86%
    And no process started as the codex fixture is still running

  Scenario: The API-key line on stdout is recognised too
    Given the `codex` fixture prints "Logged in using an API key - sk-proj-***n5zQA" to stdout for `login status` and exits 0
    When the user runs `npm start` with NO_COLOR set
    Then the codex probe reports status "ok" and the panel shows "api-key billing · no usage windows"
    And `codex app-server` was never started

  Scenario: No CLI on the PATH at all
    Given the PATH is an empty temp dir plus node's bin, so it contains no `claude`, `agy`, `kimi`, `codex` or `kilo`, and ALLOWANCE_GROK_HOME is an empty directory
    When the user runs `npm start`
    Then the process exits with code 0
    And six dim panels render in order, each probe reporting status "unavailable":
      | name   | reason                                   | caption              |
      | claude | claude CLI not found in PATH             | claude code · claude |
      | agy    | agy CLI not found in PATH                | agy · agy            |
      | kimi   | kimi CLI not found in PATH               | kimi code · kimi     |
      | grok   | no grok billing snapshot — run grok once | grok · grok          |
      | codex  | codex CLI not found in PATH              | codex · codex        |
      | kilo   | kilo CLI not found in PATH               | api balance · kilo   |

  Scenario: README documents codex
    When I read "README.md"
    Then the intro sentence names `claude`, `agy`, `kimi`, `grok` and `codex` as the subscription usage windows and `kilo` as the API balance
    And the provider list names `codex` between `grok` and `kilo`, says it runs `codex login status` (15s timeout), shows "api-key billing · no usage windows" in API-key mode, and in ChatGPT mode reads `account/rateLimits/read` from `codex app-server` (30s timeout, SIGTERM then SIGKILL after 5s)
    And it says "All six probes run in parallel" and no longer says "All five probes run in parallel"

  Scenario: Earlier end-to-end checks keep passing
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, including the 001 to 004 e2es and the new "qa/005-codex.e2e.mjs"
    And "qa/005-codex.e2e.mjs" creates its fixture dir with the temp prefix "allowance-qa-005-" and runs `npm start` twice with PATH set to only its fixture dir and node's bin, NO_COLOR set, and an outer spawn timeout
    And in the first run CODEX_FIXTURE_MODE is "apikey", and it asserts exit code 0 and the lines "codex", "api-key billing · no usage windows", "codex · codex" in a row, between "grok" and "kilo", and that `codex app-server` was never started
    And in the second run CODEX_FIXTURE_MODE is "chatgpt", and it asserts exit code 0, a "5h" row at "42%" and a "weekly" row at "86%" inside the codex panel, and that the app-server pid from the fixture's pid file no longer names a running process
    And the 001 to 004 e2es also put node's bin, not node's install dir, on their PATH, and spawn node or npm by absolute path
    And so no e2e can invoke a real `claude`, `agy`, `kimi`, `grok`, `codex` or `kilo` binary, even one installed next to node
    And package.json still has no "dependencies" section
