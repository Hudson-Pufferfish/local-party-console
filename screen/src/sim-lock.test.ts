import { expect, test } from 'vitest';
import { createTabLock, resetTabLocksForTest } from './sim-lock.ts';

function createFakeLockManager() {
  const held = new Set<string>();
  return {
    held,
    request<T>(
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => Promise<T> | T,
    ): Promise<T> {
      if (options.ifAvailable === true && held.has(name)) {
        return Promise.resolve(callback(null));
      }
      held.add(name);
      return Promise.resolve()
        .then(() => callback({ name, mode: options.mode ?? 'exclusive' }))
        .finally(() => {
          held.delete(name);
        });
    },
  };
}

test('releasing a tab sim lock lets an immediate same-tab remount re-acquire primary while blocking another tab', async () => {
  resetTabLocksForTest();
  const manager = createFakeLockManager();
  const lockName = 'party-sim-KMMB';

  let firstClaimed = false;
  const first = createTabLock({
    name: lockName,
    ifAvailable: true,
    locks: manager,
    onResult(acquired) {
      firstClaimed = acquired;
    },
  });
  await first.settled;
  expect(firstClaimed).toBe(true);
  expect(manager.held.has(lockName)).toBe(true);

  // Simulates Vite HMR cleanup + immediate synchronous remount in the same tab:
  first.release();
  let remountClaimed = false;
  const remount = createTabLock({
    name: lockName,
    ifAvailable: true,
    locks: manager,
    onResult(acquired) {
      remountClaimed = acquired;
    },
  });
  await remount.settled;
  expect(remountClaimed).toBe(true);
  expect(manager.held.has(lockName)).toBe(true);

  // A different tab (no shared in-tab registry entry) sees the lock held and stays secondary:
  let otherTabAcquired = true;
  await manager.request(lockName, { mode: 'exclusive', ifAvailable: true }, (lock) => {
    otherTabAcquired = lock !== null;
  });
  expect(otherTabAcquired).toBe(false);

  remount.release();
  await remount.done;
  expect(manager.held.has(lockName)).toBe(false);
});
