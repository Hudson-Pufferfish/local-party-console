import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { ScoreRulesPanel } from './score-rules.tsx';

test('ScoreRulesPanel renders target score and rank payout rows in the left match column', () => {
  const html = renderToString(() => (
    <ScoreRulesPanel
      rules={{
        target: 'TARGET: >= 21 PTS',
        rows: [
          { label: '1ST', value: '+7' },
          { label: '2ND', value: '+6' },
          { label: '3RD', value: '+5' },
        ],
      }}
    />
  ));

  expect(html).toContain('class="score-rules"');
  expect(html).toContain('TARGET: >= 21 PTS');
  expect(html).toContain('1ST:');
  expect(html).toContain('+7');
  expect(html).toContain('2ND:');
  expect(html).toContain('+6');
  expect(html).toContain('3RD:');
  expect(html).toContain('+5');

  const matchCss = fs.readFileSync(path.resolve(import.meta.dirname, 'styles/match.css'), 'utf8');
  const leftBlock = matchCss.match(/\.match\s+\.score-rules\s*\{[^}]*\}/)?.[0] ?? '';
  expect(leftBlock).toContain('grid-column: 1');
  expect(leftBlock).toContain('grid-row: 2');
  expect(leftBlock).toContain('justify-self: end');
});
