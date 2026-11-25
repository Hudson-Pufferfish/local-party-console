import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { ScoreboardPanel, ScoreRulesPanel } from './score-rules.tsx';

test('ScoreRulesPanel renders rank payouts on the left and ScoreboardPanel renders threshold above clean scores on the right', () => {
  const leftHtml = renderToString(() => (
    <ScoreRulesPanel
      rules={{
        rows: [
          { label: '1ST', value: '+3' },
          { label: '2ND', value: '+2' },
          { label: '3RD', value: '+1' },
          { label: '4TH', value: '+0' },
        ],
      }}
    />
  ));

  expect(leftHtml).toContain('class="score-rules"');
  expect(leftHtml).not.toContain('THRESHOLD');
  expect(leftHtml).not.toContain('TARGET');
  expect(leftHtml).toContain('1ST:');
  expect(leftHtml).toContain('+3');
  expect(leftHtml).toContain('2ND:');
  expect(leftHtml).toContain('+2');
  expect(leftHtml).toContain('4TH:');
  expect(leftHtml).toContain('+0');

  const rightHtml = renderToString(() => (
    <ScoreboardPanel
      header="THRESHOLD: 9"
      rows={[
        { slot: 0, color: '#FF4D00', text: 'hu 4' },
        { slot: 1, color: '#00C853', text: 'da 2' },
      ]}
    />
  ));

  expect(rightHtml).toContain('class="scoreboard-panel"');
  expect(rightHtml).toContain('class="scoreboard-threshold"');
  expect(rightHtml).toContain('THRESHOLD: 9');
  expect(rightHtml).toContain('hu 4');
  expect(rightHtml).toContain('da 2');
  expect(rightHtml.indexOf('THRESHOLD: 9')).toBeLessThan(rightHtml.indexOf('hu 4'));

  const matchCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/match.css'), 'utf8');
  const leftBlock = matchCss.match(/\.match\s+\.score-rules\s*\{[^}]*\}/)?.[0] ?? '';
  const rightBlock = matchCss.match(/\.match\s+\.scoreboard-panel\s*\{[^}]*\}/)?.[0] ?? '';
  expect(leftBlock).toContain('grid-column: 1');
  expect(leftBlock).toContain('grid-row: 2');
  expect(leftBlock).toContain('justify-self: end');
  expect(rightBlock).toContain('grid-column: 3');
  expect(rightBlock).toContain('grid-row: 2');
  expect(rightBlock).toContain('justify-self: start');
});
