Feature: 001 - Scaffold Kilo Probe

  Scenario: Display kilo balance successfully
    Given a working `kilo` CLI in the PATH that responds to `kilo profile`
    And `kilo profile` output contains:
      """
      Name: Max
      Email: yeti213@googlemail.com
      Team: Personal
      Balance: $14.15
      """
    And the environment variable ALLOWANCE_KILO_REFERENCE is set to "20"
    When the user runs `npm start`
    Then the process exits with code 0
    And the output displays a banner with "ALLOWANCE" and the fetch time
    And the output displays a "kilo" provider panel with a heavy top rule
    And the panel displays the balance "$14.15"
    And the panel displays a 20-cell gauge with 14 filled cells (`█`) and 6 empty cells (`░`)
    And the panel displays a dim caption "api balance · kilo"

  Scenario: Kilo CLI is missing from PATH
    Given no `kilo` CLI is available in the PATH
    When the user runs `npm start`
    Then the process exits with code 0
    And the output displays a banner with "ALLOWANCE"
    And the output displays a dim unavailable panel for "kilo"
    And the panel displays a reason indicating the CLI was not found

  Scenario: Kilo CLI returns unparseable output
    Given a `kilo` CLI in the PATH that responds to `kilo profile`
    And `kilo profile` output does not contain a valid Balance line
    When the user runs `npm start`
    Then the process exits with code 0
    And the output displays a banner with "ALLOWANCE"
    And the output displays a dim unavailable panel for "kilo"
    And the panel displays a reason indicating the output could not be parsed

  Scenario: Kilo CLI times out or errors
    Given a `kilo` CLI in the PATH that hangs or exits with a non-zero code when `kilo profile` is run
    When the user runs `npm start`
    Then the process exits with code 0
    And the output displays a banner with "ALLOWANCE"
    And the output displays a dim unavailable panel for "kilo"
    And the panel displays a reason indicating the CLI errored or timed out
