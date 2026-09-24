// What OPEN_APP may target. On iOS the SDK lists installed third-party apps
// as "Name (bundle.id)" and first-party Apple apps not at all, so the common
// ones are listed here. On Android it returns every package on the device
// (200+, mostly system), so only the curated list below is offered, filtered
// to what is installed. Jev sees names; the executor opens ids. Test runners
// never count as apps.
import type { Phone } from './screen.ts';

export type App = { name: string; bundleId: string };

export const BUILTIN_APPS: App[] = [
  { name: 'Settings', bundleId: 'com.apple.Preferences' },
  { name: 'Contacts', bundleId: 'com.apple.MobileAddressBook' },
  { name: 'Messages', bundleId: 'com.apple.MobileSMS' },
  { name: 'Calendar', bundleId: 'com.apple.mobilecal' },
  { name: 'Reminders', bundleId: 'com.apple.reminders' },
  { name: 'Safari', bundleId: 'com.apple.mobilesafari' },
  { name: 'Photos', bundleId: 'com.apple.mobileslideshow' },
  { name: 'Maps', bundleId: 'com.apple.Maps' },
  { name: 'Files', bundleId: 'com.apple.DocumentsApp' },
  { name: 'Health', bundleId: 'com.apple.Health' },
  { name: 'News', bundleId: 'com.apple.news' },
  { name: 'Shortcuts', bundleId: 'com.apple.shortcuts' },
  { name: 'Wallet', bundleId: 'com.apple.Passbook' },
  { name: 'Passwords', bundleId: 'com.apple.Passwords' },
];

/** Common Android apps; a name may map to several packages (AOSP vs Google). */
export const ANDROID_APPS: Array<{ name: string; packages: string[] }> = [
  { name: 'Settings', packages: ['com.android.settings'] },
  { name: 'Contacts', packages: ['com.google.android.contacts', 'com.android.contacts'] },
  { name: 'Phone', packages: ['com.google.android.dialer', 'com.android.dialer'] },
  { name: 'Messages', packages: ['com.google.android.apps.messaging', 'com.android.messaging'] },
  { name: 'Chrome', packages: ['com.android.chrome'] },
  { name: 'Gmail', packages: ['com.google.android.gm'] },
  { name: 'Calendar', packages: ['com.google.android.calendar'] },
  { name: 'Clock', packages: ['com.google.android.deskclock', 'com.android.deskclock'] },
  { name: 'Photos', packages: ['com.google.android.apps.photos'] },
  { name: 'Camera', packages: ['com.google.android.GoogleCamera', 'com.android.camera2'] },
  { name: 'Files', packages: ['com.google.android.documentsui', 'com.android.documentsui'] },
  { name: 'Maps', packages: ['com.google.android.apps.maps'] },
  { name: 'YouTube', packages: ['com.google.android.youtube'] },
  { name: 'Calculator', packages: ['com.google.android.calculator', 'com.android.calculator2'] },
  { name: 'Play Store', packages: ['com.android.vending'] },
];

const RUNNER = /-Runner \(|xctrunner\)/;

/** A raw `pm list packages` dump: bare dotted ids, no "Name (id)" entries. */
export function looksLikeAndroid(listing: string[]): boolean {
  // `pm list packages` includes bare names like "android"; iOS entries carry "(bundle)".
  return listing.some((e) => e.startsWith('com.android.')) && !listing.some((e) => e.includes('('));
}

/** Parse the SDK's "Name (bundle.id)" entries; a bare bundle id names itself. */
export function parseApps(listing: string[]): App[] {
  const out: App[] = [];
  for (const entry of listing) {
    if (RUNNER.test(entry)) continue;
    const m = entry.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    out.push(m ? { name: m[1]!.trim(), bundleId: m[2]!.trim() } : { name: entry, bundleId: entry });
  }
  return out;
}

/** Installed third-party apps plus the built-in ones, deduplicated by bundle id. */
export async function discoverApps(core: Phone): Promise<App[]> {
  const listing = await core.listApps().catch(() => []);
  if (core.platform === 'unknown') core.platform = looksLikeAndroid(listing) ? 'android' : 'ios';
  if (core.platform === 'android') {
    const have = new Set(listing);
    return ANDROID_APPS.flatMap((a) => {
      const pkg = a.packages.find((p) => have.has(p));
      return pkg ? [{ name: a.name, bundleId: pkg }] : [];
    });
  }
  const installed = parseApps(listing);
  const seen = new Set(installed.map((a) => a.bundleId));
  return [...installed, ...BUILTIN_APPS.filter((a) => !seen.has(a.bundleId))];
}
