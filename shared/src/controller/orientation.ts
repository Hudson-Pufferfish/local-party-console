import type { ControllerOrientation } from '../types/game.ts';

export type { ControllerOrientation } from '../types/game.ts';

export type OrientationPreference = 'portrait' | 'landscape-left' | 'landscape-right';

export type StageRotationDeg = 0 | 90 | -90;

export interface ResolvedStageOrientation {
  orientation: ControllerOrientation;
  rotationDeg: StageRotationDeg;
  supported: boolean;
}

export const DEFAULT_SUPPORTED_ORIENTATIONS: readonly ControllerOrientation[] = [
  'portrait',
  'landscape',
];

export function transformAxesInto(
  dx: number,
  dy: number,
  rotationDeg: StageRotationDeg,
  out: { x: number; y: number },
): { x: number; y: number } {
  if (rotationDeg === 90) {
    out.x = dy === 0 ? 0 : dy;
    out.y = dx === 0 ? 0 : -dx;
    return out;
  }
  if (rotationDeg === -90) {
    out.x = dy === 0 ? 0 : -dy;
    out.y = dx === 0 ? 0 : dx;
    return out;
  }
  out.x = dx === 0 ? 0 : dx;
  out.y = dy === 0 ? 0 : dy;
  return out;
}

export function transformAxes(
  dx: number,
  dy: number,
  rotationDeg: StageRotationDeg,
): { x: number; y: number } {
  return transformAxesInto(dx, dy, rotationDeg, { x: 0, y: 0 });
}

export function normalizeOrientationPreference(raw: unknown): OrientationPreference {
  if (raw === 'portrait' || raw === 'landscape-left' || raw === 'landscape-right') {
    return raw;
  }
  return 'portrait';
}

export function resolveStageOrientation(input: {
  pref: OrientationPreference;
  nativePortrait: boolean;
  supportedOrientations?: readonly ControllerOrientation[];
}): ResolvedStageOrientation {
  const supportedList =
    input.supportedOrientations !== undefined && input.supportedOrientations.length > 0
      ? input.supportedOrientations
      : DEFAULT_SUPPORTED_ORIENTATIONS;
  const supportsPortrait = supportedList.includes('portrait');
  const supportsLandscape = supportedList.includes('landscape');

  if (!input.nativePortrait) {
    return {
      orientation: 'landscape',
      rotationDeg: 0,
      supported: supportsLandscape,
    };
  }

  if (input.pref === 'portrait') {
    if (supportsPortrait) {
      return { orientation: 'portrait', rotationDeg: 0, supported: true };
    }
    if (supportsLandscape) {
      return { orientation: 'landscape', rotationDeg: 90, supported: true };
    }
    return { orientation: 'portrait', rotationDeg: 0, supported: false };
  }

  const rotationDeg: StageRotationDeg = input.pref === 'landscape-right' ? -90 : 90;
  if (supportsLandscape) {
    return { orientation: 'landscape', rotationDeg, supported: true };
  }
  if (supportsPortrait) {
    return { orientation: 'portrait', rotationDeg: 0, supported: true };
  }
  return { orientation: 'landscape', rotationDeg, supported: false };
}
