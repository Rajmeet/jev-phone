// The multi-app-surface example: a real place search in Apple Maps, the
// place card, and a computed walking route — then verify the route is on
// screen by reading the tree, not by trusting DONE. Saves a screenshot per
// step (the README demo). The simulator needs a location:
//   xcrun simctl location <udid> set 37.7955,-122.3937   (Ferry Building, SF)
//
//   bun examples/directions.ts [--device connect|launch|cloud|<udid>]
import { mkdirSync } from 'node:fs';
import { connectDevice, run } from '../src/index.ts';

const GOAL =
  'In Maps, search for Blue Bottle Coffee, open the first result and get walking directions to it. Stop when the walking route is showing.';
const args = process.argv.slice(2);
const di = args.indexOf('--device');
const device = di === -1 ? undefined : args[di + 1];
const shots = 'docs/runs/directions';
mkdirSync(shots, { recursive: true });

const phone = await connectDevice(device);
const core = phone.core;
console.error(`phone: ${phone.name}\ngoal: ${GOAL}`);

try {
  // Start with Maps freshly launched on its default screen.
  await core.openApp('com.apple.Maps', true);
  await new Promise((r) => setTimeout(r, 2500));

  const latencies: number[] = [];
  const t0 = Date.now();
  const it = run(core, GOAL, { screenshotDir: shots });
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
      `${n.value.step}. ${(n.value.elapsedMs / 1000).toFixed(1)}s ${d.op}${d.element ? ` "${d.element.label}"` : d.app ? ` "${d.app}"` : ''}${n.value.action?.text ? ` ← ${JSON.stringify(n.value.action.text)}` : ''} conf ${d.confidence.toFixed(2)} ${n.value.jevMs}ms${n.value.action ? ` → ${n.value.action.outcome}` : ''}`,
    );
  }
  const elapsed = Date.now() - t0;
  const r = result as Exclude<typeof result, undefined>;

  // Verify from the tree: a walking route row ("N min … ft/mi") with Blue Bottle as the destination.
  await core.observe();
  const labels = core.nodes().map((n) => n.label ?? '');
  const route = labels.find((l) => /^\d+\s?min\b/.test(l) && /(ft|mi|walk)/i.test(l));
  const dest = labels.some((l) => /Blue Bottle/i.test(l));
  const verified = Boolean(route) && dest && /Maps/.test(core.currentApp() ?? '');
  console.error(
    `\n[${r.status}] ${r.reason}\nverified: ${route ? `route "${route}"` : 'no route row'}${dest ? ', destination Blue Bottle Coffee' : ', destination missing'} → ${verified ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      goal: GOAL,
      device: phone.name,
      status: r.status,
      verified,
      route,
      elapsed_ms: elapsed,
      decisions: r.decisions,
      request_latencies_ms: latencies,
      steps: r.steps.map(
        (s) =>
          `${s.op}${s.target ? ` "${s.target}"` : ''}${s.text ? ` ← ${JSON.stringify(s.text)}` : ''} → ${s.outcome}`,
      ),
    }),
  );
  process.exit(verified ? 0 : 2);
} finally {
  await phone.close();
}
