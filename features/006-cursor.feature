Feature: 006 - Cursor plan usage from the dashboard API

  Row layout, gauge math, ramp colours and NO_COLOR rules are those of features/002-claude-agy.feature.
  Auth file is ALLOWANCE_CURSOR_AUTH_FILE, or "~/.config/cursor/auth.json" when it is unset or empty.
  The token is the file's "accessToken" when the file parses as a JSON object and it is a non-empty string.
  API base is ALLOWANCE_CURSOR_API_BASE, or "https://api2.cursor.sh" when it is unset or empty.
  With a token, the probe POSTs the body {} with the headers "Authorization: Bearer <token>" and
  "Content-Type: application/json" (15s timeout each) to both of:
    <API base>/aiserver.v1.DashboardService/GetCurrentPeriodUsage
    <API base>/aiserver.v1.DashboardService/GetPlanInfo
  Without a token, no request is made.
  Windows, in this order: "total" = planUsage.totalPercentUsed, "auto" = planUsage.autoPercentUsed, "api" = planUsage.apiPercentUsed.
  A window is shown when its value is a finite JSON number >= 0. usedPct is rounded half-up and not capped at 100.
  resetsAt = billingCycleEnd when it is a string of digits (milliseconds since epoch), else the row has no countdown.
  Plan label = "<planInfo.planName> · <planInfo.price>", or just planName when price is not a non-empty string,
  or "cursor" when planName is not a non-empty string or GetPlanInfo fails in any way.
  An ok caption is "<plan label> · cursor". An unavailable caption is always "cursor · cursor".
  Extra response fields are ignored. The token never appears in stdout, stderr, a reason or any written file.
  The 006 scenario "No CLI on the PATH at all" replaces the 005 one: there are now seven panels.

  Background:
    Given the current time is "2026-09-13T10:00:00Z"
    And the `claude`, `agy`, `kimi`, `codex` (mode "apikey") and `kilo` fixtures and the grok home of features/005-codex.feature are in place
    And ALLOWANCE_CURSOR_AUTH_FILE is a file holding {"accessToken":"qa-dummy-cursor-token-006","refreshToken":"qa-dummy-refresh-006"}
    And ALLOWANCE_CURSOR_API_BASE is "http://127.0.0.1:<port>" of a local HTTP fixture that answers GetCurrentPeriodUsage with:
      """
      {"billingCycleStart":"1788108306000","billingCycleEnd":"1790786706000",
       "planUsage":{"totalSpend":101050,"includedSpend":40000,"limit":40000,
         "autoPercentUsed":32.36,"apiPercentUsed":15.81,"totalPercentUsed":31.09}}
      """
    And answers GetPlanInfo with:
      """
      {"planInfo":{"planName":"Ultra","includedAmountCents":40000,"price":"$200/mo","billingCycleEnd":"1790786706000"}}
      """

  Scenario: Cursor panel renders the plan windows between codex and kilo
    When the user runs `npm start` with NO_COLOR set
    Then the process exits with code 0
    And the panels appear in the order "claude", "agy", "kimi", "grok", "codex", "cursor", "kilo"
    And the cursor panel is exactly: rule, "cursor", then
      """
      total                               ######--------------  31% ↻ 17d6h
      auto                                ######--------------  32% ↻ 17d6h
      api                                 ###-----------------  16% ↻ 17d6h
      Ultra · $200/mo · cursor
      """
    And the other panels are unchanged from features/005-codex.feature
    And every line is at most 72 columns wide

  Scenario: The fixture receives exactly the two authorised POSTs
    When the user runs `npm start` with NO_COLOR set
    Then the fixture received exactly one POST to "/aiserver.v1.DashboardService/GetCurrentPeriodUsage" and one to "/aiserver.v1.DashboardService/GetPlanInfo"
    And each carried "Authorization: Bearer qa-dummy-cursor-token-006", "Content-Type: application/json" and the body {}
    And "qa-dummy-cursor-token-006" appears nowhere in stdout or stderr

  Scenario: Cursor colours
    When the user runs `npm start` without NO_COLOR
    Then the "total", "auto" and "api" gauges and percents carry the calm escape, and the caption is dim

  Scenario Outline: Usage response variations
    Given GetCurrentPeriodUsage answers <body>
    When the user runs `npm start` with NO_COLOR set
    Then the cursor panel is ok and its rows are exactly "<rows>"

    Examples:
      | body                                                                                                  | rows                                                                                                                                              |
      | {"billingCycleEnd":"1790786706000","planUsage":{"totalPercentUsed":31.09,"apiPercentUsed":15.81}}        | total                               ######--------------  31% ↻ 17d6h / api                                 ###-----------------  16% ↻ 17d6h |
      | {"planUsage":{"totalPercentUsed":0,"autoPercentUsed":"32","apiPercentUsed":-1}}                         | total                               --------------------   0%                                                                                        |
      | {"billingCycleEnd":1790786706000,"planUsage":{"totalPercentUsed":130}}                                  | total                               #################### 130%                                                                                        |
      | {"billingCycleEnd":"soon","planUsage":{"autoPercentUsed":32.5}}                                         | auto                                #######-------------  33%                                                                                        |

  Scenario Outline: Plan label variations
    Given GetPlanInfo <answer>
    When the user runs `npm start` with NO_COLOR set
    Then the cursor panel still shows the three rows of the first scenario and the caption "<caption>"

    Examples:
      | answer                                                         | caption                  |
      | answers {"planInfo":{"planName":"Pro"}}                        | Pro · cursor             |
      | answers {"planInfo":{"planName":"Pro","price":""}}             | Pro · cursor             |
      | answers {"planInfo":{"price":"$200/mo"}}                       | cursor · cursor          |
      | answers {}                                                     | cursor · cursor          |
      | answers "not json"                                             | cursor · cursor          |
      | answers HTTP 500                                               | cursor · cursor          |
      | never answers                                                  | cursor · cursor          |

  Scenario Outline: Cursor failures render a dim unavailable panel and keep the others
    Given <condition>
    When the user runs `npm start` under an outer timeout of 60 seconds
    Then the process exits with code 0 <timing>
    And the cursor probe reports status "unavailable"
    And the cursor panel is dim, shows no gauge, and shows the reason "<reason>" and the caption "cursor · cursor"
    And the claude, agy, kimi, grok, codex and kilo panels still render normally, in order around it
    And "qa-dummy-cursor-token-006" appears nowhere in stdout or stderr

    Examples:
      | condition                                                                        | reason                                       | timing                 |
      | ALLOWANCE_CURSOR_AUTH_FILE names a path that does not exist, and no request is made | no cursor auth — run cursor-agent login   | within 5 seconds       |
      | the auth file is empty, and no request is made                                   | no cursor auth — run cursor-agent login      | within 5 seconds       |
      | the auth file holds "not json", and no request is made                           | no cursor auth — run cursor-agent login      | within 5 seconds       |
      | the auth file holds {"refreshToken":"r"}, and no request is made                 | no cursor auth — run cursor-agent login      | within 5 seconds       |
      | the auth file holds {"accessToken":""}, and no request is made                   | no cursor auth — run cursor-agent login      | within 5 seconds       |
      | the auth file holds {"accessToken":42}, and no request is made                   | no cursor auth — run cursor-agent login      | within 5 seconds       |
      | the auth file is not readable (mode 000), and no request is made                 | no cursor auth — run cursor-agent login      | within 5 seconds       |
      | the auth file path is a directory, and no request is made                        | no cursor auth — run cursor-agent login      | within 5 seconds       |
      | GetCurrentPeriodUsage answers HTTP 401 with the body {"error":"bad token qa-dummy-cursor-token-006"} | cursor usage request failed: HTTP 401 | within 5 seconds |
      | GetCurrentPeriodUsage answers HTTP 500                                           | cursor usage request failed: HTTP 500        | within 5 seconds       |
      | nothing listens on the fixture port                                              | cursor usage request failed                  | within 5 seconds       |
      | GetCurrentPeriodUsage never answers                                              | cursor usage request timed out after 15s     | after 15 to 25 seconds |
      | GetCurrentPeriodUsage answers "not json"                                         | Could not parse usage from response          | within 5 seconds       |
      | GetCurrentPeriodUsage answers {"planUsage":null}                                 | Could not parse usage from response          | within 5 seconds       |
      | GetCurrentPeriodUsage answers {"planUsage":{"totalPercentUsed":"31"}}            | Could not parse usage from response          | within 5 seconds       |

  Scenario Outline: Auth file and API base defaults
    Given ALLOWANCE_CURSOR_AUTH_FILE is <auth> and HOME is a directory whose ".config/cursor/auth.json" holds {"accessToken":"home-token"}
    And ALLOWANCE_CURSOR_API_BASE is <base>
    When the cursor probe runs with a recording fetcher that answers both calls as in the Background
    Then the fetcher received POSTs to "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage" and "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo" with "Authorization: Bearer home-token"
    And the probe reports status "ok" with the plan label "Ultra · $200/mo"

    Examples:
      | auth      | base      |
      | unset     | unset     |
      | set to "" | set to "" |

  Scenario: The app never writes the token anywhere
    When the user runs `npm start` against the Background fixture
    Then the auth file is byte-for-byte unchanged
    And no file created or modified under the repo, the temp dir or HOME during the run contains "qa-dummy-cursor-token-006"

  Scenario: No CLI on the PATH at all
    Given the PATH is an empty temp dir plus node's bin, ALLOWANCE_GROK_HOME is an empty directory, and ALLOWANCE_CURSOR_AUTH_FILE names a missing file
    When the user runs `npm start`
    Then the process exits with code 0
    And seven dim panels render in order, each probe reporting status "unavailable":
      | name   | reason                                   | caption              |
      | claude | claude CLI not found in PATH             | claude code · claude |
      | agy    | agy CLI not found in PATH                | agy · agy            |
      | kimi   | kimi CLI not found in PATH               | kimi code · kimi     |
      | grok   | no grok billing snapshot — run grok once | grok · grok          |
      | codex  | codex CLI not found in PATH              | codex · codex        |
      | cursor | no cursor auth — run cursor-agent login  | cursor · cursor      |
      | kilo   | kilo CLI not found in PATH               | api balance · kilo   |

  Scenario: README documents cursor
    When I read "README.md"
    Then the intro sentence names `claude`, `agy`, `kimi`, `grok`, `codex` and `cursor` as the subscription usage windows and `kilo` as the API balance
    And the provider list names `cursor` between `codex` and `kilo`, says it reads the token from the cursor-agent auth file without running cursor-agent, and POSTs to the dashboard API's `GetCurrentPeriodUsage` and `GetPlanInfo` (15s timeout each) to show the total, auto and api windows with a reset countdown
    And it says "All seven probes run in parallel" and no longer says "All six probes run in parallel"
    And the env-var ledger lists `ALLOWANCE_CURSOR_AUTH_FILE` with default `~/.config/cursor/auth.json` and `ALLOWANCE_CURSOR_API_BASE` with default `https://api2.cursor.sh`

  Scenario: Earlier end-to-end checks keep passing
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, including the 001 to 005 e2es and the new "qa/006-cursor.e2e.mjs"
    And every e2e other than 006 sets ALLOWANCE_CURSOR_AUTH_FILE to a missing file in its temp dir, so no e2e sends a real cursor token anywhere
    And "qa/006-cursor.e2e.mjs" creates its temp dirs with the prefix "allowance-qa-006-", starts a node:http fixture on 127.0.0.1 port 0 serving the two Background bodies with billingCycleEnd set to 3 days after the run starts, and runs `npm start` twice with PATH set to only its fixture dir and node's bin, NO_COLOR set, ALLOWANCE_CURSOR_API_BASE set to the fixture, and an outer spawn timeout
    And in the first run the auth file holds the Background token, and it asserts exit code 0, the cursor panel between "codex" and "kilo", a "total" row with "31%" and "↻ ", the caption "Ultra · $200/mo · cursor", the two POSTs of "The fixture receives exactly the two authorised POSTs", and no token in stdout or stderr
    And in the second run ALLOWANCE_CURSOR_AUTH_FILE names a missing file, and it asserts exit code 0, the lines "cursor", "no cursor auth — run cursor-agent login", "cursor · cursor" in a row, and that the fixture received no request
    And it closes the fixture server and removes its temp dirs
    And package.json still has no "dependencies" section
