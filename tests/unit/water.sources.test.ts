import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CarriedSupply } from '../../src/combat/WaterSources';
import { WaterSourceSystem } from '../../src/combat/WaterSources';
import type { Combatant } from '../../src/combat/types';

/**
 * WaterSources logic without a browser: a fake GameContext with a controllable
 * clock. Test points are in the desert (250, 950) — far from any river, lake,
 * marsh or sea — so only the sources registered here are in range.
 */

const DESERT = { x: 250, z: 950 };

interface Fake {
  time: { elapsed: number; real: number; frame: number; dt: number };
  events: { emit(k: string, p: unknown): void; log: Array<[string, any]> };
  knows: Set<string>;
}

function makeCtx(): { ctx: any; fake: Fake } {
  const log: Array<[string, any]> = [];
  const fake: Fake = {
    time: { elapsed: 10, real: 10, frame: 0, dt: 1 / 30 },
    events: { emit: (k: string, p: unknown) => log.push([k, p]), log },
    knows: new Set(),
  };
  const ctx = {
    time: fake.time,
    events: fake.events,
    avatar: { active: false },
    progression: { knows: (id: string) => fake.knows.has(id) },
    world: {
      groundAt: (_x: number, _z: number) => ({ y: 0, surface: 'sand', nx: 0, ny: 1, nz: 0, colliderId: 0 }),
      surfaceAt: () => 'sand',
    },
  };
  return { ctx, fake };
}

function makeCaster(reserve = 0, at = DESERT): Combatant {
  return {
    isPlayer: true,
    waterReserve: reserve,
    maxWaterReserve: 60,
    position: new THREE.Vector3(at.x, 0, at.z),
    alive: true,
  } as unknown as Combatant;
}

const aim = new THREE.Vector3(0, 0, 1);
const aimPt = new THREE.Vector3();

