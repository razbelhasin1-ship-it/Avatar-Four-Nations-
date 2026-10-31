import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import { heightAt } from '../../../Heightfield';
import { faceYaw, pine, waterfall, type Kit } from '../parts';
import { C, SEED, polar } from './layout';

/**
 * The ring of tall misty spires round the temple pinnacle — taller than its
 * summit, so the temple sits inside a crown of stone: [bearing°, distance,
 * base radius, top height (world y), waterfall]. Bearings keep clear of the
 * switchback trail, the trailhead and the bison meadow (≈ 185–260°) and of
 * the Shrine of the Four Winds (≈ 25–60° at 160 m).
 */
export const SPIRES: Array<[number, number, number, number, boolean]> = [
  [4, 250, 24, 515, true],
  [30, 330, 20, 488, false],
  [66, 262, 26, 548, false],
  [92, 360, 22, 575, true],
  [118, 248, 21, 500, false],
  [146, 320, 27, 560, false],
  [170, 280, 19, 478, true],
  [266, 300, 24, 552, false],
  [290, 236, 20, 494, true],
  [314, 330, 26, 590, false],
  [338, 268, 22, 530, false],
  // Farther ones for depth.
  [16, 560, 30, 610, false],
  [78, 620, 34, 640, false],
  [132, 540, 28, 600, false],
  [300, 590, 32, 625, false],
  [352, 470, 25, 565, false],
];

interface Spire {
  geometry: THREE.BufferGeometry;
  /** Surface radius at bearing a (radians, local) and height fraction t. */
  radiusAt(a: number, t: number): number;
  /** Axis offset (local x, z) at height fraction t (the column leans). */
  axis(t: number): { x: number; z: number };
  /** Strata ledges as height fractions (moss and pines cling to them). */
  ledges: number[];
}

/**
 * A karst spire: a fluted column that tapers as it rises, stepped in at strata ledges and closed by
 * a rounded crown; its plan is irregular (deep grooves, lumps that twist with height) and it leans
 * a little. Local frame: base centre at the origin, +Y up.
 */
function spire(seed: number, r: number, h: number): Spire {
  const rnd = new Random(Math.floor(seed * 1000) + 7);
  const radial = 30, rows = 56;
  const n = 4 + Math.floor(rnd.range(0, 3));
  const ledges: number[] = [];
  for (let i = 0; i < n; i++) ledges.push(0.3 + (0.58 * (i + rnd.range(0.25, 0.75))) / n);
  const lx = rnd.range(-0.05, 0.05) * h, lz = rnd.range(-0.05, 0.05) * h;
  const crown = 0.86;
  const prof = (t: number): number => {
    let p = 1 - 0.66 * Math.pow(t, 1.1);
    p *= 1 + 0.07 * Math.sin(t * 9.1 + seed) + 0.05 * Math.sin(t * 23.7 + seed * 2.3);
    for (const l of ledges) if (t < l) p *= 1 + 0.07 * Math.min(1, (l - t) * 110);
    if (t > crown) p *= Math.sqrt(Math.max(0, 1 - ((t - crown) / (1 - crown)) ** 2));
    return p;
  };
  const radiusAt = (a: number, t: number): number => {
    const flute = 0.11 * Math.abs(Math.sin(a * 3 + seed)) + 0.07 * Math.abs(Math.sin(a * 7 + seed * 1.7));
    const lump = 0.2 * Math.sin(a * 2 + seed * 0.7 + t * 3.1) + 0.1 * Math.sin(a * 5 - t * 7.3 + seed) + 0.06 * Math.sin(a * 11 + t * 13 + seed * 3.1);
    return Math.max(0, r * prof(t) * (1 + flute + lump));
  };
  const axis = (t: number) => ({ x: lx * t * t, z: lz * t * t });
  // Rows: even steps plus three tight ones at each ledge, so it reads as a shelf, not a bulge.
  const ts: number[] = [];
  for (let j = 0; j <= rows; j++) ts.push(j / rows);
  for (const l of ledges) ts.push(l - 0.012, l - 0.002, l + 0.002);
  ts.sort((a, b) => a - b);
  const rowsT = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 0.0015);
  const P: number[] = [];
  for (const t of rowsT) {
    const o = axis(t);
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const rr = radiusAt(a, t);
      P.push(o.x + Math.cos(a) * rr, t * h, o.z + Math.sin(a) * rr);
    }
  }
  const I: number[] = [];
  const nRows = rowsT.length - 1;
  for (let j = 0; j < nRows; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * radial + i, b = j * radial + ((i + 1) % radial), c = a + radial, d = b + radial;
      I.push(a, c, b, b, c, d);
    }
  }
  const top = axis(1);
  const centre = P.length / 3;
  P.push(top.x, h, top.z);
  for (let i = 0; i < radial; i++) I.push(nRows * radial + i, centre, nRows * radial + ((i + 1) % radial));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return { geometry: g, radiusAt, axis, ledges };
}

