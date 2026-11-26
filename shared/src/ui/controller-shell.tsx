import type { JSX } from '@solidjs/web';
import {
  children,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type VoidComponent,
} from 'solid-js';
import type { ButtonBit, ButtonSpec, ControllerLayout } from '../controller/layout.ts';
import { normalizeName } from '../name-service.ts';
import { playerStyleVars } from '../theme.ts';
import {
  readPadStateMessage,
  type GameControlMessage,
  type PadStatePayload,
} from '../types/game-control.ts';
import { ArcadeButton } from './arcade-button.tsx';
import './controller-shell.css';
import { PlayerBadge } from './player-badge.tsx';
import { VirtualJoystick } from './virtual-joystick.tsx';

export interface ControllerShellProps {
  readonly color: string;
  readonly name: string;
  readonly slot: number;
  readonly layout: ControllerLayout;
  readonly onAxes: (x: number, y: number, timeStamp: number) => void;
  readonly onButton: (down: boolean, timeStamp: number, bit: number) => void;
  readonly control?: GameControlMessage | null;
  readonly padState?: PadStatePayload | null;
  readonly hud?: JSX.Element;
  readonly alert?: JSX.Element;
  readonly customBoardClass?: string;
  readonly customBoardAttrs?: Record<string, string | boolean | undefined>;
}

