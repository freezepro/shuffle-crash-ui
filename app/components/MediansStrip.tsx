"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../lib/apiBase";

const WINDOWS = [50, 100, 200, 500, 1000, 3000];

export default function MediansStrip() {
  const [medians, setMedians] = useState<number[]>([]);
  const [pS10, setPS10] = useState<number | null>(null);
  const [medCrossOn, setMedCrossOn] = useState(false);
  const inflightRef = useRef(false);
  const prevCrossOnRef = useRef(false);

  useEffect(() => {
    async function load() {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const res = await fetch(`${apiUrl("/api/medians")}?_t=${Date.now()}`, { cache: "no-store" });
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

  useEffect(() => {
    const med50 = Number(medians[0]);
    const med200 = Number(medians[2]);
    const on = Number.isFinite(med50) && Number.isFinite(med200) && med50 > med200;
    setMedCrossOn(on);
    if (on && !prevCrossOnRef.current) playSignalTone();
    prevCrossOnRef.current = on;
  }, [medians]);

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
            <div
              key={w}
              style={{
                ...styles.cell,
                ...(w === 50 && medCrossOn ? styles.cellCrossOn : null),
              }}
            >
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

function playSignalTone() {
  if (typeof window === "undefined") return;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 880;
    gain.gain.value = 0.001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.start(now);
    osc.stop(now + 0.17);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    // audio can be blocked before first user interaction
  }
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
  cellCrossOn: {
    border: "2px solid rgba(34,197,94,0.95)",
    boxShadow: "0 0 0 2px rgba(34,197,94,0.24) inset, 0 0 14px rgba(34,197,94,0.35)",
    borderRadius: 12,
  },
  label: { fontSize: 11, color: "rgba(255,255,255,0.68)", fontWeight: 700 },
  value: { marginTop: 4, fontSize: 30, lineHeight: 1, fontWeight: 900 },
};
