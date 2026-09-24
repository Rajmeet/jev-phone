// The typing example: create a contact, then verify it INDEPENDENTLY by
// relaunching Contacts and finding it. Exercises OPEN_APP, TAP, two TYPEs
// through the text helper, and the DONE veto (Jev tends to say DONE before
// the form is saved; the independent check disagrees, and it taps Done).
//
//   bun examples/new-contact.ts [--device connect|launch|android|cloud|<udid>]
import { connectDevice, run } from '../src/index.ts';

const args = process.argv.slice(2);
const di = args.indexOf('--device');
const device = di === -1 ? undefined : args[di + 1];
// A unique last name per run makes the verification unambiguous.
const LAST = `Lovelace${Date.now().toString(36).slice(-4).toUpperCase()}`;
const GOAL = `Create a new contact whose first name is Ada and last name is ${LAST}, and save it.`;

const phone = await connectDevice(device);
const core = phone.core;
console.error(`phone: ${phone.name}\ngoal: ${GOAL}`);

/** Relaunch Contacts and back out to the list (a restored card or a filtered search is not a start state). */
async function toList(): Promise<void> {
  await core.openApp('com.apple.MobileAddressBook', true);
  await new Promise((r) => setTimeout(r, 1500));
  for (let i = 0; i < 4; i++) {
    await core.observe();
    if (core.interactiveElements().some((e) => e.label === 'Add')) return;
    await core.goBack().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 700));
  }
}

/** Look the unique last name up through the list's search field (the seeded list is 100+ long). */
async function present(): Promise<string | null> {
  await toList();
  const search = core.inputFields(true).find((e) => /search/i.test(e.label) || e.role === 'SearchField');
  if (!search) throw new Error('verify: no search field on the Contacts list');
  await core.fill(search.ref, LAST);
  await new Promise((r) => setTimeout(r, 1200));
  await core.observe();
  return core.interactiveElements().find((e) => e.role === 'Cell' && e.label.includes(LAST))?.label ?? null;
}

try {
  // Start on the Contacts LIST, relaunched and backed out of any open card: a
  // run that starts on an existing card can just edit it (seen live). The
  // unique last name must not exist yet.
  if (await present()) throw new Error(`setup: a contact named ${LAST} already exists`);
  await toList(); // the lookup leaves a filtered search behind
  console.error('start: Contacts list');

  const latencies: number[] = [];
  const textLatencies: number[] = [];
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
    if (n.value.textMs !== undefined) textLatencies.push(n.value.textMs);
    const d = n.value.decision;
    console.error(
      `${n.value.step}. ${d.op}${d.element ? ` "${d.element.label}"` : d.app ? ` "${d.app}"` : ''}${n.value.action?.text ? ` ← ${JSON.stringify(n.value.action.text)}` : ''} conf ${d.confidence.toFixed(2)} ${n.value.jevMs}ms${n.value.action ? ` → ${n.value.action.outcome}` : ''}`,
    );
  }
  const elapsed = Date.now() - t0;
  const r = result as Exclude<typeof result, undefined>;

  // Verify: a contact "Ada <unique last name>" now exists in a relaunched Contacts.
  const found = await present();
  const verified = found != null && /^Ada\b/.test(found);
  console.error(
    `\n[${r.status}] ${r.reason}\nverified: ${found ? `"${found}" is in Contacts` : 'not found'} → ${verified ? 'PASS' : 'FAIL'}`,
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
      text_latencies_ms: textLatencies,
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
