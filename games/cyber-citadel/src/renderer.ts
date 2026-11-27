import Phaser from 'phaser';
import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import {
  AUX_LAYOUT,
  BARRICADE_FLAG,
  BOSS_WEAK_FLAG,
  CYBER_CITADEL_CONSTANTS as C,
  CYBER_FLAG,
  CYBER_HEADER,
  CYBER_PLAYER_OFFSET,
  ENEMY_STATE_FLAG,
  ENEMY_TYPE,
  PROJECTILE_FLAG,
} from './constants.ts';
import { cellCenter } from './flow-field.ts';
import {
  decodeAngleU8,
  decodeBossLaserLenU16,
  decodeCoordU16,
  decodeFacingSector4,
  playerBase,
} from './state.ts';

/**
 * Industrial Neo-Brutalist Cyber-Citadel palette.
 * Strictly excludes #F5C518 yellow (reserved for platform UI chrome per FR-7).
 */
export const CYBER_PALETTE = {
  paper: 0xf4f1ea,
  gridLine: 0xd9d3c6,
  ink: 0x111111,
  coreFill: 0xe6e1d5,
  coreHealthy: 0x00c853,
  coreWarn: 0xff4d00,
  coreCritical: 0xe10600,
  empRing: 0x536dfe, // Electric Indigo/Cobalt - high contrast against #2979ff (P3) and #f4f1ea backdrop
  empFill: 0xffffff, // Pure Arc Lightning White - flashes stunned enemies without clashing with #00B7C2 (P6)
  empArcGlow: 0x7c4dff, // Vivid Deep Violet charging progression arc
  barricadeFill: 0x2a2a2a,
  barricadeWarn: 0xff4d00,
  droneBody: 0x2d2d2d,
  fastDroneBody: 0x454545,
  bruteBody: 0x1f1f1f,
  carrierBody: 0x3b3b3b,
  bossBody: 0x181818,
  hazardOrange: 0xff4d00,
  warningRed: 0xe10600,
  railBeam: 0x00b7c2,
  reviveBeam: 0x00c853,
  tracerInk: 0x111111,
} as const;

const PLAYER_HEX = PLAYER_COLORS.map((c) => Number.parseInt(c.slice(1), 16));

export function worldToScreen(
  wx: number,
  wy: number,
  centerX: number,
  centerY: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: centerX + wx * scale,
    y: centerY + wy * scale,
  };
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

