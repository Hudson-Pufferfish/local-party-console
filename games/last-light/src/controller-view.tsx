import { createEffect, createMemo, createSignal, onCleanup, type VoidComponent } from 'solid-js';
import type { PadStatePayload } from '../../../shared/src/types/game-control.ts';
import { ControllerShell } from '../../../shared/src/ui/index.tsx';
import { LIGHT_PHASE as P } from './constants.ts';
import './controller-view.css';
import { LAST_LIGHT_MANIFEST } from './manifest.ts';
import type { LightControlMessage, LightPhase, LightPlayerStatus } from './types.ts';

export interface LightHudState {
  readonly phase: LightPhase;
  readonly status: LightPlayerStatus;
  readonly score: number;
  readonly flashSeq: number;
}

const FLASH_DURATION_MS = 140;
const BLOWOUT_VIBRATE_MS = 65;

export function createInitialLightHudState(): LightHudState {
  return {
    phase: P.practice,
    status: 'IN',
    score: 0,
    flashSeq: 0,
  };
}

export function reduceLightControl(
  prev: LightHudState,
  message: LightControlMessage | null,
  slot: number,
): LightHudState {
  if (message === null) return prev;
  const bit = slot >= 0 && slot < 8 ? 1 << slot : 0;

  if (message.type === 'light:practice_start') {
    return {
      ...prev,
      phase: P.practice,
      status: 'IN',
    };
  }

  if (message.type === 'light:round_start') {
    const scores = readScores(message.payload);
    const contenderMask = readIntField(message.payload, 'contenderMask');
    const isContender = contenderMask === null ? true : (contenderMask & bit) !== 0;
    return {
      ...prev,
      phase: P.countdown,
      status: isContender ? 'IN' : 'WATCHING',
      score: scores !== null ? (scores[slot] ?? prev.score) : prev.score,
    };
  }

  if (message.type === 'light:lock') {
    const lockedMask = readIntField(message.payload, 'lockedMask');
    if (lockedMask !== null && bit !== 0 && (lockedMask & bit) !== 0) {
      return {
        ...prev,
        status: 'LOCKED',
      };
    }
    return prev;
  }

  if (message.type === 'light:blowout') {
    const lockedMask = readIntField(message.payload, 'lockedMask') ?? 0;
    const outMask = readIntField(message.payload, 'outMask') ?? 0;
    const isPractice = (message.payload as { practice?: unknown })?.practice === true;
    let nextStatus = prev.status;
    if (bit !== 0 && (outMask & bit) !== 0) {
      nextStatus = 'OUT';
    } else if (bit !== 0 && (lockedMask & bit) !== 0) {
      nextStatus = 'LOCKED';
    }
    return {
      ...prev,
      status: nextStatus,
      // Suppress full-screen flash and haptic sequence during practice mode
      flashSeq: isPractice ? prev.flashSeq : prev.flashSeq + 1,
    };
  }

  if (message.type === 'light:round_end') {
    const scores = readScores(message.payload);
    return {
      ...prev,
      phase: P.roundEnd,
      score: scores !== null ? (scores[slot] ?? prev.score) : prev.score,
    };
  }

  if (message.type === 'light:match_end') {
    const scores = readScores(message.payload);
    return {
      ...prev,
      phase: P.matchOver,
      score: scores !== null ? (scores[slot] ?? prev.score) : prev.score,
    };
  }

  if (message.type === 'light:state') {
    const scores = readScores(message.payload);
    const phaseRaw = readIntField(message.payload, 'phase');
    const phase = (phaseRaw !== null ? phaseRaw : prev.phase) as LightPhase;
    const lockedMask = readIntField(message.payload, 'lockedMask') ?? 0;
    const contenderMask = readIntField(message.payload, 'contenderMask') ?? 0xff;
    let status: LightPlayerStatus = 'IN';
    if (bit !== 0 && (contenderMask & bit) === 0) {
      status = 'WATCHING';
    } else if (bit !== 0 && (lockedMask & bit) !== 0) {
      status = 'LOCKED';
    } else if (phase === P.roundEnd || phase === P.matchOver) {
      status = 'OUT';
    }
    return {
      ...prev,
      phase,
      status,
      score: scores !== null ? (scores[slot] ?? prev.score) : prev.score,
    };
  }

  return prev;
}

