# 005 — codex: login-aware probe with app-server rate limits

After this task the user also sees a **codex** panel (after grok, before kilo). Codex has two auth modes and the panel honestly reflects which one is active.

## Codex probe (verified live on this machine)

Step 1 — auth mode: run `codex login status` (15s timeout). Verified outputs:

- `Logged in using an API key - sk-proj-***n5zQA` → **API-key mode**.
- A ChatGPT-account line (e.g. containing `ChatGPT`) → **ChatGPT mode**.
- Anything else / non-zero exit → `unavailable`.

Step 2a — API-key mode: no usage windows exist (pay-as-you-go). Panel status `ok`, zero windows, caption `api-key billing · no usage windows`. This is a normal state, not an error.

Step 2b — ChatGPT mode: query the codex app-server over newline-delimited JSON-RPC on stdio. Verified exchange (spawn `codex app-server`, hold stdin open, read lines until the response with the matching id arrives, 30s overall timeout, then terminate the child):

```json
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"allowance","title":null,"version":"0.1.0"}}}
→ {"jsonrpc":"2.0","method":"initialized"}
→ {"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}
```

The server answers initialize immediately; notifications without an `id` must be ignored while waiting for id 2. Map whatever window objects the response carries into `UsageWindow`s (percent used + reset instant when present); tolerate extra fields. If the response is a JSON-RPC error, surface it as status `error` with the server's `message` (verified example: `chatgpt authentication required to read rate limits`).

## Render

- Codex panel slot: after grok, before kilo. Header plan label `codex`.
- API-key mode renders the caption `api-key billing · no usage windows` where window rows would be.

## QA procedure (extend `qa/`)

Fixture `codex` executable with two behaviors switched by an env var: (a) `codex login status` prints the API-key line — assert the panel shows the api-key caption and no gauges; (b) prints a ChatGPT line and, for `codex app-server`, speaks the JSON-RPC exchange above from a script (reply to initialize, swallow `initialized`, reply to id 2 with a two-window payload) — assert both windows render with their percentages. All previous e2es keep passing.

## Must not break

- All existing probes, panels, and order; the app-server child must always be reaped; zero runtime dependencies; the probe must not hang when the server never answers id 2 (bound it with the 30s timeout and mark `error`).
