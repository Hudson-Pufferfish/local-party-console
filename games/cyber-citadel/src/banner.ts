import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_HEADER,
  CYBER_PHASE,
} from './constants.ts';

export function bannerCopy(state: Float32Array, _names?: readonly string[]): string {
  const phase = state[CYBER_HEADER.phaseEnum] ?? CYBER_PHASE.COUNTDOWN;
  const timer = state[CYBER_HEADER.phaseTimer] ?? 0;
  const wave = Math.max(1, Math.min(C.totalWaves, Math.trunc(state[CYBER_HEADER.wave] ?? 1)));
  const coreHp = state[CYBER_HEADER.coreHp] ?? 0;

  if (phase === CYBER_PHASE.MATCH_OVER) {
    return coreHp > 0 && wave >= C.totalWaves ? 'CITADEL HOLDS' : `CORE LOST · WAVE ${wave}/${C.totalWaves}`;
  }
  if (phase === CYBER_PHASE.COUNTDOWN) {
    return String(Math.max(1, Math.ceil(timer)));
  }
  if (phase === CYBER_PHASE.WAVE_BREAK) {
    return `BREAK ${Math.max(1, Math.ceil(timer))}`;
  }
  return `WAVE ${wave}/${C.totalWaves}`;
}
