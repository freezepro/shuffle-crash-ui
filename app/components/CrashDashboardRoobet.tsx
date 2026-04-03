"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ---------- TYPES ----------

type MedianKey =
  | "med50"
  | "med100"
  | "med200"
  | "med500"
  | "med1000"
  | "med3000"
  | "med24h";

type CrashStatsPoint = {
  gameNumber: number;
  multiplier: number;
  timestamp: string;
  med50: number;
  med100: number;
  med200: number;
  med500: number;
  med1000: number;
  med3000: number;
  med24h: number;
};

const MAX_WINDOW = 3000;

// ---------- CONSTANTS ----------

const ALL_MEDIAN_KEYS: { key: MedianKey; label: string }[] = [
  { key: "med50", label: "Med 50" },
  { key: "med100", label: "Med 100" },
  { key: "med200", label: "Med 200" },
  { key: "med500", label: "Med 500" },
  { key: "med1000", label: "Med 1000" },
  { key: "med3000", label: "Med 3000" },
];

const PAGE_SIZE = 6500;

const MEDIAN_COLORS: Record<MedianKey, string> = {
  med50: "#22c55e",
  med100: "#3b82f6",
  med200: "#eab308",
  med500: "#ec4899",
  med1000: "#8b5cf6",
  med3000: "#f97316",
  med24h: "#a3e635",
};

// ---------- FAST MEDIAN (Quickselect) ----------

function partition(arr: number[], left: number, right: number, pivotIndex: number) {
  const pivotValue = arr[pivotIndex];
  [arr[pivotIndex], arr[right]] = [arr[right], arr[pivotIndex]];
  let storeIndex = left;

  for (let i = left; i < right; i++) {
    if (arr[i] < pivotValue) {
      [arr[storeIndex], arr[i]] = [arr[i], arr[storeIndex]];
      storeIndex++;
    }
  }

  [arr[right], arr[storeIndex]] = [arr[storeIndex], arr[right]];
  return storeIndex;
}

function quickSelect(arr: number[], k: number): number {
  let left = 0;
  let right = arr.length - 1;

  while (true) {
    if (left === right) return arr[left];

    const pivotIndex = partition(arr, left, right, (left + right) >> 1);

    if (k === pivotIndex) return arr[k];
    if (k < pivotIndex) right = pivotIndex - 1;
    else left = pivotIndex + 1;
  }
}

function medianQuick(values: number[]): number {
  const n = values.length;
  if (!n) return NaN;

  // quickselect мутує — робимо копію
  const copy = values.slice();
  const mid = n >> 1;

  if (n % 2 === 1) {
    return quickSelect(copy, mid);
  }

  const a = quickSelect(copy, mid - 1);
  const b = quickSelect(copy, mid);
  return (a + b) / 2;
}

// ---------- COMPONENT ----------

