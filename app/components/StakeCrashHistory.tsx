"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../lib/apiBase";

type CrashRow = {
  gameNumber: number; // gameIndex
  timestamp: string;  // ISO
  multiplier: number; // number
};

const PAGE_SIZE_NORMAL = 50;
const COMPACT_COLS = 10;
const RECENT_HOT_WINDOW = 80;
const CLUSTER_MIN_HITS = 3;
const TRIPLE_SPAN_MAX_ROUNDS = 7;
const CONTINUE_10X_MAX_GAP = 4;

function buildUrl(pageIndex: number, limit: number) {
  return `${apiUrl("/api/crash")}?page=${pageIndex}&limit=${limit}`;
}

function normalizeRow(g: any): CrashRow | null {
  const gameNumberRaw = g?.gameIndex ?? g?.gameNumber ?? g?.id ?? g?.game_id;
  const gameNumber = Number(gameNumberRaw);
  const multiplier = Number(g?.multiplier);
  const timestamp = String(g?.timestamp ?? "");

  if (!Number.isFinite(gameNumber)) return null;
  if (!Number.isFinite(multiplier)) return null;
  if (!timestamp) return null;

  return { gameNumber, multiplier, timestamp };
}

function formatDate(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function multiplierKey(x: number) {
  return (Math.floor(x * 100) / 100).toFixed(2);
}

function getSimilarRange(anchor: number): { min: number; max: number } {
  const a = anchor;

  if (a < 1.5) return { min: a - 0.01, max: a + 0.01 };
  if (a < 2.0) return { min: a - 0.03, max: a + 0.03 };
  if (a < 3.0) return { min: a - 0.05, max: a + 0.05 };
  if (a < 4.0) return { min: a - 0.15, max: a + 0.15 };
  if (a < 5.0) return { min: a - 0.25, max: a + 0.25 };

  // ✅ 5.00–5.99
  if (a < 6.0) return { min: a - 0.25, max: Math.floor(a) + 0.99 }; // 5.99

  // ✅ 6.00–6.99  (ТВОЄ ПРАВИЛО)
  if (a < 7.0) return { min: a - 0.45, max: Math.floor(a) + 0.99 }; // 6.99

  // ✅ 7.00–7.99
  if (a < 8.0) return { min: a - 0.45, max: Math.floor(a) + 0.99 }; // 7.99

  // ✅ 8.00–8.99
  if (a < 9.0) return { min: a - 0.50, max: Math.floor(a) + 0.99 }; // 8.99

  // ✅ 9.00–9.99
  if (a < 10.0) return { min: a - 0.70, max: Math.floor(a) + 0.99 }; // 9.99

  // ✅ 10.00–11.99
  if (a < 12.0) return { min: a - 1.0, max: 11.99 };

  if (a <= 20.0) return { min: 9.0, max: 22.0 };
  if (a <= 30.0) return { min: 18.0, max: 30.0 };
  if (a <= 50.0) return { min: 20.0, max: 70.0 };
  if (a <= 100.0) return { min: 20.0, max: 150.0 };

  return { min: 50.0, max: Number.POSITIVE_INFINITY };
}

function within2dp(x: number, min: number, max: number) {
  // порівнюємо “як на екрані” (2 знаки) через floor
  const toCents = (v: number) => Math.floor(v * 100 + 1e-9);
  const v = toCents(x);
  const mn = toCents(min);
  const mx = toCents(max);
  return v >= mn && v <= mx;
}

function buildRecentClusterMaps(entries: CrashRow[]) {
  const hotHitSet = new Set<number>();
  const betweenSet = new Set<number>();
  if (!Array.isArray(entries) || entries.length === 0) return { hotHitSet, betweenSet };

  const limit = Math.min(RECENT_HOT_WINDOW, entries.length);
  const hits9: number[] = [];
  const hits10: number[] = [];
  for (let i = 0; i < limit; i++) {
    const m = entries[i]?.multiplier;
    if (!Number.isFinite(m)) continue;
    if (m >= 9) hits9.push(i);
    if (m >= 10) hits10.push(i);
  }
  if (hits9.length < CLUSTER_MIN_HITS) return { hotHitSet, betweenSet };

  for (let k = 0; k <= hits9.length - CLUSTER_MIN_HITS; k++) {
    let start = hits9[k];
    let end = hits9[k + CLUSTER_MIN_HITS - 1];
    if (end - start > TRIPLE_SPAN_MAX_ROUNDS) continue;

    // If seed contains a long >4-miss break between 10x hits,
    // move block start to the newer dense 10x chain.
    const tenInSeed = hits10.filter((h) => h >= start && h <= end);
    if (tenInSeed.length >= 2) {
      let adjustedStart = start;
      for (let t = 1; t < tenInSeed.length; t++) {
        const misses = tenInSeed[t] - tenInSeed[t - 1] - 1;
        if (misses > CONTINUE_10X_MAX_GAP) adjustedStart = tenInSeed[t];
      }
      start = adjustedStart;
    }

    const tenForExtend = hits10.filter((h) => h >= start && h <= end);
    if (tenForExtend.length > 0) {
      let anchor10 = tenForExtend[tenForExtend.length - 1];
      for (const h of hits10) {
        if (h <= anchor10) continue;
        const misses = h - anchor10 - 1;
        if (misses <= CONTINUE_10X_MAX_GAP) {
          end = h;
          anchor10 = h;
        } else {
          break;
        }
      }
    }

    for (let i = start; i <= end; i++) betweenSet.add(i);
    for (const h of hits9) {
      if (h >= start && h <= end) hotHitSet.add(h);
    }
  }

  return { hotHitSet, betweenSet };
}



function isSameMultiplier(a: number, b: number) {
  return multiplierKey(a) === multiplierKey(b);
}

export default function StakeCrashHistory() {
  const [rows, setRows] = useState<CrashRow[]>([]);
  const [pageIndex, setPageIndex] = useState(0); // 0 = latest
  const [isLoading, setIsLoading] = useState(false);
  const [compact, setCompact] = useState(true);
  const [compactRows, setCompactRows] = useState(20);

  const pageSize = compact ? COMPACT_COLS * compactRows : PAGE_SIZE_NORMAL;

  // SSE only after first HTTP load
  const [bootstrapped, setBootstrapped] = useState(false);

  // protect from duplicates / old events
  const latestGameRef = useRef<number>(0);
  const latestMultiplierRef = useRef<number | null>(null);
  const [latestMultiplier, setLatestMultiplier] = useState<number | null>(null);


  const isLatestPage = pageIndex === 0;

  const fetchPage = useCallback(async (page: number, limit: number) => {
    const url = buildUrl(page, limit);
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();

    if (!Array.isArray(json?.data)) {
      throw new Error(`Bad shape: ${JSON.stringify(json).slice(0, 200)}`);
    }

    // UI wants newest on top (as backend usually returns newest -> oldest)
    return (json.data as any[])
      .map(normalizeRow)
      .filter(Boolean) as CrashRow[];
  }, []);

  // HTTP bootstrap + pagination
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setIsLoading(true);

        const data = await fetchPage(pageIndex, pageSize);
        if (cancelled) return;

        setRows(data);

        if (pageIndex === 0 && data.length) {
          latestMultiplierRef.current = data[0].multiplier; // newest on latest page
          setLatestMultiplier(data[0].multiplier);
        }

        // latestGameRef for SSE
        if (pageIndex === 0 && data.length) {
          latestGameRef.current = Math.max(...data.map((r) => r.gameNumber));
        }

        setBootstrapped(true);
      } catch (e) {
        console.error("❌ fetch history error", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageIndex, pageSize, fetchPage]);

  // SSE only on latest page + after bootstrap
  useEffect(() => {
    if (!isLatestPage) return;
    if (!bootstrapped) return;

    const es = new EventSource(apiUrl("/api/stream"));

    es.addEventListener("new_game", (e) => {
      try {
        const raw = JSON.parse((e as MessageEvent).data);
        const row = normalizeRow(raw);
        if (!row) return;

        if (row.gameNumber <= latestGameRef.current) return;
        latestGameRef.current = row.gameNumber;
        latestMultiplierRef.current = row.multiplier;
        setLatestMultiplier(row.multiplier);

        setRows((prev) => {
          const merged = [row, ...prev];

          // dedupe by gameNumber + trim to current pageSize
          const uniq: CrashRow[] = [];
          const seen = new Set<number>();

          for (const r of merged) {
            if (seen.has(r.gameNumber)) continue;
            seen.add(r.gameNumber);
            uniq.push(r);
            if (uniq.length >= pageSize) break;
          }

          return uniq;
        });
      } catch (err) {
        console.error("❌ SSE parse error", err);
      }
    });

    es.onerror = (err) => {
      console.error("❌ SSE error", err);
    };

    return () => {
      es.close();
    };
  }, [isLatestPage, bootstrapped, pageSize]);

  const first = rows[rows.length - 1]?.gameNumber ?? "-"; // oldest on page
  const last = rows[0]?.gameNumber ?? "-";               // newest on page

  const gridCols = useMemo(
    () => `repeat(${COMPACT_COLS}, minmax(0, 1fr))`,
    []
  );

  const columns = useMemo(() => {
    if (!compact) return [];

    const cols: CrashRow[][] = Array.from(
      { length: COMPACT_COLS },
      () => []
    );

    rows.forEach((row, idx) => {
      const colIdx = Math.floor(idx / compactRows);
      if (colIdx < COMPACT_COLS) {
        cols[colIdx].push(row);
      }
    });

    return cols;
  }, [rows, compact, compactRows]);

  const bottomRow = useMemo(() => {
    if (!compact) return [];
    // беремо останній елемент в кожній колонці (в повному 200-режимі це буде idx 19)
    return columns.map((c) => c[c.length - 1]).filter(Boolean) as CrashRow[]; // 10
  }, [columns, compact]);

  const ghostRowRight = useMemo(() => {
    // зсув вправо: значення з колонки 1..9 кладемо над 2..10
    return bottomRow.length ? bottomRow.slice(0, 9) : []; // 9
  }, [bottomRow]);
  const clusterMaps = useMemo(() => buildRecentClusterMaps(rows), [rows]);


  const latestKey = useMemo(() => {
    if (!rows.length) return null;
    return multiplierKey(rows[0].multiplier); // newest on page
  }, [rows]);

  const pageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = multiplierKey(r.multiplier);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const shouldHighlight = useCallback(
    (r: CrashRow) => {
      if (!latestKey) return false;

      const k = multiplierKey(r.multiplier);

      // ✅ Підсвічувати тільки якщо є повтори (щоб не світити лише останній)
      return k === latestKey && (pageCounts.get(latestKey) ?? 0) > 1;

      // Якщо хочеш підсвічувати ВСІ, навіть коли повторів нема (лише останній) —
      // заміни рядок вище на: return k === latestKey;
    },
    [latestKey, pageCounts]
  );

  const shouldHighlightSimilar = useCallback(
    (r: CrashRow) => {
      const anchor = latestMultiplierRef.current ?? latestMultiplier;
      if (anchor == null) return false;
      if (anchor >= 10 || r.multiplier >= 10) return false;

      const { min, max } = getSimilarRange(anchor);
      return within2dp(r.multiplier, min, max);
    },
    [latestMultiplier]
  );


  return (
    <div
      style={{
        background: "#020617",
        borderRadius: 14,
        border: "1px solid #1f2937",
        padding: 15,
        marginTop: 10,
        color: "#e5e7eb",
        fontFamily: "system-ui",


      }}
    >

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
      </div>

      {/* CONTENT */}
      <div style={{ marginTop: 10 }}>
        {!compact ? (
          // TABLE MODE
          <div style={{ borderTop: "1px solid #1f2937" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "70px 1fr 140px",
                padding: "10px 8px",
                color: "#cbd5e1",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <div>#</div>
              <div style={{ textAlign: "center" }}>Time</div>
              <div style={{ textAlign: "right" }}>Multiplier</div>
            </div>

            {rows.map((r, i) => {
              const highlightGreen = shouldHighlight(r);
              const inClusterBetween = !highlightGreen && clusterMaps.betweenSet.has(i);
              const isClusterHit = !highlightGreen && clusterMaps.hotHitSet.has(i);
              const highlightYellow =
                !highlightGreen && !inClusterBetween && !isClusterHit && shouldHighlightSimilar(r);

              return (
                <div
                  key={r.gameNumber}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 1fr 140px",
                    padding: "10px 8px",
                    borderTop: "1px solid #0f172a",
                    alignItems: "center",
                    fontSize: 13,

                    // ✅ highlight row
                    background: highlightGreen
                      ? "rgba(34, 197, 94, 0.10)"
                      : highlightYellow
                        ? "rgba(234, 179, 8, 0.12)"
                        : isClusterHit
                          ? "rgba(56, 189, 248, 0.24)"
                          : inClusterBetween
                            ? "rgba(148, 163, 184, 0.24)"
                        : "transparent",

                    outline: highlightGreen
                      ? "1px solid rgba(34, 197, 94, 0.35)"
                      : highlightYellow
                        ? "1px solid rgba(234, 179, 8, 0.45)"
                        : "none",

                    borderRadius: (highlightGreen || highlightYellow) ? 8 : 0,

                  }}
                >
                  <div style={{ color: "#cbd5e1" }}>{i + 1}</div>
                  <div style={{ textAlign: "center", color: "#e2e8f0" }}>{formatDate(r.timestamp)}</div>

                  <div
                    style={{
                      textAlign: "right",
                      fontWeight: 700,
                      color: r.multiplier >= 2 ? "#22c55e" : "#e5e7eb",

                      // ✅ optional accent
                      textShadow: highlightGreen
                        ? "0 0 10px rgba(34,197,94,0.55)"
                        : highlightYellow
                          ? "0 0 10px rgba(234,179,8,0.45)"
                          : "none",
                    }}
                  >
                    {multiplierKey(r.multiplier)}x
                  </div>
                </div>
              );
            })}

          </div>
        ) : (
          <div style={{ position: "relative", overflow: "visible" }}>
            {ghostRowRight.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: -39,
                  opacity: 0.8,
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  gap: 9,
                  filter: "blur(0.2px)",
                }}
              >
                <div
                  style={{
                    pointerEvents: "auto",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setCompactRows((r) => (r === 20 ? 10 : 20))}
                    style={rowsBtnStyle}
                    title="Toggle compact rows (20/10)"
                  >
                    Rows:{compactRows}
                  </button>
                </div>
                {ghostRowRight.map((r, i) => (
                  (() => {
                    const ghostIdx = compactRows > 0 ? (i * compactRows + (compactRows - 1)) : Number.POSITIVE_INFINITY;
                    const inClusterBetween = clusterMaps.betweenSet.has(ghostIdx);
                    const isClusterHit = clusterMaps.hotHitSet.has(ghostIdx);
                    return (
                  <div
                    key={`ghost-${r.gameNumber}`}
                    style={{
                      gridColumn: i + 2,
                      background: isClusterHit
                        ? "rgba(56, 189, 248, 0.18)"
                        : inClusterBetween
                          ? "rgba(148, 163, 184, 0.16)"
                          : "rgba(17, 24, 39, 0.35)",
                      border: "1px dashed rgba(148, 163, 184, 0.18)",
                      boxShadow: "none",
                      padding: "7px",
                      pointerEvents: "none",
                      textAlign: "center",
                      fontWeight: 500,
                      borderRadius: 5,
                      color:
                        r.multiplier >= 2
                            ? "rgba(34,197,94,0.85)"
                            : "rgba(229,231,235,0.85)",
                      backdropFilter: "blur(6px)",
                    }}
                    title={formatDate(r.timestamp)}
                  >
                    {multiplierKey(r.multiplier)}x
                  </div>
                    );
                  })()
                ))}
              </div>
            )}


            {/* MAIN GRID */}
            <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 9 }}>
              {columns.map((col, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {col.map((r, j) => {
                    const highlightGreen = shouldHighlight(r);
                    const globalIdx = compactRows > 0 ? (i * compactRows + j) : Number.POSITIVE_INFINITY;
                    const inClusterBetween = !highlightGreen && clusterMaps.betweenSet.has(globalIdx);
                    const isClusterHit = !highlightGreen && clusterMaps.hotHitSet.has(globalIdx);
                    const highlightYellow =
                      !highlightGreen && !inClusterBetween && !isClusterHit && shouldHighlightSimilar(r);

                    return (
                      <div
                        key={r.gameNumber}
                        style={{
                          fontFamily: "Arial, sans-serif",
                          background: highlightGreen
                            ? "rgba(34, 197, 94, 0.14)"
                            : highlightYellow
                              ? "rgba(234, 179, 8, 0.14)"
                              : isClusterHit
                                ? "rgba(56, 189, 248, 0.28)"
                                : inClusterBetween
                                  ? "rgba(148, 163, 184, 0.24)"
                              : "#111827",

                          border: highlightGreen
                            ? "1px solid rgba(34,197,94,0.55)"
                            : highlightYellow
                              ? "1px solid rgba(234,179,8,0.55)"
                              : "1px solid #1f2937",

                          boxShadow: highlightGreen
                            ? "0 0 0 2px rgba(34,197,94,0.10), 0 0 18px rgba(34,197,94,0.22)"
                            : highlightYellow
                              ? "0 0 0 2px rgba(234,179,8,0.10), 0 0 18px rgba(234,179,8,0.20)"
                              : "none",

                          padding: "7px",
                          textAlign: "center",
                          fontWeight: 500,
                          color:
                            r.multiplier >= 2
                                ? "#22c55e"
                                : "#e5e7eb",
                          borderRadius: 5,
                          ...(j === 0 ? styles.firstRowDivider : null),
                        }}
                        title={formatDate(r.timestamp)}
                      >
                        {multiplierKey(r.multiplier)}x
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* PAGINATION */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, alignItems: "center" }}>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          Page {pageIndex} {isLatestPage ? "(latest)" : ""}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => !isLoading && setPageIndex((p) => p + 1)}
            disabled={isLoading}
            style={btnStyle(isLoading)}
          >
            ← Older
          </button>

          <button
            onClick={() => !isLoading && setPageIndex((p) => Math.max(0, p - 1))}
            disabled={isLoading || pageIndex === 0}
            style={btnStyle(isLoading || pageIndex === 0)}
          >
            Newer →
          </button>
        </div>
      </div>
    </div>
  );
}

function btnStyle(disabled?: boolean): React.CSSProperties {
  return {
    padding: "7px 12px",
    borderRadius: 8,
    border: "1px solid #374151",
    background: disabled ? "#0b1220" : "#111827",
    color: disabled ? "#475569" : "#e5e7eb",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
  };
}

const rowsBtnStyle: React.CSSProperties = {
  background: "#2a2d35",
  border: "1px solid #3f4654",
  color: "#e5e7eb",
  borderRadius: 5,
  padding: "2px 6px",
  fontSize: 10,
  lineHeight: 1,
  fontWeight: 700,
  cursor: "pointer",
  width: "auto",
  whiteSpace: "nowrap",
};

const styles: Record<string, React.CSSProperties> = {
  firstRowDivider: {
    borderTop: "1px solid rgba(148, 163, 184, 0.35)",
    boxShadow: "inset 0 1px 0 rgba(2, 6, 23, 0.55)",
  },
};
