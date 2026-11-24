import Phaser from 'phaser';
import { PLAYER_COLORS } from '../../../shared/src/registry.ts';

const PUTTY = 0xeae6df;
const PLATE = 0xd6d1c7;
const INK = 0x111111;
const HAZARD = 0xff4d00;
const R0 = 400;
const PUCK_R = 28;
const DASH_MAX = 1.5;
const PLAYER = 8;
const STRIDE = 10;
const SHAKE_MAX = 0.5;
const SHAKE_DECAY = 0.25;

const PUCK = PLAYER_COLORS.map((color) => Number.parseInt(color.slice(1), 16));

interface Spark {
  x: number;
  y: number;
  life: number;
}

export function createSumoRenderer(
  canvas: HTMLCanvasElement,
  readState: () => Float32Array,
): { draw(): void; destroy(): void } {
  const sparks: Spark[] = [];
  for (let index = 0; index < 12; index += 1) sparks.push({ x: 0, y: 0, life: 0 });
  let board: Phaser.GameObjects.Graphics | null = null;
  let lastHit = 0;
  let shake = 0;
  let gone = false;

  class ArenaScene extends Phaser.Scene {
    constructor() {
      super('sumo-arena');
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
    scene: ArenaScene,
    callbacks: {
      postBoot: () => {
        canvas.style.width = '';
        canvas.style.height = '';
      },
    },
  });

  function draw(): void {
    const state = readState();
    const hit = state[6] ?? 0;
    if (hit > lastHit) {
      shake = SHAKE_MAX;
      armSparks(state, sparks);
    }
    lastHit = hit;
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
    const scale = (Math.min(centerX, centerY) - 24) / R0;
    const mag = shake > SHAKE_MAX ? SHAKE_MAX : shake;
    const ox = mag;
    const oy = mag * 0.5;
    const arena = (state[3] ?? R0) * scale;
    const target = (state[4] ?? R0) * scale;

    gfx.clear();
    gfx.fillStyle(PUTTY, 1);
    gfx.fillRect(0, 0, width, height);
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
    if (Math.abs(target - arena) > 1) {
      gfx.lineStyle(3, HAZARD, 1);
      for (let step = 0; step < 48; step += 2) {
        gfx.beginPath();
        gfx.arc(
          centerX + ox,
          centerY + oy,
          target,
          (step / 48) * Math.PI * 2,
          ((step + 1) / 48) * Math.PI * 2,
          false,
          0,
        );
        gfx.strokePath();
      }
    }

    const puck = PUCK_R * scale;
    for (let index = 0; index < 8; index += 1) {
      const base = PLAYER + index * STRIDE;
      const flags = state[base + 8] ?? 0;
      const score = state[base + 9] ?? 0;
      const x = state[base] ?? 0;
      const y = state[base + 1] ?? 0;
      if ((flags & 1) === 0 && score === 0 && x === 0 && y === 0) continue;
      const px = centerX + ox + x * scale;
      const py = centerY + oy + y * scale;
      const color = PUCK[index] ?? INK;
      gfx.fillStyle(INK, 1);
      gfx.fillCircle(px + 5, py + 5, puck);
      gfx.fillStyle(color, 1);
      gfx.fillCircle(px, py, puck);
      gfx.lineStyle(3, INK, 1);
      gfx.strokeCircle(px, py, puck);
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
      const cool = state[base + 5] ?? 0;
      if (cool > 0) {
        const sweep = (cool / DASH_MAX) * Math.PI * 2;
        gfx.lineStyle(4, HAZARD, 1);
        gfx.beginPath();
        gfx.arc(px, py, puck + 6, -Math.PI / 2, -Math.PI / 2 + sweep, false, 0);
        gfx.strokePath();
      }
    }

    gfx.fillStyle(HAZARD, 1);
    for (const spark of sparks) {
      if (spark.life <= 0) continue;
      gfx.fillRect(centerX + ox + spark.x * scale - 4, centerY + oy + spark.y * scale - 4, 8, 8);
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

function armSparks(state: Float32Array, sparks: Spark[]): void {
  let slot = 0;
  for (let index = 0; index < 8 && slot < sparks.length; index += 1) {
    const base = PLAYER + index * STRIDE;
    const stun = state[base + 7] ?? 0;
    const dash = state[base + 6] ?? 0;
    if (stun <= 0 && dash <= 0) continue;
    const x = state[base] ?? 0;
    const y = state[base + 1] ?? 0;
    for (let arm = 0; arm < 4 && slot < sparks.length; arm += 1) {
      const spark = sparks[slot];
      if (spark === undefined) return;
      const angle = (arm / 4) * Math.PI * 2;
      spark.x = x + Math.cos(angle) * 40;
      spark.y = y + Math.sin(angle) * 40;
      spark.life = 4;
      slot += 1;
    }
  }
}
