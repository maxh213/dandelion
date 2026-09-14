Feature: 010 - dandelion route picks the subscription to burn

  `route` runs when the first argument is exactly `route`; later arguments are ignored. Any other argv keeps 009 behaviour, so
  `dandelion --once route` prints the dashboard and `dandelion routes` is the plain dashboard command.
  `route` runs the eight probes of 008 once, in parallel with their own timeouts, exactly as `--once` does, then prints one line to stdout
  and nothing to stderr. It never draws the dashboard, never enters live mode (even on a terminal) and writes no ANSI escape.
  Candidates, in dashboard order: claude, claude-work, agy, kimi, grok, cursor. A candidate takes part only when its status is "ok" and it
  has at least one window. codex (in either login mode) and kilo never take part.
  Window kinds, set by the probes, never shown by the dashboard:
    | kind    | windows                                                                                        |
    | rolling | claude and claude-work "session", kimi "5h", agy labels ending "Five Hour Limit"               |
    | weekly  | any other label containing "week" in any case, grok "credits", cursor "total", "auto", "api"   |
    | other   | everything else; route ignores it in both rules                                                |
  left = 100 - usedPct, compared as raw floats.
  Evaporation: a weekly window with a resetsAt strictly after now and strictly before the next local midnight (process TZ), with
    left < 97. A window without resetsAt never evaporates. A candidate's evaporation score is the highest left among its evaporating
    windows. If any candidate has one, print the max line of the candidate with the highest score.
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
    And HOME starts as an empty temp dir holding only the empty claude-work config dir "$HOME/.claude-work", and the fixtures then write the
      grok snapshot to "$HOME/.grok" and the cursor auth to "$HOME/.config/cursor/auth.json"; the only DANDELION_* variables set are
      DANDELION_KIMI_PORT and DANDELION_CURSOR_API_BASE (a local cursor fixture API)
    And fixture CLIs on the PATH report the usages each scenario gives, with "S/W@R" meaning rolling S% used and weekly W% used
      resetting in R hours, and "W@R" meaning a weekly window only
    And codex is logged in with an API key, kilo reports "Balance: $14.15", and every candidate not listed is unavailable

  Scenario Outline: route prints one line
    Given the usages <usages>
    When the user runs `node src/main.ts <args>`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is 0

    Examples:
      | case                                           | args        | usages                                             | line                                |
      | evaporation beats perfect headroom             | route       | claude 0/86@2, agy 0/0@72                          | claude-opus-5 max                   |
      | highest evaporation score wins                 | route       | claude 0/86@2, cursor 60@2                         | kimi-k3-max                         |
      | evaporation tie goes to dashboard order        | route       | agy 0/90@2, kimi 0/90@2                            | gemini-3.1-pro-high high            |
      | an untouched weekly (97 left) never evaporates | route       | claude 0/3@2, agy 10/10@72                         | claude-opus-5 high                  |
      | a reset after local midnight never evaporates  | route       | claude 0/86@14, agy 10/10@72                       | gemini-3.1-pro-high medium          |
      | most headroom, claude-work highest             | route       | claude 20/30@72, claude-work 10/5@72, agy 15/20@72 | claude-opus-5 high                  |
      | most headroom, agy highest                     | route       | claude 20/30@72, agy 5/5@72                        | gemini-3.1-pro-high medium          |
      | kimi bound by its 5h window                    | route       | kimi 90/10@72, agy 50/50@72                        | gemini-3.1-pro-high medium          |
      | a missing rolling kind counts as 100           | route       | kimi 90/10@72, grok 50@72                          | grok-4.6                            |
      | kimi free on both                              | route       | kimi 10/10@72, grok 50@72                          | kimi-code/kimi-for-coding-highspeed |
      | headroom tie goes to dashboard order           | route       | agy 20/20@72, kimi 20/20@72                        | gemini-3.1-pro-high medium          |
      | an unavailable candidate is skipped            | route       | claude unavailable, cursor 40@72                   | kimi-k3-max                         |
      | later arguments are ignored                    | route extra | claude 0/86@2                                      | claude-opus-5 max                   |

  Scenario: Nothing to route
    Given every candidate is unavailable, while codex and kilo are "ok"
    When the user runs `node src/main.ts route`
    Then stdout is exactly "none" followed by one newline, stderr is empty and the exit code is 1

  Scenario Outline: route anywhere but first keeps the dashboard
    Given the usages claude 0/86@2
    When the user runs `NO_COLOR=1 node src/main.ts <args>` with stdout not a terminal
    Then the output is the 009 dashboard, its first line starts "DANDELION", and the exit code is 0

    Examples:
      | args          |
      | --once route  |
      | routes        |

  Scenario: route on a terminal still prints one line
    Given the usages claude 0/86@2
    When the user runs `dandelion route` on a terminal through a "<tmp>/bin/dandelion" symlink to src/main.ts
    Then the terminal shows only "claude-opus-5 max", with no escape sequence and no alternate screen, and the exit code is 0

  Scenario Outline: The route decision, unit level
    Given the unit tests of the route decision in "src/domain/index.test.ts", with now 2026-09-14T11:00:00.000Z and the next local
      midnight 2026-09-15T00:00:00.000Z, where "k U @T" is a window of kind k, usedPct U, resetsAt T ("-" for none)
    When the decision gets <candidates>
    Then it returns "<line>"

    Examples:
      | case                                    | candidates                                                                                                                  | line                                |
      | raw floats, headroom                    | claude: rolling 50.6 @-; agy: rolling 50.4 @-                                                                               | gemini-3.1-pro-high medium          |
      | 96.9 left evaporates                    | claude: weekly 3.1 @2026-09-14T20:00:00.000Z; agy: rolling 0 @-                                                             | claude-opus-5 max                   |
      | 97 left does not evaporate              | claude: weekly 3 @2026-09-14T20:00:00.000Z; agy: rolling 0 @-                                                               | gemini-3.1-pro-high medium          |
      | reset already past never evaporates     | claude: weekly 50 @2026-09-14T10:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z                        | gemini-3.1-pro-high medium          |
      | reset exactly at now never evaporates   | claude: weekly 50 @2026-09-14T11:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z                        | gemini-3.1-pro-high medium          |
      | reset 1 ms after now evaporates         | claude: weekly 50 @2026-09-14T11:00:00.001Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z                        | claude-opus-5 max                   |
      | a past reset still binds (stale grok)   | grok: weekly 10 @2026-09-14T10:00:00.000Z; agy: rolling 20 @-, weekly 20 @2026-09-20T00:00:00.000Z                          | grok-4.6                            |
      | weekly without resetsAt                 | claude: weekly 50 @-; agy: rolling 0 @-, weekly 40 @2026-09-20T00:00:00.000Z                                                | gemini-3.1-pro-high medium          |
      | reset exactly at local midnight         | claude: weekly 50 @2026-09-15T00:00:00.000Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z                        | gemini-3.1-pro-high medium          |
      | reset 1 ms before local midnight        | claude: weekly 50 @2026-09-14T23:59:59.999Z; agy: rolling 40 @-, weekly 40 @2026-09-20T00:00:00.000Z                        | claude-opus-5 max                   |
      | other windows neither bind nor evaporate | claude: rolling 10 @-, weekly 10 @2026-09-20T00:00:00.000Z, other 99 @2026-09-14T14:00:00.000Z; agy: rolling 20 @-, weekly 20 @2026-09-20T00:00:00.000Z | claude-opus-5 high                  |
      | ok with zero windows is excluded        | claude: no windows; cursor: weekly 60 @2026-09-20T00:00:00.000Z                                                             | kimi-k3-max                         |
      | only ok with zero windows               | claude: no windows                                                                                                          | none                                |
      | only other windows bind at 100          | claude-work: other 99 @-; agy: rolling 1 @-                                                                                 | claude-opus-5 high                  |
      | unavailable and error are excluded      | claude: unavailable; claude-work: error; kimi: weekly 90 @2026-09-20T00:00:00.000Z                                          | kimi-code/kimi-for-coding-highspeed |
      | codex never routes, even evaporating    | codex: weekly 50 @2026-09-14T20:00:00.000Z; agy: rolling 40 @-                                                              | gemini-3.1-pro-high medium          |
      | codex as the only ok provider           | codex: weekly 10 @2026-09-20T00:00:00.000Z                                                                                  | none                                |
      | kilo as the only ok provider            | kilo: no windows                                                                                                            | none                                |
    And every line of the routing table, standard and max, is pinned by a test

  Scenario Outline: Probes set the window kind
    Given the unit tests of "src/probes/<probe>.test.ts"
    When the probe reads a window labelled "<label>"
    Then that window's kind is "<kind>", and its label, usedPct and resetsAt are those of 009

    Examples:
      | probe  | label                                   | kind    |
      | claude | session                                 | rolling |
      | claude | weekly                                  | weekly  |
      | claude | weekly Fable                            | weekly  |
      | agy    | Gemini Models · Five Hour Limit         | rolling |
      | agy    | Claude and GPT models · Five Hour Limit | rolling |
      | agy    | Gemini Models · Weekly Limit            | weekly  |
      | agy    | Claude and GPT models · Weekly Limit    | weekly  |
      | agy    | Gemini Models · Daily Limit             | other   |
      | kimi   | 5h                                      | rolling |
      | kimi   | weekly                                  | weekly  |
      | grok   | credits                                 | weekly  |
      | cursor | total                                   | weekly  |
      | cursor | auto                                    | weekly  |
      | cursor | api                                     | weekly  |
      | codex  | weekly                                  | weekly  |
      | codex  | 5h                                      | other   |
      | codex  | primary                                 | other   |

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
    And "qa/010-route-command.e2e.mjs" uses temp dirs prefixed "dandelion-qa-010-", a PATH of its fixture dir and node's bin, the HOME
      of the Background, a TZ chosen from the current UTC hour, and reset instants relative to now
    And it covers every row of "route prints one line", "Nothing to route" and "route anywhere but first keeps the dashboard",
      asserting stdout, stderr and exit code exactly (the dashboard rows by their first line and exit code)
    And no e2e runs a real provider binary or reaches a real API, and every temp dir is removed
