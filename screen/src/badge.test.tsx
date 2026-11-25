import { renderToString } from '@solidjs/web';
import { expect, test } from 'vitest';
import { Badge, badgeLabel } from './badge.tsx';

test('Badge renders plain view labels for holistic and team screens', () => {
  expect(badgeLabel('holistic')).toBe('HOLISTIC VIEW');
  expect(badgeLabel('team-1')).toBe('TEAM 1 VIEW');
  expect(badgeLabel('team-4')).toBe('TEAM 4 VIEW');

  const holisticHtml = renderToString(() => <Badge view="holistic" />);
  expect(holisticHtml).toContain('class="badge"');
  expect(holisticHtml).toContain('>HOLISTIC VIEW<');

  const teamHtml = renderToString(() => <Badge view="team-2" />);
  expect(teamHtml).toContain('>TEAM 2 VIEW<');
});
