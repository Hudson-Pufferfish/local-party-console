import Phaser from 'phaser';
import { PLAYER_COLORS } from '../../../shared/src/registry.ts';
import { readYellowTheme } from '../../../shared/src/theme.ts';
import {
  COLOR_CLASH_CONSTANTS as C,
  FLAG_ACTIVE,
  PHASE_OVERTIME,
} from './constants.ts';

const PAPER = 0xf4f1ea;
const UNPAINTED_HEX = 0xcfc9be;
const GRID_LINE = 0xb8b1a4;
const INK = 0x111111;
const PLAYER = 8;
const STRIDE = 10;
const SHAKE_MAX = 0.5;
const SHAKE_DECAY = 0.25;
const SPLATTER_POOL = 24;

const PUCK_HEX = PLAYER_COLORS.map((color) => Number.parseInt(color.slice(1), 16));

interface Splatter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  life: number;
}

const LITTLE_ENDIAN = (() => {
  const probe = new Uint32Array([0x11223344]);
  return new Uint8Array(probe.buffer)[0] === 0x44;
})();

function packHex(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  if (LITTLE_ENDIAN) {
    return (0xff << 24) | (b << 16) | (g << 8) | r;
  }
  return (r << 24) | (g << 16) | (b << 8) | 0xff;
}

const PALETTE_U32 = new Uint32Array(9);
PALETTE_U32[0] = packHex(UNPAINTED_HEX);
for (let index = 0; index < 8; index += 1) {
  PALETTE_U32[index + 1] = packHex(PUCK_HEX[index] ?? INK);
}

let textureNonce = 0;

