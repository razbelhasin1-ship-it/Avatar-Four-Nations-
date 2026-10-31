/**
 * Procedural terrain definition — pure functions over (x, z), no three.js.
 *
 * heightAt(x, z) is THE ground truth used by terrain meshes, collision, AI,
 * vegetation and the map. It must stay deterministic and fast (~2-5 µs).
 *
 * Composition order (see heightAt):
 *   base land/sea + hills  ->  mountain ranges + special landforms
 *   -> plateaus (city sites) -> trails (explicit-grade paths) -> roads
 *   -> lakes -> rivers
 * Profiles for rivers/roads/trails/lakes are precomputed once at init from
 * the intermediate "natural" height so the final field has no recursion.
 *
 * A coarse feature grid (128 m cells) lists which ranges, plateaus, roads,
 * trails, lakes and rivers can influence each cell, so per-sample cost does
 * not grow with the number of features.
 *
 * Shading/classification helpers (sampleTerrain, terrainSurfaceAt, roadAt,
 * localWaterAt) live here too so the renderer, footsteps, footprints, grass and
 * vegetation all agree on what the ground is.
 */
import { SimplexNoise } from '../core/Noise';
import { FNC, capitalPaved, fireCapitalHeight } from './landforms/fireCapital';
import type { BiomeId, SurfaceType } from '../core/types';
import {
  LAKES,
  LAND_BLOBS,
  MOUNTAIN_RANGES,
  PLATEAUS,
  RIVERS,
  ROADS,
  SEA_BLOBS,
  SEA_LEVEL,
  WORLD_HALF,
  type LakeDef,
  type P2,
} from './WorldLayout';

const noise = new SimplexNoise(424242);
const noiseB = new SimplexNoise(1717);
const noiseC = new SimplexNoise(9090);
const noiseD = new SimplexNoise(5151);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const len2 = (x: number, z: number) => Math.sqrt(x * x + z * z);

// ---------------------------------------------------------------------------
// Polyline helper with precomputed segments & bounds
// ---------------------------------------------------------------------------

