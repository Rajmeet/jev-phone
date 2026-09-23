// The loop end to end with NO network: a scripted Jev client and the SDK's
// FakeBackend stand in for the model and the phone.
import { describe, expect, it } from 'bun:test';
import { el, FakeBackend, screen } from '@phone-use/sdk/testing';
import { runGoal } from '../src/agent.ts';
import type { JevAnswer, JevClient, JevQuestion } from '../src/jev.ts';
import { buildRequest } from '../src/policy.ts';
import { Phone, readScreen } from '../src/screen.ts';

type Pick = { choice?: string; confidence?: number; noul?: number };
type Wire = { state: unknown; questions: Record<string, JevQuestion> };

/** Scripted Jev: each call takes the next step; unscripted choices pick their first label at 0.9. */
function scripted(script: Array<Record<string, Pick>>, seen: Wire[] = []): JevClient {
  let i = 0;
  return {
    model: 'scripted',
    provider: 'typesafe',
    async ask(state, questions) {
      seen.push({ state, questions });
      const step = script[Math.min(i++, script.length - 1)] ?? {};
      const answers: Record<string, JevAnswer> = {};
      for (const [id, q] of Object.entries(questions)) {
        const s = step[id] ?? {};
        if (q.type === 'noul') answers[id] = { type: 'noul', noul: s.noul ?? 0.1 };
        else {
          const labels = Object.keys(q.criteria);
          const pick = s.choice ?? labels[0]!;
          const c = s.confidence ?? 0.9;
          const rest = labels.length > 1 ? (1 - c) / (labels.length - 1) : 0;
          answers[id] = {
            type: 'choice',
            choice: pick,
            confidence: c,
            probabilities: Object.fromEntries(labels.map((l) => [l, l === pick ? c : rest])),
          };
        }
      }
      return { ok: true, answers, ms: 1, model: 'scripted' };
    },
  };
}

const row = (ref: string, label: string, y: number) =>
  el({ ref, label, role: 'Cell', rect: { x: 0, y, width: 390, height: 44 } });

function settingsPhone() {
  const fake = new FakeBackend({
    screens: [
      screen([row('e1', 'General', 100), row('e2', 'Privacy', 150)], { appName: 'Settings' }),
      screen([row('e3', 'About', 100), row('e4', 'Software Update', 150)], { appName: 'Settings' }),
    ],
    onAction: (call, current) => (call.method === 'press' && current === 0 ? 1 : undefined),
  });
  return { fake, core: new Phone(fake) };
}

describe('action space', () => {
  it('offers only what the screen supports, and switches only under TOGGLE', async () => {
    const fake = new FakeBackend({
      screens: [
        screen(
          [
            row('c1', 'Text Size', 200),
            el({
              ref: 's1',
              type: 'Switch',
              label: 'Bold Text',
              value: '0',
              rect: { x: 36, y: 146, width: 330, height: 28 },
            }),
          ],
          { appName: 'Settings' },
        ),
      ],
    });
    const s = await readScreen(new Phone(fake), []);
    expect(s.controls.map((e) => e.label)).toEqual(['Text Size']);
    expect(s.switches.map((e) => e.label)).toEqual(['Bold Text']);
    const { ops, questions } = buildRequest('turn on Bold Text', s, [], new Set());
    expect(ops).toContain('TOGGLE');
    expect(ops).not.toContain('TYPE');
    expect(ops).not.toContain('OPEN_APP');
    // Single-option heads are not asked: one control, one switch → no target questions.
    expect(Object.keys(questions)).toEqual(['operation', 'goal_done']);
  });
});

