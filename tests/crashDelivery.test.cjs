const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function setup({ autoPaint = true } = {}) {
  const modules = new Map(), sources = [], requests = [], timers = new Map(), frames = new Map();
  let clock = 100000, nextTimer = 0;
  const document = new EventTarget(), window = new EventTarget();
  document.visibilityState = "visible";
  function frame() {
    const pending = [...frames.values()]; frames.clear();
    for (const fn of pending) fn();
  }
  function paint() {
    frame();
    for (const [id, timer] of [...timers]) if (timer.delay === 0) {
      timers.delete(id); timer.fn();
    }
  }
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
      if (autoPaint) paint();
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
      exports, console, EventSource: Source, Event, AbortController, queueMicrotask, document, window,
      Date: { now: () => clock },
      requestAnimationFrame(fn) { const id = ++nextTimer; frames.set(id, fn); return id; },
      cancelAnimationFrame(id) { frames.delete(id); },
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
  return { load, sources, requests, timers, frames, frame, paint, document, window, advance(ms) { clock += ms; },
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
  assert.equal(seen.at(-1).asOfGameIndex, 300); assert.equal(seen.at(-1).stale, true);
  h.tick(5000); await h.respond(2, stats(301));
  assert.equal(seen.at(-1).asOfGameIndex, 301); off();
});
test("disconnect retains marked last-known stats and reconnect restores them", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  await h.respond(0, stats(300));
  h.sources[0].emit("error"); assert.equal(seen.at(-1).asOfGameIndex, 300); assert.equal(seen.at(-1).stale, true);
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
  await h.respond(1, {}, false); assert.equal(seen.at(-1).asOfGameIndex, 300); assert.equal(seen.at(-1).stale, true);
  h.tick(5000); await h.respond(2, stats(302));
  assert.equal(seen.at(-1).asOfGameIndex, 302); off();
});

test("reconnect rejects an HTTP snapshot older than the last confirmed stats", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  await h.respond(0, stats(300));
  h.sources[0].emit("error"); h.sources[0].emit("open");
  await h.respond(1, stats(299));
  assert.equal(seen.at(-1).asOfGameIndex, 300); assert.equal(seen.at(-1).stale, true);
  h.tick(5000); await h.respond(2, stats(301));
  assert.equal(seen.at(-1).asOfGameIndex, 301); off();
});

test("returning from a hidden tab refreshes immediately without clearing numbers or duplicate requests", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  h.sources[0].emit("open"); await h.respond(0, stats(300));
  h.document.visibilityState = "hidden"; h.advance(60000);
  h.window.dispatchEvent(new Event("focus"));
  assert.equal(h.requests.length, 1);
  h.document.visibilityState = "visible";
  h.document.dispatchEvent(new Event("visibilitychange"));
  h.window.dispatchEvent(new Event("focus"));
  h.window.dispatchEvent(new Event("pageshow"));
  assert.equal(h.requests.length, 2);
  assert.equal(seen.at(-1).asOfGameIndex, 300);
  assert.equal(seen.at(-1).stale, true);
  await h.respond(1, stats(301));
  assert.equal(seen.at(-1).stale, false);
  assert.equal(seen.at(-1).liveUpdate, false, "catch-up must not trigger an alert");
  off();
  h.advance(2000); h.window.dispatchEvent(new Event("focus"));
  h.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.requests.length, 2, "focus listeners are removed on cleanup");
});
test("a suspended request is aborted on resume and cannot overwrite its replacement", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  h.advance(60000); h.window.dispatchEvent(new Event("focus"));
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.requests.length, 2);
  await h.respond(1, stats(301));
  await h.respond(0, stats(500));
  assert.equal(seen.at(-1).asOfGameIndex, 301);
  off(); assert.equal(h.timers.size, 0);
});
test("server invalidation keeps a stale snapshot until successful refresh", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  await h.respond(0, stats(300));
  h.sources[0].emit("stats_unavailable", {});
  assert.equal(seen.at(-1).asOfGameIndex, 300); assert.equal(seen.at(-1).stale, true);
  h.tick(1500); await h.respond(1, stats(301));
  assert.equal(seen.at(-1).asOfGameIndex, 301); assert.equal(seen.at(-1).stale, false);
  off();
});
test("only fresh visible stream updates can request median sounds", async () => {
  const h = setup(), seen = [], off = h.load("crashStats").subscribeCrashStats(x => seen.push(x));
  await h.respond(0, stats(300));
  assert.equal(seen.at(-1).liveUpdate, false);
  h.sources[0].emit("new_game", { gameIndex: 301 }); h.sources[0].emit("stats", stats(301));
  assert.equal(seen.at(-1).liveUpdate, true);
  h.document.visibilityState = "hidden";
  h.sources[0].emit("new_game", { gameIndex: 302 }); h.sources[0].emit("stats", stats(302));
  assert.equal(seen.at(-1).liveUpdate, false);
  h.document.visibilityState = "visible";
  h.sources[0].emit("error");
  h.sources[0].emit("new_game", { gameIndex: 303 }); h.sources[0].emit("stats", stats(303));
  assert.equal(seen.at(-1).liveUpdate, false);
  off();
});