export class Polyline {
  readonly ax: Float64Array;
  readonly az: Float64Array;
  readonly bx: Float64Array;
  readonly bz: Float64Array;
  readonly segLen: Float64Array;
  readonly cumLen: Float64Array;
  readonly length: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  constructor(readonly points: P2[], pad: number) {
    const n = points.length - 1;
    this.ax = new Float64Array(n);
    this.az = new Float64Array(n);
    this.bx = new Float64Array(n);
    this.bz = new Float64Array(n);
    this.segLen = new Float64Array(n);
    this.cumLen = new Float64Array(n + 1);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[i + 1];
      this.ax[i] = a.x; this.az[i] = a.z; this.bx[i] = b.x; this.bz[i] = b.z;
      const l = len2(b.x - a.x, b.z - a.z);
      this.segLen[i] = l;
      this.cumLen[i] = acc;
      acc += l;
      minX = Math.min(minX, a.x, b.x); maxX = Math.max(maxX, a.x, b.x);
      minZ = Math.min(minZ, a.z, b.z); maxZ = Math.max(maxZ, a.z, b.z);
    }
    this.cumLen[n] = acc;
    this.length = acc;
    this.minX = minX - pad; this.maxX = maxX + pad; this.minZ = minZ - pad; this.maxZ = maxZ + pad;
  }

  inBounds(x: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }

  /** Distance to the polyline; writes arc-length parameter of closest point into out[0]. */
  distance(x: number, z: number, out?: Float64Array): number {
    let best = Infinity;
    let bestS = 0;
    const n = this.ax.length;
    for (let i = 0; i < n; i++) {
      const ax = this.ax[i], az = this.az[i];
      const abx = this.bx[i] - ax, abz = this.bz[i] - az;
      const l2 = abx * abx + abz * abz;
      let t = l2 > 0 ? ((x - ax) * abx + (z - az) * abz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + abx * t - x, cz = az + abz * t - z;
      const d2 = cx * cx + cz * cz;
      if (d2 < best) {
        best = d2;
        bestS = this.cumLen[i] + this.segLen[i] * t;
      }
    }
    if (out) out[0] = bestS;
    return Math.sqrt(best);
  }

  /**
   * Signed lateral distance (positive on the right of the travel direction,
   * i.e. +X when travelling +Z... see cross product below). Writes arc length to out[0].
   */
  signedDistance(x: number, z: number, out?: Float64Array): number {
    let best = Infinity;
    let bestS = 0;
    let sign = 1;
    const n = this.ax.length;
    for (let i = 0; i < n; i++) {
      const ax = this.ax[i], az = this.az[i];
      const abx = this.bx[i] - ax, abz = this.bz[i] - az;
      const l2 = abx * abx + abz * abz;
      let t = l2 > 0 ? ((x - ax) * abx + (z - az) * abz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + abx * t - x, cz = az + abz * t - z;
      const d2 = cx * cx + cz * cz;
      if (d2 < best) {
        best = d2;
        bestS = this.cumLen[i] + this.segLen[i] * t;
        sign = abx * (z - az) - abz * (x - ax) >= 0 ? 1 : -1;
      }
    }
    if (out) out[0] = bestS;
    return Math.sqrt(best) * sign;
  }

  /** Point at arc length s. */
  pointAt(s: number): P2 {
    s = Math.max(0, Math.min(this.length, s));
    const n = this.ax.length;
    for (let i = 0; i < n; i++) {
      if (s <= this.cumLen[i + 1] || i === n - 1) {
        const t = this.segLen[i] > 0 ? (s - this.cumLen[i]) / this.segLen[i] : 0;
        return { x: mix(this.ax[i], this.bx[i], t), z: mix(this.az[i], this.bz[i], t) };
      }
    }
    return { x: this.bx[n - 1], z: this.bz[n - 1] };
  }

  /** Unit tangent at arc length s. */
  tangentAt(s: number): P2 {
    const n = this.ax.length;
    for (let i = 0; i < n; i++) {
      if (s <= this.cumLen[i + 1] || i === n - 1) {
        const l = this.segLen[i] || 1;
        return { x: (this.bx[i] - this.ax[i]) / l, z: (this.bz[i] - this.az[i]) / l };
      }
    }
    return { x: 1, z: 0 };
  }

  /** Minimum distance from the polyline to an axis-aligned box (conservative helper for grids). */
  distanceToBox(x0: number, z0: number, x1: number, z1: number): number {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const hd = len2(x1 - x0, z1 - z0) / 2;
    return Math.max(0, this.distance(cx, cz) - hd);
  }
}

/** A height profile sampled along a polyline at fixed spacing. */
class Profile {
  constructor(readonly spacing: number, readonly values: Float32Array) {}
  at(s: number): number {
    const f = s / this.spacing;
    const i = Math.floor(f);
    const v = this.values;
    if (i <= 0) return v[0];
    if (i >= v.length - 1) return v[v.length - 1];
    return mix(v[i], v[i + 1], f - i);
  }
}

// ---------------------------------------------------------------------------
// Feature tables (built once)
// ---------------------------------------------------------------------------

interface RangeRT { line: Polyline; width: number; height: number; roughness: number }
export interface RiverFall {
  /** Arc length of the lip (top of the fall). */
  s: number;
  /** Vertical drop (m). */
  drop: number;
}
interface RiverRT { id: string; line: Polyline; w0: number; w1: number; depth: number; bank: number; surface: Profile; frozen: boolean; falls: RiverFall[]; slope: Float32Array }
interface RoadRT { id: string; line: Polyline; half: number; profile: Profile; surface: string }
interface TrailRT { id: string; line: Polyline; half: number; profile: Profile }
interface LakeRT { def: LakeDef; level: number; depth: number; shore: number }
interface PlateauRT { x: number; z: number; r: number; blend: number; height: number }

/** Explicit-grade switchback trails (cut into mountains). y profile is linear between endpoint heights. */
export const TRAILS: Array<{ id: string; points: P2[]; width: number; endHeight?: number }> = [
  {
    id: 'air_temple_switchbacks',
    points: [
      { x: 1250, z: 1060 },
      { x: 1330, z: 1110 },
      { x: 1290, z: 1150 },
      { x: 1370, z: 1170 },
      { x: 1330, z: 1200 },
      { x: 1375, z: 1215 },
    ],
    width: 7,
    endHeight: 330,
  },
  {
    id: 'omashu_ramp',
    points: [
      { x: -260, z: -720 },
      { x: -330, z: -700 },
      { x: -380, z: -680 },
    ],
    width: 9,
    endHeight: 95,
  },
];

const ranges: RangeRT[] = MOUNTAIN_RANGES.map((r) => ({
  line: new Polyline(r.points, r.width),
  width: r.width,
  height: r.height,
  roughness: r.roughness,
}));

let rivers: RiverRT[] = [];
let roads: RoadRT[] = [];
let trails: TrailRT[] = [];
let lakes: LakeRT[] = [];
let plateaus: PlateauRT[] = [];
let initialized = false;
const tmpS = new Float64Array(1);

// Special landforms
/** The Fire Nation capital's volcano (see landforms/fireCapital.ts): centre and the reach of its charred flanks. */
const VOLCANO = { x: FNC.V.x, z: FNC.V.z, rimR: FNC.lipR, outerR: 340, rimH: FNC.lipY };
const AIR_PEAK = { x: 1450, z: 1250, r: 470, h: 350 };
const OMASHU_MESA = { x: -450, z: -650, r: 150, h: 95 };
const DESERT = { x: 250, z: 950, r: 430 };
const SWAMP = { x: -1150, z: -150, r: 340, level: 0.9 };
const FIRE_ISLAND = { x: -1380, z: 1150, r: 560 };

/**
 * Needle spires around the Air Temple massif — they pierce the sea of clouds
 * like the pinnacles around the Southern Air Temple. Kept clear of the
 * switchback trail, the bison meadow, the tarn and the wind shrine.
 */
export const AIR_SPIRES: ReadonlyArray<{ x: number; z: number; r: number; h: number }> = [
  { x: 1775, z: 1235, r: 56, h: 285 },
  { x: 1690, z: 1440, r: 66, h: 310 },
  { x: 1520, z: 1590, r: 54, h: 255 },
  { x: 1215, z: 1450, r: 62, h: 270 },
  { x: 1130, z: 1300, r: 46, h: 215 },
  { x: 1590, z: 980, r: 50, h: 240 },
  { x: 1840, z: 1300, r: 44, h: 205 },
  { x: 1330, z: 1600, r: 48, h: 225 },
];

/** Public descriptors of special landforms (vegetation & weather use them). */
export const LANDFORMS = { VOLCANO, AIR_PEAK, OMASHU_MESA, DESERT, SWAMP, FIRE_ISLAND } as const;

// ---------------------------------------------------------------------------
// Feature grid
// ---------------------------------------------------------------------------

const GRID_CELL = 128;
const GRID_N = Math.ceil((WORLD_HALF * 2) / GRID_CELL);
interface Cell {
  ranges: number[];
  plateaus: number[];
  trails: number[];
  roads: number[];
  lakes: number[];
  rivers: number[];
}
const cells: Cell[] = [];
for (let i = 0; i < GRID_N * GRID_N; i++) cells.push({ ranges: [], plateaus: [], trails: [], roads: [], lakes: [], rivers: [] });
const EMPTY_CELL: Cell = { ranges: [], plateaus: [], trails: [], roads: [], lakes: [], rivers: [] };

function cellAt(x: number, z: number): Cell {
  const cx = Math.floor((x + WORLD_HALF) / GRID_CELL);
  const cz = Math.floor((z + WORLD_HALF) / GRID_CELL);
  // Written so NaN coordinates (e.g. from a degenerate camera ray) also fall back to the empty cell.
  if (!(cx >= 0 && cz >= 0 && cx < GRID_N && cz < GRID_N)) return EMPTY_CELL;
  return cells[cz * GRID_N + cx];
}

function forEachCell(fn: (cell: Cell, x0: number, z0: number, x1: number, z1: number) => void): void {
  for (let j = 0; j < GRID_N; j++) {
    for (let i = 0; i < GRID_N; i++) {
      const x0 = -WORLD_HALF + i * GRID_CELL, z0 = -WORLD_HALF + j * GRID_CELL;
      fn(cells[j * GRID_N + i], x0, z0, x0 + GRID_CELL, z0 + GRID_CELL);
    }
  }
}

function addLineFeature(list: (c: Cell) => number[], idx: number, line: Polyline, influence: number): void {
  forEachCell((cell, x0, z0, x1, z1) => {
    if (x1 < line.minX - influence || x0 > line.maxX + influence || z1 < line.minZ - influence || z0 > line.maxZ + influence) return;
    if (line.distanceToBox(x0, z0, x1, z1) <= influence) list(cell).push(idx);
  });
}

function addDiscFeature(list: (c: Cell) => number[], idx: number, x: number, z: number, influence: number): void {
  forEachCell((cell, x0, z0, x1, z1) => {
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
    if (dx * dx + dz * dz <= influence * influence) list(cell).push(idx);
  });
}

// ---------------------------------------------------------------------------
// Stage functions
// ---------------------------------------------------------------------------

/** Signed land field in metres (positive = land), with coastline noise. */
export function landField(x: number, z: number): { s: number; lift: number } {
  const wx = x + 70 * noise.noise2(x / 520, z / 520);
  const wz = z + 70 * noise.noise2(x / 520 + 31.7, z / 520 - 12.1);
  let best = -Infinity;
  let liftAcc = 0, wAcc = 0;
  for (let i = 0; i < LAND_BLOBS.length; i++) {
    const b = LAND_BLOBS[i];
    const dx = wx - b.x, dz = wz - b.z;
    const v = b.r - Math.sqrt(dx * dx + dz * dz);
    if (v > best) best = v;
    if (v > -60) {
      const w = v + 60;
      liftAcc += w * (b.lift ?? 0);
      wAcc += w;
    }
  }
  let s = best;
  for (let i = 0; i < SEA_BLOBS.length; i++) {
    const sb = SEA_BLOBS[i];
    const dx = wx - sb.x, dz = wz - sb.z;
    const d = Math.sqrt(dx * dx + dz * dz) - sb.r;
    if (d < s) s = d;
  }
  s += 38 * noise.fbm2(x / 260, z / 260, 3);
  // Map edge always ocean.
  const edge = WORLD_HALF - Math.max(Math.abs(x), Math.abs(z));
  s = Math.min(s, edge - 140);
  return { s, lift: wAcc > 0 ? liftAcc / wAcc : 0 };
}

/** 0..1 how far into the polar seas a point is (wide, shallow, frozen shelves). */
export function polarSeaFactor(x: number, z: number): number {
  const north = sstep(-1120, -1220, z);
  const south = sstep(1470, 1560, z) * sstep(-330, -230, x) * sstep(780, 680, x);
  return Math.max(north, south);
}

function baseHeight(x: number, z: number): number {
  const { s, lift } = landField(x, z);
  if (s < 0) {
    // Continental shelf, deepening offshore. Polar shelves are wide and shallow (sea ice).
    const shelf = mix(0.16, 0.045, polarSeaFactor(x, z));
    return SEA_LEVEL - 1.2 + Math.max(-38, s * shelf) + 1.5 * noiseB.noise2(x / 90, z / 90);
  }
  const inland = sstep(10, 220, s);
  let h = SEA_LEVEL + Math.min(s * 0.09, 2.2) + inland * (2 + lift);
  h += inland * 16 * (0.5 + 0.5 * noise.fbm2(x / 700, z / 700, 4));
  h += inland * 4 * noiseB.fbm2(x / 140, z / 140, 3);
  h += 0.8 * noiseC.noise2(x / 32, z / 32);
  return h;
}

function rangesHeight(x: number, z: number, cell: Cell): number {
  let add = 0;
  const list = cell.ranges;
  for (let k = 0; k < list.length; k++) {
    const r = ranges[list[k]];
    if (!r.line.inBounds(x, z)) continue;
    const d = r.line.distance(x, z);
    if (d >= r.width) continue;
    const m = 1 - d / r.width;
    const shape = m * m * (3 - 2 * m);
    const ridge = noise.ridged2(x / 210, z / 210, 5);
    const along = 0.75 + 0.25 * noiseB.noise2(x / 400, z / 400);
    add += r.height * Math.pow(shape, 1.35) * mix(0.8, 0.35 + 0.95 * ridge, r.roughness) * along;
  }
  return add;
}

function specialLandforms(x: number, z: number, h: number): number {
  // Fire Nation capital: volcano, crater (Hari Bulkan), Harbor City, plaza valley and harbour
  // (landforms/fireCapital.ts; keeps the old volcano's flank around the Sun Warrior Ruins).
  h = fireCapitalHeight(x, z, h);
  // Air temple peak: a steep massif with noisy, ridged flanks (not a perfect cone).
  {
    const dx = x - AIR_PEAK.x, dz = z - AIR_PEAK.z;
    const rr = AIR_PEAK.r * 1.45;
    if (dx * dx + dz * dz < rr * rr) {
      const ang = Math.atan2(dz, dx);
      const warp = 1 + 0.32 * noise.noise2(Math.cos(ang) * 1.7 + 4.1, Math.sin(ang) * 1.7 - 2.3) + 0.12 * noiseB.noise2(x / 90, z / 90);
      const d = Math.sqrt(dx * dx + dz * dz) / warp;
      if (d < AIR_PEAK.r) {
        const t = 1 - d / AIR_PEAK.r;
        const ridges = 0.7 + 0.45 * noise.ridged2(x / 140, z / 140, 5);
        const peak = AIR_PEAK.h * Math.pow(t, 1.55) * mix(ridges, 1, sstep(0.75, 0.95, t));
        h = Math.max(h, peak);
      }
    }
    // Needle spires.
    for (let i = 0; i < AIR_SPIRES.length; i++) {
      const sp = AIR_SPIRES[i];
      const sx = x - sp.x, sz = z - sp.z;
      const outer = sp.r * 2.4;
      const sd2 = sx * sx + sz * sz;
      if (sd2 > outer * outer) continue;
      const a = Math.atan2(sz, sx);
      const wob = 1 + 0.22 * noiseC.noise2(Math.cos(a) * 1.3 + i * 7.1, Math.sin(a) * 1.3 + i * 3.3);
      const d = Math.sqrt(sd2) / (sp.r * wob);
      if (d >= 2.4) continue;
      // Steep column with a flared, scree-covered foot and a ragged crown.
      const column = d < 1 ? 1 - Math.pow(d, 5) * 0.35 : 0.65 * Math.pow(Math.max(0, 1 - (d - 1) / 1.4), 2.2);
      const crown = 1 - 0.12 * Math.abs(noise.noise2(x / 18, z / 18));
      h = Math.max(h, sp.h * column * crown);
    }
  }
  // Omashu mesa: steep-sided plateau.
  {
    const dx = x - OMASHU_MESA.x, dz = z - OMASHU_MESA.z;
    const outer = OMASHU_MESA.r * 1.8;
    if (dx * dx + dz * dz < outer * outer) {
      const d = Math.sqrt(dx * dx + dz * dz);
      const t = 1 - sstep(OMASHU_MESA.r * 0.8, outer, d);
      h = Math.max(h, OMASHU_MESA.h * t + 4 * noise.noise2(x / 30, z / 30) * t);
    }
  }
  // Desert dunes: long asymmetric transverse dunes (gentle windward, steep lee) on a rolling erg.
  {
    const dx = x - DESERT.x, dz = z - DESERT.z;
    if (dx * dx + dz * dz < DESERT.r * DESERT.r) {
      const d = Math.sqrt(dx * dx + dz * dz);
      const w = sstep(DESERT.r, DESERT.r * 0.6, d);
      const p = (x * 0.8 + z * 0.6) / 46 + 2.2 * noise.noise2(x / 300, z / 300) + 0.6 * noiseD.noise2(x / 90, z / 90);
      const f = p - Math.floor(p);
      // Sawtooth-ish: slow rise over 78% of the wavelength, steep slip face after the crest.
      const prof = f < 0.7 ? sstep(0, 0.7, f) : 1 - sstep(0.7, 1, f);
      const amp = 5 + 3.5 * noiseB.noise2(x / 220, z / 220);
      const erg = 5 * (0.5 + 0.5 * noiseC.fbm2(x / 380, z / 380, 2));
      h += w * (prof * amp + erg);
    }
  }
  // Swamp: flatten toward water level with hummocks, pools and winding channels.
  {
    const dx = x - SWAMP.x, dz = z - SWAMP.z;
    if (dx * dx + dz * dz < SWAMP.r * SWAMP.r) {
      const d = Math.sqrt(dx * dx + dz * dz);
      const w = sstep(SWAMP.r, SWAMP.r * 0.55, d);
      // Hummocks and pools: roughly 40% of the inner swamp sits below the marsh water level.
      let target = SWAMP.level + 0.25 + 1.3 * noise.fbm2(x / 38, z / 38, 3) + 0.4 * noiseB.noise2(x / 9, z / 9);
      // Meandering channels (ridged noise valleys) connect the pools.
      const ch = 1 - Math.abs(noiseD.noise2(x / 110 + 0.5 * noise.noise2(x / 60, z / 60), z / 110));
      target -= sstep(0.88, 0.97, ch) * 1.1;
      h = mix(h, target, w);
    }
  }
  return h;
}

/** Height before plateaus/trails/roads/lakes/rivers. */
function naturalHeight(x: number, z: number, cell: Cell): number {
  let h = baseHeight(x, z);
  if (h > SEA_LEVEL - 4 && cell.ranges.length) h += rangesHeight(x, z, cell);
  h = specialLandforms(x, z, h);
  return h;
}

function applyPlateaus(x: number, z: number, h: number, cell: Cell): number {
  const list = cell.plateaus;
  for (let k = 0; k < list.length; k++) {
    const p = plateaus[list[k]];
    const dx = x - p.x, dz = z - p.z;
    const outer = p.r + p.blend;
    const d2 = dx * dx + dz * dz;
    if (d2 > outer * outer) continue;
    const d = Math.sqrt(d2);
    const w = 1 - sstep(p.r, outer, d);
    h = mix(h, p.height, w);
  }
  return h;
}

function applyTrailsRoads(x: number, z: number, h: number, cell: Cell): number {
  const tl = cell.trails;
  for (let k = 0; k < tl.length; k++) {
    const t = trails[tl[k]];
    if (!t.line.inBounds(x, z)) continue;
    const d = t.line.distance(x, z, tmpS);
    const edge = t.half + 10;
    if (d >= edge) continue;
    const y = t.profile.at(tmpS[0]);
    const w = 1 - sstep(t.half, edge, d);
    h = mix(h, y, w);
  }
  const rl = cell.roads;
  for (let k = 0; k < rl.length; k++) {
    const r = roads[rl[k]];
    if (!r.line.inBounds(x, z)) continue;
    const d = r.line.distance(x, z, tmpS);
    const edge = r.half + 7;
    if (d >= edge) continue;
    const y = r.profile.at(tmpS[0]);
    const w = (1 - sstep(r.half, edge, d)) * 0.92;
    h = mix(h, y, w);
  }
  return h;
}

function applyLakes(x: number, z: number, h: number, cell: Cell): number {
  const ll = cell.lakes;
  for (let k = 0; k < ll.length; k++) {
    const l = lakes[ll[k]];
    const dx = x - l.def.x, dz = z - l.def.z;
    const outer = l.def.r + l.shore;
    const d2 = dx * dx + dz * dz;
    if (d2 > outer * outer) continue;
    const d = Math.sqrt(d2);
    if (d < l.def.r) {
      const t = d / l.def.r;
      const bed = l.level - 0.35 - l.depth * (1 - t * t);
      h = Math.min(h, bed);
      if (t > 0.85) h = mix(h, l.level - 0.35, sstep(0.85, 1, t));
    } else {
      const t = sstep(l.def.r, outer, d);
      h = mix(l.level + 0.35, h, t);
    }
  }
  return h;
}

function applyRivers(x: number, z: number, h: number, cell: Cell): number {
  const rl = cell.rivers;
  for (let k = 0; k < rl.length; k++) {
    const r = rivers[rl[k]];
    if (!r.line.inBounds(x, z)) continue;
    const d = r.line.distance(x, z, tmpS);
    const s = tmpS[0];
    const half = mix(r.w0, r.w1, s / r.line.length) * 0.5;
    const edge = half + r.bank;
    if (d >= edge) continue;
    const surf = r.surface.at(s);
    if (d < half) {
      const t = d / half;
      const bed = surf - r.depth * (1 - t * t) - 0.25;
      h = Math.min(h, bed);
    } else {
      const t = sstep(half, edge, d);
      const bankTop = surf + 0.5;
      h = h > bankTop ? mix(bankTop, h, t) : mix(bankTop, h, t * t);
    }
  }
  return h;
}

// ---------------------------------------------------------------------------
// Init: precompute profiles
// ---------------------------------------------------------------------------

function sampleProfile(line: Polyline, spacing: number, fn: (x: number, z: number) => number): Float32Array {
  const n = Math.max(2, Math.ceil(line.length / spacing) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = line.pointAt(i * spacing);
    out[i] = fn(p.x, p.z);
  }
  return out;
}

function smoothProfile(v: Float32Array, radius: number, passes = 2): Float32Array {
  let cur = v;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      let acc = 0, c = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = Math.min(cur.length - 1, Math.max(0, i + k));
        acc += cur[j];
        c++;
      }
      next[i] = acc / c;
    }
    cur = next;
  }
  return cur;
}

