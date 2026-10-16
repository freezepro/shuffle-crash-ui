import { apiUrl } from "./apiBase";

type StreamHandle = {
  addEventListener: (type: string, listener: EventListener) => void;
  onerror: ((event: Event) => void) | null;
  readonly readyState: number;
  close: () => void;
};
const eventTypes = ["open", "error", "ping", "new_game", "stats", "stats_unavailable"];
const handles = new Set<{ listeners: Map<string, Set<EventListener>>; handle: StreamHandle }>();
let source: EventSource | null = null;

// Each panel owns a subscription, but all panels share one network connection.
export function openCrashStream(): StreamHandle {
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
      if (!handles.size) { source?.close(); source = null; }
    },
  };
  const entry = { listeners, handle };
  handles.add(entry);
  if (!source) {
    const current = new EventSource(apiUrl("/api/stream"));
    source = current;
    for (const type of eventTypes) current.addEventListener(type, event => {
      if (source !== current) return;
      for (const subscriber of [...handles]) {
        if (!handles.has(subscriber)) continue;
        const callbacks = [...(subscriber.listeners.get(type) || [])];
        if (type === "error" && subscriber.handle.onerror) callbacks.push(subscriber.handle.onerror);
        for (const callback of callbacks) {
          try { callback(event); } catch (error) { console.error("Crash stream subscriber failed", error); }
        }
      }
    });
  }
  return handle;
}
