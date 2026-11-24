import { encodeInto, type InputPacket } from '../../shared/src/codec/input-packet.ts';
import { quantizeAxis } from '../../shared/src/controller/quantize.ts';
import { routeFastInput, type FastInputRoute } from '../../shared/src/transport/policy.ts';

const scratch = new ArrayBuffer(8);
const view = new DataView(scratch);
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
let pending = 0;
let joined = false;
let haveSent = false;
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

export function lastSentSeq(): number {
  if (!haveSent) return -1;
  return (seq - 1) & 0xffff;
}

export function sendAxes(x: number, y: number, timeStamp: number): void {
  axisX = quantizeAxis(x);
  axisY = quantizeAxis(y);
  touchLag = lagSteps(timeStamp);
  if (!joined) return;
  const now = performance.now();
  if (now - lastSend < 16.6) {
    arm(16.6 - (now - lastSend));
    return;
  }
  cancelPending();
  const result = flushSend();
  if (result === 'wait' || result === 'drop') arm(16.6);
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
  cancelPending();
  const result = flushSend();
  if (result === 'wait' || result === 'drop') arm(16.6);
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
  haveSent = true;
  return 'sent';
}

function flushFromTimer(): void {
  pending = 0;
  const result = flushSend();
  if (result === 'wait' || result === 'drop') arm(16.6);
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
