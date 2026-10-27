import { SimplexNoise } from '../../core/Noise';
import { Random } from '../../core/Random';
import {
  biomeWeights,
  createTerrainSample,
  forestFactor,
  getPlateauRuntime,
  heightAt,
  LANDFORMS,
  localWaterAt,
  normalAt,
  sampleTerrain,
  WATER_KIND,
  type BiomeWeights,
  type LocalWater,
  type TerrainSample,
} from '../Heightfield';
import { SPECIES, SPECIES_IDS, type SpeciesCategory, type SpeciesId } from './VegetationModels';
import { waterTribeAt } from '../WorldLayout';

/**
 * Deterministic vegetation placement (pure: no three.js scene state).
 *
 * The world is split into 64 m cells (the terrain chunk grid). Each cell gets
 * jittered candidate grids per layer (trees 7 m, bushes 5 m, rocks 10 m, small
 * plants 3 m). A candidate is kept with a probability from the biome / forest
 * cover; every kept instance stores `k = rank / probability`, so a renderer
 * shows exactly the instances with `k < foliageDensity` — density changes are
 * live and never reshuffle the forest.
 *
 * Exclusions: roads (+ margin), rivers / lakes / sea (mangroves and reeds may
 * stand in shallow marsh water), steep cliffs, bare rock, city plateaus and any
 * extra clear circles (training grounds, camps).
 */

export const VEG_CELL = 64;
/** Highest density multiplier a renderer may ask for (settings allow up to 1.3). */
export const VEG_MAX_DENSITY = 1.5;

/** Floats per instance: x, y, z, yaw, sXZ, sY, tintR, tintG, tintB, k. */
export const VEG_STRIDE = 10;

export interface VegCircle {
  x: number;
  z: number;
  r: number;
}

export interface VegCellData {
  cx: number;
  cz: number;
  count: number;
  /** Species index into SPECIES_IDS per instance. */
  species: Uint8Array;
  /** VEG_STRIDE floats per instance. */
  data: Float32Array;
}

export const SPECIES_INDEX: Record<SpeciesId, number> = Object.fromEntries(SPECIES_IDS.map((id, i) => [id, i])) as Record<SpeciesId, number>;
export const SPECIES_CATEGORY: SpeciesCategory[] = SPECIES_IDS.map((id) => SPECIES[id].category);

const vegNoise = new SimplexNoise(8086);

