import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { bendTone, setBendTone } from '../../src/combat/water/WaterMaterials';
import { WaterSourceSystem } from '../../src/combat/WaterSources';
import { envUniforms } from '../../src/world/env/EnvShared';
import { activeWaterRipples, addWaterRipple, clearWaterRipples, MAX_RIPPLES, toneForSource, WATER_TONES, waterRippleUniforms, type WaterTone } from '../../src/world/env/WaterShared';
import { pavingMaterial, pavingPending, pavingSet, repave } from '../../src/world/kit/Paving';
import { trackBasin, untrackBasin, WaterLife } from '../../src/world/WaterLife';
import { createBasinWaterMaterial, waterDetail } from '../../src/world/WaterLook';

/** A tiny event bus with the GameContext events API used here. */
function bus() {
  const handlers = new Map<string, Array<(p: any) => void>>();
  return {
    on(k: string, fn: (p: any) => void) {
      const l = handlers.get(k) ?? [];
      l.push(fn);
      handlers.set(k, l);
      return () => handlers.set(k, (handlers.get(k) ?? []).filter((f) => f !== fn));
    },
    emit(k: string, p: unknown) {
      for (const fn of handlers.get(k) ?? []) fn(p);
    },
  };
}

const luminance = (hex: string) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

afterEach(() => {
  clearWaterRipples();
  envUniforms.uEnvTime.value = 0;
});

describe('water tones', () => {
  it('every tone deepens to a darker colour', () => {
    for (const [name, t] of Object.entries(WATER_TONES)) {
      expect(luminance(t.deep), name).toBeLessThan(luminance(t.shallow));
      expect(t.absorb, name).toBeGreaterThan(0);
    }
  });

  it('sources carry the tone of the water they hold', () => {
    const cases: Array<[string, string, WaterTone]> = [
      ['ocean', 'Open sea', 'sea'],
      ['river', 'River', 'river'],
      ['waterfall', 'Spirit Falls', 'river'],
      ['lake', 'Lake Laogai', 'lake'],
      ['fountain', 'Firelight Fountain', 'clear'],
      ['canal', 'Golden Water canal', 'clear'],
      ['canal', 'Irrigation canal', 'river'],
      ['pond', 'Zoo pond', 'pond'],
      ['pond', 'Flooded rice paddy', 'pond'],
      ['pond', 'Bathhouse pool', 'clear'],
      ['pond', 'Village well', 'clear'],
      ['pond', 'Banyan murky pool', 'swamp'],
      ['pond', 'Fishing Hole', 'polar'],
      ['pond', 'Hot spring', 'hot'],
      ['snow', 'Snow', 'melt'],
      ['ice', 'Ice sheet', 'melt'],
      ['puddle', 'Puddle', 'clear'],
      ['flask', 'Water skin', 'clear'],
    ];
    for (const [type, label, tone] of cases) expect(toneForSource(type, label), `${type} ${label}`).toBe(tone);
  });
});

describe('water ripples', () => {
  it('keeps a bounded ring buffer of live rings that age with the environment clock', () => {
    envUniforms.uEnvTime.value = 10;
    for (let i = 0; i < MAX_RIPPLES + 5; i++) addWaterRipple(i, -i, 9);
    const live = activeWaterRipples();
    expect(live).toHaveLength(MAX_RIPPLES);
    expect(Math.max(...live.map((r) => r.strength))).toBeLessThanOrEqual(2.5);
    // The oldest rings were overwritten by the newest.
    expect(live.some((r) => r.x === MAX_RIPPLES + 4)).toBe(true);
    expect(live.some((r) => r.x === 0)).toBe(false);
    envUniforms.uEnvTime.value = 11.5;
    expect(activeWaterRipples()[0].age).toBeCloseTo(1.5, 5);
    envUniforms.uEnvTime.value = 14;
    expect(activeWaterRipples()).toHaveLength(0);
    clearWaterRipples();
    expect(waterRippleUniforms.uRipples.value.every((r) => r.w === 0)).toBe(true);
  });
});

