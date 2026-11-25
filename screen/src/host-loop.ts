import type { Envelope } from '../../shared/src/types/envelope.ts';

const SLOT_COUNT = 8;
const SNAPSHOT_FLOATS = 88;
export const SNAPSHOT_BYTES = SNAPSHOT_FLOATS * 4;
const STEP_MS = 1000 / 120;
const MAX_FRAME_MS = 100;
const MAX_SUBSTEPS = 4;
const SILENCE_MS = 100;
const HEADER_PHASE = 1;
const PHASE_MATCH_OVER = 3;

export interface ScreenSim {
  readonly state: Float32Array;
  readonly auxState?: Uint8Array;
  applyInput(playerIndex: number, buttons: number, axisX: number, axisY: number): void;
  step(dt: number): void;
  startMatch(slots: number[]): void;
  setConnectedMask?(mask: number): void;
}

export interface HostLoop {
  readonly epoch: number;
  readonly inMatch: boolean;
  readonly matchOver: boolean;
  readonly state: Float32Array;
  readonly snapshot: Float32Array;
  readonly auxSnapshot: Uint8Array | null;
  startMatch(slots: readonly number[]): void;
  release(): void;
  accept(slot: number, seq: number, buttons: number, axisX: number, axisY: number, now: number): boolean;
  clearSeq(slot: number): void;
  setConnectedMask(mask: number): void;
  tick(frameMs: number, now: number): number;
}

export function seqAccepted(last: number | null, seq: number): boolean {
  if (last === null) return true;
  const delta = (seq - last) & 0xffff;
  return delta >= 1 && delta <= 32767;
}

