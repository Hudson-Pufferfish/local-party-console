import { createEffect, createSignal, onCleanup, type VoidComponent } from 'solid-js';
import { ControllerShell, type ButtonMeter } from '../../../shared/src/ui/index.tsx';
import { COLOR_CLASH_MANIFEST } from './manifest.ts';
import './controller-view.css';

export type BoostUiState = 'ready' | 'boosting' | 'recharge';

export function boostMeterFor(state: BoostUiState, activeMs: number, cooldownMs: number): ButtonMeter {
  if (state === 'boosting') return { phase: 'drain', ms: activeMs };
  if (state === 'recharge') return { phase: 'fill', ms: Math.max(0, cooldownMs - activeMs) };
  return { phase: 'ready', ms: 0 };
}

export function formatColorReadout(
  pct: number,
  boostState: BoostUiState,
  overtime: boolean,
  watching = false,
  score = 0,
): string {
  const safePct = Number.isFinite(pct) && pct > 0 ? pct : 0;
  let status = 'READY';
  if (watching) status = 'WATCHING';
  else if (boostState === 'boosting') status = 'BOOSTING';
  else if (boostState === 'recharge') status = 'RECHARGE';
  else if (overtime) status = 'OVERTIME';
  const scorePrefix = score > 0 ? `${score} PTS · ` : '';
  return `${scorePrefix}${safePct.toFixed(1)}% · ${status}`;
}

export function reduceColorControl(
  prev: { pct: number; score: number; boostState: BoostUiState; overtime: boolean; watching: boolean },
  message: { type: string; payload: unknown } | null,
  slot: number,
): { pct: number; score: number; boostState: BoostUiState; overtime: boolean; watching: boolean } {
  if (message === null) return prev;
  if (message.type === 'color:match_start' || message.type === 'color:round_start') {
    const scores = readScores(message.payload);
    const score = scores !== null && slot >= 0 && slot < 8 ? (scores[slot] ?? prev.score) : prev.score;
    const mask = readNumber(message.payload, 'activeMask', -1);
    const watching = mask >= 0 && slot >= 0 && slot < 8 ? (mask & (1 << slot)) === 0 : false;
    return {
      pct: 0,
      score,
      boostState: 'ready',
      overtime: false,
      watching,
    };
  }
  if (message.type === 'color:scores') {
    const percents = readPercents(message.payload);
    const pct = percents !== null && slot >= 0 && slot < 8 ? (percents[slot] ?? prev.pct) : prev.pct;
    const scores = readScores(message.payload);
    const score = scores !== null && slot >= 0 && slot < 8 ? (scores[slot] ?? prev.score) : prev.score;
    return { ...prev, pct, score };
  }
  if (message.type === 'color:overtime') {
    const mask = readNumber(message.payload, 'contenderMask', 0xff);
    const isContender = slot >= 0 && slot < 8 && (mask & (1 << slot)) !== 0;
    return {
      ...prev,
      boostState: 'ready',
      overtime: true,
      watching: !isContender,
    };
  }
  if (message.type === 'color:round_end') {
    const scores = readScores(message.payload);
    const score = scores !== null && slot >= 0 && slot < 8 ? (scores[slot] ?? prev.score) : prev.score;
    return { ...prev, boostState: 'ready', score };
  }
  if (message.type === 'color:match_end') {
    const percents = readPercents(message.payload);
    const pct = percents !== null && slot >= 0 && slot < 8 ? (percents[slot] ?? prev.pct) : prev.pct;
    const scores = readScores(message.payload);
    const score = scores !== null && slot >= 0 && slot < 8 ? (scores[slot] ?? prev.score) : prev.score;
    return { ...prev, boostState: 'ready', pct, score };
  }
  return prev;
}

