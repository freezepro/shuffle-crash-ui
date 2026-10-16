const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function setup() {
  const modules = new Map(), sources = [], requests = [], timers = new Map();
  let clock = 100000, nextTimer = 0;
  class Source {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
    readyState = 0; listeners = new Map(); closed = false;
    constructor(url) { this.url = url; sources.push(this); }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    emit(type, value) {
      if (type === "open") this.readyState = 1;
      if (type === "error") this.readyState = 0;
      for (const fn of this.listeners.get(type) || []) fn({ type, data: JSON.stringify(value) });
    }
    close() { this.closed = true; this.readyState = 2; }
  }
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const filename = path.join(__dirname, "../app/lib", name + ".ts");
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const exports = {}; modules.set(name, exports);
    vm.runInNewContext(code, {
      exports, console, EventSource: Source, Event, AbortController, queueMicrotask,
      Date: { now: () => clock },
      setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay, interval: false }); return id; },
      setInterval(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay, interval: true }); return id; },
      clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
      fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
      require(id) {
        if (id === "./apiBase") return { apiUrl: value => value };
        return load(id.slice(2));
      },
    }, { filename });
    return exports;
  }
  return { load, sources, requests, timers,
    tick(delay) {
      clock += delay;
      for (const [id, timer] of [...timers]) if (timer.delay === delay) {
        if (!timer.interval) timers.delete(id);
        timer.fn();
      }
    },
    async respond(index, data, ok = true) {
      requests[index].resolve({ ok, json: async () => data });
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}
const stats = head => ({ success: true, medians: [2, 2, 2, 2, 2, 2], pS10: .1, pS2_50: .5, asOfGameIndex: head });
const flush = () => new Promise(resolve => setImmediate(resolve));

test("four panels share one EventSource and close only after the last unsubscribe", () => {
  const h = setup(), api = h.load("crashEvents");
  const panels = Array.from({ length: 4 }, () => api.openCrashStream());
  let received = 0;
  for (const panel of panels) panel.addEventListener("new_game", () => received++);
  assert.equal(h.sources.length, 1);
  h.sources[0].emit("new_game", {});
  assert.equal(received, 4);
  panels[0].close(); h.sources[0].emit("new_game", {});
  assert.equal(received, 7); assert.equal(h.sources[0].closed, false);
  panels.slice(1).forEach(panel => panel.close());
  assert.equal(h.sources[0].closed, true);
  const fresh = api.openCrashStream();
  assert.equal(h.sources.length, 2); fresh.close();
});
test("late subscribers receive open; reconnect, ping and errors reach every panel", async () => {
  const h = setup(), api = h.load("crashEvents"), first = api.openCrashStream();
  h.sources[0].emit("open");
  const late = api.openCrashStream();
  let opened = 0, errors = 0, pings = 0;
  late.addEventListener("open", () => opened++);
  first.onerror = () => errors++;
  late.addEventListener("error", () => errors++);
  late.addEventListener("ping", () => pings++);
  await flush(); assert.equal(opened, 1);
  h.sources[0].emit("error"); h.sources[0].emit("open"); h.sources[0].emit("ping");
  assert.equal(errors, 2); assert.equal(opened, 2); assert.equal(pings, 1);
  first.close(); late.close();
});
test("two stats tiles share bootstrap and accept pushes without extra HTTP", async () => {
  const h = setup(), api = h.load("crashStats"), a = [], b = [];
  const offA = api.subscribeCrashStats(x => a.push(x));
  const offB = api.subscribeCrashStats(x => b.push(x));
  assert.equal(h.requests.length, 1);
  h.sources[0].emit("open"); assert.equal(h.requests.length, 1);
  await h.respond(0, stats(300));
  h.sources[0].emit("new_game", { gameIndex: 301 });
  h.sources[0].emit("stats", stats(301));
  h.tick(1500); h.tick(5000);
  assert.equal(a.at(-1).asOfGameIndex, 301); assert.equal(b.at(-1).asOfGameIndex, 301);
  assert.equal(h.requests.length, 1);
  offA(); assert.equal(h.sources[0].closed, false);
  offB(); assert.equal(h.sources[0].closed, true); assert.equal(h.timers.size, 0);
});
test("late HTTP snapshots and out-of-order pushes cannot overwrite a newer round", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  h.sources[0].emit("new_game", { gameIndex: 302 });
  h.sources[0].emit("stats", stats(302));
  await h.respond(0, stats(300));
  h.sources[0].emit("stats", stats(301));
  assert.equal(seen.at(-1).asOfGameIndex, 302); off();
});
test("missing pushes trigger a single fallback request and preserve newest-head ordering", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  await h.respond(0, stats(300));
  h.sources[0].emit("new_game", { gameIndex: 301 });
  h.tick(1500); assert.equal(h.requests.length, 2);
  await h.respond(1, stats(300));
  assert.equal(seen.at(-1), null);
  h.tick(5000); await h.respond(2, stats(301));
  assert.equal(seen.at(-1).asOfGameIndex, 301); off();
});
test("disconnect suppresses stale stats and reconnect restores them", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  await h.respond(0, stats(300));
  h.sources[0].emit("error"); assert.equal(seen.at(-1), null);
  h.sources[0].emit("open"); await h.respond(1, stats(301));
  assert.equal(seen.at(-1).asOfGameIndex, 301); off();
});
test("cleanup aborts bootstrap; a remount ignores the old request", async () => {
  const h = setup(), api = h.load("crashStats");
  const off = api.subscribeCrashStats(() => {});
  off(); assert.equal(h.requests[0].options.signal.aborted, true);
  const seen = [], off2 = api.subscribeCrashStats(x => seen.push(x));
  await h.respond(0, stats(500));
  assert.equal(seen.at(-1), null);
  await h.respond(1, stats(300));
  assert.equal(seen.at(-1).asOfGameIndex, 300); off2();
});
test("quiet streams periodically reconcile; HTTP failures can recover", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  await h.respond(0, stats(300));
  for (let i = 0; i < 6; i++) h.tick(5000);
  assert.equal(h.requests.length, 2);
  await h.respond(1, {}, false); assert.equal(seen.at(-1), null);
  h.tick(5000); await h.respond(2, stats(302));
  assert.equal(seen.at(-1).asOfGameIndex, 302); off();
});

test("reconnect rejects an HTTP snapshot older than the last confirmed stats", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  await h.respond(0, stats(300));
  h.sources[0].emit("error"); h.sources[0].emit("open");
  await h.respond(1, stats(299));
  assert.equal(seen.at(-1), null);
  h.tick(5000); await h.respond(2, stats(301));
  assert.equal(seen.at(-1).asOfGameIndex, 301); off();
});
