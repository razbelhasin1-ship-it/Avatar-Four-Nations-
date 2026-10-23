import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PathSampler } from '../../src/combat/water/Curve';
import { FlowTube } from '../../src/combat/water/FlowTube';
import { humidity, MoistureMap, MOISTURE_MAX_YIELD, MOISTURE_MIN_YIELD } from '../../src/combat/water/humidity';

describe('PathSampler', () => {
  it('passes through its control points and measures arc length', () => {
    const p = new PathSampler().set([new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)]);
    expect(p.length).toBeCloseTo(10, 3);
    const m = p.at(5, new THREE.Vector3());
    expect(m.x).toBeCloseTo(5, 3);
    expect(p.at(-1, new THREE.Vector3()).x).toBeCloseTo(0, 5);
    expect(p.at(99, new THREE.Vector3()).x).toBeCloseTo(10, 5);
    const t = p.tangent(5, new THREE.Vector3());
    expect(t.x).toBeCloseTo(1, 3);
  });

  it('interpolates smoothly through curved control points', () => {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(5, 3, 0), new THREE.Vector3(10, 0, 0)];
    const p = new PathSampler().set(pts);
    expect(p.length).toBeGreaterThan(Math.hypot(5, 3) * 2 - 0.5);
    // The middle control point lies on the curve.
    const res = { s: 0 };
    const d = p.distanceTo(pts[1], 0, p.length, 0.05, res);
    expect(d).toBeLessThan(0.05);
  });

  it('closed loops return to the start', () => {
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ring.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const p = new PathSampler().set(ring, 10, true);
    expect(p.length).toBeGreaterThan(6);
    expect(p.length).toBeLessThan(6.5);
    const end = p.at(p.length, new THREE.Vector3());
    expect(end.distanceTo(ring[0])).toBeLessThan(1e-3);
  });
});

describe('FlowTube', () => {
  it('rewrites a fixed-size buffer along the visible span (no reallocation)', () => {
    const tube = new FlowTube(16, 6);
    const pos = tube.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array;
    const p = new PathSampler().set([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 8)]);
    tube.build(p, 2, 6, () => 0.5);
    expect(tube.mesh.visible).toBe(true);
    expect(pos.array).toBe(arr);
    // Every vertex lies within the span (z in [2,6]) at radius 0.5 from the axis.
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      expect(z).toBeGreaterThanOrEqual(2 - 1e-3);
      expect(z).toBeLessThanOrEqual(6 + 1e-3);
      expect(Math.hypot(x, y)).toBeCloseTo(0.5, 3);
    }
    // uv.y carries absolute arc length (flow direction source → head).
    const uv = tube.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    expect(uv.getY(0)).toBeCloseTo(2, 3);
    expect(uv.getY(uv.count - 1)).toBeCloseTo(6, 3);
    // Degenerate span hides the mesh.
    tube.build(p, 3, 3, () => 0.5);
    expect(tube.mesh.visible).toBe(false);
    tube.dispose();
  });
});

describe('Moisture extraction', () => {
  it('is generous in swamps and rain, nearly nothing in deserts', () => {
    const swamp = humidity({ biome: 'swamp' });
    const forest = humidity({ biome: 'forest' });
    const desert = humidity({ biome: 'desert', desert: 1 });
    const volcanic = humidity({ biome: 'volcanic', volcanic: 1 });
    expect(swamp).toBeGreaterThan(forest);
    expect(forest).toBeGreaterThan(0.5);
    expect(desert).toBeLessThan(0.05);
    expect(volcanic).toBeLessThan(0.05);
    expect(humidity({ biome: 'savanna', raining: true })).toBeGreaterThan(humidity({ biome: 'savanna' }) + 0.3);
    expect(MOISTURE_MAX_YIELD * desert).toBeLessThan(MOISTURE_MIN_YIELD);
    expect(MOISTURE_MAX_YIELD * swamp).toBeGreaterThan(20);
  });

  it('drains an area on use and recovers slowly', () => {
    const map = new MoistureMap(24, 1 / 90);
    const h = 0.95;
    const fresh = map.yieldAt(10, 10, 0, h);
    map.drain(10, 10, 0, 0.65);
    const after = map.yieldAt(10, 10, 1, h);
    expect(after).toBeLessThan(fresh * 0.4);
    map.drain(10, 10, 1, 0.65);
    expect(map.yieldAt(10, 10, 2, h)).toBeLessThan(MOISTURE_MIN_YIELD);
    // A different cell is unaffected.
    expect(map.yieldAt(100, 10, 2, h)).toBeCloseTo(fresh);
    // Recovers over ~90 s.
    expect(map.yieldAt(10, 10, 200, h)).toBeCloseTo(fresh);
  });
});
