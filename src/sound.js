// Minimal WebAudio synth — no external assets needed.
// Generates short tones for success / fail / fanfare / generic beeps.

let ctx = null;
let masterGain = null;
let enabled = true;

function ensure() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.18;
    masterGain.connect(ctx.destination);
  } catch (e) {
    enabled = false;
  }
  return ctx;
}

function tone(freq = 600, dur = .15, type = 'sine', vol = 1, attack = .005, release = .12) {
  if (!enabled) return;
  ensure(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
  o.connect(g); g.connect(masterGain);
  o.start(t0);
  o.stop(t0 + dur + release + .02);
}

function chord(freqs, dur = .25, type = 'triangle', vol = .9, stagger = .04) {
  freqs.forEach((f, i) => setTimeout(() => tone(f, dur, type, vol), i * stagger * 1000));
}

export const Sound = {
  init() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
  setEnabled(v) { enabled = !!v; },
  beep(freq, dur, type) { tone(freq, dur ?? .12, type ?? 'sine'); },
  success() {
    chord([523, 659, 784, 1046], .18, 'triangle', .9, .05);
  },
  fail() {
    tone(220, .18, 'sawtooth', .6);
    setTimeout(() => tone(160, .26, 'sawtooth', .5), 90);
  },
  fanfare() {
    chord([523, 659, 784], .12, 'square', .7, .06);
    setTimeout(() => chord([659, 784, 988], .14, 'square', .8, .06), 240);
    setTimeout(() => chord([784, 988, 1175], .26, 'square', .9, .06), 480);
  },
};