export function createColorClashRenderer(
  canvas: HTMLCanvasElement,
  readState: () => Float32Array,
  readAux?: () => Uint8Array | null,
): { draw(): void; destroy(): void } {
  const theme = readYellowTheme();
  const splatters: Splatter[] = [];
  for (let index = 0; index < SPLATTER_POOL; index += 1) {
    splatters.push({ x: 0, y: 0, vx: 0, vy: 0, color: INK, life: 0 });
  }

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = C.gridSize;
  gridCanvas.height = C.gridSize;
  const gridCtx = gridCanvas.getContext('2d');
  const gridImage = gridCtx !== null ? gridCtx.createImageData(C.gridSize, C.gridSize) : null;
  const gridPixels = gridImage !== null ? new Uint32Array(gridImage.data.buffer) : null;
  if (gridPixels !== null) {
    gridPixels.fill(PALETTE_U32[0] ?? 0);
    gridCtx?.putImageData(gridImage!, 0, 0);
  }

  textureNonce += 1;
  const texKey = `color-clash-grid-${textureNonce}`;
  let gridTexture: Phaser.Textures.CanvasTexture | null = null;
  let gridSprite: Phaser.GameObjects.Image | null = null;
  let overlay: Phaser.GameObjects.Graphics | null = null;
  let lastHit = 0;
  let shake = 0;
  let pulsePhase = 0;
  let splatterCursor = 0;
  let gone = false;

  class ColorArenaScene extends Phaser.Scene {
    constructor() {
      super('color-clash-arena');
    }

    create(): void {
      gridTexture = this.textures.addCanvas(texKey, gridCanvas);
      if (gridTexture !== null) {
        gridTexture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        gridSprite = this.add.image(0, 0, texKey);
        gridSprite.setOrigin(0, 0);
      }
      overlay = this.add.graphics();
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
    pixelArt: true,
    antialias: false,
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
    scene: ColorArenaScene,
    callbacks: {
      postBoot: () => {
        canvas.style.width = '';
        canvas.style.height = '';
      },
    },
  });

  function spawnSplatter(x: number, y: number, angle: number, color: number): void {
    const particle = splatters[splatterCursor];
    splatterCursor = (splatterCursor + 1) % SPLATTER_POOL;
    if (particle === undefined) return;
    const spread = ((splatterCursor % 5) - 2) * 0.25;
    const dir = angle + Math.PI + spread;
    particle.x = x;
    particle.y = y;
    particle.vx = Math.cos(dir) * 5;
    particle.vy = Math.sin(dir) * 5;
    particle.color = color;
    particle.life = 6;
  }

  function updateGridTexture(aux: Uint8Array | null): void {
    if (gridPixels === null || gridCtx === null || gridImage === null || gridTexture === null) return;
    const fallback = PALETTE_U32[0] ?? 0;
    if (aux === null || aux.length < C.gridCells) {
      gridPixels.fill(fallback);
    } else {
      for (let c = 0; c < C.gridCells; c += 1) {
        const owner = aux[c] ?? 0;
        gridPixels[c] = owner <= 8 ? (PALETTE_U32[owner] ?? fallback) : fallback;
      }
    }
    gridCtx.putImageData(gridImage, 0, 0);
    gridTexture.refresh();
  }

  function draw(): void {
    if (gone) return;
    const state = readState();
    const hit = state[6] ?? 0;
    if (hit > lastHit) {
      shake = SHAKE_MAX;
    }
    lastHit = hit;
    if (hit > 0) {
      if (shake > 0) shake = shake > SHAKE_DECAY ? shake - SHAKE_DECAY : 0;
      return;
    }
    pulsePhase = (pulsePhase + 1) % 60;
    paint(state, readAux ? readAux() : null);
    if (shake > 0) {
      shake = shake > SHAKE_DECAY ? shake - SHAKE_DECAY : 0;
    }
  }

  function paint(state: Float32Array, aux: Uint8Array | null): void {
    const gfx = overlay;
    if (gfx === null || gone) return;

    const width = canvas.width > 0 ? canvas.width : 800;
    const height = canvas.height > 0 ? canvas.height : 800;
    const pad = 24;
    const arenaPx = Math.max(80, Math.min(width, height) - pad * 2);
    const scale = arenaPx / C.arenaSize;
    const mag = shake > SHAKE_MAX ? SHAKE_MAX : shake;
    const ox = mag;
    const oy = mag * 0.5;
    const originX = (width - arenaPx) * 0.5 + ox;
    const originY = (height - arenaPx) * 0.5 + oy;
    const centerX = originX + arenaPx * 0.5;
    const centerY = originY + arenaPx * 0.5;
    const cellPx = arenaPx / C.gridSize;

    updateGridTexture(aux);
    if (gridSprite !== null) {
      gridSprite.setPosition(originX, originY);
      gridSprite.setDisplaySize(arenaPx, arenaPx);
    }

    gfx.clear();

    // Subtle 1px grid seams
    gfx.lineStyle(1, GRID_LINE, 1);
    for (let i = 1; i < C.gridSize; i += 1) {
      const offset = i * cellPx;
      gfx.lineBetween(originX + offset, originY, originX + offset, originY + arenaPx);
      gfx.lineBetween(originX, originY + offset, originX + arenaPx, originY + offset);
    }

    // Subtle corner ticks on P8 (#F4F1EA) cells for contrast against paper chrome
    if (aux !== null && aux.length >= C.gridCells) {
      gfx.fillStyle(INK, 1);
      for (let row = 0; row < C.gridSize; row += 1) {
        const rowOff = row * C.gridSize;
        for (let col = 0; col < C.gridSize; col += 1) {
          if (aux[rowOff + col] !== 8) continue;
          const cx = originX + col * cellPx;
          const cy = originY + row * cellPx;
          gfx.fillRect(cx + 2, cy + 2, 3, 3);
        }
      }
    }

    // Thick 4px #111111 square wall & corner registration marks
    gfx.lineStyle(4, INK, 1);
    gfx.strokeRect(originX, originY, arenaPx, arenaPx);
    const mark = 12;
    const gap = 8;
    gfx.lineStyle(2.5, INK, 1);
    // Top-left
    gfx.lineBetween(originX - gap, originY - gap, originX - gap + mark, originY - gap);
    gfx.lineBetween(originX - gap, originY - gap, originX - gap, originY - gap + mark);
    // Top-right
    gfx.lineBetween(originX + arenaPx + gap, originY - gap, originX + arenaPx + gap - mark, originY - gap);
    gfx.lineBetween(originX + arenaPx + gap, originY - gap, originX + arenaPx + gap, originY - gap + mark);
    // Bottom-left
    gfx.lineBetween(originX - gap, originY + arenaPx + gap, originX - gap + mark, originY + arenaPx + gap);
    gfx.lineBetween(originX - gap, originY + arenaPx + gap, originX - gap, originY + arenaPx + gap - mark);
    // Bottom-right
    gfx.lineBetween(originX + arenaPx + gap, originY + arenaPx + gap, originX + arenaPx + gap - mark, originY + arenaPx + gap);
    gfx.lineBetween(originX + arenaPx + gap, originY + arenaPx + gap, originX + arenaPx + gap, originY + arenaPx + gap - mark);

    // Overtime Golden Tile crosshair
    const phase = state[1] ?? 0;
    const golden = Math.trunc(state[4] ?? -1);
    if (phase === PHASE_OVERTIME && golden >= 0 && golden < C.gridCells) {
      const gCol = golden % C.gridSize;
      const gRow = (golden - gCol) / C.gridSize;
      const gx = originX + gCol * cellPx;
      const gy = originY + gRow * cellPx;
      const padPulse = pulsePhase < 30 ? 3 : 6;
      gfx.fillStyle(theme.spark, 1);
      gfx.fillRect(gx, gy, cellPx, cellPx);
      gfx.lineStyle(3, INK, 1);
      gfx.strokeRect(gx - padPulse, gy - padPulse, cellPx + padPulse * 2, cellPx + padPulse * 2);
      const midX = gx + cellPx * 0.5;
      const midY = gy + cellPx * 0.5;
      gfx.lineBetween(midX - cellPx * 0.65, midY, midX + cellPx * 0.65, midY);
      gfx.lineBetween(midX, midY - cellPx * 0.65, midX, midY + cellPx * 0.65);
    }

    // Hard-edged square splatter particles (pooled, zero allocations)
    gfx.lineStyle(2, INK, 1);
    for (let i = 0; i < SPLATTER_POOL; i += 1) {
      const p = splatters[i];
      if (p === undefined || p.life <= 0) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;
      const sx = centerX + p.x * scale - 4;
      const sy = centerY + p.y * scale - 4;
      gfx.fillStyle(p.color, 1);
      gfx.fillRect(sx, sy, 8, 8);
      gfx.strokeRect(sx, sy, 8, 8);
    }

    // Active pucks
    const puckPx = C.puckRadius * scale;
    const boostRingPx = C.boostPaintRadius * scale;
    for (let index = 0; index < C.maxPlayers; index += 1) {
      const base = PLAYER + index * STRIDE;
      const flags = state[base + 8] ?? 0;
      if ((flags & FLAG_ACTIVE) === 0) continue;

      const x = state[base] ?? 0;
      const y = state[base + 1] ?? 0;
      const angle = state[base + 4] ?? 0;
      const boostCooldown = state[base + 5] ?? 0;
      const boostActive = state[base + 6] ?? 0;
      const px = centerX + x * scale;
      const py = centerY + y * scale;
      const color = PUCK_HEX[index] ?? INK;

      if (boostActive > 0) {
        // Dashed yellow wide-trail brush ring
        gfx.lineStyle(3, theme.base, 1);
        const segments = 24;
        for (let step = 0; step < segments; step += 2) {
          gfx.beginPath();
          gfx.arc(
            px,
            py,
            boostRingPx,
            (step / segments) * Math.PI * 2,
            ((step + 1) / segments) * Math.PI * 2,
            false,
            0,
          );
          gfx.strokePath();
        }
        if (pulsePhase % 3 === 0) {
          spawnSplatter(x, y, angle, color);
        }
      }

      // Hard offset shadow (+5px, +5px)
      gfx.fillStyle(INK, 1);
      gfx.fillCircle(px + 5, py + 5, puckPx);

      // Puck body + 3px ink border
      gfx.fillStyle(color, 1);
      gfx.fillCircle(px, py, puckPx);
      gfx.lineStyle(3, INK, 1);
      gfx.strokeCircle(px, py, puckPx);

      // Directional paint-roller nose bar
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = px + cos * (puckPx * 0.62);
      const ny = py + sin * (puckPx * 0.62);
      const perpX = -sin * (puckPx * 0.45);
      const perpY = cos * (puckPx * 0.45);
      gfx.lineStyle(4, color === INK ? PAPER : INK, 1);
      gfx.lineBetween(nx - perpX, ny - perpY, nx + perpX, ny + perpY);

      // Radial BOOST active / cooldown arc
      if (boostActive > 0) {
        const sweep = (boostActive / C.boostActive) * Math.PI * 2;
        gfx.lineStyle(4, theme.base, 1);
        gfx.beginPath();
        gfx.arc(px, py, puckPx + 6, -Math.PI * 0.5, -Math.PI * 0.5 + sweep, false, 0);
        gfx.strokePath();
      } else if (boostCooldown > 0) {
        const sweep = (boostCooldown / C.boostCooldown) * Math.PI * 2;
        gfx.lineStyle(3, INK, 1);
        gfx.beginPath();
        gfx.arc(px, py, puckPx + 5, -Math.PI * 0.5, -Math.PI * 0.5 + sweep, false, 0);
        gfx.strokePath();
      }
    }
  }

  return {
    draw,
    destroy(): void {
      gone = true;
      overlay = null;
      gridSprite = null;
      gridTexture = null;
      game.destroy(false, false);
    },
  };
}
