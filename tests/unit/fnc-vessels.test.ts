import { describe, expect, it } from 'vitest';
import { heightAt } from '../../src/world/Heightfield';
import { FNC, HARBOR, atAxis, harborHalf } from '../../src/world/regions/fire/fnc/layout';
import { SHIP, SHIP_IN, SHIP_OUT, berths, route } from '../../src/world/regions/fire/fnc/vessels';

/** Fire Nation capital harbour traffic: every hull floats in water deep enough for its draft. */
describe('Fire Nation capital ships', () => {
  const deep = (x: number, z: number) => heightAt(x, z) < -(SHIP.draft + 0.5);
  /** Quay aprons and piers are slabs over the deep basin: keep hulls off them explicitly. */
  const HEAD = FNC.harbor.s0 + 8;
  const onStructure = (x: number, z: number): boolean => {
    const t = x - FNC.V.x, s = z - FNC.V.z;
    if (s < FNC.harbor.s0 - 1 || s > HARBOR.wallS + HARBOR.wall.d / 2 + 1) return false;
    if (s > HARBOR.wallS - HARBOR.wall.d / 2 - 0.5) return Math.abs(t) > HARBOR.wall.gateHalf - 0.5;
    if (s < HEAD + 0.6) return true;
    if (Math.abs(t) > harborHalf(s) - 0.8) return true;
    if (s < HEAD + HARBOR.pierLen + 0.5) for (const pt of HARBOR.piers) if (Math.abs(t - pt) < HARBOR.pierW / 2 + 0.3) return true;
    return false;
  };

  it('scheduled routes stay over deep water and pass through the sea gate', () => {
    for (const ctrl of [SHIP_IN, SHIP_OUT]) {
      const r = route(ctrl);
      const bad: string[] = [];
      for (let i = 0; i < r.pts.length / 2; i++) {
        const x = r.pts[i * 2], z = r.pts[i * 2 + 1];
        // Sample the hull's beam either side of the track too.
        for (const o of [-SHIP.B / 2, 0, SHIP.B / 2]) if (!deep(x + o, z) || onStructure(x + o, z)) bad.push(`${x.toFixed(0)},${z.toFixed(0)} (${o})`);
      }
      expect(bad).toEqual([]);
      // Crosses the sea wall inside the gate opening.
      const sw = atAxis(0, HARBOR.wallS).z;
      let crossed = false;
      for (let i = 1; i < r.pts.length / 2; i++) {
        const z0 = r.pts[i * 2 - 1], z1 = r.pts[i * 2 + 1];
        if ((z0 - sw) * (z1 - sw) <= 0) {
          crossed = true;
          expect(Math.abs(r.pts[i * 2] - atAxis(0, 0).x)).toBeLessThan(HARBOR.wall.gateHalf - SHIP.B / 2 - 2);
        }
      }
      expect(crossed).toBe(true);
    }
  });

  it('moored and anchored berths float clear of the quays', () => {
    for (const b of berths()) {
      const p = atAxis(b.t, b.s);
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      for (const lz of [-SHIP.L / 2 + 2, 0, SHIP.L / 2 - 6]) {
        for (const lx of [-SHIP.B / 2, SHIP.B / 2]) {
          const x = p.x + lz * s + lx * c, z = p.z + lz * c - lx * s;
          expect(deep(x, z) && !onStructure(x, z), `berth ${b.t.toFixed(1)},${b.s.toFixed(1)} at ${lx},${lz}`).toBe(true);
        }
      }
    }
  });
});