describe('basin water material', () => {
  it('shares the environment, the ripple field and the quality knob by reference', () => {
    const a = createBasinWaterMaterial({ tone: 'pond', size: [4, 4], circle: true, fountain: 0.5 });
    const b = createBasinWaterMaterial({ tone: 'clear', size: [2, 6], reflect: 3, feather: 0.2 });
    expect(a.name).toBe('basin_water');
    expect(a.transparent).toBe(true);
    expect(a.uniforms.uEnvTime).toBe(envUniforms.uEnvTime);
    expect(a.uniforms.uSunDir).toBe(envUniforms.uSunDir);
    expect(a.uniforms.uRipples).toBe(waterRippleUniforms.uRipples);
    expect(a.uniforms.uDetail).toBe(waterDetail);
    expect(a.uniforms.uWaterTex.value).toBe(b.uniforms.uWaterTex.value);
    // Per-surface look stays per material.
    expect(a.uniforms.uShallow).not.toBe(b.uniforms.uShallow);
    expect((a.uniforms.uShallow.value as THREE.Color).getHexString()).toBe(new THREE.Color(WATER_TONES.pond.shallow).getHexString());
    expect(a.uniforms.uCircle.value).toBe(1);
    expect(a.uniforms.uFountain.value).toBe(0.5);
    expect(a.uniforms.uReflect.value).toBeCloseTo(0.95);
    expect(b.uniforms.uReflect.value).toBe(3);
    expect(b.uniforms.uFeather.value).toBe(0.2);
    expect(a.fragmentShader).toContain('waterRipples(p)');
    expect(a.fragmentShader).toContain('waterLight(');
    a.dispose();
    b.dispose();
  });
});

describe('WaterLife', () => {
  function makeLife(sources: Map<string, { amount: number; capacity: number; label: string }>) {
    const events = bus();
    const ctx = {
      events,
      water: { get: (id: string) => sources.get(id) },
      settings: { data: { graphics: { effectsQuality: 'medium' } } },
      session: { active: false },
      player: null,
      world: { liquidAt: () => null },
    };
    const life = new WaterLife();
    life.init(ctx as never);
    return { life, events, ctx };
  }

  it('lowers a basin as it is drawn down and raises it as it refills', () => {
    const src = { amount: 100, capacity: 100, label: 'Garden pond' };
    const { life } = makeLife(new Map([['t:pond', src]]));
    const mesh = new THREE.Mesh();
    mesh.position.set(5, 2, 5);
    trackBasin('t:pond', mesh, 2, 3, 0.12);
    src.amount = 25;
    for (let i = 0; i < 60; i++) life.update(0.1);
    expect(mesh.position.y).toBeCloseTo(2 - 0.75 * 0.12, 3);
    src.amount = 100;
    for (let i = 0; i < 60; i++) life.update(0.1);
    expect(mesh.position.y).toBeCloseTo(2, 3);
    untrackBasin('t:pond');
  });

  it('applies the water detail level from the graphics settings', () => {
    makeLife(new Map());
    expect(waterDetail.value).toBeCloseTo(0.6);
  });

  it('rings the water where it is drawn or released, and bent water takes the source tone', () => {
    const { events } = makeLife(new Map([['t:zoo', { amount: 10, capacity: 40, label: 'Zoo pond' }]]));
    setBendTone('clear');
    envUniforms.uEnvTime.value = 3;
    events.emit('water:drawn', { sourceId: 't:zoo', sourceType: 'pond', amount: 20, position: { x: 4, y: 0, z: 7 } });
    expect(bendTone()).toBe('pond');
    let live = activeWaterRipples();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ x: 4, z: 7 });
    // Snow has no surface to ring (its tone still carries over).
    events.emit('water:drawn', { sourceId: 'snow', sourceType: 'snow', amount: 5, position: { x: 0, y: 0, z: 0 } });
    expect(activeWaterRipples()).toHaveLength(1);
    expect(bendTone()).toBe('melt');
    events.emit('water:released', { x: -2, y: 0, z: 9, amount: 30, sourceId: null });
    live = activeWaterRipples();
    expect(live).toHaveLength(2);
    expect(live[1].strength).toBeGreaterThan(live[0].strength * 0.9);
  });
});