export const ControllerShell: VoidComponent<ControllerShellProps> = (props) => {
  // Track cooldown active state and duration per button bit (0..3)
  const [cooldowns, setCooldowns] = createSignal<[boolean, boolean, boolean, boolean]>([
    false,
    false,
    false,
    false,
  ]);
  const [cooldownDurations, setCooldownDurations] = createSignal<[number, number, number, number]>([
    0,
    0,
    0,
    0,
  ]);
  const [padFromControl, setPadFromControl] = createSignal<PadStatePayload | null>(
    readPadStateMessage(props.control, props.slot),
  );

  const timers: Array<ReturnType<typeof setTimeout> | null> = [null, null, null, null];

  onCleanup(() => {
    for (const t of timers) {
      if (t !== null) clearTimeout(t);
    }
  });

  function clearCooldown(bit: ButtonBit): void {
    if (timers[bit] !== null) {
      clearTimeout(timers[bit]!);
      timers[bit] = null;
    }
    setCooldowns((prev) => {
      if (!prev[bit]) return prev;
      const next = [...prev] as [boolean, boolean, boolean, boolean];
      next[bit] = false;
      return next;
    });
    setCooldownDurations((prev) => {
      if (prev[bit] === 0) return prev;
      const next = [...prev] as [number, number, number, number];
      next[bit] = 0;
      return next;
    });
  }

  function triggerCooldown(bit: ButtonBit, durationMs: number): void {
    if (timers[bit] !== null) {
      clearTimeout(timers[bit]!);
    }
    setCooldownDurations((prev) => {
      const next = [...prev] as [number, number, number, number];
      next[bit] = durationMs;
      return next;
    });
    setCooldowns((prev) => {
      const next = [...prev] as [boolean, boolean, boolean, boolean];
      next[bit] = true;
      return next;
    });

    timers[bit] = setTimeout(() => {
      timers[bit] = null;
      setCooldowns((prev) => {
        const next = [...prev] as [boolean, boolean, boolean, boolean];
        next[bit] = false;
        return next;
      });
    }, durationMs);
  }

  function syncHostCooldowns(cooldownEndsAt: readonly number[] | undefined): void {
    if (cooldownEndsAt === undefined) return;
    const now = Date.now();
    const count = Math.min(cooldownEndsAt.length, 4);
    for (let i = 0; i < count; i += 1) {
      const bit = i as ButtonBit;
      const endsAt = cooldownEndsAt[bit];
      if (endsAt === undefined || endsAt <= now) {
        clearCooldown(bit);
      } else {
        triggerCooldown(bit, Math.max(1, Math.round(endsAt - now)));
      }
    }
  }

  const activePadState = createMemo<PadStatePayload | null>(() => {
    if (props.padState !== undefined) {
      if (props.padState !== null && props.padState.slot === props.slot) {
        return props.padState;
      }
      return null;
    }
    const fromControl = padFromControl();
    if (fromControl !== null && fromControl.slot === props.slot) {
      return fromControl;
    }
    return null;
  });

  createEffect(
    () => ({
      slot: props.slot,
      padState: props.padState,
      control: props.control,
    }),
    ({ slot, padState, control }) => {
      if (padState !== undefined) {
        if (padState !== null && padState.slot === slot) {
          syncHostCooldowns(padState.cooldownEndsAt);
        }
        return;
      }
      const parsed = readPadStateMessage(control, slot);
      if (parsed !== null) {
        setPadFromControl(parsed);
        syncHostCooldowns(parsed.cooldownEndsAt);
      }
    },
  );

  function buttonLabel(spec: ButtonSpec): string {
    const override = activePadState()?.labels?.[spec.bit];
    if (override !== undefined && override.trim() !== '') {
      return override.trim();
    }
    return spec.label;
  }

  function buttonDisabled(bit: ButtonBit): boolean {
    const mask = activePadState()?.disabled;
    return mask !== undefined && (mask & (1 << bit)) !== 0;
  }

  function buttonCooldownMs(spec: ButtonSpec): number {
    const synced = cooldownDurations()[spec.bit];
    return synced > 0 ? synced : (spec.cooldownMs ?? 0);
  }

  function handleButtonPress(spec: ButtonSpec, down: boolean, timeStamp: number): void {
    const bit = spec.bit;
    if (down && buttonDisabled(bit)) return;
    const isCool = cooldowns()[bit];

    if (down) {
      // If it's a tap button with cooldown, and not on cooldown, trigger cooldown and optional haptic
      if (spec.kind === 'tap' && spec.cooldownMs && spec.cooldownMs > 0 && !isCool) {
        triggerCooldown(bit, spec.cooldownMs);
      }
      if (spec.hapticMs && spec.hapticMs > 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(spec.hapticMs);
        } catch {
          // ignore
        }
      }
    }

    props.onButton(down, timeStamp, bit);
  }

  const label = (): string => (props.slot < 0 ? 'P-' : `P${props.slot + 1}`);
  const title = (): string => {
    const normalized = normalizeName(props.name);
    return normalized === '' ? 'PLAYER' : normalized;
  };

  const boardClass = (): string => {
    const base = 'controller-shell';
    return props.customBoardClass ? `${base} ${props.customBoardClass}` : base;
  };

  const resolvedHud = children(() => props.hud);
  const resolvedAlert = children(() => props.alert);

  return (
    <section
      class={boardClass()}
      style={playerStyleVars(props.slot, props.color)}
      {...(props.customBoardAttrs ?? {})}
    >
      <header class="controller-shell-bar">
        <PlayerBadge name={title()} label={label()} />
        <Show when={resolvedHud()}>
          <div class="controller-shell-hud">{resolvedHud()}</div>
        </Show>
      </header>

      <Show when={resolvedAlert()}>
        <div class="controller-shell-alert">{resolvedAlert()}</div>
      </Show>

      <div class="controller-hands">
        <VirtualJoystick label="MOVE" onAxes={props.onAxes} />

        <div class="controller-shell-actions">
          <Show when={props.layout.preset === 'stick-single'}>
            {(() => {
              const spec = props.layout.buttons[0];
              const bit = spec.bit;
              const active = () => cooldowns()[bit];
              return (
                <div class="dock-preset-single">
                  <ArcadeButton
                    label={buttonLabel(spec)}
                    disabled={buttonDisabled(bit)}
                    onPressedChange={(down, ts) => handleButtonPress(spec, down, ts)}
                  />
                  <Show when={(spec.cooldownMs !== undefined && spec.cooldownMs > 0) || cooldownDurations()[bit] > 0}>
                    <div
                      class="button-cooldown-meter"
                      data-active={active() ? 'true' : 'false'}
                      style={{
                        'transition-duration': active() ? `${buttonCooldownMs(spec)}ms` : '0ms',
                        'transition-property': 'transform',
                        'transition-timing-function': 'linear',
                      }}
                    />
                  </Show>
                </div>
              );
            })()}
          </Show>

          <Show when={props.layout.preset === 'stick-diamond'}>
            <div class="diamond-preset-grid">
              <For each={props.layout.buttons}>
                {(spec) => {
                  const glyphClass =
                    spec.glyph === 'Y'
                      ? 'diamond-top'
                      : spec.glyph === 'X'
                        ? 'diamond-left'
                        : spec.glyph === 'B'
                          ? 'diamond-right'
                          : 'diamond-bottom'; // 'A'
                  const active = () => cooldowns()[spec.bit];

                  return (
                    <div class={`diamond-slot ${glyphClass}`}>
                      <ArcadeButton
                        label={`${spec.glyph} ${buttonLabel(spec)}`}
                        disabled={buttonDisabled(spec.bit)}
                        onPressedChange={(down, ts) => handleButtonPress(spec, down, ts)}
                      />
                      <Show when={(spec.cooldownMs !== undefined && spec.cooldownMs > 0) || cooldownDurations()[spec.bit] > 0}>
                        <div
                          class="button-cooldown-meter"
                          data-active={active() ? 'true' : 'false'}
                          style={{
                            'transition-duration': active() ? `${buttonCooldownMs(spec)}ms` : '0ms',
                            'transition-property': 'transform',
                            'transition-timing-function': 'linear',
                          }}
                        />
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </section>
  );
};
