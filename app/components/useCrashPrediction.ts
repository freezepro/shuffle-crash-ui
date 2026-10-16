"use client";

import { openCrashStream } from "../lib/crashEvents";
import { readLastKnown, saveLastKnown } from "../lib/lastKnown";

import { useEffect, useState } from "react";
import { CrashEstimate, CrashRound, estimateCrash, mergeCrashHistory, readCrashRound } from "./crashPrediction";

import { API_BASE as API } from "../lib/apiBase";
type Reading = { estimate: CrashEstimate | null; status: "connecting" | "syncing" | "live"; alertUntil: number };

function readEstimate(raw: unknown): CrashEstimate | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as CrashEstimate;
  return Number.isSafeInteger(value.gameIndex) && value.gameIndex >= 0
    && Number.isSafeInteger(value.rowMatches) && value.rowMatches >= 0 && value.rowMatches <= 10
    && typeof value.probability === "number" && Number.isFinite(value.probability)
    && value.probability >= 0 && value.probability <= 1
    ? { gameIndex: value.gameIndex, rowMatches: value.rowMatches, probability: value.probability } : null;
}

export function useCrashPrediction(): Reading {
  const [reading, setReading] = useState<Reading>({ estimate: null, status: "connecting", alertUntil: 0 });
  useEffect(() => {
    let disposed = false;
    let connected = false;
    let lastEstimate = readLastKnown("prediction", readEstimate);
    if (lastEstimate) setReading({ estimate: lastEstimate, status: "connecting", alertUntil: 0 });
    let history: CrashRound[] | null = null;
    let pending: CrashRound[] = [];
    let highestSeen = -1;
    let request: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastContact = Date.now();
    let lastAttempt = -Infinity;
    const source = openCrashStream({ afterPaint: true });

    function publish(rounds: CrashRound[], liveEvent = false) {
      history = rounds;
      const head = rounds[rounds.length - 1];
      highestSeen = Math.max(highestSeen, head.gameIndex);
      lastEstimate = { ...estimateCrash(rounds.map((round) => round.multiplier)), gameIndex: head.gameIndex };
      saveLastKnown("prediction", lastEstimate);
      setReading({
        estimate: lastEstimate,
        status: connected ? "live" : "connecting",
        alertUntil: liveEvent && connected ? Math.min(Date.now() + 10000, Date.parse(head.timestamp) + 15000) : 0,
      });
    }

    async function sync() {
      if (disposed || request) return;
      clearTimeout(retry);
      setReading({ estimate: lastEstimate, status: connected ? "syncing" : "connecting", alertUntil: 0 });
      history = null;
      const controller = new AbortController();
      request = controller;
      lastAttempt = Date.now();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${API}/api/prediction-history`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("History unavailable");
        const data = await response.json();
        if (disposed || request !== controller || controller.signal.aborted) return;
        const rounds = data.success === true ? mergeCrashHistory(data.rounds, pending) : null;
        if (!rounds || rounds[rounds.length - 1].gameIndex < highestSeen) throw new Error("Incomplete history");
        publish(rounds);
        pending = [];
      } catch {
        if (!disposed && request === controller) retry = setTimeout(sync, 3000);
      } finally {
        clearTimeout(timeout);
        if (request === controller) request = null;
      }
    }

    const onOpen = () => {
      connected = true;
      lastContact = Date.now();
      clearTimeout(retry);
      setReading({ estimate: lastEstimate, status: "syncing", alertUntil: 0 });
      void sync();
    };
    const onError = () => {
      connected = false;
      history = null;
      pending = [];
      clearTimeout(retry);
      setReading({ estimate: lastEstimate, status: "connecting", alertUntil: 0 });
      // HTTP snapshots can still recover while the live stream is disconnected.
      void sync();
    };
    const onPing = () => {
      lastContact = Date.now();
      if (!connected && source.readyState === EventSource.OPEN) onOpen();
    };
    const onRound = (event: Event) => {
      lastContact = Date.now();
      let round: CrashRound | null = null;
      try { round = readCrashRound(JSON.parse((event as MessageEvent).data)); } catch { /* resync below */ }
      if (!round) {
        history = null;
        void sync();
        return;
      }
      highestSeen = Math.max(highestSeen, round.gameIndex);
      if (!history) {
        pending = [...pending, round].slice(-600);
        return;
      }
      const head = history[history.length - 1];
      if (round.gameIndex <= head.gameIndex) {
        const previous = history.find((item) => item.gameIndex === round!.gameIndex);
        if (previous && previous.multiplier !== round.multiplier) void sync();
        return;
      }
      if (round.gameIndex !== head.gameIndex + 1) {
        pending = [round];
        void sync();
        return;
      }
      publish([...history.slice(1), round], true);
    };
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    source.addEventListener("ping", onPing);
    source.addEventListener("new_game", onRound);
    const health = setInterval(() => {
      if (connected && Date.now() - lastContact > 45000) onError();
      if (!connected && Date.now() - lastAttempt >= 5000) void sync();
    }, 5000);
    // Bootstrap from stored server history, without waiting for SSE or another round.
    void sync();
    return () => {
      disposed = true;
      source.close();
      request?.abort();
      clearTimeout(retry);
      clearInterval(health);
    };
  }, []);
  return reading;
}
