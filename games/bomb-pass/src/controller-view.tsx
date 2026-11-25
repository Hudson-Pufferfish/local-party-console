import { createEffect, createSignal, Show, type VoidComponent } from 'solid-js';
import { ControllerShell } from '../../../shared/src/ui/index.tsx';
import { BOMB_PASS_MANIFEST } from './manifest.ts';
import './controller-view.css';

export type BombUrgency = 'none' | 'normal' | 'warn' | 'critical';

export interface BombControlMessage {
  type: string;
  payload: unknown;
}

export interface BombHudState {
  readonly holdingBomb: boolean;
  readonly urgency: BombUrgency;
  readonly remainingMs: number;
  readonly alive: boolean;
  readonly score: number;
}

const WARN_MS = 5000;
const CRITICAL_MS = 2000;
const DISPLAY_STEP_MS = 250;

export function createInitialBombHudState(): BombHudState {
  return {
    holdingBomb: false,
    urgency: 'none',
    remainingMs: 0,
    alive: true,
    score: 0,
  };
}

export function urgencyForRemainingMs(remainingMs: number, holding: boolean): BombUrgency {
  if (!holding) return 'none';
  if (remainingMs <= CRITICAL_MS) return 'critical';
  if (remainingMs <= WARN_MS) return 'warn';
  return 'normal';
}

export function formatBombCountdown(remainingMs: number): string {
  const secs = Math.max(0, remainingMs) / 1000;
  return `${secs.toFixed(1).padStart(4, '0')}s`;
}

export function formatBombReadout(hud: BombHudState): string {
  if (hud.holdingBomb) return `BOMB! ${formatBombCountdown(hud.remainingMs)}`;
  if (!hud.alive) return `OUT · ${hud.score} PTS`;
  return `SAFE · ${hud.score} PTS`;
}

export function reduceBombControl(
  prev: BombHudState,
  message: BombControlMessage | null,
  slot: number,
): BombHudState {
  if (message === null) return prev;

  if (message.type === 'bomb:round_start') {
    const scores = readScores(message.payload);
    return {
      holdingBomb: false,
      urgency: 'none',
      remainingMs: 0,
      alive: true,
      score: scores !== null ? (scores[slot] ?? prev.score) : prev.score,
    };
  }

  if (message.type === 'bomb:holder') {
    const holder = readNumberField(message.payload, 'holderIndex');
    const remainingMs = Math.max(0, readNumberField(message.payload, 'remainingMs') ?? 0);
    const holding = holder === slot;
    return {
      ...prev,
      holdingBomb: holding,
      remainingMs: holding ? remainingMs : 0,
      urgency: urgencyForRemainingMs(remainingMs, holding),
    };
  }

  if (message.type === 'bomb:explosion') {
    const eliminated = readEliminatedIndices(message.payload);
    const wasEliminated = eliminated.includes(slot);
    return {
      ...prev,
      holdingBomb: wasEliminated ? false : prev.holdingBomb,
      urgency: wasEliminated ? 'none' : prev.urgency,
      remainingMs: wasEliminated ? 0 : prev.remainingMs,
      alive: wasEliminated ? false : prev.alive,
    };
  }

  if (message.type === 'bomb:round_end') {
    const scores = readScores(message.payload);
    return {
      ...prev,
      holdingBomb: false,
      urgency: 'none',
      remainingMs: 0,
      score: scores !== null ? (scores[slot] ?? prev.score) : prev.score,
    };
  }

  return prev;
}

export function hapticForBombControl(
  message: BombControlMessage | null,
  slot: number,
): number | number[] | null {
  if (message === null) return null;

  if (message.type === 'bomb:holder') {
    const holder = readNumberField(message.payload, 'holderIndex');
    const previous = readNumberField(message.payload, 'previousHolder');
    if (holder === slot) return 35;
    if (previous === slot && holder !== slot) return 15;
    return null;
  }

  if (message.type === 'bomb:explosion') {
    const eliminated = readEliminatedIndices(message.payload);
    if (eliminated.includes(slot)) return 80;
    return null;
  }

  if (message.type === 'bomb:haptic') {
    const target = readTargetSlot(message.payload);
    if (target !== null && target !== slot) return null;
    const intensity = readStringField(message.payload, 'intensity');
    if (intensity === 'critical') return [40, 40, 40];
    if (intensity === 'warn') return 25;
    if (intensity === 'out') return 80;
    return null;
  }

  return null;
}