export default function CrashDashboardRoobet() {
  console.log("🔥 CrashDashboardRoobet render");
  const [data, setData] = useState<CrashStatsPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  const [visibleSeries, setVisibleSeries] = useState<Record<MedianKey, boolean>>({
    med50: true,
    med100: true,
    med200: true,
    med500: true,
    med1000: true,
    med3000: true,
    med24h: false,
  });

  // ---------- FETCH PAGE ----------

  const fetchPage = useCallback(async (page: number) => {
    // page 0: беремо менше (ти все одно показуєш 3500)
    const limit = page === 0 ? 6500 : PAGE_SIZE;

    const url = `https://crash-server-h01y.onrender.com/api/roobet/crash?page=${page}&limit=${limit}`;
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();

    if (!Array.isArray(json?.data)) {
      throw new Error(`Bad shape: ${JSON.stringify(json).slice(0, 200)}`);
    }

    // бекенд віддає newest → oldest, нам треба oldest → newest для rolling median
    const ordered = [...json.data].reverse();

    return ordered.map((g: any) => ({
      gameNumber: g.gameIndex,
      multiplier: g.multiplier,
      timestamp: g.timestamp,
    }));
  }, []);

  function buildRollingMedians(
    games: { gameNumber: number; multiplier: number; timestamp: string }[]
  ): CrashStatsPoint[] {
    const result: CrashStatsPoint[] = [];
    const multipliers: number[] = [];

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      multipliers.push(g.multiplier);

      result.push({
        gameNumber: g.gameNumber,
        timestamp: g.timestamp,
        multiplier: g.multiplier,

        // ✅ швидше: без sort
        med50: medianQuick(multipliers.slice(-50)),
        med100: medianQuick(multipliers.slice(-100)),
        med200: medianQuick(multipliers.slice(-200)),
        med500: medianQuick(multipliers.slice(-500)),
        med1000: medianQuick(multipliers.slice(-1000)),
        med3000: multipliers.length >= 3000 ? medianQuick(multipliers.slice(-3000)) : NaN,
        med24h: NaN,
      });
    }

    return result;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      try {
        setIsLoading(true);
        await new Promise(requestAnimationFrame);

        const pageGames = await fetchPage(pageIndex);

        // seed = MAX_WINDOW-1 ігор перед початком цієї сторінки
        let seed: { gameNumber: number; multiplier: number; timestamp: string }[] = [];

        // залишаю твою логіку (pageIndex > 1)
        if (pageIndex > 1) {
          const olderPage = await fetchPage(pageIndex + 1);
          seed = olderPage.slice(-(MAX_WINDOW - 1));
        }

        const combined = [...seed, ...pageGames];
        const computed = buildRollingMedians(combined);
        const pageOnly = computed.slice(seed.length);

        setData(pageOnly.slice(-3500));

        // ✅ прибрано штучну затримку 300мс
        // await new Promise((r) => setTimeout(r, 300));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadPage();
    return () => {
      cancelled = true;
    };
  }, [pageIndex, fetchPage]);

  useEffect(() => {
    if (pageIndex !== 0) return;

    console.log("📡 SSE connect (roobet)");

    const es = new EventSource("https://crash-server-h01y.onrender.com/api/roobet/stream");

    es.addEventListener("new_game", (e) => {
      const g = JSON.parse((e as MessageEvent).data);

      setData((prev) => {
        if (!prev.length) return prev;

        // ❗ якщо прийшов старий gameIndex — ігноруємо
        if (g.gameIndex <= prev[prev.length - 1].gameNumber) {
          return prev;
        }

        const multipliers = prev.map((p) => p.multiplier);
        multipliers.push(g.multiplier);

        const next: CrashStatsPoint = {
          gameNumber: g.gameIndex,
          multiplier: g.multiplier,
          timestamp: g.timestamp,

          // ✅ теж швидше: без sort
          med50: medianQuick(multipliers.slice(-50)),
          med100: medianQuick(multipliers.slice(-100)),
          med200: medianQuick(multipliers.slice(-200)),
          med500: medianQuick(multipliers.slice(-500)),
          med1000: medianQuick(multipliers.slice(-1000)),
          med3000: multipliers.length >= 3000 ? medianQuick(multipliers.slice(-3000)) : NaN,
          med24h: NaN,
        };

        return [...prev.slice(1), next];
      });
    });

    es.addEventListener("ping", () => {
      // keep-alive
    });

    es.onerror = (err) => {
      console.error("❌ SSE error (roobet)", err);
    };

    return () => {
      console.log("❌ SSE closed (roobet)");
      es.close();
    };
  }, [pageIndex]);

  // ---------- DERIVED ----------

  const latestPoint = data[data.length - 1];

  const currentMedians = useMemo(() => {
    if (!latestPoint) return null;

    return ALL_MEDIAN_KEYS.reduce<Record<MedianKey, number>>((acc, { key }) => {
      acc[key] = Number(latestPoint[key]?.toFixed(2));
      return acc;
    }, {} as any);
  }, [latestPoint]);

  const firstGame = data[0]?.gameNumber ?? "-";
  const lastGameNum = data[data.length - 1]?.gameNumber ?? "-";

  // ---------- HANDLERS ----------

  const handleToggleSeries = (key: MedianKey) => {
    setVisibleSeries((p) => ({ ...p, [key]: !p[key] }));
  };

  const handlePrevPage = () => {
    if (!isLoading) setPageIndex((p) => p + 1);
  };

  const handleNextPage = () => {
    if (!isLoading && pageIndex > 1) setPageIndex((p) => p - 1);
  };

  const yDomain = useMemo((): [number, number] => {
    const activeKeys = ALL_MEDIAN_KEYS
      .map((k) => k.key)
      .filter((k) => visibleSeries[k]);

    let min = Infinity;
    let max = -Infinity;

    for (const p of data) {
      for (const k of activeKeys) {
        const v = p[k];
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 3];

    const range = Math.max(0.01, max - min);
    const pad = Math.max(0.15, range * 0.35);

    return [min - pad, max + pad];
  }, [data, visibleSeries]);

  const dataWithIdx = useMemo(
    () => data.map((p, i) => ({ ...p, idx: i })),
    [data]
  );

  const XTick300 = (props: any) => {
    const { x, y, payload } = props;
    const idx: number = payload?.value;

    if (typeof idx !== "number") return <g />;

    const STEP = 300;
    if (idx % STEP !== 0) return <g />;

    const label = data[idx]?.gameNumber;
     console.log(label);
    if (!label) return <g />;

   

    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={16}
          textAnchor="middle"
          fill="#9ca3af"
          fontSize={11}
        >
          {label}
        </text>
      </g>
    );
  };



  // ---------- RENDER ----------

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        background: "#020617",
        color: "#e5e7eb",
        fontFamily: "system-ui",
      }}
    >
      <style jsx global>{`
        @keyframes skeleton {
          0% {
            background-position: 100% 0;
          }
          100% {
            background-position: -100% 0;
          }
        }
      `}</style>

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* MEDIANS */}
        <div
          style={{
            background: "#020617",
            borderRadius: 14,
            border: "1px solid #1f2937",
            padding: 16,
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 500 }}>Medians</h2>

          {currentMedians && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                gap: 10,
                marginTop: 10,
              }}
            >
              {ALL_MEDIAN_KEYS.map(({ key, label }) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{label}</div>
                  <div style={{ fontWeight: 600 }}>{currentMedians[key]}x</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CHART */}
        <div
          style={{
            background: "#020617",
            borderRadius: 14,
            border: "1px solid #1f2937",
            padding: 16,
          }}
        >
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
            {isLoading
              ? "Завантаження даних…"
              : `Показано ${data.length} агрегованих точок (≈ ${data.length} ігор)`}
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {ALL_MEDIAN_KEYS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleToggleSeries(key)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: visibleSeries[key] ? "1px solid #22c55e" : "1px solid #374151",
                  background: visibleSeries[key] ? "#022c22" : "#020617",
                  fontSize: 11,
                  color: visibleSeries[key] ? "#bbf7d0" : "#9ca3af",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* GRAPH + LOADING OVERLAY */}
          <div style={{ position: "relative", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={dataWithIdx} margin={{ left: 0, right: 20, top: 10, bottom: 0 }}>
                <CartesianGrid
                  stroke="#1f2937"
                  strokeDasharray="3 3"
                  vertical={true}
                  horizontal={true}
                />
                <XAxis
                  dataKey="idx"
                  interval={0}
                  tick={XTick300}
                  tickLine={false}
                  axisLine={{ stroke: "#1f2937" }}
                  minTickGap={0}
                />
                <YAxis
                  domain={yDomain}
                  tickCount={6}
                  tickFormatter={(v) => Number(v).toFixed(2)}
                  padding={{ top: 20, bottom: 20 }}
                  tickLine={false}
                  axisLine={{ stroke: "#1f2937" }}
                />
                <Tooltip />
                <Legend />

                {ALL_MEDIAN_KEYS.map(({ key, label }) =>
                  visibleSeries[key] ? (
                    <Line key={key} dataKey={key} name={label} stroke={MEDIAN_COLORS[key]} dot={false} />
                  ) : null
                )}
              </LineChart>
            </ResponsiveContainer>

            {isLoading && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(90deg, #020617ee 25%, #030712ee 37%, #020617ee 63%)",
                  backgroundSize: "400% 100%",
                  animation: "skeleton 1.4s ease infinite",
                  borderRadius: 14,
                  zIndex: 10,
                }}
              />
            )}
          </div>

          {/* PAGINATION */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <div style={{ color: "#6b7280" }}>
              Games {firstGame} – {lastGameNum}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handlePrevPage} disabled={isLoading}>
                ← Older
              </button>
              <button onClick={handleNextPage} disabled={isLoading || pageIndex === 0}>
                Newer →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
