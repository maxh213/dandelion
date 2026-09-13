# QA Procedure: Kilo Dashboard Scaffold

1. **Happy Path (Kilo available)**
   - **Action:** Ensure you have a mock or real `kilo` executable in your `PATH` that returns a profile with `Balance: $14.15` when `kilo profile` is executed.
   - **Action:** Run `npm start`.
   - **Expected Result:** The app exits with code `0`. A 72-column terminal dashboard is printed.
   - **Expected Result:** A one-line banner reads "ALLOWANCE" with the current fetch time.
   - **Expected Result:** A panel for "kilo" is displayed with a heavy top rule, the balance "$14.15", a 20-cell gauge filled proportionally (based on a default reference of $20), and a dim caption `api balance · kilo`.

2. **Failure Path (Kilo unavailable)**
   - **Action:** Remove `kilo` from your `PATH` or replace it with a script that exits with an error.
   - **Action:** Run `npm start`.
   - **Expected Result:** The app exits with code `0`. 
   - **Expected Result:** The banner is still displayed.
   - **Expected Result:** The kilo panel is rendered as a dim "unavailable" variant, showing a human-readable reason instead of the balance and gauge.

3. **Automated E2E Tests**
   - **Action:** Run `npm run qa`.
   - **Expected Result:** The test runner executes the `qa/*.e2e.mjs` scripts against mock fixtures (both a successful and empty PATH) and reports that all tests pass.
