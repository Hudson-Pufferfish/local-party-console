import Phaser from 'phaser';
import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import { readYellowTheme, resolveThemeHex } from '../../../shared/src/theme.ts';
import {
  BOMB_CONSTANTS as C,
  BOMB_FLAG_ALIVE,
  BOMB_FLAG_EXPLODED,
  BOMB_HEADER as H,
  BOMB_PLAYER_BASE as PLAYER,
  BOMB_PLAYER_STRIDE as STRIDE,
  BOMB_ROUND_FLAG as RF,
} from './constants.ts';

const PUTTY = 0xeae6df;
const PLATE = 0xd6d1c7;
const INK = 0x111111;
const PAPER = 0xf4f1ea;
const BOMB_RED_FALLBACK = '#E10600';
const SHAKE_TRANSFER = 0.35;
const SHAKE_EXPLOSION = 0.5;
const SHAKE_DECAY = 0.15;

const PUCK = PLAYER_COLORS.map((color) => Number.parseInt(color.slice(1), 16));

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export function createBombPassRenderer(
  canvas: HTMLCanvasElement,
  readState: () => Float32Array,
): { draw(): void; destroy(): void } {
  const theme = readYellowTheme();
  const bombRed = resolveThemeHex('--accent-bomb', BOMB_RED_FALLBACK);
  const sparks: Spark[] = [];
  for (let index = 0; index < 16; index += 1) {
    sparks.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  }
  let board: Phaser.GameObjects.Graphics | null = null;
  let lastHolder = -1;
  let lastAliveMask = 0;
  let shake = 0;
  let gone = false;

  class BombArenaScene extends Phaser.Scene {
    constructor() {
      super('bomb-pass-arena');
    }

    create(): void {
      board = this.add.graphics();
      if (!gone) draw();
    }
  }

  const size = canvas.width > 0 ? canvas.width : 800;
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    canvas,
    width: size,
    height: canvas.height > 0 ? canvas.height : 800,
    parent: null,
    backgroundColor: '#EAE6DF',
    banner: false,
    autoFocus: false,
    input: false,
    audio: { noAudio: true },
    scale: {
      mode: Phaser.Scale.NONE,
      parent: null,
      expandParent: false,
      width: size,
      height: canvas.height > 0 ? canvas.height : 800,
    },
    scene: BombArenaScene,
    callbacks: {
      postBoot: () => {
        canvas.style.width = '';
        canvas.style.height = '';
      },
    },
  });

  function draw(): void {
    const state = readState();
    const holder = Math.round(state[H.bombHolder] ?? -1);
    let aliveMask = 0;
    for (let index = 0; index < C.maxPlayers; index += 1) {
      const flags = state[PLAYER + index * STRIDE + 8] ?? 0;
      if ((flags & BOMB_FLAG_ALIVE) !== 0) aliveMask |= 1 << index;
    }

    // Detect transfer for sparks + nudge
    if (holder >= 0 && lastHolder >= 0 && holder !== lastHolder) {
      if (shake < SHAKE_TRANSFER) shake = SHAKE_TRANSFER;
      const base = PLAYER + holder * STRIDE;
      armSparks(state[base] ?? 0, state[base + 1] ?? 0, sparks, 8, 4);
    }

    // Detect explosion for sparks + stronger nudge
    const droppedMask = lastAliveMask & ~aliveMask;
    if (droppedMask !== 0) {
      for (let index = 0; index < C.maxPlayers; index += 1) {
        if ((droppedMask & (1 << index)) === 0) continue;
        const base = PLAYER + index * STRIDE;
        if (((state[base + 8] ?? 0) & BOMB_FLAG_EXPLODED) === 0) continue;
        shake = SHAKE_EXPLOSION;
        armSparks(state[base] ?? 0, state[base + 1] ?? 0, sparks, 12, 7);
        break;
      }
    }

    lastHolder = holder;
    lastAliveMask = aliveMask;

    paint();
    if (shake > 0) {
      shake = shake > SHAKE_DECAY ? shake - SHAKE_DECAY : 0;
    }
  }

  function paint(): void {
    const gfx = board;
    if (gfx === null || gone) return;
    const state = readState();
    const width = canvas.width > 0 ? canvas.width : 800;
    const height = canvas.height > 0 ? canvas.height : 800;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const arenaRaw = state[H.arenaRadius] > 0 ? state[H.arenaRadius] : C.arenaRadius;
    const scale = (Math.min(centerX, centerY) - 24) / C.arenaRadius;
    const ox = shake;
    const oy = shake * 0.5;
    const arena = arenaRaw * scale;

    gfx.clear();
    // Matte Warm Putty backdrop
    gfx.fillStyle(PUTTY, 1);
    gfx.fillRect(0, 0, width, height);

    // Circular Brushed Steel Plate + solid 4px bumper rim + 24 inward ticks
    gfx.fillStyle(PLATE, 1);
    gfx.fillCircle(centerX + ox, centerY + oy, arena);
    gfx.lineStyle(4, INK, 1);
    gfx.strokeCircle(centerX + ox, centerY + oy, arena);
    gfx.lineStyle(2, INK, 1);
    for (let step = 0; step < 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      gfx.lineBetween(
        centerX + ox + cos * (arena - 16),
        centerY + oy + sin * (arena - 16),
        centerX + ox + cos * (arena - 2),
        centerY + oy + sin * (arena - 2),
      );
    }

    const puck = C.puckRadius * scale;
    const holder = Math.round(state[H.bombHolder] ?? -1);
    const bombTimer = state[H.bombTimer] ?? 0;
    const transferCooldown = state[H.transferCooldown] ?? 0;
    const roundSD = (((state[H.roundFlags] ?? 0) | 0) & RF.roundSuddenDeath) !== 0;
    const fuseMax = roundSD ? C.suddenDeathFuse : C.fuseDuration;
    const tick = state[H.tick] ?? 0;

    // 1. Draw explosion shockwaves and blast craters behind live pucks
    for (let index = 0; index < C.maxPlayers; index += 1) {
      const base = PLAYER + index * STRIDE;
      const flags = state[base + 8] ?? 0;
      const effect = state[base + 7] ?? 0;
      if ((flags & BOMB_FLAG_EXPLODED) === 0 || effect <= 0) continue;
      const bx = centerX + ox + (state[base] ?? 0) * scale;
      const by = centerY + oy + (state[base + 1] ?? 0) * scale;
      const progress = Math.min(1, Math.max(0, 1 - effect / C.blastBreather));
      const blastR = (C.puckRadius + (C.blastRadius - C.puckRadius) * progress) * scale;

      // Hard-edged expanding Signal Red blast shockwave ring
      gfx.lineStyle(5, bombRed, 1);
      gfx.strokeCircle(bx, by, blastR);
      gfx.lineStyle(2, INK, 1);
      gfx.strokeCircle(bx, by, blastR + 3);

      // Crisp X crater stamp at detonation point
      const cross = 14 * scale;
      gfx.lineStyle(4, INK, 1);
      gfx.lineBetween(bx - cross, by - cross, bx + cross, by + cross);
      gfx.lineBetween(bx + cross, by - cross, bx - cross, by + cross);
    }

    // 2. Draw all ALIVE pucks
    for (let index = 0; index < C.maxPlayers; index += 1) {
      const base = PLAYER + index * STRIDE;
      const flags = state[base + 8] ?? 0;
      if ((flags & BOMB_FLAG_ALIVE) === 0) continue;
      const px = centerX + ox + (state[base] ?? 0) * scale;
      const py = centerY + oy + (state[base + 1] ?? 0) * scale;
      const color = PUCK[index] ?? INK;

      // Hard Neo-Brutalist +5px offset shadow
      gfx.fillStyle(INK, 1);
      gfx.fillCircle(px + 5, py + 5, puck);

      // Puck body + 3px ink stroke
      gfx.fillStyle(color, 1);
      gfx.fillCircle(px, py, puck);
      gfx.lineStyle(3, INK, 1);
      gfx.strokeCircle(px, py, puck);

      // Directional nose wedge
      const angle = state[base + 4] ?? 0;
      const ax = Math.cos(angle);
      const ay = Math.sin(angle);
      gfx.fillStyle(color === INK ? PUTTY : INK, 1);
      gfx.fillTriangle(
        px + ax * puck,
        py + ay * puck,
        px + ax * puck * 0.15 - ay * puck * 0.55,
        py + ay * puck * 0.15 + ax * puck * 0.55,
        px + ax * puck * 0.15 + ay * puck * 0.55,
        py + ay * puck * 0.15 - ax * puck * 0.55,
      );

      // Radial DASH cooldown arc
      const cool = state[base + 5] ?? 0;
      if (cool > 0) {
        const sweep = (cool / C.dashCooldown) * Math.PI * 2;
        gfx.lineStyle(4, theme.dash, 1);
        gfx.beginPath();
        gfx.arc(px, py, puck + 6, -Math.PI / 2, -Math.PI / 2 + sweep, false, 0);
        gfx.strokePath();
      }

      // 3. Active bomb holder overlays (pulsing red halo, depleting fuse arc + spark, red core badge, lockout ring)
      if (index === holder) {
        const pulseHz = bombTimer <= C.criticalThreshold ? 8 : bombTimer <= C.warnThreshold ? 3 : 1;
        const pulseOn = Math.floor((tick / 120) * pulseHz * 2) % 2 === 0;

        // Concentric Signal Red warning halo
        const haloR = puck + (pulseOn ? 14 : 11);
        gfx.lineStyle(pulseOn ? 5 : 3, bombRed, 1);
        gfx.strokeCircle(px, py, haloR);

        // Clockwise depleting fuse arc
        const ratio = fuseMax > 0 ? Math.min(1, Math.max(0, bombTimer / fuseMax)) : 0;
        const startA = -Math.PI / 2;
        const endA = startA + ratio * Math.PI * 2;
        const fuseR = puck + 20;
        if (ratio > 0.005) {
          gfx.lineStyle(5, bombRed, 1);
          gfx.beginPath();
          gfx.arc(px, py, fuseR, startA, endA, false, 0);
          gfx.strokePath();

          // Hard-edged sparking square at fuse tip
          const tipX = px + Math.cos(endA) * fuseR;
          const tipY = py + Math.sin(endA) * fuseR;
          const sparkSize = pulseOn ? 10 : 7;
          gfx.fillStyle(pulseOn ? theme.spark : theme.hazard, 1);
          gfx.lineStyle(2, INK, 1);
          gfx.fillRect(tipX - sparkSize * 0.5, tipY - sparkSize * 0.5, sparkSize, sparkSize);
          gfx.strokeRect(tipX - sparkSize * 0.5, tipY - sparkSize * 0.5, sparkSize, sparkSize);
        }

        // Pulsed hard-edged red core bomb badge
        const badgeR = puck * (pulseOn ? 0.44 : 0.34);
        gfx.fillStyle(bombRed, 1);
        gfx.fillCircle(px, py, badgeR);
        gfx.lineStyle(2.5, INK, 1);
        gfx.strokeCircle(px, py, badgeR);

        // Crisp dashed #111111 / #F4F1EA transfer lockout ring while transferCooldown > 0
        if (transferCooldown > 0) {
          const lockR = puck + 27;
          const segments = 16;
          for (let seg = 0; seg < segments; seg += 1) {
            const a0 = (seg / segments) * Math.PI * 2;
            const a1 = ((seg + 0.75) / segments) * Math.PI * 2;
            gfx.lineStyle(3, seg % 2 === 0 ? INK : PAPER, 1);
            gfx.beginPath();
            gfx.arc(px, py, lockR, a0, a1, false, 0);
            gfx.strokePath();
          }
        }
      }
    }

    // 4. Hard-edged square yellow transfer / explosion sparks
    gfx.fillStyle(theme.spark, 1);
    gfx.lineStyle(2, INK, 1);
    for (const spark of sparks) {
      if (spark.life <= 0) continue;
      spark.x += spark.vx;
      spark.y += spark.vy;
      const sx = centerX + ox + spark.x * scale - 4;
      const sy = centerY + oy + spark.y * scale - 4;
      gfx.fillRect(sx, sy, 8, 8);
      gfx.strokeRect(sx, sy, 8, 8);
      spark.life -= 1;
    }
  }

  return {
    draw,
    destroy(): void {
      gone = true;
      board = null;
      game.destroy(false, false);
    },
  };
}

function armSparks(
  x: number,
  y: number,
  sparks: Spark[],
  count: number,
  life: number,
): void {
  const limit = count < sparks.length ? count : sparks.length;
  for (let i = 0; i < limit; i += 1) {
    const spark = sparks[i];
    if (spark === undefined) return;
    const angle = (i / limit) * Math.PI * 2;
    spark.x = x + Math.cos(angle) * 28;
    spark.y = y + Math.sin(angle) * 28;
    spark.vx = Math.cos(angle) * 6;
    spark.vy = Math.sin(angle) * 6;
    spark.life = life;
  }
}
