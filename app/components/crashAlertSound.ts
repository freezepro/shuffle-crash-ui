export type CrashAlertKind = "prediction" | "row20";

export class CrashAlertSound {
  private context: AudioContext | null = null;
  private disposed = false;
  private played = new Set<string>();
  private alert: { key: string; until: number; kind: CrashAlertKind } | null = null;
  muted = false;

  constructor(private makeContext: () => AudioContext, private visible: () => boolean,
    private now: () => number = Date.now) {}

  get ready() { return this.context?.state === "running"; }

  async unlock() {
    if (this.disposed) return;
    try {
      this.context ??= this.makeContext();
      if (this.context.state !== "running") await this.context.resume();
      this.play();
    } catch { /* Browsers may require another explicit gesture. */ }
  }

  update(key: string | null, until: number, muted = this.muted, kind: CrashAlertKind = "prediction") {
    this.alert = key ? { key, until, kind } : null;
    this.muted = muted;
    this.play();
  }

  play() {
    const alert = this.alert;
    const context = this.context;
    if (this.disposed || this.muted || !alert || !context || !this.ready ||
        !this.visible() || this.now() >= alert.until || this.played.has(alert.key)) return;
    this.played.add(alert.key);
    if (this.played.size > 256) this.played.delete(this.played.values().next().value!);
    const row20 = alert.kind === "row20";
    const notes = row20 ? [1047, 1319, 1568] : [740, 988];
    notes.forEach((frequency, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + i * (row20 ? 0.18 : 0.13);
      const duration = row20 ? 0.16 : 0.12;
      oscillator.type = row20 ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.09, start + 0.015);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + duration + 0.01);
    });
  }

  dispose() {
    this.disposed = true;
    this.alert = null;
    void this.context?.close().catch(() => {});
  }
}
