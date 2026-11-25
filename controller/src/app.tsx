import { createEffect, createSignal, Show, type VoidComponent } from 'solid-js';
import type { OrientationPreference } from '../../shared/src/controller/orientation.ts';
import { classifyPower, rfc3550Jitter } from '../../shared/src/controller/preflight.ts';
import { CONTROLLER_REV } from '../../shared/src/sdp/qr-target.ts';
import { tierFor } from '../../shared/src/sync/tier.ts';
import { playerStyleVars } from '../../shared/src/theme.ts';
import {
  ArcadeButton,
  GameCard,
  HudModal,
  PlayerBadge,
  SwipeZone,
  VirtualJoystick,
} from '../../shared/src/ui/index.tsx';
import { ControllerStage } from './controller-stage.tsx';
import {
  OrientationToggle,
  readStoredOrientationPref,
  writeStoredOrientationPref,
} from './orientation-toggle.tsx';
import { connectPhone, joinNotice, storeSeq, storedToken, type PhoneLink } from './peer.ts';
import { PreflightStrip } from './preflight-strip.tsx';
import {
  controllerSupportedOrientations,
  controllerView,
  localTheme,
  type ControllerControl,
  type ControllerViewProps,
  type ThemeVars,
} from './register-games.ts';
import { lastSentSeq, readSendClock, sendAxes, sendButton, setSendClock } from './send-input.ts';

const room = new URLSearchParams(location.search).get('room') ?? '';

