// The loop: observe → one Jev request → execute the pick → repeat, until Jev
// says DONE and an independent check agrees, says BLOCKED, or the budget runs
// out. Every executed target is an observed element re-found on a fresh
// observation immediately before acting; model output never becomes a
// selector, a coordinate, or code.
import type { UiElement } from '@phone-use/sdk';
import { type App, discoverApps } from './apps.ts';
import { createJevClient, type JevAnswer, type JevClient } from './jev.ts';
import { buildRequest, type Decision, type Op, resolve, type Step } from './policy.ts';
import { elementKey, type Phone, positionKey, readScreen, refind, type Screen } from './screen.ts';
import { type TextHelper, textHelper } from './text.ts';

export type AgentOptions = {
  jev?: JevClient | undefined;
  /** Writes the value for TYPE. Default: textHelper() from the environment; null disables TYPE. */
  text?: TextHelper | null | undefined;
  /** Decisions (Jev requests) before giving up. Default 25. */
  maxSteps?: number | undefined;
  /** P(goal done) the independent check must reach before DONE is accepted. Default 0.6. */
  doneThreshold?: number | undefined;
  /** Below this min(operation, target) confidence the run stops. Default 0: act on the argmax. */
  minConfidence?: number | undefined;
  /** Labels that must not be tapped without opting in (default: destructive/financial verbs). */
  destructive?: RegExp | undefined;
  allowDestructive?: boolean | undefined;
  /** Apps OPEN_APP may target. Default: installed third-party apps plus the built-in Apple apps. */
  apps?: App[] | undefined;
  /** Save a screenshot per step into this directory (for demos; the model never sees them). */
  screenshotDir?: string | undefined;
  signal?: AbortSignal | undefined;
};

export type AgentEvent = {
  step: number;
  elapsedMs: number;
  screen: { app: string | undefined; title: string; controls: number; switches: number; fields: number };
  offered: Op[];
  decision: Decision;
  /** Every answer in the request, with probabilities — for inspection and traces. */
  answers: Record<string, JevAnswer>;
  jevMs: number;
  /** Text-helper latency, when this step typed. */
  textMs?: number | undefined;
  /** Set when the step executed something. */
  action?: Step | undefined;
  /** Terminal status, set on the last event only. */
  status?: 'done' | 'blocked' | 'stopped' | 'budget' | undefined;
  reason?: string | undefined;
};

export type AgentResult = {
  status: 'done' | 'blocked' | 'stopped' | 'budget';
  reason: string;
  steps: Step[];
  decisions: number;
  jevMs: number;
  elapsedMs: number;
};

export const DESTRUCTIVE =
  /\b(delete|remove|erase|pay|purchase|buy|send|transfer|confirm order|place order|sign out|log out|unsubscribe|cancel subscription|reset|format)\b/i;

const LAUNCH_SETTLE_MS = 12_000;
const LAUNCH_MIN_CONTROLS = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const firstLine = (s: string) => (s.split('\n')[0] ?? '').slice(0, 160);
const changed = (did: boolean | undefined) =>
  did === undefined ? '' : did ? ' — screen changed' : ' — no visible change';

/** Launches are asynchronous: wait until the new app is frontmost AND populated. */
async function settleAfterLaunch(core: Phone, before: string | undefined): Promise<void> {
  const deadline = Date.now() + LAUNCH_SETTLE_MS;
  let last = -1;
  while (Date.now() < deadline) {
    await core.observe().catch(() => undefined);
    const vh = core.viewportHeight();
    const controls = core.interactiveElements().filter((e) => e.rect && e.rect.y < vh).length;
    // Populated, or at least stable: a near-empty Contacts list never reaches
    // the control floor and waited out the whole ceiling (17 s, live).
    if (core.currentApp() !== before && controls > 0 && (controls >= LAUNCH_MIN_CONTROLS || controls === last)) return;
    last = controls;
    await sleep(500);
  }
}

