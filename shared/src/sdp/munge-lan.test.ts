import { expect, test } from 'vitest';
import { mungeLanSdp } from './munge-lan';

test('rewrites a .local host candidate and drops the rest', () => {
  const sdp = [
    'v=0',
    'o=- 1 1 IN IP4 0.0.0.0',
    's=-',
    'a=candidate:1 1 udp 2122260223 host-name.local 51234 typ host generation 0',
    'a=candidate:2 1 udp 1686052607 8.8.8.8 19302 typ srflx generation 0',
    'a=candidate:3 1 udp 2122260222 10.9.8.7 40000 typ host generation 0',
    '',
  ].join('\r\n');

  const result = mungeLanSdp(sdp, '192.168.1.20');

  expect(result.ok).toBe(true);
  expect(result.sdp).toContain('192.168.1.20');
  expect(result.sdp).toContain('51234');
  expect(result.sdp).not.toContain('8.8.8.8');
  expect(result.sdp).not.toContain('.local');
  expect(result.sdp).not.toContain('10.9.8.7');
  expect(result.sdp).not.toContain('40000');
  expect(result.sdp.match(/a=candidate:/g)).toHaveLength(1);
});
