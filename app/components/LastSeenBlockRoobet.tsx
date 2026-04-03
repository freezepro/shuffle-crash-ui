"use client";

import React, { useEffect, useState } from "react";
import { apiUrl } from "../lib/apiBase";

export default function LastSeenBlock() {
  const [lastSeen, setLastSeen] = useState<any>(null);

  useEffect(() => {
      async function load() {
          const res = await fetch(apiUrl("/api/roobet/last-seen"), {
              cache: "no-store",
          });
      const json = await res.json();
      setLastSeen(json);
    }

    load();

    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!lastSeen) return <div style={{ color: "white" }}>Loading...</div>;

  const entries = [
    { label: "10x", apiKey: "10x" },
    { label: "20x", apiKey: "20x" },
    { label: "50x", apiKey: "50x" },
    { label: "100x", apiKey: "100x" },
    { label: "500x", apiKey: "500x" },
    { label: "1000x", apiKey: "1000x" },
    { label: "10000x", apiKey: "10000x" },
    { label: "100000x", apiKey: "100000x" },
    { label: "1000000x", apiKey: "1000000x" },
  ];

  return (
    <div
      style={{
        background: "#020617",
        borderRadius: 14,
        border: "1px solid #1f2937",
        padding: 16,
        marginBottom: 20,
        maxWidth: 1360,
        margin: "0 auto",
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 15 }}>
        ⏱ Last Seen Multipliers
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        {entries.map(({ label, apiKey }) => (
          <div
            key={label}
            style={{
              background: "#030712",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #111827",
            }}
          >
            <div style={{ fontSize: 13, color: "#9ca3af" }}>≥ {label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#22c55e" }}>
              {lastSeen?.[apiKey] ?? 0}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>games</div>
          </div>
        ))}
      </div>
    </div>
  );
}