export const App: VoidComponent = () => {
  const [name, setName] = createSignal('');
  const [joined, setJoined] = createSignal(false);
  const [slot, setSlot] = createSignal(-1);
  const [color, setColor] = createSignal('var(--theme-yellow)');
  const [notice, setNotice] = createSignal('');
  const [power, setPower] = createSignal<'ok' | 'low-power'>('ok');
  const [powerReady, setPowerReady] = createSignal(false);
  const [cores, setCores] = createSignal(-1);
  const [layoutPref, setLayoutPref] = createSignal<OrientationPreference>(
    readStoredOrientationPref(),
  );
  const [orientationOk, setOrientationOk] = createSignal(true);
  const [rttMs, setRttMs] = createSignal<number | null>(null);
  const [jitterMs, setJitterMs] = createSignal<number | null>(null);
  const [modal, setModal] = createSignal(false);
  const [gameId, setGameId] = createSignal('');
  const [theme, setTheme] = createSignal<ThemeVars>({});
  const [control, setControl] = createSignal<ControllerControl | null>(null);
  let link: PhoneLink | undefined;
  let joinPending = false;
  let joinTimer = 0;

  createEffect(
    () => undefined,
    () => {
      if (room === '') {
        setNotice('ROOM // MISSING');
        return;
      }
      let raf = 0;
      let knownSlot = -1;
      let knownPower: 'ok' | 'low-power' = 'ok';
      let knownCores = 0;
      let probeDone = false;
      const publishTier = (): void => {
        const tier = tierFor({ power: knownPower, cores: knownCores });
        const clock = readSendClock();
        setSendClock({
          slot: knownSlot < 0 ? clock.slot : knownSlot,
          offsetMs: clock.offsetMs,
          tier,
        });
        if (!probeDone || knownSlot < 0 || link === undefined) return;
        link.sendText({
          type: 'phone:tier',
          payload: {
            slot: knownSlot,
            tier,
            lowPower: knownPower === 'low-power',
            cores: knownCores,
          },
        });
      };
      let samples = 0;
      let firstSent = 0;
      let firstRecv = 0;
      const deltas = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      let count = 0;
      let last = 0;
      const frame = (now: number): void => {
        if (last !== 0 && count < 10) {
          deltas[count] = now - last;
          count += 1;
        }
        last = now;
        if (count >= 10) {
          knownPower = classifyPower(deltas);
          knownCores = navigator.hardwareConcurrency;
          probeDone = true;
          setPower(knownPower);
          setCores(knownCores);
          setPowerReady(true);
          publishTier();
          return;
        }
        raf = window.requestAnimationFrame(frame);
      };
      raf = window.requestAnimationFrame(frame);
      const persist = (): void => {
        if (document.visibilityState !== 'hidden') return;
        const seq = lastSentSeq();
        if (seq >= 0) storeSeq(room, seq);
      };
      document.addEventListener('visibilitychange', persist);
      const wake = (): void => {
        const locks = navigator.wakeLock;
        if (locks === undefined) return;
        void locks.request('screen').catch(() => undefined);
      };
      document.addEventListener('pointerdown', wake, { passive: true, once: true });
      link = connectPhone(room, {
        onJoined: (next) => {
          joinPending = false;
          window.clearTimeout(joinTimer);
          setJoined(true);
          knownSlot = next.index;
          setSlot(next.index);
          setColor(next.color);
          publishTier();
          if (next.name !== '') setName(next.name);
          setNotice('');
        },
        onFull: () => {
          joinPending = false;
          window.clearTimeout(joinTimer);
          setNotice('CANNOT JOIN, ROOM IS ALREADY FULL (8 PLAYERS)');
        },
        onKicked: () => {
          joinPending = false;
          window.clearTimeout(joinTimer);
          knownSlot = -1;
          setJoined(false);
          setSlot(-1);
          setColor('var(--theme-yellow)');
          setGameId('');
          setTheme({});
          setControl(null);
          setNotice('TYPE YOUR NAME AND TAP JOIN');
        },
        onMount: (id) => {
          setTheme(localTheme(id));
          setGameId(id);
        },
        onPhase: (phase) => {
          if (phase !== 'lobby') return;
          setGameId('');
          setTheme({});
          setControl(null);
        },
        onControl: (type, payload) => {
          setControl({ type, payload });
        },
        onPong: (sent, received) => {
          if (samples === 0) {
            firstSent = sent;
            firstRecv = received;
            setRttMs(received - sent);
            samples = 1;
            return;
          }
          if (samples >= 2) return;
          let aSent = firstSent;
          let aRecv = firstRecv;
          let bSent = sent;
          let bRecv = received;
          if (sent < firstSent) {
            aSent = sent;
            aRecv = received;
            bSent = firstSent;
            bRecv = firstRecv;
          }
          setJitterMs(rfc3550Jitter(aSent, aRecv, bSent, bRecv));
          setRttMs(bRecv - bSent);
          samples = 2;
        },
        onLink: (up) => {
          if (!up) setNotice('LINK // DOWN');
          else if (!joinPending) {
            setNotice((current) => (current === 'LINK // DOWN' ? '' : current));
          }
        },
      });
      return () => {
        window.clearTimeout(joinTimer);
        window.cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', persist);
        const seq = lastSentSeq();
        if (seq >= 0) storeSeq(room, seq);
        link?.close();
      };
    },
  );

  const view = (): VoidComponent<ControllerViewProps> | null => {
    const id = gameId();
    if (id === '') return null;
    return controllerView(id);
  };

  const supportedOrientations = () => {
    const id = gameId();
    return id === '' ? undefined : controllerSupportedOrientations(id);
  };

  function onOrientationChange(next: OrientationPreference): void {
    if (view() !== null) return;
    setLayoutPref(next);
    writeStoredOrientationPref(next);
  }

  function onJoin(pressed: boolean): void {
    if (!pressed || joined()) return;
    const current = link;
    current?.reconnect();
    const token = storedToken(room);
    const payload: { name: string; sessionToken?: string } = {
      name: name().trim().slice(0, 16),
    };
    if (token !== null) payload.sessionToken = token;
    const result = current === undefined ? 'missing' : current.sendText({ type: 'room:join', payload });
    joinPending = true;
    setNotice(joinNotice(result));
    window.clearTimeout(joinTimer);
    joinTimer = window.setTimeout(() => {
      if (!joined()) setNotice('LINK // DOWN');
    }, 2000);
  }

  const shellStyle = (): ThemeVars => {
    if (!joined() || slot() < 0) return theme();
    return { ...theme(), ...playerStyleVars(slot(), color()) };
  };

  return (
    <ControllerStage
      pref={layoutPref()}
      supportedOrientations={supportedOrientations()}
      joined={joined()}
      style={shellStyle()}
      onResolved={(resolved) => setOrientationOk(resolved.supported)}
    >
      <div class="top-bar">
        <header class="mast">
          <p class="room-code">
            {room === '' ? '----' : room}
            <span class="rev">REV {CONTROLLER_REV}</span>
          </p>
        </header>
        <OrientationToggle
          value={layoutPref()}
          disabled={view() !== null}
          onChange={onOrientationChange}
        />
        <PreflightStrip
          power={power()}
          powerReady={powerReady()}
          cores={cores()}
          rttMs={rttMs()}
          jitterMs={jitterMs()}
          orientationOk={orientationOk()}
        />
      </div>
      <Show when={notice() !== ''}>
        <p class="notice">{notice()}</p>
      </Show>
      <Show when={view() === null}>
        <section class="lobby-board">
          <header class="lobby-status">
            <PlayerBadge
              name={name().trim() === '' ? 'OPEN' : name().trim()}
              label={slot() < 0 ? 'P-' : `P${slot() + 1}`}
            />
            <Show
              when={!joined() && room !== ''}
              fallback={<GameCard title="NO GAME" detail="WAITING" />}
            >
              <div class="join-row">
                <input
                  class="name-field"
                  placeholder="NAME"
                  maxlength={16}
                  autocomplete="off"
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
                <ArcadeButton
                  label="JOIN"
                  onPressedChange={onJoin}
                />
              </div>
            </Show>
          </header>
          <div class="controller-hands lobby-hands">
            <VirtualJoystick label="MOVE" onAxes={sendAxes} />
            <div class="lobby-right">
              <SwipeZone label="SWIPE" />
              <div class="lobby-actions">
                <ArcadeButton label="BUTTON" onPressedChange={sendButton} />
                <ArcadeButton
                  label="STATUS"
                  onPressedChange={(pressed) => {
                    if (!pressed) setModal(true);
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      </Show>
      <Show when={view()} keyed>
        {(Active) => (
          <Active
            color={color()}
            name={name()}
            slot={slot()}
            control={control()}
            onAxes={sendAxes}
            onButton={sendButton}
          />
        )}
      </Show>
      <HudModal
        open={modal()}
        title="PRE-FLIGHT"
        body={modalBody(cores(), powerReady(), power())}
        onClose={() => setModal(false)}
      />
    </ControllerStage>
  );
};

function modalBody(cores: number, ready: boolean, power: 'ok' | 'low-power'): string {
  const coreText = cores < 0 ? '--' : String(cores);
  const powerText = !ready ? 'POWER --' : power === 'low-power' ? 'LOW POWER' : 'POWER OK';
  const tier = tierFor({ power: ready && power === 'low-power' ? 'low-power' : 'ok', cores });
  const send = tier === '30' ? 'SEND 30HZ' : 'SEND 60HZ';
  return `CORES ${coreText} // ${powerText}. ${send}.`;
}
