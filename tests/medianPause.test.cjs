const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.join(__dirname, "../app/components/medianPause.ts");
const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context, { filename: file });
const { medianPause, medianValue, frequencyValue } = context.exports;

test("either low indicator pauses, including the observed early exit", () => {
  for (const [med, rate] of [[1.5381, .07], [1.8783, .13], [2.6, .099]])
    assert.equal(medianPause(med, rate).state, "paused");
  assert.match(medianPause(1.8783, .13).description, /Med50 below 2.00x/);
  assert.match(medianPause(2.6, .07).description, /10x frequency below 10%/);
});

test("exact thresholds clear, with no implied go signal", () => {
  for (const [med, rate] of [[2, .1], [2.1, .11], [2.6, .17]])
    assert.equal(medianPause(med, rate).state, "clear");
  assert.match(medianPause(2.6, .17).description, /not a signal to bet/);
});

test("missing and malformed data are not converted to a zero reading", () => {
  for (const value of [null, undefined, "", " ", false, true, [], {}, NaN, Infinity, "oops"])
    assert.equal(medianValue(value), null);
  for (const value of [null, undefined, "", false, [], {}, NaN, Infinity, -1, 1.01])
    assert.equal(frequencyValue(value), null);
  assert.equal(medianPause(null, null).state, "unavailable");
  assert.equal(medianPause(2.3, null).state, "unavailable");
  assert.equal(medianPause(null, .13).state, "unavailable");
});

test("a confirmed low reading still pauses if the other metric is missing", () => {
  assert.equal(medianPause(1.5, null).state, "paused");
  assert.equal(medianPause(null, .07).state, "paused");
  assert.equal(medianPause(2.4, 0).state, "paused");
});

test("finite numeric strings retain the existing API compatibility", () => {
  assert.equal(medianValue("2.3"), 2.3);
  assert.equal(frequencyValue("0.12"), .12);
  assert.equal(medianValue(.5), null);
  assert.equal(medianPause("1.54", "0.07").state, "paused");
});
