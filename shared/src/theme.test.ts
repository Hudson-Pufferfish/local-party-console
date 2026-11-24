import { afterEach, expect, test, vi } from 'vitest';
import { APP_THEME, readYellowTheme } from './theme';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('readYellowTheme falls back to APP_THEME headless and reads CSS variables via getComputedStyle', () => {
  expect(readYellowTheme()).toEqual({
    base: 0xf5c518,
    hazard: 0xc88a00,
    dash: 0xe5a800,
    spark: 0xffe14d,
  });
  expect(APP_THEME.yellow).toBe('#F5C518');

  const vars: Record<string, string> = {
    '--theme-yellow': '#f5c518',
    '--accent-hazard': 'rgb(184, 130, 0)',
    '--accent-dash': '#eab308',
    '--accent-spark': '#fff066',
  };
  const fakeRoot = {} as Element;
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => vars[name] ?? '',
  }));

  expect(readYellowTheme(fakeRoot)).toEqual({
    base: 0xf5c518,
    hazard: 0xb88200,
    dash: 0xeab308,
    spark: 0xfff066,
  });
});
