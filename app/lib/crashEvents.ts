import { apiUrl } from "./apiBase";

type StreamHandle = {
  addEventListener: (type: string, listener: EventListener) => void;
  onerror: ((event: Event) => void) | null;
  readonly readyState: number;
  close: () => void;
};
const eventTypes = ["open", "error", "ping", "new_game", "stats", "stats_unavailable"];
const handles = new Set<{ listeners: Map<string, Set<EventListener>>; handle: StreamHandle; afterPaint: boolean }>();
let source: EventSource | null = null;
let lastContact = 0;
let stopHealthCheck: (() => void) | null = null;
let deferred: Array<() => void> = [];
let paintFrame: number | null = null;
let paintTask: ReturnType<typeof setTimeout> | null = null;
let paintFallback: ReturnType<typeof setTimeout> | null = null;

function clearDeferred() {
  if (paintFrame !== null) cancelAnimationFrame(paintFrame);
  if (paintTask !== null) clearTimeout(paintTask);
  if (paintFallback !== null) clearTimeout(paintFallback);
  paintFrame = paintTask = paintFallback = null;
  deferred = [];
}

function afterGridPaint(callbacks: Array<() => void>) {
  deferred.push(...callbacks);
  if (paintFallback !== null) return;
  const flush = () => {
    const pending = deferred;
    clearDeferred();
    for (const callback of pending) callback();
  };
  // The frame itself runs before paint; a following task leaves room for the grid.
  paintFrame = requestAnimationFrame(() => {
    paintFrame = null;
    paintTask = setTimeout(flush, 0);
  });
  // Hidden tabs may suspend frames. Still process every round, in order.
  paintFallback = setTimeout(flush, 100);
}

function dispatch(type: string, event: Event) {
  if (type === "error") clearDeferred();
  const later: Array<() => void> = [];
  for (const subscriber of [...handles]) {
    if (!handles.has(subscriber)) continue;
    const callbacks = [...(subscriber.listeners.get(type) || [])];
    if (type === "error" && subscriber.handle.onerror) callbacks.push(subscriber.handle.onerror);
    const deliver = () => {
      if (!handles.has(subscriber)) return;
      for (const callback of callbacks) {
        try { callback(event); } catch (error) { console.error("Crash stream subscriber failed", error); }
      }
    };
    if (subscriber.afterPaint && ["new_game", "stats", "stats_unavailable"].includes(type)) later.push(deliver);
    else deliver();
  }
  if (later.length && handles.size) afterGridPaint(later);
}

function connect() {
  clearDeferred();
  source?.close();
  const current = new EventSource(apiUrl("/api/stream"));
  source = current;
  lastContact = Date.now();
  for (const type of eventTypes) current.addEventListener(type, event => {
    if (source !== current) return;
    if (type !== "error") lastContact = Date.now();
    dispatch(type, event);
  });
}

function startHealthCheck() {
  function check(resuming = false) {
    if (!source || document.visibilityState === "hidden") return;
    const age = Date.now() - lastContact;
    // Pings arrive every 15 seconds, including between long-running games.
    if (age <= (resuming ? 20000 : 45000)
      && !(source.readyState === EventSource.CLOSED && age > 5000)) return;
    dispatch("error", new Event("error"));
    if (handles.size) connect();
  }
  const resume = () => check(true);
  const timer = setInterval(() => check(), 5000);
  document.addEventListener("visibilitychange", resume);
  for (const type of ["focus", "online", "pageshow"]) window.addEventListener(type, resume);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", resume);
    for (const type of ["focus", "online", "pageshow"]) window.removeEventListener(type, resume);
  };
}

// Each panel owns a subscription, but all panels share one network connection.
export function openCrashStream({ afterPaint = false } = {}): StreamHandle {
  const listeners = new Map<string, Set<EventListener>>();
  const handle: StreamHandle = {
    onerror: null,
    get readyState() { return source?.readyState ?? EventSource.CLOSED; },
    addEventListener(type, listener) {
      if (!handles.has(entry)) return;
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
      if (type === "open" && source?.readyState === EventSource.OPEN) {
        queueMicrotask(() => {
          if (handles.has(entry) && source?.readyState === EventSource.OPEN) listener(new Event("open"));
        });
      }
    },
    close() {
      handles.delete(entry);
      listeners.clear();
      if (!handles.size) {
        source?.close(); source = null;
        clearDeferred();
        stopHealthCheck?.(); stopHealthCheck = null;
      }
    },
  };
  const entry = { listeners, handle, afterPaint };
  handles.add(entry);
  if (!source) {
    connect();
    stopHealthCheck = startHealthCheck();
  }
  return handle;
}
