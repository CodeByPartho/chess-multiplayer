#!/usr/bin/env node
/**
 * scripts/gen-sounds.mjs
 *
 * Synthesises the original chess sound set as 16-bit PCM mono WAV files
 * (22050 Hz) into public/sounds/, plus a manifest.json describing them.
 *
 * - Zero dependencies: only node:fs and node:path (plus Math).
 * - Fully deterministic: all noise comes from a seeded mulberry32 PRNG and
 *   nothing embeds timestamps, so re-running the script produces
 *   byte-identical files.
 * - Overwrites existing files on every run.
 *
 * Usage: node scripts/gen-sounds.mjs   (from the repo root)
 */

import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 22050;
const NYQUIST = SAMPLE_RATE / 2;
const TARGET_PEAK = 0.9; // normalise every sound to this peak (no clipping)

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromName(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Envelope / oscillator / filter primitives
// ---------------------------------------------------------------------------

// Exponential decay with short linear attack and a 5 ms release fade
// (the fade prevents clicks at note boundaries).
function envelope(t, dur, attack, tau) {
  if (t < 0 || t > dur) return 0;
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  const d = Math.exp(-Math.max(0, t - attack) / tau);
  const fade = Math.min(1, (dur - t) / 0.005);
  return a * d * fade;
}

// Band-limited waveforms via additive synthesis (avoids aliasing at 22050 Hz).
function waveSample(wave, phase, freq) {
  if (wave === 'sine') return Math.sin(phase);
  if (wave === 'square') {
    let sum = 0;
    for (let k = 1; k * freq < NYQUIST * 0.95; k += 2) {
      sum += Math.sin(k * phase) / k;
    }
    return sum * (4 / Math.PI);
  }
  // triangle (default): odd harmonics, 1/k² rolloff, alternating sign
  let sum = 0;
  for (let k = 1; k * freq < NYQUIST * 0.95; k += 2) {
    sum += ((k & 2) !== 0 ? -1 : 1) * Math.sin(k * phase) / (k * k);
  }
  return sum * (8 / (Math.PI * Math.PI));
}

/**
 * Add a tone to the buffer. Supports an exponential frequency sweep
 * (freq -> freqEnd) and a per-tone exponential envelope.
 */
function addTone(buf, {
  start = 0,
  dur,
  freq,
  freqEnd = null,
  amp,
  wave = 'sine',
  attack = 0.002,
  tau = 0.08,
}) {
  const n = Math.round(dur * SAMPLE_RATE);
  const startIdx = Math.round(start * SAMPLE_RATE);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const idx = startIdx + i;
    if (idx >= buf.length) break;
    const t = i / SAMPLE_RATE;
    const f = freqEnd !== null ? freq * Math.pow(freqEnd / freq, t / dur) : freq;
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    buf[idx] += waveSample(wave, phase, f) * envelope(t, dur, attack, tau) * amp;
  }
}

// RBJ biquad band-pass applied forward (offline, so no phase concerns).
function bandpass(input, centerFreq, q) {
  const w0 = (2 * Math.PI * centerFreq) / SAMPLE_RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/**
 * Add a band-limited noise burst: seeded white noise -> band-pass filter ->
 * unit-peak normalisation -> exponential envelope. Deterministic via `seed`.
 */
function addNoise(buf, {
  start = 0,
  dur,
  amp,
  center,
  q = 1.2,
  attack = 0.001,
  tau = 0.03,
  seed,
}) {
  const n = Math.round(dur * SAMPLE_RATE);
  const startIdx = Math.round(start * SAMPLE_RATE);
  const rand = mulberry32(seed);
  const white = new Float64Array(n);
  for (let i = 0; i < n; i++) white[i] = rand() * 2 - 1;
  const filtered = bandpass(white, center, q);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(filtered[i]);
    if (a > peak) peak = a;
  }
  if (peak === 0) return;
  const norm = 1 / peak;
  for (let i = 0; i < n; i++) {
    const idx = startIdx + i;
    if (idx >= buf.length) break;
    const t = i / SAMPLE_RATE;
    buf[idx] += filtered[i] * norm * envelope(t, dur, attack, tau) * amp;
  }
}

