import { beforeAll, describe, expect, it } from 'vitest';
import {
  biomeWeights,
  createTerrainSample,
  getPlateauRuntime,
  getRoadRuntime,
  heightAt,
  initHeightfield,
  normalAt,
  roadAt,
  sampleTerrain,
  terrainSurfaceAt,
  waterAt,
  WATER_KIND,
} from '../../src/world/Heightfield';
import { SPECIES_IDS } from '../../src/world/env/VegetationModels';
import { generateCellSync, onRoad, treeProbability, VEG_CELL, VEG_MAX_DENSITY, VEG_STRIDE, vegetationBlockedAt, type VegCellData } from '../../src/world/env/VegetationPlacement';

/** Every instance of a cell as plain objects. */
function instances(c: VegCellData): Array<{ species: string; x: number; y: number; z: number; k: number }> {
  const out = [];
  for (let i = 0; i < c.count; i++) {
    const o = i * VEG_STRIDE;
    out.push({ species: SPECIES_IDS[c.species[i]], x: c.data[o], y: c.data[o + 1], z: c.data[o + 2], k: c.data[o + 9] });
  }
  return out;
}

/** A spread of cells across the whole map (deterministic sample). */
function sampleCells(): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let cz = -30; cz < 30; cz += 7) for (let cx = -30; cx < 30; cx += 7) cells.push([cx, cz]);
  return cells;
}