test("a stalled open connection is replaced, while regular pings keep it alive", () => {
  const h = setup(), panel = h.load("crashEvents").openCrashStream();
  let errors = 0, rounds = 0;
  panel.onerror = () => errors++;
  panel.addEventListener("new_game", () => rounds++);
  h.sources[0].emit("open");
  for (let i = 0; i < 8; i++) {
    h.advance(10000); h.sources[0].emit("ping"); h.tick(5000);
  }
  assert.equal(h.sources.length, 1);
  h.advance(45000); h.tick(5000);
  assert.equal(h.sources.length, 2);
  assert.equal(h.sources[0].closed, true); assert.equal(errors, 1);
  h.sources[0].emit("new_game", {});
  h.sources[1].emit("open"); h.sources[1].emit("new_game", {});
  assert.equal(rounds, 1, "abandoned connection cannot deliver stale messages");
  panel.close(); assert.equal(h.timers.size, 0);
});

test("tab resume reconnects a silent stream once; hidden tabs do not churn connections", () => {
  const h = setup(), panel = h.load("crashEvents").openCrashStream();
  h.sources[0].emit("open"); h.document.visibilityState = "hidden";
  h.advance(60000); h.tick(5000); assert.equal(h.sources.length, 1);
  h.document.visibilityState = "visible";
  h.document.dispatchEvent(new Event("visibilitychange"));
  h.window.dispatchEvent(new Event("focus")); h.window.dispatchEvent(new Event("pageshow"));
  assert.equal(h.sources.length, 2);
  panel.close(); h.advance(60000); h.window.dispatchEvent(new Event("focus"));
  assert.equal(h.sources.length, 2);
});

function historyFixture() {
  const h = setup(), requests = [], seen = [], loading = [], errors = [];
  const off = h.load("crashHistoryFeed").subscribeCrashHistory({
    limit: 5,
    load: signal => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })),
    parse: raw => raw && Number.isSafeInteger(raw.gameNumber) ? raw : null,
    onRows: rows => seen.push(rows), onLoading: value => loading.push(value), onError: error => errors.push(error),
  });
  return { ...h, historyRequests: requests, seen, loading, errors, off,
    async respondHistory(index, head) {
      requests[index].resolve(Array.from({ length: 5 }, (_, i) => ({ gameNumber: head - i })));
      await flush();
    },
    ids() { return Array.from(seen.at(-1) || [], row => row.gameNumber); },
  };
}

test("history listens before bootstrap and never overwrites a round with a late HTTP snapshot", async () => {
  const h = historyFixture(); h.sources[0].emit("open");
  assert.equal(h.historyRequests.length, 1);
  h.sources[0].emit("new_game", { gameNumber: 301 });
  assert.deepEqual(h.ids(), [301], "round is displayed without waiting for the database");
  await h.respondHistory(0, 300);
  assert.deepEqual(h.ids(), [301, 300, 299, 298, 297]);
  h.sources[0].emit("new_game", { gameNumber: 302 });
  h.sources[0].emit("new_game", { gameNumber: 302 });
  h.sources[0].emit("new_game", { gameNumber: 299 });
  assert.deepEqual(h.ids(), [302, 301, 300, 299, 298]);
  assert.equal(h.historyRequests.length, 1, "healthy live rounds need no HTTP request");
  h.off(); assert.equal(h.timers.size, 0);
});

test("history reconnect and tab resume fetch missed rounds without waiting for another round", async () => {
  const h = historyFixture(); h.sources[0].emit("open"); await h.respondHistory(0, 300);
  h.advance(2000); h.sources[0].emit("error"); h.sources[0].emit("open");
  assert.equal(h.historyRequests.length, 2);
  assert.equal(h.ids()[0], 300, "last known rows remain visible");
  await h.respondHistory(1, 303); assert.equal(h.ids()[0], 303);
  h.document.visibilityState = "hidden"; h.advance(60000);
  h.window.dispatchEvent(new Event("focus")); assert.equal(h.historyRequests.length, 2);
  h.document.visibilityState = "visible";
  h.document.dispatchEvent(new Event("visibilitychange")); h.window.dispatchEvent(new Event("focus"));
  assert.equal(h.historyRequests.length, 3);
  await h.respondHistory(2, 307); assert.equal(h.ids()[0], 307);
  h.off();
});

test("history repairs event gaps and retries if the first database snapshot is still behind", async () => {
  const h = historyFixture(); h.sources[0].emit("open"); await h.respondHistory(0, 300);
  h.sources[0].emit("new_game", { gameNumber: 304 });
  assert.equal(h.ids()[0], 304);
  await h.respondHistory(1, 302);
  h.tick(3000); assert.equal(h.historyRequests.length, 3);
  h.sources[0].emit("new_game", { gameNumber: 305 });
  await h.respondHistory(2, 304);
  assert.deepEqual(h.ids(), [305, 304, 303, 302, 301]); h.off();
});

