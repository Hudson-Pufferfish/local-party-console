const PLAYER = 8;
const STRIDE = 10;
const SLOTS = 8;

export function shortTag(name: string, slot: number): string {
  let letters = '';
  const raw = name.toLowerCase();
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const digit = code >= 48 && code <= 57;
    const alpha = code >= 97 && code <= 122;
    if (!digit && !alpha) continue;
    letters += raw.charAt(index);
    if (letters.length === 2) break;
  }
  if (letters.length === 2) return letters;
  return `p${slot + 1}`;
}

export function scoreboardRows(state: Float32Array, names: readonly string[], win: number): string[] {
  const rows: string[] = [];
  for (let index = 0; index < SLOTS; index += 1) {
    const base = PLAYER + index * STRIDE;
    const flags = state[base + 8] ?? 0;
    const score = state[base + 9] ?? 0;
    const x = state[base] ?? 0;
    const y = state[base + 1] ?? 0;
    if ((flags & 1) === 0 && score === 0 && x === 0 && y === 0) continue;
    const tag = shortTag(names[index] ?? '', index);
    rows.push(`${tag} ${score}/${win}`);
  }
  return rows;
}

export function scoreboardLine(state: Float32Array, names: readonly string[], win: number): string {
  return scoreboardRows(state, names, win).join('  ');
}
