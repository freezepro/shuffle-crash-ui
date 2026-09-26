export type MedianTrend = {
  available: true;
  asOfGameIndex: number;
  comparisonRounds: number;
  lowLookbackRounds: number;
  med50: { current: number; previous: number; delta: number };
  tail10: { currentPercent: number; previousPercent: number; deltaPp: number };
  recentLow: { percent: number; roundsAgo: number };
  recoveringFromLow: boolean;
};

export function readMedianTrend(value: unknown, med50: number | null, rate: number | null): MedianTrend | null {
  if (!value || typeof value !== "object" || med50 === null || rate === null) return null;
  const v = value as MedianTrend;
  const numbers = [v.asOfGameIndex, v.comparisonRounds, v.lowLookbackRounds,
    v.med50?.current, v.med50?.previous, v.med50?.delta,
    v.tail10?.currentPercent, v.tail10?.previousPercent, v.tail10?.deltaPp,
    v.recentLow?.percent, v.recentLow?.roundsAgo];
  if (v.available !== true || numbers.some(n => typeof n !== "number" || !Number.isFinite(n))
    || v.comparisonRounds !== 10 || v.lowLookbackRounds !== 50
    || !Number.isSafeInteger(v.asOfGameIndex) || v.med50.previous < 1
    || [v.tail10.currentPercent, v.tail10.previousPercent, v.recentLow.percent].some(n => !Number.isInteger(n) || n < 0 || n > 100)
    || !Number.isInteger(v.recentLow.roundsAgo) || v.recentLow.roundsAgo < 1 || v.recentLow.roundsAgo > 50
    || Math.abs(v.med50.current - med50) > .000001
    || Math.abs(v.tail10.currentPercent - rate * 100) > .000001
    || Math.abs(v.med50.delta - Number((Number(med50.toFixed(2)) - Number(v.med50.previous.toFixed(2))).toFixed(2))) > .000001
    || v.tail10.deltaPp !== v.tail10.currentPercent - v.tail10.previousPercent) return null;
  const recovering = v.med50.delta > 0 && v.tail10.deltaPp > 0 && v.recentLow.percent <= 5;
  if (v.recoveringFromLow !== recovering) return null;
  return v;
}

export function trendDescription(trend: MedianTrend, metric: "med50" | "tail10") {
  const comparison = metric === "med50"
    ? `Med50: ${trend.med50.previous.toFixed(2)}x to ${trend.med50.current.toFixed(2)}x`
    : `10x frequency: ${trend.tail10.previousPercent}% to ${trend.tail10.currentPercent}%`;
  const recovery = trend.recoveringFromLow
    ? ` Both have risen; the recent 10x low was ${trend.recentLow.percent}%, ${trend.recentLow.roundsAgo} rounds ago.`
    : "";
  return `${comparison} over ${trend.comparisonRounds} completed rounds.${recovery} Past movement only; it may reverse and does not override PAUSE.`;
}