/** Run one goal. Yields an event per decision; the return value is the final result. */
export async function* run(
  core: Phone,
  goal: string,
  opts: AgentOptions = {},
): AsyncGenerator<AgentEvent, AgentResult> {
  const jev = opts.jev ?? createJevClient();
  const writeText = opts.text === undefined ? textHelper() : opts.text;
  const maxSteps = opts.maxSteps ?? 25;
  const doneThreshold = opts.doneThreshold ?? 0.6;
  const minConfidence = opts.minConfidence ?? 0;
  const destructive = opts.destructive ?? DESTRUCTIVE;
  const start = Date.now();
  const history: Step[] = [];
  const vetoed = new Set<Op>();
  let doneVetoed = false;
  let staleRun = 0;
  let jevMs = 0;
  let decisions = 0;
  let apps = opts.apps;
  const failedApps = new Set<string>();
  // Controls whose tap just errored or changed nothing are withheld from the
  // next request, so Jev must pick differently (seen live: an element the
  // device reported off-screen re-picked three times).
  const avoid = new Map<string, number>();
  let lastEl: UiElement | undefined;
  let lastKey: string | undefined;
  let repeatRun = 0;
  let waitRun = 0;

  const finish = (status: AgentResult['status'], reason: string): AgentResult => ({
    status,
    reason,
    steps: history,
    decisions,
    jevMs,
    elapsedMs: Date.now() - start,
  });

  while (decisions < maxSteps) {
    if (opts.signal?.aborted) return finish('stopped', 'aborted');
    if (!apps) apps = await discoverApps(core);
    let s: Screen;
    try {
      for (const [k, until] of avoid) if (decisions >= until) avoid.delete(k);
      s = await readScreen(
        core,
        apps.filter((a) => !failedApps.has(a.name)),
        new Set(avoid.keys()),
      );
    } catch (error) {
      return finish('stopped', `could not read the screen (${error instanceof Error ? error.message : String(error)})`);
    }
    if (opts.screenshotDir)
      await core.screenshot(`${opts.screenshotDir}/${String(decisions).padStart(3, '0')}.png`).catch(() => undefined);

    const { state, questions, ops } = buildRequest(goal, s, history, vetoed);
    const res = await jev.ask(state, questions, { signal: opts.signal });
    if (!res.ok) return finish('stopped', `Jev unavailable (${res.reason})`);
    decisions += 1;
    jevMs += res.ms;
    const d = resolve(res.answers, s);
    const label = d.element?.label ?? d.app;
    const event: AgentEvent = {
      step: decisions,
      elapsedMs: Date.now() - start,
      screen: {
        app: s.app,
        title: s.title,
        controls: s.controls.length,
        switches: s.switches.length,
        fields: s.fields.length,
      },
      offered: ops,
      decision: d,
      answers: res.answers,
      jevMs: res.ms,
    };

    if (d.op === 'DONE') {
      if (d.goalDone >= doneThreshold) {
        yield { ...event, status: 'done', reason: `independent check ${d.goalDone.toFixed(2)}` };
        return finish(
          'done',
          `goal visibly satisfied on "${s.title || s.app || 'the current screen'}" (independent check ${d.goalDone.toFixed(2)})`,
        );
      }
      // An unverified DONE is the most common false success: veto it once.
      // If Jev insists and the check is not clearly against it, accept — a
      // saved Wikipedia article shows only as a changed button label, and
      // the check sat at 0.3 while the run was in fact done.
      if (doneVetoed) {
        if (d.goalDone >= 0.2) {
          yield { ...event, status: 'done', reason: `Jev insisted; independent check ${d.goalDone.toFixed(2)}` };
          return finish(
            'done',
            `DONE proposed twice, independent check ${d.goalDone.toFixed(2)} (not clearly against)`,
          );
        }
        yield { ...event, status: 'blocked', reason: 'DONE proposed twice, check clearly against' };
        return finish('blocked', `DONE proposed but not visibly confirmed (P(done)=${d.goalDone.toFixed(2)})`);
      }
      doneVetoed = true;
      vetoed.add('DONE');
      // Do not let the retry undo the last action: Jev's next pick after a
      // veto was the same button that had just saved an article, which
      // unsaved it. Withhold that control for a step.
      if (lastEl) {
        avoid.set(elementKey(lastEl), decisions + 2);
        avoid.set(positionKey(lastEl), decisions + 2);
      }
      history.push({ op: 'DONE', outcome: `vetoed — independent check P(done)=${d.goalDone.toFixed(2)}` });
      yield event;
      continue;
    }
    vetoed.clear();
    // Three WAITs in a row and the screen is not loading, whatever Jev thinks:
    // withhold WAIT for the next decision so it must choose something else
    // (Maps live: eleven WAITs on a route that would never load).
    waitRun = d.op === 'WAIT' ? waitRun + 1 : 0;
    if (waitRun >= 3) {
      vetoed.add('WAIT');
      waitRun = 0;
    }
    if (d.op === 'BLOCKED') {
      yield { ...event, status: 'blocked', reason: 'no offered operation makes progress' };
      return finish('blocked', 'Jev found no offered operation that makes progress');
    }
    if (d.confidence < minConfidence) {
      yield { ...event, status: 'stopped', reason: `low confidence ${d.confidence.toFixed(2)}` };
      return finish(
        'stopped',
        `low confidence (${d.confidence.toFixed(2)}) choosing ${d.op}${label ? ` "${label}"` : ''}`,
      );
    }

    // Jev judged a screen read a moment ago. Re-find the element on a fresh
    // observation and act only on the same one (role, label, value).
    let el: UiElement | undefined = d.element;
    if (el) {
      const fresh = await refind(core, el, d.op === 'TYPE').catch(() => null);
      if (!fresh || core.currentApp() !== s.app) {
        staleRun += 1;
        history.push({
          op: d.op,
          target: el.label,
          outcome: 'stale — the element changed before acting; decided again',
        });
        yield event;
        if (staleRun >= 3) return finish('stopped', 'the screen kept changing between deciding and acting');
        continue;
      }
      el = fresh;
    }
    staleRun = 0;

    if (el && d.op === 'TAP' && destructive.test(el.label) && !opts.allowDestructive) {
      yield { ...event, status: 'blocked', reason: `refused destructive tap "${el.label}"` };
      return finish('blocked', `refused to tap "${el.label}" — pass allowDestructive to permit destructive actions`);
    }

    let text: string | undefined;
    let textMs: number | undefined;
    if (d.op === 'TYPE' && el) {
      if (!writeText)
        return finish('stopped', 'typing needs a text helper (set TEXT_MODEL_API_KEY or AI_GATEWAY_API_KEY)');
      try {
        const t = Date.now();
        const value = await writeText(
          {
            goal,
            field: { label: el.label, role: el.role, ...(el.value !== undefined ? { value: el.value } : {}) },
            screen: { app: s.app ?? 'unknown', title: s.title, visible_text: s.visibleText },
            recent_actions: history.slice(-8).map((h) => ({
              operation: h.op,
              ...(h.target ? { target: h.target } : {}),
              ...(h.text ? { text: h.text } : {}),
            })),
          },
          opts.signal,
        );
        textMs = Date.now() - t;
        if (value === null) return finish('blocked', `the goal does not say what to type into "${el.label}"`);
        text = value;
      } catch (error) {
        return finish('stopped', `the text helper failed (${error instanceof Error ? error.message : String(error)})`);
      }
    }

    // Each verb reports its own outcome from the ONE tree read it already
    // does afterwards (press/fill self-diff; the others observe once). No
    // extra capture here: a tree read is ~1 s on iOS, ~3 s on Android.
    let outcome: string;
    try {
      const bundle = d.app ? (apps.find((a) => a.name === d.app)?.bundleId ?? d.app) : undefined;
      outcome = await execute(core, d.op, el, bundle, text, s.app);
    } catch (error) {
      outcome = `error: ${firstLine(error instanceof Error ? error.message : String(error))}`;
    }
    const step: Step = { op: d.op, ...(label ? { target: label } : {}), ...(text ? { text } : {}), outcome };
    history.push(step);
    if (el && (d.op === 'TAP' || d.op === 'TOGGLE')) lastEl = el;
    yield { ...event, action: step, textMs };

    // No harness underneath to refuse a repeat: the same action failing or
    // changing nothing twice in a row ends the run instead of burning the budget.
    const failed = outcome.startsWith('error') || outcome.endsWith('no visible change');
    if (d.op === 'OPEN_APP' && d.app && outcome.startsWith('error')) failedApps.add(d.app);
    if (d.op === 'TAP' && el && failed) avoid.set(elementKey(el), decisions + 2);
    const key = `${d.op}|${label ?? ''}|${text ?? ''}`;
    repeatRun = failed && d.op !== 'WAIT' ? (key === lastKey ? repeatRun + 1 : 1) : 0;
    lastKey = key;
    if (repeatRun >= 2) return finish('blocked', `${d.op}${label ? ` "${label}"` : ''} had no effect twice in a row`);
  }
  return finish('budget', `step budget of ${maxSteps} reached before the goal was visibly done`);
}

