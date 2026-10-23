import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import { heightAt } from '../../Heightfield';
import type { AmbientSite, LayerOptions } from './FireRegion';
import type { FlameField } from './flames';
import { mulberry } from './geom';
import { CAPITAL } from './layout';
import { crimsonMat, goldMat, basaltMat } from './materials';
import { flight, hangingLantern, house, pagodaTower, parapet, yawTo } from './parts';

const C = CAPITAL;

/**
 * Terraced city quarters ringing the caldera floor, climbing the inner walls:
 *
 *   r 152–160  ground row: red-and-black houses on the caldera floor (y 42),
 *              with lanes between them;
 *   r 166–179  terrace L1: a walkable stone terrace (retaining wall facing the
 *              city, crimson coping, parapet) reached by tangential stairs that
 *              run along the wall face; houses on its back half;
 *   r 184–214  cliff tier: houses on tall basalt foundations and pagodas
 *              perched on the steep caldera walls (silhouette, not walkable).
 *
 * Everything avoids the central districts (plaza, palace terrace, temple,
 * arena, boulevard) and the gate gap of the causeway road. Geometry is split
 * into angular sectors so the renderer can frustum-cull districts.
 */

/** Gate gap direction (same as the terrain's volcano gate). */
export const GATE_ANGLE = Math.atan2(960 - C.cz, -940 - C.cx);

const R = {
  ground: 156,
  groundDepth: 7.5,
  wall: 166,
  back: 179.6,
  walk: 4,
  stair: 164.6,
  stairW: 2.8,
};

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const BLOCKS: Rect[] = [
  { x0: -1398, x1: -1262, z0: 1138, z1: 1302 }, // plaza, galleries, steps
  { x0: -1426, x1: -1258, z0: 1006, z1: 1148 }, // palace terrace
  { x0: -1482, x1: -1388, z0: 1206, z1: 1260 }, // fire sages' temple & court
  { x0: -1260, x1: -1198, z0: 1150, z1: 1210 }, // agni kai arena
  { x0: -1268, x1: -1230, z0: 1120, z1: 1156 }, // boulevard square
];

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/** True where ring content must not go (central districts, boulevard, gate road). */
export function ringBlocked(x: number, z: number): boolean {
  for (const b of BLOCKS) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true;
  const bv = C.boulevard;
  if (segDist(x, z, bv.a.x + 12, bv.a.z - 4, bv.b.x, bv.b.z) < bv.width / 2 + 7.5 + 7) return true;
  const a = Math.atan2(z - C.cz, x - C.cx);
  if (Math.hypot(x - C.cx, z - C.cz) > 120 && angDiff(a, GATE_ANGLE) < 0.3) return true;
  return false;
}

const polar = (a: number, r: number) => ({ x: C.cx + Math.cos(a) * r, z: C.cz + Math.sin(a) * r });

/** A terrace stair (foot on the caldera floor, landing on terrace L1). */
export interface RingStair {
  foot: { x: number; z: number; y: number };
  landing: { x: number; z: number; y: number };
  /** A point on the L1 walkway just behind the landing. */
  walk: { x: number; z: number; y: number };
}

/**
 * Builds the ring step by step (a generator: the region drives it over several
 * frames when the player is far away, or drains it at once when close).
 * Terrace stairs are appended to `stairsOut` as they are built.
 */
