const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

async function renderBlock(rate) {
  const states = [], effects = [], requests = [];
  let index = 0, mounted = false;
  const filename = path.join(__dirname, "../app/components/LastSeenBlock.tsx");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = { exports: {}, console, setInterval() {}, clearInterval() {},
    async fetch(url) {
      requests.push(url);
      return { json: async () => url === "/api/medians"
        ? { pS10: .18, pS2_50: rate }
        : { "10x": 3, "20x": 6, "50x": 10 } };
    },
    require(id) {
      if (id === "react") return { ...React, default: React,
        useState(initial) {
          const slot = index++;
          if (!mounted) states[slot] = initial;
          return [states[slot], value => { states[slot] = value; }];
        },
        useEffect(effect) { if (!mounted) effects.push(effect); },
      };
      if (id === "../lib/apiBase") return { apiUrl: value => value };
      return require(id);
    },
  };
  vm.runInNewContext(code, context, { filename });
  renderToStaticMarkup(React.createElement(context.exports.default));
  mounted = true;
  const cleanups = effects.map(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  index = 0;
  const html = renderToStaticMarkup(React.createElement(context.exports.default));
  cleanups.forEach(cleanup => cleanup());
  assert.deepEqual(requests.sort(), ["/api/last-seen", "/api/medians"]);
  return html;
}

test("last tile shows 2x frequency over 50 rounds, retaining the 10x last-seen count", async () => {
  const html = await renderBlock(.6);
  assert.ok(html.includes("≥ 2x % (50)"));
  assert.ok(html.includes(">60%</div>"));
  assert.ok(html.includes("≥ 10x</div>"));
  assert.ok(html.includes(">3</div>"));
  assert.ok(!html.includes("≥ 10x %"));
  assert.ok(!html.includes(">18%</div>"));
});

test("2x tile uses Stake colors and preserves a real zero percent", async () => {
  for (const [rate, percent, color] of [[.6, 60, "#22c55e"], [.55, 55, "#22c55e"], [.54, 54, "#f59e0b"], [.45, 45, "#f59e0b"], [.44, 44, "#ff4d4f"], [0, 0, "#ff4d4f"]]) {
    const html = await renderBlock(rate);
    assert.ok(html.includes(`color:${color}">${percent}%</div>`));
  }
});

test("missing or invalid 2x API data remains unavailable instead of showing a false zero", async () => {
  for (const rate of [undefined, null, "", "invalid", -1, 2]) {
    const html = await renderBlock(rate);
    assert.ok(html.includes('color:#e5e7eb">—</div>'));
    assert.ok(!html.includes(">0%</div>"));
  }
});
