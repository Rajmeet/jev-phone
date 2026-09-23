# jev-phone

Read README.md before editing. Keep the loop small: screen → indexed elements → operation + target → device verb.

- The input is one natural-language goal. No app-specific plans, no hardcoded field values.
- Jev chooses an operation and operation-specific target heads in ONE request. Consume only the selected operation's target.
- Targets must map to observed elements; every target is re-found on a fresh observation before acting. The model never emits selectors, coordinates, or code.
- TYPE invokes the text helper. Its output must be exactly {"text": string | null}; null types nothing.
- Never retry a device mutation. Record the outcome before the next observation.
- Screenshots are optional and the model never consumes them. Demo footage plays at its original speed.
- Keep credentials in .env (ignored). Tests must not call paid APIs.
- Verify actual final outcomes independently. A DONE choice is not proof of success; the independent check is not either — read the device.
- Keep README claims, docs/measurement.json and the run logs under docs/runs consistent.
- Do not commit or push unless the user requests it.

Checks: `bun run check` (biome + tsc + tests).
