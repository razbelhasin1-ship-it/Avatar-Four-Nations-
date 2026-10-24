import { SimplexNoise } from '../../../core/Noise';
import { biomeWeights, heightAt, initHeightfield, waterAt, type BiomeWeights } from '../../../world/Heightfield';
import { WORLD_HALF } from '../../../world/WorldLayout';

/**
 * Parchment-style world map raster, rendered from the real Heightfield: biome
 * washes, hill shading, ink contour lines, coast outlines with offshore ripple
 * bands, rivers, lakes, ice and a paper grain/vignette. Pure (no DOM), so it
 * runs in a Web Worker as well as in unit tests. Row-major RGBA, north (−Z) up.
 */

const WATER_CODE: Record<string, number> = { ocean: 1, river: 2, lake: 3, marsh: 4 };
const FROZEN = 5;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Paper colour (warm parchment). */
const PAPER: [number, number, number] = [234, 220, 184];

type RGB = [number, number, number];
const mixInto = (c: RGB, t: RGB, k: number) => {
  c[0] += (t[0] - c[0]) * k;
  c[1] += (t[1] - c[1]) * k;
  c[2] += (t[2] - c[2]) * k;
};

const T_TEMPERATE: RGB = [196, 201, 146];
const T_FOREST: RGB = [168, 184, 128];
const T_FARM: RGB = [214, 206, 148];
const T_COLD: RGB = [241, 243, 238];
const T_DESERT: RGB = [232, 200, 136];
const T_VOLCANIC: RGB = [146, 112, 92];
const T_SWAMP: RGB = [150, 160, 112];
const T_TROPICAL: RGB = [160, 196, 126];
const T_BOREAL: RGB = [164, 178, 142];
const T_DRY: RGB = [222, 206, 148];
const T_ROCK: RGB = [186, 172, 150];
const T_SNOWCAP: RGB = [246, 245, 240];
const W_SHALLOW: RGB = [176, 204, 196];
const W_DEEP: RGB = [112, 152, 168];
const W_RIVER: RGB = [104, 150, 180];
const W_MARSH: RGB = [124, 146, 114];
const W_ICE: RGB = [224, 233, 236];
const INK: RGB = [88, 64, 42];

/** Sample grids for a size×size raster (exported for tests and the screen's hit-testing). */
export interface MapGrids {
  size: number;
  height: Float32Array;
  /** 0 land, 1 ocean, 2 river, 3 lake, 4 marsh, 5 frozen. */
  water: Uint8Array;
  level: Float32Array;
}

export function sampleGrids(size: number, onRow?: (row: number) => void): MapGrids {
  initHeightfield();
  const n = size;
  const cell = (WORLD_HALF * 2) / n;
  const height = new Float32Array(n * n);
  const water = new Uint8Array(n * n);
  const level = new Float32Array(n * n);
  for (let py = 0; py < n; py++) {
    const z = -WORLD_HALF + (py + 0.5) * cell;
    for (let px = 0; px < n; px++) {
      const x = -WORLD_HALF + (px + 0.5) * cell;
      const i = py * n + px;
      const hh = heightAt(x, z);
      height[i] = hh;
      const w = waterAt(x, z, hh);
      if (w) {
        water[i] = w.frozen ? FROZEN : WATER_CODE[w.kind] ?? 1;
        level[i] = w.level;
      }
    }
    onRow?.(py);
  }
  return { size: n, height, water, level };
}

export function renderMapRaster(size: number): Uint8ClampedArray {
  return colorize(sampleGrids(size));
}

