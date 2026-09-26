"use client";

import { useEffect, useRef, useState } from "react";
import { CrashAlertSound } from "./crashAlertSound";

const STORAGE_KEY = "shuffle_prediction_sound_muted";

export function useCrashAlertSound(key: string | null, until: number) {
  const engine = useRef<CrashAlertSound | null>(null);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    const sound = new CrashAlertSound(() => {
      const Context = window.AudioContext || (window as any).webkitAudioContext;
      if (!Context) throw new Error("Audio unavailable");
      return new Context();
    }, () => !document.hidden);
    try { sound.muted = localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* Storage is optional. */ }
    setMuted(sound.muted);
    engine.current = sound;
    const unlock = async (event: Event) => {
      if ((event.target as Element)?.closest?.("[data-crash-sound]") || sound.muted) return;
      await sound.unlock();
      if (!disposed) setReady(sound.ready);
    };
    const visibility = () => sound.play();
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", visibility);
      sound.dispose();
      engine.current = null;
    };
  }, []);
  useEffect(() => { engine.current?.update(key, until); }, [key, until]);

  async function toggle() {
    const sound = engine.current;
    if (!sound) return;
    const nextMuted = !sound.muted && sound.ready;
    sound.update(key, until, nextMuted);
    setMuted(nextMuted);
    try { localStorage.setItem(STORAGE_KEY, nextMuted ? "1" : "0"); } catch { /* Storage is optional. */ }
    if (!nextMuted) await sound.unlock();
    if (engine.current === sound) setReady(sound.ready);
  }
  return { muted, ready, toggle };
}