function hashCell(cx: number, cz: number, layer: number): number {
  let h = Math.imul(cx | 0, 0x27d4eb2d) ^ Math.imul(cz | 0, 0x165667b1) ^ Math.imul(layer + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const sstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Growable instance buffer used while generating a cell. */
class InstanceSink {
  species: number[] = [];
  data: number[] = [];
  push(sp: number, x: number, y: number, z: number, yaw: number, sxz: number, sy: number, r: number, g: number, b: number, k: number): void {
    this.species.push(sp);
    this.data.push(x, y, z, yaw, sxz, sy, r, g, b, k);
  }
  finish(cx: number, cz: number): VegCellData {
    return { cx, cz, count: this.species.length, species: Uint8Array.from(this.species), data: Float32Array.from(this.data) };
  }
}

/** True when (x,z) lies on a city plateau or inside an extra exclusion circle. */
export function vegetationBlockedAt(x: number, z: number, extra: readonly VegCircle[], margin = 0): boolean {
  const plats = getPlateauRuntime();
  for (let i = 0; i < plats.length; i++) {
    const p = plats[i];
    const r = p.r + p.blend * 0.35 + margin;
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  for (let i = 0; i < extra.length; i++) {
    const c = extra[i];
    const r = c.r + margin;
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/** True when the terrain sample lies on (or within `margin` m of) a road or trail. */
export function onRoad(s: TerrainSample, margin: number): boolean {
  return s.roadType !== 0 && Math.abs(s.roadLat) < s.roadHalf + margin;
}

// Reference lush grass tint (matches Heightfield materials9 default) for leaf tint ratios.
const REF_TINT = [0.37, 0.53, 0.22];

function leafTint(s: TerrainSample, rng: Random, out: number[]): number[] {
  const v = rng.range(0.9, 1.1);
  for (let i = 0; i < 3; i++) {
    const ratio = Math.min(1.35, Math.max(0.7, s.tint[i] / REF_TINT[i]));
    out[i] = Math.sqrt(ratio) * v * rng.range(0.95, 1.05);
  }
  return out;
}

type Weighted = Array<[SpeciesId, number]>;

function pickWeighted(rng: Random, list: Weighted): SpeciesId | null {
  let total = 0;
  for (const [, w] of list) total += Math.max(0, w);
  if (total <= 1e-6) return null;
  let r = rng.next() * total;
  for (const [id, w] of list) {
    r -= Math.max(0, w);
    if (r <= 0) return id;
  }
  return list[list.length - 1][0];
}

/** Earth Kingdom heartland mask (bamboo groves and flowering trees). */
function earthKingdom(x: number, z: number): number {
  return sstep(1200, 900, Math.hypot(x - 250, z + 50));
}

/** 0..1 how deep (x,z) is inside the volcano's cone (charred flanks). */
export function volcanoFlank(x: number, z: number): number {
  const v = LANDFORMS.VOLCANO;
  return sstep(v.outerR, v.outerR * 0.75, Math.hypot(x - v.x, z - v.z));
}

/** Tree cover probability (before the density multiplier). */
export function treeProbability(x: number, z: number, b: BiomeWeights): number {
  const f = forestFactor(x, z, b);
  const flank = volcanoFlank(x, z);
  let p = f * 0.92;
  p = p * (1 - b.cold) + b.cold * (0.06 + 0.3 * f);
  p = p * (1 - b.swamp) + b.swamp * (0.45 + 0.45 * f);
  p = p * (1 - b.volcanic) + b.volcanic * (0.04 + 0.12 * f);
  p *= 1 - 0.97 * b.desert;
  p = p * (1 - flank) + flank * (0.03 + 0.08 * f);
  return Math.min(1, Math.max(0, p));
}

function treeSpecies(rng: Random, x: number, z: number, h: number, b: BiomeWeights, s: TerrainSample): SpeciesId | null {
  const snowW = s.w[4] + s.w[5];
  const sandW = s.w[3];
  const ashW = s.w[6];
  const ek = earthKingdom(x, z);
  const grove = vegNoise.noise2(x / 140 + 7.3, z / 140 - 2.1);
  const temperate = (1 - b.cold) * (1 - b.boreal) * (1 - b.dry) * (1 - b.tropical) * (1 - b.swamp) * (1 - b.volcanic) * (1 - b.desert);
  if (snowW > 0.25 || b.cold > 0.35) return pickWeighted(rng, [['pine_snow', 1], ['deadtree', 0.04]]);
  if (volcanoFlank(x, z) > 0.3) return 'deadtree';
  if (b.volcanic > 0.5 || ashW > 0.4) return pickWeighted(rng, [['deadtree', 1], ['palm', b.tropical * 0.15 * sandW]]);
  if (b.swamp > 0.5) return pickWeighted(rng, [['mangrove', 0.6], ['banyan', 0.3], ['deadtree', 0.04]]);
  if (sandW > 0.45) {
    // Beaches and oases: palms in the warm south / tropics, nothing on cold beaches.
    if (b.cold > 0.2) return null;
    return b.tropical > 0.2 || z > 300 || b.desert > 0.3 ? 'palm' : null;
  }
  const w: Weighted = [
    ['broadleaf', 0.55 * temperate + 0.2 * b.tropical + 0.12 * b.boreal + 0.15 * b.dry],
    ['conifer', 0.16 * temperate + 0.85 * b.boreal + 0.6 * sstep(140, 230, h) * (1 - b.tropical)],
    ['pine_snow', sstep(230, 290, h) * 0.9],
    ['blossom', (0.05 + 0.12 * ek) * temperate * (grove < -0.35 ? 3 : 1)],
    ['bamboo', 0.22 * ek * temperate * (grove > 0.35 ? 4 : 0.15) + 0.12 * b.tropical],
    ['acacia', 0.85 * b.dry * (1 - b.boreal)],
    ['palm', 0.7 * b.tropical],
    ['deadtree', 0.02 + 0.05 * b.dry * b.desert],
  ];
  return pickWeighted(rng, w);
}

/** Per-layer candidate spacing (m). */
const SPACING = { tree: 7, bush: 5, rock: 10, small: 3 } as const;

const tint3 = [1, 1, 1];
const nrm = { x: 0, y: 1, z: 0 };
const lwSmall: LocalWater = { level: 0, kind: 0 };

/**
 * Generate the trees and rocks of one cell (visible far away). Yields
 * periodically so the caller can time-slice; `generateCellSync` runs to the end.
 */
export function* generateCellMain(cx: number, cz: number, exclusions: readonly VegCircle[]): Generator<void, VegCellData, void> {
  const sink = new InstanceSink();
  const s = createTerrainSample();
  const b: BiomeWeights = { cold: 0, desert: 0, volcanic: 0, swamp: 0, tropical: 0, boreal: 0, dry: 0 };
  const x0 = cx * VEG_CELL, z0 = cz * VEG_CELL;
  let work = 0;

  // ---- Trees -------------------------------------------------------------------
  {
    const rng = new Random(hashCell(cx, cz, 1));
    const sp = SPACING.tree;
    const n = Math.round(VEG_CELL / sp);
    const step = VEG_CELL / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5 + rng.range(-0.42, 0.42)) * step;
        const z = z0 + (j + 0.5 + rng.range(-0.42, 0.42)) * step;
        const rank = rng.next();
        const yawR = rng.next(), scaleR = rng.next();
        biomeWeights(x, z, b);
        const p = treeProbability(x, z, b);
        const k = rank / Math.max(p, 1e-4);
        if (k >= VEG_MAX_DENSITY) continue;
        if (vegetationBlockedAt(x, z, exclusions, 4)) continue;
        work++;
        const h = heightAt(x, z);
        const n1 = normalAt(x, z, 1.5, nrm);
        if (n1.y < 0.86) continue;
        const slope = 1 - n1.y;
        sampleTerrain(x, z, h, slope, s);
        if (onRoad(s, 3.2)) continue;
        if (s.w[2] > 0.45) continue;
        let id = treeSpecies(rng, x, z, h, b, s);
        if (!id) continue;
        const marsh = s.waterKind === WATER_KIND.marsh;
        if (s.waterRel < 0.7) {
          // In or right next to water: only mangroves wade into the marsh shallows.
          if (marsh && s.waterRel > -0.7) id = 'mangrove';
          else continue;
        }
        leafTint(s, rng, tint3);
        let sc = 0.78 + scaleR * 0.5;
        if (id === 'banyan') sc = 1.0 + scaleR * 0.5;
        if (id === 'palm') sc = 0.85 + scaleR * 0.4;
        if (id === 'deadtree') {
          // Charred trees on volcanic slopes.
          if (b.volcanic > 0.4) { tint3[0] = 0.55; tint3[1] = 0.5; tint3[2] = 0.48; }
        }
        const sink0 = 0.12 + slope * 3;
        sink.push(SPECIES_INDEX[id], x, h - sink0, z, yawR * Math.PI * 2, sc, sc * (0.92 + rng.next() * 0.16), tint3[0], tint3[1], tint3[2], k);
        if ((work & 15) === 0) yield;
      }
      yield;
    }
  }

  // ---- Rocks and boulders -------------------------------------------------------------
  {
    const rng = new Random(hashCell(cx, cz, 3));
    const sp = SPACING.rock;
    const n = Math.round(VEG_CELL / sp);
    const step = VEG_CELL / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5 + rng.range(-0.45, 0.45)) * step;
        const z = z0 + (j + 0.5 + rng.range(-0.45, 0.45)) * step;
        const rank = rng.next();
        const yawR = rng.next(), scaleR = rng.next(), bigR = rng.next();
        if (vegetationBlockedAt(x, z, exclusions, 3)) continue;
        biomeWeights(x, z, b);
        const h = heightAt(x, z);
        const n1 = normalAt(x, z, 1.5, nrm);
        const slope = 1 - n1.y;
        work++;
        let p = 0.025 + 0.35 * sstep(0.08, 0.35, slope) + 0.05 * b.desert + 0.08 * b.volcanic + 0.04 * b.cold + 0.06 * sstep(120, 220, h);
        p *= 1 - 0.7 * b.swamp;
        const k = rank / Math.max(p, 1e-4);
        if (k >= VEG_MAX_DENSITY) continue;
        if (n1.y < 0.55) continue;
        sampleTerrain(x, z, h, slope, s);
        if (onRoad(s, 1.2)) continue;
        if (s.waterRel < -0.5) continue;
        const big = bigR < 0.12 + 0.15 * sstep(0.1, 0.3, slope);
        const sc = big ? 1.7 + scaleR * 1.6 : 0.35 + scaleR * 0.9;
        // Rock colour follows the soil tint (red-brown volcanic, sandstone desert, cool polar).
        tint3[0] = s.soil[0] * (0.92 + rng.next() * 0.16);
        tint3[1] = s.soil[1] * (0.92 + rng.next() * 0.16);
        tint3[2] = s.soil[2] * (0.92 + rng.next() * 0.16);
        if (b.volcanic > 0.5) { tint3[0] *= 0.62; tint3[1] *= 0.58; tint3[2] *= 0.58; }
        // The Water Tribes' boulders are ice (their own white-blue colours, untinted).
        const ice = waterTribeAt(x, z);
        if (ice) tint3[0] = tint3[1] = tint3[2] = 1;
        sink.push(ice ? SPECIES_INDEX.ice_rock : SPECIES_INDEX.rock, x, h - 0.1 - slope * 1.6 * sc, z, yawR * Math.PI * 2, sc, sc * (0.6 + rng.next() * 0.6), tint3[0], tint3[1], tint3[2], k);
        if ((work & 31) === 0) yield;
      }
    }
  }
  return sink.finish(cx, cz);
}