/** The pick becomes a device verb. Switches are pressed at the knob (right edge), not the row's centre. */
async function execute(
  core: Phone,
  op: Op,
  el: UiElement | undefined,
  app: string | undefined,
  text: string | undefined,
  currentApp: string | undefined,
): Promise<string> {
  const target = () => {
    if (!el) throw new Error(`${op} needs a target element`);
    return el;
  };
  switch (op) {
    case 'TAP': {
      const e = target();
      const ev = await core.press(e.ref);
      return `tapped "${e.label}"${changed(ev.changed)}`;
    }
    case 'TOGGLE': {
      const e = target();
      const before = e.value ?? '';
      if (e.rect)
        await core.pressAt(Math.round(e.rect.x + e.rect.width - 24), Math.round(e.rect.y + e.rect.height / 2));
      else await core.press(e.ref);
      await core.observe();
      const after = core.interactiveElements().find((x) => x.role === e.role && x.label === e.label)?.value ?? '?';
      return `toggled "${e.label}" ${before} → ${after}`;
    }
    case 'TYPE': {
      const e = target();
      const ev = await core.fill(e.ref, text ?? '');
      return `typed ${JSON.stringify(text)} into "${e.label}"${changed(ev.changed)}`;
    }
    case 'SCROLL_DOWN':
    case 'SCROLL_UP': {
      const before = core.screenSignature();
      await core.scroll(op === 'SCROLL_DOWN' ? 'down' : 'up');
      await core.observe();
      return `${op === 'SCROLL_DOWN' ? 'scrolled down' : 'scrolled up'}${changed(core.screenSignature() !== before)}`;
    }
    case 'BACK': {
      const before = core.screenSignature();
      await core.goBack();
      await core.observe();
      return `went back${changed(core.screenSignature() !== before)}`;
    }
    case 'OPEN_APP': {
      if (!app) throw new Error('OPEN_APP needs an app');
      await core.openApp(app, false);
      await settleAfterLaunch(core, currentApp);
      return `opened ${app}${changed(core.currentApp() !== currentApp)}`;
    }
    default:
      await sleep(1000);
      return 'waited 1s';
  }
}

/** Convenience: run to completion, returning the result. */
export async function runGoal(
  core: Phone,
  goal: string,
  opts: AgentOptions & { onEvent?: (e: AgentEvent) => void } = {},
): Promise<AgentResult> {
  const it = run(core, goal, opts);
  for (;;) {
    const n = await it.next();
    if (n.done) return n.value;
    opts.onEvent?.(n.value);
  }
}
