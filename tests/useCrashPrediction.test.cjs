const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const prediction = require("./loadTs.cjs")("crashPrediction");

const rounds = (last = 300) => Array.from({ length: 300 }, (_, i) => ({
  gameIndex: last - 299 + i, multiplier: 2, timestamp: new Date().toISOString(),
}));
const flush = () => new Promise(resolve => setImmediate(resolve));

test("prediction bootstrap works without stream open and remains silent", async () => {
  const f = fixture();
  await flush();
  assert.equal(f.calls(), 1);
  assert.equal(f.reading().estimate.gameIndex, 300);
  assert.equal(f.reading().status, "connecting");
  assert.equal(f.reading().alertUntil, 0);
  f.cleanup();
});

test("reload shows a cached estimate while HTTP is pending; fresh history replaces it silently", async () => {
  const cache = new Map();
  const first = fixture({ cache }); first.source.emit("open"); await flush(); first.cleanup();
  let release;
  const f = fixture({ cache, response: () => new Promise(resolve => { release = resolve; }) });
  assert.equal(f.reading().estimate.gameIndex, 300);
  assert.equal(f.reading().status, "connecting"); assert.equal(f.reading().alertUntil, 0);
  f.source.emit("open");
  release({ success: true, rounds: rounds(302) }); await flush();
  assert.equal(f.reading().estimate.gameIndex, 302);
  assert.equal(f.reading().status, "live"); assert.equal(f.reading().alertUntil, 0);
  f.cleanup();
});

test("disconnect keeps the last estimate and HTTP still recovers without a new event", async () => {
  const f = fixture(); f.source.emit("open"); await flush();
  let release;
  f.respond(() => new Promise(resolve => { release = resolve; }));
  f.source.emit("error");
  assert.equal(f.reading().estimate.gameIndex, 300); assert.equal(f.reading().alertUntil, 0);
  release({ success: true, rounds: rounds(302) }); await flush();
  assert.equal(f.reading().estimate.gameIndex, 302);
  assert.equal(f.reading().status, "connecting"); assert.equal(f.reading().alertUntil, 0);
  f.cleanup();
});

test("invalid cached estimates are ignored instead of rendering fabricated numbers", async () => {
  const cache = new Map([["prediction", { probability: 3, rowMatches: 14, gameIndex: 300 }]]);
  const f = fixture({ cache, response: async () => ({ success: false }) });
  assert.equal(f.reading().estimate, null);
  await flush(); f.cleanup();
});

function fixture({ cache = new Map(), response = async () => ({ success: true, rounds: rounds() }) } = {}) {
  let reading, source, cleanup, calls = 0, respond = response;
  const timers = new Map();
  class Source {
    static OPEN = 1;
    readyState = 1;
    handlers = {};
    constructor(url) { assert.equal(url, "https://shuffle.test/api/stream"); source = this; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    emit(name, data) { this.handlers[name]({ data: JSON.stringify(data) }); }
    close() { this.readyState = 2; }
  }
  const filename = path.join(__dirname, "../app/components/useCrashPrediction.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { exports: {}, AbortController, EventSource: Source,
    setTimeout(fn, delay) { const token = {}; timers.set(token, { fn, delay }); return token; },
    clearTimeout(token) { timers.delete(token); }, setInterval() {}, clearInterval() {},
    async fetch(url) {
      assert.equal(url, "https://shuffle.test/api/prediction-history"); calls++;
      const data = await respond(); return { ok: true, json: async () => data };
    },
    require(id) {
      if (id === "react") return {
        useState(initial) { reading = initial; return [initial, value => { reading = value; }]; },
        useEffect(effect) { cleanup = effect(); },
      };
      if (id === "./crashPrediction") return prediction;
      if (id === "../lib/lastKnown") return {
        readLastKnown: (name, decode) => decode(cache.get(name)),
        saveLastKnown: (name, value) => cache.set(name, value),
      };
      if (id === "../lib/apiBase") return { API_BASE: "https://shuffle.test" };
      if (id === "../lib/crashEvents") return { openCrashStream: () => new Source("https://shuffle.test/api/stream") };
      throw new Error(`Unexpected import: ${id}`);
    },
  };
  vm.runInNewContext(code, context, { filename });
  context.exports.useCrashPrediction();
  return { source, timers, reading: () => reading, calls: () => calls,
    respond(fn) { respond = fn; }, cleanup: () => cleanup(),
    round(index, multiplier = 2) { source.emit("new_game", { gameIndex: index, multiplier, timestamp: new Date().toISOString() }); },
  };
}

test("Shuffle loads once and updates immediately for each live round", async () => {
  const f = fixture(); f.source.emit("open"); await flush();
  assert.equal(f.reading().status, "live");
  assert.equal(f.reading().estimate.gameIndex, 300);
  assert.equal(f.reading().alertUntil, 0, "bootstrap stays silent");
  f.round(301, 15);
  assert.equal(f.reading().estimate.gameIndex, 301);
  assert.ok(f.reading().alertUntil > Date.now());
  f.round(301, 15);
  f.round(299);
  assert.equal(f.reading().estimate.gameIndex, 301);
  assert.equal(f.calls(), 1, "no repeated snapshot fetch per round");
  f.cleanup(); assert.equal(f.source.readyState, 2);
});

test("missing rounds retain the last estimate with alerts paused until a complete resync", async () => {
  const f = fixture(); f.source.emit("open"); await flush();
  let release;
  f.respond(() => new Promise(resolve => { release = resolve; }));
  f.round(304);
  assert.equal(f.reading().status, "syncing");
  assert.equal(f.reading().estimate.gameIndex, 300);
  assert.equal(f.reading().alertUntil, 0);
  f.round(305);
  release({ success: true, rounds: rounds(304) }); await flush();
  assert.equal(f.reading().estimate.gameIndex, 305);
  assert.equal(f.reading().alertUntil, 0, "catch-up is silent");
  f.source.emit("error");
  assert.equal(f.reading().status, "connecting");
  assert.equal(f.reading().estimate.gameIndex, 305);
  f.cleanup();
});

test("failed snapshots retry without inventing an estimate", async () => {
  const f = fixture({ response: async () => ({ success: false }) });
  f.source.emit("open"); await flush();
  assert.equal(f.reading().status, "syncing");
  assert.equal(f.reading().estimate, null);
  const retry = [...f.timers.values()].find(timer => timer.delay === 3000);
  assert.ok(retry);
  f.respond(async () => ({ success: true, rounds: rounds() }));
  retry.fn(); await flush();
  assert.equal(f.reading().status, "live");
  f.cleanup();
});
