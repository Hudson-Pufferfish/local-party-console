import { createEffect, createSignal, type VoidComponent } from 'solid-js';
import { normalizeName } from '../../../shared/src/name-service.ts';
import { playerStyleVars } from '../../../shared/src/theme.ts';
import { ArcadeButton, PlayerBadge, VirtualJoystick } from '../../../shared/src/ui/index.tsx';
import './controller-view.css';

export const SumoController: VoidComponent<{
  color: string;
  name: string;
  slot: number;
  control: { type: string; payload: unknown } | null;
  onAxes: (x: number, y: number, timeStamp: number) => void;
  onButton: (down: boolean, timeStamp: number) => void;
}> = (props) => {
  const [score, setScore] = createSignal(0);
  const [alive, setAlive] = createSignal(true);
  const [cool, setCool] = createSignal(false);

  createEffect(() => props.control, (message) => {
    if (message === null) return;
    if (message.type === 'sumo:haptic') {
      buzz(message.payload);
      return;
    }
    if (message.type === 'sumo:round_start') {
      setAlive(true);
      const scores = readScores(message.payload);
      if (scores !== null) setScore(scores[props.slot] ?? 0);
      return;
    }
    if (message.type === 'sumo:elimination') {
      const index = readIndex(message.payload);
      if (index === props.slot) setAlive(false);
      return;
    }
    if (message.type === 'sumo:round_end') {
      const scores = readScores(message.payload);
      if (scores !== null) setScore(scores[props.slot] ?? 0);
    }
  });

  function onDash(down: boolean, timeStamp: number): void {
    if (down && !cool()) setCool(true);
    props.onButton(down, timeStamp);
  }

  const label = (): string => (props.slot < 0 ? 'P-' : `P${props.slot + 1}`);
  const title = (): string => {
    const normalized = normalizeName(props.name);
    return normalized === '' ? 'PLAYER' : normalized;
  };

  return (
    <section class="sumo-board" style={playerStyleVars(props.slot, props.color)}>
      <header class="sumo-bar">
        <PlayerBadge name={title()} label={label()} />
        <p class="sumo-readout">
          {alive() ? 'ALIVE' : 'OUT'} {score()}
        </p>
      </header>
      <div class="controller-hands sumo-hands">
        <VirtualJoystick label="MOVE" onAxes={props.onAxes} />
        <div class="dash-dock">
          <span
            class="dash-meter"
            data-cool={cool() ? 'true' : 'false'}
            onTransitionEnd={() => setCool(false)}
          />
          <ArcadeButton label="DASH" onPressedChange={onDash} />
        </div>
      </div>
    </section>
  );
};

function buzz(payload: unknown): void {
  const intensity = readIntensity(payload);
  if (intensity !== 'heavy' && intensity !== 'out') return;
  if (typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(25);
}

function readIntensity(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const intensity = (payload as { intensity?: unknown }).intensity;
  return typeof intensity === 'string' ? intensity : '';
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

function readIndex(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const index = (payload as { playerIndex?: unknown }).playerIndex;
  if (typeof index !== 'number' || index < 0 || index > 7) return null;
  return index;
}
