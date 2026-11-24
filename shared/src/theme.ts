import { PLAYER_COLORS } from './registry';

export const APP_THEME = {
  ink: '#111111',
  paper: '#F4F1EA',
  yellow: '#F5C518',
  yellowBright: '#FFE14D',
  yellowWarm: '#E5A800',
  yellowDeep: '#C88A00',
} as const;

export const THEME_CSS_VARS = {
  ink: '--ink',
  paper: '--paper',
  yellow: '--theme-yellow',
  yellowBright: '--theme-yellow-bright',
  yellowWarm: '--theme-yellow-warm',
  yellowDeep: '--theme-yellow-deep',
  accent: '--accent',
  accentHazard: '--accent-hazard',
  accentDash: '--accent-dash',
  accentSpark: '--accent-spark',
  warn: '--warn',
  playerColor: '--player-color',
  playerInk: '--player-ink',
} as const;

export const PLAYER_CSS_VARS = [
  { color: '--player-1', ink: '--player-1-ink' },
  { color: '--player-2', ink: '--player-2-ink' },
  { color: '--player-3', ink: '--player-3-ink' },
  { color: '--player-4', ink: '--player-4-ink' },
  { color: '--player-5', ink: '--player-5-ink' },
  { color: '--player-6', ink: '--player-6-ink' },
  { color: '--player-7', ink: '--player-7-ink' },
  { color: '--player-8', ink: '--player-8-ink' },
] as const;

export const PLAYER_INK_COLORS = [
  '#111111',
  '#111111',
  '#111111',
  '#F4F1EA',
  '#111111',
  '#111111',
  '#F4F1EA',
  '#111111',
] as const;

export type PlayerStyleVars = {
  '--player-color'?: string;
  '--player-ink'?: string;
};

export interface YellowThemeHex {
  readonly base: number;
  readonly hazard: number;
  readonly dash: number;
  readonly spark: number;
}

export function parseCssColorToHex(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('#')) {
    const body = trimmed.slice(1);
    if (body.length === 6 && /^[0-9a-fA-F]{6}$/.test(body)) {
      return Number.parseInt(body, 16);
    }
    if (body.length === 3 && /^[0-9a-fA-F]{3}$/.test(body)) {
      const expanded = `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
      return Number.parseInt(expanded, 16);
    }
    return null;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i.exec(trimmed);
  if (rgb === null) return null;
  const r = Number(rgb[1]);
  const g = Number(rgb[2]);
  const b = Number(rgb[3]);
  if (r > 255 || g > 255 || b > 255) return null;
  return (r << 16) | (g << 8) | b;
}

export function resolveThemeColor(cssVar: string, fallback: string, root?: Element | null): string {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (target !== null && typeof getComputedStyle === 'function') {
    const value = getComputedStyle(target).getPropertyValue(cssVar).trim();
    if (value !== '') return value;
  }
  return fallback;
}

export function resolveThemeHex(cssVar: string, fallback: string, root?: Element | null): number {
  const resolved = parseCssColorToHex(resolveThemeColor(cssVar, fallback, root));
  if (resolved !== null) return resolved;
  return parseCssColorToHex(fallback) ?? 0xf5c518;
}

export function readYellowTheme(root?: Element | null): YellowThemeHex {
  return {
    base: resolveThemeHex(THEME_CSS_VARS.yellow, APP_THEME.yellow, root),
    hazard: resolveThemeHex(THEME_CSS_VARS.accentHazard, APP_THEME.yellowDeep, root),
    dash: resolveThemeHex(THEME_CSS_VARS.accentDash, APP_THEME.yellowWarm, root),
    spark: resolveThemeHex(THEME_CSS_VARS.accentSpark, APP_THEME.yellowBright, root),
  };
}

function linearizeChannel(byte: number): number {
  const srgb = byte / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: number): number {
  const r = linearizeChannel((hex >> 16) & 255);
  const g = linearizeChannel((hex >> 8) & 255);
  const b = linearizeChannel(hex & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(colorA: string, colorB: string): number {
  const hexA = parseCssColorToHex(colorA);
  const hexB = parseCssColorToHex(colorB);
  if (hexA === null || hexB === null) return 1;
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function pickContrastInk(background: string): '#111111' | '#F4F1EA' {
  const darkRatio = contrastRatio(background, APP_THEME.ink);
  const lightRatio = contrastRatio(background, APP_THEME.paper);
  return lightRatio > darkRatio ? APP_THEME.paper : APP_THEME.ink;
}

export function playerStyleVars(slot: number, fallbackColor?: string): PlayerStyleVars {
  const entry = Number.isInteger(slot) && slot >= 0 && slot < PLAYER_CSS_VARS.length
    ? PLAYER_CSS_VARS[slot]
    : undefined;
  if (entry !== undefined) {
    const colorFallback = fallbackColor !== undefined && fallbackColor !== ''
      ? fallbackColor
      : PLAYER_COLORS[slot];
    const inkFallback = PLAYER_INK_COLORS[slot];
    return {
      '--player-color': `var(${entry.color}, ${colorFallback})`,
      '--player-ink': `var(${entry.ink}, ${inkFallback})`,
    };
  }
  if (fallbackColor !== undefined && parseCssColorToHex(fallbackColor) !== null) {
    return {
      '--player-color': fallbackColor,
      '--player-ink': pickContrastInk(fallbackColor),
    };
  }
  return {};
}
