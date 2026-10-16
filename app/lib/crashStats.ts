import { apiUrl } from "./apiBase";
import { openCrashStream } from "./crashEvents";

export type CrashStats = {
  success: true;
  medians: unknown[];
  pS10: unknown;
  pS2_50: unknown;
  trend: unknown;
  asOfGameIndex?: number | null;
  stale?: boolean;
  liveUpdate?: boolean;
};
type Listener = (stats: CrashStats | null) => void;
const listeners = new Set<Listener>();
let snapshot: CrashStats | null = null;
let stop: (() => void) | null = null;

function readStats(value: any): CrashStats | null {
  return value?.success === true && Array.isArray(value.medians)
    ? { ...value, stale: false, liveUpdate: false } : null;
}
function publish(value: CrashStats | null) {
  snapshot = value;
  for (const listener of listeners) listener(value);
}

function markStale() {
  if (snapshot && !snapshot.stale) publish({ ...snapshot, stale: true, liveUpdate: false });
}

function start() {
  const stream = openCrashStream({ afterPaint: true });
  let active = true, revision = 0, requiredHead = -1, lastUpdated = 0, lastAttempt = -Infinity;
  let request: AbortController | null = null;
  let lastResume = -Infinity, lastRound = -1;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const isCurrent = (value: CrashStats) =>
    value.asOfGameIndex == null || value.asOfGameIndex >= requiredHead;

  async function refresh() {
    if (!active || request) return;
    const controller = new AbortController(), version = revision;
    request = controller;
    lastAttempt = Date.now();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(apiUrl("/api/medians"), { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Stats unavailable");
      const value = readStats(await response.json());
      if (!active || controller.signal.aborted || revision !== version) return;
      if (!value || !isCurrent(value)) throw new Error("Stats behind latest round");
      requiredHead = Math.max(requiredHead, value.asOfGameIndex ?? -1);
      lastUpdated = Date.now();
      publish(value);
    } catch {
      if (active && revision === version) markStale();
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }

  stream.addEventListener("stats", event => {
    try {
      const value = readStats(JSON.parse((event as MessageEvent).data));
      if (!value || !isCurrent(value)) return;
      if (snapshot?.asOfGameIndex != null && value.asOfGameIndex != null &&
          value.asOfGameIndex < snapshot.asOfGameIndex) return;
      revision++;
      requiredHead = Math.max(requiredHead, value.asOfGameIndex ?? -1);
      lastUpdated = Date.now();
      clearTimeout(fallback);
      publish({ ...value, liveUpdate: !snapshot?.stale && value.asOfGameIndex === lastRound &&
        document.visibilityState !== "hidden" });
    } catch { /* The fallback refresh handles malformed events. */ }
  });
  stream.addEventListener("new_game", event => {
    try {
      const round = JSON.parse((event as MessageEvent).data);
      if (Number.isSafeInteger(round.gameIndex)) {
        requiredHead = Math.max(requiredHead, round.gameIndex);
        lastRound = round.gameIndex;
      }
    } catch { /* HTTP will restore a complete snapshot. */ }
    clearTimeout(fallback);
    fallback = setTimeout(() => { markStale(); void refresh(); }, 1500);
  });
  stream.addEventListener("open", () => { void refresh(); });
  stream.addEventListener("stats_unavailable", () => {
    revision++;
    markStale();
    clearTimeout(fallback);
    fallback = setTimeout(() => { void refresh(); }, 1500);
  });
  stream.onerror = () => {
    revision++;
    lastUpdated = 0;
    markStale();
  };
  const health = setInterval(() => {
    const behind = snapshot?.asOfGameIndex != null && snapshot.asOfGameIndex < requiredHead;
    if ((behind || !snapshot || snapshot.stale || Date.now() - lastUpdated >= 30000) && Date.now() - lastAttempt >= 5000) {
      if (behind) markStale();
      void refresh();
    }
  }, 5000);
  function resume() {
    if (document.visibilityState === "hidden" || Date.now() - lastResume < 1000) return;
    lastResume = Date.now();
    if (Date.now() - lastUpdated >= 30000 || stream.readyState !== EventSource.OPEN) markStale();
    // Background tabs can suspend both fetches and their timeout callbacks.
    if (request && Date.now() - lastAttempt >= 10000) {
      revision++;
      request.abort();
      request = null;
    }
    void refresh();
  }
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  window.addEventListener("pageshow", resume);
  void refresh();
  return () => {
    active = false;
    clearInterval(health);
    clearTimeout(fallback);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", resume);
    window.removeEventListener("pageshow", resume);
    request?.abort();
    stream.close();
    snapshot = null;
  };
}

export function subscribeCrashStats(listener: Listener) {
  listeners.add(listener);
  listener(snapshot);
  if (!stop) stop = start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stop?.(); stop = null; }
  };
}