export function colorize(g: MapGrids): Uint8ClampedArray {
  const n = g.size;
  const cell = (WORLD_HALF * 2) / n;
  const out = new Uint8ClampedArray(n * n * 4);
  const stains = new SimplexNoise(911);
  const bw = {} as BiomeWeights;
  const c: RGB = [0, 0, 0];
  const t: RGB = [0, 0, 0];
  // Light from the north-west, slightly raised (classic cartographic hill shading).
  const lx = -0.55, ly = 0.62, lz = -0.55;
  const ll = Math.hypot(lx, ly, lz);
  const exaggerate = 2.4;
  const H = g.height, W = g.water, LV = g.level;
  for (let py = 0; py < n; py++) {
    const z = -WORLD_HALF + (py + 0.5) * cell;
    for (let px = 0; px < n; px++) {
      const x = -WORLD_HALF + (px + 0.5) * cell;
      const i = py * n + px;
      const iR = px < n - 1 ? i + 1 : i, iL = px > 0 ? i - 1 : i;
      const iD = py < n - 1 ? i + n : i, iU = py > 0 ? i - n : i;
      // Paper: grain + soft stains.
      const grain = ((Math.imul(px * 73856093 ^ py * 19349663, 0x27d4eb2d) >>> 24) / 255 - 0.5) * 9;
      const stain = stains.noise2(px / n * 5, py / n * 5) * 7 + stains.noise2(px / n * 23, py / n * 23) * 3;
      c[0] = PAPER[0] + grain + stain;
      c[1] = PAPER[1] + grain + stain;
      c[2] = PAPER[2] + grain * 0.8 + stain;
      const w = W[i];
      const hh = H[i];
      if (w === 0) {
        biomeWeights(x, z, bw);
        t[0] = T_TEMPERATE[0];
        t[1] = T_TEMPERATE[1];
        t[2] = T_TEMPERATE[2];
        const f = stains.noise2(x / 260, z / 260);
        if (f > 0.25) mixInto(t, T_FOREST, clamp((f - 0.25) * 3, 0, 1));
        else if (f < -0.35) mixInto(t, T_FARM, clamp((-0.35 - f) * 3, 0, 1));
        mixInto(t, T_DRY, bw.dry * 0.85);
        mixInto(t, T_BOREAL, bw.boreal * 0.9);
        mixInto(t, T_TROPICAL, bw.tropical);
        mixInto(t, T_SWAMP, bw.swamp);
        mixInto(t, T_DESERT, bw.desert);
        mixInto(t, T_VOLCANIC, bw.volcanic);
        mixInto(t, T_ROCK, sstep(150, 230, hh));
        mixInto(t, T_SNOWCAP, sstep(250, 300, hh));
        mixInto(t, T_COLD, bw.cold);
        mixInto(c, t, 0.72);
        // Hill shade from the height grid.
        const gx = ((H[iR] - H[iL]) / (2 * cell)) * exaggerate;
        const gz = ((H[iD] - H[iU]) / (2 * cell)) * exaggerate;
        const nl = Math.hypot(gx, 1, gz);
        const dot = (-gx * lx + ly - gz * lz) / (nl * ll);
        const shade = clamp(0.6 + 0.62 * (dot - 0.55), 0.62, 1.14);
        c[0] *= shade;
        c[1] *= shade;
        c[2] *= shade * 0.98;
        // Ink contours every 45 m.
        if (hh > 6) {
          const k = Math.floor(hh / 45);
          if (Math.floor(H[iR] / 45) !== k || Math.floor(H[iD] / 45) !== k) mixInto(c, INK, hh > 150 ? 0.26 : 0.18);
        }
        // Coast: ink line on the shore pixels.
        if (W[iR] === 1 || W[iL] === 1 || W[iD] === 1 || W[iU] === 1) mixInto(c, INK, 0.62);
      } else {
        const depth = Math.max(0, LV[i] - hh);
        if (w === 1) {
          t[0] = W_SHALLOW[0];
          t[1] = W_SHALLOW[1];
          t[2] = W_SHALLOW[2];
          mixInto(t, W_DEEP, sstep(0, 46, depth));
          mixInto(c, t, 0.82);
          // Offshore ripple bands (old-map style coastline echoes).
          const band = (d: number) => Math.floor(d / 7);
          const b0 = band(depth);
          if (depth < 22 && (band(Math.max(0, LV[iR] - H[iR])) !== b0 || band(Math.max(0, LV[iD] - H[iD])) !== b0) && W[iR] === 1 && W[iD] === 1) mixInto(c, W_DEEP, 0.55);
        } else if (w === FROZEN) mixInto(c, W_ICE, 0.85);
        else if (w === 4) mixInto(c, W_MARSH, 0.78);
        else mixInto(c, W_RIVER, 0.86);
        if (W[iR] === 0 || W[iL] === 0 || W[iD] === 0 || W[iU] === 0) mixInto(c, INK, w === 1 || w === FROZEN ? 0.4 : 0.25);
      }
      // Vignette toward the sheet edges.
      const ex = (px + 0.5) / n - 0.5, ez = (py + 0.5) / n - 0.5;
      const v = 1 - sstep(0.36, 0.72, Math.hypot(ex, ez)) * 0.28;
      const o = i * 4;
      out[o] = c[0] * v;
      out[o + 1] = c[1] * v;
      out[o + 2] = c[2] * v * 0.97;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** World (x,z) → normalised map UV (0..1), north up. */
export function worldToUV(x: number, z: number): { u: number; v: number } {
  return { u: (x + WORLD_HALF) / (WORLD_HALF * 2), v: (z + WORLD_HALF) / (WORLD_HALF * 2) };
}
