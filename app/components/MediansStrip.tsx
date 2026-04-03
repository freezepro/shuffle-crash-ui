"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

const URL = "https://crash-server-h01y.onrender.com/api/medians";
const WINDOWS = [50, 100, 200, 500, 1000, 3000];

export default function MediansStrip() {
  const [medians, setMedians] = useState<number[]>([]);
  const [pS10, setPS10] = useState<number | null>(null);
  const inflightRef = useRef(false);

  useEffect(() => {
    async function load() {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const res = await fetch(`${URL}?_t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();
        const vals = Array.isArray(data?.medians) ? data.medians : [];
        setMedians(vals);
        const p = Number(data?.pS10);
        if (Number.isFinite(p)) setPS10(p);
      } catch (e) {
        console.error("medians load error", e);
      } finally {
        inflightRef.current = false;
      }
    }

    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const mapped = useMemo(() => {
    const out: Record<number, number | null> = {};
    WINDOWS.forEach((w, i) => {
      const n = Number(medians[i]);
      out[w] = Number.isFinite(n) ? n : null;
    });
    return out;
  }, [medians]);

  return (
    <section style={styles.wrap}>
      <div style={styles.row}>
        {WINDOWS.map((w) => {
          const m = mapped[w];
          return (
            <div key={w} style={styles.cell}>
              <div style={styles.label}>Med {w}</div>
              <div style={{ ...styles.value, color: getMedianTone(m) }}>{m == null ? "—" : `${m.toFixed(2)}x`}</div>
            </div>
          );
        })}
        <div style={styles.cell}>
          <div style={styles.label}>10x %</div>
          <div style={{ ...styles.value, color: getPSColor(pS10) }}>{pS10 == null ? "—" : `${(pS10 * 100).toFixed(2)}%`}</div>
        </div>
      </div>
    </section>
  );
}

function getMedianTone(m: number | null) {
  if (m == null || !Number.isFinite(m)) return "rgba(255,255,255,0.85)";
  if (m < 1.8) return "#ff4d4f";
  if (m < 2.0) return "#f59e0b";
  return "#22c55e";
}

function getPSColor(p: number | null) {
  if (p == null || !Number.isFinite(p)) return "rgba(255,255,255,0.85)";
  if (p >= 0.12) return "#22c55e";
  if (p >= 0.1) return "#f59e0b";
  return "#ff4d4f";
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 10, boxShadow: "0 0 10px rgba(0,0,0,0.35)", marginBottom: 12 },
  row: { display: "grid", gridTemplateColumns: "repeat(7, minmax(82px, 110px))", justifyContent: "space-between", gap: 6 },
  cell: { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 10px", background: "rgba(0,0,0,0.2)", textAlign: "center" },
  label: { fontSize: 11, color: "rgba(255,255,255,0.68)", fontWeight: 700 },
  value: { marginTop: 4, fontSize: 30, lineHeight: 1, fontWeight: 900 },
};
