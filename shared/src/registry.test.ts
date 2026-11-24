import { expect, test } from 'vitest';
import { PLAYER_COLORS } from './registry';

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const lightness = (max + min) / 2;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
  else if (max === g) hue = ((b - r) / delta + 2) * 60;
  else hue = ((r - g) / delta + 4) * 60;
  return { hue, saturation };
}

test('PLAYER_COLORS keeps orange P1 and bans yellow across all 8 distinct slots', () => {
  expect(PLAYER_COLORS).toHaveLength(8);
  expect(new Set(PLAYER_COLORS).size).toBe(8);
  expect(PLAYER_COLORS[0]).toBe('#FF4D00');
  for (const hex of PLAYER_COLORS) {
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    const { hue, saturation } = hueAndSaturation(hex);
    const isYellow = saturation >= 0.4 && hue >= 38 && hue <= 68;
    expect(isYellow, `player color ${hex} sits in the banned yellow hue band`).toBe(false);
  }
});
