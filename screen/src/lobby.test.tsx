import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import type { PlayerSlot } from '../../shared/src/types/game.ts';
import { Lobby } from './lobby.tsx';
import { kickRequestFor } from './lobby-kick.ts';

test('lobby renders player color CSS vars, kick buttons on LIVE/AWAY cards, and yellow selected game key', () => {
  const players: PlayerSlot[] = [
    { index: 0, name: 'Ada', color: '#FF4D00', teamId: null, connected: true },
    { index: 1, name: 'Bea', color: '#00C853', teamId: null, connected: false },
    { index: 6, name: 'Cid', color: '#111111', teamId: null, connected: true },
  ];
  const games = [
    {
      id: 'sumo-dash',
      title: 'SUMO DASH',
      minPlayers: 2,
      maxPlayers: 8,
      supportsTeams: false,
      maxTeams: 0,
      supportsBots: true,
      rendererType: 'phaser-2d' as const,
      viewConfig: { mode: 'holistic' as const, inputBufferMode: 'zero-buffer' as const },
      themeTokens: {},
    },
  ];
  const baseProps = {
    roomId: 'ABCD',
    qrUrl: 'https://10.0.0.1:8443/controller?rev=0.0.1&room=ABCD',
    notice: '',
    sdpWarning: false,
    players,
    games,
    selectedId: 'sumo-dash',
    startEnabled: true,
    botCount: 0,
    botControlEnabled: true,
    botNotice: '',
    onBotStep() {},
    onQr() {},
    onSelect() {},
    onStart() {},
    onKick() {},
  };

  const primaryHtml = renderToString(() => <Lobby {...baseProps} canKick={true} />);
  const kickMatches = primaryHtml.match(/class="player-kick"/g) ?? [];
  expect(kickMatches).toHaveLength(3);
  expect(primaryHtml).toContain('type="button"');
  expect(primaryHtml).toContain('aria-label="Remove Ada"');
  expect(primaryHtml).toContain('aria-label="Remove Bea"');
  expect(primaryHtml).toContain('aria-label="Remove Cid"');
  expect(primaryHtml).toContain('title="Remove player"');
  expect(primaryHtml).toContain('--player-color:var(--player-1, #FF4D00)');
  expect(primaryHtml).toContain('--player-ink:var(--player-1-ink, #111111)');
  expect(primaryHtml).toContain('--player-color:var(--player-7, #111111)');
  expect(primaryHtml).toContain('--player-ink:var(--player-7-ink, #F4F1EA)');
  expect(primaryHtml).toContain('class="key game-key"');
  expect(primaryHtml).toContain('data-selected="true"');
  expect(primaryHtml).toContain('class="qr-prompt"');
  expect(primaryHtml).toContain('SCAN QR TO JOIN THE GAME');
  expect(primaryHtml.indexOf('class="code"')).toBeLessThan(primaryHtml.indexOf('SCAN QR TO JOIN THE GAME'));
  expect(primaryHtml.indexOf('SCAN QR TO JOIN THE GAME')).toBeLessThan(primaryHtml.indexOf('class="qr"'));
  expect(primaryHtml).toContain('class="hint"');
  expect(primaryHtml).toContain('REMINDER:');
  expect(primaryHtml).toContain('Keep phone rotation locked ON');
  expect(primaryHtml).toContain('Pick Vertical or Horizontal on phone before Start');
  expect(primaryHtml).toContain('class="lobby-col lobby-room"');
  expect(primaryHtml).toContain('class="lobby-col lobby-setup"');
  expect(primaryHtml).toContain('class="lobby-col lobby-players"');
  expect(primaryHtml.indexOf('lobby-room')).toBeLessThan(primaryHtml.indexOf('lobby-setup'));
  expect(primaryHtml.indexOf('lobby-setup')).toBeLessThan(primaryHtml.indexOf('lobby-players'));

  const loadingHtml = renderToString(() => <Lobby {...baseProps} canKick={true} starting={true} />);
  expect(loadingHtml).toContain('LOADING...');
  expect(loadingHtml).toContain('disabled');

  const layoutCss = fs.readFileSync(path.resolve(import.meta.dirname, '../../shared/src/ui/layout.css'), 'utf8');
  for (const token of ['--lobby-max-w', '--page-pad', '--grid-gap', '--panel-pad', '--qr-size', '--arena-size']) {
    expect(layoutCss).toContain(`${token}:`);
  }
  expect(layoutCss).toContain('min(1360px, 100%)');

  const lobbyCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/lobby.css'), 'utf8');
  const kickBlock = lobbyCss.match(/\.player-kick\s*\{[^}]*background:[^}]*\}/)?.[0] ?? '';
  const kickHoverBlock = lobbyCss.match(/\.player-kick:hover\s*\{[^}]*\}/)?.[0] ?? '';
  const gameSelectedBlock = lobbyCss.match(/\.game-key\[data-selected="true"\]\s*\{[^}]*\}/)?.[0] ?? '';
  const startBlock = lobbyCss.match(/\.start\s*\{[^}]*\}/)?.[0] ?? '';
  const qrPromptBlock = lobbyCss.match(/\.qr-prompt\s*\{[^}]*\}/)?.[0] ?? '';
  expect(kickBlock).toContain('var(--player-color');
  expect(kickBlock).toContain('var(--player-ink');
  expect(kickHoverBlock).toContain('var(--player-color');
  expect(kickHoverBlock).not.toContain('--theme-yellow');
  expect(gameSelectedBlock).toContain('background: var(--theme-yellow)');
  expect(startBlock).toContain('background: var(--theme-yellow)');
  expect(qrPromptBlock).toContain('text-transform: uppercase');
  expect(lobbyCss).toContain('max-width: var(--lobby-max-w)');
  expect(lobbyCss).toContain('repeat(3, minmax(0, 1fr))');
  expect(lobbyCss).toContain('repeat(2, minmax(0, 1fr))');
  expect(lobbyCss).toContain('overflow-wrap: anywhere');

  const secondaryHtml = renderToString(() => <Lobby {...baseProps} canKick={false} />);
  expect(secondaryHtml).not.toContain('class="player-kick"');
});

