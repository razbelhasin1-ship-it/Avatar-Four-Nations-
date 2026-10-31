import * as THREE from 'three';
import { heightAt } from '../../../Heightfield';
import { roadNear } from '../../../landforms/fireCapital';
import type { P2 } from '../../../WorldLayout';
import { bannerPole, brazier, crest, roof } from '../parts';
import { crimsonMat } from '../materials';
import type { Cap } from './FireCapital';
import { FNC, atAxis, roadPath } from './layout';
import { battlement, densify, drapedStrip, wallFace } from './kit';

/**
 * Sozin's road: one road, single file wide, in switchbacks up the volcano's south face — battlements
 * along the drop, retaining walls against the cut, a watchtower at every hairpin (≈ every 90 m)
 * and, at the top, the guarded gate in the crater lip.
 */
const V = FNC.V;
const roadY = (x: number, z: number): number => roadNear(x - V.x, z - V.z).y;

export function* buildRoad(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const major = env.chunks.named('major', 'fnc_road');
  const b = major.builder;
  const R = FNC.road;
  const pts = roadPath();
  const world = pts.map((p) => ({ ...atAxis(p.t, p.s), y: p.y }));

  // Deck.
  drapedStrip(b, 'stone_tan', world, R.half * 2, { y: roadY, lift: 0.08, tile: 3, step: 2, across: 2 });
  // Walls per leg: battlement on the downhill side, retaining wall on the uphill side.
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const et = c.t - a.t, es = c.s - a.s;
    const L = Math.hypot(et, es) || 1;
    // Downhill normal = the perpendicular pointing south (+s).
    let nt = -es / L, ns = et / L;
    if (ns < 0) {
      nt = -nt;
      ns = -ns;
    }
    const off = (k: number, u: number): P2 => atAxis(a.t + et * u + nt * k, a.s + es * u + ns * k);
    const trim = i === 0 ? 0 : 0.06, trimEnd = i === pts.length - 2 ? 0 : 0.06;
    // Walls are split into runs wherever they would stand in another leg's roadway (acute turns).
    const inOther = (q: P2): boolean => {
      for (let j = 0; j < pts.length - 1; j++) {
        if (j === i) continue;
        const A = pts[j], B = pts[j + 1];
        const ex = B.t - A.t, ez = B.s - A.s;
        const tq = q.x - V.x, sq = q.z - V.z;
        let u = ((tq - A.t) * ex + (sq - A.s) * ez) / (ex * ex + ez * ez);
        u = Math.min(1, Math.max(0, u));
        if (Math.hypot(tq - (A.t + ex * u), sq - (A.s + ez * u)) < R.half + 0.9) return true;
      }
      return false;
    };
    const runs = (list: P2[]): P2[][] => {
      const out: P2[][] = [];
      let cur: P2[] = [];
      for (const q of list) {
        if (inOther(q)) {
          if (cur.length > 1) out.push(cur);
          cur = [];
        } else cur.push(q);
      }
      if (cur.length > 1) out.push(cur);
      return out;
    };
    const outer: P2[] = [], inner: P2[] = [];
    for (let u = trim; u <= 1 - trimEnd + 1e-6; u += 0.025) {
      outer.push(off(R.half + 0.35, u));
      inner.push(off(-(R.half + 0.6), u));
    }
    for (const run of runs(outer)) battlement(b, 'stone_dark', run, { y: roadY, h: 1.05, thick: 0.7, cap: 'stone_tan' });
    for (const run of runs(inner)) {
      wallFace(b, 'stone_dark', run, {
        top: (x, z) => Math.max(roadY(x, z) + 1.2, heightAt(x - nt * 2.5, z - ns * 2.5) + 0.4),
        bottom: (x, z) => roadY(x, z) - 0.4,
        thick: 1.2,
        collide: true,
        cap: 'stone_tan',
        capH: 0.4,
      });
    }
    if (i % 2 === 0) yield;
  }

  // Hairpin landings: a paved platform at each turn, closed by a curved battlement on the outside.
  for (let k = 1; k < pts.length - 2; k++) {
    const p = pts[k];
    const side = Math.sign(p.t) || 1;
    const c = atAxis(p.t, p.s);
    b.box('stone_tan', { x: c.x, y: p.y - 0.6, z: c.z, sx: R.half * 2 + 2.4, sy: 1.25, sz: R.half * 2 + 2.4 }, { collide: true, walkable: true, solid: true });
    const arc: P2[] = [];
    const rad = R.half + 1.6;
    for (let a = -100; a <= 100.01; a += 20) {
      const th = (a * Math.PI) / 180;
      arc.push(atAxis(p.t + side * Math.cos(th) * rad, p.s + Math.sin(th) * rad));
    }
    battlement(b, 'stone_dark', side > 0 ? arc : arc.reverse(), { y: () => p.y, h: 1.05, thick: 0.7, cap: 'stone_tan' });
  }
  // Watchtowers at the hairpins (outside the turn) and lanterns along the road.
  for (let k = 1; k < pts.length - 2; k++) {
    const p = pts[k];
    if (Math.abs(p.t) < 1) continue;
    const side = Math.sign(p.t) || 1;
    const c = atAxis(p.t + side * (R.half + 6.4), p.s);
    const base = Math.min(heightAt(c.x, c.z), p.y) - 4;
    const top = p.y + 9;
    b.block('stone_dark', { x: c.x, y: base, z: c.z, sx: 6, sy: top - base, sz: 6 }, { collide: true, walkable: true });
    b.box(crimsonMat(), { x: c.x, y: top - 2.2, z: c.z, sx: 6.2, sy: 1.6, sz: 6.2 });
    battlement(b, 'stone_tan', [
      { x: c.x - 3, z: c.z - 3 }, { x: c.x + 3, z: c.z - 3 }, { x: c.x + 3, z: c.z + 3 }, { x: c.x - 3, z: c.z + 3 }, { x: c.x - 3, z: c.z - 3 },
    ], { y: () => top, h: 0.9, thick: 0.5, cap: 'stone_light' });
    roof(b, { x: c.x, y: top + 3.4, z: c.z, w: 4.2, d: 4.2, h: 2.4, style: 'pyramid', mat: 'roof_red', trim: 'gold', tips: 0.35, finial: 1.1 });
    for (const [px, pz] of [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]] as const) b.box('wood_red', { x: c.x + px, y: top + 1.7, z: c.z + pz, sx: 0.32, sy: 3.4, sz: 0.32 });
    brazier(b, cap.flames, { x: c.x, y: top, z: c.z, size: 0.75, style: 'bowl', collide: false });
    cap.mark(`roadTower${k}`, c.x, top, c.z);
  }
  {
    const props = env.chunks.named('props', 'fnc_road_props').builder;
    const d = densify(world, 1);
    let acc = 0;
    for (let i = 1; i < d.length; i++) {
      acc += Math.hypot(d[i].x - d[i - 1].x, d[i].z - d[i - 1].z);
      if (acc < 24) continue;
      acc = 0;
      const q = d[i];
      const y = roadY(q.x, q.z);
      props.lantern(new THREE.Vector3(q.x, y + 2.4, q.z), { color: 'warm', post: false, hanging: false });
    }
  }
  yield;

  // Gate in the crater lip.
  const g = atAxis(0, R.gateS);
  const gy = R.y1;
  for (const side of [-1, 1]) {
    const c = atAxis(side * 6.5, R.gateS);
    b.block('stone_dark', { x: c.x, y: gy - 6, z: c.z, sx: 7, sy: 22, sz: 9 }, { collide: true, walkable: true });
    b.box(crimsonMat(), { x: c.x, y: gy + 12.5, z: c.z, sx: 7.2, sy: 1.6, sz: 9.2 });
    roof(b, { x: c.x, y: gy + 16, z: c.z, w: 6.4, d: 8, h: 3, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 0.5, horns: 0.6 });
    bannerPole(b, { x: c.x + side * 4.2, y: gy, z: c.z + 4.8, yaw: 0, h: 9 });
  }
  b.block('stone_dark', { x: g.x, y: gy + 7, z: g.z, sx: 6.2, sy: 5, sz: 9 }, { collide: true, walkable: true });
  roof(b, { x: g.x, y: gy + 12, z: g.z, w: 20, d: 10, h: 4, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 0.8, horns: 1.2, crest: 2.2 });
  crest(b, { x: g.x, y: gy + 9.5, z: g.z + 4.6, yaw: 0, size: 2.6 });
  // Stair down onto the crater floor.
  const inside = atAxis(0, FNC.floorR - 4);
  b.stairs({ from: new THREE.Vector3(g.x, gy, g.z - 4.2), to: new THREE.Vector3(inside.x, FNC.floorY, inside.z), width: 6, material: 'stone_light', sideMaterial: 'stone_dark' });
  for (const side of [-1, 1]) brazier(b, cap.flames, { x: g.x + side * 4.5, y: gy, z: g.z + 6.5, size: 1 });
  cap.mark('craterGate', g.x, gy, g.z);
  cap.mark('roadStart', ...[atAxis(0, R.s0 + 10).x, R.y0, atAxis(0, R.s0 + 10).z] as [number, number, number]);
}
