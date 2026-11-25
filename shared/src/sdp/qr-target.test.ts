import { expect, test } from 'vitest';
import { CONTROLLER_REV, qrTarget } from './qr-target';

test('builds the LAN controller URL', () => {
  expect(CONTROLLER_REV).toBe('0.0.5');
  expect(qrTarget('192.168.1.20', 8443, 'ABCD')).toBe(
    `https://192.168.1.20:8443/controller?rev=${CONTROLLER_REV}&room=ABCD`,
  );
});