export function createHostLoop(
  sim: ScreenSim,
  eventsFromHeaderDiff: ((prev: Float32Array, next: Float32Array) => Envelope[]) | undefined,
  emit: (events: readonly Envelope[]) => void,
  fillBot?: (slot: number, sim: ScreenSim) => boolean,
): HostLoop {
  const lastSeq = new Int32Array(SLOT_COUNT);
  const lastButtons = new Uint8Array(SLOT_COUNT);
  const lastAxisX = new Int8Array(SLOT_COUNT);
  const lastAxisY = new Int8Array(SLOT_COUNT);
  const lastAt = new Float64Array(SLOT_COUNT);
  const joined = new Uint8Array(SLOT_COUNT);
  const latch = new Uint8Array(SLOT_COUNT);
  const saw = new Uint8Array(SLOT_COUNT);
  const maskHold = new Uint8Array(SLOT_COUNT);
  const prev = new Float32Array(SNAPSHOT_FLOATS);
  const next = new Float32Array(SNAPSHOT_FLOATS);
  const bytes = new ArrayBuffer(SNAPSHOT_BYTES);
  const snapshot = new Float32Array(bytes);
  const auxSize = sim.auxState?.byteLength ?? 0;
  const auxBytes = auxSize > 0 ? new ArrayBuffer(auxSize) : null;
  const auxSnapshot = auxBytes !== null ? new Uint8Array(auxBytes) : null;
  let epoch = 0;
  let inMatch = false;
  let accumulator = 0;
  lastSeq.fill(-1);

  function copySnapshot(): void {
    const state = sim.state;
    for (let index = 0; index < SNAPSHOT_FLOATS; index += 1) {
      snapshot[index] = state[index] ?? 0;
    }
    if (auxSnapshot !== null && sim.auxState !== undefined) {
      auxSnapshot.set(sim.auxState);
    }
  }

  function startMatch(slots: readonly number[]): void {
    lastSeq.fill(-1);
    lastButtons.fill(0);
    lastAxisX.fill(0);
    lastAxisY.fill(0);
    lastAt.fill(0);
    joined.fill(0);
    latch.fill(0);
    saw.fill(0);
    maskHold.fill(0);
    const list: number[] = [];
    for (const slot of slots) {
      if (slot !== (slot | 0) || slot < 0 || slot > 7 || joined[slot] === 1) continue;
      joined[slot] = 1;
      list.push(slot);
    }
    sim.startMatch(list);
    epoch += 1;
    inMatch = true;
    accumulator = 0;
    const state = sim.state;
    for (let index = 0; index < SNAPSHOT_FLOATS; index += 1) {
      prev[index] = state[index] ?? 0;
    }
    copySnapshot();
  }

  function release(): void {
    inMatch = false;
    accumulator = 0;
    epoch += 1;
  }

  function accept(
    slot: number,
    seq: number,
    buttons: number,
    axisX: number,
    axisY: number,
    now: number,
  ): boolean {
    if (slot !== (slot | 0) || slot < 0 || slot > 7) return false;
    const stored = lastSeq[slot] ?? -1;
    if (!seqAccepted(stored < 0 ? null : stored, seq)) return false;
    const prior = saw[slot] === 1 ? (lastButtons[slot] ?? 0) : 0;
    if ((buttons & 1) !== 0 && (prior & 1) === 0) latch[slot] = 1;
    if ((buttons & 1) === 0) maskHold[slot] = 0;
    lastButtons[slot] = buttons & 0xff;
    lastAxisX[slot] = axisX;
    lastAxisY[slot] = axisY;
    lastAt[slot] = now;
    lastSeq[slot] = seq;
    saw[slot] = 1;
    return true;
  }

  function clearSeq(slot: number): void {
    if (slot < 0 || slot > 7) return;
    lastSeq[slot] = -1;
  }

  function setConnectedMask(mask: number): void {
    sim.setConnectedMask?.(mask & 0xff);
  }

  function tick(frameMs: number, now: number): number {
    if (!inMatch) return 0;
    let frame = frameMs;
    if (frame > MAX_FRAME_MS) frame = MAX_FRAME_MS;
    if (frame < 0) frame = 0;
    accumulator += frame;
    let substeps = 0;
    while (accumulator >= STEP_MS && substeps < MAX_SUBSTEPS) {
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        if (joined[slot] === 0) continue;
        if (fillBot !== undefined && fillBot(slot, sim)) continue;
        const at = lastAt[slot] ?? 0;
        const silent = at === 0 || now - at >= SILENCE_MS;
        if (silent && latch[slot] === 1) {
          sim.applyInput(slot, (lastButtons[slot] ?? 0) | 1, lastAxisX[slot] ?? 0, lastAxisY[slot] ?? 0);
          latch[slot] = 0;
          maskHold[slot] = 0;
        } else if (silent) {
          sim.applyInput(slot, 0, 0, 0);
          if (((lastButtons[slot] ?? 0) & 1) !== 0) maskHold[slot] = 1;
        } else {
          let buttons = lastButtons[slot] ?? 0;
          if (maskHold[slot] === 1 && (buttons & 1) !== 0 && latch[slot] === 0) {
            buttons &= ~1;
          }
          if (latch[slot] === 1) {
            buttons |= 1;
            latch[slot] = 0;
            maskHold[slot] = 0;
          }
          sim.applyInput(slot, buttons, lastAxisX[slot] ?? 0, lastAxisY[slot] ?? 0);
        }
      }
      sim.step(1 / 120);
      accumulator -= STEP_MS;
      substeps += 1;
    }
    if (substeps === MAX_SUBSTEPS) accumulator = 0;
    if (substeps > 0) {
      copySnapshot();
      if (eventsFromHeaderDiff !== undefined) {
        for (let index = 0; index < SNAPSHOT_FLOATS; index += 1) next[index] = snapshot[index] ?? 0;
        const events = eventsFromHeaderDiff(prev, next);
        if (events.length > 0) emit(events);
        for (let index = 0; index < SNAPSHOT_FLOATS; index += 1) prev[index] = next[index] ?? 0;
      }
    }
    return substeps;
  }

  return {
    get epoch() {
      return epoch;
    },
    get inMatch() {
      return inMatch;
    },
    get matchOver() {
      return inMatch && sim.state[HEADER_PHASE] === PHASE_MATCH_OVER;
    },
    get state() {
      return sim.state;
    },
    snapshot,
    auxSnapshot,
    startMatch,
    release,
    accept,
    clearSeq,
    setConnectedMask,
    tick,
  };
}
