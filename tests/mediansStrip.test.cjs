const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function renderStrip(medians, rate, trend = null) {
  const states = [medians, rate, trend];
  function load(name) {
    const base = path.join(__dirname, "../app/components", name);
    const filename = fs.existsSync(base + ".tsx") ? base + ".tsx" : base + ".ts";
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const context = { exports: {}, require(id) {
      if (id === "react") return { ...React, default: React, useState: () => [states.shift(), () => {}], useEffect() {}, useMemo: fn => fn(), useRef: value => ({ current: value }) };
      if (id.endsWith(".module.css")) return { default: { strip: "strip", row: "row" } };
      if (id === "../lib/apiBase") return { apiUrl: value => value };
      if (id === "./useCrashPrediction") return { useCrashPrediction: () => ({ estimate: { probability: .1232916667, rowMatches: 3, gameIndex: 300 }, status: "live", alertUntil: 0 }) };
      if (id === "./useCrashAlertSound") return { useCrashAlertSound: () => ({ muted: false, ready: false, toggle() {} }) };
      if (id.startsWith("./")) return load(id.slice(2));
      return require(id);
    }};
    vm.runInNewContext(code, context, { filename });
    return context.exports;
  }
  return renderToStaticMarkup(React.createElement(load("MediansStrip").default));
}

test("low median or frequency gets warning borders and whole percentages", () => {
  for (const [median, rate, label] of [[1.97, .06, "6%"], [2.3, .07, "7%"], [1.8, .18, "18%"]]) {
    const html = renderStrip([median, 2.07, 2.13, 2.02, 2.01, 1.99], rate);
    assert.match(html, /data-pause-state="paused"/);
    assert.ok(html.includes(`>${label}</div>`));
    assert.ok(html.includes(`>${median.toFixed(2)}x</div>`));
    assert.match(html, /border-color:#ff4d4f/);
  }
});

test("exact thresholds are clear and missing data stays unavailable", () => {
  assert.match(renderStrip([2, 2, 2, 2, 2, 2], .1), /data-pause-state="clear"/);
  const missing = renderStrip([], null);
  assert.match(missing, /data-pause-state="unavailable"/);
  assert.ok(!missing.includes('>0%</div>'));
  assert.ok(!missing.includes('>0.00x</div>'));
});

test("trend arrows distinguish median units from percentage-point changes", () => {
  const trend = { available: true, comparisonRounds: 10, recoveringFromLow: true,
    med50: { current: 2.4, previous: 1.95, delta: .45 },
    tail10: { currentPercent: 8, previousPercent: 5, deltaPp: 3 },
    recentLow: { percent: 5, roundsAgo: 10 } };
  const html = renderStrip([2.4, 2.1, 2.2, 2, 2, 2], .08, trend);
  assert.match(html, /data-testid="trend-med50"/);
  assert.match(html, /data-testid="trend-tail10"/);
  assert.ok(html.includes("0.45"));
  assert.ok(html.includes("3pp"));
  assert.match(html, /data-pause-state="paused"/);
});

test("Med 3000 is replaced by the live 20R and 10x prediction tile", () => {
  const html = renderStrip([2.4, 2.1, 2.2, 2, 2, 2], .13);
  assert.ok(!html.includes('data-testid="median-3000"'));
  assert.ok(html.includes('data-testid="median-1000"'));
  assert.match(html, /data-testid="crash-prediction" data-status="live"/);
  assert.match(html, /3<small>\/10<\/small>/);
  assert.match(html, />12.3%<\/strong>/);
  assert.match(html, /Enable prediction alerts/);
});
