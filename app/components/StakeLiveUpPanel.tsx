"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiUrl } from "../lib/apiBase";

const SNAPSHOT_URL = apiUrl("/api/liveup/snapshot");
const EVENTS_URL = apiUrl("/api/stream");
const GREEN_STATE_KEY = "__stakeLiveupGreen";

type Snapshot = {
  success: boolean;
  values: number[];
  pSeries: Array<number | null>;
  greenSegments: Array<{ start: number; end: number }>;
  badges: { green: boolean; green12: boolean; hhhl: boolean; hlhhHot: boolean; gap53or42: boolean };
  stats?: any;
  multiTau?: any[];
  momentum2x?: number;
  gap10Tuple?: string;
  green12Threshold?: number;
  signal10Threshold?: number;
  tau?: number;
  page?: number;
  totalPages?: number;
  startStreak?: number;
  stopStreak?: number;
};

export default function StakeLiveUpPanel({ active = true }: { active?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const inflightRef = useRef(false);
  const throttleRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioEnabledRef = useRef(false);
  const prevBadgesRef = useRef({
    green: false,
    green12: false,
    hhhl: false,
    hlhhHot: false,
    gap53or42: false,
  });

  const fetchSnapshot = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      setIsLoading(true);
      const res = await fetch(`${SNAPSHOT_URL}?limit=1000&page=${page}&_t=${Date.now()}`);
      const data = await res.json();
      if (data?.success) setSnapshot(data);
    } catch (e) {
      console.error("snapshot error", e);
    } finally {
      inflightRef.current = false;
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!active) return;
    fetchSnapshot();
    const t = setInterval(fetchSnapshot, 15000);
    return () => clearInterval(t);
  }, [active, fetchSnapshot]);

  useEffect(() => {
    if (!active || page !== 1) return;
    const es = new EventSource(EVENTS_URL);

    es.addEventListener("new_game", () => {
      const now = Date.now();
      if (now - throttleRef.current < 1200) return;
      throttleRef.current = now;
      fetchSnapshot();
    });

    return () => es.close();
  }, [active, page, fetchSnapshot]);

  useEffect(() => {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!AC) return undefined;
    const enableAudio = () => {
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      if (audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
      audioEnabledRef.current = true;
      window.removeEventListener("pointerdown", enableAudio);
      window.removeEventListener("touchstart", enableAudio);
      window.removeEventListener("keydown", enableAudio);
      window.removeEventListener("click", enableAudio);
    };
    window.addEventListener("pointerdown", enableAudio, { passive: true });
    window.addEventListener("touchstart", enableAudio, { passive: true });
    window.addEventListener("keydown", enableAudio);
    window.addEventListener("click", enableAudio);
    return () => {
      window.removeEventListener("pointerdown", enableAudio);
      window.removeEventListener("touchstart", enableAudio);
      window.removeEventListener("keydown", enableAudio);
      window.removeEventListener("click", enableAudio);
    };
  }, []);

  const playTone = useCallback((freq = 1200, duration = 0.16, volume = 0.22, type: OscillatorType = "sine") => {
    if (!audioCtxRef.current) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as
        | typeof AudioContext
        | undefined;
      if (AC) audioCtxRef.current = new AC();
    }
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    if (!audioEnabledRef.current) audioEnabledRef.current = true;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }, []);

  const playChirp = useCallback((tones: number[] = [900, 1200]) => {
    if (!audioCtxRef.current) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as
        | typeof AudioContext
        | undefined;
      if (AC) audioCtxRef.current = new AC();
    }
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    if (!audioEnabledRef.current) audioEnabledRef.current = true;
    const t0 = ctx.currentTime;
    tones.forEach((f, idx) => {
      const t = t0 + idx * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.14);
    });
  }, []);

  const chartData = useMemo(() => {
    const values = Array.isArray(snapshot?.values) ? snapshot!.values : [];
    const pSeries = Array.isArray(snapshot?.pSeries) ? snapshot!.pSeries : [];
    const p2Window = 50;
    const q2: number[] = [];
    let q2Sum = 0;
    return values.map((v, i) => {
      const multNum = Number(v as unknown);
      const mult = Number.isFinite(multNum) ? multNum : null;
      const h2 = mult != null && mult >= 2 ? 1 : 0;
      q2.push(h2);
      q2Sum += h2;
      if (q2.length > p2Window) q2Sum -= q2.shift() || 0;
      return {
        i,
        mult,
        pS: Number.isFinite(pSeries[i] as number) ? (pSeries[i] as number) * 100 : null,
        p2: q2.length >= p2Window ? (q2Sum / p2Window) * 100 : null,
      };
    });
  }, [snapshot]);

  const badges = useMemo(
    () =>
      snapshot?.badges || {
        green: false,
        green12: false,
        hhhl: false,
        hlhhHot: false,
        gap53or42: false,
      },
    [snapshot?.badges]
  );
  const stats = snapshot?.stats;
  const tau = Number(snapshot?.tau) || 10;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!snapshot?.success || !snapshot?.badges) return;
    (window as any)[GREEN_STATE_KEY] = !!badges.green;
    window.dispatchEvent(
      new CustomEvent("stake-liveup-badges", {
        detail: { green: !!badges.green, green12: !!badges.green12 },
      })
    );
  }, [snapshot?.success, snapshot?.badges, badges.green, badges.green12]);

  useEffect(() => {
    const prev = prevBadgesRef.current;
    const next = {
      green: !!badges.green,
      green12: !!badges.green12,
      hhhl: !!badges.hhhl,
      hlhhHot: !!badges.hlhhHot,
      gap53or42: !!badges.gap53or42,
    };
    if (!prev.green && next.green) playChirp([880, 1100, 1320]);
    if (!prev.gap53or42 && next.gap53or42) playChirp([700, 950]);
    if (!prev.hhhl && next.hhhl) playTone(1020, 0.2, 0.2, "square");
    if (!prev.hlhhHot && next.hlhhHot) playTone(780, 0.2, 0.2, "sawtooth");
    prevBadgesRef.current = next;
  }, [badges, playChirp, playTone]);

  const statText = useMemo(() => {
    if (!stats?.short || !stats?.long) return "";
    const pS = (stats.short.p * 100).toFixed(2);
    const pL = (stats.long.p * 100).toFixed(2);
    const loS = (stats.short.lo * 100).toFixed(2);
    const hiS = (stats.short.hi * 100).toFixed(2);
    return `N=${stats.total} | kS=${stats.kS} pS=${pS}% [${loS}–${hiS}] vs kL=${stats.kL} pL=${pL}% (τ=${tau}×)`;
  }, [stats, tau]);

  return (
    <section style={styles.card}>
      <div style={styles.head}>
        <div style={styles.title}>CrashLiveUp Signals</div>
        <div style={styles.meta}>{isLoading ? "Updating..." : "Live snapshot"}</div>
      </div>

      <div style={styles.pageRow}>
        <button style={styles.pageBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>← Prev</button>
        <span style={styles.pageInfo}>Page {snapshot?.page || page} / {snapshot?.totalPages || 1}</span>
        <button
          style={styles.pageBtn}
          onClick={() => setPage((p) => Math.min(snapshot?.totalPages || 1, p + 1))}
          disabled={page >= (snapshot?.totalPages || 1)}
        >
          Next →
        </button>
      </div>

      <div style={styles.badges}>
        <SignalBadge label="GREEN" on={!!badges.green} />
        <SignalBadge label="GREEN12" on={!!badges.green12} />
        <SignalBadge label="HHHL" on={!!badges.hhhl} />
        <SignalBadge label="HLHH*" on={!!badges.hlhhHot} />
        <SignalBadge label="GAP 5-3/4-2" on={!!badges.gap53or42} />
      </div>

      <div style={styles.chartWrap}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 6, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="i" hide />
            <YAxis yAxisId="mult" orientation="left" stroke="rgba(120,180,255,0.8)" />
            <YAxis yAxisId="ps" orientation="right" stroke="rgba(255,185,80,0.9)" domain={[1, 25]} ticks={[1, 5, 10, 15, 20, 25]} tickFormatter={(v) => `${v}%`} />
            <YAxis yAxisId="p2" orientation="left" stroke="rgba(52,211,153,0.9)" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tickFormatter={(v) => `${v}%`} hide />
            <Tooltip
              contentStyle={styles.tooltip}
              formatter={(value: any, name: string) => {
                if (name === "Multiplier") return [`${Number(value).toFixed(2)}x`, name];
                if (name === "pS %") return [`${Number(value).toFixed(1)}%`, name];
                if (name === "≥2x %") return [`${Number(value).toFixed(1)}%`, name];
                return [Number(value).toFixed(2), name];
              }}
            />
            <Legend />
            {(snapshot?.greenSegments || []).map((seg, idx) => (
              <ReferenceArea key={`${seg.start}-${seg.end}-${idx}`} x1={seg.start} x2={seg.end} yAxisId="mult" stroke="rgba(16,200,120,0.35)" fill="rgba(16,200,120,0.14)" />
            ))}
            <ReferenceLine yAxisId="p2" y={50} stroke="rgba(52,211,153,0.45)" strokeWidth={1} strokeDasharray="3 3" />
            <Line yAxisId="mult" type="monotone" dataKey="mult" name="Multiplier" dot={false} stroke="#55b7ff" strokeWidth={1.1} />
            <Line yAxisId="ps" type="monotone" dataKey="pS" name="pS %" dot={false} stroke="#ffb24d" strokeWidth={1.2} />
            <Line yAxisId="p2" type="monotone" dataKey="p2" name="≥2x %" dot={false} stroke="#34d399" strokeWidth={1.2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={styles.statsLine}>{statText}</div>
    </section>
  );
}

function SignalBadge({ label, on }: { label: string; on: boolean }) {
  return <div style={{ ...styles.badge, ...(on ? styles.badgeOn : styles.badgeOff) }}>{label}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 14, boxShadow: "0 0 10px rgba(0,0,0,0.35)", marginTop: 18, fontFamily: "Arial, sans-serif" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { fontSize: 14, fontWeight: 800 },
  meta: { fontSize: 12, color: "rgba(255,255,255,0.6)" },
  badges: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  pageRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  pageBtn: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "#e5e7eb", borderRadius: 8, padding: "3px 8px", fontSize: 12, cursor: "pointer" },
  pageInfo: { fontSize: 12, color: "rgba(255,255,255,0.68)", minWidth: 72, textAlign: "center" },
  badge: { padding: "5px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: 0.2, fontFamily: "Arial, sans-serif" },
  badgeOn: { background: "rgba(16,160,90,0.28)", border: "1px solid rgba(60,220,140,0.6)", color: "#b8ffd9" },
  badgeOff: { background: "rgba(120,20,36,0.26)", border: "1px solid rgba(210,80,110,0.55)", color: "#ffd1da" },
  chartWrap: { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, background: "rgba(0,0,0,0.18)", padding: 8 },
  statsLine: { marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.72)", wordBreak: "break-word" },
  tooltip: { background: "rgba(10,12,18,0.95)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "white" },
};
