# Measurements

Everything here was recorded on 2026-09-23 on one local iOS Simulator (iPhone 17 Pro, iOS 26) on an Apple-silicon Mac, with Jev served as `typesafe-ai/jev` through the Vercel AI Gateway on a free-tier key. Raw records: [measurement.json](measurement.json); run logs: [runs/](runs/).

Timing is from the first observation through the final `DONE`, including every Jev request, device verb, re-observation and (for the second run) a screenshot per step. It excludes simulator boot and the examples' own setup and verification walks.

## Two verified runs

| Goal | Start | Decisions | Jev latency (ms) | Total | Verified |
| --- | --- | --- | --- | --- | --- |
| Turn on Bold Text (Accessibility → Display & Text Size) | Settings root, switch forced OFF | 4 | 515 · 372 · 385 · 313 | **11.2 s** | switch read back as `1` |
| Open General, then About | Display & Text Size (left by the previous run) | 5 | 393 · 264 · 263 · 263 · 1210 | **14.9 s** | final screenshot shows About |

Steps, Bold Text: `TAP Accessibility` → `TAP Display & Text Size` → `TOGGLE Bold Text (0 → 1)` → `DONE` (independent check 0.87).

Steps, About: `BACK` → `BACK` → `TAP General` → `TAP About` → `DONE` (independent check 0.92). The second `BACK` was chosen at confidence 0.41 — Jev was torn between backing out and something else — and was right.

Where the time goes: roughly 0.3–0.5 s per Jev request, and 2–3 s per step on the device (press, wait for the transition, observe, re-observe before the next press). The device side dominates. The last done-check on the About screen took 1.2 s; that screen's element table is the largest of the run.

## Retained failures

Numbers that were discarded, and why:

- **Bold Text, first attempt** ([log](runs/bold-text-local-1.log)): reported done in 2 decisions, and the switch read back as on — but the run had started *on* the target screen. The example's `goHome()` had not taken effect before the first observation. The example now relaunches Settings to its root screen and waits until the launcher is frontmost. A verified outcome with a wrong start state is not a measurement.
- **Bold Text on a cloud phone** ([log](runs/bold-text-cloud-1.log)): the very first RPC timed out; the cloud worker was under load from a concurrent benchmark. Cloud calls now go through `resilient()` (re-open the session on `SESSION_NOT_FOUND`, retry read-only calls once, never retry mutations). No cloud timing is claimed.

## What this does not show

Two goals in one first-party app is a smoke test, not an evaluation. No typing was exercised (neither goal has a text field on its path), so the text helper's latency is not measured here. The [iOSWorld](https://github.com/ljang0/iOSWorld) run with the same policy inside phone-use's harness is reported separately; on that benchmark most tasks require a reported answer, which a System One model cannot produce.
