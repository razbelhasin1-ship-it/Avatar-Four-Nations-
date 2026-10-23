import * as THREE from 'three';

/**
 * Noise helpers shared by bending effects.
 *
 *  - noise3(): smooth deterministic CPU value noise (geometry displacement for rocks,
 *    pillars, walls). Same input → same output, so duplicated vertices stay welded.
 *  - getNoiseTexture(): a tileable 128² RGBA fBm texture sampled by the flame / wind
 *    shaders. Texture lookups are far cheaper than ALU noise on software WebGL
 *    (SwiftShader), which keeps the effects usable on the low preset.
 *      R: fBm (4 octaves)   G: fBm (other seed)   B: ridged streaks   A: fine grain
 */

function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Smooth 3D value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/** Signed fBm in roughly [-1, 1]. */
export function fbm3(x: number, y: number, z: number, octaves = 3): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (noise3(x * f, y * f, z * f) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Deterministic pseudo-random in [0,1) from an integer seed. */
export function rand01(seed: number): number {
  return hash3(seed, seed * 7 + 3, 11);
}

// ---------------------------------------------------------------------------
// Tileable noise texture
// ---------------------------------------------------------------------------

function tileValue(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const wrap = (n: number) => ((n % period) + period) % period;
  const a = hash3(wrap(xi), wrap(yi), seed), b = hash3(wrap(xi + 1), wrap(yi), seed);
  const c = hash3(wrap(xi), wrap(yi + 1), seed), d = hash3(wrap(xi + 1), wrap(yi + 1), seed);
  const u = fade(xf), v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function tileFbm(x: number, y: number, size: number, base: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, norm = 0, period = base;
  for (let i = 0; i < octaves; i++) {
    sum += tileValue((x / size) * period, (y / size) * period, period, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

let noiseTex: THREE.DataTexture | null = null;

export function getNoiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const r = tileFbm(x, y, N, 4, 1, 4);
      const g = tileFbm(x, y, N, 4, 101, 4);
      const ridge = 1 - Math.abs(tileFbm(x, y, N, 8, 211, 3) * 2 - 1);
      const fine = tileFbm(x, y, N, 16, 307, 2);
      // Stretch contrast a little so thresholds in shaders bite.
      const c = (v: number) => Math.max(0, Math.min(255, Math.round(((v - 0.5) * 1.35 + 0.5) * 255)));
      data[i] = c(r);
      data[i + 1] = c(g);
      data[i + 2] = Math.round(Math.pow(ridge, 2.2) * 255);
      data[i + 3] = c(fine);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  noiseTex = tex;
  return tex;
}
