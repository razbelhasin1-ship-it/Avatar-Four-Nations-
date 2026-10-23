import * as THREE from 'three';
import { clamp01, Field, hash2i, lerp, pfbm, smooth, worley, type WorleyResult } from './ProcTex';

/**
 * Procedurally synthesised, tileable terrain material layers packed into one
 * texture array: RGB = albedo (sRGB), A = height (for height-blending and
 * bump lighting). Generated once at boot (~100 ms); no image assets.
 *
 * Layer order is shared with the terrain shader (see TERRAIN_LAYER).
 */

export const TERRAIN_LAYER = {
  grass: 0,
  dirt: 1,
  rock: 2,
  sand: 3,
  snow: 4,
  ice: 5,
  ash: 6,
  mud: 7,
  gravel: 8,
  paved: 9,
  packedSnow: 10,
  litter: 11,
} as const;
export const TERRAIN_LAYER_COUNT = 12;

/** World metres covered by one texture tile per layer (shader uniform). */
export const TERRAIN_LAYER_SCALE = [4.5, 5.5, 9, 6.5, 9, 9, 6, 6, 3.2, 4.2, 6, 3.6];

type RGBH = [number, number, number, number];

export interface TerrainLayerData {
  size: number;
  layers: number;
  /** RGBA8 data, layer-major. */
  data: Uint8Array;
}

function mixc(a: readonly number[], b: readonly number[], t: number, out: RGBH): RGBH {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
  return out;
}

