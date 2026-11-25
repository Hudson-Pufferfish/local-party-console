import { expect, test } from 'vitest';
import {
  normalizeOrientationPreference,
  resolveStageOrientation,
  transformAxes,
  transformAxesInto,
} from './orientation.ts';

test('transformAxes maps viewport pointer deltas into rotated stage coordinates at 0, +90, and -90 degrees', () => {
  expect(transformAxes(10, -20, 0)).toEqual({ x: 10, y: -20 });

  // +90deg CW stage: viewport down (+y) is local right (+x); viewport right (+x) is local up (-y)
  expect(transformAxes(0, 40, 90)).toEqual({ x: 40, y: 0 });
  expect(transformAxes(40, 0, 90)).toEqual({ x: 0, y: -40 });
  expect(transformAxes(-12, 24, 90)).toEqual({ x: 24, y: 12 });

  // -90deg CCW stage: viewport up (-y) is local right (+x); viewport left (-x) is local up (-y)
  expect(transformAxes(0, -40, -90)).toEqual({ x: 40, y: 0 });
  expect(transformAxes(-40, 0, -90)).toEqual({ x: 0, y: -40 });
  expect(transformAxes(12, 24, -90)).toEqual({ x: -24, y: 12 });

  // Zero-allocation scratch writer matches pure output without -0
  const out = { x: 99, y: 99 };
  expect(transformAxesInto(0, 0, 90, out)).toBe(out);
  expect(Object.is(out.x, 0)).toBe(true);
  expect(Object.is(out.y, 0)).toBe(true);
});

test('normalizeOrientationPreference and resolveStageOrientation handle native, soft-rotated, and single-orientation games', () => {
  expect(normalizeOrientationPreference('portrait')).toBe('portrait');
  expect(normalizeOrientationPreference('landscape-left')).toBe('landscape-left');
  expect(normalizeOrientationPreference('landscape-right')).toBe('landscape-right');
  expect(normalizeOrientationPreference('sideways')).toBe('portrait');
  expect(normalizeOrientationPreference(null)).toBe('portrait');
  expect(normalizeOrientationPreference(undefined)).toBe('portrait');

  // Native landscape with landscape supported stays unrotated regardless of portrait pref
  expect(resolveStageOrientation({
    pref: 'landscape-left',
    nativePortrait: false,
    supportedOrientations: ['portrait', 'landscape'],
  })).toEqual({ orientation: 'landscape', rotationDeg: 0, supported: true });

  // Native portrait maps each preference cleanly
  expect(resolveStageOrientation({
    pref: 'portrait',
    nativePortrait: true,
  })).toEqual({ orientation: 'portrait', rotationDeg: 0, supported: true });
  expect(resolveStageOrientation({
    pref: 'landscape-left',
    nativePortrait: true,
    supportedOrientations: ['portrait', 'landscape'],
  })).toEqual({ orientation: 'landscape', rotationDeg: 90, supported: true });
  expect(resolveStageOrientation({
    pref: 'landscape-right',
    nativePortrait: true,
    supportedOrientations: ['portrait', 'landscape'],
  })).toEqual({ orientation: 'landscape', rotationDeg: -90, supported: true });

  // Landscape-only game constrains portrait preference to soft-rotated landscape
  expect(resolveStageOrientation({
    pref: 'portrait',
    nativePortrait: true,
    supportedOrientations: ['landscape'],
  })).toEqual({ orientation: 'landscape', rotationDeg: 90, supported: true });
  expect(resolveStageOrientation({
    pref: 'landscape-right',
    nativePortrait: true,
    supportedOrientations: ['landscape'],
  })).toEqual({ orientation: 'landscape', rotationDeg: -90, supported: true });

  // Portrait-only game stays portrait when natively portrait, and reports unsupported when physically landscape
  expect(resolveStageOrientation({
    pref: 'landscape-left',
    nativePortrait: true,
    supportedOrientations: ['portrait'],
  })).toEqual({ orientation: 'portrait', rotationDeg: 0, supported: true });
  expect(resolveStageOrientation({
    pref: 'portrait',
    nativePortrait: false,
    supportedOrientations: ['portrait'],
  })).toEqual({ orientation: 'landscape', rotationDeg: 0, supported: false });
});