/**
 * Turn steep reaches of a monotone (downhill) river profile into a staircase
 * of plunge pools and waterfalls. The result never rises above the input, so
 * the river stays carved into the slope (gorges below each fall).
 */
export function terraceRiverProfile(v: Float32Array, spacing: number, floor = SEA_LEVEL + 0.25): { values: Float32Array; falls: RiverFall[]; slope: Float32Array } {
  const n = v.length;
  const out = new Float32Array(n);
  const slope = new Float32Array(n);
  const falls: RiverFall[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 4), b = Math.min(n - 1, i + 4);
    slope[i] = b > a ? Math.max(0, (v[a] - v[b]) / ((b - a) * spacing)) : 0;
  }
  for (let i = 0; i < n; i++) {
    let target = v[i];
    const sl = slope[i];
    if (sl > 0.085) {
      const step = Math.min(14, Math.max(3.5, sl * 34));
      target = Math.floor((v[i] - floor) / step) * step + floor;
    }
    out[i] = Math.max(floor, i > 0 ? Math.min(out[i - 1], target) : target);
  }
  // Collect falls: drops over a single sample.
  for (let i = 1; i < n; i++) {
    const drop = out[i - 1] - out[i];
    if (drop >= 2.5) falls.push({ s: (i - 1) * spacing, drop });
  }
  return { values: out, falls, slope };
}

