import { decode } from '../../shared/src/codec/input-packet.ts';
import type { SumoSimulation } from '../../games/sumo-dash/src/simulation.ts';

const FRAME_BYTES = 9;
const PACKET_BYTES = 8;

export function applyHostFrame(simulation: SumoSimulation, frame: Uint8Array): void {
  if (frame.byteLength !== FRAME_BYTES) return;
  const packet = decode(new DataView(frame.buffer, frame.byteOffset + 1, PACKET_BYTES));
  simulation.applyInput(frame[0], packet.buttons, packet.axisX, packet.axisY);
}
