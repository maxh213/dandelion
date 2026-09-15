# 014 — `dandelion route` never picks an account whose session window is used up

After this task, `dandelion route` stops sending the user to a subscription they cannot use right now. Today the evaporation rule (rule 1 from 010) only looks at weekly windows, so an account whose weekly window is about to reset tonight wins even when its session window is 100% used and will not reset for hours. A tool that follows the answer, such as marestail's `--model dandelion/route`, then waits on that account's rate limit for hours while other subscriptions have plenty of room.

## The trip

An account is **tripped** when any of its rolling windows (claude `session`, kimi `5h`, agy `Five Hour Limit`) is **90% or more used**. This is the same 90% trip `route --high` already applies (012); use one shared constant for both, not a second number.

- Rule 1 (evaporation) considers only accounts that are not tripped. A tripped account's evaporating weekly window is ignored, and rule 1 picks among the remaining accounts, or does not fire at all.
- Rule 2 (most headroom) also skips tripped accounts, even when a tripped account's binding would be the highest.
- When every routable account is tripped or ineligible, `route` prints `none` and exits 1, exactly as when nothing is routable today.
- Weekly windows do not trip an account; only rolling windows do. Eligibility (011) still applies first: an ineligible account is never routed.
- `route --high` is unchanged.

## Concrete cases (pin every one)

The live case that prompted this task, at 12:39 local time, next local midnight in 11h21m:

| account | windows |
|---|---|
| claude | session 2%, weekly 13% resets in 5d10h, weekly Fable 2% resets in 5d10h |
| claude-work | **session 100%** resets in 3h11m, weekly 72% resets in **5h21m**, weekly Fable 52% resets in 5h20m |
| agy | Weekly Limit 17% resets in 5d6h, Five Hour Limit 0% |
| kimi | weekly 95% resets in 3d1h, 5h 0% |
| grok | credits 9% resets in 5d10h |
| cursor | total 36%, auto 36%, api 33%, all reset in 15d5h |

- Today this prints `claude-opus-5 max claude-work`. After this task it prints `grok-4.6 grok`: claude-work is tripped, so no evaporating window remains, and rule 2 picks grok (91 left) over claude (87), agy (83), cursor (64) and kimi (5).
- Same fixture with claude-work's session at **89%**: still `claude-opus-5 max claude-work` (under the trip).
- Same fixture with claude-work's session at exactly **90%**: `grok-4.6 grok` (the trip is inclusive).
- Two accounts with evaporating weekly windows tonight, claude-work (tripped, 48 left) and claude (not tripped, 20 left): `claude-opus-5 max claude`.
- Rule 2 only, the account with the highest binding has kimi `5h` at 95% used: the next-best untripped account is printed.
- Every routable account tripped: `none`, exit 1.
- `{"claude-work": false}` in the state file and claude tripped: neither claude account is printed.

## README

In the Route section, document the trip for both rules: which windows count as rolling, the 90% inclusive threshold, and that it is the same trip `route --high` uses.

## Must not break

- 010's rules for untripped accounts (evaporation over headroom, ties to the earlier account in dashboard order), the account token on every line, and exit codes.
- 011's eligibility toggle and state file, and 012's `route --high` chain and its output.
- The dashboard, `--once` and live mode.
