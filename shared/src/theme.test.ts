import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { PLAYER_COLORS } from './registry';
import {
  APP_THEME,
  PLAYER_CSS_VARS,
  PLAYER_INK_COLORS,
  contrastRatio,
  pickContrastInk,
  playerStyleVars,
  readYellowTheme,
} from './theme';

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

test('theme.css player vars match PLAYER_COLORS, maximize WCAG ink contrast, and build slot bindings', () => {
  const cssPath = path.resolve(import.meta.dirname, 'ui/theme.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  const vars = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    vars.set(match[1], match[2].trim());
  }

  expect(PLAYER_CSS_VARS).toHaveLength(PLAYER_COLORS.length);
  expect(PLAYER_INK_COLORS).toHaveLength(PLAYER_COLORS.length);

  for (let slot = 0; slot < PLAYER_COLORS.length; slot += 1) {
    const colorVar = `--player-${slot + 1}`;
    const inkVar = `--player-${slot + 1}-ink`;
    const cssColor = vars.get(colorVar);
    const cssInk = vars.get(inkVar);

    expect(cssColor?.toUpperCase(), `${colorVar} must match PLAYER_COLORS[${slot}]`).toBe(
      PLAYER_COLORS[slot],
    );
    expect(cssInk?.toUpperCase(), `${inkVar} must match PLAYER_INK_COLORS[${slot}]`).toBe(
      PLAYER_INK_COLORS[slot],
    );
    expect(cssInk?.toUpperCase()).toBe(pickContrastInk(PLAYER_COLORS[slot]));

    const darkRatio = contrastRatio(PLAYER_COLORS[slot], '#111111');
    const lightRatio = contrastRatio(PLAYER_COLORS[slot], '#F4F1EA');
    const chosenRatio = contrastRatio(PLAYER_COLORS[slot], cssInk ?? '');
    expect(chosenRatio).toBeCloseTo(Math.max(darkRatio, lightRatio), 5);
    expect(chosenRatio, `${inkVar} on ${colorVar} must keep high contrast`).toBeGreaterThanOrEqual(4.4);
  }

  expect(vars.get('--player-7-ink')?.toUpperCase()).toBe('#F4F1EA');
  expect(playerStyleVars(0, PLAYER_COLORS[0])).toEqual({
    '--player-color': 'var(--player-1, #FF4D00)',
    '--player-ink': 'var(--player-1-ink, #111111)',
  });
  expect(playerStyleVars(6, PLAYER_COLORS[6])).toEqual({
    '--player-color': 'var(--player-7, #651FFF)',
    '--player-ink': 'var(--player-7-ink, #F4F1EA)',
  });
  expect(playerStyleVars(-1)).toEqual({});
});
