// Run one goal and print each decision as it happens.
//
//   bun examples/run.ts "Open Settings and go to General, then About"
//   bun examples/run.ts --device cloud --screenshots docs/runs/demo "…"
//
// --device connect|launch|android|cloud|<udid>   (default: JEV_PHONE_DEVICE or connect)
// --screenshots <dir>                   save a screenshot per step (for demos)
// --allow-destructive                   permit taps on Delete/Pay/Send-style controls
// --json                                print the final result as JSON
// --debug                               print every answer's probabilities
import { mkdirSync } from 'node:fs';
import { connectDevice, run } from '../src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const has = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const device = flag('--device');
const screenshotDir = flag('--screenshots');
const allowDestructive = has('--allow-destructive');
const json = has('--json');
const debug = has('--debug');
const goal = args.join(' ').trim();
if (!goal) {
  console.error('usage: bun examples/run.ts [--device connect|launch|android|cloud|<udid>] [--screenshots <dir>] "<goal>"');
  process.exit(1);
}
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

const phone = await connectDevice(device);
console.error(`phone: ${phone.name}`);
try {
  const it = run(phone.core, goal, { screenshotDir, allowDestructive });
  for (;;) {
    const n = await it.next();
    if (n.done) {
      const r = n.value;
      if (json) console.log(JSON.stringify(r, null, 2));
      else
        console.error(
          `\n[${r.status}] ${r.reason}\n${r.decisions} decisions, Jev avg ${Math.round(r.jevMs / Math.max(1, r.decisions))}ms, ${(r.elapsedMs / 1000).toFixed(1)}s total`,
        );
      process.exit(r.status === 'done' ? 0 : 2);
    }
    const e = n.value;
    const d = e.decision;
    if (debug) {
      for (const [id, a] of Object.entries(e.answers)) {
        const body =
          a.type === 'noul'
            ? a.noul.toFixed(2)
            : Object.entries(a.probabilities)
                .sort((x, y) => y[1] - x[1])
                .slice(0, 6)
                .map(([k, p]) => `${k} ${p.toFixed(2)}`)
                .join('  ');
        console.error(`      ${id.padEnd(14)} ${body}`);
      }
    }
    const target = d.element?.label ?? d.app;
    console.error(
      `${String(e.step).padStart(2)}. ${(e.elapsedMs / 1000).toFixed(1).padStart(5)}s  ${d.op}${target ? ` "${target}"` : ''}` +
        `${e.action?.text ? ` ← ${JSON.stringify(e.action.text)}` : ''}  conf ${d.confidence.toFixed(2)}  done ${d.goalDone.toFixed(2)}  ${e.jevMs}ms${e.textMs !== undefined ? ` +text ${e.textMs}ms` : ''}` +
        `${e.action ? `  → ${e.action.outcome}` : ''}${e.status ? `  [${e.status}: ${e.reason}]` : ''}`,
    );
  }
} finally {
  await phone.close();
}
