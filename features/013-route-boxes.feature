Feature: 013 - Route boxes at the top of the live dashboard

  Assumptions (the task is silent here):
  - Split: a routed line is "<model line> <provider id>" and a provider id never contains a space, so row 1 is everything before the
    line's last space and row 2 is what follows it. "none" has no token: row 1 is "none" and row 2 is "no subscription available".
  - The provider row is plain text (the task styles only the borders dim and the model line bold). A "none" box and a "probing…" box
    are dim throughout, one dim span per row, borders included, like a pending panel. Padding spaces sit inside a row's style span.
  - The boxes are four lines of every live frame, the first all-pending frame included. Each frame recomputes them from the latest
    fully settled round's results, the current eligibility and the frame's own time, in the process zone `route` uses. So a space
    toggle shows on its own frame, a refresh changes the boxes only when its round fully settles, and between rounds a box flips
    exactly when a `route` run at that frame's time would flip (a resetsAt passing now, or local midnight).
  - Before the first round fully settles there is no answer: both boxes show the live spinner and "probing…" in row 1 and an empty
    row 2. A route needs every probe's result, routable or not, the same as the CLI.

  Geometry: two 35-cell boxes with a 2-cell gap fill the 72-cell width between the fleet summary line and the first provider panel.
  The top border holds the title: "┌─ " + title + " " + "─" to fill + "┐" ("route", then "route --high"). A text row is "│ " + the
  text cut to 31 cells + " │", left aligned and space padded; the cut is the window-label cut (first 30 cells, trailing spaces
  trimmed, plus "…"). The bottom border is "└" + "─" x33 + "┘". With NO_COLOR, ┌┐└┘ are "+", ─ is "-" and │ is "|", and there is no
  ANSI at all. Without NO_COLOR the borders are dim and the model line is bold. The boxes are live-only: "--once" and non-terminal
  output never have them. They are not selectable: ↑↓/jk still move only over the eight panels and no box line ever shows "▸".

  Background:
    Given the fixtures, HOME, TZ and DANDELION_* variables of features/012-route-high.feature, with every reset 72 h away
    And "the 013 fixture" means claude S/W/F 3/86/100, work 0/12/23, agy 50/50, kimi 85/85, grok 90, cursor 80 on total, auto and
      api, codex logged in with an API key and kilo "Balance: $14.15", so `route` prints "claude-opus-5 high claude-work" and
      `route --high` prints "claude-fable-5-1 max claude-work"

  Scenario: The boxes after the round settles
    Given the 013 fixture
    When the user runs `node src/main.ts` on a terminal with NO_COLOR set and the first round has settled
    Then the frame's line 1 is the live banner, line 2 is the fleet summary, and lines 3 to 6 are exactly
      """
      +- route -------------------------+  +- route --high ------------------+
      | claude-opus-5 high              |  | claude-fable-5-1 max            |
      | claude-work                     |  | claude-work                     |
      +---------------------------------+  +---------------------------------+
      """
    And line 7 is the claude panel's rule, each box line is exactly 72 cells wide, and the summary, panels and footer are those of 012

  Scenario: Box colours
    Given the 013 fixture
    When the settled frame is drawn without NO_COLOR
    Then the left box's four lines are exactly
      | line    | bytes                                                                        |
      | top     | "\e[90m┌─ route " + "─" x25 + "┐\e[0m"                                         |
      | model   | "\e[90m│\e[0m\e[1m claude-opus-5 high" + " " x14 + "\e[0m\e[90m│\e[0m"         |
      | account | "\e[90m│\e[0m claude-work" + " " x21 + "\e[90m│\e[0m"                          |
      | bottom  | "\e[90m└" + "─" x33 + "┘\e[0m"                                                 |
    And the right box follows the same rules with title "route --high" and model line "\e[1m claude-fable-5-1 max" + " " x12 + "\e[0m"
    And a "none" or "probing…" row is one dim span, borders included, such as "\e[90m│ none" + " " x28 + "│\e[0m"
    And the two boxes are joined by exactly two spaces

  Scenario: Probing until every probe settles
    Given the 013 fixture, but the kilo probe waits 3 seconds before printing its balance
    When the user runs live mode with NO_COLOR set
    Then the first frame is drawn before any probe starts, and its lines 3 to 6 are exactly
      """
      +- route -------------------------+  +- route --high ------------------+
      | ⠋ probing…                      |  | ⠋ probing…                      |
      |                                 |  |                                 |
      +---------------------------------+  +---------------------------------+
      """
    And while kilo is pending, with every other panel already settled, both boxes still show "probing…", advancing one spinner frame
      per 100ms tick
    And about 3 seconds in, when kilo settles, both boxes show the 013 fixture's answers

  Scenario: A refresh keeps the previous round's answers
    Given the 013 fixture settled in live mode, and every kilo probe waits 3 seconds
    When the user presses "r"
    Then the banner shows "refreshing…", no panel goes pending, and the boxes keep showing the settled answers
    And frames drawn while the round runs, its panels settling one by one, still show the previous round's boxes
    And when the round fully settles, both boxes are recomputed from its results

  Scenario: Space recomputes both boxes on the same frame
    Given the 013 fixture settled in live mode with NO_COLOR set and no state file
    When the user presses "j", "j", then space
    Then that frame's claude-work header shows "routing off", and lines 3 to 6 are exactly
      """
      +- route -------------------------+  +- route --high ------------------+
      | gemini-3.1-pro-high medium      |  | kimi-k3-max                     |
      | agy                             |  | cursor                          |
      +---------------------------------+  +---------------------------------+
      """
    When the user presses space again
    Then lines 3 to 6 are the settled block of "The boxes after the round settles", and the state file parses to {"claude-work": true}

  Scenario: Nothing to route
    Given every routable provider is unavailable, while codex and kilo are "ok"
    When the first round settles in live mode with NO_COLOR set
    Then lines 3 to 6 are exactly
      """
      +- route -------------------------+  +- route --high ------------------+
      | none                            |  | none                            |
      | no subscription available       |  | no subscription available       |
      +---------------------------------+  +---------------------------------+
      """

  Scenario: Long lines are cut like window labels
    Given kimi 10/10 and every other routable provider unavailable
    When the first round settles in live mode with NO_COLOR set
    Then lines 3 to 6 are exactly
      """
      +- route -------------------------+  +- route --high ------------------+
      | kimi-code/kimi-for-coding-high… |  | none                            |
      | kimi                            |  | no subscription available       |
      +---------------------------------+  +---------------------------------+
      """

  Scenario: The boxes are not selectable and nothing else changes
    Given the 013 fixture settled in live mode
    When the user presses "j"
    Then "▸" appears on the claude panel's header line and on no box line
    And ↑↓/jk move only over the eight panels, space toggles only a selected routable panel with its 011 flashes, and r, q, Ctrl-C,
      "?", the fleet summary, the panel order and the help footer behave as in 011
    And `node src/main.ts route` prints "claude-opus-5 high claude-work" and `node src/main.ts route --high` prints
      "claude-fable-5-1 max claude-work", each with its 012 exit code, and every 010, 011 and 012 route row is unchanged
    And `node src/main.ts --once` for the 013 fixture is byte-for-byte the 012 output apart from the banner clock, with no box line,
      and piped output still runs once as in 007

  Scenario: The boxes reuse the domain decisions, unit level
    Given the unit tests of "src/render/terminal.test.ts" and "src/app/live.test.ts"
    Then for a matrix of usages, ineligible lists and times covering evaporation near local midnight, headroom ties, every chain
      rank, "none" and a line longer than 31 cells, the box rows equal routeLine and highRouteLine for the same inputs, split at the
      last space
    And a test pins that live mode hands the frame the process zone (Intl.DateTimeFormat().resolvedOptions().timeZone) and the frame
      time, the same zone and now `route` uses
    And a test pins that a frame drawn mid-refresh, with only some of the new round's results in, still shows the previous round's boxes
    And the dependency contract is unchanged: the routing table and chain live only in "src/domain", drawing lives in "src/render",
      and "src/app" only wires them

  Scenario: README documents the boxes
    When I read "README.md"
    Then the `npm start` description in Run Commands says the live dashboard shows the `route` and `route --high` answers in two
      boxes at the top, and that they update when a round settles or routing is toggled

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, and the 001 to 012 e2es are unchanged
    And "qa/013-route-boxes.e2e.mjs" uses temp dirs prefixed "dandelion-qa-013-", sets DANDELION_STATE_FILE in every child env, drives
      live sessions through "qa/live-session.mjs", and covers: the probing block before the first round settles (a slow kilo), the
      settled block of "The boxes after the round settles" byte-for-byte under NO_COLOR, the space toggle on the same frame and back,
      "Nothing to route", the kimi truncation row, a refresh that keeps the previous round's answers, and the colour spans of "Box colours"
    And it asserts the NO_COLOR frame holds no escape sequence other than "\e[?1049h", "\e[?25l", "\e[H\e[2J" and "\e[?25h\e[?1049l",
      and that `--once` output for the 013 fixture has no box line and matches the 012 rendering apart from the banner clock
    And no e2e runs a real provider binary or reaches a real API, and every temp dir is removed
