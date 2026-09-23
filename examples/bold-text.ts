// The verified example: turn on Bold Text in Settings, then check the switch
// INDEPENDENTLY of the agent's DONE — a DONE choice is not proof of success.
// Prints a measurement record (docs/measurement.json is a list of these).
//
//   bun examples/bold-text.ts [--device connect|launch|cloud|<udid>] [--reset]
import { connectDevice, run } from '../src/index.ts';

const GOAL = 'In Settings, open Accessibility, then Display & Text Size, and turn on Bold Text.';
const args = process.argv.slice(2);
const di = args.indexOf('--device');
const device = di === -1 ? undefined : args[di + 1];

const phone = await connectDevice(device);
const core = phone.core;
console.error(`phone: ${phone.name}`);

/** Read the Bold Text switch by walking there with plain verbs — no model involved. */
async function boldTextValue(): Promise<string | undefined> {
  await core.openApp('com.apple.Preferences', true);
  await new Promise((r) => setTimeout(r, 1200));
  for (const label of ['Accessibility', 'Display & Text Size']) {
    await core.observe();
    const el = await core.findElement(label);
    if (!el) throw new Error(`setup: "${label}" not found`);
    await core.press(el.ref);
    await new Promise((r) => setTimeout(r, 900));
  }
  await core.observe();
  return core.interactiveElements().find((e) => e.role === 'Switch' && e.label === 'Bold Text')?.value;
}

try {
  // Start from OFF so "turn on" requires a real state change, then leave Settings.
  const before = await boldTextValue();
  if (before === '1') {
    const sw = core.interactiveElements().find((e) => e.role === 'Switch' && e.label === 'Bold Text');
    if (!sw?.rect) throw new Error('setup: Bold Text switch has no frame');
    await core.pressAt(Math.round(sw.rect.x + sw.rect.width - 24), Math.round(sw.rect.y + sw.rect.height / 2));
  }
  // Leave Settings on its ROOT screen (relaunch) and go home; wait until the
  // launcher is frontmost so the run really starts from the home screen.
  await core.openApp('com.apple.Preferences', true);
  await new Promise((r) => setTimeout(r, 800));
  await core.goHome();
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    await core.observe();
    if (!/preferences/i.test(core.currentApp() ?? '')) break;
  }
  console.error(`start: ${core.currentApp() ?? 'unknown'}`);

  const latencies: number[] = [];
  const t0 = Date.now();
  const it = run(core, GOAL);
  let result: Awaited<ReturnType<typeof it.next>>['value'] | undefined;
  for (;;) {
    const n = await it.next();
    if (n.done) {
      result = n.value;
      break;
    }
    latencies.push(n.value.jevMs);
    const d = n.value.decision;
    console.error(
      `${n.value.step}. ${d.op}${d.element ? ` "${d.element.label}"` : d.app ? ` "${d.app}"` : ''} conf ${d.confidence.toFixed(2)} ${n.value.jevMs}ms${n.value.action ? ` → ${n.value.action.outcome}` : ''}`,
    );
  }
  const elapsed = Date.now() - t0;
  const r = result as Exclude<typeof result, undefined>;

  const after = await boldTextValue();
  const verified = after === '1';
  console.error(
    `\n[${r.status}] ${r.reason}\nverified: Bold Text switch reads ${after ?? 'not found'} → ${verified ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      goal: GOAL,
      device: phone.name,
      status: r.status,
      verified,
      elapsed_ms: elapsed,
      decisions: r.decisions,
      request_latencies_ms: latencies,
      steps: r.steps.map((s) => `${s.op}${s.target ? ` "${s.target}"` : ''} → ${s.outcome}`),
    }),
  );
  process.exit(verified ? 0 : 2);
} finally {
  await phone.close();
}
