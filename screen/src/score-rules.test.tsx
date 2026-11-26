import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { MatchRejoinQr, RoundRanking, ScoreboardPanel, ScoreRulesPanel } from './score-rules.tsx';

test('ScoreRulesPanel renders PTS payouts on the left and ScoreboardPanel renders LIVE/AWAY status on the right', () => {
  const leftHtml = renderToString(() => (
    <ScoreRulesPanel
      rules={{
        rows: [
          { label: '1ST', value: '+3 PTS' },
          { label: '2ND', value: '+2 PTS' },
          { label: '3RD', value: '+1 PTS' },
          { label: '4TH', value: '+0 PTS' },
        ],
      }}
    />
  ));

  expect(leftHtml).toContain('class="score-rules"');
  expect(leftHtml).not.toContain('THRESHOLD');
  expect(leftHtml).not.toContain('TARGET');
  expect(leftHtml).toContain('1ST:');
  expect(leftHtml).toContain('+3 PTS');
  expect(leftHtml).toContain('2ND:');
  expect(leftHtml).toContain('+2 PTS');
  expect(leftHtml).toContain('4TH:');
  expect(leftHtml).toContain('+0 PTS');

  const rightHtml = renderToString(() => (
    <ScoreboardPanel
      header="THRESHOLD: 9"
      rows={[
        { slot: 0, color: '#FF4D00', name: 'HUDSON', score: 4, status: 'LIVE' },
        { slot: 1, color: '#00C853', name: 'DASH', score: 2, status: 'AWAY' },
        { slot: 2, color: '#2979FF', name: 'P3', score: 1 },
      ]}
    />
  ));

  expect(rightHtml).toContain('class="scoreboard-panel"');
  expect(rightHtml).toContain('class="scoreboard-threshold"');
  expect(rightHtml).toContain('THRESHOLD: 9');
  expect(rightHtml).toContain('class="score-dot"');
  expect(rightHtml).toContain('class="score-name">HUDSON<');
  expect(rightHtml).toContain('class="score-value">4<');
  expect(rightHtml).toContain('class="score-name">DASH<');
  expect(rightHtml).toContain('class="score-value">2<');
  expect(rightHtml).toContain('class="score-name">P3<');
  expect(rightHtml).toContain('class="score-value">1<');
  expect(rightHtml).toContain('>LIVE<');
  expect(rightHtml).toContain('>AWAY<');
  expect(rightHtml.indexOf('THRESHOLD: 9')).toBeLessThan(rightHtml.indexOf('HUDSON'));

  const matchCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/match.css'), 'utf8');
  const leftBlock = matchCss.match(/\.match\s+\.score-rules\s*\{[^}]*\}/)?.[0] ?? '';
  const rightBlock = matchCss.match(/\.match\s+\.scoreboard-panel\s*\{[^}]*\}/)?.[0] ?? '';
  const rowBlock = matchCss.match(/\.score-row\s*\{[^}]*\}/)?.[0] ?? '';
  const nameBlock = matchCss.match(/\.score-name\s*\{[^}]*\}/)?.[0] ?? '';
  const valueBlock = matchCss.match(/\.score-value\s*\{[^}]*\}/)?.[0] ?? '';
  expect(leftBlock).toContain('grid-column: 1');
  expect(leftBlock).toContain('grid-row: 2');
  expect(leftBlock).toContain('justify-self: end');
  expect(rightBlock).toContain('grid-column: 3');
  expect(rightBlock).toContain('grid-row: 2');
  expect(rightBlock).toContain('justify-self: start');
  expect(rowBlock).toContain('display: grid');
  expect(rowBlock).toContain('grid-template-columns:');
  expect(rowBlock).toContain('column-gap:');
  expect(nameBlock).toContain('text-overflow: ellipsis');
  expect(valueBlock).toContain('text-align: right');
});

test('MatchRejoinQr renders borderless larger rejoin QR labeled SCAN TO REJOIN without clobbering arena canvas', () => {
  const html = renderToString(() => <MatchRejoinQr onQr={() => {}} />);
  expect(html).toContain('class="match-rejoin"');
  expect(html).toContain('class="match-rejoin-qr"');
  expect(html).toContain('SCAN TO REJOIN');

  const matchCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/match.css'), 'utf8');
  const rejoinBlock = matchCss.match(/\.match-rejoin\s*\{[^}]*\}/)?.[0] ?? '';
  const rejoinQrBlock = matchCss.match(/\.match-rejoin-qr\s*\{[^}]*\}/)?.[0] ?? '';
  expect(rejoinBlock).not.toContain('border:');
  expect(rejoinBlock).not.toContain('box-shadow:');
  expect(rejoinQrBlock).not.toContain('border:');
  expect(rejoinQrBlock).toMatch(/width:\s*128px/);
  expect(rejoinQrBlock).toMatch(/height:\s*128px/);
  expect(matchCss).not.toMatch(/\.match\s+canvas\s*\{/);
  expect(matchCss).not.toContain('backdrop-filter');
});

