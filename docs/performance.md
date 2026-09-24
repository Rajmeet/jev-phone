# Measurements

Everything here was recorded on 2026-09-23 on one local iOS Simulator (iPhone 17 Pro, iOS 26) on an Apple-silicon Mac, with Jev served as `typesafe-ai/jev` and the text helper as `meta/llama-4-scout`, both through the Vercel AI Gateway on a free-tier key. Raw records: [measurement.json](measurement.json); run logs: [runs/](runs/).

Timing is from the first observation through the final `DONE`, including every Jev request, text-helper call, device verb, re-observation and (for the About run) a screenshot per step. It excludes simulator boot and the examples' own setup and verification walks.

## Verified runs

Current code (two tree reads per step; 2026-09-24). Local iPhone 17 Pro simulator:

| Goal | Decisions | Jev latency (ms) | Total | Verified |
| --- | --- | --- | --- | --- |
| Turn on Bold Text | 4 | 489 · 248 · 357 · 313 | **5.7 s** | switch read back as `1` |
| Open General, then About | 6 | avg 765 | **11.8 s** | final screen About |
| Create contact, save | 6 | 657 · 2522 · 637 · 514 · 285 · 305 (text 575, 841) | **17.9 s** | found by search after a relaunch |

Local Android emulator (adb):

| Goal | Decisions | Jev avg (ms) | Total | Verified |
| --- | --- | --- | --- | --- |
| Turn on Airplane mode | 4 | 354 | **15.4 s** | `airplane_mode_on` 0 → 1 |
| Create contact, save | 7 | 332 | **29.7 s** | contacts provider returns the row |

Logs: [bold-text-local-3](runs/bold-text-local-3.log), [about-local-2](runs/about-local-2.log), [new-contact-local-7](runs/new-contact-local-7.log), [airplane-android-local-2](runs/airplane-android-local-2.log), [contact-android-local-2](runs/contact-android-local-2.log).

What changed: the loop used to read the accessibility tree four times per step (to build the action space, to re-find the target, inside the press, and again to record the outcome). The verb's own read now reports the outcome and the start-of-step read is skipped while the cache is fresh — two reads per step. A read is ~0.7 s on the simulator and ~2 s on Android, so this roughly halved every run below.

### Before the capture reduction (2026-09-23), for the record

Local iPhone 17 Pro simulator:

| Goal | Start | Decisions | Jev latency (ms) | Total | Verified |
| --- | --- | --- | --- | --- | --- |
| Turn on Bold Text (Accessibility → Display & Text Size) | Settings root, switch forced OFF | 4 | 515 · 372 · 385 · 313 | **11.2 s** | switch read back as `1` |
| Open General, then About | Display & Text Size (left by the previous run) | 5 | 393 · 264 · 263 · 263 · 1210 | **14.9 s** | final screenshot shows About |
| Create contact Ada Lovelace‹unique›, save | Contacts list, name confirmed absent | 6 | 349 · 439 · 1375 · 411 · 1113 · 374 | **19.4 s** | found by search after a relaunch |

Local Android emulator (`sdk_gphone64_arm64`, `--device android` over adb, 2026-09-24), verified with adb itself:

| Goal | Start | Decisions | Jev latency (ms) | Total | Verified |
| --- | --- | --- | --- | --- | --- |
| Turn on Airplane mode | Settings root | 4 | 645 · 413 · 321 · 621 | **29.2 s** | `settings get global airplane_mode_on`: 0 → 1 |
| Create contact Ada Lovelace‹unique›, save | launcher | 6 | 347 · 1134 · 385 · 504 · 304 · 303 | **51.5 s** | `content query` on the contacts provider returns the row |

Cloud Android phone (phone-use, Pixel-class emulator, 2026-09-24), same policy, `--device cloud`:

| Goal | Start | Decisions | Jev latency (ms) | Total | Verified |
| --- | --- | --- | --- | --- | --- |
| Turn on Airplane mode (Network & internet) | already on Network & internet | 2 | 417 · 501 | **13.0 s** | tree reads "Airplane mode is on" |
| Create contact Ada Lovelace‹unique›, save | launcher, Contacts past its sign-in wall | 6 | 460 · 257 · 396 · 498 · 411 · 2330 | **54.8 s** | "Ada LovelaceAND2" in the Contacts list |

Steps, Android contact: `OPEN_APP Contacts` → `TAP Create contact` → `TYPE First name ← "Ada"` (text helper 1129 ms) → `TYPE Last name` (479 ms) → `TAP Save` → `DONE` (0.69). The decisions match the iPhone run; the device side is ~10 s per step on the cloud emulator against ~3 s locally. Two Android-specific findings shaped the code: `pm list packages` returns 200+ packages (a 24 KB request the gateway answered with 503) so only a curated, installed-filtered list is offered; and every Android label is a `TextView`, which the iOS rule counts as an editable body, so fields are detected per platform. Logs: [airplane](runs/airplane-android-cloud-1.log), [contact](runs/contact-android-cloud-2.log).

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
