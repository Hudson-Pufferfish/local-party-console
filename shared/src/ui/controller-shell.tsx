import type { JSX } from '@solidjs/web';
import { children, createSignal, For, onCleanup, Show, type VoidComponent } from 'solid-js';
import type { ButtonBit, ButtonSpec, ControllerLayout } from '../controller/layout.ts';
import { normalizeName } from '../name-service.ts';
import { playerStyleVars } from '../theme.ts';
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
  readonly hud?: JSX.Element;
  readonly alert?: JSX.Element;
  readonly customBoardClass?: string;
  readonly customBoardAttrs?: Record<string, string | boolean | undefined>;
}

export const ControllerShell: VoidComponent<ControllerShellProps> = (props) => {
  // Track cooldown per button bit (0..3)
  const [cooldowns, setCooldowns] = createSignal<[boolean, boolean, boolean, boolean]>([
    false,
    false,
    false,
    false,
  ]);

  const timers: Array<ReturnType<typeof setTimeout> | null> = [null, null, null, null];

  onCleanup(() => {
    for (const t of timers) {
      if (t !== null) clearTimeout(t);
    }
  });

  function triggerCooldown(bit: ButtonBit, durationMs: number): void {
    if (timers[bit] !== null) {
      clearTimeout(timers[bit]!);
    }
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

  function handleButtonPress(spec: ButtonSpec, down: boolean, timeStamp: number): void {
    const bit = spec.bit;
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
                    label={spec.label}
                    onPressedChange={(down, ts) => handleButtonPress(spec, down, ts)}
                  />
                  <Show when={spec.cooldownMs && spec.cooldownMs > 0}>
                    <div
                      class="button-cooldown-meter"
                      data-active={active() ? 'true' : 'false'}
                      style={{
                        'transition-duration': active() ? `${spec.cooldownMs}ms` : '0ms',
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
                        label={`${spec.glyph} ${spec.label}`}
                        onPressedChange={(down, ts) => handleButtonPress(spec, down, ts)}
                      />
                      <Show when={spec.cooldownMs && spec.cooldownMs > 0}>
                        <div
                          class="button-cooldown-meter"
                          data-active={active() ? 'true' : 'false'}
                          style={{
                            'transition-duration': active() ? `${spec.cooldownMs}ms` : '0ms',
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
