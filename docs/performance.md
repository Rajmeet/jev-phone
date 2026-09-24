# Measurements

Recorded 2026-09-23/24 on one Mac: a local iPhone 17 Pro simulator (iOS 26), a local Android emulator (`sdk_gphone64_arm64`) over adb, and phone-use cloud phones. Jev is `typesafe-ai/jev` and the text helper is `meta/llama-4-scout`, both through the Vercel AI Gateway on a free-tier key. Raw records are in [measurement.json](measurement.json); each run's console output is in [runs/](runs/).

Timing runs from the first tree read to the final `DONE`, including every Jev request, text-helper call, device verb and re-read, and for runs with a GIF a screenshot per step. It excludes booting the phone and the examples' own setup and verification steps.

## Runs that count

Current code. Every run was checked by reading the phone afterwards; the check is in the last column.

**iPhone simulator**

| Goal | Decisions | Jev (ms) | Total | Checked by |
| --- | --- | --- | --- | --- |
| Maps: find Blue Bottle Coffee, open it, walking route | 5 | 527 · 999 · 1027 · 467 · 268 | 16.5 s | route row "2 min · 200 ft" and the destination, in the tree |
| Wikipedia: search Lisbon, open the article, save it | 8 | 312 · 269 · 1699 · 346 · 306 · 279 · 269 · 1591 | 28.4 s | Lisbon listed in the Saved tab after a relaunch |
| Settings: turn on Bold Text | 4 | 489 · 248 · 357 · 313 | 5.7 s | switch value read back as 1 |
| Settings: General → About | 6 | avg 765 | 11.8 s | the About screen |
| Contacts: create Ada Lovelace‹unique›, save | 6 | 657 · 2522 · 637 · 514 · 285 · 305 | 17.9 s | found through the list's search field after a relaunch |

**Android emulator**

| Goal | Decisions | Jev avg (ms) | Total | Checked by |
| --- | --- | --- | --- | --- |
| Settings: turn on Airplane mode | 4 | 354 | 15.4 s | `adb shell settings get global airplane_mode_on`: 0 before, 1 after |
| Contacts: create and save a contact | 7 | 332 | 29.7 s | `adb shell content query` on the contacts provider returns the row |

The same two Android goals also ran on a cloud Android phone (13.0 s and 54.8 s, on the older four-reads-per-step code).

Logs: [directions](runs/directions-local-1.log), [wiki-save](runs/wiki-save-local-3.log), [bold-text](runs/bold-text-local-3.log), [about](runs/about-local-2.log), [new-contact](runs/new-contact-local-7.log), [airplane](runs/airplane-android-local-2.log), [contact-android](runs/contact-android-local-2.log).

## What the steps looked like

Maps: `TYPE` "Blue Bottle Coffee" into the search field (text helper) → `TAP` the result → `TAP` Directions (the card re-rendered between deciding and acting, so it decided again) → `TAP` "2 min, walking" → `DONE` at 0.76. The simulator had been given a location at the Ferry Building.

Wikipedia: `TAP` Search → `TYPE` "Lisbon" → `TAP` the search result → `TAP` a link in the article → back on the article card → `TAP` "Save for later" → `DONE` at 0.89. One wrong turn, recovered in two steps.

Contacts (iOS): `TAP` Add → `TYPE` first name → `TYPE` last name → `DONE`, vetoed at 0.07 because the form wasn't saved → `TAP` Done → `DONE` at 0.68. Every contact run has gone this way; the veto is doing real work.

## Where the time goes

Jev answers in 250–650 ms most of the time, with occasional slow replies up to 8 s from the free-tier gateway. The text helper takes 300–900 ms. Each step reads the accessibility tree twice, once to decide and once inside the verb that acts, and a read is about 0.7 s on the simulator and 2 s on Android. That is the bottleneck. An earlier version read the tree four times per step; cutting it to two halved most runs (Bold Text 11.2 s → 5.7 s, Android contact 51.5 s → 29.7 s).

## Runs that were thrown out

Kept because each one changed the code or the method.

- **Bold Text, first attempt** ([log](runs/bold-text-local-1.log)). Done in 2 decisions and the switch read on, but the run had started on the target screen: `goHome()` does nothing on the local simulator backend. The example now relaunches Settings to its root, and `HOME` was dropped from the action space.
- **Contacts, three attempts** ([1](runs/contact-local-1.log), [2](runs/contact-local-2.log), [3](runs/new-contact-local-1.log)). First, 25 decisions of `OPEN_APP` on an app that would not launch: the SDK lists third-party apps as "Name (bundle)" and Apple's own apps not at all, and nothing stopped a repeating failure. Second, `BLOCKED` at 0.51 against `OPEN_APP` at 0.30 while the app head had Contacts at 1.00: the operation question could not see which apps existed. Third, a run that started on the previous run's contact card edited that contact's last name and passed a naive check. All three are fixed; the third is a warning about verification that only looks for the end state.
- **Maps, first attempt** ([log](runs/maps-local-1.log)). The simulator had no location, the route stayed on "Loading…", and Jev chose `WAIT` eleven times, correctly given the screen. Consecutive `WAIT`s are now capped at three, and the simulator gets a location.
- **Wikipedia, four attempts** ([1](runs/wiki-local-1.log), [3](runs/wiki-local-3.log), [4](runs/wiki-local-4.log), [save-1](runs/wiki-save-local-1.log)). The article got saved every time, then the done-check sat near 0.3, the veto removed `DONE`, and Jev's next pick was the same button, which unsaved it. Two changes: the control tapped last is withheld after a veto, keyed by position because its label had changed from "Save" to "Saved"; and a second `DONE` is accepted unless the check is clearly against it. One run also died on gateway 503s, so the client now backs off up to 8 s. The Kyoto run that then passed had found the article on the Explore feed instead of searching, so the example switched to Lisbon.
- **Reminders** ([log](runs/reminders-local-1.log)). A first-run "Continue" screen, then `BLOCKED` on an empty list. Not pursued.
- **Android SMS** ([log](runs/sms-android-local-1.log)). Typed the recipient, then the suggestion rows in Messages carry only resource ids, no labels, and Jev had nothing to choose between. The unlabeled-controls limit.
- **Android, first contact attempt** ([log](runs/contact-android-cloud-1.log)). An immediate 503: the whole 223-package app list had gone into the request. The app list is now curated and filtered to what is installed.
- **Bold Text on a cloud phone** ([log](runs/bold-text-cloud-1.log)). The first call timed out under load from a concurrent benchmark. Cloud calls now go through `resilient()`.

## iOSWorld

The same policy, inside phone-use's own harness and with no LLM, ran the single-app set of [iOSWorld](https://github.com/ljang0/iOSWorld) on cloud iPhones (one fresh phone per task, Codex default-model judge): 15 tasks graded, one full pass, 52 of 101 rubric points, median 35 s of agent time per task. Eleven tasks were lost to the cloud runner timing out on heavy screens and one timed out. The graded runs ended on: a repeated tap 5, an unconfirmed `DONE` 3, the permission floor on a Send button 2, `BLOCKED` 1, the step budget 1, a rounding-tie validation 1, a daemon failure 1. After fixes prompted by those endings, the six repeated-tap tasks were re-run: 20 → 24 points, still no full pass. Most iOSWorld rubrics also require a reported answer, which this agent cannot give.

## What this does not show

Seven goals in five apps, one of them third-party, is a smoke test. Nothing here handles a date picker, a permission prompt, a long list that needs scrolling, or an app that fights the accessibility tree.
