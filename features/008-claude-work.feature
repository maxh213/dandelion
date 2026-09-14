Feature: 008 - Work claude account as its own panel

  Row layout, gauge math, ramp colours, captions ("<plan label> · <id>"), NO_COLOR and live-mode rules are those of 002 to 007.
  Panel order is now: claude, claude-work, agy, kimi, grok, codex, cursor, kilo.
  The claude plan label is now "claude · personal"; the claude-work plan label is "claude · work".
  Work config dir = ALLOWANCE_CLAUDE_WORK_CONFIG_DIR, or "<home>/.claude-work" when it is unset or empty.
  When that path is a directory, the claude-work probe runs `claude -p "/usage"` (90s timeout) with CLAUDE_CONFIG_DIR set to it,
  and reads the output exactly as the claude probe does. Otherwise it runs nothing and is unavailable with the reason
  "no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude" (always this literal text, 75 cells, unwrapped).
  The claude probe is unchanged: same command, and its environment is the app's own, with no CLAUDE_CONFIG_DIR override.
  The 008 "No CLI on the PATH at all" replaces the 006 one.

  Background:
    Given the fixtures, grok home and cursor fixture of features/006-cursor.feature are in place, with CODEX_FIXTURE_MODE "apikey"
    And the current time is "2026-09-13T10:00:00Z" and CLAUDE_CONFIG_DIR is unset in the app's environment
    And ALLOWANCE_CLAUDE_WORK_CONFIG_DIR is an existing empty directory "<tmp>/claude-work"
    And the `claude` fixture appends CLAUDE_CONFIG_DIR, or "-" when it is unset or empty, as one line to "claude.calls", then prints
      the 002 transcript when CLAUDE_CONFIG_DIR is unset or empty, and otherwise prints:
      """
      Current session: 0% used · resets Sep 13, 11:10pm (Europe/London)
      Current week (all models): 12% used · resets Sep 15, 6pm (Europe/London)
      Current week (Fable): 23% used · resets Sep 15, 6pm (Europe/London)
      """

  Scenario: Both claude accounts render as separate panels
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the process exits with code 0
    And the panels appear in the order "claude", "claude-work", "agy", "kimi", "grok", "codex", "cursor", "kilo"
    And the claude panel shows the 002 rows (weekly "86%") and ends with the caption "claude · personal · claude"
    And the claude-work panel is exactly: rule, "claude-work", then
      """
      session                             --------------------   0% ↻ 12h10m
      weekly                              ##------------------  12% ↻ 2d7h
      weekly Fable                        #####---------------  23% ↻ 2d7h
      claude · work · claude-work
      """
    And every other panel is unchanged from features/006-cursor.feature
    And every line is at most 72 columns wide

  Scenario: Each account runs claude with its own config dir
    When the user runs `npm start -- --once`
    Then "claude.calls" holds exactly two lines, in either order: "-" and "<tmp>/claude-work"
    And both calls had the arguments "-p" and "/usage"

  Scenario: Claude-work colours
    When the user runs `npm start -- --once` without NO_COLOR
    Then the three claude-work gauges and percents carry the calm escape and its caption is dim
    And the claude panel keeps its 002 colours: session calm, weekly hot, weekly Fable critical

  Scenario Outline: A missing work config never runs claude against it
    Given ALLOWANCE_CLAUDE_WORK_CONFIG_DIR <config>
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the process exits with code 0
    And the claude-work panel is dim, shows no gauge, the reason "no work claude config — log in with CLAUDE_CONFIG_DIR=~/.claude-work claude" and the caption "claude · work · claude-work"
    And "claude.calls" holds exactly one line: "-"
    And the claude panel and the other six panels are unchanged, and the reason is the only line over 72 columns

    Examples:
      | config                                                        |
      | names "<tmp>/no-such-dir", which does not exist               |
      | names a regular file "<tmp>/claude-work-file"                 |
      | is unset and HOME "<tmp>/home" has no ".claude-work"          |
      | is "" and HOME "<tmp>/home" has no ".claude-work"             |

  Scenario Outline: The default work config dir
    Given ALLOWANCE_CLAUDE_WORK_CONFIG_DIR <value> and HOME is "<tmp>/home" holding the directory ".claude-work"
    When the user runs `npm start -- --once` with NO_COLOR set
    Then the claude-work panel shows the three rows of the first scenario
    And "claude.calls" holds exactly two lines, in either order: "-" and "<tmp>/home/.claude-work"

    Examples:
      | value     |
      | is unset  |
      | is ""     |

  Scenario Outline: Claude-work probe failures leave the personal panel alone
    Given the `claude` fixture <condition> when CLAUDE_CONFIG_DIR is set, and behaves as in the Background otherwise
    When the user runs `npm start -- --once`
    Then the process exits with code 0 within <seconds> seconds
    And the claude-work panel is dim with the reason "<reason>" and the caption "claude · work · claude-work"
    And the claude panel still shows its 002 rows with the caption "claude · personal · claude"

    Examples:
      | condition                                   | reason                            | seconds |
      | exits with code 1                           | Command failed or timed out       | 10      |
      | hangs indefinitely                          | Command timed out after 90s       | 95      |
      | prints "Current session: 0% used" only      | Could not parse usage from output | 10      |

  Scenario: Personal probe failures leave the work panel alone
    Given the `claude` fixture exits with code 1 when CLAUDE_CONFIG_DIR is unset, and behaves as in the Background otherwise
    When the user runs `npm start -- --once`
    Then the claude panel is dim with the reason "Command failed or timed out" and the caption "claude · personal · claude"
    And the claude-work panel shows the three rows of the first scenario

  Scenario: No CLI on the PATH at all
    Given the PATH is an empty temp dir plus node's bin, ALLOWANCE_GROK_HOME is an empty directory, and ALLOWANCE_CURSOR_AUTH_FILE names a missing file
    When the user runs `npm start -- --once`
    Then the process exits with code 0
    And eight dim panels render in order, each probe reporting status "unavailable":
      | name        | reason                                   | caption                     |
      | claude      | claude CLI not found in PATH             | claude · personal · claude  |
      | claude-work | claude CLI not found in PATH             | claude · work · claude-work |
      | agy         | agy CLI not found in PATH                | agy · agy                   |
      | kimi        | kimi CLI not found in PATH               | kimi code · kimi            |
      | grok        | no grok billing snapshot — run grok once | grok · grok                 |
      | codex       | codex CLI not found in PATH              | codex · codex               |
      | cursor      | no cursor auth — run cursor-agent login  | cursor · cursor             |
      | kilo        | kilo CLI not found in PATH               | api balance · kilo          |

  Scenario: Live mode counts the work windows
    When the user runs `npm start` on a terminal with NO_COLOR set
    Then the first frame shows eight pending panels in order claude, claude-work, agy, kimi, grok, codex, cursor, kilo
    And once every probe has settled at "2026-09-13T10:00:00Z" the frame begins with the lines
      """
      ALLOWANCE                                      data 0h0m old · 10:00:00Z
      2/16 windows above 80% · next reset: claude session in 8h40m
      """
    And pressing "r" runs `claude` exactly twice more, once per account

  Scenario: README documents the work account
    When I read "README.md"
    Then the provider list names `claude` (claude · personal) and then `claude-work` (claude · work), and says claude-work runs the same command with `CLAUDE_CONFIG_DIR` set to the work config dir and is unavailable without that dir
    And it says "All eight probes run in parallel" and no longer says "All seven probes run in parallel"
    And the env-var ledger lists `ALLOWANCE_CLAUDE_WORK_CONFIG_DIR` with default `~/.claude-work`

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes and package.json still has no "dependencies"
    And "qa/008-claude-work.e2e.mjs" uses temp dirs prefixed "allowance-qa-008-", a PATH of its fixture dir and node's bin, NO_COLOR,
      CLAUDE_CONFIG_DIR removed from the child env, and runs `npm start --silent -- --once`
    And in its first run the work config dir exists; it asserts the order of the first scenario, " 86%" in the claude panel above
      "claude · personal · claude", " 12%" in the claude-work panel above "claude · work · claude-work", and the two "claude.calls" lines
    And in its second run the work config dir does not exist; it asserts the claude-work reason and caption, the unchanged claude panel,
      and a single "-" line in "claude.calls"
    And the 001 to 007 e2es assert what they did before, with "claude code · claude" now "claude · personal · claude", "claude-work"
      second in every panel order, and ALLOWANCE_CLAUDE_WORK_CONFIG_DIR set to an existing empty temp dir so no run depends on the
      tester's own "~/.claude-work"
    And no e2e runs a real `claude` binary and every temp dir is removed
