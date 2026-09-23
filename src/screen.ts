// One observation → an indexed action space. Jev answers with indices; the
// code owns the mapping back to real elements, so the model can never name a
// selector, a coordinate, or an element that was not offered.
import { DeviceCore, type SnapshotNode, type UiElement } from '@phone-use/sdk';
import type { App } from './apps.ts';

/** DeviceCore plus the raw node cache (labels of static text, not just controls). */
export class Phone extends DeviceCore {
  nodes(): SnapshotNode[] {
    return this.cachedNodes;
  }
}

export type Screen = {
  app: string | undefined;
  title: string;
  /** Distinct visible labels, in tree order, capped at ~3000 chars. */
  visibleText: string[];
  /** Tappable controls (buttons, rows, links, tabs) — switches excluded. */
  controls: UiElement[];
  /** Switches, with their current value ("1" on / "0" off). */
  switches: UiElement[];
  /** Editable text fields. */
  fields: UiElement[];
  /** Names of apps OPEN_APP may target (current app excluded). */
  apps: string[];
  /** Home screen / launcher — app icons and OPEN_APP are the same action there. */
  launcher: boolean;
};

const MAX_CONTROLS = 60;
const MAX_TEXT_CHARS = 3000;
const LAUNCHER = /springboard|launcher|home ?screen/i;

/** Enabled, unobstructed, and inside the viewport. */
export function onScreen(e: UiElement, vh: number): boolean {
  if (!e.rect) return false;
  const cy = e.rect.y + e.rect.height / 2;
  const cx = e.rect.x + e.rect.width / 2;
  return cy > 0 && cy < vh && cx > 0 && e.enabled !== false && !e.blocked;
}

/**
 * A readable name for the current screen. iOS NavigationBar labels are often
 * the BACK button's title ("General" while on About), so prefer the first
 * short static text near the top and fall back to the nav bar.
 */
function screenName(core: Phone): string {
  const heading = core
    .nodes()
    .filter(
      (e) =>
        (e.role ?? e.type) === 'StaticText' &&
        e.label &&
        e.label.length <= 40 &&
        !/^\d{1,2}:\d{2}/.test(e.label) && // status-bar clock
        e.rect &&
        e.rect.y >= 44 &&
        e.rect.y < 180,
    )
    .sort((a, b) => (a.rect?.y ?? 0) - (b.rect?.y ?? 0))[0];
  return heading?.label?.trim() || core.screenTitle();
}

/** Observe the device and build the action space for this step. */
/** role|label — how an element is remembered across observations. */
export const elementKey = (e: UiElement) => `${e.role}|${e.label}`;

export async function readScreen(core: Phone, apps: App[], avoid: ReadonlySet<string> = new Set()): Promise<Screen> {
  await core.observe();
  const vh = core.viewportHeight();
  const visible = core.interactiveElements().filter((e) => onScreen(e, vh));
  const app = core.currentApp();
  const launcher = LAUNCHER.test(app ?? '');
  const others = apps.filter((a) => a.bundleId !== app && a.name !== app).map((a) => a.name);
  const appNames = new Set(others.map((a) => a.toLowerCase()));
  const visibleText: string[] = [];
  let chars = 0;
  for (const e of core.nodes()) {
    const label = e.label?.trim();
    if (!label || !e.rect || e.rect.y + e.rect.height < 0 || e.rect.y > vh || visibleText.includes(label)) continue;
    chars += label.length;
    if (chars > MAX_TEXT_CHARS) break;
    visibleText.push(label);
  }
  return {
    app,
    title: screenName(core),
    visibleText,
    // On a launcher, drop app icons from TAP so OPEN_APP is the one way to
    // launch: offering both split the probability between two right answers.
    controls: visible
      .filter(
        (e) => e.role !== 'Switch' && !(launcher && appNames.has(e.label.toLowerCase())) && !avoid.has(elementKey(e)),
      )
      .slice(0, MAX_CONTROLS),
    switches: visible.filter((e) => e.role === 'Switch').slice(0, MAX_CONTROLS),
    fields: core
      .inputFields(true)
      .filter((e) => onScreen(e, vh))
      .slice(0, MAX_CONTROLS),
    apps: others,
    launcher,
  };
}

/**
 * Re-observe and find the same element by meaning (role, label, value); the
 * nearest candidate to its old position wins. Null when it is gone — the
 * caller decides again rather than tapping whatever moved under it.
 */
export async function refind(core: Phone, target: UiElement, field: boolean): Promise<UiElement | null> {
  await core.observe();
  const vh = core.viewportHeight();
  const pool = (field ? core.inputFields(true) : core.interactiveElements()).filter((e) => onScreen(e, vh));
  const centre = (e: UiElement) => (e.rect ? [e.rect.x + e.rect.width / 2, e.rect.y + e.rect.height / 2] : [0, 0]);
  const [ox, oy] = centre(target) as [number, number];
  const dist = (e: UiElement) => {
    const [x, y] = centre(e) as [number, number];
    return Math.hypot(x - ox, y - oy);
  };
  return (
    pool
      .filter((e) => e.role === target.role && e.label === target.label && (e.value ?? '') === (target.value ?? ''))
      .sort((a, b) => dist(a) - dist(b))[0] ?? null
  );
}