/** Bushes, dry shrubs and ferns of one cell (only needed within ~250 m). */
export function* generateCellBushes(cx: number, cz: number, exclusions: readonly VegCircle[]): Generator<void, VegCellData, void> {
  const sink = new InstanceSink();
  const s = createTerrainSample();
  const b: BiomeWeights = { cold: 0, desert: 0, volcanic: 0, swamp: 0, tropical: 0, boreal: 0, dry: 0 };
  const x0 = cx * VEG_CELL, z0 = cz * VEG_CELL;
  let work = 0;
  // ---- Bushes, shrubs and ferns ---------------------------------------------------
  {
    const rng = new Random(hashCell(cx, cz, 2));
    const sp = SPACING.bush;
    const n = Math.round(VEG_CELL / sp);
    const step = VEG_CELL / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5 + rng.range(-0.45, 0.45)) * step;
        const z = z0 + (j + 0.5 + rng.range(-0.45, 0.45)) * step;
        const rank = rng.next();
        const yawR = rng.next(), scaleR = rng.next();
        biomeWeights(x, z, b);
        const f = forestFactor(x, z, b);
        const meadow = 0.5 + 0.5 * vegNoise.noise2(x / 60, z / 60);
        let p = 0.05 + 0.22 * f + 0.1 * meadow;
        p = p * (1 - b.desert) + b.desert * 0.035;
        p = p * (1 - b.cold) + b.cold * 0.07;
        p = p * (1 - b.volcanic) + b.volcanic * 0.04;
        p = p * (1 - b.dry) + b.dry * (0.12 + 0.12 * meadow);
        const k = rank / Math.max(p, 1e-4);
        if (k >= VEG_MAX_DENSITY) continue;
        if (vegetationBlockedAt(x, z, exclusions, 2)) continue;
        work++;
        const h = heightAt(x, z);
        const n1 = normalAt(x, z, 1, nrm);
        if (n1.y < 0.78) continue;
        sampleTerrain(x, z, h, 1 - n1.y, s);
        if (onRoad(s, 1.4)) continue;
        if (s.waterRel < 0.35) continue;
        if (s.w[2] > 0.55) continue;
        const snowW = s.w[4] + s.w[5];
        let id: SpeciesId;
        if (snowW > 0.25 || b.cold > 0.35) id = 'bush_snow';
        else if (b.desert > 0.4 || b.dry > 0.55 || b.volcanic > 0.5 || s.w[3] > 0.5) {
          if (s.w[3] > 0.5 && b.desert < 0.3 && b.dry < 0.3) continue; // no shrubs on beaches
          id = 'shrub_dry';
        } else id = f > 0.55 && rng.next() < 0.35 ? 'fern' : 'bush';
        leafTint(s, rng, tint3);
        if (id === 'shrub_dry' && b.volcanic > 0.5) { tint3[0] *= 0.7; tint3[1] *= 0.62; tint3[2] *= 0.58; }
        const sc = id === 'fern' ? 1.1 + scaleR * 0.8 : 0.65 + scaleR * 0.75;
        sink.push(SPECIES_INDEX[id], x, h - 0.08, z, yawR * Math.PI * 2, sc, sc * (0.85 + rng.next() * 0.3), tint3[0], tint3[1], tint3[2], k);
        if ((work & 31) === 0) yield;
      }
    }
    yield;
  }

  return sink.finish(cx, cz);
}

