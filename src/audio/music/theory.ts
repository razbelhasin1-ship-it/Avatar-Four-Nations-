import { mulberry32 } from '../dsp';

/**
 * Pure music theory + composition (no WebAudio; unit-tested).
 *
 * A piece is built like a small folk tune:
 *  - a one-bar MOTIF (rhythm cell + constrained melodic walk, gap-filled leaps),
 *  - 4-bar PHRASES developed from it (repetition, sequence, rhythmic variation,
 *    fragmentation) ending in a CADENCE — half (dominant) or authentic (tonic),
 *  - PERIODS (antecedent → consequent) forming sections A / B / A',
 *  - a DYNAMICS arc per phrase (swell toward bar 3, relax at the cadence) and
 *    per section (B is the climax), plus downbeat accents.
 */

export type Rng = () => number;
export const rngFrom = (seed: number): Rng => mulberry32(seed);

export const SCALES: Record<string, readonly number[]> = {
  majorPenta: [0, 2, 4, 7, 9],
  minorPenta: [0, 3, 5, 7, 10],
  /** Suspended pentatonic — open, airy (no thirds). */
  egyptian: [0, 2, 5, 7, 10],
  yo: [0, 2, 5, 7, 9],
  /** Japanese in-sen — tense, proud. */
  insen: [0, 1, 5, 7, 10],
  hirajoshi: [0, 2, 3, 7, 8],
  /** Maqam hijaz flavour — desert. */
  hijaz: [0, 1, 4, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** MIDI note of a scale degree (degree may be negative or span octaves). */
export function degreeMidi(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const d = Math.round(degree);
  const oct = Math.floor(d / n);
  const idx = ((d % n) + n) % n;
  return root + 12 * oct + scale[idx];
}

/** Scale degree index of the fifth (7 semitones) — the "dominant" for half cadences. */
export function dominantDegree(scale: readonly number[]): number {
  const i = scale.indexOf(7);
  if (i >= 0) return i;
  // Closest degree to a fifth.
  let best = 0;
  for (let k = 0; k < scale.length; k++) if (Math.abs(scale[k] - 7) < Math.abs(scale[best] - 7)) best = k;
  return best;
}

export type Ornament = 'bend' | 'grace' | 'trill' | 'slide';

export interface MNote {
  /** Start in beats from the start of the section. */
  at: number;
  /** Length in beats. */
  dur: number;
  /** Scale degree (0 = tonic of the lead register). */
  deg: number;
  /** Velocity 0..1. */
  vel: number;
  orn?: Ornament;
}

export interface StyleSpec {
  /** Rhythm cells; each must sum to beatsPerBar. */
  rhythms: ReadonlyArray<readonly number[]>;
  /** Probability of stepwise motion (vs. leaps). */
  stepBias: number;
  /** Largest leap (degrees). */
  leapMax: number;
  /** Allowed melody degrees [lo, hi]. */
  range: readonly [number, number];
  /** Chance a non-final note becomes a rest. */
  restProb: number;
  /** Chance of an ornament on notes ≥ 1 beat. */
  ornament: number;
  ornaments: readonly Ornament[];
}

const pickR = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
const clampI = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Next degree by a constrained random walk (steps preferred, leaps gap-filled). */
export function nextDegree(rng: Rng, prev: number, prevMove: number, s: StyleSpec, bias = 0): number {
  const [lo, hi] = s.range;
  let move: number;
  if (Math.abs(prevMove) >= 3) {
    // Gap fill: step back against a big leap.
    move = -Math.sign(prevMove);
  } else if (rng() < s.stepBias) {
    move = rng() < 0.12 ? 0 : rng() < 0.5 + bias * 0.4 ? 1 : -1;
  } else {
    const mag = 2 + Math.floor(rng() * Math.max(1, s.leapMax - 1));
    move = (rng() < 0.5 + bias * 0.4 ? 1 : -1) * mag;
  }
  let d = prev + move;
  if (d < lo) d = prev + Math.abs(move || 1);
  if (d > hi) d = prev - Math.abs(move || 1);
  return clampI(d, lo, hi);
}

/** One-bar motif starting at `startDeg`. `contour` biases direction (+1 up, -1 down). */
export function makeMotif(rng: Rng, s: StyleSpec, beatsPerBar: number, startDeg: number, contour = 1): MNote[] {
  const cell = pickR(rng, s.rhythms);
  const notes: MNote[] = [];
  let at = 0;
  let deg = clampI(startDeg, s.range[0], s.range[1]);
  let prevMove = 0;
  for (let i = 0; i < cell.length && at < beatsPerBar - 1e-6; i++) {
    const dur = Math.min(cell[i], beatsPerBar - at);
    if (i > 0) {
      const bias = contour * (i < cell.length / 2 ? 1 : -0.6);
      const nd = nextDegree(rng, deg, prevMove, s, bias);
      prevMove = nd - deg;
      deg = nd;
    }
    const rest = i > 0 && i < cell.length - 1 && rng() < s.restProb;
    if (!rest) notes.push({ at, dur, deg, vel: 0.8 });
    at += dur;
  }
  return notes;
}

/** Shift notes in time (beats) and pitch (degrees). */
export function shift(notes: readonly MNote[], beats: number, degrees = 0, s?: StyleSpec): MNote[] {
  return notes.map((n) => ({ ...n, at: n.at + beats, deg: s ? clampI(n.deg + degrees, s.range[0], s.range[1]) : n.deg + degrees }));
}

/** Rhythmic variation: re-time the motif's pitches with another cell. */
export function rhythmVariation(rng: Rng, motif: readonly MNote[], s: StyleSpec, beatsPerBar: number): MNote[] {
  const cell = pickR(rng, s.rhythms);
  const pitches = motif.map((n) => n.deg);
  const out: MNote[] = [];
  let at = 0;
  for (let i = 0; i < cell.length && at < beatsPerBar - 1e-6; i++) {
    const dur = Math.min(cell[i], beatsPerBar - at);
    out.push({ at, dur, deg: pitches[Math.min(i, pitches.length - 1)] ?? 0, vel: 0.8 });
    at += dur;
  }
  return out;
}

/**
 * Cadence bar: approach `target` stepwise from `from`, ending with a long note
 * (≥ half the bar) on the target degree.
 */
export function cadenceBar(rng: Rng, s: StyleSpec, beatsPerBar: number, from: number, target: number): MNote[] {
  const longDur = beatsPerBar >= 4 ? (rng() < 0.6 ? 2 : 3) : beatsPerBar / 2 + 0.5;
  const lead = beatsPerBar - longDur;
  const notes: MNote[] = [];
  // Approach notes: walk toward target, arriving from a step above or below.
  const nApproach = lead >= 2 ? (rng() < 0.5 ? 2 : 3) : 1;
  const step = lead / nApproach;
  let deg = from;
  for (let i = 0; i < nApproach; i++) {
    const remaining = nApproach - i;
    const dist = target - deg;
    if (remaining === 1) deg = target + (dist >= 0 ? -1 : 1) * (Math.abs(dist) > 0 ? 1 : rng() < 0.5 ? 1 : -1);
    else if (Math.abs(dist) > 1) deg += Math.sign(dist) * Math.min(2, Math.abs(dist) - 1);
    deg = clampI(deg, s.range[0], s.range[1]);
    notes.push({ at: i * step, dur: step, deg, vel: 0.75 });
  }
  notes.push({ at: lead, dur: longDur, deg: target, vel: 0.85 });
  return notes;
}

/**
 * 4-bar phrase: motif → developed repeat (sequence or rhythmic variation) →
 * fragment/extension → cadence on `target` (tonic = authentic, dominant = half).
 */
export function composePhrase(rng: Rng, s: StyleSpec, bpb: number, motif: readonly MNote[], target: number): MNote[] {
  const out: MNote[] = [...shift(motif, 0)];
  // Bar 2: sequence (motif up/down a step) or rhythmic variation.
  const v = rng();
  const bar2 = v < 0.45 ? shift(motif, 0, rng() < 0.6 ? 1 : -1, s) : v < 0.8 ? rhythmVariation(rng, motif, s, bpb) : shift(motif, 0);
  out.push(...shift(bar2, bpb));
  // Bar 3: continuation — fragment of the motif then free walk (highest energy).
  const frag = motif.slice(0, Math.max(1, Math.ceil(motif.length / 2)));
  const bar3: MNote[] = shift(frag, 0, rng() < 0.5 ? 2 : 1, s);
  let at = bar3.length ? bar3[bar3.length - 1].at + bar3[bar3.length - 1].dur : 0;
  let deg = bar3.length ? bar3[bar3.length - 1].deg : motif[0]?.deg ?? 0;
  let prevMove = 0;
  const cell = pickR(rng, s.rhythms);
  let ci = 0;
  while (at < bpb - 1e-6) {
    const dur = Math.min(cell[ci % cell.length], bpb - at);
    const nd = nextDegree(rng, deg, prevMove, s, 0.3);
    prevMove = nd - deg;
    deg = nd;
    bar3.push({ at, dur, deg, vel: 0.85 });
    at += dur;
    ci++;
  }
  out.push(...shift(bar3, bpb * 2));
  // Bar 4: cadence.
  out.push(...shift(cadenceBar(rng, s, bpb, deg, target), bpb * 3));
  return out;
}

/** Apply ornaments to longer notes. */
export function ornament(rng: Rng, notes: MNote[], s: StyleSpec): MNote[] {
  if (!s.ornaments.length) return notes;
  return notes.map((n) => (n.dur >= 1 && rng() < s.ornament ? { ...n, orn: pickR(rng, s.ornaments) } : n));
}

/** Dynamic shaping: phrase arc + downbeat accents + humanised velocity. */
export function shapeDynamics(rng: Rng, notes: MNote[], bpb: number, base: number): MNote[] {
  const phraseBeats = bpb * 4;
  return notes.map((n) => {
    const pos = (n.at % phraseBeats) / phraseBeats; // 0..1 within the phrase
    const arc = 0.82 + 0.28 * Math.sin(Math.PI * Math.min(1, pos * 1.25));
    const accent = Math.abs(n.at % bpb) < 1e-6 ? 1.08 : 0.94;
    const v = base * arc * accent * (0.92 + rng() * 0.12) * (n.vel / 0.8);
    return { ...n, vel: Math.max(0.05, Math.min(1, v)) };
  });
}

export interface Section {
  name: string;
  bars: number;
  notes: MNote[];
  /** Harmony root per bar, semitones above the theme root. */
  harmony: number[];
  /** Base dynamic level 0..1. */
  dyn: number;
}

export interface Piece {
  sections: Section[];
  totalBars: number;
  /** Section index for each bar. */
  barSection: number[];
}

export interface CompositionSpec {
  scale: readonly number[];
  beatsPerBar: number;
  style: StyleSpec;
  /** e.g. ['A', 'B', 'A'] (A' variants are produced automatically on repeats). */
  form: readonly string[];
  /** Harmony roots (semitones) per bar for each phrase type. */
  harmony: { A: readonly number[]; A2: readonly number[]; B: readonly number[]; B2: readonly number[] };
  /** Optional leitmotif (degrees) used as the A motif when present. */
  signature?: readonly number[];
  /** Section dynamics, e.g. { A: 0.62, B: 0.8 }. */
  dyn?: Record<string, number>;
}

/** Build a motif from a fixed degree list (leitmotif) using a rhythm cell. */
export function motifFromDegrees(rng: Rng, s: StyleSpec, bpb: number, degs: readonly number[]): MNote[] {
  const cells = s.rhythms.filter((c) => c.length === degs.length);
  const cell = cells.length ? pickR(rng, cells) : null;
  const out: MNote[] = [];
  let at = 0;
  for (let i = 0; i < degs.length; i++) {
    const dur = cell ? cell[i] : bpb / degs.length;
    out.push({ at, dur, deg: degs[i], vel: 0.8 });
    at += dur;
  }
  return out;
}

/** Compose a whole piece (period-form sections with cadences and dynamics). */
export function composePiece(rng: Rng, c: CompositionSpec): Piece {
  const s = c.style;
  const bpb = c.beatsPerBar;
  const dom = dominantDegree(c.scale);
  const n = c.scale.length;
  const startDegs = [0, 2 % n, dom];
  const motifA = c.signature && rng() < 0.7 ? motifFromDegrees(rng, s, bpb, c.signature) : makeMotif(rng, s, bpb, pickR(rng, startDegs), rng() < 0.6 ? 1 : -1);
  const motifB = makeMotif(rng, s, bpb, clampI(dom + (rng() < 0.5 ? 1 : 2), s.range[0], s.range[1]), -1);
  const sections: Section[] = [];
  const seen = new Map<string, number>();
  for (const name of c.form) {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    let notes: MNote[];
    let harmony: number[];
    if (name === 'B') {
      const p1 = composePhrase(rng, s, bpb, motifB, dom);
      const p2 = composePhrase(rng, s, bpb, shift(motifB, 0, rng() < 0.5 ? -1 : 1, s), dom);
      notes = [...p1, ...shift(p2, bpb * 4)];
      harmony = [...c.harmony.B, ...c.harmony.B2];
    } else {
      // Period: antecedent (half cadence) → consequent (same opening, authentic cadence).
      const ante = composePhrase(rng, s, bpb, motifA, dom);
      const opening = ante.filter((x) => x.at < bpb * 2);
      const cons = composePhrase(rng, s, bpb, motifA, 0).filter((x) => x.at >= bpb * 2);
      notes = [...ante, ...shift([...opening, ...cons], bpb * 4)];
      harmony = [...c.harmony.A, ...c.harmony.A2];
      if (count > 0) notes = ornament(rng, notes, { ...s, ornament: Math.min(0.8, s.ornament * 2 + 0.15) });
    }
    notes = ornament(rng, notes, s);
    const dyn = c.dyn?.[name] ?? (name === 'B' ? 0.82 : count > 0 ? 0.72 : 0.64);
    notes = shapeDynamics(rng, notes, bpb, dyn);
    sections.push({ name: count > 0 ? `${name}'` : name, bars: 8, notes, harmony, dyn });
  }
  const barSection: number[] = [];
  sections.forEach((sec, i) => {
    for (let b = 0; b < sec.bars; b++) barSection.push(i);
  });
  return { sections, totalBars: barSection.length, barSection };
}
