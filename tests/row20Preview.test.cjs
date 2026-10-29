const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { estimateCrash } = require("./loadTs.cjs")("crashPrediction");

function renderHistory(values, rowCount = 20, hooks = {}) {
  const rows = values.map((multiplier, i) => ({
    multiplier, gameNumber: 300 - i, timestamp: "2026-10-01T12:00:00.000Z",
  }));
  const states = [rows, 0, false, hooks.compact ?? true, rowCount, rows[0]?.multiplier ?? null];
  const filename = path.join(__dirname, "../app/components/StakeCrashHistory.tsx");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = { exports: {}, require(id) {
    if (id === "react") return { ...React, default: React,
      useState: () => [states.shift(), value => hooks.onState?.(value)],
      useEffect: effect => hooks.effects?.push(effect), useMemo: fn => fn(),
      useCallback: fn => fn, useRef: value => ({ current: value }) };
    if (id === "react-dom") return { flushSync: callback => hooks.flushSync ? hooks.flushSync(callback) : callback() };
    if (id === "../lib/apiBase") return { apiUrl: value => value };
    if (id === "../lib/crashHistoryFeed") return { subscribeCrashHistory: options => hooks.subscribe?.(options) };
    return require(id);
  }};
  vm.runInNewContext(code, context, { filename });
  return renderToStaticMarkup(React.createElement(context.exports.default));
}

function previews(html) {
  return [...html.matchAll(/<div[^>]*data-testid="compact-preview"[^>]*>/g)].map(match => match[0]);
}

function cellBackgrounds(html) {
  return [...html.matchAll(/<div style="([^"]*)" title="[^"]*">/g)]
    .filter(match => match[1].startsWith("font-family:Arial"))
    .map(match => match[1].match(/(?:^|;)background:([^;]+)/)[1]);
}

test("round 4134426's stored 1.15x stays 1.15x in both grid modes and the ghost row", () => {
  const values = Array(40).fill(1.15);
  for (const compact of [true, false]) {
    const html = renderHistory(values, 20, { compact });
    assert.ok(html.includes('1.15x'));
    assert.ok(!html.includes('1.14x'));
    if (compact) {
      assert.match(html, /20R before the next round on this page: 1\.15x/);
    }
  }
});

test("two-decimal payouts keep their cents, including large values", () => {
  for (const value of [1.13, 1.14, 1.15, 1.16, 2.3, 4.1, 9.95, 16.4, 100.01, 1048576.13]) {
    const html = renderHistory([value], 20, { compact: false });
    assert.ok(html.includes(`>${value.toFixed(2)}x<`), `${value}x`);
  }
});

test("extra decimals are still truncated, not rounded up", () => {
  for (const [value, expected] of [[1.1499, '1.14'], [1.1599, '1.15'], [9.9999, '9.99']]) {
    const html = renderHistory([value], 20, { compact: false });
    assert.ok(html.includes(`>${expected}x<`), `${value}x`);
  }
});

test("exact-match highlighting does not merge 1.14x with 1.15x", () => {
  const backgrounds = cellBackgrounds(renderHistory([1.15, 1.14, 1.15]));
  assert.equal(backgrounds[0], 'rgba(34, 197, 94, 0.14)');
  assert.equal(backgrounds[1], 'rgba(234, 179, 8, 0.14)');
  assert.equal(backgrounds[2], 'rgba(34, 197, 94, 0.14)');
});

test("10x and higher anchors use Stake's similar-value backgrounds", () => {
  for (const [anchor, lower, upper, outside] of [
    [10, 9, 11.99, 12],
    [14.85, 9, 22, 22.01],
    [43.83, 20, 70, 70.01],
    [100, 20, 150, 150.01],
    [250, 50, 1000, 49.99],
  ]) {
    const values = Array(40).fill(1.2);
    values[0] = anchor; values[10] = lower; values[20] = upper; values[30] = outside;
    const backgrounds = cellBackgrounds(renderHistory(values));
    for (const index of [0, 10, 20]) {
      assert.equal(backgrounds[index], "rgba(234, 179, 8, 0.14)", `${anchor}x anchor, ${values[index]}x match`);
    }
    assert.equal(backgrounds[30], "#111827", `${outside}x is outside ${anchor}x's range`);
  }
});

test("exact matches and 9x/10x blocks keep priority over similar-value backgrounds", () => {
  const values = Array(50).fill(1.2);
  values[0] = values[40] = 30;
  values[20] = 10; values[22] = 9.5; values[24] = 40;
  const backgrounds = cellBackgrounds(renderHistory(values));
  for (const index of [0, 40]) assert.equal(backgrounds[index], "rgba(34, 197, 94, 0.14)");
  for (const index of [20, 22, 24]) assert.equal(backgrounds[index], "rgba(56, 189, 248, 0.28)");
  for (const index of [21, 23]) assert.equal(backgrounds[index], "rgba(148, 163, 184, 0.24)");
});

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

test("live grid rows and anchor commit synchronously, unlike HTTP catch-up", () => {
  const effects = [], writes = []; let feed, committing = false;
  renderHistory([2], 20, {
    effects, subscribe: options => { feed = options; },
    onState: value => writes.push({ value, committing }),
    flushSync: callback => { committing = true; callback(); committing = false; },
  });
  effects[0]();
  const rows = [{ gameNumber: 301, multiplier: 14.85, timestamp: "2026-10-16T12:00:00Z" }];
  feed.onRows(rows, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].value, rows); assert.equal(writes[1].value, 14.85);
  assert.ok(writes.every(write => write.committing));
  writes.length = 0; feed.onRows(rows, false);
  assert.ok(writes.every(write => !write.committing));
});
