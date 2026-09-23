// What OPEN_APP may target. The SDK lists installed third-party apps as
// "Name (bundle.id)"; first-party Apple apps are not enumerated on the
// simulator, so the common ones are listed here. Jev sees names; the
// executor opens bundle ids. Test runners never count as apps.
import type { DeviceCore } from '@phone-use/sdk';

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

const RUNNER = /-Runner \(|xctrunner\)/;

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
export async function discoverApps(core: DeviceCore): Promise<App[]> {
  const installed = parseApps(await core.listApps().catch(() => []));
  const seen = new Set(installed.map((a) => a.bundleId));
  return [...installed, ...BUILTIN_APPS.filter((a) => !seen.has(a.bundleId))];
}
