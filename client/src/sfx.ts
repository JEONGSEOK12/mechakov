/**
 * Sound effects made on the fly with Web Audio, so the game ships no audio
 * files. The context starts on the first click or key press (browsers block
 * sound before that). N toggles mute, remembered in this browser.
 */

const MUTE_KEY = 'mechakov:muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let ambient: { stop(): void } | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  // No storage: start unmuted.
}

function audio(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio(), { capture: true });

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Ignore: see above.
  }
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
  return muted;
}

interface ToneOpts {
  type?: OscillatorType;
  /** Frequency at the end, for a sweep. */
  to?: number;
  delay?: number;
  volume?: number;
}

function tone(freq: number, dur: number, { type = 'sine', to, delay = 0, volume = 0.3 }: ToneOpts = {}) {
  const ac = audio();
  if (!ac || !master) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

interface NoiseOpts {
  filter?: BiquadFilterType;
  freq?: number;
  /** Filter frequency at the end, for a sweep. */
  to?: number;
  q?: number;
  delay?: number;
  volume?: number;
}

function noise(dur: number, { filter = 'lowpass', freq = 1000, to, q = 1, delay = 0, volume = 0.3 }: NoiseOpts = {}) {
  const ac = audio();
  if (!ac || !master || !noiseBuf) return;
  const t = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ac.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  f.Q.value = q;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(gain).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

/** Volume for something `dist` meters away. */
const falloff = (dist: number) => Math.max(0, 1 - dist / 40) ** 2;

export const sfx = {
  footstep(sprint: boolean) {
    noise(0.09, { freq: sprint ? 700 : 500, volume: sprint ? 0.22 : 0.14 });
    tone(sprint ? 90 : 75, 0.07, { type: 'sine', volume: 0.12 });
  },
  land() {
    noise(0.15, { freq: 400, volume: 0.3 });
    tone(70, 0.12, { volume: 0.2 });
  },
  jump() {
    noise(0.12, { filter: 'bandpass', freq: 600, to: 1200, volume: 0.08 });
  },
  pickup() {
    tone(660, 0.08, { type: 'triangle', volume: 0.25 });
    tone(990, 0.12, { type: 'triangle', delay: 0.07, volume: 0.25 });
  },
  drop() {
    tone(700, 0.08, { type: 'triangle', volume: 0.2 });
    tone(420, 0.12, { type: 'triangle', delay: 0.06, volume: 0.2 });
  },
  bagFull() {
    tone(220, 0.15, { type: 'square', volume: 0.08 });
  },
  disguise() {
    noise(0.35, { filter: 'bandpass', freq: 3000, to: 300, q: 2, volume: 0.35 });
    tone(500, 0.25, { type: 'sine', to: 160, volume: 0.15 });
  },
  shot(dist: number) {
    const v = falloff(dist);
    if (v <= 0.01) return;
    noise(0.25, { freq: 2500, to: 300, volume: 0.6 * v });
    tone(120, 0.18, { type: 'square', to: 50, volume: 0.25 * v });
  },
  rocketFire() {
    noise(0.45, { filter: 'bandpass', freq: 900, to: 300, q: 0.8, volume: 0.35 });
    tone(220, 0.25, { type: 'sawtooth', to: 90, volume: 0.12 });
  },
  grenadeFire() {
    tone(140, 0.12, { type: 'square', to: 60, volume: 0.25 });
    noise(0.18, { filter: 'bandpass', freq: 500, q: 1.2, volume: 0.3 });
  },
  charge() {
    noise(0.5, { filter: 'bandpass', freq: 400, to: 1600, q: 1, volume: 0.3 });
    tone(110, 0.4, { type: 'sawtooth', to: 220, volume: 0.12 });
  },
  bash(dist: number) {
    const v = falloff(dist);
    if (v <= 0.01) return;
    noise(0.2, { freq: 900, to: 150, volume: 0.6 * v });
    tone(90, 0.2, { type: 'square', to: 45, volume: 0.3 * v });
  },
  explosion(dist: number) {
    const v = Math.max(0, 1 - dist / 60) ** 1.5;
    if (v <= 0.01) return;
    noise(0.9, { freq: 1800, to: 120, volume: 0.8 * v });
    noise(0.25, { filter: 'highpass', freq: 1500, volume: 0.25 * v });
    tone(70, 0.6, { type: 'sine', to: 32, volume: 0.45 * v });
  },
  hitConfirm() {
    tone(1400, 0.05, { type: 'square', volume: 0.12 });
    tone(1900, 0.06, { type: 'square', delay: 0.04, volume: 0.1 });
  },
  hurt() {
    tone(160, 0.25, { type: 'sawtooth', to: 70, volume: 0.25 });
    noise(0.2, { freq: 300, volume: 0.3 });
  },
  kill() {
    tone(880, 0.1, { type: 'triangle', volume: 0.2 });
    tone(1320, 0.25, { type: 'triangle', delay: 0.09, volume: 0.2 });
  },
  winded() {
    noise(0.5, { filter: 'bandpass', freq: 900, q: 0.8, volume: 0.18 });
    noise(0.6, { filter: 'bandpass', freq: 700, q: 0.8, delay: 0.6, volume: 0.14 });
  },
  extractTick(step: number) {
    tone(440 + step * 110, 0.08, { type: 'triangle', volume: 0.18 });
  },
  extracted() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', delay: i * 0.09, volume: 0.22 }));
  },
  failed() {
    [392, 311, 233].forEach((f, i) => tone(f, 0.35, { type: 'sawtooth', delay: i * 0.18, volume: 0.12 }));
  },
  countdown(last: boolean) {
    tone(last ? 880 : 520, last ? 0.4 : 0.12, { type: 'square', volume: 0.1 });
  },
  huntStart() {
    tone(110, 0.9, { type: 'sawtooth', to: 220, volume: 0.15 });
    tone(165, 0.9, { type: 'sawtooth', to: 330, volume: 0.1 });
  },
  raidStart() {
    noise(0.8, { filter: 'bandpass', freq: 200, to: 2000, q: 0.7, volume: 0.25 });
  },
  upgrade() {
    [784, 988, 1175].forEach((f, i) => tone(f, 0.18, { type: 'sine', delay: i * 0.06, volume: 0.2 }));
  },
  open() {
    noise(0.08, { filter: 'highpass', freq: 2000, volume: 0.12 });
    tone(300, 0.08, { type: 'triangle', volume: 0.1 });
  },

  /** A quiet bed of sound for the map: wind outdoors, a low hum inside. */
  ambience(outdoor: boolean) {
    ambient?.stop();
    ambient = null;
    const ac = audio();
    if (!ac || !master || !noiseBuf) return;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = outdoor ? 'bandpass' : 'lowpass';
    f.frequency.value = outdoor ? 500 : 140;
    f.Q.value = outdoor ? 0.4 : 1;
    const gain = ac.createGain();
    gain.gain.value = outdoor ? 0.05 : 0.07;
    src.connect(f).connect(gain).connect(master);
    src.start();
    // Slow swell, like gusts or a ventilation cycle.
    const lfo = ac.createOscillator();
    const depth = ac.createGain();
    lfo.frequency.value = outdoor ? 0.12 : 0.07;
    depth.gain.value = outdoor ? 0.03 : 0.02;
    lfo.connect(depth).connect(gain.gain);
    lfo.start();
    ambient = {
      stop() {
        src.stop();
        lfo.stop();
      },
    };
  },
};