test('ScoreboardPanel renders optional solid coverage bar only when row.ratio is defined', () => {
  const withBarHtml = renderToString(() => (
    <ScoreboardPanel
      header="TIME 00:45"
      rows={[
        { slot: 0, color: '#FF4D00', name: 'HUDSON', score: '34.2%', ratio: 0.342, status: 'LIVE' },
        { slot: 1, color: '#00C853', name: 'BOT1', score: '12.5%', ratio: 0.125 },
      ]}
    />
  ));
  expect(withBarHtml).toContain('class="score-bar"');
  expect(withBarHtml).toContain('class="score-bar-fill"');
  expect(withBarHtml).toContain('width:34.2%');
  expect(withBarHtml).toContain('background-color:#FF4D00');

  const noBarHtml = renderToString(() => (
    <ScoreboardPanel
      header="THRESHOLD: 9"
      rows={[{ slot: 0, color: '#FF4D00', name: 'HUDSON', score: 4 }]}
    />
  ));
  expect(noBarHtml).not.toContain('class="score-bar"');
});

test('left column pushes guide to top, wraps payouts into 2 columns, and pins round status badge column for 8-player fit', () => {
  const matchCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/match.css'), 'utf8');
  const sideLeftBlock = matchCss.match(/\.match-side-left\s*\{[^}]*\}/)?.[0] ?? '';
  const rulesListBlock = matchCss.match(/\.score-rules-list\s*\{[^}]*\}/)?.[0] ?? '';
  const rankStatusBlock = matchCss.match(/\.round-rank-status\s*\{[^}]*\}/)?.[0] ?? '';
  const rankBombBlock = matchCss.match(/\.round-rank-value\[data-bomb="true"\]\s*\{[^}]*\}/)?.[0] ?? '';

  expect(sideLeftBlock).toContain('grid-column: 1');
  expect(sideLeftBlock).toContain('grid-row: 1 / -1');
  expect(sideLeftBlock).toContain('align-self: start');
  expect(rulesListBlock).toContain('display: grid');
  expect(rulesListBlock).toContain('repeat(2,');
  expect(rankStatusBlock).toContain('grid-column: 6');
  expect(rankBombBlock).toContain('border-color:');
});

test('RoundRanking marks bomb holder with data-bomb on rank value and avoids extra marker column', () => {
  const html = renderToString(() => (
    <RoundRanking
      mode="live"
      rows={[
        {
          slot: 0,
          color: '#FF4D00',
          name: 'HUDSON',
          value: 'ALIVE',
          place: null,
          finalized: false,
          preview: null,
          status: 'LIVE',
          marker: 'BOMB',
        },
        {
          slot: 1,
          color: '#00C853',
          name: 'BOT1',
          value: 'ALIVE',
          place: null,
          finalized: false,
          preview: null,
          status: 'AWAY',
        },
      ]}
    />
  ));

  expect(html).toContain('class="round-rank-value" data-bomb="true"');
  expect(html).not.toContain('class="round-rank-marker"');
});

test('8-player match HUD clamps gaps and uses dynamic clamp(14px, 2.2dvh, 28px) row heights for 1080p and 720p fit', () => {
  const rows = Array.from({ length: 8 }, (_, slot) => ({
    slot,
    color: '#FF4D00',
    name: `P${slot + 1}`,
    score: `${100 - slot * 5}%`,
    ratio: (100 - slot * 5) / 100,
    status: (slot % 2 === 0 ? 'LIVE' : 'AWAY') as 'LIVE' | 'AWAY',
  }));
  const html = renderToString(() => <ScoreboardPanel header="WAVE 4/8" rows={rows} />);
  expect((html.match(/class="score-row"/g) ?? []).length).toBe(8);

  const matchCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/match.css'), 'utf8');
  const matchBlock = matchCss.match(/(?:^|\n)\.match\s*\{[^}]*\}/)?.[0] ?? '';
  const matchSideBlock = matchCss.match(/\.match-side\s*\{[^}]*\}/)?.[0] ?? '';
  const scoreboardPanelBlock = matchCss.match(/(?:^|\n)\.scoreboard-panel\s*\{[^}]*\}/)?.[0] ?? '';
  const scoreboardBlock = matchCss.match(/(?:^|\n)\.scoreboard\s*\{[^}]*\}/)?.[0] ?? '';
  const scoreRowBlock = matchCss.match(/(?:^|\n)\.score-row\s*\{[^}]*\}/)?.[0] ?? '';
  const roundRankRowBlock = matchCss.match(/(?:^|\n)\.round-rank-row\s*\{[^}]*\}/)?.[0] ?? '';

  expect(matchBlock).toMatch(/row-gap:\s*clamp\(/);
  expect(matchSideBlock).toMatch(/gap:\s*clamp\(/);
  expect(scoreboardPanelBlock).toMatch(/gap:\s*clamp\(/);
  expect(scoreboardBlock).toContain('clamp(14px, 2.2dvh, 28px)');
  expect(scoreRowBlock).toContain('clamp(14px, 2.2dvh, 28px)');
  expect(roundRankRowBlock).toContain('clamp(14px, 2.2dvh, 28px)');
});
