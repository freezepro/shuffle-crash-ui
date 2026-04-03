"use client";

import LastSeenBlock from "./LastSeenBlock";
import CrashDashboard from "./CrashDashboard";
import StakeCrashHistory from "./StakeCrashHistory";
import MediansStrip from "./MediansStrip";
import StakeLiveUpPanel from "./StakeLiveUpPanel";

export default function StakeViewTabs() {
  return (
    <div>
      <div style={wrap(1120)}>
        <MediansStrip />
      </div>

      {/* HISTORY WRAPPER (700) */}
      <section>
        <div style={wrap(910)}>
          <StakeCrashHistory />
        </div>
      </section>

      {/* DASHBOARD WRAPPER (1200) */}
      <section>
        <div style={wrap(1200)}>
          <LastSeenBlock />
          <CrashDashboard />
          <StakeLiveUpPanel />
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
    padding: "0 16px", // щоб на вузьких екранах не прилипало
  } as const;
}
