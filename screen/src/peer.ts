import { decode } from '../../shared/src/codec/input-packet.ts';
import { mungeLanSdp } from '../../shared/src/sdp/munge-lan.ts';

const SLOT_COUNT = 8;

const CHANNEL: RTCDataChannelInit = {
  ordered: false,
  maxRetransmits: 0,
  negotiated: true,
  id: 0,
};

export type TransportMode = 'idle' | 'dc' | 'ws';

export interface PeerHooks {
  onPacket: (slot: number, seq: number, buttons: number, axisX: number, axisY: number) => void;
  onSdp: (ok: boolean) => void;
  send: (message: { type: string; payload: unknown }) => void;
}

interface PeerRecord {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  offered: boolean;
}

export interface PeerMap {
  offer(slot: number, lanIp: string): Promise<void>;
  close(slot: number): void;
  handleText(type: string, payload: unknown): void;
  handleBinary(data: ArrayBuffer): void;
  mode(slot: number): TransportMode;
}

export function createPeerMap(hooks: PeerHooks): PeerMap {
  const peers: Array<PeerRecord | null> = [null, null, null, null, null, null, null, null];
  const modes: TransportMode[] = ['idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle'];

  function ingest(slot: number, view: DataView, mode: TransportMode): void {
    if (slot < 0 || slot >= SLOT_COUNT) return;
    const packet = decode(view);
    modes[slot] = mode;
    hooks.onPacket(slot, packet.seq, packet.buttons, packet.axisX, packet.axisY);
  }

  async function offer(slot: number, lanIp: string): Promise<void> {
    if (slot < 0 || slot >= SLOT_COUNT || peers[slot] !== null) return;
    const pc = new RTCPeerConnection({ iceServers: [] });
    const dc = pc.createDataChannel('input', CHANNEL);
    dc.binaryType = 'arraybuffer';
    const record: PeerRecord = { pc, dc, offered: false };
    peers[slot] = record;
    dc.onmessage = (event) => {
      const data = event.data;
      if (!(data instanceof ArrayBuffer) || data.byteLength !== 8) return;
      ingest(slot, new DataView(data), 'dc');
    };
    pc.onicecandidate = (event) => {
      if (event.candidate === null || event.candidate.candidate === '') return;
      const raw = event.candidate.candidate;
      const line = raw.startsWith('a=') ? raw : `a=${raw}`;
      const munged = mungeLanSdp(`${line}\r\n`, lanIp);
      if (!munged.ok) return;
      const candidate = munged.sdp.trim().replace(/^a=/, '');
      hooks.send({
        type: 'signal:ice',
        payload: {
          slot,
          candidate: {
            candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        },
      });
    };
    try {
      const created = await pc.createOffer();
      await pc.setLocalDescription(created);
      await waitForIce(pc);
      const current = pc.localDescription?.sdp ?? created.sdp ?? '';
      const munged = mungeLanSdp(current, lanIp);
      hooks.onSdp(munged.ok);
      if (munged.ok && munged.sdp !== current) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setLocalDescription({ type: 'offer', sdp: munged.sdp });
      }
      if (peers[slot] !== record) return;
      record.offered = true;
      hooks.send({
        type: 'signal:offer',
        payload: { toSlot: slot, sdp: munged.sdp },
      });
    } catch {
      hooks.onSdp(false);
      close(slot);
    }
  }

  function close(slot: number): void {
    const record = peers[slot];
    if (record === undefined || record === null) return;
    record.dc.close();
    record.pc.close();
    peers[slot] = null;
    modes[slot] = 'idle';
  }

  function handleText(type: string, payload: unknown): void {
    if (type === 'signal:offer') return;
    const slot = readSlot(payload);
    if (slot === null) return;
    const record = peers[slot];
    if (record === undefined || record === null || !record.offered) return;
    if (type === 'signal:answer') {
      const sdp = readSdp(payload);
      if (sdp === null) return;
      void record.pc.setRemoteDescription({ type: 'answer', sdp });
      return;
    }
    if (type === 'signal:ice') {
      const candidate = readCandidate(payload);
      if (candidate === null) return;
      void record.pc.addIceCandidate(candidate);
    }
  }

  function handleBinary(data: ArrayBuffer): void {
    if (data.byteLength !== 9) return;
    const slot = new DataView(data).getUint8(0);
    ingest(slot, new DataView(data, 1, 8), 'ws');
  }

  return {
    offer,
    close,
    handleText,
    handleBinary,
    mode(slot: number): TransportMode {
      return modes[slot] ?? 'idle';
    },
  };
}

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      window.clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = window.setTimeout(finish, 1500);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function readSlot(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as { slot?: unknown; toSlot?: unknown };
  const value = typeof record.slot === 'number' ? record.slot : record.toSlot;
  if (typeof value !== 'number' || value < 0 || value > 7) return null;
  return value;
}

function readSdp(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const sdp = (payload as { sdp?: unknown }).sdp;
  return typeof sdp === 'string' && sdp !== '' ? sdp : null;
}

function readCandidate(payload: unknown): RTCIceCandidateInit | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = (payload as { candidate?: unknown }).candidate;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const record = candidate as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown };
  if (typeof record.candidate !== 'string') return null;
  return {
    candidate: record.candidate,
    sdpMid: typeof record.sdpMid === 'string' ? record.sdpMid : null,
    sdpMLineIndex: typeof record.sdpMLineIndex === 'number' ? record.sdpMLineIndex : null,
  };
}
