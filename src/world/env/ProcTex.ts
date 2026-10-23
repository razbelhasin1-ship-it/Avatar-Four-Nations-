/**
 * Tileable procedural noise for texture synthesis (pure, no three.js).
 *
 * All functions take texture coordinates u, v in [0, 1) and are periodic with
 * period 1, so generated images tile seamlessly. `freq` / `cells` is the number
 * of lattice cells across one tile (integer, ≤ 1024).
 */

export function hash2i(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i: number, p: number) => ((i % p) + p) % p;

// 16 gradient directions (no trig in the inner loop).
const GX = new Float32Array(16);
const GY = new Float32Array(16);
for (let i = 0; i < 16; i++) {
  GX[i] = Math.cos((i / 16) * Math.PI * 2 + 0.1);
  GY[i] = Math.sin((i / 16) * Math.PI * 2 + 0.1);
}

/** Periodic gradient (Perlin) noise in ~[-1, 1]. */
export function pnoise(u: number, v: number, freq: number, seed: number): number {
  const x = u * freq, y = v * freq;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = wrap(xi, freq), x1 = wrap(xi + 1, freq);
  const y0 = wrap(yi, freq), y1 = wrap(yi + 1, freq);
  const g00 = (hash2i(x0, y0, seed) * 16) | 0;
  const g10 = (hash2i(x1, y0, seed) * 16) | 0;
  const g01 = (hash2i(x0, y1, seed) * 16) | 0;
  const g11 = (hash2i(x1, y1, seed) * 16) | 0;
  const n00 = GX[g00] * xf + GY[g00] * yf;
  const n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
  const n01 = GX[g01] * xf + GY[g01] * (yf - 1);
  const n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
  const u2 = fade(xf), v2 = fade(yf);
  const nx0 = n00 + (n10 - n00) * u2;
  const nx1 = n01 + (n11 - n01) * u2;
  return 1.41 * (nx0 + (nx1 - nx0) * v2);
}

/** Periodic fBm in ~[-1, 1]. */
export function pfbm(u: number, v: number, freq: number, octaves: number, seed: number, gain = 0.5): number {
  let amp = 1, sum = 0, norm = 0, f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(u, v, f, seed + o * 101);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Periodic ridged noise in [0, 1]. */
export function pridged(u: number, v: number, freq: number, octaves: number, seed: number): number {
  let amp = 0.5, sum = 0, norm = 0, f = freq, w = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(pnoise(u, v, f, seed + o * 37));
    n *= n * w;
    w = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export interface WorleyResult {
  f1: number;
  f2: number;
  /** Random value 0..1 identifying the nearest cell. */
  id: number;
  /** Offset from the nearest feature point (cell units). */
  dx: number;
  dy: number;
}

const featureCache = new Map<string, Float32Array>();
function features(cells: number, seed: number, jitter: number): Float32Array {
  const key = cells + ':' + seed + ':' + jitter;
  let f = featureCache.get(key);
  if (!f) {
    f = new Float32Array(cells * cells * 3);
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const i = (y * cells + x) * 3;
        f[i] = 0.5 + (hash2i(x, y, seed) - 0.5) * jitter;
        f[i + 1] = 0.5 + (hash2i(x, y, seed + 17) - 0.5) * jitter;
        f[i + 2] = hash2i(x, y, seed + 31);
      }
    }
    featureCache.set(key, f);
  }
  return f;
}

/** Periodic Worley / cellular noise. Distances are in cell units. `jitter` 0..1. */
export function worley(u: number, v: number, cells: number, seed: number, jitter = 0.9, out: WorleyResult = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 }): WorleyResult {
  const fp = features(cells, seed, jitter);
  const x = u * cells, y = v * cells;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0, bdx = 0, bdy = 0;
  for (let j = -1; j <= 1; j++) {
    const cy = yi + j;
    const wy = wrap(cy, cells);
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const k = (wy * cells + wrap(cx, cells)) * 3;
      const dx = x - (cx + fp[k]), dy = y - (cy + fp[k + 1]);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = fp[k + 2];
        bdx = dx;
        bdy = dy;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  out.dx = bdx;
  out.dy = bdy;
  return out;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Precomputed tileable scalar field (size×size) — fast reuse of expensive
 * noise across several texture layers (sample with wrap-around offsets to
 * decorrelate layers).
 */
export class Field {
  readonly data: Float32Array;
  constructor(readonly size: number, fn: (u: number, v: number) => number) {
    this.data = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) this.data[y * size + x] = fn((x + 0.5) / size, (y + 0.5) / size);
    }
  }
  /** Texel fetch with wrap (integer texel coordinates). */
  px(x: number, y: number): number {
    const s = this.size;
    return this.data[(((y % s) + s) % s) * s + (((x % s) + s) % s)];
  }
}
