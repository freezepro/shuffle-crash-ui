"use client";

import LastSeenBlockRoobet from "./LastSeenBlockRoobet";
import CrashDashboardRoobet from "./CrashDashboardRoobet";
import RoobetCrashHistory from "./RoobetCrashHistory";

export default function RoobetViewTabs() {
  return (
    <div>
      {/* HISTORY FIRST */}
      <section>
        <div style={wrap(910)}>
          <RoobetCrashHistory />
        </div>
      </section>

      {/* DASHBOARD SECOND */}
      <section style={{ marginTop: 18 }}>
        <div style={wrap(1200)}>
          <LastSeenBlockRoobet />
          <CrashDashboardRoobet />
        </div>
      </section>
    </div>
  );
}

function wrap(maxWidth: number) {
  return {
    maxWidth,
    width: "100%",
    margin: "0 auto 20px auto",
    padding: "0 16px",
  } as const;
}