export const ColorClashController: VoidComponent<{
  color: string;
  name: string;
  slot: number;
  control: { type: string; payload: unknown } | null;
  onAxes: (x: number, y: number, timeStamp: number) => void;
  onButton: (down: boolean, timeStamp: number, bit?: number) => void;
}> = (props) => {
  const initial = reduceColorControl(
    { pct: 0, score: 0, boostState: 'ready', overtime: false, watching: false },
    props.control,
    props.slot,
  );
  const [pct, setPct] = createSignal(initial.pct);
  const [score, setScore] = createSignal(initial.score);
  const [boostState, setBoostState] = createSignal<BoostUiState>(initial.boostState);
  const [overtime, setOvertime] = createSignal(initial.overtime);
  const [watching, setWatching] = createSignal(initial.watching);
  const [meterActiveMs, setMeterActiveMs] = createSignal(3000);
  const [meterCooldownMs, setMeterCooldownMs] = createSignal(8000);

  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let coolTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers(): void {
    if (activeTimer !== null) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    if (coolTimer !== null) {
      clearTimeout(coolTimer);
      coolTimer = null;
    }
  }

  function startBoostCycle(activeMs = 3000, cooldownMs = 8000): void {
    clearTimers();
    const rechargeMs = Math.max(0, cooldownMs - activeMs);
    setMeterActiveMs(activeMs);
    setMeterCooldownMs(cooldownMs);
    setBoostState('boosting');
    activeTimer = setTimeout(() => {
      activeTimer = null;
      if (rechargeMs <= 0) {
        setBoostState('ready');
        return;
      }
      setBoostState('recharge');
      coolTimer = setTimeout(() => {
        coolTimer = null;
        setBoostState('ready');
      }, rechargeMs);
    }, activeMs);
  }

  onCleanup(clearTimers);

  createEffect(() => props.control, (message) => {
    if (message === null) return;
    if (message.type === 'color:haptic') {
      const target = readIndex(message.payload);
      if (target === null || target === props.slot) {
        buzz(message.payload);
      }
      return;
    }
    if (message.type === 'color:match_start' || message.type === 'color:round_start') {
      clearTimers();
      setPct(0);
      setBoostState('ready');
      setOvertime(false);
      const scores = readScores(message.payload);
      if (scores !== null && props.slot >= 0 && props.slot < 8) {
        setScore(scores[props.slot] ?? 0);
      }
      const mask = readNumber(message.payload, 'activeMask', -1);
      if (mask >= 0 && props.slot >= 0 && props.slot < 8) {
        setWatching((mask & (1 << props.slot)) === 0);
      } else {
        setWatching(false);
      }
      return;
    }
    if (message.type === 'color:boost') {
      const index = readIndex(message.payload);
      if (index === props.slot) {
        const activeMs = readNumber(message.payload, 'activeMs', 3000);
        const cooldownMs = readNumber(message.payload, 'cooldownMs', 8000);
        startBoostCycle(activeMs, cooldownMs);
      }
      return;
    }
    if (message.type === 'color:scores') {
      const percents = readPercents(message.payload);
      if (percents !== null && props.slot >= 0 && props.slot < 8) {
        setPct(percents[props.slot] ?? 0);
      }
      const scores = readScores(message.payload);
      if (scores !== null && props.slot >= 0 && props.slot < 8) {
        setScore(scores[props.slot] ?? 0);
      }
      return;
    }
    if (message.type === 'color:overtime') {
      clearTimers();
      setBoostState('ready');
      setOvertime(true);
      const mask = readNumber(message.payload, 'contenderMask', 0xff);
      const isContender = props.slot >= 0 && props.slot < 8 && (mask & (1 << props.slot)) !== 0;
      setWatching(!isContender);
      return;
    }
    if (message.type === 'color:round_end') {
      clearTimers();
      setBoostState('ready');
      const scores = readScores(message.payload);
      if (scores !== null && props.slot >= 0 && props.slot < 8) {
        setScore(scores[props.slot] ?? 0);
      }
      return;
    }
    if (message.type === 'color:match_end') {
      clearTimers();
      setBoostState('ready');
      const percents = readPercents(message.payload);
      if (percents !== null && props.slot >= 0 && props.slot < 8) {
        setPct(percents[props.slot] ?? 0);
      }
      const scores = readScores(message.payload);
      if (scores !== null && props.slot >= 0 && props.slot < 8) {
        setScore(scores[props.slot] ?? 0);
      }
    }
  });

  function onBoost(down: boolean, timeStamp: number, bit?: number): void {
    if (down && boostState() === 'ready' && !watching()) {
      startBoostCycle(3000, 8000);
    }
    props.onButton(down, timeStamp, bit);
  }

  return (
    <ControllerShell
      color={props.color}
      name={props.name}
      slot={props.slot}
      layout={COLOR_CLASH_MANIFEST.controllerLayout}
      onAxes={props.onAxes}
      onButton={onBoost}
      meters={{ 0: boostMeterFor(boostState(), meterActiveMs(), meterCooldownMs()) }}
      customBoardClass="color-board"
      hud={
        <>
          <span
            class="color-splash"
            data-boost={boostState() === 'boosting' ? 'true' : 'false'}
            aria-hidden="true"
          />
          <p class="color-readout">
            {formatColorReadout(pct(), boostState(), overtime(), watching(), score())}
          </p>
        </>
      }
    />
  );
};

function buzz(payload: unknown): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  const intensity = readIntensity(payload);
  if (intensity === 'golden') {
    navigator.vibrate([25, 40, 40]);
  } else if (intensity === 'heavy') {
    navigator.vibrate(25);
  } else if (intensity === 'light') {
    navigator.vibrate(15);
  }
}

function readIntensity(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const intensity = (payload as { intensity?: unknown }).intensity;
  return typeof intensity === 'string' ? intensity : '';
}

function readIndex(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const index = (payload as { playerIndex?: unknown }).playerIndex;
  if (typeof index !== 'number' || index < 0 || index > 7) return null;
  return index;
}

function readNumber(payload: unknown, key: string, fallback: number): number {
  if (typeof payload !== 'object' || payload === null) return fallback;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readPercents(payload: unknown): number[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const percents = (payload as { percents?: unknown }).percents;
  if (!Array.isArray(percents)) return null;
  const list = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let index = 0; index < 8; index += 1) {
    const value = percents[index];
    list[index] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  return list;
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