export const BombPassController: VoidComponent<{
  color: string;
  name: string;
  slot: number;
  control: BombControlMessage | null;
  onAxes: (x: number, y: number, timeStamp: number) => void;
  onButton: (down: boolean, timeStamp: number, bit?: number) => void;
}> = (props) => {
  const [hud, setHud] = createSignal<BombHudState>(
    reduceBombControl(createInitialBombHudState(), props.control, props.slot),
  );

  createEffect(
    () => props.control,
    (message) => {
      if (message === null) return;
      setHud((current) => reduceBombControl(current, message, props.slot));
      const pattern = hapticForBombControl(message, props.slot);
      if (pattern !== null && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    },
  );

  // Lightweight 250ms display countdown active ONLY while holding the bomb (zero rAF loops)
  createEffect(
    () => hud().holdingBomb,
    (holding) => {
      if (!holding || typeof window === 'undefined') return;
      const timer = window.setInterval(() => {
        setHud((current) => {
          if (!current.holdingBomb) return current;
          const nextMs = Math.max(0, current.remainingMs - DISPLAY_STEP_MS);
          return {
            ...current,
            remainingMs: nextMs,
            urgency: urgencyForRemainingMs(nextMs, true),
          };
        });
      }, DISPLAY_STEP_MS);
      return () => {
        window.clearInterval(timer);
      };
    },
  );

  const statusKind = (): 'bomb' | 'safe' | 'out' => {
    const state = hud();
    if (state.holdingBomb) return 'bomb';
    return state.alive ? 'safe' : 'out';
  };

  return (
    <div
      class="bomb-pass-wrapper"
      style={{ display: 'contents' }}
    >
      <ControllerShell
        color={props.color}
        name={props.name}
        slot={props.slot}
        layout={BOMB_PASS_MANIFEST.controllerLayout!}
        onAxes={props.onAxes}
        onButton={(down, timeStamp, bit) => props.onButton(down, timeStamp, bit)}
        customBoardClass="bomb-board"
        customBoardAttrs={{
          'data-bomb': hud().holdingBomb ? 'true' : 'false',
          'data-urgency': hud().urgency,
        }}
        hud={
          <>
            <p class="bomb-readout" data-status={statusKind()}>
              <span class="bomb-led" data-status={statusKind()} aria-hidden="true" />
              <span>{formatBombReadout(hud())}</span>
            </p>
          </>
        }
      />
      <Show when={hud().holdingBomb}>
        <div class="bomb-alert" data-urgency={hud().urgency} role="status">
          <span>HOLDING BOMB — PASS IT!</span>
          <span class="bomb-alert-time">{formatBombCountdown(hud().remainingMs)}</span>
        </div>
      </Show>
    </div>
  );
};

function readNumberField(payload: unknown, key: string): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = (payload as Record<string, unknown>)[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function readStringField(payload: unknown, key: string): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const raw = (payload as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw : '';
}

function readTargetSlot(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = (payload as { targetSlot?: unknown }).targetSlot;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function readEliminatedIndices(payload: unknown): number[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const raw = (payload as { eliminatedIndices?: unknown }).eliminatedIndices;
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const item of raw) {
    if (typeof item === 'number' && Number.isInteger(item)) out.push(item);
  }
  return out;
}

function readScores(payload: unknown): number[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const scores = (payload as { scores?: unknown }).scores;
  if (!Array.isArray(scores)) return null;
  const list = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let index = 0; index < 8; index += 1) {
    const value = scores[index];
    list[index] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  return list;
}
