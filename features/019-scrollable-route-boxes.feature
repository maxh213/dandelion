Feature: 019 - The live dashboard fits the terminal: the chrome stays put and the panel list scrolls

  Assumptions (the task is silent here):
  - The row budget travels on the live view as `rows`. Live mode sets it from `process.stdout.rows` when each
    frame is drawn; a value that is missing, `0` or not a positive integer becomes `24`. The terminal's resize
    event (SIGWINCH) only triggers a redraw: the next frame is the same view (same results, selection, footer
    and spinner) laid out against the new budget. Columns are not special-cased; lines stay at most 72 cells.
  - The panel region is a contiguous slice of the ten panels' lines in dashboard order. With nothing selected
    (`selected` is `-1`) the slice starts at the first panel's rule (offset 0). With a selection the slice
    starts at the selected panel's header line: the header is the region's first line, as much of that panel as
    fits follows, then later panels in order until the region is full. The selected panel's own rule sits above
    the region and is not drawn. A panel taller than the region is cut at the region's last line with its
    header visible. A panel whose header is above or below the region is not drawn, and no blank lines pad the
    frame: at the end of the list the frame can be shorter than the budget (the clear sequence erases what was
    there before).
  - Frame assembly: banner, fleet summary, the four box lines, the slice, then the footer line when it is on.
    The slice gets `rows - 6` lines, minus one more when the footer is on, and never below zero. The assembled
    frame is then cut to its first `rows` lines, which only bites when `rows` is below the chrome (six lines,
    seven with the footer): the footer and the lower box lines go first, and the banner is always line 1. The
    write after "\e[H\e[2J" is those lines joined by "\n" with no trailing newline.
  - junie and hermes stay in the panel list; with the 013 fixture they draw their dim four-line "run once"
    panels of 015 and 016.
  - End-to-end live sessions run on a stated pty size: a piped `script` session reports a 0 by 0 pty, which
    the 24-line fallback would clip, so the shared launcher ("qa/live-session.mjs" startLive) and the
    private startLive copies in the 011, 015, 016 and 017 e2es set 60 rows by 80 columns — the tallest
    pre-019 live frame is 55 lines. Only the 019 e2e runs its sessions at 12 by 80.

  Background:
    Given the fixtures, HOME, TZ and DANDELION_* variables of features/013-route-boxes.feature, with every reset
      72 h away ("the 013 fixture": claude S/W/F 3/86/100, work 0/12/23, agy 50/50, kimi 85/85, grok 90, cursor
      80 on total, auto and api, codex logged in with an API key, kilo "Balance: $14.15", junie and hermes
      without snapshots or auth)
    And the live terminal is 12 rows by 80 columns, with NO_COLOR set

  Scenario: A short terminal opens on the top of the dashboard
    When the user runs `node src/main.ts` and the first round has settled, before any key is pressed
    Then the frame after the last "\e[H\e[2J" is exactly 12 lines: line 1 the live banner, line 2 the fleet
      summary, and lines 3 to 6 exactly
      """
      +- route -------------------------+  +- route --high ------------------+
      | claude-opus-5 high              |  | claude-fable-5-1 max            |
      | claude-work                     |  | claude-work                     |
      +---------------------------------+  +---------------------------------+
      """
    And line 7 is the claude panel's rule, line 8 is "claude", and lines 9 to 12 are the claude rows and caption
    And the frame holds no claude-work or later panel, and the write after "\e[H\e[2J" does not end with a
      newline
    And the first, all-pending frame is 12 lines too: the 013 probing boxes on lines 3 to 6, then the pending
      claude and claude-work panels, and no other panel

  Scenario: Moving the selection scrolls the panel region
    Given the settled 12-row session of "A short terminal opens on the top of the dashboard"
    When the user presses "j" ten times
    Then every frame is at most 12 lines with the settled box block on lines 3 to 6, and the last frame is 9
      lines: line 7 is "▸ kilo", line 8 the kilo balance row and line 9 the "api balance · kilo" caption
    And no line of that frame is exactly "claude", "claude-work" or "agy", and no rule line sits above "▸ kilo"
    When the user presses "k" nine times
    Then the last frame's line 7 is "▸ claude", lines 3 to 6 are still the settled box block, and "▸" appears on
      no box line

  Scenario: The help footer is always the last line of the frame
    Given the settled 12-row session with claude selected
    When the user presses "?"
    Then the frame is exactly 12 lines, lines 3 to 6 are the settled box block, line 7 is "▸ claude", line 11
      is "claude · personal · claude" and line 12 is
      "keys: ↑↓/jk select · space routing on/off · r refresh · q quit · ? help"
    When the user presses "?" again
    Then the footer is gone and the frame is still at most 12 lines

  Scenario: A terminal smaller than the chrome clips the chrome from the bottom
    When the user runs live mode on a 4-row terminal and the first round settles
    Then every frame is exactly 4 lines: the banner, the fleet summary and the first two box lines
    And when the user presses "?", the frame is still the banner, the summary and the first two box lines

  Scenario: Resize redraws the same view against the new height
    Given the settled 12-row session, with nothing selected
    When the terminal grows to 30 rows
    Then the next frame is 30 lines: the same banner, summary and box block, then the panels from the claude
      rule on, ending inside the grok panel, with no blank padding
    When the terminal shrinks to 10 rows
    Then the next frame is 10 lines: line 1 the banner, lines 3 to 6 the box block, then the claude panel cut
      after its second window row
    And with kilo selected, growing the terminal adds no lines below the kilo caption

  Scenario: --once, route, keys and the box invariants are unchanged
    Then `node src/main.ts --once` for the 013 fixture prints the banner and all ten panels in the order claude,
      claude-work, agy, kimi, grok, codex, cursor, junie, hermes, kilo, is byte-for-byte the pre-019 output
      apart from the banner clock, has no box line, and is never clipped to the terminal's rows
    And `node src/main.ts route` prints "claude-opus-5 high claude-work", exit 0, and
      `node src/main.ts route --high` prints "claude-fable-5-1 max claude-work", exit 0
    And the box content, titles, 72-cell width, probing spinner, settle/refresh/toggle behaviour, NO_COLOR "+-|"
      drawing and the route CLI invariant are those of 013, and the panels, captions and gauges are those of 018
    And the keys are still ↑↓/jk (moving over the ten panels only, stopping at the ends as in 011), space, r,
      q, Ctrl-C and "?"; "x", "R" and Enter change nothing, and there are no new keys
    And the alternate-screen enter/leave sequences are those of 007, and package.json still has no runtime
      dependencies

  Scenario: Frame height and scrolling, unit level
    Given the unit tests of "src/render/terminal.test.ts" and "src/app/live.test.ts"
    And the settled ten-panel view carries the probes' real planLabels for the 013 fixture — claude
      "claude · personal", claude-work "claude · work", agy "agy", kimi "kimi code", grok "SuperGrok",
      codex "codex", cursor "Ultra", junie "junie", hermes "hermes", kilo "api balance" — and grok's
      snapshot line, so every panel height is the live one
    Then the settled ten-panel view rendered with rows 12 and selected -1 is the 12-line frame of "A short
      terminal opens on the top of the dashboard", with rows 24 it is 24 lines ending with the kimi panel's
      rule, and rows 0, undefined or a non-integer each render as 24
    And with selected 9 and rows 12 the frame is the 9 lines of "Moving the selection scrolls the panel region",
      with selected 0, rows 12 and the footer on it is 12 lines with the footer last, with rows 4 it is the
      banner, the summary and two box lines, and with rows 1 it is the banner alone
    And a live session whose screen reports 12 rows writes "\e[H\e[2J" plus at most 12 lines and no trailing
      newline on every draw, and when the screen's rows change and its resize event fires, the next draw is the
      same view against the new rows
    And the dependency contract is unchanged: slicing and assembly live in "src/render", the rows and resize
      wiring in "src/app", and "src/domain" is untouched

  Scenario: README documents the fit
    When I read "README.md"
    Then the `npm start` description says the live dashboard fits the terminal: the `route` and `route --high`
      boxes stay at the top, and the provider list scrolls with ↑↓/jk so earlier panels, personal `claude`
      included, stay reachable

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, and the 001 to 018 e2e files keep every assertion, fixture and key press
    And the only qa/ edit outside the new 019 e2e gives the five live launchers their stated pty size from
      the assumptions: "qa/live-session.mjs" startLive and the private startLive copies in 011, 015, 016
      and 017 prefix the "script" command with "stty rows 60 cols 80; ". Unselected frames are then
      byte-identical to today, and every selected-panel assertion already keys on the selected header,
      which the scroll rule keeps at the top of the region
    And "qa/019-scrollable-route-boxes.e2e.mjs" uses temp dirs prefixed "dandelion-qa-019-", sets
      DANDELION_STATE_FILE in every child env, and drives its live sessions through the same launcher on a
      12-row by 80-column pty, resizing it mid-session with stty
    And it covers: the settled and all-pending 12-row frames of "A short terminal opens on the top of the
      dashboard", "j" to kilo and "k" back to claude with the boxes on lines 3 to 6 throughout, the footer as
      the last line, a mid-session resize redrawing against the new rows, the 4-row chrome clipping, and "q"
      restoring the screen with exit 0
    And it renders the rows matrix of "Frame height and scrolling, unit level" (12, 24, 0, missing, 4 and 1,
      with selection and footer variants) and asserts `--once` for the same usages holds every provider and no
      box line
    And no e2e runs a real provider binary or reaches a real API, and every temp dir is removed