describe('WaterSourceSystem', () => {
  let ws: WaterSourceSystem;
  let fake: Fake;

  beforeEach(() => {
    const m = makeCtx();
    fake = m.fake;
    ws = new WaterSourceSystem();
    ws.init(m.ctx);
    // These tests exercise the source mechanics through the direct-draw path NPC and enemy benders
    // use; the player's held-water rule has its own tests below.
    ws.heldWaterOnly = false;
  });

  describe("player's held-water rule", () => {
    beforeEach(() => {
      ws.heldWaterOnly = true;
    });

    it('with empty hands beside a source, asks to gather instead of bending it from a distance', () => {
      ws.register({ id: 'test:fountain', type: 'fountain', label: 'Fountain', x: DESERT.x + 3, y: 0, z: DESERT.z, r: 1, capacity: 50, regen: 0 });
      const c = makeCaster(0);
      expect(ws.acquire(c, { amount: 4 }, aim, aimPt)).toBeNull();
      expect(ws.lastFailure?.reason).toBe('gather');
      expect(ws.lastFailure?.source?.id).toBe('test:fountain');
      expect(ws.get('test:fountain')!.amount).toBe(50); // nothing consumed
    });

    it('bends held water, and gathering then bending works', () => {
      ws.register({ id: 'test:fountain', type: 'fountain', label: 'Fountain', x: DESERT.x + 3, y: 0, z: DESERT.z, r: 1, capacity: 50, regen: 0 });
      const c = makeCaster(0);
      expect(ws.drawToReserve(c, 20, aim)).not.toBeNull();
      expect(c.waterReserve).toBeCloseTo(20);
      const g = ws.acquire(c, { amount: 4 }, aim, aimPt)!;
      expect(g.sourceType).toBe('reserve');
      expect(c.waterReserve).toBeCloseTo(16);
      expect(ws.get('test:fountain')!.amount).toBeCloseTo(30); // only the gather took from the fountain
    });

    it('still tears ice from frozen sources and lets other benders draw directly', () => {
      ws.register({ id: 'test:ice', type: 'ice', label: 'Ice sheet', x: DESERT.x + 3, y: 0, z: DESERT.z, r: 2, capacity: 50, regen: 0, frozen: true });
      const c = makeCaster(0);
      expect(ws.acquire(c, { amount: 6, allowIce: true }, aim, aimPt)?.sourceId).toBe('test:ice');
      ws.register({ id: 'test:fountain', type: 'fountain', label: 'Fountain', x: DESERT.x - 3, y: 0, z: DESERT.z, r: 1, capacity: 50, regen: 0 });
      const npc = { ...makeCaster(0), isPlayer: false } as unknown as Combatant;
      expect(ws.acquire(npc, { amount: 4 }, aim, aimPt)?.sourceId).toBe('test:fountain');
    });
  });

  it('refuses and consumes nothing when no water is in range', () => {
    const c = makeCaster(2);
    expect(ws.findAll(c.position, 16, { allowIce: true, allowSnow: true })).toEqual([]);
    const g = ws.acquire(c, { amount: 4 }, aim, aimPt);
    expect(g).toBeNull();
    expect(c.waterReserve).toBe(2); // partial reserve is NOT spent on failure
    expect(ws.lastFailure?.message).toMatch(/water/i);
    expect(fake.events.log.filter(([k]) => k === 'water:drawn')).toHaveLength(0);
  });

  it('takes from the reserve first', () => {
    ws.register({ id: 'test:fountain', type: 'fountain', label: 'Fountain', x: DESERT.x + 3, y: 0, z: DESERT.z, r: 1, capacity: 50, regen: 0 });
    const c = makeCaster(10);
    const g = ws.acquire(c, { amount: 4 }, aim, aimPt)!;
    expect(g).not.toBeNull();
    expect(g.sourceType).toBe('reserve');
    expect(g.from).toBeNull();
    expect(c.waterReserve).toBeCloseTo(6);
    expect(ws.get('test:fountain')!.amount).toBe(50); // source untouched
  });

  it('tops up a short reserve from the nearby source and reports it', () => {
    ws.register({ id: 'test:fountain', type: 'fountain', label: 'Fountain', x: DESERT.x + 3, y: 0, z: DESERT.z, r: 1, capacity: 50, regen: 0 });
    const c = makeCaster(1);
    const g = ws.acquire(c, { amount: 4 }, aim, aimPt)!;
    expect(g.sourceId).toBe('test:fountain');
    expect(g.from).not.toBeNull();
    expect(c.waterReserve).toBe(0);
    expect(ws.get('test:fountain')!.amount).toBeCloseTo(47);
    const drawn = fake.events.log.find(([k]) => k === 'water:drawn');
    expect(drawn?.[1].sourceId).toBe('test:fountain');
  });

  it('a finite source depletes, refuses when exhausted, then regenerates', () => {
    ws.register({ id: 'test:puddle', type: 'puddle', label: 'Test Puddle', x: DESERT.x + 2, y: 0, z: DESERT.z, r: 1, capacity: 10, regen: 2 });
    const c = makeCaster(0);
    expect(ws.acquire(c, { amount: 4 }, aim, aimPt)).not.toBeNull();
    expect(ws.acquire(c, { amount: 4 }, aim, aimPt)).not.toBeNull();
    expect(ws.get('test:puddle')!.amount).toBeCloseTo(2);
    // 2 left, 4 needed: refused, nothing consumed.
    expect(ws.acquire(c, { amount: 4 }, aim, aimPt)).toBeNull();
    expect(ws.get('test:puddle')!.amount).toBeCloseTo(2);
    expect(ws.lastFailure?.reason).toBe('dry');
    // Regenerates over time (2 units/s).
    ws.update(1.5);
    expect(ws.get('test:puddle')!.amount).toBeCloseTo(5);
    expect(ws.acquire(c, { amount: 4 }, aim, aimPt)).not.toBeNull();
    // Never exceeds capacity.
    ws.update(100);
    expect(ws.get('test:puddle')!.amount).toBe(10);
  });

  it('rate-limits unlimited sources locally, recovering with time', () => {
    ws.register({ id: 'test:canal', type: 'canal', label: 'Canal', x: DESERT.x + 3, y: 0, z: DESERT.z, r: 1, capacity: Infinity, regen: 0 });
    const c = makeCaster(0);
    let ok = 0;
    for (let i = 0; i < 100; i++) if (ws.acquire(c, { amount: 10 }, aim, aimPt)) ok++;
    expect(ok).toBeGreaterThan(5);
    expect(ok).toBeLessThan(100);
    expect(ws.acquire(c, { amount: 10 }, aim, aimPt)).toBeNull();
    expect(ws.lastFailure?.reason).toBe('busy');
    fake.time.elapsed += 3.5;
    expect(ws.acquire(c, { amount: 10 }, aim, aimPt)).not.toBeNull();
  });

  it('ice melts into water for liquid techniques and stays ice for ice techniques', () => {
    ws.register({ id: 'test:ice', type: 'ice', label: 'Ice Block', x: DESERT.x + 2, y: 0, z: DESERT.z, r: 1, capacity: 40, regen: 0, frozen: true });
    const c = makeCaster(0);
    const melted = ws.acquire(c, { amount: 4 }, aim, aimPt)!;
    expect(melted.sourceId).toBe('test:ice');
    expect(melted.frozen).toBe(false);
    const g = ws.acquire(c, { amount: 4, allowIce: true }, aim, aimPt)!;
    expect(g.frozen).toBe(true);
    expect(g.sourceId).toBe('test:ice');
    // Draw Water melts it into the reserve.
    expect(ws.drawToReserve(c, 10, aim)?.id).toBe('test:ice');
    expect(c.waterReserve).toBeCloseTo(10);
  });

  it('any waterbender gathers water from snow (Snow Gathering only speeds it up)', () => {
    const c = makeCaster(0);
    // A world whose ground is snow.
    (ws as any).ctx.world.groundAt = () => ({ y: 0, surface: 'snow', nx: 0, ny: 1, nz: 0, colliderId: 0 });
    const g = ws.acquire(c, { amount: 4 }, aim, aimPt)!;
    expect(g.sourceType).toBe('snow');
    expect(ws.drawToReserve(c, 6, aim)?.type).toBe('snow');
    expect(c.waterReserve).toBeCloseTo(6);
  });

  it('large-source requirements ignore the reserve and small sources', () => {
    ws.register({ id: 'test:fountain', type: 'fountain', label: 'Fountain', x: DESERT.x + 2, y: 0, z: DESERT.z, r: 1, capacity: 50, regen: 0 });
    const c = makeCaster(60);
    expect(ws.acquire(c, { amount: 20, largeSource: true }, aim, aimPt)).toBeNull();
    expect(c.waterReserve).toBe(60);
    expect(ws.lastFailure?.reason).toBe('small');
    ws.register({ id: 'test:lake', type: 'lake', label: 'Test Lake', x: DESERT.x + 4, y: 0, z: DESERT.z, r: 3, capacity: Infinity, regen: 0, size: 'large' });
    const g = ws.acquire(c, { amount: 20, largeSource: true }, aim, aimPt)!;
    expect(g.sourceId).toBe('test:lake');
    expect(c.waterReserve).toBe(60);
  });

  it('uses the carried water skin only when the reserve and sources fall short', () => {
    const skin = { amount: 30, capacity: 30 };
    const supply: CarriedSupply = {
      get amount() {
        return skin.amount;
      },
      get capacity() {
        return skin.capacity;
      },
      point: (out) => out.set(DESERT.x, 1, DESERT.z),
      take: (n) => (skin.amount -= n),
    };
    ws.carriedSupply = () => supply;
    const c = makeCaster(1);
    const g = ws.acquire(c, { amount: 4 }, aim, aimPt)!;
    expect(g.sourceType).toBe('flask');
    expect(c.waterReserve).toBe(0);
    expect(skin.amount).toBeCloseTo(27);
    // Too much even with the skin: refused, nothing consumed.
    expect(ws.acquire(c, { amount: 40 }, aim, aimPt)).toBeNull();
    expect(skin.amount).toBeCloseTo(27);
  });

  it('Draw Water pulls into the reserve up to its maximum', () => {
    ws.register({ id: 'test:pond', type: 'pond', label: 'Pond', x: DESERT.x + 3, y: 0, z: DESERT.z, r: 2, capacity: 100, regen: 0 });
    const c = makeCaster(50);
    const h = ws.drawToReserve(c, 30)!;
    expect(h.id).toBe('test:pond');
    expect(h.drawn).toBeCloseTo(10);
    expect(c.waterReserve).toBeCloseTo(60);
    expect(ws.drawToReserve(c, 30)).toBeNull();
    expect(ws.lastFailure?.reason).toBe('full');
    expect(fake.events.log.some(([k, p]) => k === 'water:drawn' && p.sourceId === 'test:pond')).toBe(true);
  });

  it('spent water leaves puddles that can be bent again and merges nearby spills', () => {
    const added: string[] = [];
    ws.onSource((e) => e.kind === 'added' && added.push(e.source.id));
    const at = new THREE.Vector3(DESERT.x, 0, DESERT.z);
    const id = ws.release(at, 20)!;
    expect(id).toMatch(/^dyn_/);
    expect(ws.get(id)!.type).toBe('puddle');
    const cap = ws.get(id)!.capacity;
    expect(ws.release(at.clone().add(new THREE.Vector3(0.5, 0, 0)), 10)).toBe(id);
    expect(ws.get(id)!.capacity).toBeGreaterThan(cap);
    expect(added).toEqual([id]);
    const c = makeCaster(0);
    const g = ws.acquire(c, { amount: 4 }, aim, aimPt)!;
    expect(g.sourceId).toBe(id);
    // Small spills do not create puddles.
    expect(ws.release(new THREE.Vector3(DESERT.x + 30, 0, DESERT.z), 2)).toBeNull();
    // Puddles evaporate.
    ws.update(60);
    expect(ws.get(id)).toBeUndefined();
  });

  it('real rivers are found and reported with river ids', () => {
    const c = makeCaster(0, { x: 200, z: -250 });
    const all = ws.findAll(c.position, 30);
    const river = all.find((h) => h.id.startsWith('river:'));
    expect(river).toBeTruthy();
    expect(river!.size).toBe('large');
  });

  it('snow is offered on cold dry ground, never on a river bed', () => {
    fake.knows.add('water_snow_draw');
    // Dry tundra near the Northern Water Tribe: snow underfoot.
    const tundra = makeCaster(0, { x: -230, z: -1820 });
    expect(ws.findAll(tundra.position, 16, { allowSnow: true }).some((h) => h.type === 'snow')).toBe(true);
    // Standing in the Glacier Melt Stream: the river is the source, not "snow" on its bed.
    const inRiver = makeCaster(0, { x: -491.5, z: -1470 });
    const here = ws.findAll(inRiver.position, 16, { allowSnow: true, allowIce: true });
    expect(here.some((h) => h.id.startsWith('river:'))).toBe(true);
    expect(here.some((h) => h.type === 'snow')).toBe(false);
    // A liquid technique there draws from the river.
    expect(ws.acquire(inRiver, { amount: 4 }, aim, aimPt)!.sourceType).toBe('river');
  });
});
