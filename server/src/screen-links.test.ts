import { expect, test } from 'vitest';
import { screenLinkLines } from './screen-links.ts';

test('prints one clickable https link per screen', () => {
  expect(screenLinkLines('10.0.0.72', 8443, 'ABCD', 'abc')).toEqual([
    'holistic  https://10.0.0.72:8443/screen/?room=ABCD&view=holistic&hostToken=abc',
    'local     https://127.0.0.1:8443/screen/?room=ABCD&view=holistic&hostToken=abc',
    'team-1    https://10.0.0.72:8443/screen/?room=ABCD&view=team-1&hostToken=abc',
    'team-2    https://10.0.0.72:8443/screen/?room=ABCD&view=team-2&hostToken=abc',
  ]);
});
