export type ButtonBit = 0 | 1 | 2 | 3;

export type ButtonGlyph = 'A' | 'B' | 'X' | 'Y';

export type ButtonKind = 'tap' | 'hold';

export interface ButtonSpec {
  readonly bit: ButtonBit;
  readonly glyph: ButtonGlyph;
  readonly label: string;
  readonly kind: ButtonKind;
  readonly cooldownMs?: number;
  readonly hapticMs?: number;
}

export type ControllerLayout =
  | {
      readonly preset: 'stick-single';
      readonly buttons: readonly [ButtonSpec];
    }
  | {
      readonly preset: 'stick-diamond';
      readonly buttons: readonly [ButtonSpec, ButtonSpec, ButtonSpec, ButtonSpec];
    }
  | {
      readonly preset: 'tap-only';
      readonly buttons: readonly [ButtonSpec];
    };
