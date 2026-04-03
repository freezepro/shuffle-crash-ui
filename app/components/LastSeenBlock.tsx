"use client";

import React, { useEffect, useState } from "react";
import { apiUrl } from "../lib/apiBase";

export default function LastSeenBlock() {
  const [lastSeen, setLastSeen] = useState<Record<string, number | null> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const [lastSeenRes, medRes] = await Promise.all([
          fetch(apiUrl("/api/last-seen"), { cache: "no-store" }),
          fetch(apiUrl("/api/medians"), { cache: "no-store" }),
        ]);

        const lastSeenJson = await lastSeenRes.json();
        const medJson = await medRes.json();
        if (!alive) return;

        const normalized: Record<string, number | null> = {
          "10x": toNum(lastSeenJson?.["10x"]),
          "20x": toNum(lastSeenJson?.["20x"]),
          "50x": toNum(lastSeenJson?.["50x"]),
          "100x": toNum(lastSeenJson?.["100x"]),
          "500x": toNum(lastSeenJson?.["500x"]),
          "1000x": toNum(lastSeenJson?.["1000x"]),
          "10000x": toNum(lastSeenJson?.["10000x"]),
          "100000x": toNum(lastSeenJson?.["100000x"]),
          "1000000x": toNum(lastSeenJson?.["1000000x"]),
        };

        const ps = Number(medJson?.pS10);
        normalized["10x%"] = Number.isFinite(ps) ? Number((ps * 100).toFixed(2)) : null;

        setLastSeen(normalized);
        setUpdatedAt(new Date().toLocaleTimeString());
      } catch (e) {
        console.error("last-seen load error", e);
      }
    }

    load();
    const interval = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  if (!lastSeen) return <div style={{ color: "white" }}>Loading...</div>;

  const entries = [
    { label: "10x", key: "10x" },
    { label: "20x", key: "20x" },
    { label: "50x", key: "50x" },
    { label: "100x", key: "100x" },
    { label: "500x", key: "500x" },
    { label: "1kx", key: "1000x" },
    { label: "10kx", key: "10000x" },
    { label: "100kx", key: "100000x" },
    { label: "1Mx", key: "1000000x" },
    { label: "10x %", key: "10x%" },
  ];

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        <div style={styles.title}>⏱ Last Seen Multipliers</div>
        <div style={styles.meta}>{updatedAt ? `Updated: ${updatedAt}` : ""}</div>
      </div>

      <div style={styles.grid}>
        {entries.map((entry) => {
          const val = lastSeen[entry.key];
          const isPercent = entry.key === "10x%";
          return (
            <div key={entry.key} style={styles.card}>
              <div style={styles.label}>≥ {entry.label}</div>
              <div style={{ ...styles.value, ...(isPercent ? { color: getPSColor(Number(val) / 100) } : null) }}>
                {val === null || val === undefined ? "—" : isPercent ? `${val}%` : val}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getPSColor(p: number) {
  if (!Number.isFinite(p)) return "#e5e7eb";
  if (p >= 0.12) return "#22c55e";
  if (p >= 0.1) return "#f59e0b";
  return "#ff4d4f";
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    background: "rgba(255,255,255,0.03)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    padding: 14,
    marginBottom: 16,
  },
  head: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 10,
  },
  title: { fontSize: 14, fontWeight: 800 },
  meta: { fontSize: 12, color: "rgba(255,255,255,0.55)" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 8,
  },
  card: {
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    minHeight: 56,
    padding: 8,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  label: { fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 3 },
  value: { fontSize: 18, fontWeight: 800, color: "#22c55e" },
};
