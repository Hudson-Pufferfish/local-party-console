export type BotDifficulty = 'easy' | 'medium' | 'hard';

export type BotDifficultyRange = readonly [number, number];

export type BotScoreRng = () => number;

export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'medium';

export const BOT_DIFFICULTY_RANGES: Readonly<Record<BotDifficulty, BotDifficultyRange>> = {
  easy: [20, 30],
  medium: [30, 50],
  hard: [50, 70],
};

export function assignBotScores(
  count: number,
  difficulty: BotDifficulty,
  rng: BotScoreRng = Math.random,
): number[] {
  if (!Number.isFinite(count)) return [];
  const requested = Math.trunc(count);
  if (requested <= 0) return [];

  const [min, max] = BOT_DIFFICULTY_RANGES[difficulty];
  const poolSize = max - min + 1;
  if (poolSize <= 0) return [];

  const pool = new Array<number>(poolSize);
  for (let index = 0; index < poolSize; index += 1) {
    pool[index] = min + index;
  }

  const take = requested < poolSize ? requested : poolSize;
  for (let index = 0; index < take; index += 1) {
    const remaining = poolSize - index;
    const raw = rng();
    let offset = Number.isFinite(raw) ? Math.floor(raw * remaining) : 0;
    if (offset < 0) offset = 0;
    if (offset >= remaining) offset = remaining - 1;
    const pick = index + offset;
    const current = pool[index] ?? min;
    pool[index] = pool[pick] ?? min;
    pool[pick] = current;
  }

  return pool.slice(0, take);
}
