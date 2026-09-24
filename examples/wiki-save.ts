// A third-party app: Wikipedia. Search, open the article, save it for later —
// then verify from the Saved tab, not from DONE. Needs the Wikipedia app
// installed on the simulator (App Store build or the open-source app).
//
//   bun examples/wiki-save.ts [--device connect|launch|cloud|<udid>]
import { mkdirSync } from 'node:fs';
import { connectDevice, run } from '../src/index.ts';

const ARTICLE = 'Lisbon';
const GOAL = `In Wikipedia, search for ${ARTICLE}, open the article about the city, and save it for later.`;
const APP = 'org.wikimedia.wikipedia';
const args = process.argv.slice(2);
const di = args.indexOf('--device');
const device = di === -1 ? undefined : args[di + 1];
const shots = 'docs/runs/wiki-save';
mkdirSync(shots, { recursive: true });

const phone = await connectDevice(device);
const core = phone.core;
console.error(`phone: ${phone.name}\ngoal: ${GOAL}`);

/** Relaunch Wikipedia, open the Saved tab, and look for the article. */
async function saved(): Promise<boolean> {
  await core.openApp(APP, true);
  await new Promise((r) => setTimeout(r, 2500));
  await core.observe();
  const tab = core.interactiveElements().find((e) => /^Saved$/i.test(e.label));
  if (!tab) throw new Error('verify: no Saved tab in Wikipedia');
  await core.press(tab.ref);
  await new Promise((r) => setTimeout(r, 1500));
  await core.observe();
  return core.nodes().some((n) => new RegExp(`^${ARTICLE}\\b`).test(n.label ?? ''));
}

try {
  if (await saved()) throw new Error(`setup: ${ARTICLE} is already saved — unsave it first`);
  await core.openApp(APP, true);
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

  const verified = await saved();
  console.error(
    `\n[${r.status}] ${r.reason}\nverified: ${ARTICLE} ${verified ? 'is' : 'is NOT'} in the Saved tab → ${verified ? 'PASS' : 'FAIL'}`,
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
