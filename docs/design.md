# Design

## One request per step

The input is a goal in plain English. Each step reads the accessibility tree once and turns it into numbered lists: tappable controls, switches, text fields, and the apps that could be opened. One element, one number. Jev never sees a screenshot.

One Jev request carries several questions. `operation` asks which of the offered operations to run. `tap_target`, `toggle_target`, `type_target` and `app_target` each ask "if the operation were X, which item?" and are answered independently, so each one names the operation it assumes. `goal_done` asks whether the goal already looks achieved. The executor reads only the target head that matches the chosen operation.

Only what the screen supports is offered: no `TOGGLE` without a switch on screen, no `TYPE` without a field, no `OPEN_APP` for the app already showing. A target list only holds elements that fit its operation, so Jev cannot type into a button or toggle a row.

```
screen → numbered elements → operation + one target head per operation + goal_done
                                          ↓
                             the head that matches the operation
                                          ↓
                             a phone-use verb: press, pressAt, fill, scroll, back, openApp
```

## What Jev does not do

It does not write text. When `TYPE` is chosen, a small LLM gets the goal, the chosen field, the visible text and the recent actions, and must answer exactly `{"text": "..."}` or `{"text": null}`. Null types nothing; any other shape types nothing. We do not pull quoted strings out of the goal instead; other Jev agents tried that and dropped it, because "the phone's model name" or "today's date" cannot be quoted.

It does not answer. There is no text output. "Tell me the iOS version" can be navigated to, not answered.

It does not see. Screenshots are optional and only for demos.

## Acting safely

The chosen element is looked up again on a fresh read before anything is pressed, by role, label and value, nearest to where it was. If it moved, it is pressed where it is now. If it is gone, Jev decides again. Three stale rounds in a row end the run.

Switches are pressed 24 pt from the right edge of their frame, not at the centre. On iOS the accessibility frame of a switch spans the whole row and a centre press lands on the label. The value is read back after the press.

Taps on controls whose label matches Delete, Pay, Send, Transfer, Sign out and similar are refused unless the caller passes `allowDestructive`. It is a floor, not a policy.

Nothing is retried on the device. A timed-out press may already have landed.

## Deciding when it's done

`DONE` is accepted when the separate `goal_done` answer is at least 0.6. Otherwise it is vetoed once: `DONE` is removed from the next request, and the control that was tapped last is withheld too, keyed by position as well as label, because Jev's next pick after a veto was once the same button that had just saved an article, which unsaved it.

If Jev proposes `DONE` a second time and the check is not clearly against it (0.2 or higher), the run is accepted as done. A saved Wikipedia article shows only as a button label changing from "Save" to "Saved", and the check sat near 0.3 on runs that were in fact complete. Below 0.2, the run stops as blocked. Either way, the examples still read the phone afterwards; `DONE` is never the proof.

## Not getting stuck

There is no harness underneath to refuse a repeat, so the loop does it:

- A control whose tap errored or changed nothing is withheld for the next two decisions.
- An app that fails to open is not offered again.
- The same action failing or changing nothing twice in a row ends the run.
- Three `WAIT`s in a row withhold `WAIT` from the next decision. Maps once waited eleven times on a route that could never load.

## Speed

Each step reads the accessibility tree twice: once to decide, once inside the verb that acts, which also reports whether the screen changed. That read is about 0.7 s on the iOS Simulator and 2 s on Android, and it is the bottleneck. Jev takes 250–650 ms. An earlier version read the tree four times per step; removing two reads halved most runs.

## Phones

`connectDevice()` returns the same `Phone` for a booted iOS Simulator (`connect`), a fresh one (`launch`), a specific udid, an adb device (`android`), or a phone-use cloud phone (`cloud`). The loop never branches on which.

Two Android differences are handled in one place each. `pm list packages` returns every package on the device, 200+ of them, so only a curated list of common apps, filtered to what is installed, is offered. Every Android label is a `TextView`, which the iOS rule treats as an editable body, so fields are detected per platform.

`HOME` is not an operation. `OPEN_APP` switches apps directly, and the simulator's home press turned out to be a no-op, which would have made `HOME` a silent wasted step.

Cloud phones have two failure modes seen live: the worker restarts its iOS runner after a command exceeds its watchdog and the session dies with it, and read-only calls time out under load. `resilient()` re-opens the session and retries once; read-only calls get one retry; mutations get none.

## Limits

25 decisions per run. 60 controls, 60 switches, 60 fields and 60 apps per step; anything past that cannot be chosen. Visible text is capped at 3000 characters.

Unlabeled controls give Jev nothing to choose between. Permission prompts and alerts are outside the action space. A valid action can still be the wrong one. The evidence is a handful of goals in first-party apps and one third-party app; see [performance.md](performance.md).
