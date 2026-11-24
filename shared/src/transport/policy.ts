export type FastInputRoute = 'drop' | 'dc' | 'wait' | 'ws';

export interface FastInputRouteInput {
  channelOpen: boolean;
  channelAgeMs: number;
  bufferedAmount: number;
}

const OPEN_BUFFER_LIMIT = 64;
const CLOSED_CHANNEL_WAIT_MS = 3000;

export function routeFastInput(input: FastInputRouteInput): FastInputRoute {
  if (input.channelOpen) {
    if (input.bufferedAmount > OPEN_BUFFER_LIMIT) {
      return 'drop';
    }
    return 'dc';
  }
  if (input.channelAgeMs >= CLOSED_CHANNEL_WAIT_MS) {
    return 'ws';
  }
  return 'wait';
}

export function inputDeliveries(route: FastInputRoute): { dc: boolean; ws: boolean } {
  if (route === 'dc') return { dc: true, ws: true };
  if (route === 'ws' || route === 'drop' || route === 'wait') return { dc: false, ws: true };
  return { dc: false, ws: false };
}
