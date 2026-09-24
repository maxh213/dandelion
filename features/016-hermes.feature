Feature: 016 - Hermes credits from the Nous Portal, routed as x-ai/grok-4.6 xhigh

  Assumptions (the task is silent here):
  - Env names are DANDELION_HERMES_AUTH_FILE (default "~/.hermes/auth.json" when unset or empty) and
    DANDELION_HERMES_PORTAL_BASE (default "https://portal.nousresearch.com" when unset or empty). The file's
    portal_base_url and active_provider are ignored. Extra fields in both JSON documents are ignored.
  - Token = providers.nous.agent_key when it is a non-empty string, with expiry agent_key_expires_at; otherwise
    providers.nous.access_token with expires_at. An expired agent_key does not fall back to access_token.
  - Expiry is a valid instant (same rule as grok ts). Expired means Date.parse(expiry) <= Date.parse(now),
    including equal. Missing or unparseable expiry is expired. No request is made when there is no token or it
    is expired.
  - monthly_credits must be a finite number > 0 and credits_remaining a finite number >= 0, else parse failure.
    usedPct = clamp(Math.round(100 - 100 * credits_remaining / monthly_credits), 0, 100). resetsAt is
    subscription.current_period_end when it is a valid instant, else the row has no countdown.
  - Plan name is subscription.plan when it is a non-empty string, else the plan label is "hermes" (no "$x of $y").
    Remaining is shown with two fraction digits ($5.5 -> $5.50); monthly_credits is shown as the number ($22).
    paid_service_access.paid_access is exactly false to put " · no paid access" at the end of the caption line.
  - The task's "grok-4.6 grok" predates commit a81d626; grok prints "grok-4.6 xhigh grok". Hermes prints
    "x-ai/grok-4.6 xhigh hermes". GET uses the injected Fetcher.get with a 15s timeout.
  - "hermes U%" below means an account JSON whose subscription has monthly_credits 22, credits_remaining
    22 - 0.22 * U (75% uses 5.5, 85% uses 3.3, 60% uses 8.8, 0% uses 22) and current_period_end three days
    after now, unless a scenario sets the end.

  Background:
    Given the current time is "2026-09-18T19:00:00Z"
    And every other provider is set up as in features/015-junie.feature, unavailable unless listed
    And DANDELION_HERMES_AUTH_FILE is a file holding:
      """
      {"version":1,"providers":{"nous":{"access_token":"qa-dummy-hermes-access-016","refresh_token":"r",
        "client_id":"hermes-cli","portal_base_url":"https://portal.nousresearch.com","agent_key":
        "qa-dummy-hermes-agent-key-016","agent_key_expires_at":"2026-09-19T19:00:00+00:00",
        "expires_at":"2026-09-19T19:00:00+00:00"}},"active_provider":"nous"}
      """
    And DANDELION_HERMES_PORTAL_BASE is "http://127.0.0.1:<port>" of a local HTTP fixture that answers GET
      "/api/oauth/account" with the verified portal payload, except monthly_credits 22, credits_remaining 5.5,
      current_period_end "2026-09-21T19:00:00.000Z", plan "Plus" and paid_access true

  Scenario: Hermes panel shows credits between junie and kilo
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the process exits with code 0
    And the panels appear in the order "claude", "claude-work", "agy", "kimi", "grok", "codex", "cursor",
      "junie", "hermes", "kilo"
    And the hermes panel is exactly: rule, "hermes", then
      """
      credits                             ###############-----  75% ↻ 3d0h
      Plus · $5.50 of $22 · hermes
      """
    And the other panels are unchanged, and every line is at most 72 columns wide

  Scenario: The fixture receives exactly one authorised GET
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the fixture received exactly one GET to "/api/oauth/account" and no POST
    And it carried "Authorization: Bearer qa-dummy-hermes-agent-key-016" and "Accept: application/json"
    And "qa-dummy-hermes-agent-key-016" and "qa-dummy-hermes-access-016" appear nowhere in stdout or stderr

  Scenario: Hermes colours
    When the user runs `npm start -- --once` without NO_COLOR
    Then the hermes gauge and "75%" carry the warm escape, and the caption is dim

  Scenario Outline: Token selection
    Given the auth file's nous provider is <nous>
    When the user runs `npm start -- --once` with a recording fetcher
    Then the probe <result>

    Examples:
      | nous                                                                                         | result                                                                 |
      | agent_key "qa-dummy-hermes-agent-key-016" and access_token "qa-dummy-hermes-access-016"       | GETs with Bearer qa-dummy-hermes-agent-key-016                         |
      | no agent_key, access_token "qa-dummy-hermes-access-016"                                       | GETs with Bearer qa-dummy-hermes-access-016                            |
      | agent_key "", access_token "qa-dummy-hermes-access-016"                                       | GETs with Bearer qa-dummy-hermes-access-016                            |
      | agent_key expired at 2026-09-18T18:00:00+00:00, access_token still valid                     | unavailable "hermes token expired — run hermes once", and no request   |
      | both expiries "2026-09-18T19:00:00+00:00"                                                    | unavailable "hermes token expired — run hermes once", and no request   |

  Scenario Outline: Account body variations
    Given the fixture answers <body>
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the hermes panel is ok and its lines under the name are exactly "<lines>"

    Examples:
      | body                                                                                          | lines                                                                                          |
      | credits_remaining 22.472091793333334                                                          | credits                             --------------------   0% ↻ 3d0h / Plus · $22.47 of $22 · hermes |
      | credits_remaining 0                                                                           | credits                             #################### 100% ↻ 3d0h / Plus · $0.00 of $22 · hermes |
      | credits_remaining 11                                                                          | credits                             ##########----------  50% ↻ 3d0h / Plus · $11.00 of $22 · hermes |
      | credits_remaining 3.3                                                                         | credits                             #################---  85% ↻ 3d0h / Plus · $3.30 of $22 · hermes |
      | no plan, or plan ""                                                                           | credits                             ###############-----  75% ↻ 3d0h / hermes · hermes              |
      | paid_access false                                                                             | credits                             ###############-----  75% ↻ 3d0h / Plus · $5.50 of $22 · hermes · no paid access |
      | no plan and paid_access false                                                                 | credits                             ###############-----  75% ↻ 3d0h / hermes · hermes · no paid access |
      | no current_period_end, or "soon"                                                              | credits                             ###############-----  75% / Plus · $5.50 of $22 · hermes        |

  Scenario Outline: Hermes failures render a dim unavailable panel and keep the others
    Given <condition>
    When the user runs `npm start -- --once` under an outer timeout of 60 seconds
    Then the process exits with code 0 <timing>
    And the hermes panel is dim, shows no gauge, and reads "hermes", "<reason>", "hermes · hermes"
    And the other panels render normally in order around it
    And neither dummy token appears in stdout, stderr or the reason

    Examples:
      | condition                                                                          | reason                                              | timing                 |
      | DANDELION_HERMES_AUTH_FILE names a path that does not exist                        | no hermes auth — run hermes portal login            | within 5 seconds       |
      | the auth file is empty, "not json", {"providers":{}}, or {"providers":{"nous":{}}} | no hermes auth — run hermes portal login            | within 5 seconds       |
      | both tokens are "" or missing, and no request is made                              | no hermes auth — run hermes portal login            | within 5 seconds       |
      | the auth file is not readable (mode 000), or the path is a directory               | no hermes auth — run hermes portal login            | within 5 seconds       |
      | both expiries are 2026-09-17T19:00:00+00:00, and no request is made                | hermes token expired — run hermes once              | within 5 seconds       |
      | the fixture answers HTTP 401 with body {"error":"bad token qa-dummy-hermes-agent-key-016"} | hermes account request failed: HTTP 401     | within 5 seconds       |
      | the fixture answers HTTP 500                                                       | hermes account request failed: HTTP 500             | within 5 seconds       |
      | nothing listens on the fixture port                                                | hermes account request failed                       | within 5 seconds       |
      | the fixture never answers                                                          | hermes account request timed out after 15s          | after 15 to 25 seconds |
      | the fixture answers "not json", {}, or {"subscription":{"monthly_credits":22}}     | Could not parse usage from response                 | within 5 seconds       |
      | monthly_credits 0, or credits_remaining -1 or "5.5"                                | Could not parse usage from response                 | within 5 seconds       |

  Scenario Outline: Auth file and portal base defaults
    Given DANDELION_HERMES_AUTH_FILE is <auth> and HOME is a directory whose ".hermes/auth.json" holds the Background JSON with agent_key "home-hermes-agent-key"
    And DANDELION_HERMES_PORTAL_BASE is <base>
    When the hermes probe runs with a recording fetcher that answers as in the Background
    Then the fetcher received GET "https://portal.nousresearch.com/api/oauth/account" with "Authorization: Bearer home-hermes-agent-key" and "Accept: application/json"
    And the probe reports status "ok" with the plan label "Plus · $5.50 of $22"

    Examples:
      | auth      | base      |
      | unset     | unset     |
      | set to "" | set to "" |

  Scenario: The app never writes either token
    When the user runs `npm start -- --once` against the Background fixture
    Then the auth file is byte-for-byte unchanged
    And no file created or modified under the repo, the temp dir or HOME during the run contains either dummy token

  Scenario: Live dashboard toggles hermes like any routable panel
    Given DANDELION_STATE_FILE names a missing file in a temp dir
    When the user runs `npm start` in a terminal, selects the hermes panel and presses space
    Then the hermes panel shows "routing off" and the state file holds {"hermes": false}
    When the auth file is missing and the user selects hermes and presses space
    Then the hermes caption line reads "not routable (no usage windows)" for 2 seconds and the state file is not written

  Scenario: Fleet summary counts hermes credits and takes its reset
    Given no other provider reports a usage window (kilo's balance does not count)
    When credits_remaining is 3.3 and the user runs `npm start` in a terminal with NO_COLOR set
    Then the hermes panel shows "credits" at 85%
    And the fleet summary line reads exactly "1/1 windows above 80% · next reset: hermes credits in 3d0h"
    When credits_remaining is 5.5 and the user runs `npm start` again
    Then the fleet summary line reads exactly "all windows below 80% · next reset: hermes credits in 3d0h"

  Scenario Outline: route with hermes
    Given the usages <usages>, junie <junie>, hermes <hermes> and the state file <state>
    When the user runs `node src/main.ts route`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is <code>

    Examples:
      | usages     | junie | hermes      | state              | line                          | code |
      | none       | none  | 75%         | missing            | x-ai/grok-4.6 xhigh hermes    | 0    |
      | none       | none  | 0%          | missing            | x-ai/grok-4.6 xhigh hermes    | 0    |
      | none       | none  | 100%        | missing            | x-ai/grok-4.6 xhigh hermes    | 0    |
      | grok 50@72 | none  | 75%         | missing            | grok-4.6 xhigh grok           | 0    |
      | grok 0@72  | none  | 0%          | missing            | grok-4.6 xhigh grok           | 0    |
      | none       | 0%    | 0%          | missing            | gemini-3.8-flash high junie   | 0    |
      | none       | none  | 75%         | {"hermes": false}  | none                          | 1    |
      | none       | none  | unavailable | missing            | none                          | 1    |

  Scenario: The 014 live case with junie and hermes
    Given the usages of "The live case that prompted the task" in features/014-route-session-trip.feature
    When junie is 30%, hermes is 75% and the user runs `node src/main.ts route`
    Then stdout is exactly "grok-4.6 xhigh grok" and a newline, exit 0 (grok 91 left beats junie 70 and hermes 25)
    When hermes is 0% instead, junie still 30%
    Then stdout is exactly "x-ai/grok-4.6 xhigh hermes" and a newline, exit 0
    When hermes is 0% and junie is 0%
    Then stdout is exactly "gemini-3.8-flash high junie" and a newline, exit 0 (tie, junie is earlier)
    When hermes is 60% with current_period_end one hour from now and before local midnight, junie 30%
    Then stdout is exactly "x-ai/grok-4.6 xhigh hermes" and a newline, exit 0 (rule 1; hermes never trips)
    When hermes is 0%, junie 30%, and the state file holds {"hermes": false}
    Then stdout is exactly "grok-4.6 xhigh grok" and a newline, exit 0
    When hermes is 0% and the user runs `node src/main.ts route --high`
    Then stdout is exactly "claude-fable-5-1 max claude" and a newline, exit 0

  Scenario: route --high never uses hermes
    Given only hermes is available, at 0%
    When the user runs `node src/main.ts route --high`
    Then stdout is exactly "none" and a newline, stderr is empty and the exit code is 1

  Scenario: Nothing else changes
    Then every row of the 010 to 015 features prints the line and exit code it did before, `route --high` is
      unchanged, kilo is never routed and codex still has no windows, and package.json still has no "dependencies"
      section
    And the dashboard's route boxes show the same lines `route` and `route --high` print, hermes included
    And the nine earlier probes, their panel order, the injection seams and the 011 state file are unchanged

  Scenario: README documents hermes
    When I read "README.md"
    Then the intro and the provider list name `hermes` between `junie` and `kilo`, saying it reads the Nous Portal
      tokens from the hermes auth file without running hermes, GETs `/api/oauth/account` (15s timeout) for the
      credits window with a reset countdown and remaining versus the monthly grant, never prints the tokens, says
      to run `hermes portal login` without auth and `hermes once` when the token is expired
    And it says "All ten probes run in parallel"
    And the ledger lists `DANDELION_HERMES_AUTH_FILE` (default `~/.hermes/auth.json`) and
      `DANDELION_HERMES_PORTAL_BASE` (default `https://portal.nousresearch.com`)
    And the Route section lists hermes among routed providers and `hermes credits` among weekly windows, the table
      has the row "| hermes | `x-ai/grok-4.6 xhigh` | `x-ai/grok-4.6 xhigh` |" after junie, and it says `--high`
      does not use hermes

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, the 001 to 015 e2es included, whether or not the tester has a real ~/.hermes/auth.json
    And every e2e other than 016 sets DANDELION_HERMES_AUTH_FILE to a missing file in its temp dir, so no e2e
      sends a real hermes token anywhere
    And no e2e runs a real hermes binary or reaches portal.nousresearch.com, and every temp dir is removed
