const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const prediction = require("./loadTs.cjs")("crashPrediction");

function render(matches, probability = .099, status = "live", alertUntil = 2000) {
  const filename = path.join(__dirname, "../app/components/CrashPredictionTile.tsx");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  let soundArgs;
  const context = { exports: {}, Date: { now: () => 1000 }, require(id) {
    if (id === "./crashPrediction") return prediction;
    if (id === "./useCrashPrediction") return { useCrashPrediction: () => ({
      estimate: { rowMatches: matches, probability, gameIndex: 300 }, status, alertUntil,
    }) };
    if (id === "./useCrashAlertSound") return { useCrashAlertSound: (...args) => {
      soundArgs = args; return { muted: true, ready: false, toggle() {} };
    } };
    if (id.endsWith(".module.css")) return { default: { reading: "reading", rowAlert: "rowAlert" } };
    return require(id);
  }};
  vm.runInNewContext(code, context, { filename });
  return { html: renderToStaticMarkup(React.createElement(context.exports.default)), soundArgs };
}

test("20R >=3 selects its own sound and blink, even when muted or the predictor also qualifies", () => {
  for (const count of [3, 4, 5, 10]) {
    const { html, soundArgs } = render(count, .14);
    assert.deepEqual(soundArgs, ["300", 2000, "row20"]);
    assert.match(html, /class="reading rowAlert"/);
    assert.match(html, /data-row20-alert="true"/);
  }
});

test("prediction-only alerts retain the original chime without blinking 20R", () => {
  const { html, soundArgs } = render(2, .14);
  assert.deepEqual(soundArgs, ["300", 2000, "prediction"]);
  assert.match(html, /data-row20-alert="false"/);
  assert.equal(render(2).soundArgs[0], null);
});

test("reload, catch-up, disconnected and expired readings do not blink", () => {
  for (const status of ["connecting", "syncing"]) {
    const { html, soundArgs } = render(3, .14, status);
    assert.match(html, /data-row20-alert="false"/);
    assert.equal(soundArgs[0], null);
  }
  for (const until of [0, 999]) {
    assert.match(render(3, .14, "live", until).html, /data-row20-alert="false"/);
  }
});

test("blink is bounded and reduced-motion users get a steady highlight", () => {
  const css = fs.readFileSync(path.join(__dirname, "../app/components/CrashPredictionTile.module.css"), "utf8");
  assert.match(css, /row20-blink 900ms ease-in-out 4/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.rowAlert \{ animation: none;/);
});
