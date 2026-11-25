import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { expect, test, vi } from 'vitest';
import type { GameManifest } from '../../shared/src/types/game.ts';
import {
  MatchExitControl,
  canShowMatchExit,
  isSingleScreenGame,
  reduceMatchExit,
  type MatchExitState,
} from './match-exit.tsx';

const HOLISTIC_MANIFEST: GameManifest = {
  id: 'sumo-dash',
  title: 'SUMO DASH',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: false,
  maxTeams: 0,
  supportsBots: true,
  rendererType: 'phaser-2d',
  viewConfig: { mode: 'holistic', inputBufferMode: 'zero-buffer' },
  themeTokens: {},
};

const MULTISCREEN_MANIFEST: GameManifest = {
  id: 'team-duel',
  title: 'TEAM DUEL',
  minPlayers: 2,
  maxPlayers: 8,
  supportsTeams: true,
  maxTeams: 2,
  supportsBots: false,
  rendererType: 'three-3d',
  viewConfig: {
    mode: 'team-exclusive',
    requiredTeams: 2,
    allowHolisticSpectator: false,
    inputBufferMode: 'zero-buffer',
  },
  themeTokens: {},
};

function renderExit(state: MatchExitState, onConfirm: () => void): string {
  return renderToString(() => (
    <MatchExitControl
      primary={state.primary}
      match={state.match}
      manifest={state.manifest}
      confirmOpen={state.confirmOpen}
      onConfirm={onConfirm}
    />
  ));
}

test('holistic game renders (x) exit button and clicking it opens confirmation modal with exact prompt', () => {
  expect(isSingleScreenGame(HOLISTIC_MANIFEST)).toBe(true);
  expect(canShowMatchExit(true, true, HOLISTIC_MANIFEST)).toBe(true);

  const returnToLobby = vi.fn();
  let state: MatchExitState = {
    primary: true,
    match: true,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };

  const initialHtml = renderExit(state, returnToLobby);
  expect(initialHtml).toContain('class="match-exit"');
  expect(initialHtml).toContain('type="button"');
  expect(initialHtml).toContain('>×<');
  expect(initialHtml).not.toContain('role="dialog"');

  state = reduceMatchExit(state, { type: 'open' });
  expect(state.confirmOpen).toBe(true);

  const openHtml = renderExit(state, returnToLobby);
  expect(openHtml).toContain('role="dialog"');
  expect(openHtml).toContain('aria-modal="true"');
  expect(openHtml).toContain('QUIT MATCH?');
  expect(openHtml).toContain('Are you sure to end the current game and quit to the lobby?');
  expect(openHtml).toContain('>CANCEL<');
  expect(openHtml).toContain('>QUIT TO LOBBY<');
});

test('clicking CANCEL closes the confirmation modal without calling returnToLobby', () => {
  const returnToLobby = vi.fn();
  let state: MatchExitState = {
    primary: true,
    match: true,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };

  state = reduceMatchExit(state, { type: 'open' });
  expect(state.confirmOpen).toBe(true);

  state = reduceMatchExit(state, { type: 'cancel' });
  expect(state.confirmOpen).toBe(false);
  expect(state.match).toBe(true);
  expect(returnToLobby).not.toHaveBeenCalled();

  const afterCancelHtml = renderExit(state, returnToLobby);
  expect(afterCancelHtml).toContain('class="match-exit"');
  expect(afterCancelHtml).not.toContain('role="dialog"');
});

test('clicking QUIT TO LOBBY calls returnToLobby, transitions back to lobby, and keeps modal closed next match', () => {
  let inMatch = true;
  const returnToLobby = vi.fn(() => {
    inMatch = false;
  });
  let state: MatchExitState = {
    primary: true,
    match: inMatch,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };

  state = reduceMatchExit(state, { type: 'open' });
  expect(state.confirmOpen).toBe(true);

  state = reduceMatchExit(state, { type: 'confirm' }, returnToLobby);
  state = reduceMatchExit(state, {
    type: 'sync',
    primary: true,
    match: inMatch,
    manifest: HOLISTIC_MANIFEST,
  });

  expect(returnToLobby).toHaveBeenCalledTimes(1);
  expect(inMatch).toBe(false);
  expect(state.match).toBe(false);
  expect(state.confirmOpen).toBe(false);

  const lobbyHtml = renderExit(state, returnToLobby);
  expect(lobbyHtml).not.toContain('class="match-exit"');
  expect(lobbyHtml).not.toContain('role="dialog"');

  // Starting another match later keeps modal closed.
  state = reduceMatchExit(state, {
    type: 'sync',
    primary: true,
    match: true,
    manifest: HOLISTIC_MANIFEST,
  });
  expect(state.confirmOpen).toBe(false);
});

test('multi-screen games, secondary monitors, and lobby do not render (x) button and styles stay Neo-Brutalist', () => {
  expect(isSingleScreenGame(MULTISCREEN_MANIFEST)).toBe(false);
  expect(isSingleScreenGame(undefined)).toBe(false);
  expect(canShowMatchExit(true, true, MULTISCREEN_MANIFEST)).toBe(false);

  const returnToLobby = vi.fn();
  let multiState: MatchExitState = {
    primary: true,
    match: true,
    manifest: MULTISCREEN_MANIFEST,
    confirmOpen: false,
  };

  multiState = reduceMatchExit(multiState, { type: 'open' });
  expect(multiState.confirmOpen).toBe(false);

  const multiHtml = renderExit(multiState, returnToLobby);
  expect(multiHtml).not.toContain('class="match-exit"');
  expect(multiHtml).not.toContain('role="dialog"');

  // Secondary monitor on holistic game: hidden.
  const secondaryState: MatchExitState = {
    primary: false,
    match: true,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };
  expect(canShowMatchExit(false, true, HOLISTIC_MANIFEST)).toBe(false);
  expect(renderExit(secondaryState, returnToLobby)).not.toContain('class="match-exit"');

  // Primary monitor in lobby: hidden.
  const lobbyState: MatchExitState = {
    primary: true,
    match: false,
    manifest: HOLISTIC_MANIFEST,
    confirmOpen: false,
  };
  expect(canShowMatchExit(true, false, HOLISTIC_MANIFEST)).toBe(false);
  expect(renderExit(lobbyState, returnToLobby)).not.toContain('class="match-exit"');

  const matchCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/match.css'), 'utf8');
  const exitBlock = matchCss.match(/\.match-exit\s*\{[^}]*\}/)?.[0] ?? '';
  const panelBlock = matchCss.match(/\.confirm-panel\s*\{[^}]*\}/)?.[0] ?? '';
  expect(exitBlock).toContain('border: 2.5px solid');
  expect(exitBlock).toContain('box-shadow:');
  expect(panelBlock).toContain('border: 2.5px solid');
  expect(panelBlock).toContain('box-shadow: 0px 6px 0px #111111');
  expect(matchCss).not.toContain('backdrop-filter');
});