describe('loop', () => {
  it('taps the chosen control and completes on a verified DONE', async () => {
    const { fake, core } = settingsPhone();
    const seen: Wire[] = [];
    const r = await runGoal(core, 'open General in Settings', {
      jev: scripted(
        [
          { operation: { choice: 'TAP' }, tap_target: { choice: '1' } },
          { operation: { choice: 'DONE' }, goal_done: { noul: 0.93 } },
        ],
        seen,
      ),
      text: null,
      apps: [],
    });
    expect(r.status).toBe('done');
    expect(fake.calls.find((c) => c.method === 'press')?.args[0]).toEqual({ ref: '@e1' });
    expect(r.steps[0]?.outcome).toContain('screen changed');
    // The second request carries the outcome of the first action.
    expect(JSON.stringify(seen[1]?.state)).toContain('screen changed');
  });

  it('vetoes an unverified DONE once, then stops rather than claim success', async () => {
    const { core } = settingsPhone();
    const seen: Wire[] = [];
    const r = await runGoal(core, 'turn on Bluetooth', {
      jev: scripted(
        [
          { operation: { choice: 'DONE' }, goal_done: { noul: 0.2 } },
          { operation: { choice: 'DONE' }, goal_done: { noul: 0.3 } },
        ],
        seen,
      ),
      text: null,
      apps: [],
    });
    expect(r.status).toBe('blocked');
    expect(r.reason).toContain('not visibly confirmed');
    const second = Object.keys((seen[1]?.questions.operation as { criteria: object } | undefined)?.criteria ?? {});
    expect(second).not.toContain('DONE');
  });

  it('never invents text: a null value from the helper stops the run without typing', async () => {
    const fake = new FakeBackend({
      screens: [
        screen([el({ ref: 'f1', type: 'TextField', label: 'Name', rect: { x: 0, y: 100, width: 390, height: 44 } })], {
          appName: 'Contacts',
        }),
      ],
    });
    const r = await runGoal(new Phone(fake), 'fill in my name', {
      jev: scripted([{ operation: { choice: 'TYPE' } }]),
      text: async () => null,
      apps: [],
    });
    expect(r.status).toBe('blocked');
    expect(r.reason).toContain('does not say what to type');
    expect(fake.calls.some((c) => c.method === 'fill' || c.method === 'typeText')).toBe(false);
  });

  it("types the helper's value into the field Jev chose", async () => {
    const fake = new FakeBackend({
      screens: [
        screen([el({ ref: 'f1', type: 'TextField', label: 'Name', rect: { x: 0, y: 100, width: 390, height: 44 } })], {
          appName: 'Contacts',
        }),
      ],
    });
    const asked: string[] = [];
    const r = await runGoal(new Phone(fake), 'set the name to Ada', {
      jev: scripted([{ operation: { choice: 'TYPE' } }, { operation: { choice: 'DONE' }, goal_done: { noul: 0.9 } }]),
      text: async (req) => {
        asked.push(req.field.label);
        return 'Ada';
      },
      apps: [],
    });
    expect(r.status).toBe('done');
    expect(asked).toEqual(['Name']);
    expect(fake.calls.find((c) => c.method === 'fill')?.args).toEqual(['@f1', 'Ada']);
  });

  it('presses a switch at its knob, not the centre of its row-wide frame', async () => {
    const sw = (value: string) =>
      screen(
        [el({ ref: 's1', type: 'Switch', label: 'Bold Text', value, rect: { x: 36, y: 146, width: 330, height: 28 } })],
        { appName: 'Settings' },
      );
    const fake = new FakeBackend({
      screens: [sw('0'), sw('1')],
      onAction: (call, current) => (call.method === 'press' && current === 0 ? 1 : undefined),
    });
    const r = await runGoal(new Phone(fake), 'turn on Bold Text', {
      jev: scripted([{ operation: { choice: 'TOGGLE' } }, { operation: { choice: 'DONE' }, goal_done: { noul: 0.9 } }]),
      text: null,
      apps: [],
    });
    expect(r.status).toBe('done');
    expect(fake.calls.find((c) => c.method === 'press')?.args[0]).toEqual({ x: 36 + 330 - 24, y: 160 });
    expect(r.steps[0]?.outcome).toContain('0 → 1');
  });

  it('does not tap when the chosen element vanished between deciding and acting', async () => {
    const fake = new FakeBackend({
      screens: [
        screen([row('e1', 'General', 100), row('e2', 'Privacy', 150)], { appName: 'Settings' }),
        screen([row('e5', 'Delete Stale Probe', 100), row('e6', 'Privacy', 150)], { appName: 'Settings' }),
      ],
    });
    // The screen changes while the first Jev request is in flight.
    let asked = 0;
    const inner = scripted([
      { operation: { choice: 'TAP' }, tap_target: { choice: '1' } },
      { operation: { choice: 'BLOCKED' } },
    ]);
    const jev: JevClient = {
      ...inner,
      async ask(state, questions, opts) {
        if (asked++ === 0) fake.setScreen(1);
        return inner.ask(state, questions, opts);
      },
    };
    const r = await runGoal(new Phone(fake), 'open General', { jev, text: null, apps: [] });
    expect(fake.calls.some((c) => c.method === 'press')).toBe(false);
    expect(r.steps[0]?.outcome).toContain('stale');
    expect(r.status).toBe('blocked');
  });

  it('refuses destructive taps unless allowed', async () => {
    const fake = new FakeBackend({
      screens: [screen([row('d1', 'Delete Account', 100), row('d2', 'Keep', 150)], { appName: 'Files' })],
    });
    const r = await runGoal(new Phone(fake), 'delete my account', {
      jev: scripted([{ operation: { choice: 'TAP' }, tap_target: { choice: '1' } }]),
      text: null,
      apps: [],
    });
    expect(r.status).toBe('blocked');
    expect(r.reason).toContain('allowDestructive');
    expect(fake.calls.some((c) => c.method === 'press')).toBe(false);
  });

  it('stops honestly when Jev is unreachable', async () => {
    const { core } = settingsPhone();
    const down: JevClient = {
      model: 'x',
      provider: 'typesafe',
      ask: async () => ({ ok: false, reason: 'HTTP 503', ms: 5 }),
    };
    const r = await runGoal(core, 'open General', { jev: down, text: null, apps: [] });
    expect(r.status).toBe('stopped');
    expect(r.reason).toContain('HTTP 503');
  });
});
