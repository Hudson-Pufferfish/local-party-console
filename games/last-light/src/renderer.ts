import Phaser from 'phaser';
import { resolveThemeHex } from '../../../shared/src/theme.ts';
import {
  LAMP_FLAG,
  LIGHT_HEADER as H,
  LIGHT_PHASE as P,
} from './constants.ts';
import { lampLuminance } from './dimmer.ts';

const PAPER_FALLBACK = '#F4F1EA';
const INK_FALLBACK = '#111111';
const GLOW_FALLBACK = '#FF6B2B';
const FILAMENT_FALLBACK = '#FFF4DC';
const SHADE_FALLBACK = '#22201E';
const BLACKOUT_FALLBACK = '#0D0D0D';
const DIM_BACKDROP = 0x262320;
const WHITE = 0xffffff;
const GLASS_OFF = 0x2c2a27;
const GLASS_LIT = 0xfff8e8;

function lerpHex(a: number, b: number, t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * clamped);
  const g = Math.round(ag + (bg - ag) * clamped);
  const bl = Math.round(ab + (bb - ab) * clamped);
  return (r << 16) | (g << 8) | bl;
}

export function createLastLightRenderer(
  canvas: HTMLCanvasElement,
  readState: () => Float32Array,
): { draw(): void; destroy(): void } {
  const paperHex = resolveThemeHex('--bg-surface', PAPER_FALLBACK);
  const inkHex = resolveThemeHex('--ink-primary', INK_FALLBACK);
  const glowHex = resolveThemeHex('--lamp-glow', GLOW_FALLBACK);
  const filamentHex = resolveThemeHex('--lamp-filament', FILAMENT_FALLBACK);
  const shadeHex = resolveThemeHex('--lamp-shade', SHADE_FALLBACK);
  const blackoutHex = resolveThemeHex('--lamp-blackout', BLACKOUT_FALLBACK);

  let board: Phaser.GameObjects.Graphics | null = null;
  let lastBlowoutCount = 0;
  let flashFrames = 0;
  let gone = false;

  class LastLightScene extends Phaser.Scene {
    constructor() {
      super('last-light-arena');
    }

    create(): void {
      board = this.add.graphics();
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
    backgroundColor: PAPER_FALLBACK,
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
    scene: LastLightScene,
    callbacks: {
      postBoot: () => {
        canvas.style.width = '';
        canvas.style.height = '';
      },
    },
  });

  function draw(): void {
    const gfx = board;
    if (gfx === null || gone) return;

    const state = readState();
    const tick = state[H.tick] ?? 0;
    const phase = state[H.phase] ?? P.countdown;
    const elapsed = state[H.lampElapsed] ?? 0;
    const lampFlags = (state[H.lampFlags] ?? 0) | 0;
    const blowouts = state[H.blowoutCount] ?? 0;

    if (blowouts > lastBlowoutCount) {
      flashFrames = 4;
    }
    lastBlowoutCount = blowouts;

    const lum = lampLuminance(phase, elapsed, lampFlags);
    const isFlicker = (lampFlags & LAMP_FLAG.flicker) !== 0;
    const isBlown = lum <= 0;

    const width = canvas.width > 0 ? canvas.width : 800;
    const height = canvas.height > 0 ? canvas.height : 800;
    const cx = width * 0.5;
    const bulbY = height * 0.54;
    const bulbR = Math.min(width, height) * 0.145;
    const shadeTopY = height * 0.24;
    const shadeBotY = bulbY - bulbR * 0.25;
    const shadeTopHalf = bulbR * 0.62;
    const shadeBotHalf = bulbR * 1.65;

    gfx.clear();

    // 1. Backdrop: shifts smoothly with dimming curve, snaps to deep blackout, flashes white on blowout beat.
    let bgColor = blackoutHex;
    if (flashFrames > 2) {
      bgColor = WHITE;
    } else if (!isBlown) {
      const normalized = (lum - 0.12) / 0.88;
      bgColor = lerpHex(DIM_BACKDROP, paperHex, normalized);
    }
    gfx.fillStyle(bgColor, 1);
    gfx.fillRect(0, 0, width, height);

    // Subtle matte frame border on the arena edge
    gfx.lineStyle(4, isBlown ? 0x262421 : inkHex, 1);
    gfx.strokeRect(2, 2, width - 4, height - 4);

    // 2. Concentric hard-edge Neo-Brutalist radial illumination bands (zero blur / zero soft shadows)
    if (!isBlown) {
      const pulse = 1 + Math.sin(tick * 0.22) * (isFlicker ? 0.05 : 0.015);
      const maxFieldR = Math.min(width, height) * (0.28 + lum * 0.23) * pulse;
      for (let ring = 4; ring >= 1; ring -= 1) {
        const frac = ring / 4;
        const r = bulbR * 1.15 + (maxFieldR - bulbR * 1.15) * frac;
        const ringColor = lerpHex(bgColor, glowHex, (1 - frac * 0.65) * (0.22 + lum * 0.55));
        gfx.fillStyle(ringColor, 1);
        gfx.fillCircle(cx, bulbY, r);
      }

      // Crisp geometric light-cone rays below the shade
      const coneBotY = height * 0.94;
      const coneHalfW = shadeBotHalf + (coneBotY - shadeBotY) * 0.52;
      gfx.lineStyle(2.5, lerpHex(bgColor, inkHex, 0.35), 1);
      gfx.lineBetween(cx - shadeBotHalf, shadeBotY, cx - coneHalfW, coneBotY);
      gfx.lineBetween(cx + shadeBotHalf, shadeBotY, cx + coneHalfW, coneBotY);
    }

    // 3. Ceiling mount plate & vertical conduit stem
    const mountW = 84;
    const mountH = 18;
    gfx.fillStyle(isBlown ? 0x1d1b19 : shadeHex, 1);
    gfx.fillRect(cx - mountW * 0.5, 0, mountW, mountH);
    gfx.lineStyle(3, inkHex, 1);
    gfx.strokeRect(cx - mountW * 0.5, 0, mountW, mountH);

    gfx.fillStyle(inkHex, 1);
    gfx.fillRect(cx - 7, mountH, 14, shadeTopY - mountH);

    // Socket collar
    gfx.fillStyle(isBlown ? 0x252320 : 0x3b3733, 1);
    gfx.fillRect(cx - 26, shadeTopY - 26, 52, 26);
    gfx.lineStyle(3, inkHex, 1);
    gfx.strokeRect(cx - 26, shadeTopY - 26, 52, 26);

    // 4. Glass bulb dome with hard ink outline & geometric glass refraction facets
    const bulbFill = isBlown
      ? (flashFrames > 0 ? WHITE : GLASS_OFF)
      : lerpHex(glowHex, GLASS_LIT, Math.min(1, lum * 0.85 + 0.15));

    // Hard offset shadow behind bulb when lit
    if (!isBlown) {
      gfx.fillStyle(inkHex, 1);
      gfx.fillCircle(cx + 7, bulbY + 7, bulbR);
    }

    gfx.fillStyle(bulbFill, 1);
    gfx.fillCircle(cx, bulbY, bulbR);
    gfx.lineStyle(4, isBlown ? 0x383430 : inkHex, 1);
    gfx.strokeCircle(cx, bulbY, bulbR);

    // Inner glass refraction facets (crisp diagonal geometric specular streaks)
    const facetColor = isBlown ? 0x45403b : WHITE;
    gfx.lineStyle(4, facetColor, 1);
    gfx.lineBetween(
      cx - bulbR * 0.56,
      bulbY + bulbR * 0.05,
      cx - bulbR * 0.28,
      bulbY + bulbR * 0.52,
    );
    gfx.lineStyle(2.5, facetColor, 1);
    gfx.lineBetween(
      cx + bulbR * 0.36,
      bulbY + bulbR * 0.16,
      cx + bulbR * 0.50,
      bulbY + bulbR * 0.44,
    );

    // 5. Filament coil (pulsating hot tungsten when LIT; snapped dead wire when BLOWN)
    const wireTopY = shadeBotY - 2;
    const coilY = bulbY + bulbR * 0.14;
    const stemHalf = bulbR * 0.24;
    gfx.lineStyle(3, isBlown ? 0x524c46 : inkHex, 1);
    gfx.lineBetween(cx - stemHalf, wireTopY, cx - stemHalf, coilY);
    gfx.lineBetween(cx + stemHalf, wireTopY, cx + stemHalf, coilY);

    if (!isBlown) {
      const hum = Math.sin(tick * 0.35) * (isFlicker ? 4 : 1.5);
      const coilColor = lerpHex(glowHex, filamentHex, lum);
      const coilWidth = 3 + lum * 4;
      gfx.lineStyle(coilWidth, coilColor, 1);
      gfx.beginPath();
      gfx.moveTo(cx - stemHalf, coilY);
      const zigSteps = 6;
      const stepW = (stemHalf * 2) / zigSteps;
      for (let step = 1; step <= zigSteps; step += 1) {
        const zx = cx - stemHalf + step * stepW;
        const zy = step === zigSteps
          ? coilY
          : coilY + (step % 2 === 1 ? -16 : 16) + hum;
        gfx.lineTo(zx, zy);
      }
      gfx.strokePath();

      // Hot filament core dot
      gfx.fillStyle(filamentHex, 1);
      gfx.fillCircle(cx, coilY, 6 + lum * 8);
    } else {
      // Snapped broken filament wires inside dead bulb
      gfx.lineStyle(2.5, 0x524c46, 1);
      gfx.lineBetween(cx - stemHalf, coilY, cx - stemHalf * 0.35, coilY + 12);
      gfx.lineBetween(cx + stemHalf, coilY, cx + stemHalf * 0.3, coilY - 10);

      // Brief blowout filament snap spark rays
      if (flashFrames > 0) {
        const sparkColor = flashFrames > 2 ? inkHex : glowHex;
        gfx.lineStyle(4, sparkColor, 1);
        for (let ray = 0; ray < 8; ray += 1) {
          const angle = (ray / 8) * Math.PI * 2 + 0.2;
          const r0 = bulbR * 1.12;
          const r1 = bulbR * 1.72;
          gfx.lineBetween(
            cx + Math.cos(angle) * r0,
            bulbY + Math.sin(angle) * r0,
            cx + Math.cos(angle) * r1,
            bulbY + Math.sin(angle) * r1,
          );
        }
      }
    }

    // 6. Heavy Industrial Trapezoidal Lamp Shade (drawn over top of bulb)
    // Hard offset Neo-Brutalist shadow
    if (!isBlown) {
      gfx.fillStyle(inkHex, 1);
      gfx.beginPath();
      gfx.moveTo(cx - shadeTopHalf + 8, shadeTopY + 8);
      gfx.lineTo(cx + shadeTopHalf + 8, shadeTopY + 8);
      gfx.lineTo(cx + shadeBotHalf + 8, shadeBotY + 8);
      gfx.lineTo(cx - shadeBotHalf + 8, shadeBotY + 8);
      gfx.closePath();
      gfx.fillPath();
    }

    gfx.fillStyle(isBlown ? 0x1a1816 : shadeHex, 1);
    gfx.beginPath();
    gfx.moveTo(cx - shadeTopHalf, shadeTopY);
    gfx.lineTo(cx + shadeTopHalf, shadeTopY);
    gfx.lineTo(cx + shadeBotHalf, shadeBotY);
    gfx.lineTo(cx - shadeBotHalf, shadeBotY);
    gfx.closePath();
    gfx.fillPath();

    gfx.lineStyle(4, isBlown ? 0x3b3733 : inkHex, 1);
    gfx.strokePath();

    // Industrial rim trim bar + crisp specular ridge on shade
    const rimH = 12;
    gfx.fillStyle(isBlown ? 0x262320 : lerpHex(shadeHex, glowHex, lum * 0.35), 1);
    gfx.fillRect(cx - shadeBotHalf, shadeBotY - rimH, shadeBotHalf * 2, rimH);
    gfx.lineStyle(3, isBlown ? 0x3b3733 : inkHex, 1);
    gfx.strokeRect(cx - shadeBotHalf, shadeBotY - rimH, shadeBotHalf * 2, rimH);

    // Ventilation slots on shade crown
    gfx.fillStyle(isBlown ? blackoutHex : lerpHex(glowHex, filamentHex, lum), 1);
    for (let slot = -1; slot <= 1; slot += 1) {
      gfx.fillRect(cx + slot * 26 - 7, shadeTopY + 18, 14, 24);
      gfx.lineStyle(2.5, inkHex, 1);
      gfx.strokeRect(cx + slot * 26 - 7, shadeTopY + 18, 14, 24);
    }

    if (flashFrames > 0) {
      flashFrames -= 1;
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