export function initHeightfield(): void {
  if (initialized) return;
  initialized = true;

  // Static grid content first (ranges & plateaus) — `pre` below depends on it.
  ranges.forEach((r, i) => addLineFeature((c) => c.ranges, i, r.line, r.width + 2));
  plateaus = PLATEAUS.map((p) => {
    const c = cellAt(p.x, p.z);
    return { x: p.x, z: p.z, r: p.r, blend: p.blend, height: p.height ?? naturalHeight(p.x, p.z, c) };
  });
  plateaus.forEach((p, i) => addDiscFeature((c) => c.plateaus, i, p.x, p.z, p.r + p.blend + 1));
  const pre = (x: number, z: number) => {
    const c = cellAt(x, z);
    return applyPlateaus(x, z, naturalHeight(x, z, c), c);
  };

  trails = TRAILS.map((t) => {
    const line = new Polyline(t.points, t.width + 12);
    const startH = pre(t.points[0].x, t.points[0].z);
    const endH = t.endHeight ?? pre(t.points[t.points.length - 1].x, t.points[t.points.length - 1].z);
    const spacing = 4;
    const n = Math.max(2, Math.ceil(line.length / spacing) + 1);
    const vals = new Float32Array(n);
    for (let i = 0; i < n; i++) vals[i] = mix(startH, endH, Math.min(1, (i * spacing) / line.length));
    return { id: t.id, line, half: t.width / 2, profile: new Profile(spacing, vals) };
  });

  roads = ROADS.map((r) => {
    const line = new Polyline(r.points, r.width + 10);
    const raw = sampleProfile(line, 4, (x, z) => Math.max(SEA_LEVEL + 1.2, pre(x, z)));
    return { id: r.id, line, half: r.width / 2, profile: new Profile(4, smoothProfile(raw, 4, 3)), surface: r.surface };
  });

  lakes = LAKES.map((l) => {
    const natural = pre(l.x, l.z);
    let ring = 0;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ring += pre(l.x + Math.cos(a) * l.r, l.z + Math.sin(a) * l.r);
    }
    ring /= 12;
    const level = l.level ?? Math.max(SEA_LEVEL + 0.6, Math.min(natural, ring) - 0.8);
    return { def: l, level, depth: Math.max(1.5, l.r * 0.06), shore: Math.max(10, l.r * 0.35) };
  });

  rivers = RIVERS.map((r) => {
    const line = new Polyline(r.points, Math.max(r.width[0], r.width[1]) + 40);
    const spacing = 4;
    const raw = sampleProfile(line, spacing, (x, z) => pre(x, z));
    // Monotonic downhill surface: running minimum, offset below banks, settling to sea level at the mouth.
    const surf = new Float32Array(raw.length);
    let run = raw[0] - 1.2;
    for (let i = 0; i < raw.length; i++) {
      run = Math.min(run, raw[i] - 1.2);
      surf[i] = Math.max(SEA_LEVEL + 0.25, run);
    }
    const smooth = smoothProfile(surf, 3, 2);
    // Re-enforce monotonicity after smoothing.
    for (let i = 1; i < smooth.length; i++) smooth[i] = Math.min(smooth[i], smooth[i - 1]);
    // Steep reaches become plunge pools and waterfalls.
    const terr = r.frozen ? { values: smooth, falls: [], slope: new Float32Array(smooth.length) } : terraceRiverProfile(smooth, spacing);
    return {
      id: r.id,
      line,
      w0: r.width[0],
      w1: r.width[1],
      depth: r.depth,
      bank: 10 + Math.max(r.width[0], r.width[1]) * 0.6,
      surface: new Profile(spacing, terr.values),
      frozen: !!r.frozen,
      falls: terr.falls,
      slope: terr.slope,
    };
  });

  // Dynamic grid content.
  trails.forEach((t, i) => addLineFeature((c) => c.trails, i, t.line, t.half + 12));
  roads.forEach((r, i) => addLineFeature((c) => c.roads, i, r.line, r.half + 12));
  lakes.forEach((l, i) => addDiscFeature((c) => c.lakes, i, l.def.x, l.def.z, l.def.r + l.shore + 8));
  rivers.forEach((r, i) => addLineFeature((c) => c.rivers, i, r.line, Math.max(r.w0, r.w1) * 0.5 + r.bank + 12));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Final terrain height at (x, z). */
