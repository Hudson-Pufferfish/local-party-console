import { nextJitter, oneWayMs, percentile } from '../../../shared/src/stretch1/metrics.ts';

const SLOTS = 8;
const RING = 300;

export interface TelemetryRead {
  hz: number;
  tier: '60' | '30';
  lowPower: boolean;
  cores: number;
  touchMs: number;
  netP50: number | null;
  netP99: number | null;
  jitter: number;
  lossPct: number;
  longTasks: number;
  transport: 'idle' | 'dc' | 'ws';
  hasOffset: boolean;
}

interface SlotRing {
  net: Float64Array;
  times: Float64Array;
  netCount: number;
  netWrite: number;
  timeCount: number;
  timeWrite: number;
  lastSeq: number;
  haveSeq: boolean;
  gaps: number;
  received: number;
  jitter: number;
  haveTransit: boolean;
  lastTransit: number;
  offset: number;
  hasOffset: boolean;
  tier: '60' | '30';
  lowPower: boolean;
  cores: number;
  longTasks: number;
  transport: 'idle' | 'dc' | 'ws';
  touchMs: number;
}

export interface Ingest {
  onInput(slot: number, seq: number, phoneTs: number, touchLag: number, hostNow: number): void;
  onHeartbeat(slot: number, hostNow: number): void;
  onOffset(slot: number, theta: number): void;
  onTier(slot: number, tier: '60' | '30', lowPower: boolean, cores: number): void;
  onLongTask(slot: number, n: number): void;
  setTransport(slot: number, mode: 'idle' | 'dc' | 'ws'): void;
  read(slot: number): TelemetryRead;
}

export function createIngest(): Ingest {
  const slots: SlotRing[] = [];
  for (let index = 0; index < SLOTS; index += 1) slots.push(createSlot());

  function onInput(slot: number, seq: number, phoneTs: number, touchLag: number, hostNow: number): void {
    const row = slots[slot];
    if (row === undefined) return;
    if (!row.haveSeq) {
      row.haveSeq = true;
      row.lastSeq = seq & 0xffff;
      row.received = 1;
    } else {
      const delta = (seq - row.lastSeq) & 0xffff;
      if (delta >= 1 && delta <= 32767) {
        if (delta > 1) row.gaps += delta - 1;
        row.received += 1;
        row.lastSeq = seq & 0xffff;
      }
    }
    row.times[row.timeWrite] = hostNow;
    row.timeWrite = (row.timeWrite + 1) % RING;
    if (row.timeCount < RING) row.timeCount += 1;
    row.touchMs = touchLag * 0.5;
    if (!row.hasOffset) return;
    const transit = oneWayMs(hostNow, phoneTs, row.offset);
    if (row.haveTransit) row.jitter = nextJitter(row.jitter, transit - row.lastTransit);
    row.lastTransit = transit;
    row.haveTransit = true;
    row.net[row.netWrite] = transit;
    row.netWrite = (row.netWrite + 1) % RING;
    if (row.netCount < RING) row.netCount += 1;
  }

  function onHeartbeat(slot: number, _hostNow: number): void {
    if (slots[slot] === undefined) return;
  }

  function onOffset(slot: number, theta: number): void {
    const row = slots[slot];
    if (row === undefined || !Number.isFinite(theta)) return;
    row.offset = theta;
    row.hasOffset = true;
  }

  function onTier(slot: number, tier: '60' | '30', lowPower: boolean, cores: number): void {
    const row = slots[slot];
    if (row === undefined) return;
    if (tier !== '60' && tier !== '30') return;
    row.tier = tier;
    row.lowPower = lowPower;
    row.cores = cores;
  }

  function onLongTask(slot: number, n: number): void {
    const row = slots[slot];
    if (row === undefined || !Number.isFinite(n) || n <= 0) return;
    row.longTasks += n;
  }

  function setTransport(slot: number, mode: 'idle' | 'dc' | 'ws'): void {
    const row = slots[slot];
    if (row === undefined) return;
    row.transport = mode;
  }

  function read(slot: number): TelemetryRead {
    const row = slots[slot];
    if (row === undefined) return emptyRead();
    let netP50: number | null = null;
    let netP99: number | null = null;
    if (row.hasOffset && row.netCount > 0) {
      const sorted = new Float64Array(row.netCount);
      for (let index = 0; index < row.netCount; index += 1) {
        const at = row.netCount < RING ? index : (row.netWrite + index) % RING;
        sorted[index] = row.net[at] ?? 0;
      }
      sorted.sort();
      netP50 = percentile(sorted, row.netCount, 50);
      netP99 = percentile(sorted, row.netCount, 99);
    }
    let hz = 0;
    if (row.timeCount > 0) {
      const latest = row.times[(row.timeWrite + RING - 1) % RING] ?? 0;
      for (let index = 0; index < row.timeCount; index += 1) {
        const at = row.timeCount < RING ? index : (row.timeWrite + index) % RING;
        const stamp = row.times[at] ?? 0;
        if (latest - stamp <= 1000) hz += 1;
      }
    }
    const total = row.gaps + row.received;
    const lossPct = total === 0 ? 0 : (100 * row.gaps) / total;
    return {
      hz,
      tier: row.tier,
      lowPower: row.lowPower,
      cores: row.cores,
      touchMs: row.touchMs,
      netP50,
      netP99,
      jitter: row.jitter,
      lossPct,
      longTasks: row.longTasks,
      transport: row.transport,
      hasOffset: row.hasOffset,
    };
  }

  return { onInput, onHeartbeat, onOffset, onTier, onLongTask, setTransport, read };
}

function createSlot(): SlotRing {
  return {
    net: new Float64Array(RING),
    times: new Float64Array(RING),
    netCount: 0,
    netWrite: 0,
    timeCount: 0,
    timeWrite: 0,
    lastSeq: 0,
    haveSeq: false,
    gaps: 0,
    received: 0,
    jitter: 0,
    haveTransit: false,
    lastTransit: 0,
    offset: 0,
    hasOffset: false,
    tier: '60',
    lowPower: false,
    cores: 0,
    longTasks: 0,
    transport: 'idle',
    touchMs: 0,
  };
}

function emptyRead(): TelemetryRead {
  return {
    hz: 0,
    tier: '60',
    lowPower: false,
    cores: 0,
    touchMs: 0,
    netP50: null,
    netP99: null,
    jitter: 0,
    lossPct: 0,
    longTasks: 0,
    transport: 'idle',
    hasOffset: false,
  };
}
