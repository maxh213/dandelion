Feature: Kilo API Balance Dashboard
  As a user
  I want to run a single command to see my Kilo API balance
  So I can quickly check my allowance without opening a browser

  Scenario: Kilo balance is successfully retrieved and rendered
    Given the Kilo CLI is available on the PATH
    And running "kilo profile" succeeds and outputs a balance of "$14.15"
    When I run the dashboard command
    Then the process should exit with code 0
    And the output should display a one-line banner with the wordmark "ALLOWANCE" and the fetch time
    And the output should display a provider panel for "kilo"
    And the panel should show the balance "$14.15"
    And the panel should display a 20-cell gauge visually filled representing the balance over the reference amount
    And the panel should have a dim caption "api balance · kilo"

  Scenario: Kilo CLI is missing or fails
    Given the Kilo CLI is not on the PATH or fails to run
    When I run the dashboard command
    Then the process should exit with code 0
    And the output should display a dim unavailable panel variant for "kilo"
    And the panel should explain why Kilo is unavailable instead of showing the gauge
