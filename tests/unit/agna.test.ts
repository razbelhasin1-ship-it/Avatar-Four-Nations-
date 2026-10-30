import { describe, expect, it } from 'vitest';
import { planDistrict, type DistrictPlan } from '../../src/world/regions/water/agnaPlan';
import { DISTRICTS, inCity, TUNE, type Side } from '../../src/world/regions/water/nwtLayout';

/** Flood-fill a district on a 0.5 m grid from its walkable edges (and stair feet). */
function flood(plan: DistrictPlan): { reached: (x: number, z: number) => boolean; walkable: number; built: number } {
  const [x0, z0, x1, z1] = plan.spec.rect;
  const c = 0.5, R = 0.3;
  const nx = Math.ceil((x1 - x0) / c), nz = Math.ceil((z1 - z0) / c);
  const blocked = new Uint8Array(nx * nz);
  const seen = new Uint8Array(nx * nz);
  let built = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * c, z = z0 + (j + 0.5) * c;
      const inB = plan.buildings.some((b) => x > b.x0 - R && x < b.x1 + R && z > b.z0 - R && z < b.z1 + R);
      if (plan.buildings.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) built++;
      blocked[j * nx + i] = inB || !inCity(x, z, 0.35) ? 1 : 0;
    }
  }
  const q: number[] = [];
  const seed = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const k = j * nx + i;
    if (blocked[k] || seen[k]) return;
    seen[k] = 1;
    q.push(k);
  };
  const walk = (s: Side) => !plan.spec.blind?.includes(s) && !plan.spec.view?.includes(s);
  for (let i = 0; i < nx; i++) {
    if (walk('n')) seed(i, 0);
    if (walk('s')) seed(i, nz - 1);
  }
  for (let j = 0; j < nz; j++) {
    if (walk('w')) seed(0, j);
    if (walk('e')) seed(nx - 1, j);
  }
  for (const sx of plan.spec.stairsN ?? []) seed(Math.floor((sx - x0) / c), 0);
  while (q.length) {
    const k = q.pop()!;
    const i = k % nx, j = (k - i) / nx;
    seed(i + 1, j);
    seed(i - 1, j);
    seed(i, j + 1);
    seed(i, j - 1);
  }
  let walkable = 0;
  for (let k = 0; k < seen.length; k++) walkable += seen[k];
  return {
    reached: (x, z) => {
      const i = Math.floor((x - x0) / c), j = Math.floor((z - z0) / c);
      return i >= 0 && j >= 0 && i < nx && j < nz && seen[j * nx + i] === 1;
    },
    walkable: walkable * c * c,
    built: built * c * c,
  };
}

describe("Agna Qel'a street maze", () => {
  const plans = DISTRICTS.map(planDistrict);

  it('is deterministic', () => {
    const again = DISTRICTS.map(planDistrict);
    expect(again.map((p) => p.buildings.length)).toEqual(plans.map((p) => p.buildings.length));
    expect(again[3].buildings[5]).toEqual(plans[3].buildings[5]);
  });

  it('is dense: hundreds of 2-4 storey buildings in narrow alleys', () => {
    const total = plans.reduce((n, p) => n + p.buildings.length, 0);
    expect(total).toBeGreaterThan(350);
    for (const p of plans) {
      for (const b of p.buildings) {
        expect(b.floors).toBeGreaterThanOrEqual(2);
        expect(b.floors).toBeLessThanOrEqual(4);
      }
      for (const l of p.lanes) {
        if (l.kind === 'court') continue;
        const w = l.along === 'x' ? l.z1 - l.z0 : l.x1 - l.x0;
        expect(w).toBeGreaterThanOrEqual(TUNE.alley[0] - 0.01);
        expect(w).toBeLessThanOrEqual(TUNE.lane + 0.01);
      }
    }
  });

  it('never overlaps buildings with each other or with lanes', () => {
    for (const p of plans) {
      const B = p.buildings;
      for (let i = 0; i < B.length; i++) {
        for (let j = i + 1; j < B.length; j++) {
          const a = B[i], b = B[j];
          const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.05 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.05;
          expect(ov, `${p.id}: buildings ${i} and ${j} overlap`).toBe(false);
        }
        for (const l of p.lanes) {
          const a = B[i];
          const ov = Math.min(a.x1, l.x1) - Math.max(a.x0, l.x0) > 0.05 && Math.min(a.z1, l.z1) - Math.max(a.z0, l.z0) > 0.05;
          expect(ov, `${p.id}: building ${i} blocks a ${l.kind}`).toBe(false);
        }
      }
    }
  });

  it('keeps every lane, alley, courtyard and door reachable (no isolated alleys, no stuck spots)', () => {
    let walk = 0, built = 0;
    for (const p of plans) {
      const f = flood(p);
      walk += f.walkable;
      built += f.built;
      for (const l of p.lanes) {
        const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
        if (!inCity(cx, cz, 0.6)) continue;
        expect(f.reached(cx, cz), `${p.id}: ${l.kind} at (${cx.toFixed(1)}, ${cz.toFixed(1)}) is cut off`).toBe(true);
      }
      for (const b of p.buildings) {
        if (!b.door) continue;
        const x = b.door === 'w' ? b.x0 - 0.8 : b.door === 'e' ? b.x1 + 0.8 : (b.x0 + b.x1) / 2;
        const z = b.door === 'n' ? b.z0 - 0.8 : b.door === 's' ? b.z1 + 0.8 : (b.z0 + b.z1) / 2;
        if (!inCity(x, z, 0.6)) continue;
        const [rx0, rz0, rx1, rz1] = p.spec.rect;
        if (x < rx0 || x > rx1 || z < rz0 || z > rz1) continue; // opens onto a quay or plaza outside the district
        expect(f.reached(x, z), `${p.id}: door of building at (${b.x0.toFixed(1)}, ${b.z0.toFixed(1)}) faces a wall`).toBe(true);
      }
    }
    // Dense city: buildings cover a large share of the districts, the rest is alleys, courts and stairs.
    expect(built / (built + walk)).toBeGreaterThan(0.45);
  });
});
