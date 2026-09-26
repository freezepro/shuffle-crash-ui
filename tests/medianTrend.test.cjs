const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const file = path.join(__dirname, "../app/components/medianTrend.ts");
const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context, { filename: file });
const { readMedianTrend, trendDescription } = context.exports;
const sample = () => ({ available: true, asOfGameIndex: 1000, comparisonRounds: 10, lowLookbackRounds: 50,
  med50: { current: 1.9, previous: 1.65, delta: .25 },
  tail10: { currentPercent: 8, previousPercent: 5, deltaPp: 3 },
  recentLow: { percent: 5, roundsAgo: 10 }, recoveringFromLow: true });

test("accepts matching past-only recovery, even while pause thresholds are low", () => {
  const v = readMedianTrend(sample(), 1.9, .08);
  assert.equal(v.recoveringFromLow, true);
  assert.match(trendDescription(v, "tail10"), /5% to 8% over 10 completed rounds/);
  assert.match(trendDescription(v, "med50"), /may reverse and does not override PAUSE/);
});

test("old backend, failed data and a mismatched snapshot show no trend", () => {
  for (const data of [undefined, null, {}, { available: false }, { ...sample(), med50: null }])
    assert.equal(readMedianTrend(data, 1.9, .08), null);
  assert.equal(readMedianTrend(sample(), 2.3, .08), null);
  assert.equal(readMedianTrend(sample(), 1.9, .07), null);
  assert.equal(readMedianTrend(sample(), null, .08), null);
});

test("rejects invalid counts, windows, deltas and unsupported recovery claims", () => {
  const a = sample(); a.tail10.deltaPp = 6;
  const b = sample(); b.recentLow.roundsAgo = 51;
  const c = sample(); c.recentLow.percent = 5.5;
  const d = sample(); d.med50.delta = NaN;
  for (const v of [a, b, c, d, { ...sample(), comparisonRounds: 5 }, { ...sample(), recoveringFromLow: false }])
    assert.equal(readMedianTrend(v, 1.9, .08), null);
});
