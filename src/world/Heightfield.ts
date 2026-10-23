/**
 * Procedural terrain definition — pure functions over (x, z), no three.js.
 *
 * heightAt(x, z) is THE ground truth used by terrain meshes, collision, AI,
 * vegetation and the map. It must stay deterministic and fast (~2-5 µs).
 *
 * Composition order (see computeHeight):
 *   base land/sea + hills  ->  mountain ranges + special landforms
 *   -> plateaus (city sites) -> trails (explicit-grade paths) -> roads
 *   -> lakes -> rivers
 * Profiles for rivers/roads/trails/lakes are precomputed once at init from
 * the intermediate "natural" height so the final field has no recursion.
 */
import { SimplexNoise } from '../core/Noise';
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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

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
      const l = Math.hypot(b.x - a.x, b.z - a.z);
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
interface RiverRT { id: string; line: Polyline; w0: number; w1: number; depth: number; bank: number; surface: Profile; frozen: boolean }
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
const VOLCANO = { x: -1330, z: 1150, rimR: 235, outerR: 470, rimH: 150, gateAngle: Math.atan2(960 - 1150, -940 + 1330), gateHalf: 0.2 };
const AIR_PEAK = { x: 1450, z: 1250, r: 470, h: 350 };
const OMASHU_MESA = { x: -450, z: -650, r: 150, h: 95 };
const DESERT = { x: 250, z: 950, r: 430 };
const SWAMP = { x: -1150, z: -150, r: 340, level: 0.9 };
const FIRE_ISLAND = { x: -1380, z: 1150, r: 560 };

// ---------------------------------------------------------------------------
// Stage functions
// ---------------------------------------------------------------------------

/** Signed land field in metres (positive = land), with coastline noise. */
export function landField(x: number, z: number): { s: number; lift: number } {
  const wx = x + 70 * noise.noise2(x / 520, z / 520);
  const wz = z + 70 * noise.noise2(x / 520 + 31.7, z / 520 - 12.1);
  let best = -Infinity;
  let liftAcc = 0, wAcc = 0;
  for (const b of LAND_BLOBS) {
    const d = Math.hypot(wx - b.x, wz - b.z);
    const v = b.r - d;
    if (v > best) best = v;
    if (v > -60) {
      const w = Math.max(0, v + 60);
      liftAcc += w * (b.lift ?? 0);
      wAcc += w;
    }
  }
  let s = best;
  for (const sb of SEA_BLOBS) {
    const d = Math.hypot(wx - sb.x, wz - sb.z);
    s = Math.min(s, d - sb.r);
  }
  s += 38 * noise.fbm2(x / 260, z / 260, 3);
  // Map edge always ocean.
  const edge = WORLD_HALF - Math.max(Math.abs(x), Math.abs(z));
  s = Math.min(s, edge - 140);
  return { s, lift: wAcc > 0 ? liftAcc / wAcc : 0 };
}

function baseHeight(x: number, z: number): number {
  const { s, lift } = landField(x, z);
  if (s < 0) {
    // Continental shelf, deepening offshore.
    return SEA_LEVEL - 1.2 + Math.max(-38, s * 0.16) + 1.5 * noiseB.noise2(x / 90, z / 90);
  }
  const inland = sstep(10, 220, s);
  let h = SEA_LEVEL + Math.min(s * 0.09, 2.2) + inland * (2 + lift);
  h += inland * 16 * (0.5 + 0.5 * noise.fbm2(x / 700, z / 700, 4));
  h += inland * 4 * noiseB.fbm2(x / 140, z / 140, 3);
  h += 0.8 * noiseC.noise2(x / 32, z / 32);
  return h;
}

