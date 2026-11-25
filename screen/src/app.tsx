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
import { MatchExitControl } from './match-exit.tsx';
import { installPointerGuard } from './pointer-guard.ts';
import {
  listScreenManifests,
  screenGames,
  type ScoreRow,
  type ScoreRules,
} from './register-games.ts';
import { ScoreboardPanel, ScoreRulesPanel } from './score-rules.tsx';
import { readScreenView, startSession, type ScreenSession } from './session.ts';
import { Standby } from './standby.tsx';
import { TabHud } from './telemetry/tab-hud.tsx';

export const App: VoidComponent = () => {
  const [roomId, setRoomId] = createSignal('');
  const [qrUrl, setQrUrl] = createSignal('');
  const [players, setPlayers] = createSignal<PlayerSlot[]>([]);
  const [primary, setPrimary] = createSignal(false);
  const [sdpWarning, setSdpWarning] = createSignal(false);
  const [standby, setStandby] = createSignal<string | null>(null);
  const [match, setMatch] = createSignal(false);
  const [matchOver, setMatchOver] = createSignal(false);
  const [scoreHeader, setScoreHeader] = createSignal('');
  const [scoreRows, setScoreRows] = createSignal<ScoreRow[]>([]);
  const [scoreRules, setScoreRules] = createSignal<ScoreRules | null>(null);
  const [banner, setBanner] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [selectedId, setSelectedId] = createSignal('');
  const [botLobby, setBotLobby] = createSignal<BotLobbyState>(createBotLobby());
  const [starting, setStarting] = createSignal(false);
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
      const stopGuard = installPointerGuard(document);
      session = startSession({
        setRoomId,
        setQrUrl,
        setPlayers,
        setPrimary,
        setSdpWarning,
        setStandby,
        setMatch,
        setMatchOver,
        setScoreHeader,
        setScoreRows,
        setScoreRules,
        setBanner,
        setNotice,
        setSelectedId,
        setBotLobby,
        setStarting,
      });
      if (canvases.qr !== null) session.attachQr(canvases.qr);
      if (canvases.match !== null) session.attachMatch(canvases.match);
      return () => {
        stopGuard();
        session?.stop();
      };
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
    if (game === undefined || !primary() || starting()) return false;
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
      <TabHud
        primary={primary()}
        players={players()}
        read={(slot) => session?.readTelemetry(slot) ?? null}
      />
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
                starting={starting()}
                botCount={botLobby().botCount}
                botDifficulty={botLobby().difficulty}
                botControlEnabled={selectedGame()?.supportsBots === true && connectedHumans() > 0}
                botNotice={botNotice()}
                canKick={primary()}
                onBotStep={(delta) => session?.setBotCount(botLobby().botCount + delta)}
                onBotDifficulty={(difficulty) => session?.setBotDifficulty(difficulty)}
                onQr={(canvas) => {
                  canvases.qr = canvas;
                  session?.attachQr(canvas);
                }}
                onSelect={(id) => session?.selectGame(id)}
                onStart={() => session?.start()}
                onKick={(index) => session?.kickPlayer(index)}
              />
            }
          >
            <section class="match" data-game={selectedId()}>
              <MatchExitControl
                primary={primary()}
                match={match()}
                manifest={selectedGame()}
                onConfirm={() => session?.resetLobby()}
              />
              <p class="hud">{banner()}</p>
              <Show when={scoreRules()}>
                {(rules) => <ScoreRulesPanel rules={rules()} />}
              </Show>
              <canvas
                ref={(canvas) => {
                  canvases.match = canvas;
                  session?.attachMatch(canvas);
                }}
                width={800}
                height={800}
              />
              <ScoreboardPanel header={scoreHeader()} rows={scoreRows()} />
              <Show when={primary() && matchOver()}>
                <div class="podium">
                  <button type="button" class="key" onClick={() => session?.playAgain()}>
                    PLAY AGAIN
                  </button>
                  <button type="button" class="key" onClick={() => session?.resetLobby()}>
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
