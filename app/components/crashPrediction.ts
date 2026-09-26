export const PREDICTION_HISTORY = 300;
export const PREDICTION_ALERT_THRESHOLD = 0.13;
export type CrashRound = { gameIndex: number; multiplier: number; timestamp: string };
export type CrashEstimate = { probability: number; rowMatches: number; gameIndex: number };

export function readCrashRound(raw: unknown): CrashRound | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(value.gameIndex) || (value.gameIndex as number) < 0 ||
      typeof value.multiplier !== "number" || !Number.isFinite(value.multiplier) || value.multiplier < 1 ||
      typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp))) return null;
  return { gameIndex: value.gameIndex as number, multiplier: value.multiplier, timestamp: value.timestamp };
}

export function mergeCrashHistory(snapshot: unknown, pending: CrashRound[] = []): CrashRound[] | null {
  if (!Array.isArray(snapshot) || snapshot.length !== PREDICTION_HISTORY) return null;
  const rounds = snapshot.map(readCrashRound);
  if (rounds.some((round) => !round)) return null;
  const sorted = (rounds as CrashRound[]).sort((a, b) => a.gameIndex - b.gameIndex);
  if (sorted.some((round, i) => i > 0 && round.gameIndex !== sorted[i - 1].gameIndex + 1)) return null;
  const byIndex = new Map(sorted.map((round) => [round.gameIndex, round]));
  for (const round of pending) {
    const previous = byIndex.get(round.gameIndex);
    if (previous && previous.multiplier !== round.multiplier) return null;
    if (round.gameIndex >= sorted[0].gameIndex) byIndex.set(round.gameIndex, round);
  }
  const merged = [...byIndex.values()].sort((a, b) => a.gameIndex - b.gameIndex);
  if (merged.some((round, i) => i > 0 && round.gameIndex !== merged[i - 1].gameIndex + 1)) return null;
  return merged.slice(-PREDICTION_HISTORY);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[24] + sorted[25]) / 2;
}

// Numerical parity with Limbo's limbo-neighbors-v3-10x-300, without its repeated
// walk-forward diagnostics. Only the latest estimate is needed on a live round.
export function estimateCrash(values: number[]): Omit<CrashEstimate, "gameIndex"> {
  if (values.length !== PREDICTION_HISTORY || values.some((v) => !Number.isFinite(v) || v < 1)) {
    throw new Error("Prediction requires 300 valid chronological rounds");
  }
  const features = (t: number) => {
    const last50 = values.slice(t - 50, t);
    const med = median(last50);
    const oldMedian = median(values.slice(t - 60, t - 10));
    let gap = 0;
    for (let j = t - 1; j >= t - 100 && values[j] < 10; j--) gap++;
    return [
      ...values.slice(t - 6, t).map((v) => Math.min(6, Math.log2(v)) / 6),
      Math.min(2, Math.log2(med)) / 2,
      last50.filter((v) => v >= 2).length / 50,
      last50.filter((v) => v < 1.35).length / 50,
      values.slice(t - 100, t).filter((v) => v >= 10).length / 100 * 3,
      Math.min(50, gap) / 50, Math.max(-1, Math.min(1, med - oldMedian)),
    ];
  };
  const query = features(values.length);
  const neighbors: Array<{ index: number; distance: number }> = [];
  // Historical outcomes have a 100-round embargo from the current context.
  for (let i = 100; i <= values.length - 101; i++) {
    const vector = features(i);
    const distance = vector.reduce((sum, v, k) => sum + (v - query[k]) ** 2, 0);
    neighbors.push({ index: i, distance });
  }
  neighbors.sort((a, b) => a.distance - b.distance || a.index - b.index);
  const chosen = neighbors.slice(0, 64);
  const hits = chosen.filter(({ index }) => values[index] >= 10).length;
  let rowMatches = 0;
  for (let age = 20; age <= 200; age += 20) {
    if (values[values.length - age] >= 9) rowMatches++;
  }
  return { probability: (hits + 128 * 0.099) / (chosen.length + 128), rowMatches };
}

export function predictionAlert(estimate: Pick<CrashEstimate, "probability" | "rowMatches">) {
  return estimate.rowMatches >= 3 || estimate.probability >= PREDICTION_ALERT_THRESHOLD;
}

export function rowColor(matches: number | null) {
  if (matches === null || matches < 2) return "#d1d5db";
  if (matches >= 5) return "#c4a1ff";
  return matches >= 3 ? "#22c55e" : "#fbbf24";
}

export function predictionColor(probability: number | null) {
  if (probability === null) return "#d1d5db";
  if (probability >= 0.113) return "#c4a1ff";
  if (probability > 0.1) return "#22c55e";
  return probability < 0.098 ? "#ff4d4f" : "#d1d5db";
}
