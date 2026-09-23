// Where the phone is. Scripts never branch on locality: the same DeviceCore
// drives a booted local simulator, a fresh one, or a phone-use cloud phone.
import { createCloudSandboxBackend, type Device, type DeviceBackend, ios } from '@phone-use/sdk';
import { Phone } from './screen.ts';

const READ_ONLY = new Set(['snapshot', 'screenshot', 'listApps']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Two cloud failure modes seen live (2026-09-23): the worker restarts its iOS
 * runner after a command exceeds its watchdog and the daemon session dies with
 * it (every verb then fails with SESSION_NOT_FOUND until an open recreates it),
 * and read-only calls time out under load. Recover: re-open the last app and
 * retry once; retry a read-only call once. Mutations are never retried — a
 * timed-out press may already have landed.
 */
export function resilient<T extends DeviceBackend>(backend: T): T {
  let lastApp: string | undefined;
  return new Proxy(backend, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string' || prop === 'rpc') return value;
      return async function (this: unknown, ...args: unknown[]) {
        if (prop === 'openApp') lastApp = (args[0] as { app?: string } | undefined)?.app ?? lastApp;
        for (let attempt = 0; ; attempt++) {
          try {
            return await value.apply(target, args);
          } catch (e) {
            const err = e as { code?: string; retryable?: boolean };
            if (attempt >= 1 || prop === 'openApp' || prop === 'closeSession') throw e;
            if (err.code === 'SESSION_NOT_FOUND') {
              await (target as DeviceBackend)
                .openApp({ app: lastApp ?? 'com.apple.springboard' })
                .catch(() => undefined);
              await sleep(1500);
              continue;
            }
            if (err.retryable && READ_ONLY.has(prop)) {
              await sleep(3000);
              continue;
            }
            throw e;
          }
        }
      };
    },
  });
}

export type DeviceSpec = 'cloud' | 'connect' | 'launch' | (string & {});

export type Connected = { core: Phone; name: string; close: () => Promise<void> };

/**
 * - `cloud`   — a phone-use cloud phone: PHONE_USE_SANDBOX_URL + PHONE_USE_SANDBOX_TOKEN
 *               (printed by `phone-use env <id>` after `phone-use create ios`)
 * - `connect` — the booted iOS Simulator on this Mac (default)
 * - `launch`  — boot a dedicated simulator, deleted on close
 * - `<udid>`  — a specific simulator
 */
export async function connectDevice(spec: DeviceSpec = process.env.JEV_PHONE_DEVICE ?? 'connect'): Promise<Connected> {
  if (spec === 'cloud') {
    const backend = resilient(createCloudSandboxBackend());
    const core = new Phone(backend);
    return { core, name: 'cloud phone', close: () => core.closeSession().catch(() => undefined) };
  }
  const device: Device =
    spec === 'launch'
      ? await ios.launch({ idleTimeoutMs: false })
      : await ios.connect(spec === 'connect' ? undefined : spec, { idleTimeoutMs: false });
  const core = new Phone(device.backend);
  return { core, name: device.name ?? device.id, close: () => device.close() };
}