export function* buildCityRing(_ctx: GameContext, layer: (name: string, o?: LayerOptions) => ContentBuilder, _flames: FlameField, _ambient: (s: AmbientSite) => void, stairsOut: RingStair[] = []): Generator<void, RingStair[], void> {
  const SECTORS = 4;
  const layers = new Map<string, ContentBuilder>();
  const sectorOf = (a: number) => Math.floor((((a + Math.PI) / (Math.PI * 2)) * SECTORS) % SECTORS);
  const L = (a: number, kind: 'far' | 'detail'): ContentBuilder => {
    const key = `ring${sectorOf(a)}_${kind}`;
    let b = layers.get(key);
    if (!b) {
      // Ring houses stand against the caldera walls: no shadow casting (saves a shadow pass per sector).
      b = layer(key, kind === 'far' ? { far: true, shadows: false } : {});
      layers.set(key, b);
    }
    return b;
  };
  const rnd = mulberry(4242);
  const STEP = (1 * Math.PI) / 180;
  const N = Math.round((Math.PI * 2) / STEP);
  const angleAt = (i: number) => -Math.PI + (i + 0.5) * STEP;

  // --- Classify each degree of the ring ---------------------------------
  const terraceFree: boolean[] = [];
  const groundFree: boolean[] = [];
  for (let i = 0; i < N; i++) {
    const a = angleAt(i);
    let tf = true;
    for (let r = R.stair - 2; r <= R.back + 0.5; r += 2.5) {
      const p = polar(a, r);
      if (ringBlocked(p.x, p.z)) tf = false;
    }
    terraceFree.push(tf);
    let gf = tf;
    for (let r = R.ground - R.groundDepth / 2 - 1; r <= R.ground + R.groundDepth / 2 + 1; r += 2) {
      const p = polar(a, r);
      if (ringBlocked(p.x, p.z)) gf = false;
    }
    groundFree.push(gf);
  }
  const runs = (flags: boolean[], minLen: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    // Start scanning at a blocked degree so runs never wrap around.
    let s0 = flags.findIndex((f) => !f);
    if (s0 < 0) s0 = 0;
    let start = -1;
    for (let k = 0; k <= N; k++) {
      const i = (s0 + k) % N;
      const f = k < N && flags[i];
      if (f && start < 0) start = s0 + k;
      if (!f && start >= 0) {
        if (s0 + k - start >= minLen) out.push([start, s0 + k - 1]);
        start = -1;
      }
    }
    return out;
  };

  // --- Terrace L1 runs ----------------------------------------------------
  for (const [i0, i1] of runs(terraceFree, 9)) {
    const a0 = angleAt(i0) - STEP / 2 + STEP * 0.6, a1 = angleAt(i1) + STEP / 2 - STEP * 0.6;
    // Constant top per run: clear of the terrain under the whole footprint.
    let top = 47.6;
    for (let a = a0; a <= a1; a += STEP / 2) for (let r = R.wall; r <= R.back; r += 1.2) {
      const p = polar(a, r);
      top = Math.max(top, heightAt(p.x, p.z) + 0.35);
    }
    top = Math.round(top * 10) / 10;
    const segs = Math.max(1, Math.ceil((a1 - a0) / (STEP * 2)));
    const da = (a1 - a0) / segs;
    const rMid = (R.wall + R.back) / 2, depth = R.back - R.wall;
    for (let k = 0; k < segs; k++) {
      const am = a0 + (k + 0.5) * da;
      const p = polar(am, rMid);
      const yaw = -am; // local +X = radial direction (cos a, sin a) → yaw = -a
      const w = 2 * R.back * Math.sin(da / 2) + 0.12;
      const s = L(am, 'far');
      s.box('stone_tan', { x: p.x, y: (41.4 + top) / 2, z: p.z, sx: depth, sy: top - 41.4, sz: w, yaw }, { collide: true, walkable: true, surface: 'stone' });
      // Wall dressing on the face: basalt plinth, crimson band, gold line.
      const f = polar(am, R.wall - 0.12);
      const wf = 2 * R.wall * Math.sin(da / 2) + 0.1;
      s.box(basaltMat(), { x: f.x, y: 42.6, z: f.z, sx: 0.5, sy: 1.6, sz: wf, yaw });
      s.box(crimsonMat(), { x: f.x, y: top - 0.55, z: f.z, sx: 0.4, sy: 1.0, sz: wf, yaw });
      s.box(goldMat(), { x: f.x, y: top - 1.12, z: f.z, sx: 0.44, sy: 0.12, sz: wf, yaw }, { castShadow: false });
    }
    // Stairs along the wall face: one near each end, more along long runs.
    const runLen = (a1 - a0) * R.wall;
    const rise = top - 42;
    const stairRun = rise / 0.62;
    const stairDa = stairRun / R.stair;
    const landDa = 3.2 / R.stair;
    const stairs: Array<{ foot: number; dir: 1 | -1 }> = [];
    if (runLen > stairRun + 12) {
      stairs.push({ foot: a0 + 1.2 / R.stair, dir: 1 });
      if (runLen > 2 * stairRun + 30) stairs.push({ foot: a1 - 1.2 / R.stair, dir: -1 });
      const extra = Math.floor(runLen / 70) - 1;
      for (let e = 1; e <= extra; e++) {
        const am = a0 + ((a1 - a0) * e) / (extra + 1);
        stairs.push({ foot: am - (stairDa / 2) * (e % 2 ? 1 : -1), dir: e % 2 ? 1 : -1 });
      }
    }
    const landings: Array<[number, number]> = [];
    for (const st of stairs) {
      const aTop = st.foot + st.dir * stairDa;
      const pf = polar(st.foot, R.stair), pt = polar(aTop, R.stair);
      const s = L(st.foot, 'far');
      flight(s, { from: new THREE.Vector3(pf.x, 42.0, pf.z), to: new THREE.Vector3(pt.x, top, pt.z), width: R.stairW, mat: 'stone_tan', step: 0.2 });
      const aLand = aTop + st.dir * (landDa / 2);
      const pl = polar(aLand, R.stair);
      s.box('stone_tan', { x: pl.x, y: (41.4 + top) / 2, z: pl.z, sx: R.stairW, sy: top - 41.4, sz: 3.3, yaw: -aLand }, { collide: true, walkable: true });
      landings.push([aLand - landDa * 0.75, aLand + landDa * 0.75]);
      const wk = polar(aLand, R.wall + 2.2);
      stairsOut.push({ foot: { x: pf.x, z: pf.z, y: 42 }, landing: { x: pl.x, z: pl.z, y: top }, walk: { x: wk.x, z: wk.z, y: top } });
      // Lantern posts at the foot and top.
      const d = L(st.foot, 'detail');
      const lf = polar(st.foot - st.dir * 0.9 / R.stair, R.stair - 1.9);
      hangingLantern(d, { x: lf.x, y: 44.2, z: lf.z });
      const lt = polar(aLand, R.wall + 0.6);
      hangingLantern(d, { x: lt.x, y: top + 2.3, z: lt.z, s: 0.9 });
    }
    // Front parapet on L1 (gaps at the landings).
    const inLanding = (a: number) => landings.some(([l0, l1]) => a > l0 && a < l1);
    let pts: Array<{ x: number; z: number }> = [];
    const flush = () => {
      if (pts.length >= 2) parapet(L(Math.atan2(pts[0].z - C.cz, pts[0].x - C.cx), 'far'), pts, { y: top, h: 0.95, thick: 0.45, mat: crimsonMat(), cap: goldMat() });
      pts = [];
    };
    for (let a = a0; a <= a1 + 1e-6; a += STEP) {
      const aa = Math.min(a, a1);
      if (inLanding(aa)) {
        flush();
        continue;
      }
      pts.push(polar(aa, R.wall + 0.25));
      if (pts.length >= 6) {
        const last = pts[pts.length - 1];
        flush();
        pts.push(last);
      }
    }
    flush();
    // Houses on the back half of the terrace, facing the city.
    let a = a0 + 2.5 / R.back;
    while (a < a1 - 4 / R.back) {
      const w = 7 + rnd() * 3.5;
      const dA = (w + 1.6 + rnd() * 2.2) / (R.back - 4);
      const ac = a + (w / 2) / (R.back - 4);
      if (ac + (w / 2) / (R.back - 4) > a1) break;
      const nearLanding = landings.some(([l0, l1]) => ac > l0 - 6 / R.back && ac < l1 + 6 / R.back);
      if (!nearLanding) {
        const hr = R.back - 4.3;
        const p = polar(ac, hr);
        const floors = rnd() < 0.55 ? 2 : 1;
        const red = rnd() < 0.6;
        house(L(ac, 'far'), { x: p.x, y: top, z: p.z, yaw: yawTo(p.x, p.z, C.cx, C.cz), w, d: 7.2, floors, wall: red ? crimsonMat() : 'plaster_cream', upperWall: red ? 'plaster_cream' : crimsonMat(), roofMat: rnd() < 0.7 ? 'roof_dark' : 'roof_red', seed: 3000 + Math.round(ac * 1000), ornate: rnd() < 0.25, foundation: 0.3, post: crimsonMat(), door: 'wood_dark', base: basaltMat() }, L(ac, 'detail'));
        if (rnd() < 0.5) {
          const lp = polar(ac + (w / 2 + 0.4) / hr, R.wall + 3.4);
          hangingLantern(L(ac, 'detail'), { x: lp.x, y: top + 2.6, z: lp.z, s: 0.85 });
        }
      }
      a += dA;
    }
    yield;
  }

  // --- Ground row on the caldera floor ------------------------------------
  for (const [i0, i1] of runs(groundFree, 4)) {
    const a0 = angleAt(i0) - STEP / 2, a1 = angleAt(i1) + STEP / 2;
    let a = a0 + 1 / R.ground;
    let n = 0;
    while (a < a1) {
      const w = 7.5 + rnd() * 3;
      const ac = a + (w / 2) / R.ground;
      if (ac + (w / 2 + 0.5) / R.ground > a1) break;
      n++;
      // Every third slot is a lane through to the terrace stairs.
      if (n % 3 === 0) {
        const lp = polar(ac, R.ground + 2);
        if (rnd() < 0.7) hangingLantern(L(ac, 'detail'), { x: lp.x, y: 45.2, z: lp.z, s: 0.9 });
        a += 5 / R.ground;
        continue;
      }
      const p = polar(ac, R.ground);
      const y = Math.max(42, heightAt(p.x, p.z));
      const red = rnd() < 0.55;
      house(L(ac, 'far'), { x: p.x, y: y + 0.05, z: p.z, yaw: yawTo(p.x, p.z, C.cx, C.cz), w, d: R.groundDepth, floors: rnd() < 0.45 ? 2 : 1, wall: red ? crimsonMat() : 'plaster_cream', upperWall: red ? 'plaster_cream' : crimsonMat(), roofMat: rnd() < 0.6 ? 'roof_dark' : 'roof_red', seed: 5000 + Math.round(ac * 1000), ornate: rnd() < 0.2, foundation: 0.5, post: crimsonMat(), door: 'wood_dark', base: basaltMat() }, L(ac, 'detail'));
      a += (w + 1.2 + rnd() * 1.5) / R.ground;
      if (n % 6 === 0) yield;
    }
  }

  // --- Cliff tier: rows of houses on stone podiums built into the caldera walls ---
  const cliffRnd = mulberry(777);
  const streamA = Math.atan2(1000 - C.cz, -1180 - C.cx);
  const rows = [
    { r: 185, spacing: 12, off: 0 },
    { r: 195, spacing: 13.5, off: 0.5 },
    { r: 205, spacing: 15, off: 0.25 },
  ];
  let built = 0;
  for (const row of rows) {
    const dA = row.spacing / row.r;
    let prev: { a: number; y: number; lo: number; pw: number } | null = null;
    for (let a = -Math.PI + row.off * dA; a < Math.PI; a += dA * (0.85 + cliffRnd() * 0.3)) {
      if (angDiff(a, GATE_ANGLE) < 0.36 || angDiff(a, streamA) < 0.12) continue;
      if (cliffRnd() < 0.2) continue;
      const pag = cliffRnd() < 0.09;
      const w = pag ? 8 : 6.5 + cliffRnd() * 3;
      const r = row.r + (cliffRnd() - 0.5) * 3;
      const p = polar(a, r);
      const yaw = yawTo(p.x, p.z, C.cx, C.cz);
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const at = (lx: number, lz: number) => heightAt(p.x + lx * c + lz * sn, p.z - lx * sn + lz * c);
      // Local +Z faces the city (downhill). Floor just above the front edge; the back sinks into the rock.
      const front = Math.max(at(-w / 2, 3.2), at(w / 2, 3.2), at(0, 3.2));
      const back = Math.min(at(-w / 2, -3.2), at(w / 2, -3.2));
      const y = front + Math.min(3.5, Math.max(0.4, (back - front) * 0.22));
      // Bottom well below the ground in front and to the sides (the slope also falls away laterally).
      const lo = Math.min(at(-w / 2 - 1.5, 5), at(w / 2 + 1.5, 5), at(0, 5), at(-w / 2 - 1.5, 9), at(w / 2 + 1.5, 9), at(0, 9), front) - 4;
      if (y > 150 || y < 50) continue;
      const s = L(a, 'far');
      const pd = pag ? 11 : 9, pw = pag ? 11 : w + 3;
      // Join neighbouring podiums of the row into a continuous terrace band.
      if (prev && (a - prev.a) * row.r < row.spacing * 1.7) {
        const gap = (a - prev.a) * row.r - (prev.pw + pw) / 2;
        if (gap > 0.3) {
          const am = prev.a + (prev.pw / 2 + gap / 2) / row.r;
          const q = polar(am, row.r - 0.2);
          const qy = yawTo(q.x, q.z, C.cx, C.cz);
          const bLo = Math.min(lo, prev.lo), bTop = Math.min(y, prev.y) - 0.7;
          if (bTop - bLo > 1) {
            s.block('stone_tan', { x: q.x, y: bLo, z: q.z, sx: gap + 0.6, sy: bTop - bLo, sz: 6, yaw: qy }, { collide: true, walkable: true });
            s.block(crimsonMat(), { x: q.x, y: bTop, z: q.z, sx: gap + 0.6, sy: 0.6, sz: 6.1, yaw: qy }, { collide: true, walkable: true });
          }
        }
      }
      prev = { a, y, lo, pw };
      const pc = { x: p.x + 0.6 * sn, z: p.z + 0.6 * c };
      s.block('stone_tan', { x: pc.x, y: lo, z: pc.z, sx: pw, sy: y - 0.7 - lo, sz: pd, yaw }, { collide: true, walkable: true });
      s.block(basaltMat(), { x: pc.x, y: lo - 0.2, z: pc.z, sx: pw + 0.3, sy: 1.6, sz: pd + 0.3, yaw });
      s.block(crimsonMat(), { x: pc.x, y: y - 0.72, z: pc.z, sx: pw + 0.2, sy: 0.72, sz: pd + 0.2, yaw }, { collide: true, walkable: true });
      s.box(goldMat(), { x: pc.x, y: y - 0.76, z: pc.z, sx: pw + 0.26, sy: 0.1, sz: pd + 0.26, yaw }, { castShadow: false });
      if (pag) {
        pagodaTower(s, { x: p.x, y, z: p.z, yaw, size: 7, tiers: 3 + Math.floor(cliffRnd() * 2), tierH: 3.5, wall: crimsonMat(), roofMat: 'roof_dark', spire: 4 });
        continue;
      }
      if (++built % 5 === 0) yield;
      const red = cliffRnd() < 0.6;
      house(s, { x: p.x, y, z: p.z, yaw, w, d: 6.4, floors: cliffRnd() < 0.55 ? 2 : 1, wall: red ? crimsonMat() : 'plaster_cream', upperWall: red ? 'plaster_cream' : crimsonMat(), roofMat: cliffRnd() < 0.75 ? 'roof_dark' : 'roof_red', seed: 7000 + Math.round(a * 1000) + row.r, base: null, post: crimsonMat(), door: 'wood_dark' }, L(a, 'detail'));
      if (cliffRnd() < 0.4) {
        const lp = { x: p.x + 4.2 * sn + (w / 2 - 0.6) * c, z: p.z + 4.2 * c - (w / 2 - 0.6) * sn };
        hangingLantern(L(a, 'detail'), { x: lp.x, y: y + 2.4, z: lp.z, s: 0.9 });
      }
    }
  }
  return stairsOut;
}
