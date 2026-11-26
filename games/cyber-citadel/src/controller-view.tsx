import { createEffect, createSignal, onCleanup, type VoidComponent } from 'solid-js';
import type { PadStatePayload } from '../../../shared/src/types/game-control.ts';
import { ControllerShell } from '../../../shared/src/ui/index.tsx';
import { CYBER_CITADEL_CONSTANTS as C } from './constants.ts';
import './controller-view.css';
import { CYBER_CITADEL_MANIFEST } from './manifest.ts';

export function formatCyberReadout(wave: number, downed: boolean, empFlash: boolean): string {
  const safeWave = Math.max(1, Math.min(C.totalWaves, Math.trunc(wave || 1)));
  if (empFlash) return `WAVE ${safeWave}/${C.totalWaves} · SUPER BOMB`;
  if (downed) return `WAVE ${safeWave}/${C.totalWaves} · DOWNED`;
  return `WAVE ${safeWave}/${C.totalWaves}`;
}

function readNum(payload: unknown, key: string, fallback: number): number {
  if (typeof payload !== 'object' || payload === null) return fallback;
  const val = (payload as Record<string, unknown>)[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

export const CyberCitadelController: VoidComponent<{
  color: string;
  name: string;
  slot: number;
  control: { type: string; payload: unknown } | null;
  padState?: PadStatePayload | null;
  onAxes: (x: number, y: number, timeStamp: number) => void;
  onButton: (down: boolean, timeStamp: number, bit?: number) => void;
}> = (props) => {
  const initialWave =
    props.control?.type === 'cyber:wave_start' || props.control?.type === 'cyber:wave_end'
      ? readNum(props.control.payload, 'wave', 1)
      : 1;
  const [wave, setWave] = createSignal(initialWave);
  const [downed, setDowned] = createSignal(false);
  const [empFlash, setEmpFlash] = createSignal(false);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let tapticRef: HTMLInputElement | undefined;

  function clearFlash(): void {
    if (flashTimer !== null) {
      clearTimeout(flashTimer);
      flashTimer = null;
    }
  }

  function triggerVibrate(pattern: number | number[]): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern);
      } catch {
        // ignore unsupported browsers
      }
    }
  }

  function pulseIosTaptic(): void {
    if (tapticRef === undefined) return;
    try {
      tapticRef.click();
    } catch {
      // ignore in SSR/headless environments
    }
  }

  onCleanup(clearFlash);

  createEffect(
    () => props.control,
    (message) => {
      if (message === null) return;
      if (message.type === 'cyber:wave_start') {
        setWave(readNum(message.payload, 'wave', wave()));
        triggerVibrate(20);
        return;
      }
      if (message.type === 'cyber:wave_end') {
        setWave(readNum(message.payload, 'wave', wave()));
        setDowned(false);
        return;
      }
      if (message.type === 'cyber:downed') {
        const target = readNum(message.payload, 'slot', -1);
        if (target === props.slot) {
          setDowned(true);
          triggerVibrate([40, 30, 40]);
        }
        return;
      }
      if (message.type === 'cyber:revived') {
        const target = readNum(message.payload, 'slot', -1);
        if (target === props.slot) {
          setDowned(false);
          triggerVibrate(25);
        }
        return;
      }
      if (message.type === 'cyber:emp') {
        triggerVibrate([35, 25, 65]);
        pulseIosTaptic();
        clearFlash();
        setEmpFlash(true);
        flashTimer = setTimeout(() => {
          flashTimer = null;
          setEmpFlash(false);
        }, 220);
      }
    },
  );

  return (
    <>
      <input
        ref={tapticRef}
        class="cyber-taptic-switch"
        type="checkbox"
        aria-hidden="true"
        tabindex={-1}
        {...({ switch: '' } as Record<string, string>)}
      />
      <ControllerShell
        color={props.color}
        name={props.name}
        slot={props.slot}
        layout={CYBER_CITADEL_MANIFEST.controllerLayout}
        control={props.control}
        padState={props.padState}
        onAxes={props.onAxes}
        onButton={props.onButton}
        customBoardClass="cyber-board"
        customBoardAttrs={{
          'data-emp-flash': empFlash() ? 'true' : 'false',
        }}
        hud={
          <p class="cyber-readout" data-downed={downed() ? 'true' : 'false'}>
            {formatCyberReadout(wave(), downed(), empFlash())}
          </p>
        }
      />
    </>
  );
};
