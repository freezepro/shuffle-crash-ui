"use client";

import { useEffect, useState } from "react";
import { CrashEstimate, CrashRound, estimateCrash, mergeCrashHistory, readCrashRound } from "./crashPrediction";

import { API_BASE as API } from "../lib/apiBase";
type Reading = { estimate: CrashEstimate | null; status: "connecting" | "syncing" | "live"; alertUntil: number };

export function useCrashPrediction(): Reading {
  const [reading, setReading] = useState<Reading>({ estimate: null, status: "connecting", alertUntil: 0 });
  useEffect(() => {
    let disposed = false;
    let connected = false;
    let history: CrashRound[] | null = null;
    let pending: CrashRound[] = [];
    let highestSeen = -1;
    let request: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastContact = Date.now();
    const source = new EventSource(`${API}/api/stream`);

    function publish(rounds: CrashRound[], liveEvent = false) {
      history = rounds;
      const head = rounds[rounds.length - 1];
      highestSeen = Math.max(highestSeen, head.gameIndex);
      setReading({
        estimate: { ...estimateCrash(rounds.map((round) => round.multiplier)), gameIndex: head.gameIndex },
        status: "live",
        alertUntil: liveEvent ? Math.min(Date.now() + 10000, Date.parse(head.timestamp) + 15000) : 0,
      });
    }

    async function sync() {
      if (disposed || !connected || request) return;
      setReading({ estimate: null, status: "syncing", alertUntil: 0 });
      history = null;
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${API}/api/prediction-history`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("History unavailable");
        const data = await response.json();
        if (disposed || !connected || controller.signal.aborted) return;
        const rounds = data.success === true ? mergeCrashHistory(data.rounds, pending) : null;
        if (!rounds || rounds[rounds.length - 1].gameIndex < highestSeen) throw new Error("Incomplete history");
        publish(rounds);
        pending = [];
      } catch {
        if (!disposed && connected && request === controller) retry = setTimeout(sync, 3000);
      } finally {
        clearTimeout(timeout);
        if (request === controller) request = null;
      }
    }

    const onOpen = () => {
      connected = true;
      lastContact = Date.now();
      clearTimeout(retry);
      void sync();
    };
    const onError = () => {
      connected = false;
      history = null;
      pending = [];
      request?.abort();
      request = null;
      clearTimeout(retry);
      setReading({ estimate: null, status: "connecting", alertUntil: 0 });
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
    }, 5000);
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
