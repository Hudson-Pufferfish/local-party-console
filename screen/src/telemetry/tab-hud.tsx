import { createEffect, createSignal, For, Show, type VoidComponent } from 'solid-js';
import type { PlayerSlot } from '../../../shared/src/types/game.ts';
import type { TelemetryRead } from './ingest.ts';
import './tab-hud.css';

interface HudRow extends TelemetryRead {
  index: number;
  name: string;
  teamId: number | null;
}

export const TabHud: VoidComponent<{
  primary: boolean;
  players: readonly PlayerSlot[];
  read: (slot: number) => TelemetryRead | null;
}> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [fps, setFps] = createSignal(0);
  const [rows, setRows] = createSignal<HudRow[]>([]);
  let timer = 0;
  let raf = 0;
  let frames = 0;
  let frameStart = 0;

  function stopPaint(): void {
    if (timer !== 0) window.clearInterval(timer);
    if (raf !== 0) window.cancelAnimationFrame(raf);
    timer = 0;
    raf = 0;
  }

  function sample(): void {
    const next: HudRow[] = [];
    for (const player of props.players) {
      if (!player.connected) continue;
      const row = props.read(player.index);
      if (row === null) continue;
      next.push({
        index: player.index,
        name: player.name,
        teamId: player.teamId,
        hz: row.hz,
        tier: row.tier,
        lowPower: row.lowPower,
        cores: row.cores,
        touchMs: row.touchMs,
        netP50: row.netP50,
        netP99: row.netP99,
        jitter: row.jitter,
        lossPct: row.lossPct,
        longTasks: row.longTasks,
        transport: row.transport,
        hasOffset: row.hasOffset,
      });
    }
    setRows(next);
  }

  function startPaint(): void {
    stopPaint();
    frames = 0;
    frameStart = performance.now();
    const loop = (now: number): void => {
      frames += 1;
      if (now - frameStart >= 1000) {
        setFps(Math.round((frames * 1000) / (now - frameStart)));
        frames = 0;
        frameStart = now;
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    sample();
    timer = window.setInterval(sample, 250);
  }

  createEffect(
    () => undefined,
    () => {
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          setOpen(false);
          stopPaint();
          return;
        }
        if (event.key !== 'Tab') return;
        event.preventDefault();
        const next = !open();
        setOpen(next);
        if (next) startPaint();
        else stopPaint();
      };
      window.addEventListener('keydown', onKey);
      return () => {
        window.removeEventListener('keydown', onKey);
        stopPaint();
      };
    },
  );

  return (
    <Show when={open()}>
      <aside class="tab-hud">
        <p>VIEWPORTS: THIS {fps()}fps | OTHERS —</p>
        <p>VIEWPORT SYNC: TICK DELTA — | CLOCK SKEW — | DISPLAYLINK COMP +0ms | FLIGHT REC —</p>
        <Show when={props.primary} fallback={<p>PHONE TELEMETRY AVAILABLE ON PRIMARY TAB ONLY</p>}>
          <For each={rows()}>{(row) => <p>{line(row)}</p>}</For>
        </Show>
      </aside>
    </Show>
  );
};

function line(row: HudRow) {
  const team = row.teamId === null ? '-' : String(row.teamId);
  const name = row.name === '' ? 'PLAYER' : row.name;
  const transport = row.transport === 'dc' ? 'UDP-DIRECT' : row.transport === 'ws' ? 'WS-FALLBACK' : 'IDLE';
  const tier = row.lowPower || row.tier === '30' ? '[ULP/LOW-POWER]' : '[TIER 60]';
  const net = row.hasOffset && row.netP50 !== null && row.netP99 !== null
    ? `${formatNum(row.netP50)}/${formatNum(row.netP99)}/${formatNum(row.jitter)}ms`
    : '—';
  const touchHot = row.touchMs >= 12;
  const netHot = row.netP99 !== null && row.netP99 >= 15;
  const lossHot = row.lossPct > 0;
  return (
    <>
      <span>{`P${row.index + 1} [T${team}] ${name} | ${transport} | Hz: ${row.hz} ${tier} | `}</span>
      <span class={touchHot ? 'tab-hot' : ''}>{`Touch: ${formatNum(row.touchMs)}ms`}</span>
      <span> | Net p50/p99/J: </span>
      <span class={netHot ? 'tab-hot' : ''}>{net}</span>
      <span> | Loss: </span>
      <span class={lossHot ? 'tab-hot' : ''}>{`${formatNum(row.lossPct)}%`}</span>
      <span>{` | LongTasks: ${row.longTasks}`}</span>
    </>
  );
}

function formatNum(value: number): string {
  return String(Math.round(value * 10) / 10);
}
