# 016 — hermes credits from the Nous Portal, routed as `x-ai/grok-4.6 xhigh`

After this task the user also sees their **hermes** (Nous Research Hermes Agent, on a Nous Portal subscription) credit window in the dashboard, after junie and before kilo, and `dandelion route` can answer `x-ai/grok-4.6 xhigh hermes`. Hermes has no scriptable usage command: `hermes -z "/usage"` forwards the text to the model and spends credits, and `hermes portal info` shows only auth and tool routing. But hermes stores its Nous Portal tokens in `~/.hermes/auth.json`, and the portal's account endpoint answers with the subscription's credits, so the probe calls the portal the way the cursor probe calls the cursor dashboard API.

## Hermes probe (verified live against Hermes Agent v0.21.3 and portal.nousresearch.com)

1. Read the JSON file at `DANDELION_HERMES_AUTH_FILE`, default `~/.hermes/auth.json`. Verified shape, values shortened (extra fields must be tolerated):

```json
{"version":1,"providers":{"nous":{"access_token":"<jwt>","refresh_token":"<opaque>","client_id":"hermes-cli","portal_base_url":"https://portal.nousresearch.com","inference_base_url":"https://inference-api.nousresearch.com/v1","token_type":"Bearer","scope":"inference:invoke","obtained_at":"2026-09-18T13:39:27.005147+00:00","expires_at":"2026-09-18T14:39:26+00:00","agent_key":"<jwt>","agent_key_expires_at":"2026-09-18T14:39:26+00:00","expires_in":3598}},"active_provider":"nous"}
```

   - The token is `providers.nous.agent_key` with expiry `agent_key_expires_at`; when `agent_key` is missing or empty fall back to `access_token` with `expires_at`. The portal answered the agent key in 2.5s and the access token in 18s, so the agent key comes first.
   - File missing, unreadable, no `nous` provider or no token → `unavailable` with reason `no hermes auth — run hermes portal login`.
   - Expiry at or before the injected now → `unavailable` with reason `hermes token expired — run hermes once`, and no request is made. Hermes mints these tokens for one hour and refreshes them only when it runs, so this is the normal state on a machine where hermes has been idle.

2. GET `<portal base>/api/oauth/account` with headers `Authorization: Bearer <token>` and `Accept: application/json`, 15s timeout, through the injected fetcher. The portal base is `DANDELION_HERMES_PORTAL_BASE`, default `https://portal.nousresearch.com`. Verified response (identifiers redacted; extra fields must be tolerated):

```json
{"user":{"email":"<redacted>","privy_did":"<redacted>"},"organisation":{"id":"<redacted>","slug":"<redacted>","name":"<redacted>"},"subscription":{"plan":"Plus","tier":2,"monthly_charge":20,"monthly_credits":22,"current_period_end":"2026-10-17T19:48:00.000Z","credits_remaining":22.472091793333334,"rollover_credits":6.591792646666667},"purchased_credits_remaining":0,"tool_access":{"enabled":false,"coverage":{"firecrawl":true,"fal":true}},"managed_tools":false,"paid_service_access":{"allowed":true,"paid_access":true,"reason":"usable_credits","member_spend_cap_exceeded":false,"has_active_subscription":true,"active_subscription_is_paid":true,"subscription_tier":2,"subscription_monthly_charge":20,"subscription_credits_remaining":22.472091793333334,"purchased_credits_remaining":0,"total_usable_credits":22.472091793333334}}
```

   - Window `credits`: kind `weekly` (a monthly period with a real reset), `usedPct` = `round(100 - 100 * credits_remaining / monthly_credits)` clamped to 0..100, `resetsAt` = `subscription.current_period_end`. The verified payload gives `0%` because rollover pushed the remaining credits above the monthly grant; `5.5` of `22` gives `75%`; `0` gives `100%`.
   - Plan label = `<plan> · $<credits_remaining to 2 decimals> of $<monthly_credits>`, e.g. `Plus · $22.47 of $22`; without a plan name use `hermes`.
   - `paid_service_access.paid_access` false → the panel is still `ok` with its window, and the caption gets a trailing ` · no paid access`.
   - A non-2xx answer → `unavailable` with `hermes account request failed: HTTP <status>`; a timeout → `hermes account request timed out after 15s`; a body without `subscription.monthly_credits` and `subscription.credits_remaining` as numbers → the usual parse failure.
   - Never print or persist either token; no reason string may contain one.

## Render

- Hermes panel slot: after junie, before kilo. Ten probes now run in parallel; the fleet summary counts the `credits` window and its reset like any other.
- One window row (`credits`, gauge, percent, reset countdown), then the caption `Plus · $22.47 of $22 · hermes`.
- In the live dashboard, space toggles hermes's routing like any routable panel.

## Route

- Add hermes to the routing table after junie with standard line `x-ai/grok-4.6 xhigh` and max line `x-ai/grok-4.6 xhigh`, so both rules print `x-ai/grok-4.6 xhigh hermes`. Ties still go to the provider earlier in dashboard order. Hermes never trips (its window is not rolling).
- Concrete cases: the 014 live-case fixture plus junie at 30% and hermes at `75%` used still prints `grok-4.6 grok` (91 beats 70 and 25); the same fixture with hermes at `0%` used and junie at 30% prints `x-ai/grok-4.6 xhigh hermes` (100 left, and hermes is later than junie only matters on a tie); hermes at `60%` used with `current_period_end` one hour from now and before local midnight evaporates and prints `x-ai/grok-4.6 xhigh hermes` under rule 1; `{"hermes": false}` in the state file skips hermes.
- `route --high` is unchanged: hermes is not in the chain.

## README

Add the provider bullet, the `DANDELION_HERMES_AUTH_FILE` and `DANDELION_HERMES_PORTAL_BASE` ledger entries, the route table row, and hermes in the lists of routed providers and weekly windows (`hermes credits`). Say that `--high` does not use hermes.

## QA procedure (extend `qa/`)

Fixture auth file with dummy tokens (`qa-dummy-hermes-agent-key-016`, `qa-dummy-hermes-access-016`) and expiries one day ahead, plus a tiny local HTTP fixture that logs each request and serves the payload above with `monthly_credits` `22`, `credits_remaining` `5.5` and `current_period_end` three days ahead; point `DANDELION_HERMES_PORTAL_BASE` at it. Assert the hermes panel shows `credits` at `75%` with the countdown and the caption `Plus · $5.50 of $22 · hermes`, that the request carried `Bearer qa-dummy-hermes-agent-key-016`, and that neither dummy token appears in the output. Assert `route` with the QA fixtures of the other providers prints the line this task's rules give for them. Further e2es: an auth file whose expiries are in the past asserts the `hermes token expired — run hermes once` card and an empty request log; a missing auth file asserts the `run hermes portal login` card; a fixture answering 401 asserts `hermes account request failed: HTTP 401` with no token in the output. All previous e2es keep passing; nothing is written to the fixture tree.

## Must not break

- All existing probes, panels and their order, including 015's junie; the injection seams; zero runtime dependencies; kilo is still never routed.
- 010's rules, the account token on every line and the exit codes; 011's eligibility toggle and state file; 012's `--high` chain and output; 013's route boxes; 014's trip; 015's junie window and line.