// ---------------------------------------------------------------------------
// Composite pieces
// ---------------------------------------------------------------------------

/**
 * Soft woody click: short band-limited noise burst + low sine thump that
 * sweeps downwards. `scale` pitches the whole click (used for the castle
 * double-click's second, lower strike).
 */
function addClick(buf, { start, seed, scale = 1, noiseAmp = 0.35, thumpAmp = 0.5 }) {
  addNoise(buf, {
    start,
    dur: 0.05,
    amp: noiseAmp,
    center: 2100 * scale,
    q: 1.3,
    attack: 0.0008,
    tau: 0.014,
    seed,
  });
  addTone(buf, {
    start: start + 0.003,
    dur: 0.1,
    freq: 800 * scale,
    freqEnd: 300 * scale,
    amp: thumpAmp,
    wave: 'sine',
    attack: 0.001,
    tau: 0.035,
  });
}

// ---------------------------------------------------------------------------
// Sound set
// ---------------------------------------------------------------------------

const SOUNDS = [
  {
    id: 'move',
    label: 'Move',
    duration: 0.18, // soft woody click
    build(buf, seed) {
      addClick(buf, { start: 0, seed, noiseAmp: 0.35, thumpAmp: 0.55 });
    },
  },
  {
    id: 'capture',
    label: 'Capture',
    duration: 0.24, // deeper, thumpier version with more energy
    build(buf, seed) {
      addNoise(buf, {
        start: 0,
        dur: 0.08,
        amp: 0.5,
        center: 1500,
        q: 1.1,
        attack: 0.001,
        tau: 0.03,
        seed,
      });
      addTone(buf, {
        start: 0.002,
        dur: 0.16,
        freq: 500,
        freqEnd: 180,
        amp: 0.8,
        attack: 0.001,
        tau: 0.06,
      });
    },
  },
  {
    id: 'check',
    label: 'Check',
    duration: 0.2, // two quick rising beeps: 1000 Hz then 1300 Hz
    build(buf, seed) {
      for (const [start, f] of [[0, 1000], [0.095, 1300]]) {
        addTone(buf, { start, dur: 0.075, freq: f, amp: 0.14, wave: 'square', attack: 0.003, tau: 0.05 });
        addTone(buf, { start, dur: 0.075, freq: f, amp: 0.24, wave: 'triangle', attack: 0.003, tau: 0.05 });
      }
      void seed; // check uses no noise
    },
  },
  {
    id: 'castle',
    label: 'Castle',
    duration: 0.24, // double-click, ~90 ms apart, second slightly lower
    build(buf, seed) {
      addClick(buf, { start: 0, seed, noiseAmp: 0.35, thumpAmp: 0.5, scale: 1 });
      addClick(buf, { start: 0.09, seed: seed + 1, noiseAmp: 0.3, thumpAmp: 0.45, scale: 0.87 });
    },
  },
  {
    id: 'start',
    label: 'Game Start',
    duration: 0.45, // rising 3-note chime 523 -> 659 -> 784 Hz
    build(buf, seed) {
      void seed; // chime uses no noise
      const notes = [
        [0.0, 523.25],
        [0.12, 659.26],
        [0.24, 783.99],
      ];
      for (const [start, f] of notes) {
        addTone(buf, { start, dur: 0.21, freq: f, amp: 0.45, wave: 'triangle', attack: 0.006, tau: 0.12 });
      }
    },
  },
  {
    id: 'end-win',
    label: 'Win',
    duration: 0.62, // bright ascending major arpeggio: C5 E5 G5 C6
    build(buf, seed) {
      void seed;
      const notes = [
        [0.0, 523.25],
        [0.11, 659.26],
        [0.22, 783.99],
        [0.33, 1046.5],
      ];
      for (const [start, f] of notes) {
        addTone(buf, { start, dur: 0.28, freq: f, amp: 0.45, wave: 'triangle', attack: 0.004, tau: 0.15 });
      }
    },
  },
  {
    id: 'end-lose',
    label: 'Lose',
    duration: 0.52, // descending minor third, darker timbre
    build(buf, seed) {
      void seed;
      // E4 (329.63) -> C#4 (277.18): a minor third down
      addTone(buf, { start: 0, dur: 0.3, freq: 329.63, amp: 0.55, wave: 'sine', attack: 0.01, tau: 0.13 });
      addTone(buf, { start: 0, dur: 0.3, freq: 329.63, amp: 0.16, wave: 'triangle', attack: 0.01, tau: 0.13 });
      addTone(buf, { start: 0.25, dur: 0.27, freq: 277.18, amp: 0.55, wave: 'sine', attack: 0.012, tau: 0.15 });
      addTone(buf, { start: 0.25, dur: 0.27, freq: 277.18, amp: 0.16, wave: 'triangle', attack: 0.012, tau: 0.15 });
    },
  },
  {
    id: 'end-draw',
    label: 'Draw',
    duration: 0.42, // flat neutral two-note: same pitch twice
    build(buf, seed) {
      void seed;
      for (const start of [0, 0.2]) {
        addTone(buf, { start, dur: 0.2, freq: 440, amp: 0.45, wave: 'sine', attack: 0.006, tau: 0.1 });
        addTone(buf, { start, dur: 0.2, freq: 440, amp: 0.2, wave: 'triangle', attack: 0.006, tau: 0.1 });
      }
    },
  },
  {
    id: 'lowtime',
    label: 'Low Time',
    duration: 0.035, // short sharp high tick, meant to repeat
    build(buf, seed) {
      addNoise(buf, {
        start: 0,
        dur: 0.02,
        amp: 0.7,
        center: 3800,
        q: 1.8,
        attack: 0.0003,
        tau: 0.005,
        seed,
      });
      addTone(buf, { start: 0, dur: 0.012, freq: 3200, amp: 0.4, attack: 0.0005, tau: 0.004 });
    },
  },
  {
    id: 'promote',
    label: 'Promotion',
    duration: 0.4, // rising sparkle: fast ascending arpeggio + noise shimmer
    build(buf, seed) {
      const notes = [523.25, 659.26, 783.99, 1046.5, 1318.51];
      notes.forEach((f, i) => {
        addTone(buf, {
          start: i * 0.045,
          dur: 0.15,
          freq: f,
          amp: 0.4,
          wave: 'triangle',
          attack: 0.003,
          tau: 0.07,
        });
      });
      addNoise(buf, {
        start: 0.02,
        dur: 0.34,
        amp: 0.2,
        center: 6500,
        q: 1.2,
        attack: 0.004,
        tau: 0.12,
        seed,
      });
    },
  },
];

