import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { MatchRejoinQr, ScoreboardPanel, ScoreRulesPanel } from './score-rules.tsx';

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

test('MatchRejoinQr renders compact top-left rejoin QR panel labeled SCAN TO REJOIN without clobbering arena canvas', () => {
  const html = renderToString(() => <MatchRejoinQr onQr={() => {}} />);
  expect(html).toContain('class="match-rejoin"');
  expect(html).toContain('class="match-rejoin-qr"');
  expect(html).toContain('SCAN TO REJOIN');

  const matchCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/match.css'), 'utf8');
  const rejoinBlock = matchCss.match(/\.match-rejoin\s*\{[^}]*\}/)?.[0] ?? '';
  const rejoinQrBlock = matchCss.match(/\.match-rejoin-qr\s*\{[^}]*\}/)?.[0] ?? '';
  expect(rejoinBlock).toContain('position: fixed');
  expect(rejoinBlock).toContain('top:');
  expect(rejoinBlock).toContain('left:');
  expect(rejoinQrBlock).toMatch(/width:\s*(72|80)px/);
  expect(rejoinQrBlock).toMatch(/height:\s*(72|80)px/);
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
