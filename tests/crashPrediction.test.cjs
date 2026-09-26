const assert = require("node:assert/strict");
const test = require("node:test");
const { estimateCrash, mergeCrashHistory, readCrashRound, predictionAlert, rowColor, predictionColor } = require("./loadTs.cjs")("crashPrediction");
const rounds = () => Array.from({ length: 300 }, (_, i) => ({ gameIndex: i + 1, multiplier: 2, timestamp: "2026-09-25T12:00:00.000Z" }));

function valuesFor(seed) {
  let state = seed;
  return Array.from({ length: 300 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.max(1, Math.floor(99 / (1 - state / 2 ** 32)) / 100);
  });
}

test("matches frozen Limbo v3 forecasts, not a new probability heuristic", () => {
  const probabilities = [.09204166666666667, .08683333333333333, .09725, .12329166666666667,
    .10245833333333333, .112875, .10245833333333333, .09204166666666667];
  const matches = [2, 1, 1, 2, 1, 0, 1, 1];
  probabilities.forEach((probability, i) => {
    const result = estimateCrash(valuesFor(i + 1));
    assert.equal(result.probability, probability);
    assert.equal(result.rowMatches, matches[i]);
  });
});

test("20R aligns the upcoming round, not the latest completed one", () => {
  const values = Array(300).fill(1);
  for (let age = 20; age <= 200; age += 20) values[300 - age] = 9;
  assert.equal(estimateCrash(values).rowMatches, 10);
  assert.equal(estimateCrash(values).probability, 128 * .099 / 192, "9x does not count as a 10x outcome");
  const shifted = [1, ...values.slice(0, -1)];
  assert.equal(estimateCrash(shifted).rowMatches, 0);
  values[99] = 100;
  values[299] = 100;
  assert.equal(estimateCrash(values).rowMatches, 10, "outside the 10 slots is not counted");
});

test("invalid, missing and excess history is not silently used", () => {
  for (const values of [Array(299).fill(1), Array(301).fill(1), [...Array(299).fill(1), NaN], Array(300).fill(.9)]) {
    assert.throws(() => estimateCrash(values));
  }
  assert.equal(readCrashRound({ ...rounds()[0], gameIndex: "1" }), null);
  assert.equal(readCrashRound({ ...rounds()[0], timestamp: "bad" }), null);
  assert.equal(readCrashRound({ ...rounds()[0], multiplier: Infinity }), null);
});

test("snapshot uses actual gameIndex, merges racing live events, and ignores older ones", () => {
  const snapshot = rounds();
  const merged = mergeCrashHistory(snapshot.reverse(), [
    { ...snapshot[0], gameIndex: 301, multiplier: 15 },
    { ...snapshot[0], gameIndex: 302, multiplier: 1.23 },
    { ...snapshot[0], gameIndex: 0 },
  ]);
  assert.equal(merged.length, 300);
  assert.equal(merged[0].gameIndex, 3);
  assert.equal(merged.at(-1).gameIndex, 302);
  assert.equal(merged.at(-1).multiplier, 1.23);
});

test("holes, duplicate indexes and conflicting outcomes force a resync", () => {
  const snapshot = rounds();
  assert.equal(mergeCrashHistory(snapshot.slice(1)), null);
  assert.equal(mergeCrashHistory(snapshot, [{ ...snapshot[0], gameIndex: 302 }]), null);
  assert.equal(mergeCrashHistory(snapshot, [{ ...snapshot[10], multiplier: 20 }]), null);
  snapshot[100] = snapshot[99];
  assert.equal(mergeCrashHistory(snapshot), null);
});

test("alert gates use raw >=13% or 20R>=3 and colors remain separate", () => {
  assert.equal(predictionAlert({ probability: .129999, rowMatches: 2 }), false);
  assert.equal(predictionAlert({ probability: .13, rowMatches: 2 }), true);
  assert.equal(predictionAlert({ probability: .08, rowMatches: 3 }), true);
  assert.equal(rowColor(2), "#fbbf24");
  assert.equal(rowColor(3), "#22c55e");
  assert.equal(rowColor(4), "#22c55e");
  assert.equal(rowColor(5), "#c4a1ff");
  assert.equal(predictionColor(.097), "#ff4d4f");
  assert.equal(predictionColor(.1), "#d1d5db");
  assert.equal(predictionColor(.101), "#22c55e");
  assert.equal(predictionColor(.113), "#c4a1ff");
});

if (process.env.BENCHMARK) {
  const times = [];
  for (let i = 0; i < 500; i++) {
    const values = valuesFor(i + 1);
    const start = performance.now();
    estimateCrash(values);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ benchmark: "300 rounds, 500 forecasts", medianMs: times[250], p95Ms: times[475], maxMs: times[499] }));
}
