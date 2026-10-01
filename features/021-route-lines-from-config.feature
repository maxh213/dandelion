Feature: 021 - read route lines from routes.json, and route claude as Opus 5.5

  Assumptions (the task is silent here):
  - The shipped file is `<dir>/../routes.json`, where `<dir>` is the folder of the real path of `src/main.ts` after every symlink
    is followed. A relative `DANDELION_ROUTES_FILE` is taken relative to the working directory, as any path in an env variable is.
  - `route`, `route --high` and `--once` read the file once per run. The live dashboard reads it once at start, so an edit shows
    after a restart.
  - The error is one stderr line `dandelion: routes file <path>: <what is wrong>`. `<path>` is DANDELION_ROUTES_FILE as given, or
    the real path of the shipped file. When the file has several faults, the line names one of them. The wording after the path is
    the coder's, but for a key fault it contains the key name listed below.
  - The file is checked whole on every run, so a fault in `high` also fails plain `route`, and a fault in `route` fails `--high`.
    A bad file wins over `none`: with a bad file and no quota, the exit code is 2.
  - Tie order (dashboard order) and the --high chain order stay in code; the order of keys in the file means nothing.
  - Unknown keys fail at every level: top level (only `route` and `high`), provider ids (codex and kilo included), `high` names and
    keys inside a provider entry (only `standard` and `max`). A line matches `^\S+( \S+)?$`: one or two words, one space apart.
  - `--once` has no route boxes (013). With a bad file it prints its dashboard unchanged on stdout, the error line on stderr, and
    exits 0. In the live dashboard, once the probes settle, both boxes are dim, like a `none` box, and show `routes file error` over
    the start of `<what is wrong>`, cut to the box's 31 text cells. For the `claude-wrok` case below that row shows `claude-wrok`.
  - `features/010`–`020` are frozen for every role, so they keep the strings true when they ran, like `tasks/001`–`020`, until a
    human unfreezes them. QA owns `qa/**` and moves `qa/010`–`020` to fixture files.

  Background:
    Given the fixtures, HOME, TZ and DANDELION_* variables of features/020-route-kimi-k3-grok-47.feature
    And "S/W@R" usages as in features/014-route-session-trip.feature, and "claude S/W/F" for `--high` as in features/012-route-high.feature
    And junie and hermes percentages as in features/020-route-kimi-k3-grok-47.feature, and every provider not listed is unavailable
    And the file "F" holds
      """
      { "route": {
          "claude":      { "standard": "model-a high",         "max": "model-a max" },
          "claude-work": { "standard": "model-b high",         "max": "model-b max" },
          "claude-deepseek": { "standard": "vendor/model-o max", "max": "vendor/model-o max" },
          "agy":         { "standard": "model-c high",         "max": "model-c max" },
          "kimi":        { "standard": "model-d",              "max": "model-d max" },
          "grok":        { "standard": "model-e xhigh",        "max": "model-e xhigh" },
          "cursor":      { "standard": "model-f",              "max": "model-f" },
          "junie":       { "standard": "model-g high",         "max": "model-g high" },
          "hermes":      { "standard": "vendor/model-h xhigh", "max": "vendor/model-h xhigh" } },
        "high": { "fable": "model-h1 max", "cursor": "model-h2", "opus": "model-h3 max", "grok": "model-h4 xhigh", "agy": "model-h5 high" } }
      """

  Scenario Outline: route prints the line F holds for the provider and rule that win
    Given DANDELION_ROUTES_FILE is F and the usages <usages>
    When the user runs `node src/main.ts route`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is <code>

    Examples:
      | case                     | usages                                       | line                        | code |
      | claude evaporates        | claude 0/86@2, agy 0/0@72                    | model-a max claude          | 0    |
      | claude headroom          | claude 0/3@2, agy 10/10@72                   | model-a high claude         | 0    |
      | claude-work headroom     | claude 20/30@72, work 10/5@72, agy 15/20@72  | model-b high claude-work    | 0    |
      | agy evaporates, tie      | agy 0/90@2, kimi 0/90@2                      | model-c max agy             | 0    |
      | one-word kimi line       | kimi 10/10@72, grok 50@72                    | model-d kimi                | 0    |
      | grok                     | grok 50@72                                   | model-e xhigh grok          | 0    |
      | cursor                   | cursor 40@72                                 | model-f cursor              | 0    |
      | junie tie-breaker        | junie 0%, hermes 0%                          | model-g high junie          | 0    |
      | hermes                   | hermes 75%                                   | vendor/model-h xhigh hermes | 0    |
      | 014 live case            | the 014 live case, junie 30%, hermes 75%     | model-e xhigh grok          | 0    |
      | nothing routable         | none                                         | none                        | 1    |

  Scenario Outline: route --high prints the line F holds for the rank that wins
    Given DANDELION_ROUTES_FILE is F and the usages <usages>
    When the user runs `node src/main.ts route --high`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is <code>

    Examples:
      | rank | usages                              | line                  | code |
      | 1    | claude 3/86/10                      | model-h1 max claude   | 0    |
      | 2    | claude 95/10/10, cursor 60          | model-h2 cursor       | 0    |
      | 3    | claude 10/10/95                     | model-h3 max claude   | 0    |
      | 4    | claude 95/10/10, cursor 95, grok 60 | model-h4 xhigh grok   | 0    |
      | 5    | agy 10/10                           | model-h5 high agy     | 0    |
      | -    | none                                | none                  | 1    |

  Scenario Outline: Key order in the file changes no tie and no --high pick
    Given the file "R", which is F with the keys of `route` and the keys of `high` each in reverse order
    And DANDELION_ROUTES_FILE is R and the usages <usages>
    When the user runs `node src/main.ts <command>`
    Then stdout is exactly "<line>" followed by one newline, stderr is empty and the exit code is 0

    Examples:
      | command      | usages                     | line                |
      | route        | agy 0/90@2, kimi 0/90@2    | model-c max agy     |
      | route        | junie 0%, hermes 0%        | model-g high junie  |
      | route --high | claude 3/86/10, agy 10/10  | model-h1 max claude |
      | route --high | claude 10/10/95, grok 60   | model-h3 max claude |

  Scenario Outline: Unset or empty DANDELION_ROUTES_FILE reads the checkout's routes.json, wherever dandelion is run from
    Given a folder D whose "routes.json" is F with every "model-" replaced by "decoy-"
    And "lib/dandelion" a symlink to the checkout and "bin/dandelion" a symlink to "lib/dandelion/src/main.ts", as `npm link` makes
    And a copy of that decoy file in D, in "lib", in "bin" and in their parent, and DANDELION_ROUTES_FILE <setting>
    When the user runs `dandelion route` through "bin" with the working directory D and usages grok 50@72
    Then stdout is the checkout's `route.grok.standard` value, a space and "grok", exit 0, and no output contains "decoy"

    Examples:
      | setting        |
      | unset          |
      | set to ""      |

  Scenario: A relative DANDELION_ROUTES_FILE is found from the working directory
    Given the folder D above, DANDELION_ROUTES_FILE "routes.json" and usages grok 50@72
    When the user runs `dandelion route` through "bin" with the working directory D
    Then stdout is exactly "decoy-e xhigh grok" and the exit code is 0

  Scenario: The first edit ships with the task
    Then "routes.json" at the repo root parses to the same value as the JSON block in tasks/021-route-lines-from-config.md
    And with DANDELION_ROUTES_FILE unset, `route` for claude 0/3@2, agy 10/10@72 prints "claude-opus-5-5 high claude",
      for claude 0/86@2 prints "claude-opus-5-5 max claude", and `route --high` for claude 10/10/95 prints "claude-opus-5-5 max claude"
    And every non-claude line the shipped file prints is the line 020 printed
    And this scenario and qa/021 step 1 are the only acceptance checks that name a real model, and no test or e2e file pins them

  Scenario: Changing a routed model is a one-line edit to routes.json
    Given a copy of the checkout whose routes.json has `route.claude.standard` set to "model-z high"
    When the user runs that copy's `src/main.ts route` for claude 0/3@2, agy 10/10@72
    Then stdout is exactly "model-z high claude" and the exit code is 0
    And with every line of the checkout's routes.json replaced by another valid line, `npm test` and `node qa/e2e.mjs` still pass
    And with the checkout's routes.json removed, exactly one unit test fails: the one that checks the shipped file

  Scenario Outline: A bad routes file is an error on route and route --high
    Given DANDELION_ROUTES_FILE is "<file>", made from F by <change>, and usages grok 50@72
    When the user runs `node src/main.ts route`, and then `node src/main.ts route --high`
    Then each time stdout is empty, the exit code is 2, and stderr is one line starting "dandelion: routes file <file>: "
    And that line contains "<names>"

    Examples:
      | case                  | file              | change                                             | names        |
      | missing               | /tmp/r/nope.json  | no file at all                                     | nope.json    |
      | a folder              | /tmp/r            | the path is a folder                               | /tmp/r       |
      | invalid JSON          | /tmp/r/bad.json   | the text `{"route":`                               | bad.json     |
      | empty                 | /tmp/r/bad.json   | an empty file                                      | bad.json     |
      | not an object         | /tmp/r/bad.json   | the text `[]`                                      | bad.json     |
      | top-level null        | /tmp/r/bad.json   | the text `null`                                    | bad.json     |
      | route not an object   | /tmp/r/bad.json   | route set to []                                    | route        |
      | high not an object    | /tmp/r/bad.json   | high set to "x"                                    | high         |
      | provider missing      | /tmp/r/bad.json   | removing route.hermes                              | hermes       |
      | high entry missing    | /tmp/r/bad.json   | removing high.opus                                 | opus         |
      | max missing           | /tmp/r/bad.json   | removing route.agy.max                             | agy          |
      | entry not an object   | /tmp/r/bad.json   | route.claude set to "model-a high"                 | claude       |
      | empty line            | /tmp/r/bad.json   | route.kimi.standard set to ""                      | kimi         |
      | not a string          | /tmp/r/bad.json   | high.grok set to 4                                 | grok         |
      | provider typo         | /tmp/r/bad.json   | adding route.claude-wrok, a copy of route.claude   | claude-wrok  |
      | codex is not routed   | /tmp/r/bad.json   | adding route.codex, a copy of route.cursor         | codex        |
      | unknown high name     | /tmp/r/bad.json   | adding high.sonnet "model-x"                       | sonnet       |
      | unknown top-level key | /tmp/r/bad.json   | adding "extra": {}                                 | extra        |
      | unknown entry key     | /tmp/r/bad.json   | adding route.cursor.maxx "model-f"                 | maxx         |
      | three words           | /tmp/r/bad.json   | route.claude.max set to "model-a max extra"        | claude       |
      | leading space         | /tmp/r/bad.json   | high.fable set to " model-h1 max"                  | fable        |
      | trailing space        | /tmp/r/bad.json   | route.grok.standard set to "model-e xhigh "        | grok         |
      | two spaces            | /tmp/r/bad.json   | route.junie.max set to "model-g  high"             | junie        |
      | tab                   | /tmp/r/bad.json   | route.hermes.standard set to "vendor/model-h<TAB>xhigh" | hermes  |

  Scenario: A bad file wins over none, and a missing shipped file names its real path
    Given DANDELION_ROUTES_FILE is "/tmp/r/nope.json" and no provider is available
    When the user runs `node src/main.ts route`
    Then stdout is empty and the exit code is 2, not 1
    Given a copy C of the checkout's "src" and "package.json" with no routes.json, and DANDELION_ROUTES_FILE unset or ""
    When the user runs `node C/src/main.ts route` for grok 50@72
    Then stdout is empty, the exit code is 2 and stderr starts "dandelion: routes file <real path of C>/routes.json: "
    And with DANDELION_ROUTES_FILE F the same copy prints "model-e xhigh grok" and exits 0

  Scenario: The dashboard still shows every panel when the file is bad
    Given DANDELION_ROUTES_FILE is F with route.claude-wrok added, and the healthy fixture of qa/013-route-boxes.md
    When the user runs the live dashboard with NO_COLOR set and waits for it to settle
    Then every panel shows what it shows with F, and both route boxes show "routes file error" over a row with "claude-wrok"
    And each box's row 1 is exactly "| routes file error" + " " x15 + "|", and its row 2 is "| ", the start of `<what is wrong>`
      padded or cut to 31 cells, then " |"
    And pressing `q` exits 0
    When the user runs the live dashboard without NO_COLOR and waits for it to settle
    Then each box's top and bottom lines are as in "Box colours" of features/013-route-boxes.feature
    And its row 1 is one dim span, borders included: "\e[90m│ routes file error" + " " x15 + "│\e[0m"
    And its row 2 is one dim span the same way, "\e[90m│ " + the 31 padded cells + " │\e[0m", holding "claude-wrok" and no "\e[1m"
    When the user runs `node src/main.ts --once` instead
    Then stdout is the dashboard it prints with F, stderr is one line starting "dandelion: routes file " and containing "claude-wrok",
      and the exit code is 0

  Scenario: The route boxes show F's lines
    Given DANDELION_ROUTES_FILE is F and the healthy fixture of qa/013-route-boxes.md
    When the user runs the live dashboard with NO_COLOR set and waits for it to settle
    Then the route box shows "model-b high" over "claude-work" and the route --high box shows "model-h1 max" over "claude-work"

  Scenario: Living surfaces stop pinning real model names
    Then src/domain/route.ts has no CLAUDE_LINES and no line strings in ROUTING_TABLE or HIGH_CHAIN; it gets the lines through a port
    And `grep -rlE 'claude-opus|claude-fable|gemini-3|kimi-code/|kimi-k3|grok-4\.' src perf qa` lists only qa/021-route-lines-from-config.md
    And exactly one unit test reads the shipped routes.json; it checks every routed provider and every high entry is present and
      valid by the rules above, and names no model
    And every other unit test, perf bench and qa/010–020 procedure and e2e file routes through DANDELION_ROUTES_FILE with made-up
      lines, keeping its inputs and its outcome: the winning provider, the rule that fired, or `none`
    And README.md documents routes.json, its shape, DANDELION_ROUTES_FILE in its environment list, the exit-2 errors, and
      "to change a routed model, edit routes.json"; its route and --high tables name providers and ranks, point at routes.json for
      the lines and hold no line strings; an example output may use a real line from the shipped file
    And tasks/001–020 and features/010–020 are unchanged

  Scenario: Nothing else changes
    Then evaporation, the sub-97% weekly rule, headroom, the inclusive 90% trip, the --high chain order, providers and fable matcher,
      eligibility toggles and the state file, ties by dashboard order, and `none` with exit 1 behave as in 020
    And output stays "<line> <provider id>" or `none` alone, and with the shipped file every line but the claude ones is 020's
    And every probe, the dashboard layout and the route boxes outside the error case are unchanged