/** Generate all layers (pure; usable from tests). */
export function generateTerrainLayers(size = 256): TerrainLayerData {
  const S = size;
  const L = TERRAIN_LAYER_COUNT;
  const data = new Uint8Array(S * S * 4 * L);
  // Shared base fields (expensive noise computed once, reused with offsets).
  const fLo = new Field(S, (u, v) => pfbm(u, v, 4, 5, 11));
  const fMid = new Field(S, (u, v) => pfbm(u, v, 16, 4, 23));
  const fHi = new Field(S, (u, v) => pfbm(u, v, 64, 2, 37));
  const w: WorleyResult = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const w2: WorleyResult = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const c: RGBH = [0, 0, 0, 0];
  const tmp: RGBH = [0, 0, 0, 0];

  const gen: Array<(u: number, v: number, x: number, y: number) => void> = [];

  // 0 grass — neutral luminance with clumps; tinted per vertex in the shader.
  gen[0] = (u, v, x, y) => {
    const lo = fLo.px(x, y), mid = fMid.px(x + 37, y + 11), hi = fHi.px(x, y);
    worley(u, v, 22, 401, 0.9, w);
    const clump = 1 - smooth(0, 0.75, w.f1);
    let lum = 0.62 + 0.1 * lo + 0.07 * mid + 0.07 * hi + 0.1 * (clump - 0.5);
    lum *= 0.82 + 0.18 * smooth(0.05, 0.45, w.f2 - w.f1);
    const warm = 0.5 + 0.5 * fLo.px(x + 100, y + 50);
    if (hash2i(x, y, 3) > 0.982) lum *= 1.22;
    c[0] = lum * (0.9 + 0.2 * warm);
    c[1] = lum;
    c[2] = lum * (0.96 - 0.16 * warm);
    c[3] = 0.42 + 0.32 * clump + 0.14 * hi;
  };
  // 1 dirt — warm brown with damp patches and pebbles.
  gen[1] = (u, v, x, y) => {
    const lo = fLo.px(x + 61, y + 7), mid = fMid.px(x, y + 90), hi = fHi.px(x + 5, y + 9);
    mixc([0.36, 0.27, 0.19], [0.53, 0.42, 0.3], 0.5 + 0.5 * lo, c);
    const damp = smooth(0.2, 0.55, mid) * 0.16;
    worley(u, v, 48, 512, 0.9, w);
    const pebble = smooth(0.34, 0.2, w.f1) * (w.id > 0.42 ? 1 : 0);
    mixc([0.48, 0.44, 0.38], [0.64, 0.58, 0.49], w.id, tmp);
    const grain = 0.93 + 0.13 * hash2i(x, y, 5);
    for (let i = 0; i < 3; i++) c[i] = lerp(c[i] * (1 - damp), tmp[i], pebble) * grain;
    c[3] = 0.4 + 0.14 * lo + 0.1 * hi + 0.42 * pebble * (1 - w.f1 * 2.2);
  };
  // 2 rock — layered strata along V (vertical in the side projections) with cracks and lichen.
  gen[2] = (u, v, x, y) => {
    const lo = fLo.px(x + 13, y + 201), mid = fMid.px(x + 77, y + 3), hi = fHi.px(x + 31, y + 66);
    const sc = v * 14 + mid * 0.7 + lo * 1.4;
    const band = 0.5 + 0.5 * Math.sin(sc * Math.PI * 2);
    const bandId = ((Math.floor(sc) % 14) + 14) % 14;
    const bv = hash2i(bandId, 0, 222);
    mixc([0.47, 0.44, 0.41], [0.63, 0.58, 0.52], 0.25 + 0.5 * bv + 0.25 * band, c);
    if (bv > 0.7) { c[0] *= 1.07; c[1] *= 1.0; c[2] *= 0.92; }
    worley(u, v, 7, 77, 0.95, w);
    const crack = smooth(0.07, 0.0, w.f2 - w.f1);
    worley(u, v, 19, 79, 0.9, w2);
    const fine = smooth(0.04, 0.0, w2.f2 - w2.f1) * 0.5;
    const lichen = smooth(0.5, 0.75, fMid.px(x + 140, y + 140)) * (hash2i(x >> 1, y >> 1, 8) > 0.35 ? 1 : 0.4);
    const shade = (0.86 + 0.18 * hi) * (1 - 0.5 * crack) * (1 - 0.3 * fine);
    c[0] = lerp(c[0], 0.46, lichen * 0.35) * shade;
    c[1] = lerp(c[1], 0.5, lichen * 0.35) * shade;
    c[2] = lerp(c[2], 0.32, lichen * 0.35) * shade;
    c[3] = clamp01(0.5 + 0.22 * (band - 0.5) + 0.18 * hi + 0.1 * lo - 0.45 * crack - 0.15 * fine);
  };
  // 3 sand — asymmetric wind ripples and grains.
  gen[3] = (u, v, x, y) => {
    const lo = fLo.px(x + 3, y + 150), mid = fMid.px(x + 50, y + 50), hi = fHi.px(x + 9, y + 1);
    const t = v * 20 + 0.9 * lo + 0.25 * mid;
    const f = t - Math.floor(t);
    const prof = f < 0.68 ? smooth(0, 0.68, f) : 1 - smooth(0.68, 1, f);
    mixc([0.82, 0.7, 0.5], [0.92, 0.82, 0.62], 0.5 + 0.5 * fLo.px(x + 99, y + 9), c);
    const shade = 0.93 + 0.1 * prof;
    const g = hash2i(x, y, 9);
    const speck = g > 0.975 ? 0.72 : g < 0.02 ? 1.12 : 1;
    for (let i = 0; i < 3; i++) c[i] *= shade * speck;
    c[3] = 0.3 + 0.5 * prof + 0.08 * hi;
  };
  // 4 snow — soft drifts with cool hollows.
  gen[4] = (u, v, x, y) => {
    const lo = fLo.px(x + 180, y + 30), mid = fMid.px(x + 20, y + 120), hi = fHi.px(x + 70, y + 70);
    const soft = 0.5 + 0.5 * lo;
    c[0] = 0.9 + 0.06 * soft + 0.02 * hi;
    c[1] = 0.93 + 0.05 * soft + 0.02 * hi;
    c[2] = 0.98 + 0.02 * soft;
    if (hash2i(x, y, 12) > 0.993) { c[0] = c[1] = c[2] = 1; }
    c[3] = 0.35 + 0.35 * soft + 0.12 * mid + 0.05 * hi;
  };
  // 5 ice — deep blue patches, white cracks, bubbles, frost.
  gen[5] = (u, v, x, y) => {
    const lo = fLo.px(x + 222, y + 5), mid = fMid.px(x + 5, y + 222);
    mixc([0.62, 0.81, 0.91], [0.33, 0.56, 0.73], smooth(-0.25, 0.55, lo), c);
    worley(u, v, 6, 909, 0.95, w);
    const crack = smooth(0.035, 0.0, w.f2 - w.f1);
    worley(u, v, 17, 919, 0.9, w2);
    const fine = smooth(0.02, 0.0, w2.f2 - w2.f1) * 0.45;
    const frost = smooth(0.35, 0.8, mid) * 0.35;
    const bub = hash2i(x, y, 14) > 0.993 ? 0.6 : 0;
    const white = clamp01(crack * 0.75 + fine + frost + bub);
    c[0] = lerp(c[0], 0.9, white);
    c[1] = lerp(c[1], 0.96, white);
    c[2] = lerp(c[2], 1.0, white);
    c[3] = clamp01(0.55 - 0.35 * crack - 0.15 * fine + 0.06 * lo + 0.08 * frost);
  };
  // 6 ash — dark volcanic grit with pumice and rusty patches.
  gen[6] = (u, v, x, y) => {
    const lo = fLo.px(x + 44, y + 177), mid = fMid.px(x + 160, y + 60), hi = fHi.px(x + 40, y + 140);
    mixc([0.19, 0.18, 0.18], [0.31, 0.28, 0.27], 0.5 + 0.5 * lo, c);
    const rust = smooth(0.25, 0.7, mid) * 0.35;
    c[0] = lerp(c[0], 0.36, rust); c[1] = lerp(c[1], 0.23, rust); c[2] = lerp(c[2], 0.18, rust);
    worley(u, v, 56, 606, 0.9, w);
    const pum = smooth(0.26, 0.14, w.f1) * (w.id > 0.62 ? 1 : 0);
    c[0] = lerp(c[0], 0.47, pum); c[1] = lerp(c[1], 0.44, pum); c[2] = lerp(c[2], 0.42, pum);
    const g = 0.92 + 0.14 * hash2i(x, y, 15);
    for (let i = 0; i < 3; i++) c[i] *= g;
    c[3] = 0.38 + 0.2 * lo + 0.3 * pum + 0.1 * hi;
  };
  // 7 mud — wet earth with puddles and drying cracks.
  gen[7] = (u, v, x, y) => {
    const lo = fLo.px(x + 90, y + 210), hi = fHi.px(x + 100, y + 30);
    mixc([0.27, 0.21, 0.15], [0.38, 0.3, 0.21], 0.5 + 0.5 * lo, c);
    const puddle = smooth(0.2, 0.42, -fLo.px(x + 33, y + 66));
    worley(u, v, 10, 707, 0.9, w);
    const crack = smooth(0.05, 0.0, w.f2 - w.f1) * (1 - puddle) * smooth(0.0, 0.4, lo);
    for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - 0.45 * puddle) * (1 - 0.35 * crack);
    c[3] = clamp01(0.48 + 0.18 * lo - 0.38 * puddle + 0.1 * hi - 0.2 * crack);
  };
  // 8 gravel — rounded pebbles of mixed stone.
  gen[8] = (u, v, x, y) => {
    worley(u, v, 26, 808, 0.85, w);
    const stone = smooth(0.5, 0.32, w.f1);
    const dome = Math.sqrt(Math.max(0, 1 - (w.f1 / 0.5) ** 2));
    const warm = hash2i(Math.floor(w.id * 9973), 1, 18);
    mixc([0.4, 0.38, 0.37], [0.67, 0.63, 0.57], w.id, tmp);
    tmp[0] *= 0.95 + 0.1 * warm; tmp[2] *= 1.04 - 0.1 * warm;
    const shade = 0.82 + 0.22 * dome;
    for (let i = 0; i < 3; i++) c[i] = lerp([0.2, 0.18, 0.16][i], tmp[i] * shade, stone);
    c[3] = 0.12 + 0.78 * dome * stone;
  };
  // 9 paved flagstones (stone roads, plazas, trails).
  gen[9] = (u, v, x, y) => {
    const lo = fLo.px(x + 120, y + 240), hi = fHi.px(x + 60, y + 200);
    worley(u, v, 5, 999, 0.72, w);
    const e = w.f2 - w.f1;
    const stone = smooth(0.025, 0.06, e);
    const bevel = smooth(0.03, 0.16, e);
    mixc([0.5, 0.48, 0.44], [0.69, 0.65, 0.58], w.id, tmp);
    const sh = (0.86 + 0.12 * lo + 0.08 * hi) * (0.84 + 0.16 * bevel);
    const moss = smooth(0.1, 0.6, fMid.px(x + 7, y + 7)) * (1 - stone);
    const mortar: number[] = [lerp(0.27, 0.24, moss), lerp(0.25, 0.3, moss), lerp(0.22, 0.17, moss)];
    for (let i = 0; i < 3; i++) c[i] = lerp(mortar[i], tmp[i] * sh, stone);
    c[3] = 0.15 + 0.6 * stone * Math.sqrt(bevel) + 0.06 * hi;
  };
  // 10 packed snow — trodden, compressed, slightly icy.
  gen[10] = (u, v, x, y) => {
    const lo = fLo.px(x + 17, y + 117), mid = fMid.px(x + 117, y + 17), hi = fHi.px(x + 3, y + 3);
    const t = 0.5 + 0.5 * lo;
    c[0] = 0.76 + 0.08 * t + 0.03 * hi;
    c[1] = 0.81 + 0.07 * t + 0.03 * hi;
    c[2] = 0.89 + 0.05 * t;
    worley(u, v, 30, 1010, 0.9, w);
    const lump = smooth(0.45, 0.2, w.f1) * 0.5;
    if (hash2i(x, y, 21) > 0.99) { c[0] = 0.96; c[1] = 0.98; c[2] = 1; }
    c[3] = 0.42 + 0.12 * lo + 0.1 * mid + 0.2 * lump;
  };
  // 11 forest floor — fallen leaves, twigs and moss.
  gen[11] = (u, v, x, y) => {
    const mid = fMid.px(x + 211, y + 31), hi = fHi.px(x + 11, y + 131);
    mixc([0.22, 0.2, 0.13], [0.32, 0.28, 0.18], 0.5 + 0.5 * fLo.px(x + 77, y + 177), c);
    const moss = smooth(0.15, 0.6, mid);
    c[0] = lerp(c[0], 0.27, moss); c[1] = lerp(c[1], 0.36, moss); c[2] = lerp(c[2], 0.15, moss);
    let leaf = 0;
    for (let k = 0; k < 2; k++) {
      worley(u, v, k === 0 ? 30 : 44, 1111 + k * 7, 0.95, w);
      const a = w.id * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const lx = (w.dx * ca - w.dy * sa) / 0.4, ly = (w.dx * sa + w.dy * ca) / 0.19;
      const inside = smooth(1.05, 0.8, lx * lx + ly * ly);
      if (inside > leaf) {
        leaf = inside;
        const hue = hash2i(Math.floor(w.id * 7919), k, 19);
        const pal = hue < 0.3 ? [0.5, 0.31, 0.13] : hue < 0.55 ? [0.6, 0.4, 0.14] : hue < 0.8 ? [0.33, 0.23, 0.12] : [0.4, 0.42, 0.18];
        tmp[0] = pal[0]; tmp[1] = pal[1]; tmp[2] = pal[2];
      }
    }
    for (let i = 0; i < 3; i++) c[i] = lerp(c[i], tmp[i] * (0.9 + 0.2 * hi), leaf * 0.9);
    c[3] = 0.3 + 0.45 * leaf + 0.12 * hi + 0.1 * moss;
  };

  for (let l = 0; l < L; l++) {
    const base = l * S * S * 4;
    const fn = gen[l];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        fn((x + 0.5) / S, (y + 0.5) / S, x, y);
        const o = base + (y * S + x) * 4;
        data[o] = Math.max(0, Math.min(255, Math.round(c[0] * 255)));
        data[o + 1] = Math.max(0, Math.min(255, Math.round(c[1] * 255)));
        data[o + 2] = Math.max(0, Math.min(255, Math.round(c[2] * 255)));
        data[o + 3] = Math.max(0, Math.min(255, Math.round(c[3] * 255)));
      }
    }
  }
  return { size: S, layers: L, data };
}

let cached: TerrainLayerData | null = null;

/** Shared (lazily generated) layer data. */
export function terrainLayerData(): TerrainLayerData {
  if (!cached) cached = generateTerrainLayers(256);
  return cached;
}

/** Create the GPU texture array for the terrain shader. */
export function createTerrainTexture(anisotropy = 4): THREE.DataArrayTexture {
  const d = terrainLayerData();
  const tex = new THREE.DataArrayTexture(d.data, d.size, d.size, d.layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}
