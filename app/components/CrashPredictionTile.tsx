"use client";

import { Volume2, VolumeX } from "lucide-react";
import { predictionAlert, predictionColor, rowColor } from "./crashPrediction";
import { useCrashPrediction } from "./useCrashPrediction";
import { useCrashAlertSound } from "./useCrashAlertSound";
import styles from "./CrashPredictionTile.module.css";

export default function CrashPredictionTile() {
  const { estimate, status, alertUntil } = useCrashPrediction();
  const alert = status === "live" && estimate !== null && predictionAlert(estimate);
  const rowAlert = alert && estimate.rowMatches >= 3;
  const rowPulse = rowAlert && alertUntil > Date.now();
  const sound = useCrashAlertSound(alert ? String(estimate.gameIndex) : null, alertUntil, rowAlert ? "row20" : "prediction");
  const soundTitle = `${sound.muted ? "Unmute" : sound.ready ? "Mute" : "Enable"} prediction alerts: three-note 20R >=3 chime; two-note 10x estimate >=13% chime. 20R takes priority. One chime per live round. Keep this tab visible.`;
  const feedTitle = status === "live" ? `Live, after round ${estimate?.gameIndex}. Experimental estimate; no demonstrated predictive edge. Capture and network latency still apply.`
    : `${estimate ? `Showing last known values after round ${estimate.gameIndex}. ` : ""}${status === "syncing" ? "Synchronizing 300 consecutive rounds" : "Connecting to live rounds"}; alerts paused.`;
  const rowTitle = "20-round alignment for the NEXT round: results 20, 40, ... 200 rounds before it. On the latest page with Rows:20, the preview shows 20R through 180R; the tenth counted position, 200R, is the bottom-right grid value. Count >=9x for pattern observation only; a 9x result does not win a 10x bet.";
  return <div className={styles.tile} data-testid="crash-prediction" data-status={status}
    data-round={estimate?.gameIndex ?? ""} title={feedTitle}>
    <span className={`${styles.status} ${status === "live" ? styles.live : ""}`} role="img" aria-label={feedTitle} />
    <button type="button" className={styles.sound} data-crash-sound title={soundTitle} aria-label={soundTitle}
      aria-pressed={!sound.muted && sound.ready} onClick={sound.toggle}>
      {sound.muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
    </button>
    <div key={estimate?.gameIndex ?? "pending"} className={`${styles.reading}${rowPulse ? ` ${styles.rowAlert}` : ""}`}
      data-row20-alert={rowPulse} title={rowTitle}>
      <span className={styles.label}>20R<sup>1</sup></span>
      <strong data-testid="crash-row20" style={{ color: rowColor(estimate?.rowMatches ?? null) }}>
        {estimate ? <>{estimate.rowMatches}<small>/10</small></> : "--"}
      </strong>
    </div>
    <div className={styles.reading} title="Experimental 10x estimate from the last 300 rounds, using the Limbo matching model. Baseline 9.9%; break-even 10%. Color does not mean validated edge.">
      <span className={styles.label}>10x</span>
      <strong data-testid="crash-estimate" style={{ color: predictionColor(estimate?.probability ?? null) }}>
        {estimate ? `${(estimate.probability * 100).toFixed(1)}%` : "--"}
      </strong>
    </div>
  </div>;
}