describe('WaterSourceSystem.release', () => {
  it('reports where spent water lands on the surface of the source it refills', () => {
    const log: Array<[string, any]> = [];
    const ctx = {
      time: { elapsed: 10, real: 10, frame: 0, dt: 1 / 30 },
      events: { emit: (k: string, p: unknown) => log.push([k, p]), on: () => () => {} },
      avatar: { active: false },
      progression: { knows: () => false },
      world: { groundAt: () => ({ y: 0, surface: 'sand', nx: 0, ny: 1, nz: 0, colliderId: 0 }), surfaceAt: () => 'sand' },
    };
    const ws = new WaterSourceSystem();
    ws.init(ctx as never);
    ws.register({ id: 't:basin', type: 'fountain', label: 'Fountain', x: 250, y: 1, z: 950, r: 2, capacity: 50, regen: 0 });
    const s = ws.get('t:basin')!;
    s.amount = 10;
    expect(ws.release(new THREE.Vector3(256, 0, 950), 20)).toBe('t:basin');
    const e = log.find(([k]) => k === 'water:released')?.[1];
    expect(e).toBeTruthy();
    expect(e.sourceId).toBe('t:basin');
    // Pulled in from the bank onto the water (within the basin's radius).
    expect(Math.hypot(e.x - 250, e.z - 950)).toBeLessThanOrEqual(2);
    expect(e.amount).toBe(20);
  });
});

describe('paving textures', () => {
  it('is deterministic per kind, colour and seed, and swaps materials to the full-size textures', async () => {
    const a = pavingSet('flag', '#d0c4ac', 3, 128);
    const b = pavingSet('flag', '#d0c4ac', 3, 128);
    expect(a).toBe(b); // cached
    const c = pavingSet('flag', '#d0c4ac', 4, 128);
    const da = a.map.image.data as Uint8Array, dc = c.map.image.data as Uint8Array;
    expect(da.length).toBe(128 * 128 * 4);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) diff += Math.abs(da[i] - dc[i]);
    expect(diff / (da.length / 4)).toBeGreaterThan(2); // another seed lays other stones
    expect(a.normalMap.image.width).toBe(64);
    // Roughness rides in the albedo's alpha: polished stone and gritty joints both appear.
    let lo = 255, hi = 0;
    for (let i = 3; i < da.length; i += 4) {
      lo = Math.min(lo, da[i]);
      hi = Math.max(hi, da[i]);
    }
    expect(hi - lo).toBeGreaterThan(40);

    // A larger size starts at 128² and is upgraded progressively in the background.
    const big = pavingSet('cobble', '#c0b090', 5, 256);
    const m = pavingMaterial(big, { tint: '#ffffff' });
    expect((m.map as THREE.DataTexture).image.width).toBe(128);
    for (let i = 0; i < 400 && pavingPending() > 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(pavingPending()).toBe(0);
    expect(m.map).toBe(big.map);
    expect((m.map as THREE.DataTexture).image.width).toBe(256);
    expect((m.normalMap as THREE.DataTexture).image.width).toBe(128);
    // Re-paving moves a material onto another set; disposing it stops further swaps.
    repave(m, a);
    expect(m.map).toBe(a.map);
    m.dispose();
  });

  it('tiles seamlessly: the wrap-around step is no rougher than the steps inside the tile', () => {
    const S = 128;
    for (const kind of ['flag', 'cobble', 'slab', 'earth'] as const) {
      const d = pavingSet(kind, '#e0d6c4', 9, S).map.image.data as Uint8Array;
      const px = (x: number, y: number) => d[(((y + S) % S) * S + ((x + S) % S)) * 4];
      const rows: number[] = [], cols: number[] = [];
      for (let i = 0; i < S; i++) {
        let r = 0, c = 0;
        for (let j = 0; j < S; j++) {
          r += Math.abs(px(j, i) - px(j, i + 1));
          c += Math.abs(px(i, j) - px(i + 1, j));
        }
        rows.push(r);
        cols.push(c);
      }
      // A seam would stand out above every joint and stone edge inside the tile.
      expect(rows[S - 1], `${kind} rows`).toBeLessThanOrEqual(Math.max(...rows.slice(0, S - 1)) * 1.1);
      expect(cols[S - 1], `${kind} columns`).toBeLessThanOrEqual(Math.max(...cols.slice(0, S - 1)) * 1.1);
      if (kind === 'earth') {
        // Joint-free packed earth: the wrap is an ordinary step.
        const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
        expect(rows[S - 1]).toBeLessThan(median(rows) * 1.5);
        expect(cols[S - 1]).toBeLessThan(median(cols) * 1.5);
      }
    }
  });
});
