# Measurements

Everything here was recorded on 2026-09-23 on one local iOS Simulator (iPhone 17 Pro, iOS 26) on an Apple-silicon Mac, with Jev served as `typesafe-ai/jev` and the text helper as `meta/llama-4-scout`, both through the Vercel AI Gateway on a free-tier key. Raw records: [measurement.json](measurement.json); run logs: [runs/](runs/).

Timing is from the first observation through the final `DONE`, including every Jev request, text-helper call, device verb, re-observation and (for the About run) a screenshot per step. It excludes simulator boot and the examples' own setup and verification walks.

## Three verified runs

| Goal | Start | Decisions | Jev latency (ms) | Total | Verified |
| --- | --- | --- | --- | --- | --- |
| Turn on Bold Text (Accessibility → Display & Text Size) | Settings root, switch forced OFF | 4 | 515 · 372 · 385 · 313 | **11.2 s** | switch read back as `1` |
| Open General, then About | Display & Text Size (left by the previous run) | 5 | 393 · 264 · 263 · 263 · 1210 | **14.9 s** | final screenshot shows About |
| Create contact Ada Lovelace‹unique›, save | Contacts list, name confirmed absent | 6 | 349 · 439 · 1375 · 411 · 1113 · 374 | **19.4 s** | found by search after a relaunch |

Steps, Bold Text: `TAP Accessibility` → `TAP Display & Text Size` → `TOGGLE Bold Text (0 → 1)` → `DONE` (independent check 0.87).

Steps, About: `BACK` → `BACK` → `TAP General` → `TAP About` → `DONE` (independent check 0.92). The second `BACK` was chosen at confidence 0.41 — Jev was torn between backing out and something else — and was right.

Steps, contact: `TAP Add` → `TYPE First name ← "Ada"` → `TYPE Last name ← "LovelaceCQDL"` → `DONE` **vetoed** (independent check 0.07: the form was not saved) → `TAP Done` → `DONE` (independent check 0.68). The text helper took 339 ms and 406 ms for the two values. An identical run a minute earlier took 17.6 s with the same six steps.

Where the time goes: roughly 0.3–0.5 s per Jev request (two outliers at 1.1–1.4 s on the busiest screens), 0.3–0.4 s per text-helper call, and 2–3 s per step on the device — press, wait for the transition, observe, re-observe before the next press. The device side dominates.

The done veto is not decorative. In every contact run Jev proposed `DONE` with both names typed and the form unsaved; the independent check read the same screen and put P(done) below 0.1, `DONE` was removed from the next request's options, and Jev tapped `Done`.

## Retained failures

Numbers that were discarded, and why. They are kept because each one changed the code or the method:

- **Bold Text, first attempt** ([log](runs/bold-text-local-1.log)): reported done in 2 decisions, and the switch read back as on — but the run had started *on* the target screen. `goHome()` is a no-op on the local simulator backend (a probe showed Settings still frontmost 2.8 s later). The example now relaunches Settings to its root screen, and `HOME` was removed from the action space: `OPEN_APP` switches apps directly, and a silent no-op is a wasted step.
- **Create a contact, three attempts** ([1](runs/contact-local-1.log), [2](runs/contact-local-2.log), [3](runs/new-contact-local-1.log)):
  1. 25 decisions of `OPEN_APP` on an app that failed to launch. The SDK lists third-party apps as `Name (bundle.id)` and Apple's own apps not at all, and nothing stopped a repeating failure. Fixed by parsing the names, adding the built-in Apple apps, and stopping after the same action fails twice.
  2. `BLOCKED` at 0.51 against `OPEN_APP` at 0.30 — while the app head had Contacts at 1.00. The operation question could not see which apps existed; only the target head could. The app names are now part of the shared state, and the next run opened Contacts at 0.96.
  3. A run that happened to start on the previous run's contact card *edited* that contact's last name and passed a naive unique-name check. Verification now confirms the name is absent first, the example starts on the list, and the failure is kept as a warning: a check that only looks for the expected end state can be satisfied by the wrong path.
- **Bold Text on a phone-use cloud phone** ([log](runs/bold-text-cloud-1.log)): the very first RPC timed out; the cloud worker was under load from a concurrent benchmark. Cloud calls now go through `resilient()` (re-open the session on `SESSION_NOT_FOUND`, retry read-only calls once, never retry mutations). No cloud timing is claimed.

## What this does not show

Three goals in two first-party apps is a smoke test, not an evaluation. Nothing here scrolls a long list, handles a picker or a permission prompt, or leaves the app it started in except by `OPEN_APP` from the list. The same policy inside phone-use's harness was run on the [iOSWorld](https://github.com/ljang0/iOSWorld) single-app set on cloud iPhones the same day (Jev alone, no LLM, one fresh phone per task, Codex default-model judge): 15 tasks graded — 1 full pass (notes-001), 52/101 rubric points (51%), median 35 s of agent time; 11 tasks excluded as infrastructure failures (the cloud runner's accessibility capture times out on LockedIn, Mail, MegaMart, DineSpot and others and stays wedged) and one timed out ungraded. How the graded runs ended: loop-breaker refusals 5, unconfirmed DONE 3, the permission floor on a "Send" button 2 (correct — Jev cannot confirm), BLOCKED 1, step budget 1, a rounding-tie validation 1 (since tolerated), daemon failure 1. Most iOSWorld rubrics also require a reported answer, which a System One model cannot produce. After the follow-up fixes those runs prompted (withholding a control after a failed tap, keying the harness's loop breaker by element rather than ref, the rounding tolerance), the six tasks that had ended at the loop breaker were re-run: 20 → 24 of 41 rubric points, still no full pass — the remaining stops are unlabeled controls, confirmations, and answers.
