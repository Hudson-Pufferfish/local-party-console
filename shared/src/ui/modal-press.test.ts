import { expect, test } from 'vitest';
import { releaseClosesModal } from './modal-press.ts';

test('a release that did not start on CLOSE leaves the modal open', () => {
  expect(releaseClosesModal(false, false)).toBe(false);
  expect(releaseClosesModal(true, false)).toBe(false);
  expect(releaseClosesModal(false, true)).toBe(true);
});
