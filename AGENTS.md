# Working on jev-phone

Read README.md first; it is the spec. This file is the setup and the rules.

## Setup

- Bun 1.3+. `bun install`. The only runtime dependency is `@phone-use/sdk`.
- `.env` (ignored) with `AI_GATEWAY_API_KEY`, or `TYPESAFE_API_KEY`. The gateway key also covers the text helper. `.env.example` lists every variable.
- A phone:
  - iOS: macOS, Xcode, a booted simulator (`xcrun simctl list devices booted`). Maps needs a location: `xcrun simctl location <udid> set 37.7955,-122.3937`.
  - Android: an emulator or device that `adb devices` lists.
  - Cloud: `npm i -g phone-use`, `phone-use login`, `phone-use create ios|android`, `eval "$(phone-use env <id>)"`, then `--device cloud`.
- `bun run check` runs biome, tsc and the tests. Run it before every commit. Tests use a fake phone and a scripted Jev and never call a network.

## Layout

- `src/agent.ts`: the loop. `src/policy.ts`: the one request and how the answer is read. `src/screen.ts`: tree to numbered menu, `Phone` class, re-finding an element. `src/jev.ts`: the client. `src/text.ts`: the text helper. `src/apps.ts`: what `OPEN_APP` may open. `src/device.ts`: simulator, adb, or cloud.
- `examples/run.ts` runs any goal. `directions.ts`, `wiki-save.ts`, `bold-text.ts`, `new-contact.ts` run a fixed goal and then read the phone to check it. They are the source of every number in the README.
- `docs/design.md` explains the decisions. `docs/performance.md` and `docs/measurement.json` hold the numbers. `docs/runs/` holds the console output of every run cited anywhere, including the ones that failed.

## Rules

- One goal in, one Jev request per step. Jev picks the operation and the target; only the head matching the chosen operation is used.
- Jev never writes text. `TYPE` goes through the text helper, whose output must be exactly `{"text": string | null}`. Null types nothing. No quoted-string extraction from the goal.
- Every target is an observed element, re-found on a fresh read before acting. Model output never becomes a selector, a coordinate, or code.
- No `HOME` operation. The simulator's home press is a no-op; `OPEN_APP` switches apps.
- Never retry a device mutation. Two tree reads per step, not more; a read is the bottleneck.
- `DONE` needs the done-check (0.6). A vetoed `DONE` withholds `DONE` and the last control tapped (keyed by position and label) from the next request. A second `DONE` is accepted unless the check is below 0.2.
- Controls whose tap errored or changed nothing are withheld for two decisions. Three `WAIT`s in a row withhold `WAIT`. The same action failing twice ends the run.
- Destructive labels (Delete, Pay, Send, …) are refused without `allowDestructive`.
- Android: only the curated app list, filtered to installed packages; fields are `TextField` or the raw input classes, never `TextView`.

## Measurements

- A number goes in the README only if it comes from a run whose log is in `docs/runs/` and whose end state was checked by reading the phone (a switch value, a database row, a route in the tree, an entry in a list). `DONE` is not a check.
- Start states matter. A run that starts on the target screen is not a measurement; the examples relaunch the app and confirm the start.
- A run that is discarded stays in `docs/performance.md` with the reason and what it changed.
- Keep README, `docs/performance.md`, `docs/measurement.json` and the logs consistent. When code changes affect speed, re-run and replace the numbers; keep the old ones below as history.
- Demo footage plays at recorded speed. The montage is built from per-step screenshots at each run's step timings.

## Style

- Plain sentences. No marketing words, no "verified" in every line, no em dashes.
- Do not commit or push unless asked.