describe('vegetation placement', () => {
  beforeAll(() => initHeightfield());

  it('is deterministic per cell', () => {
    const a = generateCellSync(6, -11);
    const b = generateCellSync(6, -11);
    expect(a.count).toBe(b.count);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(a.species)).toEqual(Array.from(b.species));
  });

  it('keeps instances inside their cell with valid keep ranks', () => {
    for (const [cx, cz] of sampleCells().slice(0, 30)) {
      for (const layer of ['main', 'bush', 'small'] as const) {
        for (const it of instances(generateCellSync(cx, cz, [], layer))) {
          expect(it.x).toBeGreaterThanOrEqual(cx * VEG_CELL);
          expect(it.x).toBeLessThan((cx + 1) * VEG_CELL);
          expect(it.z).toBeGreaterThanOrEqual(cz * VEG_CELL);
          expect(it.z).toBeLessThan((cz + 1) * VEG_CELL);
          expect(it.k).toBeGreaterThanOrEqual(0);
          expect(it.k).toBeLessThan(VEG_MAX_DENSITY);
        }
      }
    }
  });

  it('never places vegetation on roads, open water, city plateaus or cliffs', () => {
    const s = createTerrainSample();
    const n = { x: 0, y: 1, z: 0 };
    let checked = 0;
    for (const [cx, cz] of sampleCells()) {
      for (const layer of ['main', 'bush'] as const) {
        for (const it of instances(generateCellSync(cx, cz, [], layer))) {
          checked++;
          const h = heightAt(it.x, it.z);
          sampleTerrain(it.x, it.z, h, 1 - normalAt(it.x, it.z, 1.5, n).y, s);
          // Roads and trails (with their margins).
          expect(onRoad(s, 0.5)).toBe(false);
          // City plateaus stay free for region builders.
          expect(vegetationBlockedAt(it.x, it.z, [])).toBe(false);
          // Only mangroves may stand in (marsh) water.
          const w = waterAt(it.x, it.z, h);
          if (w && !w.frozen) {
            expect(it.species).toBe('mangrove');
            expect(s.waterKind).toBe(WATER_KIND.marsh);
          }
          // Trees need gentle ground.
          if (layer === 'main' && it.species !== 'rock' && it.species !== 'ice_rock') expect(normalAt(it.x, it.z, 1.5, n).y).toBeGreaterThan(0.85);
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('respects extra clearings (training grounds, camps)', () => {
    // Find a forested cell, then clear a circle in it.
    let cell: [number, number] | null = null;
    for (const c of sampleCells()) {
      if (instances(generateCellSync(c[0], c[1])).filter((i) => i.species !== 'rock' && i.species !== 'ice_rock').length > 15) {
        cell = c;
        break;
      }
    }
    expect(cell).not.toBeNull();
    const [cx, cz] = cell!;
    const clear = { x: (cx + 0.5) * VEG_CELL, z: (cz + 0.5) * VEG_CELL, r: 20 };
    for (const layer of ['main', 'bush', 'small'] as const) {
      for (const it of instances(generateCellSync(cx, cz, [clear], layer))) {
        expect(Math.hypot(it.x - clear.x, it.z - clear.z)).toBeGreaterThan(clear.r);
      }
    }
  });

  it('chooses biome-appropriate species', () => {
    const tally = (cx0: number, cz0: number, r: number) => {
      const t: Record<string, number> = {};
      for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
        for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
          for (const it of instances(generateCellSync(cx, cz))) t[it.species] = (t[it.species] ?? 0) + 1;
        }
      }
      return t;
    };
    const cellOf = (x: number, z: number): [number, number] => [Math.floor(x / VEG_CELL), Math.floor(z / VEG_CELL)];
    // Polar coast near the Northern Water Tribe: snowy pines only (no broadleaf / palms).
    const polar = tally(...cellOf(-600, -1650), 2);
    expect((polar.pine_snow ?? 0) + (polar.rock ?? 0)).toBeGreaterThan(0);
    expect(polar.broadleaf ?? 0).toBe(0);
    expect(polar.palm ?? 0).toBe(0);
    // The Foggy Swamp: mangroves and banyans.
    const swamp = tally(...cellOf(-1150, -380), 2);
    expect((swamp.mangrove ?? 0) + (swamp.banyan ?? 0)).toBeGreaterThan(10);
    expect(swamp.pine_snow ?? 0).toBe(0);
    // The volcano's flanks: only sparse dead / charred trees.
    const volcanic = tally(...cellOf(-1660, 1150), 1);
    for (const sp of ['broadleaf', 'conifer', 'palm', 'bamboo', 'blossom', 'acacia']) expect(volcanic[sp] ?? 0).toBe(0);
    // Tropical Kyoshi coast: palms appear.
    const tropic = tally(...cellOf(1760, -560), 2);
    expect(tropic.palm ?? 0).toBeGreaterThan(0);
    // Earth Kingdom heartland forest: broadleaf / bamboo / blossom / conifer mix.
    const ek = tally(...cellOf(404, -684), 2);
    expect((ek.broadleaf ?? 0) + (ek.bamboo ?? 0) + (ek.blossom ?? 0) + (ek.conifer ?? 0)).toBeGreaterThan(20);
  });

  it('thins the desert and keeps the deep sea empty', () => {
    const b = biomeWeights(250, 950);
    expect(b.desert).toBeGreaterThan(0.5);
    expect(treeProbability(250, 950, b)).toBeLessThan(0.05);
    // Open ocean far offshore has nothing at all.
    const ocean = generateCellSync(Math.floor(-1950 / VEG_CELL), Math.floor(0 / VEG_CELL));
    for (const it of instances(ocean)) expect(heightAt(it.x, it.z)).toBeGreaterThan(-0.8);
  });

  it('plateau exclusion covers every city site', () => {
    for (const p of getPlateauRuntime()) {
      expect(vegetationBlockedAt(p.x, p.z, [])).toBe(true);
      expect(vegetationBlockedAt(p.x + p.r * 0.9, p.z, [])).toBe(true);
    }
  });
});

describe('surface classification matches what is rendered', () => {
  beforeAll(() => initHeightfield());

  it('roads report their paved / dirt / packed-snow surface', () => {
    const roads = getRoadRuntime();
    expect(roads.length).toBeGreaterThan(0);
    let hits = 0;
    for (const r of roads) {
      for (let s = 20; s < r.line.length - 20; s += 97) {
        const p = r.line.pointAt(s);
        const info = roadAt(p.x, p.z);
        if (!info || Math.abs(info.lat) > info.half * 0.5) continue;
        const h = heightAt(p.x, p.z);
        if (waterAt(p.x, p.z, h)) continue; // bridges / fords
        const surf = terrainSurfaceAt(p.x, p.z);
        expect(['stone', 'dirt', 'packedsnow']).toContain(surf);
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(5);
  });

  it('classifies landmark biomes correctly', () => {
    // Si Wong desert dunes are sand, polar plains are snow, the swamp shore is mud or grass, volcanic slopes ash or rock.
    expect(terrainSurfaceAt(330, 1000)).toBe('sand');
    expect(['snow', 'packedsnow', 'ice']).toContain(terrainSurfaceAt(-600, -1650));
    expect(['ash', 'rock', 'gravel']).toContain(terrainSurfaceAt(-1660, 1150));
    expect(['ash', 'rock', 'gravel']).toContain(terrainSurfaceAt(-1330, 1550));
    expect(terrainSurfaceAt(-1150, -150)).toBe('water');
  });
});
