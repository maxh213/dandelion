Feature: 017 - TypeScript practices pass with no user-visible change

  Assumptions (the task is silent here):
  - Source-only pass against guidance/ts.md. Probe results, panel order, captions, gauges, route lines,
    eligibility toggle, session-trip, README meaning, package.json scripts, the vitest runner, and the
    001-016 QA fixtures and e2es stay as 016 left them. No new runtime dependencies. kilo is never routed.
  - React (TS-27 to TS-39) and Next.js (TS-40 to TS-48) do not apply: this is a Node TUI. Grok still
    prints "grok-4.6 xhigh grok". "hermes U%" and dummy tokens are those of features/016-hermes.feature;
    "junie U%" is that of features/015-junie.feature. The 014 live case is the table in
    features/014-route-session-trip.feature at local time near 11:00. `dandelion` is a symlink to
    src/main.ts first on PATH, as `npm link` creates.

  Background:
    Given the current time is "2026-09-18T19:00:00Z"
    And the fixtures, HOME, TZ and DANDELION_* variables of features/016-hermes.feature are in place,
      with junie at 30% and hermes at 75%; codex is API-key ok and kilo reports "Balance: $14.15";
      every other provider is unavailable unless a scenario lists it

  Scenario: Once mode still prints the ten panels
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the process exits with code 0
    And the first line starts with "DANDELION" and ends with "19:00:00Z", laid out to column 72
    And the panels appear in the order "claude", "claude-work", "agy", "kimi", "grok", "codex",
      "cursor", "junie", "hermes", "kilo"
    And the junie panel's lines under the name are exactly
      """
      credits                             ######--------------  30%
      snapshot 6h6m old
      701513 credits · junie
      """
    And the hermes panel's lines under the name are exactly
      """
      credits                             ###############-----  75% ↻ 3d0h
      Plus · $5.50 of $22 · hermes
      """
    And the kilo panel shows "$14.15" then 14 "#" and 6 "-" and the caption "api balance · kilo"
    And every line is at most 72 columns wide
    And "qa-dummy-hermes-agent-key-016" and "qa-dummy-hermes-access-016" appear nowhere in stdout or stderr

  Scenario Outline: Dashboard entry points still print the once dashboard
    When the user runs `<command>` with NO_COLOR set and stdout not a TTY
    Then the process exits with code 0, stdout matches `npm start -- --once` from the same fixtures apart from
      the banner clock, and stdout contains no "\e[?1049h"

    Examples:
      | command                       |
      | npm start -- --once           |
      | node src/main.ts --once       |
      | dandelion --once              |
      | npm start                     |
      | node src/main.ts --once route |
      | node src/main.ts routes       |

  Scenario Outline: Route entry points still print one line
    Given the usages of "The live case that prompted the task" in features/014-route-session-trip.feature,
      with junie 30% and hermes 75%
    When the user runs `<command>`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is 0

    Examples:
      | command                       | line                          |
      | node src/main.ts route        | grok-4.6 xhigh grok           |
      | npm start -- route            | grok-4.6 xhigh grok           |
      | dandelion route               | grok-4.6 xhigh grok           |
      | node src/main.ts route --high | claude-fable-5-1 max claude   |
      | npm start -- route --high     | claude-fable-5-1 max claude   |
      | dandelion route --high        | claude-fable-5-1 max claude   |

  Scenario: Live mode still draws boxes, summary, keys and quit
    Given the usages of "The live case that prompted the task" in features/014-route-session-trip.feature,
      with junie 30% and hermes 75%, and DANDELION_STATE_FILE names a missing file in a temp dir
    When the user runs `npm start` on a terminal with NO_COLOR set and the first round has settled
    Then the frame's line 1 starts "DANDELION"
    And lines 3 to 6 are the 013 boxes, the left showing "grok-4.6 xhigh" over "grok" and the right
      showing "claude-fable-5-1 max" over "claude"
    And pressing "?" shows the footer "keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help"
    And the first "k" puts "▸" on kilo; space then makes kilo's caption "not routable (no usage windows)"
      for 2 to 3 seconds, after which it reads "api balance · kilo" and the state file is not written
    When the user presses "q", then runs `npm start` again and, from an unselected start, presses "j" then space
    Then claude's header shows "▸ claude" with "routing off" ending at column 72 and the file holds {"claude": false}
    And pressing "q" restores the terminal and the process exits with code 0

  Scenario: Live toggle and fleet summary still match 016
    Given no other provider reports a usage window (kilo's balance does not count)
    When credits_remaining is 3.3 and the user runs `npm start` in a terminal with NO_COLOR set
    Then the hermes panel shows "credits" at 85%
    And the fleet summary line reads exactly "1/1 windows above 80% · next reset: hermes credits in 3d0h"
    And the route boxes show "x-ai/grok-4.6 xhigh" over "hermes" and "none" over "no subscription available"
    When the user selects hermes (first "k" then "k") and presses space
    Then the hermes panel shows "routing off" and the state file holds {"hermes": false}
    And both boxes show "none" over "no subscription available"
    When the user quits, the auth file is missing, and the user runs `npm start` again, selects hermes and presses space
    Then the hermes caption line reads "not routable (no usage windows)" for 2 to 3 seconds and the state file is not written
    When credits_remaining is 5.5, the state file is missing, and the user runs `npm start` again
    Then the fleet summary line reads exactly "all windows below 80% · next reset: hermes credits in 3d0h"

  Scenario: An unwritable state file still flashes routing state not saved
    Given the 014 live case, junie 30% and hermes 75%, and DANDELION_STATE_FILE is "<tmp>/blocked/eligibility.json"
      whose parent path "<tmp>/blocked" is a file
    When the user runs `npm start` on a terminal, waits for every panel to settle, then presses "j" then space
    Then the claude caption line reads "routing state not saved" for 2 to 3 seconds, no header shows "routing off",
      the app keeps running, and no temp file is left next to that parent

  Scenario: Ten unavailable panels when nothing is installed
    Given PATH is node's bin only, HOME is an empty temp dir whose ".claude-work" exists,
      DANDELION_GROK_HOME and DANDELION_JUNIE_HOME are empty directories, and
      DANDELION_CURSOR_AUTH_FILE and DANDELION_HERMES_AUTH_FILE name missing files
    When the user runs `node src/main.ts --once`
    Then the process exits with code 0 within 5 seconds
    And ten dim panels render in order, each with no gauge:
      | name        | reason                                              | caption                     |
      | claude      | claude CLI not found in PATH                        | claude · personal · claude  |
      | claude-work | claude CLI not found in PATH                        | claude · work · claude-work |
      | agy         | agy CLI not found in PATH                           | agy · agy                   |
      | kimi        | kimi CLI not found in PATH                          | kimi code · kimi            |
      | grok        | no grok billing snapshot — run grok once            | grok · grok                 |
      | codex       | codex CLI not found in PATH                         | codex · codex               |
      | cursor      | no cursor auth — run cursor-agent login             | cursor · cursor             |
      | junie       | no junie quota snapshot — run junie once            | junie · junie               |
      | hermes      | no hermes auth — run hermes portal login            | hermes · hermes             |
      | kilo        | kilo CLI not found in PATH                          | api balance · kilo          |

  Scenario Outline: Other user-visible failures still print the same reason
    Given <condition>
    When the user runs `npm start -- --once` under an outer timeout of 120 seconds
    Then the process exits with code 0 <timing>
    And the <id> panel is dim, shows no gauge, and reads "<id>", "<reason>", "<caption>"
    And the other panels still render in order around it

    Examples:
      | condition                                                         | id          | reason                                                         | caption                     | timing                 |
      | claude hangs indefinitely                                         | claude      | Command timed out after 90s                                    | claude · personal · claude  | after 90 to 100 seconds |
      | claude exits 1                                                    | claude      | Command failed or timed out                                    | claude · personal · claude  | within 5 seconds       |
      | claude prints only "Current session: 3% used"                     | claude      | Could not parse usage from output                              | claude · personal · claude  | within 5 seconds       |
      | work config dir is missing                                        | claude-work | no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude | claude · work · claude-work | within 5 seconds |
      | agy hangs indefinitely                                            | agy         | Command timed out after 60s                                    | agy · agy                   | after 60 to 70 seconds |
      | agy prints nothing                                                | agy         | Could not parse usage from output                              | agy · agy                   | within 5 seconds       |
      | kimi exits without a token                                        | kimi        | kimi web exited without printing a token                       | kimi code · kimi            | within 5 seconds       |
      | kimi never prints a token                                         | kimi        | kimi web printed no token within 20s                           | kimi code · kimi            | after 20 to 30 seconds |
      | kimi answers HTTP 500                                             | kimi        | kimi usage request failed: HTTP 500                            | kimi code · kimi            | within 5 seconds       |
      | kimi never answers                                                | kimi        | kimi usage request timed out after 10s                         | kimi code · kimi            | after 10 to 20 seconds |
      | kimi answers {"data":{"summary":null}}                            | kimi        | Could not parse usage from response                            | kimi code · kimi            | within 5 seconds       |
      | DANDELION_KIMI_PORT is "abc"                                      | kimi        | DANDELION_KIMI_PORT must be an integer from 1 to 65535         | kimi code · kimi            | within 5 seconds       |
      | kilo profile has no Balance line                                  | kilo        | Could not parse balance from output                            | api balance · kilo          | within 5 seconds       |
      | kilo hangs indefinitely                                           | kilo        | Command timed out after 20s                                    | api balance · kilo          | after 20 to 25 seconds |
      | codex login status exits 1                                        | codex       | codex is not logged in                                         | codex · codex               | within 5 seconds       |
      | codex login status hangs                                          | codex       | Command timed out after 15s                                    | codex · codex               | after 15 to 25 seconds |
      | cursor fixture answers HTTP 401                                   | cursor      | cursor usage request failed: HTTP 401                          | cursor · cursor             | within 5 seconds       |
      | cursor fixture never answers                                      | cursor      | cursor usage request timed out after 15s                       | cursor · cursor             | after 15 to 25 seconds |
      | hermes token expired, and no request is made                      | hermes      | hermes token expired — run hermes once                         | hermes · hermes             | within 5 seconds       |
      | hermes fixture answers HTTP 401                                   | hermes      | hermes account request failed: HTTP 401                        | hermes · hermes             | within 5 seconds       |
      | hermes fixture never answers                                      | hermes      | hermes account request timed out after 15s                     | hermes · hermes             | after 15 to 25 seconds |
      | hermes fixture answers HTTP 500                                   | hermes      | hermes account request failed: HTTP 500                        | hermes · hermes             | within 5 seconds       |
      | nothing listens on the hermes fixture port                        | hermes      | hermes account request failed                                  | hermes · hermes             | within 5 seconds       |
      | hermes fixture answers "not json"                                 | hermes      | Could not parse usage from response                            | hermes · hermes             | within 5 seconds       |
      | kimi prints a token but nothing listens on the port               | kimi        | kimi usage request failed                                      | kimi code · kimi            | within 5 seconds       |
      | cursor fixture answers HTTP 500                                   | cursor      | cursor usage request failed: HTTP 500                          | cursor · cursor             | within 5 seconds       |
      | nothing listens on the cursor fixture port                        | cursor      | cursor usage request failed                                    | cursor · cursor             | within 5 seconds       |
      | cursor fixture answers "not json"                                 | cursor      | Could not parse usage from response                            | cursor · cursor             | within 5 seconds       |
      | codex ChatGPT answers id 2 with message "chatgpt authentication required to read rate limits" | codex | chatgpt authentication required to read rate limits | codex · codex | within 5 seconds |
      | codex ChatGPT answers id 2 with {"error":{"code":-32600},"id":2}  | codex       | codex app-server error                                         | codex · codex               | within 5 seconds       |
      | codex ChatGPT never answers id 2                                  | codex       | codex app-server did not answer within 30s                     | codex · codex               | after 30 to 40 seconds |
      | codex ChatGPT app-server exits without output                     | codex       | codex app-server exited without answering                      | codex · codex               | within 5 seconds       |
      | codex ChatGPT answers id 2 with empty rateLimits                  | codex       | Could not parse rate limits from response                      | codex · codex               | within 5 seconds       |

  Scenario Outline: route and route --high still print the 016 lines
    Given the usages <usages>, junie <junie>, hermes <hermes> and the state file <state>
    When the user runs `node src/main.ts <args>`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is <code>

    Examples:
      | args         | usages     | junie | hermes      | state             | line                          | code |
      | route        | none       | none  | 75%         | missing           | x-ai/grok-4.6 xhigh hermes    | 0    |
      | route        | none       | none  | 0%          | missing           | x-ai/grok-4.6 xhigh hermes    | 0    |
      | route        | none       | none  | 100%        | missing           | x-ai/grok-4.6 xhigh hermes    | 0    |
      | route        | grok 50@72 | none  | 75%         | missing           | grok-4.6 xhigh grok           | 0    |
      | route        | none       | 0%    | 0%          | missing           | gemini-3.8-flash high junie   | 0    |
      | route        | none       | none  | 75%         | {"hermes": false} | none                          | 1    |
      | route        | none       | none  | unavailable | missing           | none                          | 1    |
      | route --high | none       | none  | 0%          | missing           | none                          | 1    |
      | route        | none       | none  | none        | missing           | none                          | 1    |

  Scenario: The 014 live case with junie and hermes is unchanged
    Given the usages of "The live case that prompted the task" in features/014-route-session-trip.feature
    When junie is 30%, hermes is 75% and the user runs `node src/main.ts route`
    Then stdout is exactly "grok-4.6 xhigh grok" and a newline, exit 0
    When hermes is 0% instead, junie still 30%
    Then stdout is exactly "x-ai/grok-4.6 xhigh hermes" and a newline, exit 0
    When hermes is 0% and junie is 0%
    Then stdout is exactly "gemini-3.8-flash high junie" and a newline, exit 0
    When hermes is 60% with current_period_end one hour from now and before local midnight, junie 30%
    Then stdout is exactly "x-ai/grok-4.6 xhigh hermes" and a newline, exit 0
    When hermes is 0%, junie 30%, and the state file holds {"hermes": false}
    Then stdout is exactly "grok-4.6 xhigh grok" and a newline, exit 0
    When hermes is 0% and the user runs `node src/main.ts route --high`
    Then stdout is exactly "claude-fable-5-1 max claude" and a newline, exit 0

  Scenario: The 013 boxes still match the CLI
    Given the 013 fixture of features/013-route-boxes.feature (junie and hermes unavailable)
    When the user runs `node src/main.ts` on a terminal with NO_COLOR set and the first round has settled
    Then lines 3 to 6 are exactly
      """
      +- route -------------------------+  +- route --high ------------------+
      | claude-opus-5 high              |  | claude-fable-5-1 max            |
      | claude-work                     |  | claude-work                     |
      +---------------------------------+  +---------------------------------+
      """
    When the user runs `node src/main.ts route` and `node src/main.ts route --high` against the same fixture
    Then they print "claude-opus-5 high claude-work" and "claude-fable-5-1 max claude-work", each with exit 0

  Scenario: README meaning and package.json scripts are unchanged
    When I read "README.md" and "package.json"
    Then README still starts "# Dandelion Dashboard" / "Dandelion is a terminal dashboard"
    And it still says "All ten probes run in parallel" and lists hermes between junie and kilo
    And the Route table still has the 016 rows, kilo is never routed, and `--high` does not use junie or hermes
    And package.json "name" is "dandelion", "bin" is { "dandelion": "src/main.ts" }, there is no "dependencies"
      section, and "scripts" is still { "start": "node src/main.ts", "test": "vitest run", "qa": "node qa/e2e.mjs" }

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e from 001 to 016 still PASSes, whether or not the tester has a real ~/.junie or ~/.hermes/auth.json
    And the 001-016 e2e files and their fixtures are byte-for-byte unchanged
    And no e2e reaches portal.nousresearch.com or api2.cursor.sh, and every temp dir is removed