export function heightAt(x: number, z: number): number {
  if (!initialized) initHeightfield();
  const cell = cellAt(x, z);
  let h = naturalHeight(x, z, cell);
  if (cell.plateaus.length) h = applyPlateaus(x, z, h, cell);
  if (cell.trails.length || cell.roads.length) h = applyTrailsRoads(x, z, h, cell);
  if (cell.lakes.length) h = applyLakes(x, z, h, cell);
  if (cell.rivers.length) h = applyRivers(x, z, h, cell);
  return h;
}

/** Terrain normal via central differences. */
export function normalAt(x: number, z: number, eps = 1, out = { x: 0, y: 1, z: 0 }): { x: number; y: number; z: number } {
  const hx = heightAt(x + eps, z) - heightAt(x - eps, z);
  const hz = heightAt(x, z + eps) - heightAt(x, z - eps);
  const nx = -hx, ny = 2 * eps, nz = -hz;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  out.x = nx / l;
  out.y = ny / l;
  out.z = nz / l;
  return out;
}

export interface WaterHit {
  level: number;
  kind: 'ocean' | 'lake' | 'river' | 'marsh';
  id: string;
  frozen: boolean;
  /** River flow direction (unit XZ) when kind = river. */
  flow?: P2;
}

/**
 * Sea-ice edge field for the polar shelves: positive where the shallow sea is
 * frozen. Irregular floes near the edge and narrow open leads inside the pack.
 * The ice mesh is extracted from exactly this field, so walkable ice matches
 * what is drawn.
 */
export function seaIceField(x: number, z: number, terrainH: number): number {
  const polar = polarSeaFactor(x, z);
  if (polar <= 0) return -1;
  const edgeNoise = 1.5 * noise.noise2(x / 26, z / 26) + 0.7 * noiseB.noise2(x / 9.5, z / 9.5);
  let f = terrainH + 3.2 + edgeNoise - (1 - polar) * 6;
  // Open leads (cracks of dark water) winding through the pack.
  const lead = 1 - Math.abs(noiseD.noise2(x / 150 + 0.4 * noiseC.noise2(x / 70, z / 70), z / 150));
  f -= sstep(0.955, 0.985, lead) * 9;
  return f;
}

/** Water surface at (x,z) if the point is over water (terrain below the surface). */
export function waterAt(x: number, z: number, terrainH = heightAt(x, z)): WaterHit | null {
  if (!initialized) initHeightfield();
  const cell = cellAt(x, z);
  const rl = cell.rivers;
  for (let k = 0; k < rl.length; k++) {
    const r = rivers[rl[k]];
    if (!r.line.inBounds(x, z)) continue;
    const d = r.line.distance(x, z, tmpS);
    const s = tmpS[0];
    const half = mix(r.w0, r.w1, s / r.line.length) * 0.5;
    if (d < half + 1) {
      const level = r.surface.at(s);
      if (terrainH < level) return { level, kind: 'river', id: r.id, frozen: r.frozen, flow: r.line.tangentAt(s) };
    }
  }
  const ll = cell.lakes;
  for (let k = 0; k < ll.length; k++) {
    const l = lakes[ll[k]];
    const dx = x - l.def.x, dz = z - l.def.z;
    if (dx * dx + dz * dz < (l.def.r + 2) * (l.def.r + 2) && terrainH < l.level) {
      return { level: l.level, kind: 'lake', id: l.def.id, frozen: !!l.def.frozen };
    }
  }
  {
    const dx = x - SWAMP.x, dz = z - SWAMP.z;
    const rr = SWAMP.r * 0.85;
    if (dx * dx + dz * dz < rr * rr && terrainH < SWAMP.level) return { level: SWAMP.level, kind: 'marsh', id: 'foggy_swamp', frozen: false };
  }
  if (terrainH < SEA_LEVEL) {
    return { level: SEA_LEVEL, kind: 'ocean', id: 'ocean', frozen: seaIceField(x, z, terrainH) > 0 };
  }
  return null;
}

export interface RiverRuntime {
  id: string;
  line: Polyline;
  width: (s: number) => number;
  surface: (s: number) => number;
  frozen: boolean;
  /** Waterfalls (lip positions & drops). */
  falls: ReadonlyArray<RiverFall>;
  /** Local downhill gradient (m/m) at arc length s — rapids where high. */
  gradient: (s: number) => number;
  /** Profile sample spacing (m). */
  spacing: number;
}

