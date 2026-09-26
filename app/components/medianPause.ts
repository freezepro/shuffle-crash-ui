function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function medianValue(value: unknown): number | null {
  const n = finiteNumber(value);
  return n !== null && n >= 1 ? n : null;
}

export function frequencyValue(value: unknown): number | null {
  const n = finiteNumber(value);
  return n !== null && n >= 0 && n <= 1 ? n : null;
}

export function medianPause(med50: unknown, frequency: unknown) {
  const median = medianValue(med50);
  const rate = frequencyValue(frequency);
  const medianLow = median !== null && median < 2;
  const frequencyLow = rate !== null && rate < 0.1;
  const reasons = [
    medianLow ? "Med50 below 2.00x" : null,
    frequencyLow ? "10x frequency below 10% in the last 100 rounds" : null,
  ].filter(Boolean);
  const state = reasons.length ? "paused" : median === null || rate === null ? "unavailable" : "clear";
  const description = state === "paused"
    ? `PAUSE: ${reasons.join("; ")}. Paper-only exposure filter, not a prediction.`
    : state === "unavailable"
      ? "Pause indicator unavailable: waiting for current median and frequency data."
      : "Pause thresholds clear. This is not a signal to bet or evidence of an advantage.";
  return { state, medianLow, frequencyLow, description };
}
