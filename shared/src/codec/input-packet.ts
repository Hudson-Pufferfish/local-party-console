export interface InputPacket {
  seq: number;
  phoneTs: number;
  touchLag: number;
  buttons: number;
  axisX: number;
  axisY: number;
}

const PACKET_BYTES = 8;

function assertPacketLength(view: DataView): void {
  if (view.byteLength !== PACKET_BYTES) {
    throw new RangeError('input packet must be 8 bytes');
  }
}

export function encodeInto(packet: InputPacket, view: DataView): void {
  assertPacketLength(view);
  view.setUint16(0, packet.seq, true);
  view.setUint16(2, packet.phoneTs, true);
  view.setUint8(4, packet.touchLag);
  view.setUint8(5, packet.buttons);
  view.setInt8(6, packet.axisX);
  view.setInt8(7, packet.axisY);
}

export function decode(view: DataView): InputPacket {
  assertPacketLength(view);
  return {
    seq: view.getUint16(0, true),
    phoneTs: view.getUint16(2, true),
    touchLag: view.getUint8(4),
    buttons: view.getUint8(5),
    axisX: view.getInt8(6),
    axisY: view.getInt8(7),
  };
}
