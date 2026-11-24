import { encodeInto, type InputPacket } from '../../shared/src/codec/input-packet.ts';
import { quantizeAxis } from '../../shared/src/controller/quantize.ts';
import { HEARTBEAT_MS, encodeHeartbeat } from '../../shared/src/stretch1/heartbeat.ts';
import { nextDelayMs } from '../../shared/src/stretch1/tdma.ts';
import { sendIntervalMs } from '../../shared/src/stretch1/tier.ts';
import { routeFastInput, type FastInputRoute } from '../../shared/src/transport/policy.ts';

const scratch = new ArrayBuffer(8);
const view = new DataView(scratch);
const heartbeat = new Uint8Array(4);
const packet: InputPacket = {
  seq: 0,
  phoneTs: 0,
  touchLag: 0,
  buttons: 0,
  axisX: 0,
  axisY: 0,
};

type RouteReader = () => FastInputRoute;
type Sender = (buffer: ArrayBuffer) => boolean;

let seq = 0;
let axisX = 0;
let axisY = 0;
let buttons = 0;
let buttonDown = false;
let dashEdge = false;
let touchLag = 0;
let lastSend = 0;
let lastInputAtMs = Number.NEGATIVE_INFINITY;
let pending = 0;
let joined = false;
let haveSent = false;
let clockSlot = 0;
let offsetMs = 0;
let tier: '60' | '30' = '60';
let readRoute: RouteReader = () => 'wait';
let sendDc: Sender = () => false;
let sendWs: Sender = () => false;

export function bindTransport(next: {
  readRoute: RouteReader;
  sendDc: Sender;
  sendWs: Sender;
}): void {
  readRoute = next.readRoute;
  sendDc = next.sendDc;
  sendWs = next.sendWs;
}

export function setSeq(next: number): void {
  seq = next & 0xffff;
}

export function markJoined(): void {
  joined = true;
}

export function setSendClock(next: { slot: number; offsetMs: number; tier: '60' | '30' }): void {
  clockSlot = next.slot;
  offsetMs = next.offsetMs;
  tier = next.tier;
}

export function readSendClock(): { slot: number; offsetMs: number; tier: '60' | '30' } {
  return { slot: clockSlot, offsetMs, tier };
}

export function lastInputAt(): number {
  return lastInputAtMs;
}

export function lastSentSeq(): number {
  if (!haveSent) return -1;
  return (seq - 1) & 0xffff;
}

export function sendAxes(x: number, y: number, timeStamp: number): void {
  axisX = quantizeAxis(x);
  axisY = quantizeAxis(y);
  touchLag = lagSteps(timeStamp);
  if (!joined) return;
  scheduleInput();
}

export function sendButton(down: boolean, timeStamp: number): void {
  buttonDown = down;
  touchLag = lagSteps(timeStamp);
  if (down) {
    buttons |= 1;
    dashEdge = true;
  } else if (!dashEdge) {
    buttons &= ~1;
  }
  if (!joined) {
    if (!down) {
      buttons &= ~1;
      dashEdge = false;
    }
    return;
  }
  scheduleInput();
}

export function flushHeartbeat(now: number): boolean {
  if (!joined || now - lastInputAtMs < HEARTBEAT_MS) return false;
  const route = readRoute();
  if (route !== 'dc' && route !== 'ws') return false;
  encodeHeartbeat(heartbeat, clockSlot, Math.floor(now) & 0xffff);
  const queued = route === 'dc' ? sendDc(heartbeat.buffer) : sendWs(heartbeat.buffer);
  return queued;
}

function scheduleInput(): void {
  const now = performance.now();
  const since = Number.isFinite(lastInputAtMs) ? now - lastSend : sendIntervalMs(tier);
  const delay = nextDelayMs(now + offsetMs, clockSlot, since, sendIntervalMs(tier));
  if (delay > 0) {
    arm(delay);
    return;
  }
  cancelPending();
  const result = flushSend();
  if (result === 'wait' || result === 'drop') arm(sendIntervalMs(tier));
}

function flushSend(): 'sent' | 'wait' | 'drop' | 'closed' {
  if (!joined) return 'closed';
  const route = readRoute();
  if (route === 'drop' || route === 'wait') return route;
  const now = performance.now();
  packet.seq = seq;
  packet.phoneTs = Math.floor(now) % 65536;
  packet.touchLag = touchLag;
  packet.buttons = buttons;
  packet.axisX = axisX;
  packet.axisY = axisY;
  encodeInto(packet, view);
  const queued = route === 'dc' ? sendDc(scratch) : sendWs(scratch);
  if (!queued) return 'closed';
  if ((buttons & 1) !== 0) {
    dashEdge = false;
    if (!buttonDown) buttons &= ~1;
  }
  seq = (seq + 1) & 0xffff;
  lastSend = now;
  lastInputAtMs = now;
  haveSent = true;
  return 'sent';
}

function flushFromTimer(): void {
  pending = 0;
  const now = performance.now();
  const since = Number.isFinite(lastInputAtMs) ? now - lastSend : sendIntervalMs(tier);
  const delay = nextDelayMs(now + offsetMs, clockSlot, since, sendIntervalMs(tier));
  if (delay > 0) {
    arm(delay);
    return;
  }
  const result = flushSend();
  if (result === 'wait' || result === 'drop') arm(sendIntervalMs(tier));
}

function arm(delay: number): void {
  if (pending !== 0) return;
  pending = window.setTimeout(flushFromTimer, delay);
}

function cancelPending(): void {
  if (pending === 0) return;
  window.clearTimeout(pending);
  pending = 0;
}

function lagSteps(timeStamp: number): number {
  const steps = (performance.now() - timeStamp) * 2;
  if (steps <= 0) return 0;
  if (steps >= 255) return 255;
  return Math.round(steps);
}
