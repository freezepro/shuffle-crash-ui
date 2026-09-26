const assert = require("node:assert/strict");
const test = require("node:test");
const { CrashAlertSound } = require("./loadTs.cjs")("crashAlertSound");

function fixture() {
  let now = 100, visible = true, notes = 0, resolveResume;
  const context = {
    state: "suspended", currentTime: 0, destination: {},
    resume: () => new Promise((resolve) => { resolveResume = () => { context.state = "running"; resolve(); }; }),
    close: async () => { context.state = "closed"; },
    createOscillator: () => ({ frequency: {}, connect() {}, disconnect() {}, start() { notes++; }, stop() {} }),
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
  };
  const sound = new CrashAlertSound(() => context, () => visible, () => now);
  return { sound, context, notes: () => notes, resume: () => resolveResume(),
    time: (v) => { now = v; }, visible: (v) => { visible = v; } };
}

test("two-note chime once per round even if both conditions match", async () => {
  const f = fixture();
  f.sound.update("301", 500);
  assert.equal(f.notes(), 0);
  const unlocking = f.sound.unlock(); f.resume(); await unlocking;
  assert.equal(f.notes(), 2);
  f.sound.update("301", 500); f.sound.play();
  assert.equal(f.notes(), 2);
  f.sound.update("302", 500);
  assert.equal(f.notes(), 4);
});

test("expired, muted, hidden, bootstrap and disconnected readings stay silent", async () => {
  const f = fixture();
  const unlocking = f.sound.unlock(); f.resume(); await unlocking;
  f.sound.update(null, 500);
  f.sound.update("301", 0);
  f.sound.update("302", 500, true);
  f.visible(false); f.sound.update("303", 500, false);
  f.visible(true); f.time(600); f.sound.play();
  assert.equal(f.notes(), 0);
  f.sound.update("304", 1000);
  assert.equal(f.notes(), 2);
  f.sound.update(null, 0);
  f.sound.play(); assert.equal(f.notes(), 2);
});

test("an async audio resume cannot replay a stale or unmounted alert", async () => {
  const f = fixture();
  f.sound.update("301", 500);
  const unlocking = f.sound.unlock();
  f.sound.update(null, 0);
  f.resume(); await unlocking;
  assert.equal(f.notes(), 0);
  f.sound.dispose();
  f.sound.update("302", 1000);
  await f.sound.unlock();
  assert.equal(f.notes(), 0);
});
