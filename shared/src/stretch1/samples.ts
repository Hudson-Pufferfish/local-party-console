export interface PointerSample {
  clientX: number;
  clientY: number;
  timeStamp: number;
}

export function pickPointerSample(
  fallback: PointerSample,
  coalesced: ArrayLike<PointerSample>,
  predicted: ArrayLike<PointerSample>,
): PointerSample {
  let chosen = fallback;
  if (coalesced.length > 0) {
    const last = coalesced[coalesced.length - 1];
    if (last !== undefined) chosen = last;
  }
  if (predicted.length > 0) {
    const next = predicted[predicted.length - 1];
    if (next !== undefined && next.timeStamp >= chosen.timeStamp) chosen = next;
  }
  return chosen;
}
