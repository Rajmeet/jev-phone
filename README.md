# jev-phone

**A phone agent with a dynamic, indexed action space.**

Give it one goal. [TypeSafe's Jev](https://docs.typesafe.ai/concepts/system-one) picks an operation and a target from what the screen actually offers — in one request, in a few hundred milliseconds, with probabilities instead of prose. [phone-use](https://github.com/Rajmeet/phone-use) executes it on a real iOS Simulator or a cloud iPhone. A small LLM writes text only when the operation is `TYPE`.

**Bold Text on in 11.2 s and 4 decisions. A new contact typed and saved in 19.4 s and 6 decisions.** Both verified by reading the phone afterwards, not by trusting the model.

<img src="demo.gif" alt="Jev navigating Settings to the About screen, at recorded speed" width="270" />

*"Open Settings and go to General, then About" — five decisions, 14.9 s, played at the recorded step timings. It starts two screens deep in Accessibility, left there by the previous run, and backs out first.*

[Design](docs/design.md) · [Measurements](docs/performance.md) · [Read the loop](src/agent.ts)

## The action space

Every observation produces a new element table from the accessibility tree — no screenshots, no OCR:

```text
controls      [1] Cell      General
              [2] Cell      Accessibility
              [3] Button    Search
switches      [1] Switch    Bold Text        value 0
text_fields   [1] SearchField  Search
```

The operations are `TAP`, `TOGGLE`, `TYPE`, `SCROLL_UP`, `SCROLL_DOWN`, `BACK`, `OPEN_APP`, `WAIT`, `DONE` and `BLOCKED`. Only operations the screen supports are offered: no `TOGGLE` without a switch, no `TYPE` without a field, no `OPEN_APP` on the app itself.

```text
                        one Jev request
                       ┌───────────────────────────┐
screen → element table → operation                 │
                       │ tap_target                │
                       │ toggle_target             │
                       │ type_target               │
                       │ app_target                │
                       │ goal_done (independent)   │
                       └─────────────┬─────────────┘
                              use the matching head
                                     │
                      TAP [2] ───────┤──→ phone
                   TOGGLE [1] ───────┘
                     TYPE [1]
                            ↓
                  small LLM → text → phone
```

Target questions are speculative. If the operation is `TAP`, only `tap_target` can execute. Two decisions, **one network round trip**. Each head contains only compatible elements — switches only under `TOGGLE`, fields only under `TYPE` — so Jev cannot type into a button or toggle a row. A `goal_done` question rides in the same request and must agree before a `DONE` is accepted.

There are no app-specific scripts and no prepared field values in the policy. The examples supply a goal and verify the outcome independently.

## Try it

You need [Bun](https://bun.sh), Xcode with a booted iOS Simulator (or a phone-use cloud phone), and a Jev key.

```bash
git clone https://github.com/Rajmeet/jev-phone.git
cd jev-phone
bun install
cp .env.example .env     # add TYPESAFE_API_KEY or AI_GATEWAY_API_KEY
bun examples/run.ts "Open Settings and go to General, then About"
```

Each decision prints as it happens:

```text
phone: iPhone 17 Pro
 1.   1.7s  BACK  conf 0.92  done 0.01  393ms  → went back — screen changed
 2.   4.6s  BACK  conf 0.41  done 0.01  264ms  → went back — screen changed
 3.   7.4s  TAP "General"  conf 1.00  done 0.02  263ms  → tapped "General" — screen changed
 4.  10.7s  TAP "About"  conf 0.96  done 0.16  263ms  → tapped "About" — screen changed
 5.  14.9s  DONE  conf 0.99  done 0.92  1210ms  [done: independent check 0.92]
```

`bun examples/bold-text.ts` and `bun examples/new-contact.ts` are the verified examples. The first forces Bold Text off, runs the goal, then walks to the switch with plain verbs and reads it. The second confirms a unique name is absent, runs the goal, relaunches Contacts and finds the contact through search. A `DONE` from the model is not proof; the read-back is.

The contact run is also where the done veto earns its keep: with both names typed and the form unsaved, Jev proposes `DONE`; the independent check, reading the same screen, puts P(done) below 0.1; `DONE` is removed from the next request's options and Jev taps `Done`.

```text
 1. TAP "Add"                          conf 0.99  → screen changed
 2. TYPE "First name" ← "Ada"          conf 0.88  +text 339ms
 3. TYPE "Last name" ← "LovelaceCQDL"  conf 0.85  +text 406ms
 4. DONE                               done 0.07  → vetoed
 5. TAP "Done"                         conf 0.96  → screen changed
 6. DONE                               done 0.68  [done]
```

Jev is reachable two ways: TypeSafe's API (`TYPESAFE_API_KEY`) or the [Vercel AI Gateway](https://vercel.com/ai-gateway) (`AI_GATEWAY_API_KEY`, model `typesafe-ai/jev`). The text helper for `TYPE` speaks the OpenAI chat-completions dialect and defaults to the gateway with Llama 4 Scout, reusing the same key; point `TEXT_MODEL_BASE_URL` / `TEXT_MODEL` at anything compatible.

For a cloud iPhone: `phone-use create ios`, then `eval "$(phone-use env <id>)"` and `--device cloud`.

## Use the library

It is not on npm; add it from git (`bun add github:Rajmeet/jev-phone`) or copy `src/`.

```ts
import { connectDevice, run } from 'jev-phone';

const phone = await connectDevice('connect'); // booted simulator; 'launch' | 'cloud' | '<udid>'
for await (const step of run(phone.core, 'Turn on Bold Text in Settings')) {
  console.log(step.decision.op, step.decision.element?.label, step.jevMs);
}
await phone.close();
```

`run()` is an async generator: one event per decision, the final result as its return value. `runGoal()` runs to completion. Options: `maxSteps` (25), `doneThreshold` (0.6), `minConfidence` (0 — act on the argmax), `text` (your own helper, or `null` to disable typing), `allowDestructive`, `screenshotDir`.

## Why it moves

- **One request per decision.** Operation and target heads share the same observed state; the done-check rides along.
- **Jev never generates.** Choices come back as label + probability + confidence in ~250–500 ms. The only generation is the text helper, called only for `TYPE`.
- **One observation per step.** The accessibility tree, read once, gives roles, labels, values and frames. Screenshots are optional and the model never sees them.
- **Validate the answer.** Probability keys must equal the offered labels, sum to 1, and the pick must be the argmax. Anything else is a failure, never repaired.
- **Re-find before acting.** The chosen element is re-located on a fresh observation by role, label and value. If it moved, it is pressed where it is now; if it is gone, the agent decides again.
- **Switches at the knob.** An iOS switch's frame spans the row; the centre is the label. `TOGGLE` presses 24 pt from the right edge and reads the value back.
- **Never retry a mutation.** A timed-out press may already have landed.

Every executed target is an observed element. Model output never becomes a selector, a coordinate, a shell command or code. The text helper's output must parse as exactly `{"text": string | null}` before anything is typed.

## Small enough to read

| File | Job |
| --- | --- |
| [agent.ts](src/agent.ts) | The loop, the done veto, the text-helper handoff, execution |
| [policy.ts](src/policy.ts) | The one request: operations, target heads, the done check |
| [screen.ts](src/screen.ts) | Observation → indexed action space; re-finding an element |
| [jev.ts](src/jev.ts) | Plain-fetch Jev client, two transports, strict validation |
| [text.ts](src/text.ts) | The text helper and its contract |
| [apps.ts](src/apps.ts) | What OPEN_APP may target: installed apps plus the built-in Apple ones |
| [device.ts](src/device.ts) | Local simulator or cloud phone; cloud session recovery |

About 1,100 lines of TypeScript including comments, one runtime dependency (`@phone-use/sdk`).

## Evidence and limits

Three goals on one local simulator, all verified independently: **Bold Text on in 11.2 s / 4 decisions** from the Settings root, **General → About in 14.9 s / 5 decisions** from two screens deep in another section, and **a contact created in 19.4 s / 6 decisions** with two typed values (text helper 339 and 406 ms). Jev latency was 260–550 ms per decision, with two outliers at 1.1–1.4 s on the busiest screens. Full records, and the five discarded attempts with what each one changed, are in [performance.md](docs/performance.md) and [measurement.json](docs/measurement.json).

That is three goals in two first-party apps. It is not a general phone-agent evaluation. On the [iOSWorld](https://github.com/ljang0/iOSWorld) benchmark this policy earns partial credit for the steps it performs, but most iOSWorld tasks also ask the agent to *report* something — and a System One model has no reply channel. Pair it with an LLM for those; the loop stops with a reason when it cannot proceed.

Known limits: unlabeled icons, custom controls, canvas and in-app web content leave nothing to offer; permission prompts and system alerts are outside the policy; there is no `HOME` (the local simulator backend's home press is a no-op, so `OPEN_APP` switches apps instead); a valid action can still be the wrong one. `DONE` is accepted only with the independent check, and the examples still read the device afterwards.

## Development

```bash
bun run check     # biome + tsc + tests (offline: a scripted Jev and phone-use's FakeBackend)
```

Tests never call paid APIs. Live examples do; their logs are kept under `docs/runs/`.

## Related

- [jev-ultrafast](https://github.com/browser-use/jev-ultrafast) — Browser Use's browser agent with the same operation + target design, which this follows.
- [phone-use](https://github.com/Rajmeet/phone-use) — the device runtime underneath, and the full agent harness (maps, skills, permissions) that the Jev runner there plugs into.
- [TypeSafe: System One models](https://docs.typesafe.ai/concepts/system-one)

MIT.
