"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { frequencyValue, medianPause, medianValue } from "./medianPause";
import { MedianTrend, readMedianTrend, trendDescription } from "./medianTrend";
import CrashPredictionTile from "./CrashPredictionTile";
import predictionStyles from "./CrashPredictionTile.module.css";
import { apiUrl } from "../lib/apiBase";

const URL = apiUrl("/api/medians");
const WINDOWS = [50, 100, 200, 500, 1000];

export default function MediansStrip() {
  const [medians, setMedians] = useState<Array<number | null>>([]);
  const [pS10, setPS10] = useState<number | null>(null);
  const [trend, setTrend] = useState<MedianTrend | null>(null);
  const prevCrossOnRef = useRef(false);
  const pause = medianPause(medians[0], pS10);
  const med50 = medians[0] ?? null;
  const med200 = medians[2] ?? null;
  const medCrossOn = med50 !== null && med200 !== null && med50 > med200;

  useEffect(() => {
    let active = true;
    let inflight = false;
    let controller: AbortController | null = null;
    async function load() {
      if (inflight) return;
      inflight = true;
      const request = new AbortController();
      controller = request;
      const timeout = window.setTimeout(() => request.abort(), 10000);
      try {
        const medRes = await fetch(`${URL}?_t=${Date.now()}`, { cache: "no-store", signal: request.signal });
        if (!medRes.ok) throw new Error(`Medians request failed: ${medRes.status}`);
        const data = await medRes.json();
        if (data?.success !== true) throw new Error("Medians response unavailable");
        if (!active) return;
        const vals = Array.isArray(data?.medians) ? data.medians : [];
        const med = vals.map(medianValue);
        const rate = frequencyValue(data?.pS10);
        setMedians(med);
        setPS10(rate);
        setTrend(readMedianTrend(data?.trend, med[0] ?? null, rate));
      } catch (e) {
        if (!active) return;
        setMedians([]);
        setPS10(null);
        setTrend(null);
        console.error("medians load error", e);
      } finally {
        window.clearTimeout(timeout);
        inflight = false;
      }
    }

    load();
    const t = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(t);
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (medCrossOn && !prevCrossOnRef.current && pause.state === "clear") playSignalTone();
    prevCrossOnRef.current = medCrossOn;
  }, [medCrossOn, pause.state]);

  const mapped = useMemo(() => {
    const out: Record<number, number | null> = {};
    WINDOWS.forEach((w, i) => {
      out[w] = medians[i] ?? null;
    });
    return out;
  }, [medians]);

  return (
    <section
      className={predictionStyles.strip}
      aria-label={pause.description}
      title={pause.description}
      data-testid="medians-strip"
      data-pause-state={pause.state}
      data-recovery-state={trend ? trend.recoveringFromLow ? "recovering" : "none" : "unavailable"}
      style={{ ...styles.wrap, ...(pause.state === "paused" ? styles.wrapPaused : null) }}
    >
      <div className={predictionStyles.row}>
        {WINDOWS.map((w) => {
          const m = mapped[w];
          return (
            <div
              key={w}
              data-testid={`median-${w}`}
              style={{
                ...styles.cell,
                ...(w === 50 && medCrossOn && pause.state === "clear" ? styles.cellCrossOn : null),
                ...(w === 50 && pause.medianLow ? styles.cellPaused : null),
              }}
            >
              <div style={styles.label}>
                <span>Med {w}</span>
                {w === 50 && trend && <TrendMark trend={trend} metric="med50" />}
              </div>
              <div style={{ ...styles.value, color: getMedianTone(m) }}>{m == null ? "—" : `${m.toFixed(2)}x`}</div>
            </div>
          );
        })}
        <CrashPredictionTile />
        <div data-testid="median-tail10" style={{ ...styles.cell, ...(pause.frequencyLow ? styles.cellPaused : null) }}>
          <div style={styles.label}>
            <span>10x %</span>
            {trend && <TrendMark trend={trend} metric="tail10" />}
          </div>
          <div style={{ ...styles.value, color: getPSColor(pS10) }}>{pS10 == null ? "—" : `${(pS10 * 100).toFixed(0)}%`}</div>
        </div>
      </div>
    </section>
  );
}

function TrendMark({ trend, metric }: { trend: MedianTrend; metric: "med50" | "tail10" }) {
  const delta = metric === "med50" ? trend.med50.delta : trend.tail10.deltaPp;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  const amount = metric === "med50" ? Math.abs(delta).toFixed(2) : `${Math.abs(delta)}pp`;
  const description = trendDescription(trend, metric);
  return <span
    role="img"
    aria-label={description}
    title={description}
    data-testid={`trend-${metric}`}
    style={{ ...styles.trend, color: trend.recoveringFromLow ? "#67e8f9" : delta < 0 ? "#fbbf24" : "rgba(255,255,255,0.68)" }}
  >{arrow}{amount}</span>;
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
  wrapPaused: { borderColor: "#ff4d4f", boxShadow: "0 0 0 1px rgba(255,77,79,0.8) inset, 0 0 12px rgba(255,77,79,0.24)" },
  cell: { boxSizing: "border-box", minWidth: 0, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 6px", background: "rgba(0,0,0,0.2)", textAlign: "center" },
  cellPaused: { borderColor: "#ff4d4f", boxShadow: "0 0 0 1px rgba(255,77,79,0.35) inset" },
  cellCrossOn: {
    borderColor: "rgba(34,197,94,0.95)",
    boxShadow: "0 0 0 2px rgba(34,197,94,0.24) inset, 0 0 14px rgba(34,197,94,0.35)",
    borderRadius: 12,
  },
  label: { display: "flex", alignItems: "center", justifyContent: "center", gap: 4, height: 13, whiteSpace: "nowrap", fontSize: 11, color: "rgba(255,255,255,0.68)", fontWeight: 700 },
  trend: { fontSize: 10, lineHeight: "13px", fontVariantNumeric: "tabular-nums" },
  value: { marginTop: 4, fontSize: 30, lineHeight: 1, fontWeight: 900 },
};