test("history timeout, failed fetch and cleanup do not strand or overwrite the live grid", async () => {
  const h = historyFixture(); h.sources[0].emit("open");
  h.tick(10000); assert.equal(h.historyRequests[0].signal.aborted, true);
  h.tick(3000); assert.equal(h.historyRequests.length, 2);
  h.historyRequests[1].reject(new Error("offline")); await flush();
  assert.equal(h.errors.length, 1);
  h.tick(3000); await h.respondHistory(2, 300);
  await h.respondHistory(0, 999); assert.equal(h.ids()[0], 300);
  h.advance(2000); h.window.dispatchEvent(new Event("focus"));
  h.off(); assert.equal(h.historyRequests[3].signal.aborted, true);
  await h.respondHistory(3, 1000); assert.equal(h.ids()[0], 300);
  assert.equal(h.timers.size, 0);
});

test("history uses a bounded fallback during disconnect and stops polling after reconnect", async () => {
  const h = historyFixture(); h.sources[0].emit("open"); await h.respondHistory(0, 300);
  h.sources[0].emit("error"); h.tick(10000);
  assert.equal(h.historyRequests.length, 2);
  await h.respondHistory(1, 302); assert.equal(h.ids()[0], 302);
  h.sources[0].emit("open"); await h.respondHistory(2, 302);
  h.tick(10000); assert.equal(h.historyRequests.length, 3);
  h.off();
});

test("grid updates first even when predictor and charts subscribed before it", () => {
  const h = setup({ autoPaint: false }), api = h.load("crashEvents"), order = [];
  const predictor = api.openCrashStream({ afterPaint: true });
  const chart = api.openCrashStream({ afterPaint: true });
  const grid = api.openCrashStream();
  predictor.addEventListener("new_game", () => order.push("predictor"));
  chart.addEventListener("new_game", () => order.push("chart"));
  predictor.addEventListener("stats", () => order.push("medians"));
  grid.addEventListener("new_game", () => order.push("grid"));
  h.sources[0].emit("new_game", { gameIndex: 301 });
  h.sources[0].emit("stats", stats(301));
  assert.deepEqual(order, ["grid"], "no calculation runs in the grid's event turn");
  h.frame();
  assert.deepEqual(order, ["grid"], "frame callbacks must not start calculations before paint");
  order.push("paint"); h.tick(0);
  assert.deepEqual(order, ["grid", "paint", "predictor", "chart", "medians"]);
  predictor.close(); chart.close(); grid.close();
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
});

test("deferred round and stats events retain order without dropping burst arrivals", () => {
  const h = setup({ autoPaint: false }), seen = [];
  const panel = h.load("crashEvents").openCrashStream({ afterPaint: true });
  for (const type of ["new_game", "stats", "stats_unavailable"]) {
    panel.addEventListener(type, event => seen.push([type, JSON.parse(event.data).head]));
  }
  for (const head of [301, 302, 303]) {
    h.sources[0].emit("new_game", { head }); h.sources[0].emit("stats", { head });
  }
  h.sources[0].emit("stats_unavailable", { head: 303 });
  assert.equal(seen.length, 0); assert.equal(h.frames.size, 1);
  h.paint();
  assert.deepEqual(seen, [
    ["new_game", 301], ["stats", 301], ["new_game", 302], ["stats", 302],
    ["new_game", 303], ["stats", 303], ["stats_unavailable", 303],
  ]);
  panel.close();
});

test("hidden-tab fallback processes queued rounds once even without animation frames", () => {
  const h = setup({ autoPaint: false }); let count = 0;
  h.document.visibilityState = "hidden";
  const panel = h.load("crashEvents").openCrashStream({ afterPaint: true });
  panel.addEventListener("new_game", () => count++);
  h.sources[0].emit("new_game", {});
  h.tick(100); assert.equal(count, 1); assert.equal(h.frames.size, 0);
  h.paint(); assert.equal(count, 1); panel.close();
});

test("disconnect and unsubscribe cancel deferred work instead of replaying stale forecasts", () => {
  const h = setup({ autoPaint: false }), api = h.load("crashEvents"); let rounds = 0, errors = 0;
  const first = api.openCrashStream({ afterPaint: true }), second = api.openCrashStream({ afterPaint: true });
  first.addEventListener("new_game", () => rounds++);
  second.addEventListener("new_game", () => rounds++);
  second.onerror = () => errors++;
  h.sources[0].emit("new_game", {}); h.sources[0].emit("error");
  assert.equal(errors, 1); h.paint(); h.tick(100); assert.equal(rounds, 0);
  h.sources[0].emit("open"); h.sources[0].emit("new_game", {});
  first.close(); h.paint(); assert.equal(rounds, 1);
  h.sources[0].emit("new_game", {}); second.close();
  h.paint(); h.tick(100); assert.equal(rounds, 1);
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
});