test('lobby renders BotDifficultySelector under BOTS when supportsBots is true, defaults to MED, and switches cleanly', () => {
  const games = [
    {
      id: 'sumo-dash',
      title: 'SUMO DASH',
      minPlayers: 2,
      maxPlayers: 8,
      supportsTeams: false,
      maxTeams: 0,
      supportsBots: true,
      rendererType: 'phaser-2d' as const,
      viewConfig: { mode: 'holistic' as const, inputBufferMode: 'zero-buffer' as const },
      themeTokens: {},
    },
    {
      id: 'human-only',
      title: 'HUMAN ONLY',
      minPlayers: 2,
      maxPlayers: 8,
      supportsTeams: false,
      maxTeams: 0,
      supportsBots: false,
      rendererType: 'phaser-2d' as const,
      viewConfig: { mode: 'holistic' as const, inputBufferMode: 'zero-buffer' as const },
      themeTokens: {},
    },
  ];
  const baseProps = {
    roomId: 'ABCD',
    qrUrl: 'https://10.0.0.1:8443/controller?rev=0.0.0&room=ABCD',
    notice: '',
    sdpWarning: false,
    players: [{ index: 0, name: 'Ada', color: '#FF4D00', teamId: null, connected: true }],
    games,
    selectedId: 'sumo-dash',
    startEnabled: true,
    botCount: 2,
    botControlEnabled: true,
    botNotice: '',
    canKick: true,
    onBotStep() {},
    onBotDifficulty() {},
    onQr() {},
    onSelect() {},
    onStart() {},
    onKick() {},
  };

  const defaultHtml = renderToString(() => <Lobby {...baseProps} />);
  expect(defaultHtml).toContain('role="group"');
  expect(defaultHtml).toContain('aria-label="Bot difficulty"');
  expect(defaultHtml.indexOf('bot-stepper')).toBeLessThan(defaultHtml.indexOf('bot-difficulty'));
  expect(defaultHtml).toContain('data-difficulty="easy" data-active="false" aria-pressed="false"');
  expect(defaultHtml).toContain('data-difficulty="medium" data-active="true" aria-pressed="true"');
  expect(defaultHtml).toContain('data-difficulty="hard" data-active="false" aria-pressed="false"');
  expect(defaultHtml).toContain('>EASY<');
  expect(defaultHtml).toContain('>MED<');
  expect(defaultHtml).toContain('>HARD<');
  expect(defaultHtml).toContain('data-disabled="false"');

  const hardHtml = renderToString(() => <Lobby {...baseProps} botDifficulty="hard" />);
  expect(hardHtml).toContain('data-difficulty="hard" data-active="true" aria-pressed="true"');
  expect(hardHtml).toContain('data-difficulty="medium" data-active="false" aria-pressed="false"');

  const easyHtml = renderToString(() => <Lobby {...baseProps} botDifficulty="easy" />);
  expect(easyHtml).toContain('data-difficulty="easy" data-active="true" aria-pressed="true"');

  const zeroBotsHtml = renderToString(() => <Lobby {...baseProps} botCount={0} />);
  expect(zeroBotsHtml).toContain('data-disabled="true"');

  const secondaryHtml = renderToString(() => <Lobby {...baseProps} canKick={false} />);
  expect(secondaryHtml).toContain('data-disabled="true"');

  const noBotsGameHtml = renderToString(() => <Lobby {...baseProps} selectedId="human-only" />);
  expect(noBotsGameHtml).not.toContain('aria-label="Bot difficulty"');

  const primitivesCss = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../shared/src/ui/primitives.css'),
    'utf8',
  );
  const activeBlock = primitivesCss.match(/\.bot-difficulty-btn\[data-active='true'\]\s*\{[^}]*\}/)?.[0] ?? '';
  expect(activeBlock).toContain('var(--theme-yellow');
  expect(activeBlock).toContain('var(--ink');
  expect(primitivesCss).toContain('.bot-difficulty-btn');
});

test('kickRequestFor dispatches room:kick for LIVE or AWAY players only in primary lobby', () => {
  const players: PlayerSlot[] = [
    { index: 0, name: 'Ada', color: '#FF4D00', teamId: null, connected: true },
    { index: 1, name: 'Bea', color: '#00C853', teamId: null, connected: false },
  ];

  expect(kickRequestFor(players, 0, true, false)).toEqual({
    type: 'room:kick',
    payload: { index: 0 },
  });
  expect(kickRequestFor(players, 1, true, false)).toEqual({
    type: 'room:kick',
    payload: { index: 1 },
  });
  expect(kickRequestFor(players, 0, false, false)).toBeNull();
  expect(kickRequestFor(players, 0, true, true)).toBeNull();
  expect(kickRequestFor(players, 1, true, true)).toBeNull();
  expect(kickRequestFor(players, 7, true, false)).toBeNull();
});
