"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../lib/apiBase";

type CrashRow = {
  gameNumber: number; // gameIndex
  timestamp: string;
  multiplier: number;
};

const PAGE_SIZE_NORMAL = 50;
const COMPACT_COLS = 10;
const COMPACT_ROWS_PER_COL = 20;
const PAGE_SIZE_COMPACT = COMPACT_COLS * COMPACT_ROWS_PER_COL; // 200


function buildUrl(pageIndex: number, limit: number) {
  return `${apiUrl("/api/roobet/crash")}?page=${pageIndex}&limit=${limit}`;
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
  return x.toFixed(2);
}

function getSimilarRange(anchor: number): { min: number; max: number } {
  const a = anchor;

  if (a < 1.5) return { min: a - 0.01, max: a + 0.01 };
  if (a < 2.0) return { min: a - 0.03, max: a + 0.03 };
  if (a < 3.0) return { min: a - 0.05, max: a + 0.05 };
  if (a < 4.0) return { min: a - 0.15, max: a + 0.15 };
  if (a < 5.0) return { min: a - 0.25, max: a + 0.25 };

  // ✅ 5.xx (якщо треба)
  if (a < 6.0) return { min: a - 0.25, max: 5.99 };

  // ✅ 6.xx — ТВОЄ ПРАВИЛО: мінус 0.45 і до 6.99
  if (a < 7.0) return { min: a - 0.45, max: 6.99 };

  // 7.xx
  if (a < 8.0) return { min: a - 0.45, max: 7.99 };

  // 8.xx
  if (a < 9.0) return { min: a - 0.5, max: 8.99 };

  // 9.xx
  if (a < 10.0) return { min: a - 0.7, max: 9.99 };

  if (a < 12.0) return { min: a - 1.0, max: 11.99 };

  if (a <= 20.0) return { min: 9.0, max: 22.0 };
  if (a <= 30.0) return { min: 18.0, max: 30.0 };
  if (a <= 50.0) return { min: 20.0, max: 70.0 };
  if (a <= 100.0) return { min: 20.0, max: 150.0 };

  return { min: 50.0, max: Number.POSITIVE_INFINITY };
}

function within2dp(x: number, min: number, max: number) {
  // порівнюємо “як на екрані” (2 знаки) стабільно, без round()
  const toCents = (v: number) => Math.floor(v * 100 + 1e-9);
  const v = toCents(x);
  const mn = toCents(min);
  const mx = toCents(max);
  return v >= mn && v <= mx;
}



