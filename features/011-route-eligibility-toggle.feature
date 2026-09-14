Feature: 011 - Toggle route eligibility per provider in the live dashboard

  State file = DANDELION_STATE_FILE, or "$XDG_STATE_HOME/dandelion/eligibility.json", or "$HOME/.local/state/dandelion/eligibility.json";
  an unset or empty variable counts as unset. It is one flat JSON object of provider id to value. A provider is ineligible only when its
  value is exactly false; a missing key, true or any other value means eligible. A missing, unreadable (e.g. a directory) or corrupt file
  means every provider is eligible, and nothing crashes, warns or waits.
  Only a key in live mode writes it: the loaded object with the one id set to false or true, every other key kept as read (nothing kept
  from a corrupt file), as JSON.stringify(object, null, 2) plus "\n", written to a temp file in the same directory and renamed over the
  path, creating missing parent directories. `--once` and `route` read it and never write, create or touch it.
  Routable provider = its on-screen result is "ok" with at least one window (codex in ChatGPT mode counts, kilo and codex api-key do not).
  Live keys: "j" or Down ("\e[B") and "k" or Up ("\e[A") move the selection by one panel in panel order, stopping at the ends. Nothing is
  selected at start; the first "j"/Down selects claude, the first "k"/Up selects kilo. Space on a routable selected panel flips its value and
  redraws at once. Space on a non-routable one (pending, unavailable, error, no windows) writes nothing and flashes the caption.
  The selection and the tag never change a panel's rows, the fleet summary, the panel order or what any probe runs.
  Header line (the line holding the id): "▸ " before the id when selected; for an ineligible provider "routing off" right-aligned to end at
  column 72. Without NO_COLOR the tag is "\e[90mrouting off\e[0m" and a selected panel's rule is "\e[1m" + "━" x72 + "\e[0m" instead of
  dim (in an all-dim panel the dim span starts at the header line). Under NO_COLOR the rule stays "=" x72.
  Flash: the selected panel's caption line reads the message instead of its caption, dim, and is back by the first frame drawn 2 s or
  more after the key.
  Help footer: "keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help".

  Background:
    Given the fixtures and HOME of features/010-route-command.feature, with DANDELION_STATE_FILE "<tmp>/state/eligibility.json" and no
      "<tmp>/state" directory unless a scenario creates it

  Scenario Outline: route skips ineligible providers before both rules
    Given the usages <usages> and the state file <state>
    When the user runs `node src/main.ts route`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty, the exit code is <code>, and the state file is unchanged

    Examples:
      | case                                    | usages                                             | state                               | line                       | code |
      | no file: 010 output                     | claude 0/86@2, agy 0/0@72                          | missing                             | claude-opus-5 max          | 0    |
      | ineligible never wins by evaporation    | claude 0/86@2, agy 0/0@72                          | {"claude": false}                   | gemini-3.1-pro-high medium | 0    |
      | ineligible never wins by headroom       | claude 20/30@72, claude-work 10/5@72, agy 15/20@72 | {"claude-work": false, "nope": 1}   | gemini-3.1-pro-high medium | 0    |
      | true and other values mean eligible     | claude 0/86@2, agy 0/0@72                          | {"claude": true, "agy": "no"}       | claude-opus-5 max          | 0    |
      | every windowed provider ineligible      | claude 0/86@2                                      | {"claude": false}                   | none                       | 1    |
      | corrupt file means all eligible         | claude 0/86@2, agy 0/0@72                          | the bytes "{not json"               | claude-opus-5 max          | 0    |
      | unreadable file means all eligible      | claude 0/86@2, agy 0/0@72                          | a directory at the path             | claude-opus-5 max          | 0    |

  Scenario Outline: The default state file path
    Given DANDELION_STATE_FILE <var>, the usages claude 0/86@2, agy 0/0@72, and {"claude": false} written only at <path>
    When the user runs `node src/main.ts route`
    Then stdout is "gemini-3.1-pro-high medium" and the exit code is 0

    Examples:
      | var       | path                                                                    |
      | is unset  | "<tmp>/xdg/dandelion/eligibility.json" with XDG_STATE_HOME "<tmp>/xdg"  |
      | is ""     | "$HOME/.local/state/dandelion/eligibility.json" with XDG_STATE_HOME unset |
      | is unset  | "$HOME/.local/state/dandelion/eligibility.json" with XDG_STATE_HOME ""  |

  Scenario: --once shows the tag and never writes
    Given the usages claude 0/86@2 and the state file {"claude": false, "kilo": false}
    When the user runs `NO_COLOR=1 node src/main.ts --once`
    Then the exit code is 0, the claude header line is "claude" then spaces then "routing off" ending at column 72, and so is kilo's
    And every other line is byte-for-byte the output with no state file, and the state file's bytes and mtime are unchanged
    When the state file is missing
    Then the output has no "routing off", no "▸", and "<tmp>/state" still does not exist

  Scenario: Toggle a provider off and on in live mode
    Given the usages claude 0/86@2, agy 0/0@72 and no state file
    When the user runs `node src/main.ts` on a terminal with NO_COLOR set and every probe has settled
    Then no panel has "▸" or "routing off"
    When the user presses "j"
    Then the next frame's claude header line is "▸ claude" and no file exists at the state path
    When the user presses space
    Then the state file parses to {"claude": false}, holds no leftover temp file beside it, and the next frame's claude header line is
      "▸ claude" then spaces then "routing off" ending at column 72, with the claude rows unchanged
    And `node src/main.ts route` run meanwhile prints "gemini-3.1-pro-high medium"
    When the user presses space again
    Then the state file parses to {"claude": true} and the next frame's claude header line is "▸ claude"
    When the user presses space, then "q", and runs `node src/main.ts` on a terminal again
    Then once settled the claude header line is "claude" then spaces then "routing off", and no panel has "▸"

  Scenario: A rewrite keeps unknown keys
    Given the state file {"nope": 1, "agy": false}
    When the user presses "j" then space in live mode once settled
    Then the state file parses to {"nope": 1, "agy": false, "claude": false}

  Scenario Outline: Non-routable panels flash and write nothing
    Given no state file and <setup>
    When the user presses <keys> then space in live mode <when>
    Then the <id> caption line reads "not routable (no usage windows)" and is back to "<caption>" 2 to 3 seconds later
    And no file exists at the state path and no header shows "routing off"

    Examples:
      | setup                        | keys          | when          | id     | caption            |
      | the Background usages        | "k"           | once settled  | kilo   | api balance · kilo |
      | the Background usages        | "k", "k", "k" | once settled  | codex  | codex · codex      |
      | claude unavailable           | "j"           | once settled  | claude | claude · personal · claude |

  Scenario: Space on a pending panel does nothing
    Given the claude fixture sleeps 5 seconds
    When the user presses "j" then space while claude shows "probing…"
    Then no file exists at the state path and the claude panel is "▸ claude" then its "probing…" line, with no flash

  Scenario: A state file that cannot be written
    Given DANDELION_STATE_FILE is "<tmp>/plain-file/eligibility.json" where "<tmp>/plain-file" is a regular file
    When the user presses "j" then space in live mode once settled
    Then the claude caption line reads "routing state not saved" for 2 to 3 seconds, no header shows "routing off", and the app keeps running
    And pressing "q" exits 0

  Scenario Outline: Moving the selection
    When the user presses <keys> in live mode once settled
    Then the only header line with "▸" is <id>'s

    Examples:
      | keys                          | id          |
      | "j", "j"                      | claude-work |
      | Down, Down, Up                | claude      |
      | "k"                           | kilo        |
      | "j", "k"                      | claude      |
      | "j" nine times                | kilo        |
      | "k", Up, "k"                  | codex       |

  Scenario: Colours and footer in live mode
    Given the state file {"claude": false}
    When the user presses "?" then "j" in live mode without NO_COLOR once settled
    Then the claude panel starts "\e[1m" + "━" x72 + "\e[0m\n▸ claude", and its header line ends "\e[90mrouting off\e[0m"
    And every other panel's rule is "\e[90m" + "━" x72 + "\e[0m" as in 007
    And the last line is "\e[90mkeys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help\e[0m"
    And "r", "q", Ctrl-C and "?" behave as in 007, and "x", "R" and Enter change nothing

  Scenario: The route decision with eligibility, unit level
    Given the unit tests of the route decision in "src/domain/index.test.ts", with the now and midnight of 010
    When the decision gets claude: weekly 50 @2026-09-14T20:00:00.000Z; agy: rolling 40 @- and claude is ineligible
    Then it returns "gemini-3.1-pro-high medium", and with nothing ineligible every 010 unit row returns its 010 line
    And unit tests pin the state-file path rules, every "means eligible" case above, and the temp-file-then-rename write in the same directory

  Scenario: Nothing else changes
    When no state file exists
    Then `--once` output is byte-for-byte that of 010, every 010 route row prints its 010 line, and live frames differ from 010 only in the footer

  Scenario: README documents eligibility
    When I read "README.md"
    Then Run Commands list the live keys "↑↓/jk select" and "space routing on/off"
    And the Route section has one paragraph saying ineligible providers are dropped before both rules, space toggles it in the live dashboard,
      non-routable panels cannot be toggled, and the choice is kept in the state file
    And the env-var ledger lists `DANDELION_STATE_FILE` with default `$XDG_STATE_HOME/dandelion/eligibility.json`, else `~/.local/state/dandelion/eligibility.json`

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, and the 001 to 010 e2es assert what they did before
    And "qa/011-route-eligibility-toggle.e2e.mjs" uses temp dirs prefixed "dandelion-qa-011-" and sets DANDELION_STATE_FILE in every child env
    And it covers every row of "route skips ineligible providers before both rules" and "The default state file path", and "--once shows the tag"
    And it runs live mode under `/usr/bin/script` with NO_COLOR and covers "Toggle a provider off and on in live mode" and the kilo row of
      "Non-routable panels flash and write nothing"
    And no e2e runs a real provider binary or reads the tester's own state file, and every temp dir is removed