/**
 * Tall karst spires in the pinnacle's own rock (strata, cracks, moss on every ledge and on the
 * crown), pines clinging to the ledges and crowning the tops, some with a waterfall falling into
 * the clouds.
 */
export function buildSpireRing(k: Kit, rock: THREE.Material): void {
  const rnd = new Random(SEED + 77);
  SPIRES.forEach(([deg, d, r, topY, falls], i) => {
    const { x, z } = polar(deg, d);
    const base = Math.min(heightAt(x, z), 120) - 14;
    const h = topY - base;
    const s = spire(i * 9.13 + 41, r, h);
    const yaw = rnd.range(0, 6.28);
    k.main.mesh(rock, s.geometry, { x, y: base, z, yaw });
    s.geometry.dispose();
    // Local → world (the mesh is turned by yaw about +Y).
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const world = (lx: number, lz: number) => ({ x: x + lx * cy + lz * sy, z: z - lx * sy + lz * cy });
    const near = d < 400;
    // Pines on the crown.
    const crownT = 0.97;
    const ca = s.axis(crownT);
    for (let p = 0; p < (near ? 4 : 2); p++) {
      const a = rnd.range(0, 6.28), dd = rnd.range(0, s.radiusAt(a, crownT) * 0.6);
      const w = world(ca.x + Math.cos(a) * dd, ca.z + Math.sin(a) * dd);
      pine(k, w.x, base + h * crownT - 0.4, w.z, p % 3, rnd.range(2.4, 3.6), rnd.range(0, 6), false);
    }
    // Pines clinging to the ledges (near spires only).
    if (near) {
      for (const l of s.ledges) {
        for (let p = 0; p < 2; p++) {
          const a = rnd.range(0, 6.28);
          const t = l + 0.004;
          const o = s.axis(t);
          const rr = s.radiusAt(a, t) * 0.97;
          const w = world(o.x + Math.cos(a) * rr, o.z + Math.sin(a) * rr);
          pine(k, w.x, base + h * l, w.z, (p + 1) % 3, rnd.range(1.8, 2.8), rnd.range(0, 6), false);
        }
      }
    }
    // Colliders: stacked cylinders along the leaning axis.
    for (let c = 0; c < 4; c++) {
      const t = (c + 0.5) / 4;
      const o = s.axis(t);
      const w = world(o.x, o.z);
      let rr = 0;
      for (let q = 0; q < 12; q++) rr += s.radiusAt((q / 12) * Math.PI * 2, t) / 12;
      k.main.collider({ shape: 'cylinder', x: w.x, y: base + h * t, z: w.z, r: rr * 0.92, hy: h / 8, walkable: true, solid: true, surface: 'rock' });
    }
    if (falls) {
      const t = 0.94;
      const o = s.axis(t);
      const wc = world(o.x, o.z);
      const ang = Math.atan2(C.z - wc.z, C.x - wc.x) + rnd.range(-0.6, 0.6);
      const fx = Math.cos(ang), fz = Math.sin(ang);
      // Local bearing of that direction, for the surface radius there.
      const la = Math.atan2(fz * cy + fx * sy, fx * cy - fz * sy);
      const rr = s.radiusAt(la, t) * 0.95;
      waterfall(k, { id: `air:sat_spire_falls_${i}`, label: 'Spire falls', x: wc.x + fx * rr, y: base + h * t, z: wc.z + fz * rr, yaw: faceYaw(fx, fz), width: 4 + r * 0.1, drop: Math.min(260, base + h * t - 300), out: 3, register: false });
    }
  });
}
