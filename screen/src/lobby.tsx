import { createSignal, For, Show, type VoidComponent } from 'solid-js';
import { playerStyleVars } from '../../shared/src/theme.ts';
import type { GameManifest, PlayerSlot } from '../../shared/src/types/game.ts';
import { kickButtonLabel, playerDisplayName } from './lobby-kick.ts';

export const Lobby: VoidComponent<{
  roomId: string;
  qrUrl: string;
  notice: string;
  sdpWarning: boolean;
  players: PlayerSlot[];
  games: readonly GameManifest[];
  selectedId: string;
  startEnabled: boolean;
  botCount: number;
  botControlEnabled: boolean;
  botNotice: string;
  canKick?: boolean;
  onBotStep: (delta: -1 | 1) => void;
  onQr: (canvas: HTMLCanvasElement) => void;
  onSelect: (id: string) => void;
  onStart: () => void;
  onKick?: (index: number) => void;
}> = (props) => {
  const [pressed, setPressed] = createSignal(false);

  return (
    <main class="lobby">
      <p class="eyebrow">ROOM</p>
      <p class="code">{props.roomId}</p>
      <Show when={props.notice !== ''}>
        <p class="notice">{props.notice}</p>
      </Show>
      <Show when={props.sdpWarning}>
        <p class="notice">SDP // NO LAN CANDIDATE</p>
      </Show>
      <canvas
        ref={(el) => props.onQr(el)}
        class="qr"
        width={280}
        height={280}
      />
      <p class="url">{props.qrUrl}</p>
      <p class="hint">PHONE // TURN ON ROTATION LOCK FOR LANDSCAPE</p>
      <section class="panel">
        <h2>PLAYERS</h2>
        <ul class="players">
          <For each={props.players}>
            {(player) => (
              <li class="player" style={playerStyleVars(player.index, player.color)}>
                <span class="swatch" />
                <span class="mono">{playerDisplayName(player.name)}</span>
                <span class="mono">{player.connected ? 'LIVE' : 'AWAY'}</span>
                <Show when={props.canKick === true && props.onKick !== undefined}>
                  <button
                    type="button"
                    class="player-kick"
                    aria-label={kickButtonLabel(player.name)}
                    title="Remove player"
                    onClick={() => props.onKick?.(player.index)}
                  >
                    ×
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </section>
      <section class="panel">
        <h2>GAMES</h2>
        <Show when={props.games.length > 0} fallback={<p class="mono">GAMES // NONE</p>}>
          <div class="carousel">
            <For each={props.games}>
              {(game) => (
                <button
                  type="button"
                  class="key game-key"
                  data-selected={props.selectedId === game.id ? 'true' : 'false'}
                  data-pressed={props.selectedId === game.id ? 'true' : 'false'}
                  onClick={() => props.onSelect(game.id)}
                >
                  {game.title}
                </button>
              )}
            </For>
          </div>
        </Show>
      </section>
      <Show when={props.games.find((game) => game.id === props.selectedId)?.supportsBots === true}>
        <section class="panel">
          <h2>BOTS</h2>
          <div class="carousel bot-stepper">
            <button
              type="button"
              class="key"
              disabled={!props.botControlEnabled}
              onClick={() => {
                if (!props.botControlEnabled) return;
                props.onBotStep(-1);
              }}
            >
              -
            </button>
            <span class="mono bot-count">{props.botCount}</span>
            <button
              type="button"
              class="key"
              disabled={!props.botControlEnabled}
              onClick={() => {
                if (!props.botControlEnabled) return;
                props.onBotStep(1);
              }}
            >
              +
            </button>
          </div>
          <Show when={props.botNotice !== ''}>
            <p class="notice">{props.botNotice}</p>
          </Show>
        </section>
      </Show>
      <button
        type="button"
        class="key start"
        disabled={!props.startEnabled}
        data-pressed={pressed() ? 'true' : 'false'}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onClick={() => props.onStart()}
      >
        START
      </button>
    </main>
  );
};