export function createCyberCitadelRenderer(
  canvas: HTMLCanvasElement,
  readState: () => Float32Array,
  readAux?: () => Uint8Array | null,
): { draw(): void; destroy(): void } {
  let gfx: Phaser.GameObjects.Graphics | null = null;
  let gone = false;
  let pulse = 0;

  class CyberArenaScene extends Phaser.Scene {
    constructor() {
      super('cyber-citadel-arena');
    }

    create(): void {
      gfx = this.add.graphics();
      if (!gone) draw();
    }
  }

  const widthInit = canvas.width > 0 ? canvas.width : 800;
  const heightInit = canvas.height > 0 ? canvas.height : 800;
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    canvas,
    width: widthInit,
    height: heightInit,
    parent: null,
    backgroundColor: '#F4F1EA',
    antialias: true,
    banner: false,
    autoFocus: false,
    input: false,
    audio: { noAudio: true },
    scale: {
      mode: Phaser.Scale.NONE,
      parent: null,
      expandParent: false,
      width: widthInit,
      height: heightInit,
    },
    scene: CyberArenaScene,
    callbacks: {
      postBoot: () => {
        canvas.style.width = '';
        canvas.style.height = '';
      },
    },
  });

  function draw(): void {
    if (gone || gfx === null) return;
    pulse = (pulse + 1) % 120;
    paint(gfx, readState(), readAux ? readAux() : null);
  }

  function paint(g: Phaser.GameObjects.Graphics, state: Float32Array, aux: Uint8Array | null): void {
    const width = canvas.width > 0 ? canvas.width : 800;
    const height = canvas.height > 0 ? canvas.height : 800;
    const pad = 20;
    const arenaPx = Math.max(120, Math.min(width, height) - pad * 2);
    const scale = arenaPx / C.arenaSize;
    const originX = (width - arenaPx) * 0.5;
    const originY = (height - arenaPx) * 0.5;
    const centerX = originX + arenaPx * 0.5;
    const centerY = originY + arenaPx * 0.5;
    const cellPx = arenaPx / C.gridCols;

    g.clear();

    // 1. Matte paper backdrop + subtle 40x40 technical grid (step by 2 cells for crisp legibility)
    g.fillStyle(CYBER_PALETTE.paper, 1);
    g.fillRect(originX, originY, arenaPx, arenaPx);
    g.lineStyle(1, CYBER_PALETTE.gridLine, 0.7);
    for (let i = 2; i < C.gridCols; i += 2) {
      const off = i * cellPx;
      g.lineBetween(originX + off, originY, originX + off, originY + arenaPx);
      g.lineBetween(originX, originY + off, originX + arenaPx, originY + off);
    }

    const hasAux = aux !== null && aux.byteLength >= AUX_LAYOUT.AUX_CORE_BYTES;

    // 2. 2.0s Flank corridor telegraph warning glows (N, E, S, W)
    if (hasAux) {
      const stripThick = 16 * scale;
      const stripLen = 360 * scale;
      for (let f = 0; f < 4; f += 1) {
        const glow = aux[AUX_LAYOUT.META_FLANK_GLOW + f] ?? 0;
        if (glow <= 4) continue;
        const alpha = (glow / 255) * 0.72;
        g.fillStyle(glow > 180 ? CYBER_PALETTE.warningRed : CYBER_PALETTE.hazardOrange, alpha);
        if (f === 0) {
          g.fillRect(centerX - stripLen * 0.5, originY, stripLen, stripThick);
        } else if (f === 1) {
          g.fillRect(originX + arenaPx - stripThick, centerY - stripLen * 0.5, stripThick, stripLen);
        } else if (f === 2) {
          g.fillRect(centerX - stripLen * 0.5, originY + arenaPx - stripThick, stripLen, stripThick);
        } else {
          g.fillRect(originX, centerY - stripLen * 0.5, stripThick, stripLen);
        }
      }
    }

    // 3. EMP gather ring + charge progress arc
    const empRingPx = C.empRingRadius * scale;
    const empCharge = Math.max(0, Math.min(1, state[CYBER_HEADER.empCharge] ?? 0));
    g.lineStyle(2, CYBER_PALETTE.empRing, 0.45);
    const dashSegments = 32;
    for (let seg = 0; seg < dashSegments; seg += 2) {
      g.beginPath();
      g.arc(
        centerX,
        centerY,
        empRingPx,
        (seg / dashSegments) * Math.PI * 2,
        ((seg + 1) / dashSegments) * Math.PI * 2,
        false,
        0,
      );
      g.strokePath();
    }
    if (empCharge > 0) {
      g.lineStyle(5, CYBER_PALETTE.empArcGlow, 0.95);
      g.beginPath();
      g.arc(
        centerX,
        centerY,
        empRingPx + 4,
        -Math.PI * 0.5,
        -Math.PI * 0.5 + empCharge * Math.PI * 2,
        false,
        0,
      );
      g.strokePath();
    }

    // 4. Central Core + Core HP ring
    const corePx = C.coreRadius * scale;
    const coreHp = Math.max(0, Math.min(C.coreMaxHp, state[CYBER_HEADER.coreHp] ?? 0));
    const coreRatio = coreHp / C.coreMaxHp;
    const coreColor =
      coreRatio > 0.55
        ? CYBER_PALETTE.coreHealthy
        : coreRatio > 0.25
          ? CYBER_PALETTE.coreWarn
          : CYBER_PALETTE.coreCritical;

    // Hard offset shadow
    g.fillStyle(CYBER_PALETTE.ink, 1);
    g.fillCircle(centerX + 5, centerY + 5, corePx);
    g.fillStyle(CYBER_PALETTE.coreFill, 1);
    g.fillCircle(centerX, centerY, corePx);
    g.lineStyle(4, CYBER_PALETTE.ink, 1);
    g.strokeCircle(centerX, centerY, corePx);

    // Core HP proportional fill ring
    if (coreRatio > 0) {
      g.lineStyle(7, coreColor, 1);
      g.beginPath();
      g.arc(
        centerX,
        centerY,
        corePx * 0.68,
        -Math.PI * 0.5,
        -Math.PI * 0.5 + coreRatio * Math.PI * 2,
        false,
        0,
      );
      g.strokePath();
    }
    // Inner technical cross
    g.lineStyle(2.5, CYBER_PALETTE.ink, 1);
    g.lineBetween(centerX - 10 * scale, centerY, centerX + 10 * scale, centerY);
    g.lineBetween(centerX, centerY - 10 * scale, centerX, centerY + 10 * scale);

    // 5. Kinetic Barricades (from auxState)
    if (hasAux) {
      for (let i = 0; i < AUX_LAYOUT.MAX_BARRICADES; i += 1) {
        const off = AUX_LAYOUT.BARRICADES_OFFSET + i * AUX_LAYOUT.BARRICADE_STRIDE;
        const hpPct = aux[off + 3] ?? 0;
        const bFlags = aux[off + 5] ?? 0;
        if (hpPct === 0 || (bFlags & BARRICADE_FLAG.ACTIVE) === 0) continue;
        const cx = aux[off] ?? 0;
        const cy = aux[off + 1] ?? 0;
        const owner = (aux[off + 2] ?? 0) & 7;
        const ttlSteps = aux[off + 4] ?? 0;
        const bx = centerX + cellCenter(cx) * scale;
        const by = centerY + cellCenter(cy) * scale;
        const half = cellPx * 0.5;
        const underAttack = (bFlags & BARRICADE_FLAG.UNDER_ATTACK) !== 0;

        g.fillStyle(CYBER_PALETTE.ink, 1);
        g.fillRect(bx - half + 3, by - half + 3, cellPx, cellPx);
        g.fillStyle(underAttack ? CYBER_PALETTE.barricadeWarn : CYBER_PALETTE.barricadeFill, 1);
        g.fillRect(bx - half, by - half, cellPx, cellPx);
        g.lineStyle(2.5, PLAYER_HEX[owner] ?? CYBER_PALETTE.ink, 1);
        g.strokeRect(bx - half, by - half, cellPx, cellPx);

        // TTL trim bar along top edge
        const ttlRatio = Math.min(1, ttlSteps / 160);
        g.fillStyle(CYBER_PALETTE.paper, 0.85);
        g.fillRect(bx - half + 2, by - half + 2, (cellPx - 4) * ttlRatio, 3);
      }
    }

    // 6. Enemies (monochromatic dark grays + bright safety-orange/warning-red telegraphs)
    if (hasAux) {
      let bruteCursor = 0;
      const bossWeakMask = aux[AUX_LAYOUT.META_BOSS_WEAK_MASK] ?? 0;
      const bossLaserU16 = readU16LE(aux, AUX_LAYOUT.META_BOSS_LASER_ANGLE);
      const bossLaserAngle = (bossLaserU16 / 65535) * Math.PI * 2;

      for (let i = 0; i < AUX_LAYOUT.MAX_ENEMIES; i += 1) {
        const off = AUX_LAYOUT.ENEMIES_OFFSET + i * AUX_LAYOUT.ENEMY_STRIDE;
        const hpPct = aux[off + 4] ?? 0;
        const type = aux[off + 5] ?? 0;
        if (hpPct === 0 || type === ENEMY_TYPE.EMPTY) continue;

        const ex = decodeCoordU16(readU16LE(aux, off));
        const ey = decodeCoordU16(readU16LE(aux, off + 2));
        const eFlags = (aux[off + 6] ?? 0) & 0x3f;
        const targetByte = aux[off + 7] ?? 0;
        const sectorHeading = decodeFacingSector4((targetByte >> 4) & 0x0f);
        let heading = sectorHeading;
        if ((type === ENEMY_TYPE.BRUTE || type === ENEMY_TYPE.BOSS) && bruteCursor < 32) {
          heading = decodeAngleU8(aux[AUX_LAYOUT.META_BRUTE_HEADING + bruteCursor] ?? 0);
          bruteCursor += 1;
        }

        const sx = centerX + ex * scale;
        const sy = centerY + ey * scale;
        const stunned = (eFlags & ENEMY_STATE_FLAG.STUNNED) !== 0;

        if (type === ENEMY_TYPE.BOSS) {
          let weakMask = bossWeakMask;
          let laserAngle = bossLaserAngle;
          let laserLen: number = C.bossLaserRange;
          for (let bs = 0; bs < C.maxBosses; bs += 1) {
            const bOff = AUX_LAYOUT.META_BOSS_SLOTS + bs * AUX_LAYOUT.META_BOSS_SLOT_STRIDE;
            if ((aux[bOff] ?? 0) === i + 1) {
              weakMask = aux[bOff + 1] ?? 0;
              laserAngle = (readU16LE(aux, bOff + 2) / 65535) * Math.PI * 2;
              laserLen = decodeBossLaserLenU16(
                readU16LE(aux, AUX_LAYOUT.META_BOSS_LASER_LEN + bs * 2),
              );
              break;
            }
          }

          const r = C.bossRadius * scale;
          const vulnerable = (weakMask & BOSS_WEAK_FLAG.VULNERABLE) !== 0;
          // Shadow + heavy octagon/circle Dreadnought hull
          g.fillStyle(CYBER_PALETTE.ink, 1);
          g.fillCircle(sx + 6, sy + 6, r);
          g.fillStyle(vulnerable ? CYBER_PALETTE.warningRed : CYBER_PALETTE.bossBody, 1);
          g.fillCircle(sx, sy, r);
          g.lineStyle(4, CYBER_PALETTE.ink, 1);
          g.strokeCircle(sx, sy, r);

          // Flank weak-point markers
          const perpX = -Math.sin(heading) * (r + 5);
          const perpY = Math.cos(heading) * (r + 5);
          g.fillStyle(
            (weakMask & BOSS_WEAK_FLAG.FLANK_A_HIT) !== 0
              ? CYBER_PALETTE.warningRed
              : CYBER_PALETTE.hazardOrange,
            1,
          );
          g.fillCircle(sx + perpX, sy + perpY, 6 * scale);
          g.fillCircle(sx - perpX, sy - perpY, 6 * scale);

          // Boss HP arc
          g.lineStyle(5, CYBER_PALETTE.warningRed, 1);
          g.beginPath();
          g.arc(sx, sy, r + 9, -Math.PI * 0.5, -Math.PI * 0.5 + (hpPct / 255) * Math.PI * 2, false, 0);
          g.strokePath();

          // Active laser sweep beam (terminated at blocking barricade or arena edge)
          if ((eFlags & ENEMY_STATE_FLAG.LASER_SWEEP) !== 0 && laserLen > 0) {
            const lx = sx + Math.cos(laserAngle) * laserLen * scale;
            const ly = sy + Math.sin(laserAngle) * laserLen * scale;
            g.lineStyle(8 * scale, CYBER_PALETTE.warningRed, 0.85);
            g.lineBetween(sx, sy, lx, ly);
            g.lineStyle(3 * scale, CYBER_PALETTE.paper, 0.9);
            g.lineBetween(sx, sy, lx, ly);
          }
        } else if (type === ENEMY_TYPE.BRUTE) {
          const r = C.bruteRadius * scale;
          const shieldUp = (eFlags & ENEMY_STATE_FLAG.SHIELD_UP) !== 0;
          const spun = (eFlags & ENEMY_STATE_FLAG.SPUN) !== 0;

          g.fillStyle(CYBER_PALETTE.ink, 1);
          g.fillCircle(sx + 4, sy + 4, r);
          g.fillStyle(stunned ? CYBER_PALETTE.empFill : CYBER_PALETTE.bruteBody, 1);
          g.fillCircle(sx, sy, r);
          g.lineStyle(3, CYBER_PALETTE.ink, 1);
          g.strokeCircle(sx, sy, r);

          // 120-degree bright safety-orange/red frontal arc shield
          if (shieldUp && !spun) {
            g.lineStyle(6 * scale, CYBER_PALETTE.warningRed, 1);
            g.beginPath();
            g.arc(sx, sy, r + 5 * scale, heading - Math.PI / 3, heading + Math.PI / 3, false, 0);
            g.strokePath();
          } else if (spun) {
            // Spun indicator ring
            g.lineStyle(3, CYBER_PALETTE.hazardOrange, 1);
            g.strokeCircle(sx, sy, r + 7 * scale);
          }
        } else if (type === ENEMY_TYPE.CARRIER) {
          const r = C.carrierRadius * scale;
          g.fillStyle(CYBER_PALETTE.carrierBody, 1);
          g.fillRect(sx - r, sy - r, r * 2, r * 2);
          g.lineStyle(3, CYBER_PALETTE.hazardOrange, 1);
          g.strokeRect(sx - r, sy - r, r * 2, r * 2);
        } else {
          // Drone / Fast Drone triangular wedge
          const r = (type === ENEMY_TYPE.FAST_DRONE ? C.fastDroneRadius : C.droneRadius) * scale;
          const cos = Math.cos(heading);
          const sin = Math.sin(heading);
          const tipX = sx + cos * r * 1.2;
          const tipY = sy + sin * r * 1.2;
          const leftX = sx + (-cos * 0.8 - sin * 0.85) * r;
          const leftY = sy + (-sin * 0.8 + cos * 0.85) * r;
          const rightX = sx + (-cos * 0.8 + sin * 0.85) * r;
          const rightY = sy + (-sin * 0.8 - cos * 0.85) * r;

          g.fillStyle(
            type === ENEMY_TYPE.FAST_DRONE ? CYBER_PALETTE.fastDroneBody : CYBER_PALETTE.droneBody,
            1,
          );
          g.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);
          g.lineStyle(2, CYBER_PALETTE.ink, 1);
          g.strokeTriangle(tipX, tipY, leftX, leftY, rightX, rightY);
          // Safety orange nose pip
          g.fillStyle(CYBER_PALETTE.hazardOrange, 1);
          g.fillCircle(tipX, tipY, 2.5 * scale);
        }
      }
    }

    // 7. Hitscan tracers, RAIL beams & shield deflection sparks
    if (hasAux) {
      for (let i = 0; i < AUX_LAYOUT.MAX_PROJECTILES; i += 1) {
        const off = AUX_LAYOUT.PROJECTILES_OFFSET + i * AUX_LAYOUT.PROJECTILE_STRIDE;
        const ttl = aux[off + 5] ?? 0;
        if (ttl === 0) continue;
        const ownerByte = aux[off + 4] ?? 0;
        if ((ownerByte & PROJECTILE_FLAG.ACTIVE) === 0) continue;
        const owner = ownerByte & 0x07;
        const tx = centerX + decodeCoordU16(readU16LE(aux, off)) * scale;
        const ty = centerY + decodeCoordU16(readU16LE(aux, off + 2)) * scale;

        if ((ownerByte & PROJECTILE_FLAG.BOSS_LASER) !== 0) continue;

        const pb = playerBase(owner);
        const px = centerX + (state[pb + CYBER_PLAYER_OFFSET.x] ?? 0) * scale;
        const py = centerY + (state[pb + CYBER_PLAYER_OFFSET.y] ?? 0) * scale;

        if ((ownerByte & PROJECTILE_FLAG.RAIL_BEAM) !== 0) {
          const alpha = Math.min(1, ttl / C.railTracerTicks);
          g.lineStyle(16 * scale, CYBER_PALETTE.ink, alpha * 0.9);
          g.lineBetween(px, py, tx, ty);
          g.lineStyle(10 * scale, PLAYER_HEX[owner] ?? CYBER_PALETTE.railBeam, alpha);
          g.lineBetween(px, py, tx, ty);
          g.lineStyle(4 * scale, 0xffffff, alpha * 0.8);
          g.lineBetween(px, py, tx, ty);
        } else if ((ownerByte & PROJECTILE_FLAG.SHIELD_SPARK) !== 0) {
          g.lineStyle(2, CYBER_PALETTE.hazardOrange, 0.9);
          g.lineBetween(tx - 6, ty - 6, tx + 6, ty + 6);
          g.lineBetween(tx - 6, ty + 6, tx + 6, ty - 6);
        } else {
          const alpha = Math.min(1, ttl / C.autoFireTracerTicks);
          g.lineStyle(2.5, CYBER_PALETTE.tracerInk, alpha * 0.75);
          g.lineBetween(px, py, tx, ty);
        }
      }
    }

    // 8. Players (minimum 24px world radius, high-contrast ink border, forward notch, revive ring)
    const pRadiusPx = C.playerRadius * scale;
    for (let s = 0; s < C.maxPlayers; s += 1) {
      const pb = playerBase(s);
      const flags = state[pb + CYBER_PLAYER_OFFSET.flags] ?? 0;
      if ((flags & CYBER_FLAG.JOINED) === 0) continue;
      if ((flags & CYBER_FLAG.RESPAWNING) !== 0) continue;

      const x = state[pb + CYBER_PLAYER_OFFSET.x] ?? 0;
      const y = state[pb + CYBER_PLAYER_OFFSET.y] ?? 0;
      const heading = state[pb + CYBER_PLAYER_OFFSET.heading] ?? 0;
      const hp = state[pb + CYBER_PLAYER_OFFSET.hp] ?? 0;
      const railCd = state[pb + CYBER_PLAYER_OFFSET.railCooldown] ?? 0;
      const revChan = state[pb + CYBER_PLAYER_OFFSET.reviveChannel] ?? 0;
      const isDowned = (flags & CYBER_FLAG.DOWNED) !== 0;
      const empJoined = (flags & CYBER_FLAG.EMP_JOINED) !== 0;

      const sx = centerX + x * scale;
      const sy = centerY + y * scale;
      const color = PLAYER_HEX[s] ?? CYBER_PALETTE.ink;

      // Hard offset shadow
      g.fillStyle(CYBER_PALETTE.ink, isDowned ? 0.45 : 1);
      g.fillCircle(sx + 4, sy + 4, pRadiusPx);

      // Player body
      g.fillStyle(color, isDowned ? 0.45 : 1);
      g.fillCircle(sx, sy, pRadiusPx);
      g.lineStyle(3, CYBER_PALETTE.ink, 1);
      g.strokeCircle(sx, sy, pRadiusPx);

      // Directional forward notch + faint 60-degree auto-fire sight ticks
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      const notchColor = color === CYBER_PALETTE.ink ? CYBER_PALETTE.paper : CYBER_PALETTE.ink;
      g.lineStyle(4, notchColor, 1);
      g.lineBetween(
        sx + cos * pRadiusPx * 0.25,
        sy + sin * pRadiusPx * 0.25,
        sx + cos * pRadiusPx * 0.92,
        sy + sin * pRadiusPx * 0.92,
      );

      if (!isDowned) {
        g.lineStyle(1.5, CYBER_PALETTE.ink, 0.22);
        const coneR = pRadiusPx * 2.0;
        g.lineBetween(
          sx + Math.cos(heading - Math.PI / 6) * pRadiusPx,
          sy + Math.sin(heading - Math.PI / 6) * pRadiusPx,
          sx + Math.cos(heading - Math.PI / 6) * coneR,
          sy + Math.sin(heading - Math.PI / 6) * coneR,
        );
        g.lineBetween(
          sx + Math.cos(heading + Math.PI / 6) * pRadiusPx,
          sy + Math.sin(heading + Math.PI / 6) * pRadiusPx,
          sx + Math.cos(heading + Math.PI / 6) * coneR,
          sy + Math.sin(heading + Math.PI / 6) * coneR,
        );
      }

      // EMP joined halo
      if (empJoined) {
        g.lineStyle(3, CYBER_PALETTE.empArcGlow, 1);
        g.strokeCircle(sx, sy, pRadiusPx + 6);
      }

      // Downed danger pulse or active revive channel progress ring
      if (isDowned) {
        const ringColor = revChan > 0 ? CYBER_PALETTE.reviveBeam : CYBER_PALETTE.warningRed;
        g.lineStyle(4, ringColor, pulse < 60 ? 1 : 0.45);
        g.strokeCircle(sx, sy, pRadiusPx + 6);
        if (revChan > 0) {
          g.lineStyle(5, CYBER_PALETTE.reviveBeam, 1);
          g.beginPath();
          g.arc(
            sx,
            sy,
            pRadiusPx + 10,
            -Math.PI * 0.5,
            -Math.PI * 0.5 + Math.min(1, revChan / C.reviveChannelSec) * Math.PI * 2,
            false,
            0,
          );
          g.strokePath();
        }
      } else if (railCd > 0) {
        // Subtle RAIL cooldown arc around player
        g.lineStyle(2.5, CYBER_PALETTE.ink, 0.7);
        g.beginPath();
        g.arc(
          sx,
          sy,
          pRadiusPx + 4,
          -Math.PI * 0.5,
          -Math.PI * 0.5 + (railCd / C.railCooldownSec) * Math.PI * 2,
          false,
          0,
        );
        g.strokePath();
      } else if (hp < C.playerMaxHp) {
        // Compact HP arc when wounded
        g.lineStyle(3, CYBER_PALETTE.hazardOrange, 0.9);
        g.beginPath();
        g.arc(
          sx,
          sy,
          pRadiusPx + 4,
          -Math.PI * 0.5,
          -Math.PI * 0.5 + Math.max(0, hp / C.playerMaxHp) * Math.PI * 2,
          false,
          0,
        );
        g.strokePath();
      }
    }

    // 9. Thick 4px #111111 Neo-Brutalist perimeter border + corner registration marks
    g.lineStyle(4, CYBER_PALETTE.ink, 1);
    g.strokeRect(originX, originY, arenaPx, arenaPx);
    const mark = 12;
    const gap = 8;
    g.lineStyle(2.5, CYBER_PALETTE.ink, 1);
    g.lineBetween(originX - gap, originY - gap, originX - gap + mark, originY - gap);
    g.lineBetween(originX - gap, originY - gap, originX - gap, originY - gap + mark);
    g.lineBetween(originX + arenaPx + gap, originY - gap, originX + arenaPx + gap - mark, originY - gap);
    g.lineBetween(originX + arenaPx + gap, originY - gap, originX + arenaPx + gap, originY - gap + mark);
    g.lineBetween(originX - gap, originY + arenaPx + gap, originX - gap + mark, originY + arenaPx + gap);
    g.lineBetween(originX - gap, originY + arenaPx + gap, originX - gap, originY + arenaPx + gap - mark);
    g.lineBetween(originX + arenaPx + gap, originY + arenaPx + gap, originX + arenaPx + gap - mark, originY + arenaPx + gap);
    g.lineBetween(originX + arenaPx + gap, originY + arenaPx + gap, originX + arenaPx + gap, originY + arenaPx + gap - mark);
  }

  return {
    draw,
    destroy(): void {
      gone = true;
      gfx = null;
      game.destroy(false, false);
    },
  };
}
