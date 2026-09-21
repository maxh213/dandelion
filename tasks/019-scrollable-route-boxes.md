# 019 — live dashboard fits the terminal; route boxes and personal claude stay on screen

After this task, a short terminal no longer cuts off the top of the live dashboard. The two auto-choice boxes (`route` and `route --high`) stay visible. The personal `claude` panel is reachable. `↑` / `k` can move back to it. The frame is never taller than the terminal.

Today `renderLiveFrame` joins the banner, summary, boxes, every provider panel and the help footer into one string, and `draw` prints the whole thing after `\x1b[H\x1b[2J`. With ten panels (claude through kilo) that string is taller than a typical window. The terminal scrolls. The viewport starts part-way down the list (live capture: first header on screen is `claude-work`, then agy … kilo). Banner, fleet summary, both route boxes, and the personal `claude` panel sit above that viewport. Alternate-screen redraws reprint the tall frame, so scrolling the host window or pressing `k` does not bring them back.

## What stays put

The live chrome is always the first lines of the frame, in this order:

1. banner
2. fleet summary
3. the two route boxes (four lines, same 013 layout)

When `?` has turned the help footer on, it is always the last line of the frame. It does not sit under off-screen panels.

`--once` is unchanged: it still prints the full dashboard with no boxes and no clipping.

## What scrolls

The rows between the chrome and the footer (or the bottom of the terminal when the footer is off) are the panel region.

- That region shows a contiguous slice of the concatenated provider panels, in dashboard order (`claude`, `claude-work`, `agy`, `kimi`, `grok`, `codex`, `cursor`, `junie`, `hermes`, `kilo`).
- `↑↓/jk` still move only over provider panels. The boxes are still not selectable.
- Moving the selection scrolls the region so the selected panel's header is inside it. As much of that panel as fits is shown under the header. A panel taller than the region is clipped; the header stays visible.
- While `selected` is `-1` (first frames, before any `j`/`k`), the region shows the **start** of the panel list (offset 0): chrome, then personal `claude`, then as many later panels as fit. It must not open on `claude-work` with `claude` already off-screen.
- Pressing `k` from a later panel (for example `kilo`) walks back through the list until `claude`. The route boxes stay in the chrome the whole time.
- A panel whose header is above or below the region is not drawn. No blank padding is added to fake its position.

## Height

- Each live frame is at most `process.stdout.rows` lines. If `rows` is missing or `0`, use `24`.
- After `\x1b[H\x1b[2J`, write at most that many lines and nothing that would scroll the first line off (no extra trailing newline past the last row).
- The first of those lines is the banner. The route-box titles are still on the third line of the frame, as in 013, whenever `rows >= 6`.
- On `SIGWINCH`, redraw the same view against the new `rows` so a resize neither leaves a short frame in a tall terminal nor writes past the new bottom.
- If `rows` is smaller than the chrome (six lines, or seven with the footer), still write at most `rows` lines, starting at the banner, so the boxes are clipped from the bottom of the chrome rather than lost to terminal scroll. Do not invent a smaller box layout.

## Must not break

- Box content, titles, 72-cell width, probing spinner, settle/refresh/toggle behaviour, `NO_COLOR` `+-|` drawing, and the invariant that each box matches `dandelion route` / `route --high` (013).
- `dandelion route`, `route --high`, eligibility, session-trip, panel order, captions, gauges. Junie (015) and hermes (016) stay in that order.
- Keys: `↑↓/jk`, space, `r`, `q`, `?`. No new keys.
- `--once` bytes for a fixed fixture. Alternate-screen enter/leave sequences. Zero runtime dependencies.

## README

In the `npm start` description, say the live dashboard fits the terminal: the `route` and `route --high` boxes stay at the top, and the provider list scrolls with `↑↓/jk` so earlier panels (including personal `claude`) stay reachable.

## QA procedure (extend `qa/`)

Reuse the 013 live fixture (`bv`, `FIX`, `NC=1`) from `qa/013-route-boxes.md`. Drive a 12-row × 80-col pty (set `rows`/`columns` on the child, or `stty rows 12 cols 80` inside `script`).

1. Run `node qa/e2e.mjs; pgrep -fa dandelion-qa`.
   - **Expected:** exits 0. Every `*.e2e.mjs` prints PASS, including a new `019-scrollable-route-boxes.e2e.mjs`. `pgrep` prints nothing.

2. Unit-render a settled live view with `rows: 12`, `selected: -1`, every provider present (the 018 set, including junie and hermes).
   - **Expected:** the string has at most 12 lines. Line 1 is the banner, line 2 the summary, lines 3–6 the two boxes. The first panel header in the frame is `claude`. `claude-work` may be absent. `kilo` is absent. `--once` for the same usages still contains every provider and no boxes.

3. Run `NC=1` live on the 12×80 pty with `FIX`. After the round settles, before any key, read the last frame after `ESC[H ESC[2J`.
   - **Expected:** at most 12 lines. Line 3 still starts with `+- route`. The frame contains a `claude` header and does not start on `claude-work`. `kilo` is not in that frame.

4. From that session, press `j` until the kilo panel is selected, then read the last frame.
   - **Expected:** still at most 12 lines. Line 3 still starts with `+- route`. The frame contains `▸ kilo` (or `kilo` on the selected header). Personal `claude` may be absent.

5. Press `k` until the first panel is selected, then `?`, then read the last frame.
   - **Expected:** still at most 12 lines. Boxes still on lines 3–6. The selected header is `claude` (personal), not `claude-work`. The last line is the help footer. `q` restores the screen, `exit=0`.

6. Run `rh A=--once NO_COLOR=1 "${FIX[@]}"` and compare to the 013 `--once` shape.
   - **Expected:** no box lines, every panel present, not clipped to 12 lines.

7. README `npm start` bullet mentions the boxes stay at the top and the provider list scrolls with `↑↓/jk`.
