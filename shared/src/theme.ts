export const APP_THEME = {
  yellow: '#F5C518',
  yellowBright: '#FFE14D',
  yellowWarm: '#E5A800',
  yellowDeep: '#C88A00',
} as const;

export const THEME_CSS_VARS = {
  yellow: '--theme-yellow',
  yellowBright: '--theme-yellow-bright',
  yellowWarm: '--theme-yellow-warm',
  yellowDeep: '--theme-yellow-deep',
  accent: '--accent',
  accentHazard: '--accent-hazard',
  accentDash: '--accent-dash',
  accentSpark: '--accent-spark',
  warn: '--warn',
} as const;

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
