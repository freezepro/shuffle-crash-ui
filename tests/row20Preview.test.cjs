const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { estimateCrash } = require("./loadTs.cjs")("crashPrediction");

function renderHistory(values, rowCount = 20) {
  const rows = values.map((multiplier, i) => ({
    multiplier, gameNumber: 300 - i, timestamp: "2026-10-01T12:00:00.000Z",
  }));
  const states = [rows, 0, false, true, rowCount, true, rows[0]?.multiplier ?? null];
  const filename = path.join(__dirname, "../app/components/StakeCrashHistory.tsx");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = { exports: {}, require(id) {
    if (id === "react") return { ...React, default: React,
      useState: () => [states.shift(), () => {}], useEffect() {}, useMemo: fn => fn(),
      useCallback: fn => fn, useRef: value => ({ current: value }) };
    if (id === "../lib/apiBase") return { apiUrl: value => value };
    return require(id);
  }};
  vm.runInNewContext(code, context, { filename });
  return renderToStaticMarkup(React.createElement(context.exports.default));
}

function previews(html) {
  return [...html.matchAll(/<div[^>]*data-testid="compact-preview"[^>]*>/g)].map(match => match[0]);
}

test("nine preview slots retain the Rows control without changing the ten-position count", () => {
  const values = Array(300).fill(1);
  [10.07, 16.36, 9.94, 12.34].forEach((value, i) => {
    values[[99, 119, 139, 199][i]] = value;
  });
  values[198] = 100;
  const html = renderHistory(values.slice(0, 200));
  const cells = previews(html);
  assert.equal(cells.length, 9);
  assert.deepEqual(cells.map(cell => Number(cell.match(/data-age="(\d+)"/)[1])),
    [20, 40, 60, 80, 100, 120, 140, 160, 180]);
  assert.equal(cells.filter(cell => cell.includes('data-pattern-hit="true"')).length, 3);
  assert.equal(estimateCrash([...values].reverse()).rowMatches, 4);
  assert.ok(!html.includes('data-age="200"'));
  assert.ok(html.indexOf('>Rows:20</button>') < html.indexOf('data-testid="compact-preview"'));
  assert.match(html, /Toggle compact rows \(20\/10\)/);
});

test("the partial last column cannot substitute its last value for an absent boundary", () => {
  const values = Array(25).fill(1);
  values[19] = 9;
  values[24] = 20;
  const cells = previews(renderHistory(values));
  assert.equal(cells.length, 9);
  assert.equal(cells.filter(cell => cell.includes('data-pattern-hit="true"')).length, 1);
  assert.ok(cells[0].includes('data-pattern-hit="true"'));
  assert.ok(!cells[1].includes("data-pattern-hit"));
});

test("10-row mode preserves the original nine aligned previews", () => {
  const values = Array(100).fill(1);
  values[99] = 9.5;
  const html = renderHistory(values, 10);
  const cells = previews(html);
  assert.deepEqual(cells.map(cell => Number(cell.match(/data-age="(\d+)"/)[1])),
    [10, 20, 30, 40, 50, 60, 70, 80, 90]);
  assert.ok(!html.includes('data-age="100"'));
  assert.match(html, />Rows:10<\/button>/);
});

test("empty history preserves preview positions without inventing matches", () => {
  const cells = previews(renderHistory([]));
  assert.equal(cells.length, 9);
  assert.ok(cells.every(cell => !cell.includes("data-pattern-hit")));
});
