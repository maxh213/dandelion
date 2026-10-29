Feature: 022 - hand out swarm seats, and launch one seat headless

  Assumptions (the task is silent here):
  - `seats` keeps no state between calls. The caller passes what it holds with `--held`, and `seats` answers with the full target.
  - The swarm trip is 80 unless `--trip` or `swarm.trip` says otherwise, a whole percent from 50 to 90. Like route's 90% trip, the
    trip itself trips. Route's 90% trip and `limit` still apply on top.
  - Probing works as for `route`: every probe once, or `--max-age <s>` under the rules of `route --max-age` (a value that is not a
    positive integer means no cache, and is not an error). The eligibility state file and `limit` apply exactly as for `route`.
  - binding is route's binding: the lowest left over the rolling and weekly windows route reads (the cursor api window is left out),
    100 when there are none. `score` in the JSON is that binding unrounded, or `null` for an account with no usage windows (kilo
    always). `evaporating` is true when the account has a weekly window that route's evaporation rule would take (resets after now
    and before the next local midnight with less than 97% and more than 0% left, and the account's shared windows are not spent).
  - A kept held seat keeps the line its account would get now: in `--pack` the max line with `kind` `evaporating` on an evaporating
    account, `balance` on kilo and the standard line with `headroom` otherwise; in `--spread` the `high` line of the highest rank
    its account is available for, with `kind` `chain`.
  - When kept seats add up to more than N, one seat at a time is dropped from the account whose last kept seat scores lowest
    (`binding − kept × burn`), kilo first, and on a tie from the account later in dashboard order.
  - In `--spread`, a rank's best account is the available account with room whose next seat scores highest, ties in dashboard
    order. A rank takes its next seat only when no rank with room has had fewer turns, so each rank gets a seat before any gets
    two; a kept seat counts as a turn of its rank.
  - Skip texts (the `--why` text and `skip.text`): `excluded`, `routing off`, `unavailable` (not ok) or `no usage windows`,
    `limited at <p>% (limit <l>%), back <time>`, `tripped at <p>%, back <time>`, `no headless template for <command>`,
    `not in the --high chain` or `no --high rank under <trip>%`, `cap 0` or `spent: <b>% left, one seat needs <burn + minLeft>%`,
    `balance $<x.xx>, needs above $10.00` or `balance unavailable`. Percentages are rounded like `route --why`, `<time>` is the
    `t` reset format route --why uses, and `, back <time>` is left out when the reset is unknown or past. `backAt` is the latest
    reset among the limiting or tripping windows, or `null`.
  - The `windows` of an account are all its windows, shaped as in `dandelion --json` (`usedPct` rounded) without
    `projectedFullAt`.
  - `seats` usage errors are checked before routes.json is read and before any probe. `--held`, `--include`, `--exclude` and
    `--cap` may repeat; a later value for the same account wins. `--trip` may repeat; the last wins.
  - For `run --headless`, usage errors, routes.json, the prompt file, `--cwd`, the account and the line are checked before any probe
    or launch, and with `--seat` the template too (without it, the template of the routed command is checked after routing).
    `--cwd` and `--prompt-file` are required. `--timeout` is a positive whole number of seconds. Arguments after `run --headless`
    that it does not know, a literal `--` included, are usage errors. Without `"stdin": true` the child's stdin is empty
    (`/dev/null`). The child's `PWD` is set to `--cwd`, because some CLIs (kilo) take their working directory from `PWD`. Exit-2
    messages start `dandelion: run: `, except the usual routes file line.

  Background:
    Given a fixture routes file "F" through DANDELION_ROUTES_FILE with the lines of qa/routes.fixture.json, no `swarm` section
      except where a scenario sets one, `lab` { "model-": "lab-a", "vendor/": "lab-b" } and a headless template for every command
    And usages given as a fresh snapshot.json read with `--max-age 600`, with HOME, TZ=UTC and the state file in a scratch folder
    And "<id> <r>/<w>" means an ok account with a rolling window at r% and a weekly window at w% resetting in 72 hours

  Scenario Outline: An account is skipped for the first reason that applies
    Given <setup>
    When the user runs `dandelion seats 6 --json --max-age 600`
    Then the `accounts` entry of <id> has target 0 and `skip.reason` "<reason>" and `skip.text` "<text>"

    Examples:
      | case               | setup                                                                     | id          | reason       | text                                       |
      | default exclude    | shipped swarm.exclude, claude-work 10/10                                  | claude-work | excluded     | excluded                                   |
      | --exclude          | codex 10/10 and `--exclude codex`                                         | codex       | excluded     | excluded                                   |
      | routing off        | agy 10/10 with routing off in the state file                              | agy         | ineligible   | routing off                                |
      | failed probe       | grok unavailable                                                          | grok        | unavailable  | unavailable                                |
      | no windows         | codex ok with no windows                                                  | codex       | unavailable  | no usage windows                           |
      | limit              | codex 10/76 with `limit` 75, weekly back Sat 21:40                        | codex       | limited      | limited at 76% (limit 75%), back Sat 21:40 |
      | swarm trip         | claude 83/10, session back Sat 21:40                                      | claude      | tripped      | tripped at 83%, back Sat 21:40             |
      | no template        | agy 10/10 and no headless template for agy                                | agy         | no-headless  | no headless template for agy               |
      | spread, no chain   | kimi 10/10 and `--spread`                                                 | kimi        | not-in-chain | not in the --high chain                    |
      | spread, all gated  | cursor at 85% total and `--spread`                                        | cursor      | not-in-chain | no --high rank under 80%                   |
      | headroom           | grok at 88% credits                                                       | grok        | spent        | spent: 12% left, one seat needs 15%        |
      | cap 0              | codex 10/10 and `--cap codex=0`                                           | codex       | spent        | cap 0                                      |
      | kilo at the floor  | kilo balance $10.00                                                       | kilo        | balance      | balance $10.00, needs above $10.00         |

  Scenario Outline: The swarm trip line
    Given claude <used>/10 and nothing else routable
    When the user runs `dandelion seats 1 --json --max-age 600 <flags>`
    Then claude gets <target> seats and the exit code is <code>

    Examples:
      | used | flags      | target | code |
      | 80   |            | 0      | 1    |
      | 79   |            | 1      | 0    |
      | 80   | --trip 85  | 1      | 0    |
      | 70   | --trip 70  | 0      | 1    |

  Scenario: Work accounts are excluded by default and --include lifts that for one call
    Given the shipped swarm section and claude-work 10/10, nothing else routable
    When the user runs `dandelion seats 2 --max-age 600`
    Then stdout is "none" and the exit code is 1
    When the user runs `dandelion seats 2 --max-age 600 --include claude-work`
    Then stdout is two lines "model-b high claude-work" and the exit code is 0

  Scenario: Held seats are kept, so a repeated call does not churn
    Given codex 10/10 and claude 5/5, with caps of 3
    When the user runs `dandelion seats 2 --json --max-age 600 --held codex=2`
    Then `seats` is two codex seats with `held: true`, even though claude scores higher
    And with codex tripped at 85/10, the same call gives codex target 0 and `skip.reason` "tripped"

  Scenario: Kept seats beyond N are dropped from the lowest scores first
    Given codex 10/40 and agy 10/10
    When the user runs `dandelion seats 3 --json --max-age 600 --held codex=2,agy=2`
    Then agy keeps 2 seats and codex keeps 1, and every seat has `held: true`

  Scenario: --pack serves an evaporating account first, with its max line
    Given claude 10/10 and agy 10/50 whose weekly window resets two hours before local midnight
    When the user runs `dandelion seats 4 --max-age 600`
    Then the first lines are agy's max line "model-c max agy" (kind evaporating), as many as agy's headroom allows
    And the rest go to claude with "model-a high claude" (kind headroom)

  Scenario: --pack gives each next seat to the highest effective score
    Given claude 0/20, codex 0/45 and burn 10, minLeft 5, caps of 4
    When the user runs `dandelion seats 4 --json --max-age 600`
    Then the seats go claude, claude, claude, codex in that order
    Because claude's next seats score 70, 60, 50 and 40 against codex's 45, and a tie would go to claude, earlier in dashboard order

  Scenario: The headroom rule and the caps
    Given codex 0/70 (binding 30), burn 10, minLeft 5 and cap 4
    When the user runs `dandelion seats 10 --json --max-age 600`
    Then codex gets 2 seats, because a third would leave 0% < 5%
    And with `--cap codex=1` it gets 1 seat, and with kilo $14.15 the next seat goes to kilo with kind balance

  Scenario: --spread with six available ranks gives one seat per rank, then a second only where room allows
    Given claude, codex, cursor, grok and agy all at 10% or less, claude's Fable window at 10%, caps of 3 and burn 10
    When the user runs `dandelion seats 6 --spread --json --max-age 600`
    Then there is exactly one seat per rank fable, codex, cursor, opus, grok and agy, with that rank's high line and `kind` chain
    When the user runs `dandelion seats 12 --spread --json --max-age 600`
    Then each rank has two seats except where its accounts' caps and headroom leave no room, and no rank has three

  Scenario: --json prints the contract object on one line
    When the user runs `dandelion seats 6 --json --max-age 600`
    Then stdout is one line of JSON with exactly `generatedAt`, `mode`, `requested`, `trip`, `seats` and `accounts`
    And every seat has `account`, `line`, `model`, `effort`, `command`, `lab`, `kind`, `rank`, `rankName` and `held`
    And `accounts` lists all fourteen routed accounts in dashboard order, kilo included, each with `id`, `command`, `cap`, `held`,
      `target`, `score`, `evaporating`, `balance`, `skip` and `windows`
    And a "model-i high codex" seat has model "model-i", effort "high", command "codex", lab "lab-a"; a line without effort has
      effort null, and a model matching no prefix has lab "unknown"

  Scenario Outline: seats usage errors exit 2 without probing
    When the user runs `dandelion seats <args>`
    Then stdout is empty, stderr is one line starting "dandelion: seats: " and the exit code is 2

    Examples:
      | args                       |
      | 0                          |
      | 201                        |
      |                            |
      | three                      |
      | 3 --pack --spread          |
      | 3 --bogus                  |
      | 3 --held claude-wrok=1     |
      | 3 --held codex=201         |
      | 3 --held codex             |
      | 3 --cap codex=21           |
      | 3 --trip 91                |
      | 3 --trip 49                |
      | 3 --include nobody         |
      | 3 4                        |

  Scenario: Exit codes and the bad routes file
    Then a call with at least one seat exits 0, a call with none prints "none" (or JSON with empty `seats`) and exits 1
    And with a bad routes file `seats` prints nothing on stdout, the usual `dandelion: routes file …` line, and exits 2

  Scenario: seats owns its options, so --json is seats JSON
    When the user runs `dandelion seats 3 --json`
    Then stdout is seats JSON with `seats` and `accounts`, not the dashboard JSON with `providers`

  Scenario: --why lists every skipped account after the seat lines
    Given claude 83/10 back Sat 21:40 and codex 10/10
    When the user runs `dandelion seats 2 --why --max-age 600`
    Then stdout starts with the seat lines, then has "# skip claude: tripped at 83%, back Sat 21:40" and one `# skip` line per other
      skipped account in dashboard order

  Scenario Outline: run --headless exit codes
    Given <setup>
    When the user runs `dandelion run --headless <args>`
    Then the exit code is <code> and stderr is <stderr>

    Examples:
      | case                     | setup                                   | args                                                                  | code | stderr                                                                     |
      | child code               | a fake claude that exits 3              | --seat "model-a high claude" --prompt-file p --cwd d                  | 3    | empty                                                                      |
      | timeout                  | a fake claude that sleeps               | --seat "model-a high claude" --prompt-file p --cwd d --timeout 1      | 124  | empty                                                                      |
      | CLI not on PATH          | no claude on PATH                       | --seat "model-a high claude" --prompt-file p --cwd d                  | 127  | "dandelion: claude: command not found"                                     |
      | none                     | nothing routable                        | --prompt-file p --cwd d                                               | 1    | "none"                                                                     |
      | kilo balance             | kilo profile balance $10                | --seat "vendor/model-k max kilo" --prompt-file p --cwd d              | 1    | "dandelion: kilo balance at or below $10"                                  |
      | missing --prompt-file    |                                         | --seat "model-a high claude" --cwd d                                  | 2    | a "dandelion: run: " line                                                  |
      | unreadable prompt        |                                         | --seat "model-a high claude" --prompt-file nope --cwd d               | 2    | a "dandelion: run: " line                                                  |
      | missing cwd              |                                         | --seat "model-a high claude" --prompt-file p --cwd nope               | 2    | a "dandelion: run: " line                                                  |
      | unknown account          |                                         | --seat "model-a high claudee" --prompt-file p --cwd d                 | 2    | "dandelion: run: unknown account claudee"                                  |
      | bad line shape           |                                         | --seat "model-a  high claude" --prompt-file p --cwd d                 | 2    | a "dandelion: run: " line                                                  |
      | bad routes file          | DANDELION_ROUTES_FILE missing           | --seat "model-a high claude" --prompt-file p --cwd d                  | 2    | "dandelion: routes file …"                                                 |
      | no template              | no template for agy                     | --seat "model-c high agy" --prompt-file p --cwd d                     | 2    | "dandelion: run: no headless template for agy"                             |
      | prompt too long          | a {prompt} template, 120001-byte prompt | --seat "model-d kimi" --prompt-file big --cwd d                       | 2    | "dandelion: run: prompt too long for kimi; use a stdin or {promptFile} template" |
      | unknown option           |                                         | --seat "model-a high claude" --prompt-file p --cwd d --bogus          | 2    | a "dandelion: run: " line                                                  |
      | bad timeout              |                                         | --seat "model-a high claude" --prompt-file p --cwd d --timeout 0      | 2    | a "dandelion: run: " line                                                  |

  Scenario: run --headless builds argv from the template and launches in --cwd
    Given the template { "before": ["exec"], "after": ["--yes", "{promptFile}", "{prompt}"], "stdin": true } for codex
    When the user runs `dandelion run --headless --seat "model-i high codex-animus" --prompt-file p --cwd d`
    Then codex runs in d as `codex exec --model model-i -c model_reasoning_effort=high --yes <absolute p> <contents of p>`
    And its stdin is the prompt file, its env has CODEX_HOME set to the animus home and PWD set to d, and its stdout and stderr
      pass through

  Scenario: run --headless without --seat launches what plain run would
    Given claude routable and `run` would launch "model-a high claude"
    When the user runs `dandelion run --headless --prompt-file p --cwd d`
    Then claude runs headless with "model-a high claude"; `--high` and `--max-age` work as for plain `run`

  Scenario: run --headless forwards signals while the child runs
    When dandelion receives SIGTERM, SIGHUP or SIGINT while the headless child runs
    Then the child receives the same signal and dandelion exits with the child's status only after the child has exited
    And no handler is left once the child has exited

  Scenario: Plain run is unchanged
    Then `dandelion run` without `--headless` launches as before, with its arguments passed through
