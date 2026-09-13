# QA Procedure: 001 - Scaffold Kilo

1. Run the automated QA script: `node qa/e2e.mjs` (or `npm run qa`).
   - **Expected:** The script discovers and runs `qa/*.e2e.mjs`. It reports successful test runs for both the happy path (fixture with a mock `kilo` CLI returning `$14.15`) and the failure path (fixture with an empty PATH). The process exits with code 0.

2. Verify the missing CLI fallback behavior manually.
   - **Action:** Ensure you do not have the real `kilo` CLI installed on your PATH. Run `npm start`.
   - **Expected:** The application prints a styled terminal output and exits with code 0. The output features a one-line banner with the wordmark `ALLOWANCE` and the current time. Below it, an unavailable panel is displayed for `kilo`. It should have the same frame as a normal panel but be styled dimly, and it must show a human-readable reason (e.g. CLI not found) instead of a gauge.

3. Verify the happy path rendering manually.
   - **Action:** Create a mock executable named `kilo` early in your PATH that prints the following exact text when run with `profile`:
     ```
     Name: Max
     Email: yeti213@googlemail.com
     Team: Personal
     Balance: $14.15
     ```
     Run `npm start` without setting `ALLOWANCE_KILO_REFERENCE`.
   - **Expected:** The application prints the dashboard and exits with code 0. The "kilo" panel shows a heavy top rule, the balance text "$14.15", and a dim caption "api balance · kilo". A 20-cell gauge is shown: because the default reference is 20, 14.15/20 rounds to 14 filled cells (`█`) and 6 empty cells (`░`).

4. Verify reference amount configuration.
   - **Action:** Using the same mock `kilo` from step 3, run `ALLOWANCE_KILO_REFERENCE=10 npm start`.
   - **Expected:** The app outputs the dashboard. The balance is still displayed as "$14.15". Since 14.15 exceeds the reference of 10, the gauge should be completely full (20 filled cells).
