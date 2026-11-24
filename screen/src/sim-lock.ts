export interface LockManagerLike {
  request<T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T>;
}

export interface TabLockHandle {
  readonly settled: Promise<void>;
  readonly done: Promise<void>;
  release(): void;
}

interface ActiveEntry {
  release(): void;
  done: Promise<void>;
}

const REGISTRY_KEY = Symbol.for('lpc.tabLocks');

function registry(): Map<string, ActiveEntry> {
  const host = globalThis as Record<symbol, Map<string, ActiveEntry> | undefined>;
  let map = host[REGISTRY_KEY];
  if (map === undefined) {
    map = new Map<string, ActiveEntry>();
    host[REGISTRY_KEY] = map;
  }
  return map;
}

export function resetTabLocksForTest(): void {
  const map = registry();
  for (const entry of map.values()) entry.release();
  map.clear();
}

export function createTabLock(options: {
  name: string;
  ifAvailable?: boolean;
  locks?: LockManagerLike;
  onResult?: (acquired: boolean) => void;
}): TabLockHandle {
  const locks = options.locks ?? navigator.locks;
  const map = registry();
  const previous = map.get(options.name);
  let released = false;
  let resolveHold: (() => void) | undefined;
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  const onPageHide = (): void => {
    release();
  };

  function release(): void {
    if (released) return;
    released = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide);
    }
    resolveHold?.();
    resolveHold = undefined;
  }

  const done = (async (): Promise<void> => {
    if (previous !== undefined) {
      previous.release();
      await previous.done.catch(() => undefined);
    }
    if (released) {
      resolveSettled();
      return;
    }
    const requestOptions: LockOptions = options.ifAvailable === true
      ? { mode: 'exclusive', ifAvailable: true }
      : { mode: 'exclusive' };
    await locks.request(options.name, requestOptions, (lock) => {
      if (lock === null || released) {
        if (!released) options.onResult?.(false);
        resolveSettled();
        return;
      }
      options.onResult?.(true);
      resolveSettled();
      return new Promise<void>((resolve) => {
        resolveHold = resolve;
        if (released) {
          resolve();
          return;
        }
        if (typeof window !== 'undefined') {
          window.addEventListener('pagehide', onPageHide, { once: true });
        }
      });
    });
  })().finally(() => {
    if (map.get(options.name) === entry) {
      map.delete(options.name);
    }
  });

  const entry: ActiveEntry = { release, done };
  map.set(options.name, entry);

  return { settled, done, release };
}
