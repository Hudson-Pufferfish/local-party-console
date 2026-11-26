import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import {
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PHASE,
  CYBER_PLAYER_OFFSET,
} from './constants.ts';
import { playerBase } from './state.ts';

const FALLBACK_COLOR = '#111111';

export interface ScoreRow {
  readonly slot: number;
  readonly color: string;
  readonly name: string;
  readonly score: number | string;
  readonly status?: 'LIVE' | 'AWAY';
  readonly ratio?: number;
}

export interface ScorePlayerStatus {
  readonly index: number;
  readonly connected: boolean;
}

export interface ScoreRuleRow {
  readonly label: string;
  readonly value: string;
}

export interface ScoreRules {
  readonly guide?: readonly string[];
  readonly rows: readonly ScoreRuleRow[];
}

export function shortTag(name: string, slot: number): string {
  let letters = '';
  const raw = name.toUpperCase();
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const digit = code >= 48 && code <= 57;
    const alpha = code >= 65 && code <= 90;
    if (!digit && !alpha) continue;
    letters += raw.charAt(index);
    if (letters.length === 6) break;
  }
  if (letters.length > 0) return letters;
  return `P${slot + 1}`;
}

export function scoreboardHeader(state: Float32Array): string {
  const phase = state[CYBER_HEADER.phaseEnum] ?? 0;
  const wave = Math.max(1, Math.min(C.totalWaves, Math.trunc(state[CYBER_HEADER.wave] ?? 1)));
  const coreHp = Math.max(0, Math.min(C.coreMaxHp, state[CYBER_HEADER.coreHp] ?? 0));
  const corePct = Math.round((coreHp / C.coreMaxHp) * 100);

  if (phase === CYBER_PHASE.MATCH_OVER) {
    return coreHp > 0 && wave >= C.totalWaves ? 'CITADEL HOLDS' : `CORE LOST · WAVE ${wave}/${C.totalWaves}`;
  }
  return `WAVE ${wave}/${C.totalWaves} • CORE: ${corePct}%`;
}

export function scoreRules(_state: Float32Array): ScoreRules {
  return {
    guide: [
      '• DEFEND THE CORE: Stop enemies before Core reaches 0% Health.',
      '• SHOOTING: Ship automatically shoots enemies in front of you.',
      '• SUPER BOMB: 1 use per wave! At least 50% of living squad must stand in blue ring and press Y.',
      '• REVIVE: Stand next to a downed teammate and hold Y for 2.5s.',
      '• SHIELD ENEMIES: Big enemies block front shots. Flank their backs!',
    ],
    rows: [
      { label: 'A', value: 'LASER BEAM — Pierces entire line of enemies (2.5s Cooldown)' },
      { label: 'B', value: 'QUICK DASH — Speed dodge to escape or flank (1.8s Cooldown)' },
      { label: 'X', value: 'ENERGY WALL — Blocks enemy path for 8s; placed outside blue ring only' },
      { label: 'Y', value: 'REVIVE / BOMB — Hold near ally to revive, or press in ring to bomb' },
    ],
  };
}

export function scoreboardRows(
  state: Float32Array,
  names: readonly string[],
  players?: readonly ScorePlayerStatus[],
): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (let slot = 0; slot < C.maxPlayers; slot += 1) {
    const base = playerBase(slot);
    const flags = state[base + CYBER_PLAYER_OFFSET.flags] ?? 0;
    if ((flags & CYBER_FLAG.JOINED) === 0) continue;

    const hp = state[base + CYBER_PLAYER_OFFSET.hp] ?? 0;
    const isDowned = (flags & CYBER_FLAG.DOWNED) !== 0;
    const isRespawning = (flags & CYBER_FLAG.RESPAWNING) !== 0;
    const ratio = isDowned || isRespawning ? 0 : Math.max(0, Math.min(1, hp / C.playerMaxHp));
    const score: number | string = isDowned ? 'DOWN' : isRespawning ? 'RESP' : Math.ceil(hp);
    const tag = shortTag(names[slot] ?? '', slot);
    const player = players?.find((item) => item.index === slot);

    if (player === undefined) {
      rows.push({
        slot,
        color: PLAYER_COLORS[slot] ?? FALLBACK_COLOR,
        name: tag,
        score,
        ratio,
      });
    } else {
      rows.push({
        slot,
        color: PLAYER_COLORS[slot] ?? FALLBACK_COLOR,
        name: tag,
        score,
        status: player.connected ? 'LIVE' : 'AWAY',
        ratio,
      });
    }
  }
  return rows;
}