/**
 * Small plants of one cell (flowers in meadows, reeds along water, ferns on the
 * forest floor). Only generated for cells near the camera.
 */
export function* generateCellSmall(cx: number, cz: number, exclusions: readonly VegCircle[]): Generator<void, VegCellData, void> {
  const sink = new InstanceSink();
  const s = createTerrainSample();
  const b: BiomeWeights = { cold: 0, desert: 0, volcanic: 0, swamp: 0, tropical: 0, boreal: 0, dry: 0 };
  const x0 = cx * VEG_CELL, z0 = cz * VEG_CELL;
  const rng = new Random(hashCell(cx, cz, 4));
  const sp = SPACING.small;
  const n = Math.round(VEG_CELL / sp);
  const step = VEG_CELL / n;
  let work = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5 + rng.range(-0.45, 0.45)) * step;
      const z = z0 + (j + 0.5 + rng.range(-0.45, 0.45)) * step;
      const rank = rng.next();
      const yawR = rng.next(), scaleR = rng.next(), pickR = rng.next();
      biomeWeights(x, z, b);
      if (b.desert > 0.5 || b.cold > 0.6) continue;
      const f = forestFactor(x, z, b);
      const meadow = sstep(0.1, 0.7, vegNoise.noise2(x / 45 + 3.3, z / 45 + 1.7));
      // Cheap upper bound before the expensive terrain sample: reeds need inland
      // water nearby, ferns need forest, flowers need open meadow.
      const lw = localWaterAt(x, z, lwSmall);
      const inland = lw.kind === WATER_KIND.river || lw.kind === WATER_KIND.lake || lw.kind === WATER_KIND.marsh;
      const pFern = f > 0.5 && b.dry < 0.5 ? 0.22 * f : 0;
      const pFlower = b.volcanic < 0.4 && b.boreal < 0.6 ? (0.03 + 0.3 * meadow) * (1 - f) * (1 - b.dry * 0.6) * (1 - b.swamp * 0.7) : 0;
      const pMax = Math.max(inland ? 0.6 : 0, pFern, pFlower);
      if (rank / Math.max(pMax, 1e-4) >= VEG_MAX_DENSITY) continue;
      if (vegetationBlockedAt(x, z, exclusions, 1)) continue;
      work++;
      const h = heightAt(x, z);
      if (inland && h - lw.level > 1.1 && pFern === 0 && pFlower === 0) continue;
      const n1 = normalAt(x, z, 1, nrm);
      if (n1.y < 0.82) continue;
      sampleTerrain(x, z, h, 1 - n1.y, s);
      if (onRoad(s, 0.8)) continue;
      let id: SpeciesId | null = null;
      let p = 0;
      const nearWater = s.waterKind !== WATER_KIND.ocean && s.waterKind !== WATER_KIND.frozen && s.waterRel > -0.55 && s.waterRel < 1.1;
      if (nearWater) {
        id = 'reeds';
        p = 0.6;
      } else if (s.waterRel < 0.3) continue;
      else if (s.w[0] > 0.55) {
        if (pFern > 0) {
          id = 'fern';
          p = pFern;
        } else if (pFlower > 0) {
          id = 'flowers';
          p = pFlower;
        }
      }
      if (!id) continue;
      const k = rank / Math.max(p, 1e-4);
      if (k >= VEG_MAX_DENSITY) continue;
      if (id === 'flowers') {
        // Petal colour families: white/cream, warm yellow, pink, violet, red.
        const fam = Math.floor(pickR * 5);
        const pal = [[1.0, 0.98, 0.92], [1.0, 0.86, 0.35], [1.0, 0.66, 0.78], [0.78, 0.66, 1.0], [1.0, 0.45, 0.38]][fam];
        tint3[0] = pal[0]; tint3[1] = pal[1]; tint3[2] = pal[2];
      } else leafTint(s, rng, tint3);
      const sc = id === 'reeds' ? 0.8 + scaleR * 0.6 : id === 'fern' ? 0.9 + scaleR * 0.7 : 0.7 + scaleR * 0.6;
      sink.push(SPECIES_INDEX[id], x, h - 0.04, z, yawR * Math.PI * 2, sc, sc, tint3[0], tint3[1], tint3[2], k);
      if ((work & 31) === 0) yield;
    }
  }
  return sink.finish(cx, cz);
}

/** Run a generator to completion (tests, tools). */
export function runToEnd<T>(gen: Generator<void, T, void>): T {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

export type VegLayer = 'main' | 'bush' | 'small';

export function generateCellSync(cx: number, cz: number, exclusions: readonly VegCircle[] = [], layer: VegLayer = 'main'): VegCellData {
  return runToEnd(layer === 'small' ? generateCellSmall(cx, cz, exclusions) : layer === 'bush' ? generateCellBushes(cx, cz, exclusions) : generateCellMain(cx, cz, exclusions));
}