function rangesHeight(x: number, z: number): number {
  let add = 0;
  for (const r of ranges) {
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
  // Fire Nation volcano with caldera and an eastern gate gap.
  {
    const dx = x - VOLCANO.x, dz = z - VOLCANO.z;
    const d = Math.hypot(dx, dz);
    if (d < VOLCANO.outerR) {
      const ang = Math.atan2(dz, dx);
      let da = Math.abs(ang - VOLCANO.gateAngle);
      if (da > Math.PI) da = 2 * Math.PI - da;
      const gate = 1 - sstep(VOLCANO.gateHalf * 0.6, VOLCANO.gateHalf, da);
      const rimNoise = 1 + 0.18 * noise.noise2(Math.cos(ang) * 3, Math.sin(ang) * 3);
      let cone: number;
      if (d > VOLCANO.rimR) {
        const t = 1 - (d - VOLCANO.rimR) / (VOLCANO.outerR - VOLCANO.rimR);
        cone = VOLCANO.rimH * rimNoise * Math.pow(Math.max(0, t), 1.6);
      } else {
        const t = d / VOLCANO.rimR;
        cone = mix(40, VOLCANO.rimH * rimNoise, Math.pow(t, 3.2));
      }
      cone = mix(cone, Math.min(cone, 44), gate * sstep(VOLCANO.outerR * 0.9, VOLCANO.rimR * 0.7, d));
      h = Math.max(h, cone + 3 * noiseB.noise2(x / 25, z / 25));
    }
  }
  // Air temple peak: a steep massif with noisy, ridged flanks (not a perfect cone).
  {
    const dx = x - AIR_PEAK.x, dz = z - AIR_PEAK.z;
    const ang = Math.atan2(dz, dx);
    const warp = 1 + 0.32 * noise.noise2(Math.cos(ang) * 1.7 + 4.1, Math.sin(ang) * 1.7 - 2.3) + 0.12 * noiseB.noise2(x / 90, z / 90);
    const d = Math.hypot(dx, dz) / warp;
    if (d < AIR_PEAK.r) {
      const t = 1 - d / AIR_PEAK.r;
      const ridges = 0.7 + 0.45 * noise.ridged2(x / 140, z / 140, 5);
      const peak = AIR_PEAK.h * Math.pow(t, 1.55) * mix(ridges, 1, sstep(0.75, 0.95, t));
      h = Math.max(h, peak);
    }
  }
  // Omashu mesa: steep-sided plateau.
  {
    const d = Math.hypot(x - OMASHU_MESA.x, z - OMASHU_MESA.z);
    if (d < OMASHU_MESA.r * 1.8) {
      const t = 1 - sstep(OMASHU_MESA.r * 0.8, OMASHU_MESA.r * 1.8, d);
      h = Math.max(h, OMASHU_MESA.h * t + 4 * noise.noise2(x / 30, z / 30) * t);
    }
  }
  // Desert dunes.
  {
    const d = Math.hypot(x - DESERT.x, z - DESERT.z);
    if (d < DESERT.r) {
      const w = sstep(DESERT.r, DESERT.r * 0.6, d);
      const p = (x * 0.8 + z * 0.6) / 38 + 2.5 * noise.noise2(x / 300, z / 300);
      const dune = Math.pow(0.5 + 0.5 * Math.sin(p), 2.2) * (5 + 4 * noiseB.noise2(x / 200, z / 200));
      h += w * dune;
    }
  }
  // Swamp: flatten toward water level with pools.
  {
    const d = Math.hypot(x - SWAMP.x, z - SWAMP.z);
    if (d < SWAMP.r) {
      const w = sstep(SWAMP.r, SWAMP.r * 0.55, d);
      // Hummocks and pools: roughly 40% of the inner swamp sits below the marsh water level.
      const target = SWAMP.level + 0.25 + 1.3 * noise.fbm2(x / 38, z / 38, 3) + 0.4 * noiseB.noise2(x / 9, z / 9);
      h = mix(h, target, w);
    }
  }
  return h;
}

/** Height before plateaus/trails/roads/lakes/rivers. */
function naturalHeight(x: number, z: number): number {
  let h = baseHeight(x, z);
  if (h > SEA_LEVEL - 4) h += rangesHeight(x, z);
  h = specialLandforms(x, z, h);
  return h;
}

function applyPlateaus(x: number, z: number, h: number): number {
  for (const p of plateaus) {
    const dx = x - p.x, dz = z - p.z;
    const outer = p.r + p.blend;
    if (dx * dx + dz * dz > outer * outer) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    const w = 1 - sstep(p.r, outer, d);
    h = mix(h, p.height, w);
  }
  return h;
}

function applyTrailsRoads(x: number, z: number, h: number): number {
  for (const t of trails) {
    if (!t.line.inBounds(x, z)) continue;
    const d = t.line.distance(x, z, tmpS);
    const edge = t.half + 10;
    if (d >= edge) continue;
    const y = t.profile.at(tmpS[0]);
    const w = 1 - sstep(t.half, edge, d);
    h = mix(h, y, w);
  }
  for (const r of roads) {
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

function applyLakes(x: number, z: number, h: number): number {
  for (const l of lakes) {
    const dx = x - l.def.x, dz = z - l.def.z;
    const outer = l.def.r + l.shore;
    if (dx * dx + dz * dz > outer * outer) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
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

function applyRivers(x: number, z: number, h: number): number {
  for (const r of rivers) {
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

export function initHeightfield(): void {
  if (initialized) return;
  initialized = true;

  plateaus = PLATEAUS.map((p) => ({ x: p.x, z: p.z, r: p.r, blend: p.blend, height: p.height ?? naturalHeight(p.x, p.z) }));
  const pre = (x: number, z: number) => applyPlateaus(x, z, naturalHeight(x, z));

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
    return {
      id: r.id,
      line,
      w0: r.width[0],
      w1: r.width[1],
      depth: r.depth,
      bank: 10 + Math.max(r.width[0], r.width[1]) * 0.6,
      surface: new Profile(spacing, smooth),
      frozen: !!r.frozen,
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Final terrain height at (x, z). */
export function heightAt(x: number, z: number): number {
  if (!initialized) initHeightfield();
  let h = naturalHeight(x, z);
  h = applyPlateaus(x, z, h);
  h = applyTrailsRoads(x, z, h);
  h = applyLakes(x, z, h);
  h = applyRivers(x, z, h);
  return h;
}

/** Terrain normal via central differences. */
export function normalAt(x: number, z: number, eps = 1, out = { x: 0, y: 1, z: 0 }): { x: number; y: number; z: number } {
  const hx = heightAt(x + eps, z) - heightAt(x - eps, z);
  const hz = heightAt(x, z + eps) - heightAt(x, z - eps);
  const nx = -hx, ny = 2 * eps, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
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

/** Water surface at (x,z) if the point is over water (terrain below the surface). */
export function waterAt(x: number, z: number, terrainH = heightAt(x, z)): WaterHit | null {
  if (!initialized) initHeightfield();
  for (const r of rivers) {
    if (!r.line.inBounds(x, z)) continue;
    const d = r.line.distance(x, z, tmpS);
    const s = tmpS[0];
    const half = mix(r.w0, r.w1, s / r.line.length) * 0.5;
    if (d < half + 1) {
      const level = r.surface.at(s);
      if (terrainH < level) return { level, kind: 'river', id: r.id, frozen: r.frozen, flow: r.line.tangentAt(s) };
    }
  }
  for (const l of lakes) {
    const dx = x - l.def.x, dz = z - l.def.z;
    if (dx * dx + dz * dz < (l.def.r + 2) * (l.def.r + 2) && terrainH < l.level) {
      return { level: l.level, kind: 'lake', id: l.def.id, frozen: !!l.def.frozen };
    }
  }
  {
    const d = Math.hypot(x - SWAMP.x, z - SWAMP.z);
    if (d < SWAMP.r * 0.85 && terrainH < SWAMP.level) return { level: SWAMP.level, kind: 'marsh', id: 'foggy_swamp', frozen: false };
  }
  if (terrainH < SEA_LEVEL) {
    const polar = z < -1150 || (z > 1500 && x > -250 && x < 700);
    return { level: SEA_LEVEL, kind: 'ocean', id: 'ocean', frozen: polar && terrainH > -3 };
  }
  return null;
}

/** Runtime data for renderers (river ribbons, lake discs, road meshes). */
export function getRiverRuntime(): ReadonlyArray<{ id: string; line: Polyline; width: (s: number) => number; surface: (s: number) => number; frozen: boolean }> {
  if (!initialized) initHeightfield();
  return rivers.map((r) => ({
    id: r.id,
    line: r.line,
    width: (s: number) => mix(r.w0, r.w1, s / r.line.length),
    surface: (s: number) => r.surface.at(s),
    frozen: r.frozen,
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

export const MARSH = SWAMP;

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

export function biomeWeights(x: number, z: number): BiomeWeights {
  const n = 60 * noise.noise2(x / 300, z / 300);
  const isle = sstep(260, 160, Math.hypot(x + 1800, z + 1800));
  const north = sstep(-900, -1180, z + n) * (1 - isle);
  const southPolar = sstep(1430, 1560, z + n) * sstep(820, 560, Math.abs(x - 220) + n);
  const desert = sstep(DESERT.r + 60, DESERT.r * 0.7, Math.hypot(x - DESERT.x, z - DESERT.z) + n);
  const fireD = Math.hypot(x - FIRE_ISLAND.x, z - FIRE_ISLAND.z);
  const volcanic = sstep(FIRE_ISLAND.r, FIRE_ISLAND.r * 0.55, fireD + n);
  const ember = sstep(220, 120, Math.hypot(x + 1700, z - 1760));
  const kyoshi = sstep(220, 140, Math.hypot(x - 1830, z + 420));
  const swamp = sstep(SWAMP.r + 40, SWAMP.r * 0.6, Math.hypot(x - SWAMP.x, z - SWAMP.z) + n * 0.5);
  const boreal = sstep(-500, -800, z + n) * (1 - north);
  const dry = clamp01(sstep(300, 650, z + n) * (1 - desert) * (1 - volcanic) + desert * 0.5);
  return {
    cold: clamp01(north + southPolar),
    desert,
    volcanic,
    swamp,
    tropical: clamp01(Math.max(ember, kyoshi * 0.6, volcanic * 0.35)),
    boreal,
    dry,
  };
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
 * Terrain material weights for shading and surface queries.
 * Channels: grass, dirt, rock, sand, snow, ice, ash, mud (sum ~1), plus grass tint.
 */
export interface MaterialSample {
  w: Float32Array; // length 8
  tint: [number, number, number];
}

export const MAT = { grass: 0, dirt: 1, rock: 2, sand: 3, snow: 4, ice: 5, ash: 6, mud: 7 } as const;

export function materialAt(x: number, z: number, h: number, slope: number, out: MaterialSample): MaterialSample {
  const w = out.w;
  w.fill(0);
  const b = biomeWeights(x, z);
  const n1 = noise.noise2(x / 18, z / 18);
  const n2 = noiseB.noise2(x / 70, z / 70);

  // slope: 0 flat .. 1 vertical (1 - normal.y)
  const rock = clamp01(sstep(0.22, 0.42, slope + n1 * 0.05) + sstep(200, 260, h) * 0.5 * (1 - b.cold));
  const beach = sstep(SEA_LEVEL + 2.6, SEA_LEVEL + 0.8, h) * (1 - b.cold) * (1 - b.swamp);
  const snowCap = sstep(250, 310, h + n2 * 20);
  const snow = clamp01(Math.max(b.cold, snowCap) * (1 - rock * 0.75));
  const iceN = b.cold * sstep(SEA_LEVEL + 3.5, SEA_LEVEL + 0.4, h) * 0.9;
  const ash = b.volcanic * (1 - beach) * clamp01(0.55 + n2 * 0.5);
  const sand = clamp01(Math.max(beach, b.desert * (1 - rock)));
  const mud = clamp01(b.swamp * (0.55 + 0.45 * n1));
  const dirt = clamp01((0.18 + 0.3 * sstep(0.2, 0.6, n2) * (1 - b.boreal)) * (1 - b.cold) + b.dry * 0.25);

  let grass = 1;
  grass *= 1 - rock;
  grass *= 1 - snow;
  grass *= 1 - sand;
  grass *= 1 - ash * 0.85;
  grass *= 1 - mud * 0.5;
  w[MAT.grass] = Math.max(0, grass) * (1 - dirt * 0.6);
  w[MAT.dirt] = dirt * (1 - snow) * (1 - sand) * (1 - rock);
  w[MAT.rock] = rock * (1 - snow * 0.6);
  w[MAT.sand] = sand * (1 - snow);
  w[MAT.snow] = snow * (1 - iceN);
  w[MAT.ice] = iceN;
  w[MAT.ash] = ash * (1 - rock * 0.5) * (1 - sand);
  w[MAT.mud] = mud * (1 - sand);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += w[i];
  if (sum < 1e-4) {
    w[MAT.dirt] = 1;
    sum = 1;
  }
  for (let i = 0; i < 8; i++) w[i] /= sum;

  // Grass tint: lush green -> boreal dark -> dry gold -> tropical vivid -> swamp olive
  let r = 0.33, g = 0.52, bl = 0.2;
  r = mix(r, 0.22, b.boreal); g = mix(g, 0.4, b.boreal); bl = mix(bl, 0.22, b.boreal);
  r = mix(r, 0.6, b.dry * 0.8); g = mix(g, 0.56, b.dry * 0.8); bl = mix(bl, 0.26, b.dry * 0.8);
  r = mix(r, 0.28, b.tropical); g = mix(g, 0.6, b.tropical); bl = mix(bl, 0.16, b.tropical);
  r = mix(r, 0.32, b.swamp); g = mix(g, 0.4, b.swamp); bl = mix(bl, 0.18, b.swamp);
  r = mix(r, 0.36, b.volcanic); g = mix(g, 0.42, b.volcanic); bl = mix(bl, 0.18, b.volcanic);
  const v = 0.9 + 0.2 * n2;
  out.tint[0] = r * v;
  out.tint[1] = g * v;
  out.tint[2] = bl * v;
  return out;
}

const SURFACE_BY_MAT: SurfaceType[] = ['grass', 'dirt', 'rock', 'sand', 'snow', 'ice', 'ash', 'mud'];
const scratch: MaterialSample = { w: new Float32Array(8), tint: [0, 0, 0] };

/** Dominant natural surface at (x,z) (ignores architecture — World adds colliders on top). */
export function terrainSurfaceAt(x: number, z: number): SurfaceType {
  const h = heightAt(x, z);
  const water = waterAt(x, z, h);
  if (water) return water.frozen ? 'ice' : 'water';
  for (const r of roads) {
    if (!r.line.inBounds(x, z)) continue;
    if (r.line.distance(x, z) < r.half) return r.surface === 'stone' ? 'stone' : r.surface === 'snow' ? 'packedsnow' : 'dirt';
  }
  const n = normalAt(x, z, 1);
  materialAt(x, z, h, 1 - n.y, scratch);
  let best = 0;
  for (let i = 1; i < 8; i++) if (scratch.w[i] > scratch.w[best]) best = i;
  return SURFACE_BY_MAT[best];
}