/** Runtime data for renderers (river ribbons, lake discs, road meshes). */
export function getRiverRuntime(): ReadonlyArray<RiverRuntime> {
  if (!initialized) initHeightfield();
  return rivers.map((r) => ({
    id: r.id,
    line: r.line,
    width: (s: number) => mix(r.w0, r.w1, s / r.line.length),
    surface: (s: number) => r.surface.at(s),
    frozen: r.frozen,
    falls: r.falls,
    gradient: (s: number) => {
      const i = Math.max(0, Math.min(r.slope.length - 1, Math.round(s / r.surface.spacing)));
      return r.slope[i];
    },
    spacing: r.surface.spacing,
  }));
}

export function getLakeRuntime(): ReadonlyArray<{ def: LakeDef; level: number }> {
  if (!initialized) initHeightfield();
  return lakes.map((l) => ({ def: l.def, level: l.level }));
}

export function getRoadRuntime(): ReadonlyArray<{ id: string; line: Polyline; half: number; surface: string; height: (s: number) => number }> {
  if (!initialized) initHeightfield();
  return roads.map((r) => ({ id: r.id, line: r.line, half: r.half, surface: r.surface, height: (s: number) => r.profile.at(s) }));
}

export function getTrailRuntime(): ReadonlyArray<{ id: string; line: Polyline; half: number; height: (s: number) => number }> {
  if (!initialized) initHeightfield();
  return trails.map((t) => ({ id: t.id, line: t.line, half: t.half, height: (s: number) => t.profile.at(s) }));
}

export function getPlateauRuntime(): ReadonlyArray<{ x: number; z: number; r: number; blend: number; height: number }> {
  if (!initialized) initHeightfield();
  return plateaus;
}

export const MARSH = SWAMP;

// ---------------------------------------------------------------------------
// Roads & local water (shading, surfaces, vegetation exclusion)
// ---------------------------------------------------------------------------

/** Road surface type codes (shared with the terrain shader). */
export const ROAD_TYPE = { none: 0, dirt: 1, stone: 2, snow: 3, trail: 4 } as const;

export interface RoadInfo {
  /** Signed lateral distance from the centreline (m); |lat| < half means on the road. */
  lat: number;
  half: number;
  type: number;
  /** Arc length along the road. */
  s: number;
}

/** Nearest road or trail whose verge (half + margin) contains (x,z), or null. */
export function roadAt(x: number, z: number, margin = 8, out: RoadInfo = { lat: 99, half: 0, type: 0, s: 0 }): RoadInfo | null {
  if (!initialized) initHeightfield();
  const cell = cellAt(x, z);
  let best = Infinity;
  let found = false;
  const rl = cell.roads;
  for (let k = 0; k < rl.length; k++) {
    const r = roads[rl[k]];
    if (!r.line.inBounds(x, z)) continue;
    const sd = r.line.signedDistance(x, z, tmpS);
    const ad = Math.abs(sd);
    if (ad > r.half + margin) continue;
    // Prefer the road whose edge is closest (junctions keep the wider road on top).
    const score = ad - r.half;
    if (score < best) {
      best = score;
      found = true;
      out.lat = sd;
      out.half = r.half;
      out.s = tmpS[0];
      out.type = r.surface === 'stone' ? ROAD_TYPE.stone : r.surface === 'snow' ? ROAD_TYPE.snow : ROAD_TYPE.dirt;
    }
  }
  const tl = cell.trails;
  for (let k = 0; k < tl.length; k++) {
    const t = trails[tl[k]];
    if (!t.line.inBounds(x, z)) continue;
    const sd = t.line.signedDistance(x, z, tmpS);
    const ad = Math.abs(sd);
    if (ad > t.half + margin) continue;
    const score = ad - t.half;
    if (score < best) {
      best = score;
      found = true;
      out.lat = sd;
      out.half = t.half;
      out.s = tmpS[0];
      out.type = ROAD_TYPE.trail;
    }
  }
  return found ? out : null;
}

/** Water body kinds for shading (shared with shaders). */
export const WATER_KIND = { ocean: 0, river: 1, lake: 2, marsh: 3, hotspring: 4, frozen: 5 } as const;

export interface LocalWater {
  level: number;
  kind: number;
}

/**
 * The water surface that "belongs" to the area around (x,z): the nearby river,
 * lake or marsh, else the sea. Used for wet shorelines and underwater tint.
 */