export default function RoobetCrashHistory() {
  const [rows, setRows] = useState<CrashRow[]>([]);
  const [pageIndex, setPageIndex] = useState(0); // 0 = latest
  const [isLoading, setIsLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const pageSize = compact ? PAGE_SIZE_COMPACT : PAGE_SIZE_NORMAL;

  const [bootstrapped, setBootstrapped] = useState(false);
  const latestGameRef = useRef<number>(0);
  const latestMultiplierRef = useRef<number | null>(null);
  const [latestMultiplier, setLatestMultiplier] = useState<number | null>(null);

  const isLatestPage = pageIndex === 0;

  const fetchPage = useCallback(
    async (page: number) => {
      const url = buildUrl(page, pageSize);
      const res = await fetch(url);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      if (!Array.isArray(json?.data)) {
        throw new Error(`Bad shape: ${JSON.stringify(json).slice(0, 200)}`);
      }

      // UI: newest зверху (як у скріні)
      return json.data.map(normalizeRow).filter(Boolean) as CrashRow[];
    },
    [pageSize]
  );

  // HTTP bootstrap + pagination
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setIsLoading(true);

        const data = await fetchPage(pageIndex);
        if (cancelled) return;

        setRows(data);

        if (pageIndex === 0 && data.length) {
          latestMultiplierRef.current = data[0].multiplier; // newest on latest page
          setLatestMultiplier(data[0].multiplier);
        }

        if (pageIndex === 0 && data.length) {
          latestGameRef.current = Math.max(...data.map((r) => r.gameNumber));
        }

        setBootstrapped(true);
      } catch (e) {
        console.error("❌ roobet history fetch error", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageIndex, fetchPage]);

  // SSE тільки на latest і тільки після bootstrap
  useEffect(() => {
    if (!isLatestPage) return;
    if (!bootstrapped) return;

    const es = new EventSource(apiUrl("/api/roobet/stream"));

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

          // uniq + обрізка до pageSize
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
        console.error("❌ roobet SSE parse error", err);
      }
    });

    es.addEventListener("ping", () => { });

    es.onerror = (err) => {
      console.error("❌ roobet SSE error", err);
    };

    return () => es.close();
  }, [isLatestPage, bootstrapped, pageSize]);

  const first = rows[rows.length - 1]?.gameNumber ?? "-";
  const last = rows[0]?.gameNumber ?? "-";

  const gridCols = useMemo(
    () => `repeat(${COMPACT_COLS}, minmax(0, 1fr))`,
    []
  );

  const columns = useMemo(() => {
    if (!compact) return [];

    const cols: CrashRow[][] = Array.from({ length: COMPACT_COLS }, () => []);

    rows.forEach((row, idx) => {
      const colIdx = Math.floor(idx / COMPACT_ROWS_PER_COL); // 0..7
      if (colIdx < COMPACT_COLS) cols[colIdx].push(row);
    });

    return cols;
  }, [rows, compact]);

  const bottomRow = useMemo(() => {
    if (!compact) return [];
    return columns.map((c) => c[c.length - 1]).filter(Boolean) as CrashRow[]; // 10
  }, [columns, compact]);

  const ghostRowRight = useMemo(() => {
    // зсув вправо: колонки 1..9 -> над 2..10
    return bottomRow.length ? bottomRow.slice(0, 9) : []; // 9
  }, [bottomRow]);



  // ✅ highlight all rows that match latest multiplier on this page (same formatting: 2 decimals)
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

      // ✅ Підсвічувати тільки якщо є повтори на сторінці
      return k === latestKey && (pageCounts.get(latestKey) ?? 0) > 1;

      // Якщо хочеш підсвічувати ВСІ (навіть якщо повторів нема) — заміни на:
      // return k === latestKey;
    },
    [latestKey, pageCounts]
  );

  const shouldHighlightSimilar = useCallback(
    (r: CrashRow) => {
      const anchor = latestMultiplierRef.current ?? latestMultiplier;
      if (anchor == null) return false;

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
        padding: 16,
        marginTop: 12,
        color: "#e5e7eb",
        fontFamily: "system-ui",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        {/* <div style={{ fontSize: 18, fontWeight: 700 }}>🚀 Roobet Crash History</div> */}

        {/* <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#cbd5e1" }}>
          Compact Mode
          <input
            type="checkbox"
            checked={compact}
            onChange={(e) => {
              setCompact(e.target.checked);
              setPageIndex(0); // при зміні ліміту логічно повертатися на latest
            }}
          />
        </label> */}
        {/* <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
          {isLoading ? "Завантаження…" : `Показано ${rows.length} ігор. Games ${first} – ${last}`}
        </div> */}
      </div>

      <div style={{ marginTop: 12 }}>
        {!compact ? (
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
              const highlightYellow = !highlightGreen && shouldHighlightSimilar(r);

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
                  top: -40,
                  opacity: 0.8,
                  pointerEvents: "none",
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  gap: 10,
                  filter: "blur(0.2px)",
                }}
              >
                {ghostRowRight.map((r, i) => (
                  <div
                    key={`ghost-${r.gameNumber}`}
                    style={{
                      gridColumn: i + 2,
                      background: "rgba(17, 24, 39, 0.35)",
                      border: "1px dashed rgba(148, 163, 184, 0.18)",
                      boxShadow: "none",
                      padding: "6px 12px",
                      textAlign: "center",
                      fontWeight: 500,
                      borderRadius: 5, // у тебе тут 5
                      color: r.multiplier >= 2 ? "rgba(34,197,94,0.85)" : "rgba(229,231,235,0.85)",
                      backdropFilter: "blur(6px)",
                    }}
                    title={formatDate(r.timestamp)}
                  >
                    {multiplierKey(r.multiplier)}x
                  </div>
                ))}
              </div>
            )}

            {/* MAIN GRID */}
            <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 10 }}>
              {columns.map((col, cIdx) => (
                <div key={cIdx} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {col.map((r) => {
                    const highlightGreen = shouldHighlight(r);
                    const highlightYellow = !highlightGreen && shouldHighlightSimilar(r);

                    return (
                      <div
                        key={r.gameNumber}
                        style={{
                          fontFamily: "Arial, sans-serif",
                          background: highlightGreen
                            ? "rgba(34, 197, 94, 0.14)"
                            : highlightYellow
                              ? "rgba(234, 179, 8, 0.14)"
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
                          borderRadius: 5,
                          padding: "8px 12px",
                          textAlign: "center",
                          fontWeight: 500,
                          color: r.multiplier >= 2 ? "#22c55e" : "#e5e7eb",
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

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, alignItems: "center" }}>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          Page {pageIndex} {isLatestPage ? "(latest)" : ""}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => !isLoading && setPageIndex((p) => p + 1)}
            disabled={isLoading}
            style={btnStyle()}
          >
            ← Older
          </button>

          <button
            onClick={() => !isLoading && setPageIndex((p) => Math.max(0, p - 1))}
            disabled={isLoading || pageIndex === 0}
            style={btnStyle(pageIndex === 0)}
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
