# Dynamic operation + target, on a phone

The input is one natural-language goal. Every observation builds an indexed
table of the controls, switches and text fields on the current screen, plus
the visible text and the apps that could be opened. One node gets one index.

One Jev request asks which operation to perform and, speculatively, which
target each operation would use. The executor consumes only the target head of
the operation Jev chose. Two decisions, one network round trip, and a target
can never be one the operation does not support: switches exist only under
TOGGLE, text fields only under TYPE, apps only under OPEN_APP.

```
                        one Jev request
                       ┌───────────────────────────┐
screen → element table → operation                 │   TAP · TOGGLE · TYPE · SCROLL · BACK · OPEN_APP · WAIT · DONE · BLOCKED
                       │ tap_target                │   only what THIS screen supports is offered
                       │ toggle_target             │
                       │ type_target               │
                       │ app_target                │
                       │ goal_done  (independent)  │
                       └─────────────┬─────────────┘
                              use the matching head
                                     │
                      TAP [7] ───────┤──→ phone-use verb (press / pressAt / fill / scroll / …)
                   TOGGLE [1] ───────┘
                     TYPE [2]
                            ↓
                  small LLM → text → phone
```

Operation and target questions receive the same next-step rules. Target
criteria carry current values and switch states. The questions are answered
independently — a target head cannot see the operation answer — so each head's
instructions name the operation it assumes.

## What Jev does not do

**Write text.** When TYPE is chosen, a small LLM gets the goal, the chosen
field, the visible text and the recent actions, and must return exactly
`{"text": "…"}` or `{"text": null}`. Null types nothing. Anything else is
rejected and types nothing. The code does not extract quoted literals from the
goal — that was tried by other Jev agents and dropped: it cannot express
"the phone's model name" or "today's date".

**Answer questions.** There is no reply channel. A goal like "tell me the iOS
version" can be *navigated* to, but nothing writes the answer. That is a
property of a System One model, not a bug to fix here.

**See screenshots.** Jev consumes structured state only. Screenshots are
optional, for demos, and the model never receives them.

## Runtime

One `@phone-use/sdk` observation supplies the accessibility tree: roles,
labels, values, frames, enabled/blocked state. `readScreen` turns it into the
action space. Elements off-screen, disabled, or covered by another layer are
not offered.

Every executed target is re-found on a fresh observation immediately before
acting — same role, same label, same value, nearest to where it was. If it is
gone, the agent decides again rather than pressing whatever moved under it.
Three stale rounds in a row stop the run.

Switches are pressed at the knob (24pt from the right edge of the frame), not
at the frame's centre: on iOS a switch's accessibility frame spans the whole
row, and a centre tap lands on the label. TOGGLE reports the value before and
after, read back from the device.

`DONE` is accepted only when an independent `goal_done` question, asked in the
same request and judged only from the screen, agrees (default ≥ 0.6). An
unverified DONE is vetoed once — removed from the next request's options — and
stops the run the second time. That is the most common false success in every
Jev agent we read.

Taps on controls whose label matches a destructive/financial verb (Delete,
Pay, Send, Transfer, Sign out, …) are refused unless `allowDestructive` is set.
The pattern is deliberately small; it is a floor, not a policy.

Device mutations are never retried. A timed-out press may already have landed.

There is no HOME operation. OPEN_APP switches apps directly, and the local
simulator backend's home press was observed to be a no-op (Settings still
frontmost 3 s later), which would have made HOME a silent wasted step.

## Confidence

Jev returns a confidence per choice. The default is to act on the argmax
(`minConfidence: 0`), as jev-ultrafast does. Pass `minConfidence` to stop
below a floor instead — useful when a stronger model is waiting to take over,
pointless when nothing is: a stop is just a failure with a nicer reason.

## Where the phone is

`connectDevice()` returns the same `Phone` for a booted local simulator
(`connect`, the default), a fresh one (`launch`), a specific udid, or a
phone-use cloud phone (`cloud`). Scripts never branch on locality.

Cloud phones have two failure modes seen live: the worker restarts its iOS
runner when a command exceeds its watchdog (the daemon session dies and every
verb fails with `SESSION_NOT_FOUND` until an open recreates it), and read-only
calls time out under load. `resilient()` re-opens and retries once, and retries
read-only calls once. Mutations are not retried.

## Boundaries

25 decisions bound a run. 60 controls, 60 switches, 60 fields and 60 apps are
offered per step; anything past the cap cannot be chosen. Visible text is
capped at 3000 characters.

The policy is generic, but the evidence is small (see
[performance.md](performance.md)). Accessibility trees vary: unlabeled icons,
custom controls, canvas views and web content inside apps can leave nothing to
offer. Permission prompts and system alerts are not handled by the policy —
clear them before the run, or extend the action space. A valid action can
still be the wrong one. Independent checks, not the model's DONE, decide
whether a task succeeded.
