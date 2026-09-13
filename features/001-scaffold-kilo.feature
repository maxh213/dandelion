Feature: 001 - Scaffold Kilo Probe

  Scenario: Display kilo balance successfully with default reference
    Given a working `kilo` CLI in the PATH that responds to `kilo profile`
    And `kilo profile` output contains:
      """
      Name: Max
      Email: yeti213@googlemail.com
      Team: Personal
      Balance: $14.15
      """
    And the environment variable ALLOWANCE_KILO_REFERENCE is unset
    When the user runs `npm start`
    Then the process exits with code 0
    And the output displays a banner with "ALLOWANCE" and the fetch time
    And the output displays a "kilo" provider panel with a heavy top rule
    And the panel displays the balance "$14.15"
    And the panel displays a 20-cell gauge with 14 filled cells (`█`) and 6 empty cells (`░`)
    And the panel displays a dim caption "api balance · kilo"

  Scenario: Gauge fill count rounds half-up
    Given a working `kilo` CLI in the PATH
    And `kilo profile` output contains "Balance: $14.50"
    And the environment variable ALLOWANCE_KILO_REFERENCE is unset
    When the user runs `npm start`
    Then the panel displays a 20-cell gauge with 15 filled cells (`█`) and 5 empty cells (`░`)

  Scenario: Balance exceeds the reference amount
    Given a working `kilo` CLI in the PATH
    And `kilo profile` output contains "Balance: $25.00"
    And the environment variable ALLOWANCE_KILO_REFERENCE is unset
    When the user runs `npm start`
    Then the panel displays a 20-cell gauge with 20 filled cells (`█`) and 0 empty cells (`░`)

  Scenario: Gauge is empty when no reference is provided
    Given a working `kilo` CLI in the PATH
    And `kilo profile` output contains "Balance: $14.15"
    And the environment variable ALLOWANCE_KILO_REFERENCE is set to ""
    When the user runs `npm start`
    Then the panel displays a 20-cell gauge with 0 filled cells (`█`) and 20 empty cells (`░`)

  Scenario: Kilo CLI is missing from PATH
    Given no `kilo` CLI is available in the PATH
    When the user runs `npm start`
    Then the process exits with code 0
    And the output displays a banner with "ALLOWANCE"
    And the output displays a dim unavailable panel for "kilo"
    And the panel displays the reason "kilo CLI not found in PATH"

  Scenario: Kilo CLI returns unparseable output
    Given a `kilo` CLI in the PATH that responds to `kilo profile`
    And `kilo profile` output does not contain a valid Balance line
    When the user runs `npm start`
    Then the process exits with code 0
    And the output displays a dim unavailable panel for "kilo"
    And the panel displays the reason "Could not parse balance from output"

  Scenario: Kilo CLI times out or errors
    Given a `kilo` CLI in the PATH that exits with code 1
    When the user runs `npm start`
    Then the process exits with code 0
    And the output displays a dim unavailable panel for "kilo"
    And the panel displays the reason "Command failed or timed out"

  Scenario: README is updated with project details
    Given the project is scaffolded
    When I read "README.md"
    Then it should describe what allowance is
    And it should list the run commands (e.g., `npm start`)
    And it should contain an env-var ledger detailing `ALLOWANCE_KILO_REFERENCE`
