Feature: 010 - dandelion route picks the subscription to burn

  `route` runs the eight probes of 008 once, in parallel with their own timeouts, exactly as `--once` does, then prints one line to stdout
  and nothing to stderr. It never draws the dashboard, never enters live mode (even on a terminal) and writes no ANSI escape.
  Candidates, in dashboard order: claude, claude-work, agy, kimi, grok, cursor. A candidate takes part only when its status is "ok" and it
  has at least one window. codex (in either login mode) and kilo never take part.
  Window kinds, set by the probes, never shown by the dashboard:
    | kind    | windows                                                                                        |
    | rolling | claude and claude-work "session", kimi "5h", agy labels ending "Five Hour Limit"               |
    | weekly  | any other label containing "week" in any case, grok "credits", cursor "total", "auto", "api"   |
    | other   | everything else; route ignores it                                                              |
  left = 100 - usedPct, compared as raw floats.
  Evaporation: a weekly window with a resetsAt after now and before the next local midnight (process TZ), with left < 97.
    A candidate's evaporation score is the highest left among its evaporating windows. If any candidate has one, print the max line
    of the candidate with the highest score.
  Otherwise binding = min(lowest rolling left, lowest weekly left), a missing kind counting as 100. Print the standard line of the
  candidate with the highest binding. Every tie goes to the earlier candidate in dashboard order.
  No candidate takes part: print "none" and exit 1. Otherwise exit 0.
    | candidate   | standard line                       | max line                            |
    | claude      | claude-opus-5 high                  | claude-opus-5 max                   |
    | claude-work | claude-opus-5 high                  | claude-opus-5 max                   |
    | agy         | gemini-3.1-pro-high medium          | gemini-3.1-pro-high high            |
    | kimi        | kimi-code/kimi-for-coding-highspeed | kimi-code/kimi-for-coding-highspeed |
    | grok        | grok-4.6                            | grok-4.6                            |
    | cursor      | kimi-k3-max                         | kimi-k3-max                         |

  Background:
    Given the process TZ puts local time between 10:00 and 13:59, so "today" is now + 2h and "after midnight" is now + 14h
    And fixture CLIs and a cursor fixture API on the PATH report the usages each scenario gives, with "S/W@R" meaning
      rolling S% used and weekly W% used resetting in R hours, and "W@R" meaning a weekly window only
    And codex is logged in with an API key, kilo reports "Balance: $14.15", and every candidate not listed is unavailable

  Scenario Outline: route prints one line
    Given the usages <usages>
    When the user runs `node src/main.ts route`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is 0

    Examples:
      | case                                          | usages                                              | line                                |
      | evaporation beats perfect headroom            | claude 0/86@2, agy 0/0@72                           | claude-opus-5 max                   |
      | highest evaporation score wins                | claude 0/86@2, cursor 60@2                          | kimi-k3-max                         |
      | evaporation tie goes to dashboard order       | agy 0/90@2, kimi 0/90@2                             | gemini-3.1-pro-high high            |
      | an untouched weekly (97 left) never evaporates | claude 0/3@2, agy 10/10@72                          | claude-opus-5 high                  |
      | a reset after local midnight never evaporates | claude 0/86@14, agy 10/10@72                        | gemini-3.1-pro-high medium          |
      | most headroom, claude-work highest            | claude 20/30@72, claude-work 10/5@72, agy 15/20@72  | claude-opus-5 high                  |
      | most headroom, agy highest                    | claude 20/30@72, agy 5/5@72                         | gemini-3.1-pro-high medium          |
      | kimi bound by its 5h window                   | kimi 90/10@72, grok 50@72                           | grok-4.6                            |
      | kimi free on both                             | kimi 10/10@72, grok 50@72                           | kimi-code/kimi-for-coding-highspeed |
      | headroom tie goes to dashboard order          | agy 20/20@72, kimi 20/20@72                         | gemini-3.1-pro-high medium          |
      | an unavailable candidate is skipped           | claude unavailable, cursor 40@72                    | kimi-k3-max                         |

  Scenario: Nothing to route
    Given every candidate is unavailable, while codex and kilo are "ok"
    When the user runs `node src/main.ts route`
    Then stdout is exactly "none" followed by one newline and the exit code is 1

  Scenario: route on a terminal still prints one line
    Given the usages claude 0/86@2
    When the user runs `dandelion route` on a terminal through a "<tmp>/bin/dandelion" symlink to src/main.ts
    Then the terminal shows only "claude-opus-5 max", with no escape sequence and no alternate screen, and the exit code is 0

  Scenario: The decision compares raw floats
    Given the unit tests of the route decision in "src/domain/index.test.ts"
    When candidates arrive with windows used 50.4 and 50.6 and no rounding
    Then the one with 50.4 used wins, and a weekly left of 96.9 evaporates while 97 does not
    And every line of the routing table is pinned by a test

  Scenario: The dashboard is unchanged
    When the user runs `node src/main.ts --once` with the fixtures of features/009-rename-dandelion.feature
    Then its output is the 009 dashboard, byte for byte apart from the clock, and no window kind appears in it
    And live mode, panel order and every probe recipe are those of 009

  Scenario: README documents route
    When I read "README.md"
    Then the run commands list `dandelion route` (and `npm start -- route`), saying it prints one line and exits 1 with "none"
    And it gives both decision rules and the routing table above
    And it says kilo (a balance) and codex (no subscription windows to route on) are never routed

  Scenario: End-to-end checks
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, and the 001 to 009 e2es are unchanged
    And "qa/010-route-command.e2e.mjs" uses temp dirs prefixed "dandelion-qa-010-", a PATH of its fixture dir and node's bin, an empty HOME,
      a TZ chosen from the current UTC hour, and reset instants relative to now
    And it covers every row of "route prints one line" and "Nothing to route", asserting stdout, stderr and exit code exactly
    And no e2e runs a real provider binary or reaches a real API, and every temp dir is removed
