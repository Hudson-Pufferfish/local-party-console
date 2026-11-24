import { createEffect, createMemo, createSignal, Show, type VoidComponent } from 'solid-js';
import type { PlayerSlot } from '../../shared/src/types/game.ts';
import { Badge } from './badge.tsx';
import {
  createBotLobby,
  rosterForStart,
  startBlockReason,
  startNotice,
  type BotLobbyState,
} from './bot-fill.ts';
import { Lobby } from './lobby.tsx';
import { listScreenManifests, screenGames } from './register-games.ts';
import { readScreenView, startSession, type ScreenSession } from './session.ts';
import { Standby } from './standby.tsx';

export const App: VoidComponent = () => {
  const [roomId, setRoomId] = createSignal('');
  const [qrUrl, setQrUrl] = createSignal('');
  const [players, setPlayers] = createSignal<PlayerSlot[]>([]);
  const [primary, setPrimary] = createSignal(false);
  const [sdpWarning, setSdpWarning] = createSignal(false);
  const [standby, setStandby] = createSignal<string | null>(null);
  const [match, setMatch] = createSignal(false);
  const [matchOver, setMatchOver] = createSignal(false);
  const [notice, setNotice] = createSignal('');
  const [selectedId, setSelectedId] = createSignal('');
  const [botLobby, setBotLobby] = createSignal<BotLobbyState>(createBotLobby());
  const games = listScreenManifests();
  const view = readScreenView(new URLSearchParams(location.search).get('view'));
  const themeKeys: string[] = [];
  const canvases = {
    qr: null as HTMLCanvasElement | null,
    match: null as HTMLCanvasElement | null,
  };
  let session: ScreenSession | undefined;
  createEffect(
    () => undefined,
    () => {
      session = startSession({
        setRoomId,
        setQrUrl,
        setPlayers,
        setPrimary,
        setSdpWarning,
        setStandby,
        setMatch,
        setMatchOver,
        setNotice,
        setSelectedId,
        setBotLobby,
      });
      if (canvases.qr !== null) session.attachQr(canvases.qr);
      if (canvases.match !== null) session.attachMatch(canvases.match);
      return () => session?.stop();
    },
  );
  createEffect(
    () => selectedId(),
    (id) => {
      const root = document.documentElement;
      for (const key of themeKeys) root.style.removeProperty(key);
      themeKeys.length = 0;
      if (id === '') return;
      const tokens = screenGames.get(id)?.manifest.themeTokens;
      if (tokens === undefined) return;
      for (const [key, value] of Object.entries(tokens)) {
        if (!key.startsWith('--') || typeof value !== 'string') continue;
        root.style.setProperty(key, value);
        themeKeys.push(key);
      }
    },
  );

  const connectedHumans = createMemo(() => {
    let count = 0;
    for (const player of players()) {
      if (player.connected) count += 1;
    }
    return count;
  });

  const selectedGame = createMemo(() => games.find((item) => item.id === selectedId()));

  const startEnabled = createMemo(() => {
    const game = selectedGame();
    if (game === undefined || !primary()) return false;
    return rosterForStart(players(), game, botLobby().botCount) !== null;
  });

  const botNotice = createMemo(() => {
    const game = selectedGame();
    if (game === undefined) return '';
    return startNotice(startBlockReason({
      humans: connectedHumans(),
      bots: botLobby().botCount,
      minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers,
      supportsBots: game.supportsBots,
    }));
  });

  return (
    <>
      <Badge view={view} />
      <Show
        when={standby()}
        fallback={
          <Show
            when={match()}
            fallback={
              <Lobby
                roomId={roomId()}
                qrUrl={qrUrl()}
                notice={notice()}
                sdpWarning={sdpWarning()}
                players={players()}
                games={games}
                selectedId={selectedId()}
                startEnabled={startEnabled()}
                botCount={botLobby().botCount}
                botControlEnabled={selectedGame()?.supportsBots === true && connectedHumans() > 0}
                botNotice={botNotice()}
                onBotStep={(delta) => session?.setBotCount(botLobby().botCount + delta)}
                onQr={(canvas) => {
                  canvases.qr = canvas;
                  session?.attachQr(canvas);
                }}
                onSelect={(id) => session?.selectGame(id)}
                onStart={() => session?.start()}
              />
            }
          >
            <section class="match">
              <canvas
                ref={(canvas) => {
                  canvases.match = canvas;
                  session?.attachMatch(canvas);
                }}
                width={800}
                height={800}
              />
              <Show when={primary() && matchOver()}>
                <div class="podium">
                  <button type="button" class="key" onClick={() => session?.playAgain()}>
                    PLAY AGAIN
                  </button>
                  <button type="button" class="key" onClick={() => session?.returnToLobby()}>
                    RETURN TO LOBBY
                  </button>
                </div>
              </Show>
            </section>
          </Show>
        }
      >
        {(copy) => <Standby copy={copy()} />}
      </Show>
    </>
  );
};
