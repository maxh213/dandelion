Feature: 009 - Rename the project to dandelion

  A rename only. Probe commands, parsing, window math, gauges, panel order, live mode, captions, reasons and exit codes are those of 001 to 008,
  except for these names, which replace the old ones everywhere they appear, including in the 001 to 008 scenarios:
    | old                               | new                               |
    | ALLOWANCE (banner wordmark)       | DANDELION                         |
    | ALLOWANCE_KILO_REFERENCE          | DANDELION_KILO_REFERENCE          |
    | ALLOWANCE_KIMI_PORT               | DANDELION_KIMI_PORT               |
    | ALLOWANCE_GROK_HOME               | DANDELION_GROK_HOME               |
    | ALLOWANCE_CURSOR_AUTH_FILE        | DANDELION_CURSOR_AUTH_FILE        |
    | ALLOWANCE_CURSOR_API_BASE         | DANDELION_CURSOR_API_BASE         |
    | ALLOWANCE_REFRESH_SECONDS         | DANDELION_REFRESH_SECONDS         |
    | ALLOWANCE_CLAUDE_WORK_CONFIG_DIR  | DANDELION_CLAUDE_WORK_CONFIG_DIR  |
    | package name "allowance"          | "dandelion"                       |
    | temp dir prefix "allowance-"      | "dandelion-"                      |
    | codex clientInfo name "allowance" | "dandelion"                       |
  The old ALLOWANCE_* names are ignored, with no fallback and no warning.

  Background:
    Given the fixtures, grok home, cursor fixture and work config dir of features/008-claude-work.feature are in place
    And the current time is "2026-09-13T10:00:00Z"

  Scenario: The banner says DANDELION
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the process exits with code 0
    And the first line starts with "DANDELION" and ends with "10:00:00Z", laid out exactly as the 001 banner
    And the panels are those of the 008 first scenario, in the order claude, claude-work, agy, kimi, grok, codex, cursor, kilo
    And every line is at most 72 columns wide
    And the output contains no "ALLOWANCE" and no "allowance"

  Scenario: Live mode says DANDELION
    When the user runs `npm start` on a terminal with NO_COLOR set
    Then once every probe has settled the frame begins with the lines
      """
      DANDELION                                      data 0h0m old · 10:00:00Z
      2/16 windows above 80% · next reset: claude session in 8h40m
      """
    And pressing "q" restores the terminal and the process exits with code 0

  Scenario: node src/main.ts still works
    When the user runs `node src/main.ts --once` from the repo root
    Then the process exits with code 0 and prints the same dashboard as `npm start -- --once`

  Scenario: The dandelion command runs the dashboard
    Given package.json has "name" "dandelion", "bin" { "dandelion": "src/main.ts" } and still no "dependencies"
    And src/main.ts starts with the line "#!/usr/bin/env node" and is executable
    And "<tmp>/bin/dandelion" is a symlink to src/main.ts, as `npm link` creates
    When the user runs `dandelion --once` with "<tmp>/bin" first on the PATH
    Then the process exits with code 0 and prints the same dashboard as `npm start -- --once`
    And running src/main.ts directly as `./src/main.ts --once` does the same

  Scenario Outline: Every env var works under its new name
    Given <new> is set to <value>
    When the user runs `npm start -- --once` with NO_COLOR set
    Then <effect>

    Examples:
      | new                              | value                    | effect                                                                                        |
      | DANDELION_KILO_REFERENCE         | "10" with balance $5.00  | the kilo gauge has 10 filled cells and 10 empty cells                                         |
      | DANDELION_KIMI_PORT              | "abc"                    | `kimi` is not started and the kimi reason is "DANDELION_KIMI_PORT must be an integer from 1 to 65535" |
      | DANDELION_GROK_HOME              | an empty directory       | the grok reason is "no grok billing snapshot — run grok once"                                 |
      | DANDELION_CURSOR_AUTH_FILE       | a missing file           | the cursor reason is "no cursor auth — run cursor-agent login"                                |
      | DANDELION_CURSOR_API_BASE        | the cursor fixture's URL | the cursor panel shows the 006 windows                                                        |
      | DANDELION_CLAUDE_WORK_CONFIG_DIR | "<tmp>/no-such-dir"      | the claude-work reason is "no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude" |

  Scenario: Live refresh reads DANDELION_REFRESH_SECONDS
    Given DANDELION_REFRESH_SECONDS is "1"
    When the user runs `npm start` on a terminal and waits for two rounds
    Then the probes run again about 1 second after the first round settles, as in the 007 scenario with the old name

  Scenario Outline: Old ALLOWANCE_* names are ignored
    Given the DANDELION_* names are unset, HOME is "<tmp>/home" with no ".claude-work", and <old> is set to <value>
    When the user runs `npm start -- --once` with NO_COLOR set
    Then <effect>

    Examples:
      | old                              | value                   | effect                                                                    |
      | ALLOWANCE_KILO_REFERENCE         | "10" with balance $5.00 | the kilo gauge has 5 filled cells and 15 empty cells (default reference 20) |
      | ALLOWANCE_KIMI_PORT              | "abc"                   | the kimi panel does not show the reason "ALLOWANCE_KIMI_PORT must be an integer from 1 to 65535" |
      | ALLOWANCE_CLAUDE_WORK_CONFIG_DIR | an existing directory   | the claude-work panel is dim with the "no work claude config — …" reason  |

  Scenario: README uses the new name
    When I read "README.md"
    Then its title is "# Dandelion Dashboard" and its first paragraph starts "Dandelion is a terminal dashboard"
    And the run commands list `dandelion` (after `npm link`) next to `npm start` and `npm start -- --once`, with `dandelion --once` running once
    And the env-var ledger lists the seven DANDELION_* names with the same defaults and descriptions as before
    And README.md contains no "ALLOWANCE" and no "Allowance"

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes
    And the 001 to 008 e2es assert what they did before, with "DANDELION" for the banner, the DANDELION_* names in child envs, and "dandelion-qa-" temp dir prefixes
    And "qa/009-rename-dandelion.e2e.mjs" runs `npm start --silent -- --once` and `node src/main.ts --once` and a "<tmp>/bin/dandelion" symlink with `--once`,
      each exiting 0 with a first line starting "DANDELION", eight panels in order, and zero matches for "ALLOWANCE" in the output
    And it asserts package.json "name" is "dandelion", "bin" is { "dandelion": "src/main.ts" }, and the first line of src/main.ts is "#!/usr/bin/env node"
    And `git grep -n ALLOWANCE -- src qa perf README.md package.json package-lock.json` prints nothing
    And no e2e runs a real provider binary and every temp dir is removed
