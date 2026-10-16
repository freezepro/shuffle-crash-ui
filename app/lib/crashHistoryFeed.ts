import { openCrashStream } from "./crashEvents";

type Row = { gameNumber: number };

export function subscribeCrashHistory<T extends Row>({
  limit, load, parse, onRows, onLoading, onError,
}: {
  limit: number;
  load: (signal: AbortSignal) => Promise<T[]>;
  parse: (raw: unknown) => T | null;
  onRows: (rows: T[], liveEvent: boolean) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: unknown) => void;
}) {
  let active = true, rows: T[] = [], lastAttempt = -Infinity, lastResume = -Infinity;
  let request: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const stream = openCrashStream();

  function publish(incoming: T[], liveEvent = false) {
    // Live arrivals take precedence over a snapshot started before those arrivals.
    const merged = new Map(incoming.map(row => [row.gameNumber, row]));
    for (const row of rows) merged.set(row.gameNumber, row);
    rows = [...merged.values()].sort((a, b) => b.gameNumber - a.gameNumber).slice(0, limit);
    onRows(rows, liveEvent);
  }

  async function refresh() {
    if (!active || request) return;
    clearTimeout(retry);
    const controller = new AbortController();
    request = controller;
    lastAttempt = Date.now();
    if (!rows.length) onLoading(true);
    timeout = setTimeout(() => {
      if (request !== controller) return;
      request = null;
      controller.abort();
      onLoading(false);
      retry = setTimeout(refresh, 3000);
    }, 10000);
    try {
      const incoming = await load(controller.signal);
      if (!active || request !== controller) return;
      publish(incoming);
      if (rows.some((row, index) => index > 0 && rows[index - 1].gameNumber !== row.gameNumber + 1)) {
        retry = setTimeout(refresh, 3000);
      }
    } catch (error) {
      if (!active || request !== controller) return;
      onError(error);
      retry = setTimeout(refresh, 3000);
    } finally {
      if (request === controller) {
        request = null;
        clearTimeout(timeout);
        onLoading(false);
      }
    }
  }

  stream.addEventListener("new_game", event => {
    try {
      const row = parse(JSON.parse((event as MessageEvent).data));
      if (!row || row.gameNumber <= (rows[0]?.gameNumber ?? 0)) return;
      const gap = rows.length > 0 && row.gameNumber > rows[0].gameNumber + 1;
      publish([row], true);
      if (gap) void refresh();
    } catch (error) { onError(error); }
  });
  stream.addEventListener("open", () => { void refresh(); });

  function resume() {
    if (document.visibilityState === "hidden" || Date.now() - lastResume < 1000) return;
    lastResume = Date.now();
    if (request && Date.now() - lastAttempt >= 10000) {
      request.abort(); request = null; clearTimeout(timeout);
    }
    void refresh();
  }
  document.addEventListener("visibilitychange", resume);
  for (const type of ["focus", "online", "pageshow"]) window.addEventListener(type, resume);
  const fallback = setInterval(() => {
    if (document.visibilityState !== "hidden" && stream.readyState !== EventSource.OPEN
      && Date.now() - lastAttempt >= 10000) void refresh();
  }, 10000);
  void refresh();

  return () => {
    active = false;
    request?.abort(); request = null;
    clearTimeout(timeout); clearTimeout(retry); clearInterval(fallback);
    document.removeEventListener("visibilitychange", resume);
    for (const type of ["focus", "online", "pageshow"]) window.removeEventListener(type, resume);
    stream.close();
  };
}
