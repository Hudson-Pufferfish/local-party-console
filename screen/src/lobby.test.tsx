import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import type { PlayerSlot } from '../../shared/src/types/game.ts';
import { Lobby } from './lobby.tsx';
import { kickRequestFor } from './lobby-kick.ts';

test('lobby renders the kick button on both LIVE and AWAY cards when canKick is true', () => {
  const players: PlayerSlot[] = [
    { index: 0, name: 'Ada', color: '#FF4D00', teamId: null, connected: true },
    { index: 1, name: 'Bea', color: '#00C853', teamId: null, connected: false },
  ];
  const baseProps = {
    roomId: 'ABCD',
    qrUrl: 'https://10.0.0.1:8443/controller?rev=10&room=ABCD',
    notice: '',
    sdpWarning: false,
    players,
    games: [],
    selectedId: '',
    startEnabled: false,
    botCount: 0,
    botControlEnabled: false,
    botNotice: '',
    onBotStep() {},
    onQr() {},
    onSelect() {},
    onStart() {},
    onKick() {},
  };

  const primaryHtml = renderToString(() => <Lobby {...baseProps} canKick={true} />);
  const kickMatches = primaryHtml.match(/class="player-kick"/g) ?? [];
  expect(kickMatches).toHaveLength(2);
  expect(primaryHtml).toContain('type="button"');
  expect(primaryHtml).toContain('aria-label="Remove Ada"');
  expect(primaryHtml).toContain('aria-label="Remove Bea"');
  expect(primaryHtml).toContain('title="Remove player"');

  const secondaryHtml = renderToString(() => <Lobby {...baseProps} canKick={false} />);
  expect(secondaryHtml).not.toContain('class="player-kick"');
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
