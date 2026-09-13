Feature: 004 - Grok window from its local billing log

  Row layout, gauge math, ramp colours and NO_COLOR rules are those of features/002-claude-agy.feature.
  Grok home is ALLOWANCE_GROK_HOME, or "~/.grok" when it is unset or empty. The log is "<grok home>/logs/unified.jsonl".
  A billing event is a line that parses as a JSON object whose "msg" is "billing: fetched credits config".
  It is usable when "ts" is a valid instant and ctx.config.creditUsagePercent is a finite JSON number >= 0.
  The newest usable billing event wins: the one nearest the end of the file. Every other line is skipped, and no line crashes the app.
  usedPct = creditUsagePercent rounded half-up to a whole number, not capped at 100.
  resetsAt = ctx.config.currentPeriod.end when it is a valid instant, else the row has no countdown.
  Plan label = ctx.subscriptionTier when it is a non-empty string, else "grok".
  Age = now minus "ts", in the countdown format of features/002-claude-agy.feature, floored at 0.
  The snapshot is stale when its age is more than 48 hours.
  The app never creates, modifies or deletes anything under grok home.
  The 004 scenario "No CLI on the PATH at all" replaces the 003 one: there are now five panels.

  Background:
    Given the current time is "2026-09-13T10:00:00Z"
    And the `claude`, `agy`, `kimi` and `kilo` fixtures of features/003-kimi.feature are in the PATH
    And ALLOWANCE_GROK_HOME is a directory whose "logs/unified.jsonl" holds these lines:
      """
      {"ts":"2026-09-11T08:00:00.000Z","msg":"session started","ctx":{}}
      {"ts":"2026-09-11T09:00:00.000Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":60.0,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"2026-09-06T21:15:36.133376+00:00","end":"2026-09-13T21:15:36.133376+00:00"}},"subscriptionTier":"SuperGrok"}}
      not json at all
      {"ts":"2026-09-12T16:00:00.000Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":75.0,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"2026-09-06T21:15:36.133376+00:00","end":"2026-09-13T21:15:36.133376+00:00"}},"subscriptionTier":"SuperGrok Heavy"}}
      {"ts":"2026-09-12T16:00:01.000Z","msg":"tool call finished","ctx":{"tool":"bash"}}
      """

  Scenario: Grok panel renders the newest snapshot between kimi and kilo
    When the user runs `npm start` with NO_COLOR set
    Then the process exits with code 0
    And the panels appear in the order "claude", "agy", "kimi", "grok", "kilo"
    And the grok panel is exactly these lines: rule, "grok", then
      """
      credits                             ###############-----  75% ↻ 11h15m
      snapshot 18h0m old
      SuperGrok Heavy · grok
      """
    And the claude, agy, kimi and kilo panels are unchanged from features/003-kimi.feature
    And every line is at most 72 columns wide

  Scenario: Fresh grok panel colours
    When the user runs `npm start` without NO_COLOR
    Then the grok gauge and "75%" carry the warm escape
    And the "snapshot 18h0m old" line and the "SuperGrok Heavy · grok" caption are dim

  Scenario Outline: Snapshot age and staleness
    Given the newest billing event's ts is "<ts>"
    When the user runs `npm start` with NO_COLOR set
    Then the grok panel still shows the "credits" row at 75% with "↻ 11h15m"
    And the line under the rows is exactly "<line>"
    And <style>

    Examples:
      | ts                       | line                         | style                                                          |
      | 2026-09-13T09:59:00.000Z | snapshot 0h1m old            | the panel is not stale                                         |
      | 2026-09-13T11:00:00.000Z | snapshot 0h0m old            | the panel is not stale                                         |
      | 2026-09-11T10:00:00.000Z | snapshot 2d0h old            | the panel is not stale                                         |
      | 2026-09-11T09:59:59.000Z | stale snapshot 2d0h old      | the panel is stale                                             |
      | 2026-09-10T17:14:22.812Z | stale snapshot 2d16h old     | the panel is stale                                             |

  Scenario: A stale grok panel is dim throughout
    Given the newest billing event's ts is "2026-09-10T17:14:22.812Z"
    When the user runs `npm start` without NO_COLOR
    Then every grok panel line, the rule, the name, the row, "stale snapshot 2d16h old" and the caption, is dim
    And the grok gauge and percent carry no ramp escape
    And the other panels keep their normal colours

  Scenario Outline: Billing event variations
    Given the log's only billing event is <event>
    When the user runs `npm start` with NO_COLOR set
    Then the grok panel is ok with the row exactly "<row>" and the caption "<caption>"

    Examples:
      | event                                                                                                                                 | row                                                           | caption                |
      | {"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":75}}}                     | credits                             ###############-----  75% | grok · grok            |
      | {"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":33.5},"subscriptionTier":""}} | credits                             #######-------------  34% | grok · grok            |
      | {"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":0},"subscriptionTier":7}}  | credits                             --------------------   0% | grok · grok            |
      | {"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":130,"currentPeriod":{"end":"soon"}},"subscriptionTier":"SuperGrok"}} | credits                             #################### 130% | SuperGrok · grok       |
      | {"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":75,"currentPeriod":null}}} | credits                             ###############-----  75% | grok · grok            |

  Scenario: Unusable billing events are skipped in favour of an older usable one
    Given these lines are appended after the 75% event:
      """
      {"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":"90"}}}
      {"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":-5}}}
      {"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config","ctx":{"config":null}}
      {"ts":"later","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":95}}}
      {"msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":95}}}
      {"ts":"2026-09-13T09:00:00Z","msg":"billing: fetched credits config"
      [1,2,3]
      null

      """
    When the user runs `npm start` with NO_COLOR set
    Then the process exits with code 0
    And the grok panel shows "credits" at 75%, "snapshot 18h0m old" and the caption "SuperGrok Heavy · grok"

  Scenario Outline: No usable grok snapshot renders a dim unavailable panel
    Given <condition>
    When the user runs `npm start`
    Then the process exits with code 0 within 5 seconds
    And the grok panel is dim, shows no gauge and no snapshot line, and shows the reason "no grok billing snapshot — run grok once" and the caption "grok · grok"
    And the claude, agy, kimi and kilo panels still render normally, in order around it

    Examples:
      | condition                                                              |
      | ALLOWANCE_GROK_HOME is an empty directory                              |
      | ALLOWANCE_GROK_HOME names a path that does not exist                   |
      | "logs/unified.jsonl" is an empty file                                  |
      | "logs/unified.jsonl" holds only the two non-billing lines of the Background |
      | "logs/unified.jsonl" holds only unusable billing events                |
      | "logs/unified.jsonl" exists but is not readable (mode 000)             |
      | "logs/unified.jsonl" is a directory                                    |

  Scenario Outline: Grok home defaults to ~/.grok
    Given ALLOWANCE_GROK_HOME is <value> and HOME is a directory whose ".grok/logs/unified.jsonl" holds the Background lines
    When the user runs `npm start` with NO_COLOR set
    Then the grok panel shows "credits" at 75% and the caption "SuperGrok Heavy · grok"

    Examples:
      | value     |
      | unset     |
      | set to "" |

  Scenario: The app never writes to grok home
    When the user runs `npm start` against the Background grok home and against an empty grok home
    Then after each run the grok home holds exactly the same paths, sizes, contents and modification times as before

  Scenario: No CLI on the PATH at all
    Given the PATH contains no `claude`, `agy`, `kimi` or `kilo` and ALLOWANCE_GROK_HOME is an empty directory
    When the user runs `npm start`
    Then the process exits with code 0
    And five dim unavailable panels render in order:
      | name   | reason                                   | caption              |
      | claude | claude CLI not found in PATH             | claude code · claude |
      | agy    | agy CLI not found in PATH                | agy · agy            |
      | kimi   | kimi CLI not found in PATH               | kimi code · kimi     |
      | grok   | no grok billing snapshot — run grok once | grok · grok          |
      | kilo   | kilo CLI not found in PATH               | api balance · kilo   |

  Scenario: README documents grok
    When I read "README.md"
    Then the intro sentence names `claude`, `agy`, `kimi` and `grok` as the subscription usage windows and `kilo` as the API balance
    And the provider list names `grok` between `kimi` and `kilo`, says it reads the newest billing snapshot from `<grok home>/logs/unified.jsonl` without running grok, and says a snapshot older than 48h is shown dim as stale
    And it says "All five probes run in parallel" and no longer says "All four probes run in parallel"
    And the env-var ledger lists `ALLOWANCE_GROK_HOME` with default `~/.grok`

  Scenario: Earlier end-to-end checks keep passing
    When the user runs `node qa/e2e.mjs`
    Then every e2e passes, including the 001, 002 and 003 e2es and the new 004 grok e2es, whether or not the tester has a real ~/.grok
    And "qa/004-grok.e2e.mjs" creates its fixture dirs with the temp prefix "allowance-qa-004-" and runs `npm start` twice with PATH set to only its fixture dir and node's dir, NO_COLOR set, and ALLOWANCE_GROK_HOME set to a fixture grok home
    And in the first run the grok home log holds the Background lines with the 75% event's ts set to 1 hour before the run, and it asserts exit code 0, the grok panel between kimi and kilo, a "credits" row at "75%", a "snapshot " line, and the caption "SuperGrok Heavy · grok"
    And in the second run the grok home is empty, and it asserts exit code 0 and the lines "grok", "no grok billing snapshot — run grok once", "grok · grok" in a row
    And after each run it asserts the grok home is unchanged
    And no e2e invokes a real `claude`, `agy`, `kimi`, `grok` or `kilo` binary
    And package.json still has no "dependencies" section