export function localWaterAt(x: number, z: number, out: LocalWater = { level: 0, kind: 0 }): LocalWater {
  if (!initialized) initHeightfield();
  out.level = SEA_LEVEL;
  out.kind = polarSeaFactor(x, z) > 0.5 ? WATER_KIND.frozen : WATER_KIND.ocean;
  let found = false;
  const cell = cellAt(x, z);
  const rl = cell.rivers;
  for (let k = 0; k < rl.length; k++) {
    const r = rivers[rl[k]];
    if (!r.line.inBounds(x, z)) continue;
    const d = r.line.distance(x, z, tmpS);
    const half = mix(r.w0, r.w1, tmpS[0] / r.line.length) * 0.5;
    if (d > half + r.bank + 6) continue;
    const level = r.surface.at(tmpS[0]);
    if (!found || level > out.level) {
      out.level = level;
      out.kind = r.frozen ? WATER_KIND.frozen : WATER_KIND.river;
      found = true;
    }
  }
  const ll = cell.lakes;
  for (let k = 0; k < ll.length; k++) {
    const l = lakes[ll[k]];
    const dx = x - l.def.x, dz = z - l.def.z;
    const rr = l.def.r + l.shore + 4;
    if (dx * dx + dz * dz > rr * rr) continue;
    if (!found || l.level > out.level) {
      out.level = l.level;
      out.kind = l.def.frozen ? WATER_KIND.frozen : l.def.kind === 'hotspring' ? WATER_KIND.hotspring : WATER_KIND.lake;
      found = true;
    }
  }
  {
    const dx = x - SWAMP.x, dz = z - SWAMP.z;
    if (dx * dx + dz * dz < SWAMP.r * SWAMP.r && (!found || SWAMP.level > out.level)) {
      out.level = SWAMP.level;
      out.kind = WATER_KIND.marsh;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Biomes & surface materials
// ---------------------------------------------------------------------------

export interface BiomeWeights {
  cold: number; // polar / tundra snow cover
  desert: number;
  volcanic: number;
  swamp: number;
  tropical: number;
  boreal: number;
  dry: number; // savanna / dry grass tint
}

export function biomeWeights(x: number, z: number, out?: BiomeWeights): BiomeWeights {
  const n = 60 * noise.noise2(x / 300, z / 300);
  const isle = sstep(260, 160, len2(x + 1800, z + 1800));
  const north = sstep(-900, -1180, z + n) * (1 - isle);
  const southPolar = sstep(1430, 1560, z + n) * sstep(820, 560, Math.abs(x - 220) + n);
  const desert = sstep(DESERT.r + 60, DESERT.r * 0.7, len2(x - DESERT.x, z - DESERT.z) + n);
  const fireD = len2(x - FIRE_ISLAND.x, z - FIRE_ISLAND.z);
  const volcanic = sstep(FIRE_ISLAND.r, FIRE_ISLAND.r * 0.55, fireD + n);
  const ember = sstep(220, 120, len2(x + 1700, z - 1760));
  const kyoshi = sstep(220, 140, len2(x - 1830, z + 420));
  const swamp = sstep(SWAMP.r + 40, SWAMP.r * 0.6, len2(x - SWAMP.x, z - SWAMP.z) + n * 0.5);
  const boreal = sstep(-500, -800, z + n) * (1 - north);
  const dry = clamp01(sstep(300, 650, z + n) * (1 - desert) * (1 - volcanic) + desert * 0.5);
  const o = out ?? ({} as BiomeWeights);
  o.cold = clamp01(north + southPolar);
  o.desert = desert;
  o.volcanic = volcanic;
  o.swamp = swamp;
  o.tropical = clamp01(Math.max(ember, kyoshi * 0.6, volcanic * 0.35));
  o.boreal = boreal;
  o.dry = dry;
  return o;
}

export function biomeAt(x: number, z: number, h = heightAt(x, z)): BiomeId {
  if (h < SEA_LEVEL - 0.5) return 'ocean';
  const b = biomeWeights(x, z);
  if (b.cold > 0.5) return z < 0 && b.cold > 0.85 && z < -1250 ? 'polar' : b.cold > 0.8 ? 'polar' : 'tundra';
  if (b.volcanic > 0.5) return 'volcanic';
  if (b.desert > 0.5) return 'desert';
  if (b.swamp > 0.5) return 'swamp';
  if (b.tropical > 0.5) return 'tropical';
  if (h > 190) return 'alpine';
  if (h < SEA_LEVEL + 2.2) return 'coast';
  if (b.boreal > 0.5) return 'boreal';
  if (b.dry > 0.55) return 'savanna';
  const f = noiseB.noise2(x / 260, z / 260);
  return f > 0.25 ? 'forest' : f < -0.35 ? 'farmland' : 'temperate';
}

/**
 * Forest density 0..1 (tree cover). Shared by vegetation placement and the
 * terrain's forest-floor litter so leaf litter lies where trees actually stand.
 */
export function forestFactor(x: number, z: number, b: BiomeWeights): number {
  const f = noiseB.noise2(x / 260, z / 260);
  const patches = 0.5 + 0.5 * noise.fbm2(x / 95 + 13.1, z / 95 - 7.7, 3);
  let base = sstep(-0.1, 0.45, f) * 0.85 + 0.25 * patches;
  base = mix(base, 0.7 + 0.3 * patches, b.boreal * 0.85);
  base = mix(base, 0.55 + 0.4 * patches, b.swamp);
  base = mix(base, 0.35 * patches, b.dry * 0.8);
  base = mix(base, 0.45 + 0.4 * patches, b.tropical * 0.8);
  base *= 1 - b.desert;
  base *= 1 - 0.75 * b.volcanic;
  base *= 1 - 0.55 * b.cold;
  return clamp01(base);
}

/**
 * Terrain material weights for shading and surface queries.
 * Channels: grass, dirt, rock, sand, snow, ice, ash, mud (sum ~1), plus grass tint.
 */
export interface MaterialSample {
  w: Float32Array; // length 8
  tint: [number, number, number];
}

export const MAT = { grass: 0, dirt: 1, rock: 2, sand: 3, snow: 4, ice: 5, ash: 6, mud: 7 } as const;
/** Extended channel order used by sampleTerrain (adds gravel). */
export const MAT9 = { grass: 0, dirt: 1, rock: 2, sand: 3, snow: 4, ice: 5, ash: 6, mud: 7, gravel: 8 } as const;

const bScratch: BiomeWeights = { cold: 0, desert: 0, volcanic: 0, swamp: 0, tropical: 0, boreal: 0, dry: 0 };
const lwScratch: LocalWater = { level: 0, kind: 0 };

/**
 * Core material evaluation (9 channels incl. gravel). `waterRel` is the height
 * above the local water surface (for riverbank gravel and beaches).
 */
function materials9(x: number, z: number, h: number, slope: number, waterRel: number, w: Float32Array, tint: [number, number, number], b: BiomeWeights): void {
  w.fill(0);
  const n1 = noise.noise2(x / 18, z / 18);
  const n2 = noiseB.noise2(x / 70, z / 70);

  // slope: 0 flat .. 1 vertical (1 - normal.y)
  // Sand holds steep dune faces: in the desert rock only shows on real cliffs.
  const rockSlope = mix(0.22, 0.46, b.desert);
  const rock = clamp01(sstep(rockSlope, rockSlope + 0.2, slope + n1 * 0.05) + sstep(200, 260, h) * 0.5 * (1 - b.cold));
  const beach = sstep(SEA_LEVEL + 2.6, SEA_LEVEL + 0.8, h) * (1 - b.cold) * (1 - b.swamp);
  const snowCap = sstep(250, 310, h + n2 * 20);
  const snow = clamp01(Math.max(b.cold, snowCap) * (1 - rock * 0.75));
  const iceN = b.cold * sstep(SEA_LEVEL + 3.5, SEA_LEVEL + 0.4, h) * 0.9;
  const ash = b.volcanic * (1 - beach) * clamp01(0.55 + n2 * 0.5);
  const sand = clamp01(Math.max(beach, b.desert * (1 - rock)));
  const mud = clamp01(b.swamp * (0.55 + 0.45 * n1));
  const dirt = clamp01((0.18 + 0.3 * sstep(0.2, 0.6, n2) * (1 - b.boreal)) * (1 - b.cold) + b.dry * 0.25);
  // Gravel: riverbanks just above the waterline, scree on moderate mountain slopes.
  const bank = sstep(1.6, 0.3, waterRel) * sstep(-1.5, 0.2, waterRel) * (1 - beach) * (1 - b.swamp);
  const scree = sstep(0.13, 0.2, slope) * sstep(0.32, 0.24, slope) * sstep(55, 110, h) * clamp01(0.4 + n1 * 0.8);
  const gravel = clamp01(Math.max(bank * (0.6 + 0.4 * n1), scree * 0.8)) * (1 - b.desert * 0.8) * (1 - snow * 0.9);

  let grass = 1;
  grass *= 1 - rock;
  grass *= 1 - snow;
  grass *= 1 - sand;
  grass *= 1 - ash * 0.85;
  grass *= 1 - mud * 0.5;
  grass *= 1 - gravel;
  w[0] = Math.max(0, grass) * (1 - dirt * 0.6);
  w[1] = dirt * (1 - snow) * (1 - sand) * (1 - rock);
  w[2] = rock * (1 - snow * 0.6);
  w[3] = sand * (1 - snow);
  w[4] = snow * (1 - iceN);
  w[5] = iceN;
  w[6] = ash * (1 - rock * 0.5) * (1 - sand);
  w[7] = mud * (1 - sand);
  w[8] = gravel * (1 - rock * 0.7);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += w[i];
  if (sum < 1e-4) {
    w[1] = 1;
    sum = 1;
  }
  for (let i = 0; i < 9; i++) w[i] /= sum;

  // Grass tint: lush green -> boreal dark -> dry gold -> tropical vivid -> swamp olive
  let r = 0.37, g = 0.53, bl = 0.22;
  r = mix(r, 0.22, b.boreal); g = mix(g, 0.4, b.boreal); bl = mix(bl, 0.22, b.boreal);
  r = mix(r, 0.6, b.dry * 0.8); g = mix(g, 0.56, b.dry * 0.8); bl = mix(bl, 0.26, b.dry * 0.8);
  r = mix(r, 0.28, b.tropical); g = mix(g, 0.6, b.tropical); bl = mix(bl, 0.16, b.tropical);
  r = mix(r, 0.32, b.swamp); g = mix(g, 0.4, b.swamp); bl = mix(bl, 0.18, b.swamp);
  r = mix(r, 0.36, b.volcanic); g = mix(g, 0.42, b.volcanic); bl = mix(bl, 0.18, b.volcanic);
  const v = 0.9 + 0.2 * n2;
  tint[0] = r * v;
  tint[1] = g * v;
  tint[2] = bl * v;
}

const w9Scratch = new Float32Array(9);

export function materialAt(x: number, z: number, h: number, slope: number, out: MaterialSample): MaterialSample {
  const b = biomeWeights(x, z, bScratch);
  materials9(x, z, h, slope, 99, w9Scratch, out.tint, b);
  const w = out.w;
  for (let i = 0; i < 8; i++) w[i] = w9Scratch[i];
  w[1] += w9Scratch[8]; // gravel folds into dirt for the 8-channel API
  return out;
}

/** Full per-point terrain description for the renderer and surface queries. */
export interface TerrainSample {
  /** 9 weights: grass, dirt, rock, sand, snow, ice, ash, mud, gravel (sum 1). */
  w: Float32Array;
  /** Grass tint (sRGB 0..1). */
  tint: [number, number, number];
  /** Soil/rock tint multiplier (≈1) — volcanic red-browns, desert sandstone, polar blue-greys. */
  soil: [number, number, number];
  /** Forest-floor leaf litter 0..1. */
  litter: number;
  /** Road info (type 0 = none). */
  roadLat: number;
  roadHalf: number;
  roadType: number;
  /** Height above the local water surface (m, clamped ±30) and its kind (WATER_KIND). */
  waterRel: number;
  waterKind: number;
  biome: BiomeWeights;
}

export function createTerrainSample(): TerrainSample {
  return {
    w: new Float32Array(9),
    tint: [0, 0, 0],
    soil: [1, 1, 1],
    litter: 0,
    roadLat: 99,
    roadHalf: 0,
    roadType: 0,
    waterRel: 30,
    waterKind: 0,
    biome: { cold: 0, desert: 0, volcanic: 0, swamp: 0, tropical: 0, boreal: 0, dry: 0 },
  };
}

const roadScratch: RoadInfo = { lat: 99, half: 0, type: 0, s: 0 };

export function sampleTerrain(x: number, z: number, h: number, slope: number, out: TerrainSample, roadMargin = 8): TerrainSample {
  if (!initialized) initHeightfield();
  const b = biomeWeights(x, z, out.biome);
  const lw = localWaterAt(x, z, lwScratch);
  const rel = h - lw.level;
  out.waterRel = rel < -30 ? -30 : rel > 30 ? 30 : rel;
  out.waterKind = lw.kind;
  materials9(x, z, h, slope, rel, out.w, out.tint, b);
  // Soil tint per biome.
  let sr = 1, sg = 1, sb = 1;
  sr = mix(sr, 0.78, b.volcanic); sg = mix(sg, 0.66, b.volcanic); sb = mix(sb, 0.62, b.volcanic);
  sr = mix(sr, 1.14, b.desert); sg = mix(sg, 0.96, b.desert); sb = mix(sb, 0.76, b.desert);
  sr = mix(sr, 0.9, b.cold); sg = mix(sg, 0.96, b.cold); sb = mix(sb, 1.08, b.cold);
  sr = mix(sr, 0.82, b.swamp); sg = mix(sg, 0.84, b.swamp); sb = mix(sb, 0.7, b.swamp);
  sr = mix(sr, 1.06, b.dry * 0.6); sg = mix(sg, 1.0, b.dry * 0.6); sb = mix(sb, 0.88, b.dry * 0.6);
  const alpine = sstep(150, 260, h) * (1 - b.cold);
  sr = mix(sr, 1.08, alpine); sg = mix(sg, 1.04, alpine); sb = mix(sb, 1.0, alpine);
  out.soil[0] = sr; out.soil[1] = sg; out.soil[2] = sb;
  out.litter = forestFactor(x, z, b) * out.w[0] * (1 - b.cold) * (1 - b.desert);
  const road = roadAt(x, z, roadMargin, roadScratch);
  if (road) {
    out.roadLat = road.lat;
    out.roadHalf = road.half;
    out.roadType = road.type === ROAD_TYPE.dirt && b.cold > 0.5 ? ROAD_TYPE.snow : road.type;
  } else if (capitalPaved(x, z, h)) {
    // The Fire Nation capital's streets, plaza, quays and crater floor are paved.
    out.roadLat = 0;
    out.roadHalf = 60;
    out.roadType = ROAD_TYPE.stone;
  } else {
    out.roadLat = 99;
    out.roadHalf = 0;
    out.roadType = 0;
  }
  return out;
}

const SURFACE_BY_MAT9: SurfaceType[] = ['grass', 'dirt', 'rock', 'sand', 'snow', 'ice', 'ash', 'mud', 'gravel'];
const surfScratch = createTerrainSample();
const nScratch = { x: 0, y: 1, z: 0 };

/** Surface for a road type code. */
export function roadSurface(type: number): SurfaceType {
  return type === ROAD_TYPE.stone || type === ROAD_TYPE.trail ? 'stone' : type === ROAD_TYPE.snow ? 'packedsnow' : 'dirt';
}

/**
 * Dominant natural surface at (x,z) (ignores architecture — World adds colliders on top).
 * Optional h / normalY avoid recomputation when the caller already has them.
 */
export function terrainSurfaceAt(x: number, z: number, h?: number, normalY?: number): SurfaceType {
  const th = h ?? heightAt(x, z);
  const water = waterAt(x, z, th);
  if (water) return water.frozen ? 'ice' : 'water';
  const ny = normalY ?? normalAt(x, z, 1, nScratch).y;
  const s = sampleTerrain(x, z, th, 1 - ny, surfScratch);
  if (s.roadType !== 0 && Math.abs(s.roadLat) < s.roadHalf) return roadSurface(s.roadType);
  const w = s.w;
  let best = 0;
  for (let i = 1; i < 9; i++) if (w[i] > w[best]) best = i;
  // Wet riverbanks / shores read as mud underfoot when grassy or dirty.
  if ((best === 0 || best === 1) && s.waterRel < 0.35 && s.waterKind !== WATER_KIND.ocean && s.waterKind !== WATER_KIND.frozen) return 'mud';
  return SURFACE_BY_MAT9[best];
}
