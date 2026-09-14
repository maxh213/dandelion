Feature: 007 - Live dashboard with parallel probes, auto-refresh and keys

  Panels, rows, gauges, ramp, captions, reasons and NO_COLOR rules are those of features/001 to 006, unchanged.
  Live mode runs only when both stdin and stdout are TTYs and "--once" is not among the arguments; otherwise the app runs once:
  probe all seven, print the banner and panels exactly as in 006, exit 0. Once mode never emits the sequences below.
  Live mode writes "\e[?1049h\e[?25l" on start, starts every frame with "\e[H\e[2J", and on quit writes "\e[?25h\e[?1049l",
  leaves raw mode and exits 0 only after every in-flight probe child has been stopped.
  A live frame is: live banner, fleet summary line, the seven panels in the 006 order, then the help footer when it is on.
  Frames are drawn: the first one synchronously at start, before any probe is started (so all seven panels are pending);
  then at once on every settled result and on every key that changes something; and on a timer, every 100ms while any
  panel is pending and every 1000ms while none is, including during a refresh. Drawing never waits for a probe.
  The frame time is the wall clock when the frame is drawn. The banner clock, the data age, every "↻" countdown, grok's
  snapshot age and its 48h stale test, and the summary's next reset all use the frame time, never a result's fetchedAt.
  (Once mode keeps using the single start time, as in 006.)
  Live banner: "ALLOWANCE" left, and right-aligned to 72 columns "[refreshing… · ][data <age> old · ]HH:MM:SSZ".
  "refreshing… · " shows only while a refresh round runs and some result is on screen; "data <age> old · " shows once any
  result has settled, where age = frame time minus the oldest on-screen result's fetchedAt, in the countdown format.
  Pending panel (before a provider's first result), three lines: the rule ("=" x72 under NO_COLOR, "━" x72 otherwise), the
  provider id, "<frame> probing…". Frames cycle ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, advancing one per 100ms tick; they stay braille under NO_COLOR.
  Fleet summary: "<k>/<n> windows above 80% · next reset: <id> <window label> in <countdown>" over on-screen results.
  n counts every window of every ok result, k those with usedPct >= 80 (the hot threshold). When k is 0 the first segment is
  "all windows below 80%". The next reset is the soonest resetsAt after the frame time, ties by panel order then row order;
  with none, the second segment is "next reset: none". Balances are not windows.
  Help footer: "keys: r refresh · q quit · ? help".
  Colour (without NO_COLOR), with B="\e[1m", D="\e[90m", R="\e[0m": a banner without the marker is one span
  B<whole line>R, as in 006. With the marker it is B"ALLOWANCE<gap>"R D"refreshing…"R B" · data <age> old · HH:MM:SSZ"R.
  The summary line is D<line>R, the footer D<line>R, and a pending panel is D<rule>\n<id>\n<frame> probing…R.
  A round probes all seven in parallel and each result replaces its panel as it settles. The next automatic round starts
  ALLOWANCE_REFRESH_SECONDS after the previous round fully settles; the value is a positive integer, otherwise 300.
  A refresh never shows a pending panel for a provider that already has a result. "r" during a running round does nothing.

  Background:
    Given the fixtures, grok home and cursor fixture of features/006-cursor.feature are in place, with CODEX_FIXTURE_MODE "apikey"
    And the current time is "2026-09-13T10:00:00Z"

  Scenario: Once mode keeps its exact output
    When the user runs `npm start -- --once` with NO_COLOR set and stdout on a terminal
    Then the process exits with code 0
    And stdout is byte-for-byte the output of the 006 `npm start` run for the same fixtures and time
    And stdout contains no "probing…", no summary line and no "\e[?1049h"

  Scenario Outline: Without a terminal the app always runs once
    When the user runs `npm start<args>` with <streams>
    Then it prints the once-mode output, exits 0 without waiting for stdin to close, and emits no "\e[?1049h"

    Examples:
      | args        | streams                                          |
      |             | stdout piped to a file, stdin an open terminal   |
      |             | stdout a terminal, stdin from /dev/null          |
      | -- --once   | stdout piped to a file, stdin an open terminal   |

  Scenario: Live mode shows pending panels, then fills each one as it lands
    Given "kimi" earlier on PATH is a node script that waits 3 seconds, then runs the 003 kimi fixture in mode "ok"
    When the user runs `npm start` on a terminal with NO_COLOR set
    Then the terminal switches to the alternate screen and hides the cursor
    And the first frame is written before any probe starts and shows seven pending panels in order claude, agy, kimi, grok,
      codex, cursor, kilo, each the lines "======…" (72), "<id>", "⠋ probing…"
    And while any panel is pending a new frame is drawn every 100ms and the spinner advances one frame each time
    And within 1 second every panel except kimi shows its 006 content while kimi still shows a spinner and "probing…"
    And 3 to 4 seconds after start the kimi panel shows its 003 rows, with the other panels unchanged

  Scenario: Fleet summary and banner once every probe has settled
    When the user runs `npm start` on a terminal with NO_COLOR set and every probe has settled at "2026-09-13T10:00:00Z"
    Then the frame begins with the lines
      """
      ALLOWANCE                                      data 0h0m old · 10:00:00Z
      2/13 windows above 80% · next reset: claude session in 8h40m
      """
    And every line is at most 72 columns wide

  Scenario: Frames keep time without new data
    Given every probe settled with fetchedAt "2026-09-13T10:00:00Z" and ALLOWANCE_REFRESH_SECONDS is "300"
    When a frame is drawn at "2026-09-13T10:00:00Z" and a later one at "2026-09-13T10:01:05Z" with no new result between
    Then the later frame is drawn by the 1000ms timer and begins with the lines
      """
      ALLOWANCE                                      data 0h1m old · 10:01:05Z
      2/13 windows above 80% · next reset: claude session in 8h38m
      """
    And its claude "session" row ends in "↻ 8h38m" where the earlier frame's ended in "↻ 8h40m"
    And frames are drawn at about 1 per second while nothing is pending, so the clock changes every second

  Scenario Outline: Fleet summary variations
    Given the on-screen results hold only <windows>
    Then the summary line is "<summary>"

    Examples:
      | windows                                                                      | summary                                                      |
      | kimi weekly 59% resetting 2026-09-18T10:00:00Z and cursor total 31% with none | all windows below 80% · next reset: kimi weekly in 5d0h      |
      | codex 5h 80% resetting 12:30:00Z and claude weekly 86% resetting 12:30:00Z  | 2/2 windows above 80% · next reset: claude weekly in 2h30m   |
      | grok credits 79% resetting 09:00:00Z (past) and kilo balance $14.15         | all windows below 80% · next reset: none                     |
      | no ok result (seven unavailable panels)                                     | all windows below 80% · next reset: none                     |

  Scenario: Auto-refresh keeps the data on screen
    Given ALLOWANCE_REFRESH_SECONDS is "1"
    When the user runs `npm start` on a terminal and the first round settles
    Then about 1 second later the banner shows "refreshing… · data 0h0m old · " before the clock
    And no panel shows "probing…" during the refresh
    And "refreshing…" disappears when that round settles, and the next round starts about 1 second after that

  Scenario Outline: Refresh interval values
    Given ALLOWANCE_REFRESH_SECONDS is <value>
    When the first round settles in live mode
    Then the next automatic round starts after <seconds> seconds

    Examples:
      | value     | seconds |
      | unset     | 300     |
      | ""        | 300     |
      | "0"       | 300     |
      | "-5"      | 300     |
      | "2.5"     | 300     |
      | "abc"     | 300     |
      | "7"       | 7       |

  Scenario: Keys
    Given live mode has settled its first round
    When the user presses "?"
    Then the last line of the frame is "keys: r refresh · q quit · ? help"
    When the user presses "?" again
    Then the footer is gone
    When the user presses "r"
    Then a round starts at once, the banner shows "refreshing…", and `codex login status` has run exactly twice
    When the user presses "r" again before that round settles
    Then `codex login status` has still run exactly twice
    When the user presses "x", "R" or Enter
    Then nothing changes

  Scenario Outline: Quitting restores the terminal
    Given live mode is running
    When the user presses <key>
    Then "\e[?25h\e[?1049l" is written, the terminal is back in cooked mode with its main screen, and the process exits with code 0

    Examples:
      | key    |
      | "q"    |
      | Ctrl-C |

  Scenario: Quit during an in-flight kimi probe reaps the child
    Given the kimi fixture writes its pid and stays alive without printing a token
    When the user runs `npm start` on a terminal and presses "q" while the kimi panel shows "probing…"
    Then the process exits with code 0 within 7 seconds
    And the pid in the kimi pid file no longer names a running process

  Scenario: A hanging probe never delays the others
    Given the `kilo` fixture sleeps 60 seconds before printing
    When the user runs `npm start` on a terminal with NO_COLOR set
    Then within 5 seconds claude, agy, kimi, grok, codex and cursor show their 006 content while kilo shows "probing…"
    And after 20 to 25 seconds the kilo panel is dim with the reason "Command timed out after 20s" and caption "api balance · kilo"
    When the user runs `npm start -- --once` with NO_COLOR set
    Then it exits 0 after 20 to 30 seconds with that kilo panel and the other six panels unchanged

  Scenario: Colours in live mode
    Given every probe settled with fetchedAt "2026-09-13T10:00:00Z"
    When a frame is drawn without NO_COLOR at "2026-09-13T10:01:05Z" during a refresh with the footer on
    Then its banner bytes are "\e[1mALLOWANCE" + 24 spaces + "\e[0m\e[90mrefreshing…\e[0m\e[1m · data 0h1m old · 10:01:05Z\e[0m"
    And its summary bytes are "\e[90m2/13 windows above 80% · next reset: claude session in 8h38m\e[0m"
    And its last line is "\e[90mkeys: r refresh · q quit · ? help\e[0m"
    And every panel is byte-for-byte its 006 colour rendering at that frame time
    When the kimi panel is pending on the first frame without NO_COLOR
    Then its bytes are "\e[90m" + "━" x72 + "\nkimi\n⠋ probing…\e[0m"

  Scenario: README documents live mode
    When I read "README.md"
    Then Run Commands list `npm start` as the live dashboard (r refresh, q quit, ? help) and `npm start -- --once` as run once and exit
    And it says the app runs once when stdout or stdin is not a terminal
    And the env-var ledger lists `ALLOWANCE_REFRESH_SECONDS` with default `300`

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, and the 001 to 006 e2es run the app with "--once" and otherwise assert what they did before
    And "qa/007-live-refresh.e2e.mjs" uses temp dirs prefixed "allowance-qa-007-", PATH of its fixture dir and node's bin,
      an empty grok home, a missing ALLOWANCE_CURSOR_AUTH_FILE, NO_COLOR, ALLOWANCE_REFRESH_SECONDS "1", and runs
      `/usr/bin/script -qfec "<npm> start --silent" /dev/null` with SHELL=/bin/sh and an outer timeout of 60 seconds
    And in its first run the kimi fixture exits at once; it waits for a frame with no "probing…" and a later frame whose banner
      contains "refreshing…", sends "q", and asserts exit 0, "\e[?1049h" in the output and "\e[?25h\e[?1049l" after the last frame
    And in its second run the kimi fixture is a node script that writes its pid and stays alive; it sends "q" once the pid file
      exists, and asserts exit 0 within 7 seconds and that the pid no longer names a running process
    And in its third run stdout is piped and stdin stays open; it asserts one once-mode output, exit 0, and no "\e[?1049h"
    And "qa/007-slow-probe.e2e.mjs" runs the same way with a node `kilo` fixture that sleeps 60 seconds, asserts the live frame
      of "A hanging probe never delays the others" within 5 seconds and the kilo timeout reason within 30 seconds, then sends "q"
    And both e2es remove their temp dirs, leave no fixture process running, and package.json still has no "dependencies"