export function hapticForLightControl(
  message: LightControlMessage | null,
  _slot: number,
): number | null {
  if (message === null) return null;
  if (message.type === 'light:blowout') return BLOWOUT_VIBRATE_MS;
  return null;
}

export const LastLightController: VoidComponent<{
  color: string;
  name: string;
  slot: number;
  control: LightControlMessage | null;
  padState?: PadStatePayload | null;
  onAxes: (x: number, y: number, timeStamp: number) => void;
  onButton: (down: boolean, timeStamp: number, bit?: number) => void;
}> = (props) => {
  const [hud, setHud] = createSignal<LightHudState>(
    reduceLightControl(createInitialLightHudState(), props.control, props.slot),
  );
  const [flashing, setFlashing] = createSignal(false);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let iosHapticLabel: HTMLLabelElement | undefined;
  let lastFlashSeq = hud().flashSeq;
  let prevControl: LightControlMessage | null = props.control;

  onCleanup(() => {
    if (flashTimer !== null) clearTimeout(flashTimer);
  });

  function triggerBlowoutFeedback(vibrateMs: number | null): void {
    if (flashTimer !== null) clearTimeout(flashTimer);
    setFlashing(true);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      setFlashing(false);
    }, FLASH_DURATION_MS);

    if (vibrateMs !== null && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(vibrateMs);
      } catch {
        // ignore
      }
    }
    // iOS 18 Safari Taptic Engine fallback via hidden switch checkbox toggle.
    try {
      iosHapticLabel?.click();
    } catch {
      // ignore
    }
  }

  createEffect(
    () => props.control,
    (message) => {
      if (message === null || message === prevControl) return;
      prevControl = message;
      setHud((current) => reduceLightControl(current, message, props.slot));
      const seq = hud().flashSeq;
      if (seq > lastFlashSeq) {
        lastFlashSeq = seq;
        triggerBlowoutFeedback(hapticForLightControl(message, props.slot));
      }
    },
  );

  const derivedPadState = createMemo<PadStatePayload>(() => {
    const status = hud().status;
    const isLocked = status === 'LOCKED';
    const isWatching = status === 'WATCHING';
    const label = isLocked ? 'LOCKED' : isWatching ? 'WATCHING' : 'LOCK IN';
    return {
      slot: props.slot,
      labels: [label],
      disabled: isLocked || isWatching ? 1 : 0,
    };
  });

  return (
    <div class="light-controller-root" data-status={hud().status.toLowerCase()}>
      <ControllerShell
        color={props.color}
        name={props.name}
        slot={props.slot}
        layout={LAST_LIGHT_MANIFEST.controllerLayout}
        padState={derivedPadState()}
        onAxes={props.onAxes}
        onButton={(down, timeStamp, bit) => props.onButton(down, timeStamp, bit)}
        customBoardClass="light-board"
        customBoardAttrs={{
          'data-status': hud().status.toLowerCase(),
        }}
        hud={
          <p class="light-readout" data-status={hud().status.toLowerCase()}>
            <span class="light-status-badge" data-status={hud().status.toLowerCase()}>
              {hud().status}
            </span>
            <span class="light-score">{hud().score} PTS</span>
          </p>
        }
      />
      <div
        class="light-blowout-flash"
        data-flash={flashing() ? 'true' : 'false'}
        aria-hidden="true"
      />
      <label
        class="light-haptic-switch"
        aria-hidden="true"
        ref={(el) => {
          iosHapticLabel = el;
        }}
      >
        <input
          type="checkbox"
          tabindex={-1}
          ref={(el) => {
            el.setAttribute('switch', '');
          }}
        />
      </label>
    </div>
  );
};

function readIntField(payload: unknown, key: string): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = (payload as Record<string, unknown>)[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw | 0 : null;
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