// ---------------------------------------------------------------------------
// WAV encoding
// ---------------------------------------------------------------------------

function normalize(buf, peak = TARGET_PEAK) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > max) max = a;
  }
  if (max > 0) {
    const gain = peak / max;
    for (let i = 0; i < buf.length; i++) buf[i] *= gain;
  }
}

function encodeWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Resolve the repo root from this module's URL (works regardless of cwd).
function moduleDir() {
  let p = decodeURIComponent(new URL('..', import.meta.url).pathname);
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // Windows: "/C:/..." -> "C:/..."
  return p;
}

const ROOT = moduleDir();
const OUT_DIR = path.join(ROOT, 'public', 'sounds');
fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];
for (const sound of SOUNDS) {
  const buf = new Float64Array(Math.round(sound.duration * SAMPLE_RATE));
  sound.build(buf, seedFromName(sound.id));
  normalize(buf);
  const file = `${sound.id}.wav`;
  fs.writeFileSync(path.join(OUT_DIR, file), encodeWav(buf));
  manifest.push({ id: sound.id, file, label: sound.label });
}

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

for (const entry of manifest) {
  const size = fs.statSync(path.join(OUT_DIR, entry.file)).size;
  console.log(`${entry.file.padEnd(14)} ${String(size).padStart(7)} bytes`);
}
console.log(`manifest.json  ${String(fs.statSync(path.join(OUT_DIR, 'manifest.json')).size).padStart(7)} bytes`);
console.log(`Done -> ${OUT_DIR}`);
