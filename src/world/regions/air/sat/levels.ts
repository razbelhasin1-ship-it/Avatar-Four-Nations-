import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import { heightAt } from '../../../Heightfield';
import { boulder } from '../../water/geometry';
import * as G from '../geom';
import * as P from '../parts';
import { am, repeatProp, type Kit } from '../parts';
import type { P2 } from '../../../WorldLayout';
import { archBridge, archedLoggia, bench, gateArch, lp, orchardTree, pagodaHall, smallShrine, stableCave, swirl, towardYaw, vegetableBed, type HallOpts } from './kit';
import { BASE, C, DEG, LEVEL_Y, ROAD, SEED, TOWER, TRAIL_TOP, floorY, polar, rOutAt, radiusOf, rockTop, shelf, summitRAt, terrace, thetaOf, yawOut } from './layout';

/**
 * What stands on each level of the Southern Air Temple (plan in layout.ts):
 *  L0  the temple gate astride the top of the pilgrims' trail, the gate plaza, an outlook pavilion
 *      on a rock pillar off the mesa rim, the quarters' waterfall falling into the clouds
 *  L1  the bison terrace: arched loggia, feeding dais, pond, troughs, hay, stable caves in the
 *      courts' cliff, two landing ledges, a watchtower
 *  L2  orchards, vegetable beds, the refectory and the kitchens, the orchard pool under a fall
 *  L3  the monks' quarters (pagoda halls with balconies), a practice yard, the airball court
 *  L4  entrance courtyard (gate, fountain, the statue of Monk Gyatso, the gong, a cloister),
 *      moon-gate courtyard (drum terrace with a curved double stair), labyrinth courtyard with
 *      the vine-wrapped teal pavilion (and the sanctuary door, sanctuary.ts), the gardens
 *  L5  the great hall, a library, meditation terraces, the spring that feeds the orchard fall
 *  L6  the central tower on its drum, the great-bell pavilion, two slender towers, the summit
 *      gate and the glider launch
 */

const FL = (lvl: number): number => floorY(LEVEL_Y[lvl]);
const edgeOf = (id: string, th: number): number => rOutAt(terrace(id), th);
const v3 = (th: number, r: number, y: number): THREE.Vector3 => {
  const p = polar(th, r);
  return new THREE.Vector3(p.x, y, p.z);
};
/** Yaw turning local +Z along increasing θ. */
const along = (th: number): number => yawOut(th + 90);

/** Pagoda hall facing outward at bearing θ with its plinth's back at radius `back`; returns its centre radius. */
function hallOut(k: Kit, th: number, back: number, y: number, o: Omit<HallOpts, 'x' | 'z' | 'y' | 'yaw'>): number {
  const r = back + o.d / 2 + 0.8;
  const p = polar(th, r);
  pagodaHall(k, { ...o, x: p.x, z: p.z, y, yaw: yawOut(th) });
  return r;
}

/** Points along an arc (θ in degrees). */
function arc(r: number, a0: number, a1: number, step = 2): P2[] {
  const n = Math.max(1, Math.round(Math.abs(a1 - a0) / step));
  return Array.from({ length: n + 1 }, (_, i) => polar(a0 + ((a1 - a0) * i) / n, r));
}

// ---------------------------------------------------------------------------
// Interaction sites (shared with the region's session content)
// ---------------------------------------------------------------------------

export const SITES = {
  gong: { th: 184, r: 46.5 },
  wheels: { th: 294, r: 30.4 },
  /** Meditation terraces on L5 (bearings); radius from meditationSpots(). */
  meditation: [40, 54, 86],
};

/** Centres of the L5 meditation terraces. */
export function meditationSpots(): Array<{ x: number; z: number; y: number; th: number; r: number }> {
  return SITES.meditation.map((th) => {
    const r = Math.min(46.2, edgeOf('halls', th) - 4.7);
    return { ...polar(th, r), y: FL(5) + 0.6, th, r };
  });
}

// ---------------------------------------------------------------------------
// L0: the gate plaza, the outlook, the quarters' waterfall
// ---------------------------------------------------------------------------

export function buildGatePlaza(k: Kit, rock: THREE.Material): void {
  const y = FL(0);
  const T = TRAIL_TOP;
  const dx = T.b.x - T.a.x, dz = T.b.z - T.a.z, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  // The temple gate astride the top of the trail's stair trench (passage along the trail).
  let s = len;
  while (s > 0 && radiusOf(T.a.x + ux * s, T.a.z + uz * s) < 86.6) s -= 0.1;
  const g = { x: T.a.x + ux * s, z: T.a.z + uz * s };
  const gy = Math.atan2(ux, uz);
  gateArch(k, { x: g.x, z: g.z, y, yaw: gy, w: 7.8, h: 7.2 });
  for (const side of [-1, 1]) {
    const b = lp(g.x, g.z, gy, side * 4.7, -0.86);
    P.banner(k, b.x, y + 4.4, b.z, gy + Math.PI, 1.1, 3.6, 'bannerYellow');
    const st = lp(g.x, g.z, gy, side * 7.6, -2.2);
    k.main.box('stone_white', { x: st.x, y: y + 0.4, z: st.z, sx: 2.6, sy: 0.8, sz: 3.6, yaw: gy }, { collide: true, walkable: true });
    P.bisonStatue(k, st.x, y + 0.8, st.z, gy + Math.PI, 0.5);
  }
  // Lanterns along the plaza, pines in planters, a bench.
  for (let a = 184; a <= 224; a += 6.5) P.stoneLantern(k, polar(a, 76.4).x, y, polar(a, 76.4).z);
  for (const a of [181, 190, 196, 213, 219, 225]) {
    const p = polar(a, 88.4);
    P.stoneLantern(k, p.x, y, p.z);
  }
  P.pine(k, polar(180.5, 75).x, y, polar(180.5, 75).z, 0, 1.25);
  P.pine(k, polar(226.5, 75).x, y, polar(226.5, 75).z, 1, 1.3);
  P.pine(k, polar(186, 91).x, y, polar(186, 91).z, 2, 1.0);
  P.pine(k, polar(222, 91).x, y, polar(222, 91).z, 0, 1.1);
  bench(k, polar(199, 75.6).x, y, polar(199, 75.6).z, yawOut(199) + 0);
  bench(k, polar(210, 75.6).x, y, polar(210, 75.6).z, yawOut(210));
  buildOutlook(k, rock);
  buildQuartersFalls(k);
}

/** Irregular rock pillar (tapered prism, radial noise), base at y = 0, top flat at h. */
function pillarGeometry(seed: number, r: number, h: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r * 1.4, h, 20, Math.max(4, Math.round(h / 4)), false);
  g.translate(0, h / 2, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const rnd = (x: number) => Math.sin(x * 12.9898 + seed) * 43758.5453 % 1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), yy = pos.getY(i), z = pos.getZ(i);
    const rr = Math.hypot(x, z);
    if (rr < 0.01 || yy > h - 0.01) continue;
    const a = Math.atan2(z, x);
    const n = 1 + 0.12 * Math.sin(a * 3 + yy * 0.11 + seed) + 0.07 * Math.sin(a * 7 - yy * 0.23) + 0.04 * Math.abs(rnd(a * 5 + yy));
    pos.setXYZ(i, x * n, yy, z * n);
  }
  g.computeVertexNormals();
  return g;
}

/** A pavilion on a rock pillar off the mesa rim, reached by an arched bridge. */
function buildOutlook(k: Kit, rock: THREE.Material): void {
  const y = FL(0);
  const th = 160, rr = 117, pr = 7;
  const o = polar(th, rr);
  const base = heightAt(o.x, o.z) - 12;
  const g = pillarGeometry(SEED % 97, pr, y - 0.4 - base);
  k.main.mesh(rock, g, { x: o.x, y: base, z: o.z });
  g.dispose();
  k.main.collider({ shape: 'cylinder', x: o.x, y: (y + base) / 2, z: o.z, r: pr, hy: (y - base) / 2, walkable: true, solid: true, surface: 'rock' });
  P.disc(k, o.x, o.z, y, pr - 0.25, 'paving', 0.5, 32);
  archBridge(k, v3(th, 88.4, y), v3(th, rr - pr + 0.6, y), 3.2);
  const toBridge = yawOut(th + 180);
  P.pavilion(k, { x: o.x, z: o.z, y, r: 3.0, h: 3.0, steps: 1, entrances: [toBridge] });
  // Railing round the rim, open toward the bridge.
  const pts = Array.from({ length: 25 }, (_, i) => ({ x: o.x + Math.cos((i / 24) * Math.PI * 2) * (pr - 0.45), z: o.z + Math.sin((i / 24) * Math.PI * 2) * (pr - 0.45) }));
  P.balustrade(k, pts, {
    y,
    skip: (i) => {
      const a = ((i + 0.5) / 24) * Math.PI * 2;
      const d = Math.atan2(Math.sin(a - (th + 180) * DEG), Math.cos(a - (th + 180) * DEG));
      return Math.abs(d) < 0.32;
    },
  });
  P.pine(k, o.x + Math.cos((th + 70) * DEG) * 4.6, y, o.z + Math.sin((th + 70) * DEG) * 4.6, 1, 0.9);
  P.prayerFlags(k, new THREE.Vector3(o.x, y + 4.6, o.z), v3(th, 89.6, y + 3.4), 1.6);
  k.main.box('wood_red', { x: polar(th, 89.6).x, y: y + 1.75, z: polar(th, 89.6).z, sx: 0.18, sy: 3.5, sz: 0.18 }, { collide: true, walkable: false });
}

/**
 * Spring on the quarters' terrace: pool, rill to the edge, a fall down the cliff, a cascade
 * over the rock cone and a last fall off the mesa rim into the clouds.
 */
function buildQuartersFalls(k: Kit): void {
  const th = 149;
  const y3 = FL(3);
  const edge = edgeOf('quarters', th);
  const pool = polar(th, 68.6);
  P.roundPool(k, { id: 'air:sat_quarters_spring', label: 'Spring pool', x: pool.x, z: pool.z, y: y3, r: 1.9, rimH: 0.4 });
  P.canal(k, { id: 'air:sat_quarters_rill', label: 'Rill', a: polar(th, 70.9), b: polar(th, edge + 0.1), y: y3, width: 0.8, wallH: 0.35, register: false });
  const lip = polar(th, edge + 0.25);
  const foot = BASE + rockTop(th, edge + 2.4);
  P.waterfall(k, { id: 'air:sat_quarters_falls', label: 'Quarters falls', x: lip.x, y: y3 + 0.05, z: lip.z, yaw: yawOut(th), width: 1.2, drop: y3 - foot, out: 0.9 });
  const c0 = polar(th, edge + 2.0);
  const ground = (x: number, z: number) => {
    const r = radiusOf(x, z);
    return r < 89.5 ? BASE + rockTop(thetaOf(x, z), r) : heightAt(x, z);
  };
  P.cascade(k, { id: 'air:sat_quarters_cascade', label: 'Cascade', x: c0.x, z: c0.z, y: ground(c0.x, c0.z), dirX: Math.cos(th * DEG), dirZ: Math.sin(th * DEG), width: 1.8, length: 90.5 - edge - 2.0, heightAt: ground, register: false });
  const rim = polar(th, 90.6);
  P.waterfall(k, { id: 'air:sat_rim_falls', label: 'Rim falls', x: rim.x, y: BASE + 0.05, z: rim.z, yaw: yawOut(th), width: 2.0, drop: 165, out: 2.0, register: false });
}

// ---------------------------------------------------------------------------
// L1: the bison terrace
// ---------------------------------------------------------------------------

export function buildBisonTerrace(k: Kit): void {
  const y = FL(1);
  // Arched loggia against the courts' cliff, open to the landing ledges.
  const lth = 300, d = 10;
  const back = edgeOf('courts', lth) + 0.4;
  const lc = polar(lth, back + d / 2);
  archedLoggia(k, { x: lc.x, z: lc.z, y, yaw: yawOut(lth), w: 26, d, h: 9 });
  for (const u of [-8.67, 0, 8.67]) {
    const q = lp(lc.x, lc.z, yawOut(lth), u, -1);
    P.hayStack(k, q.x, y, q.z, yawOut(lth) + u * 0.1, 1);
    const l = lp(lc.x, lc.z, yawOut(lth), u, 2.9);
    P.hangingLantern(k, l.x, y + 6.6, l.z, 'warm');
  }
  // Feeding dais in front of it with hay.
  const fd = polar(lth, Math.min(back + d + 3.8, 76.5));
  const top = P.steppedDisc(k, { x: fd.x, z: fd.z, y, r: 2.6, steps: 1, stepH: 0.3, top: 'paving' });
  P.hayStack(k, fd.x, top, fd.z, 0.4, 2);
  // Pond, troughs, the hay yard.
  const pond = polar(275.5, 71.5);
  P.roundPool(k, { id: 'air:sat_bison_pond', label: 'Bison pond', x: pond.x, z: pond.z, y, r: 3.2, rimH: 0.5 });
  trough(k, 'air:sat_trough_1', polar(281, 75.2), y, along(281));
  trough(k, 'air:sat_trough_2', polar(318.5, 73.8), y, along(318.5));
  for (const [a, r, lv] of [[285.5, 69.8, 2], [288.5, 73.5, 1], [313.5, 70.5, 2]] as const) {
    const p = polar(a, r);
    P.hayStack(k, p.x, y, p.z, yawOut(a) + 0.3, lv);
  }
  for (const [a, r] of [[292, 74.6], [290.5, 70.5], [316, 73]] as const) {
    const p = polar(a, r);
    P.hayBale(k, p.x, y, p.z, yawOut(a) + 0.8);
  }
  // Stable caves in the courts' cliff.
  for (const a of [318, 326.2, 334.4]) {
    const r = edgeOf('courts', a) + 1.2;
    const p = polar(a, r);
    stableCave(k, { x: p.x, z: p.z, y, yaw: yawOut(a), w: 5.2, h: 6.4 });
  }
  // Watchtower at the terrace's west end.
  const wt = polar(266, 68);
  P.roundTower(k, { x: wt.x, z: wt.z, y, r: 3.3, h: 26, roofH: 8.5, bands: 4, windows: 4, balcony: true, door: yawOut(266), base: 1.2 });
  // Landing ledges: swirl markings, lanterns at the outer corners, a wind pennant.
  for (const id of ['landing_main', 'landing_ne']) {
    const s = shelf(id);
    const rm = (s.r0 + s.r1) / 2;
    const c = polar(s.a, rm + 1);
    swirl(k, c.x, floorY(s.y) + 0.04, c.z, 4.2, yawOut(s.a));
    for (const side of [-1, 1]) {
      const q = lp(polar(s.a, rm).x, polar(s.a, rm).z, yawOut(s.a), side * (s.w / 2 - 0.9), (s.r1 - s.r0) / 2 - 0.9);
      P.lanternPost(k, q.x, floorY(s.y), q.z, 'warm');
    }
    const fl = lp(polar(s.a, rm).x, polar(s.a, rm).z, yawOut(s.a), s.w / 2 - 0.9, -(s.r1 - s.r0) / 2 + 3);
    k.main.box('wood_dark', { x: fl.x, y: floorY(s.y) + 3, z: fl.z, sx: 0.16, sy: 6, sz: 0.16 }, { collide: true, walkable: false });
    P.banner(k, fl.x, floorY(s.y) + 5.0, fl.z, yawOut(s.a + 90), 0.7, 1.8, 'bannerYellow');
  }
  // Lanterns along the road through the terrace.
  for (let a = 266; a <= 322; a += 8) {
    if (Math.abs(a - 280) < 6 || Math.abs(a - 322) < 6) continue;
    const p = polar(a, 78.6);
    P.lanternPost(k, p.x, y, p.z, 'warm');
  }
}

/** Stone water trough (hollow, filled; a real water source). */
function trough(k: Kit, id: string, p: P2, y: number, yaw: number): void {
  const L = 3.4, W = 1.0, H = 0.72;
  const b = k.main;
  b.box('stone_light', { x: p.x, y: y + 0.12, z: p.z, sx: W, sy: 0.24, sz: L, yaw });
  for (const s of [-1, 1]) {
    const q = lp(p.x, p.z, yaw, s * (W / 2 - 0.08), 0);
    b.box('stone_white', { x: q.x, y: y + H / 2, z: q.z, sx: 0.16, sy: H, sz: L, yaw });
    const e = lp(p.x, p.z, yaw, 0, s * (L / 2 - 0.08));
    b.box('stone_white', { x: e.x, y: y + H / 2, z: e.z, sx: W - 0.32, sy: H, sz: 0.16, yaw });
  }
  b.collider({ shape: 'box', x: p.x, y: y + H / 2, z: p.z, hx: W / 2, hy: H / 2, hz: L / 2, yaw, walkable: true, solid: true, surface: 'stone' });
  const wy = y + H - 0.14;
  const w = new THREE.Mesh(G.waterRect(W - 0.32, L - 0.32, 0), am('water'));
  w.position.set(p.x, wy, p.z);
  w.rotation.y = yaw;
  w.renderOrder = 2;
  k.addMesh(w, 'main');
  k.registerWater({ id, type: 'pond', label: 'Water trough', x: p.x, y: wy, z: p.z, r: 0.5, capacity: 40, regen: 1.5 });
}

// ---------------------------------------------------------------------------
// L2: orchards, vegetable beds, refectory, kitchens
// ---------------------------------------------------------------------------

export function buildOrchards(k: Kit): void {
  const y = FL(2);
  const rnd = new Random(SEED + 202);
  // Refectory and kitchens against the halls' cliff.
  const rr = hallOut(k, 14, edgeOf('halls', 14) + 0.4, y, { w: 16, d: 9, storeys: 1, roof: 'slate' });
  const rk = hallOut(k, 36, edgeOf('halls', 36) + 0.4, y, { w: 11, d: 7, storeys: 1, roof: 'slate' });
  for (const s of [-1, 1]) {
    const c = lp(polar(36, rk).x, polar(36, rk).z, yawOut(36), s * 3, -1.4);
    k.main.box('stone_white', { x: c.x, y: y + 7.6, z: c.z, sx: 0.9, sy: 3.2, sz: 0.9, yaw: yawOut(36) });
    k.main.box('stone_dark', { x: c.x, y: y + 9.25, z: c.z, sx: 1.1, sy: 0.18, sz: 1.1, yaw: yawOut(36) });
  }
  // Long tables with benches in front of the refectory.
  for (const a of [9.5, 18.5]) {
    const p = polar(a, rr + 9.2);
    const yaw = yawOut(a);
    k.props.box('wood', { x: p.x, y: y + 0.78, z: p.z, sx: 1.1, sy: 0.1, sz: 5.2, yaw });
    for (const s of [-1, 1]) {
      const q = lp(p.x, p.z, yaw, s * 0.95, 0);
      k.props.box('wood_dark', { x: q.x, y: y + 0.42, z: q.z, sx: 0.36, sy: 0.08, sz: 5.0, yaw });
      for (const e of [-1, 1]) {
        const l = lp(p.x, p.z, yaw, s * 0.4, e * 2.3);
        k.props.box('wood_dark', { x: l.x, y: y + 0.38, z: l.z, sx: 0.1, sy: 0.76, sz: 0.1, yaw });
      }
    }
    k.main.collider({ shape: 'box', x: p.x, y: y + 0.42, z: p.z, hx: 1.2, hy: 0.42, hz: 2.6, yaw, walkable: true, solid: true });
  }
  // Vegetable beds between the kitchens and the stairs.
  for (let i = 0; i < 6; i++) {
    const a = 45 + i * 2.7;
    const p = polar(a, edgeOf('halls', a) + 6.4);
    vegetableBed(k, p.x, y, p.z, yawOut(a), 4.6);
  }
  // Orchard A (north-west of the refectory) and B (east, round the pool under the hall fall).
  const trees = (a0: number, a1: number, rows: number[], skip: (p: P2) => boolean) => {
    for (const r of rows) {
      const step = 4.6 / r / DEG;
      for (let a = a0; a <= a1; a += step) {
        const p = polar(a + rnd.range(-0.4, 0.4), r + rnd.range(-0.5, 0.5));
        if (skip(p)) continue;
        orchardTree(k, p.x, y, p.z, rnd.range(0.85, 1.15), rnd.chance(0.45), rnd.range(0, 6.28));
      }
    }
  };
  // A slender tower at the orchard's west end.
  const t1 = polar(347, 58);
  P.roundTower(k, { x: t1.x, z: t1.z, y, r: 3.0, h: 28, roofH: 8.6, bands: 5, windows: 5, balcony: true, door: yawOut(347) });
  trees(345, 4.5, [58.5, 62.8, 67, 70.8], (p) => radiusOf(p.x, p.z) < edgeOf('halls', thetaOf(p.x, p.z)) + 3 || Math.hypot(p.x - t1.x, p.z - t1.z) < 5.4);
  const pool = polar(70, edgeOf('halls', 70) + 2.6);
  trees(60, 89, [edgeOf('halls', 75) + 4.5, 61.2], (p) => Math.hypot(p.x - pool.x, p.z - pool.z) < 5.2 || radiusOf(p.x, p.z) < edgeOf('halls', thetaOf(p.x, p.z)) + 3);
  P.roundPool(k, { id: 'air:sat_orchard_pool', label: 'Orchard pool', x: pool.x, z: pool.z, y, r: 2.6, rimH: 0.4 });
  // Lanterns along the road.
  for (const a of [24, 31, 40]) {
    const p = polar(a, 65.4);
    P.lanternPost(k, p.x, y, p.z, 'warm');
  }
}

// ---------------------------------------------------------------------------
// L3: quarters, practice yard, airball court
// ---------------------------------------------------------------------------

export function buildQuarters(k: Kit): void {
  const y = FL(3);
  const rnd = new Random(SEED + 303);
  hallOut(k, 101.5, 46.4, y, { w: 15, d: 9, storeys: 2, roof: 'slate', balcony: true });
  hallOut(k, 122, 46.4, y, { w: 14, d: 9, storeys: 2, roof: 'slate', balcony: true });
  hallOut(k, 164, 46.2, y, { w: 13, d: 7.5, storeys: 2, roof: 'blue' });
  // Practice yard: a ringed disc with training posts.
  const py = polar(145, 53);
  P.disc(k, py.x, py.z, y + 0.06, 5.2, am('courtRings'), 0.14, 48);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    P.pole(k, py.x + Math.cos(a) * 5.9, y, py.z + Math.sin(a) * 5.9, 1.4 + (i % 2) * 0.5);
  }
  bench(k, polar(137, 47.6).x, y, polar(137, 47.6).z, towardYaw(polar(137, 47.6), py));
  bench(k, polar(153, 47.6).x, y, polar(153, 47.6).z, towardYaw(polar(153, 47.6), py));
  // Airball court on its shelf: a field of poles of many heights, a hoop at each end.
  const s = shelf('airball');
  const rm = (s.r0 + s.r1) / 2;
  const c = polar(s.a, rm);
  const yaw = yawOut(s.a);
  const sy = floorY(s.y);
  for (let iu = -4; iu <= 4; iu++) {
    for (let iv = -2; iv <= 2; iv++) {
      const q = lp(c.x, c.z, yaw, iu * 2.25, iv * 3 + 1.4);
      P.pole(k, q.x, sy, q.z, 0.9 + rnd.range(0, 2.7));
    }
  }
  for (const side of [-1, 1]) {
    const q = lp(c.x, c.z, yaw, side * 11.4, 1.4);
    k.main.cylinder('wood_dark', { x: q.x, z: q.z, y: sy, r: 0.2, h: 4.6, segments: 8 }, { collide: true, walkable: false });
    const ring = new THREE.TorusGeometry(0.85, 0.08, 6, 20);
    k.main.mesh('wood_red', ring, { x: q.x, y: sy + 5.45, z: q.z, yaw: yaw + Math.PI / 2 });
    ring.dispose();
    const st = lp(c.x, c.z, yaw, side * 11.2, 6.6);
    bench(k, st.x, sy, st.z, yaw + (side * Math.PI) / 2);
  }
  // Low rail on the shelf's outer edge and sides.
  const half = s.w / 2 - 0.3, out = (s.r1 - s.r0) / 2 - 0.3;
  const rail = [lp(c.x, c.z, yaw, -half, -out + 3.2), lp(c.x, c.z, yaw, -half, out), lp(c.x, c.z, yaw, half, out), lp(c.x, c.z, yaw, half, -out + 3.2)];
  P.balustrade(k, rail, { y: sy, h: 0.8 });
  // Lanterns along the road.
  for (const a of [96, 108, 129, 140]) {
    const p = polar(a, 61.2);
    P.lanternPost(k, p.x, y, p.z, 'warm');
  }
}

// ---------------------------------------------------------------------------
// L4: the courtyards and the gardens
// ---------------------------------------------------------------------------

export function buildCourts(k: Kit): void {
  const y = FL(4);
  buildEntranceCourt(k, y);
  buildMoonGateCourt(k, y);
  buildLabyrinthCourt(k, y);
  buildGardens(k, y);
}

function gong(k: Kit, x: number, y: number, z: number, yaw: number): void {
  for (const s of [-1, 1]) {
    const p = lp(x, z, yaw, s * 1.3, 0);
    k.main.box('wood_red', { x: p.x, y: y + 1.65, z: p.z, sx: 0.24, sy: 3.3, sz: 0.24, yaw }, { collide: true, walkable: false });
  }
  k.main.box('wood_dark', { x, y: y + 3.2, z, sx: 3.1, sy: 0.26, sz: 0.32, yaw });
  k.main.roof(am('roof'), { x, y: y + 3.35, z, w: 3.3, d: 1.0, height: 0.5, yaw, overhang: 0.25, curve: 0.8, style: 'hip', ridge: null });
  const disc = new THREE.CylinderGeometry(0.95, 0.95, 0.08, 28).rotateX(Math.PI / 2);
  k.main.mesh('bronze', disc, { x, y: y + 1.8, z, yaw });
  disc.dispose();
  const boss = new THREE.SphereGeometry(0.24, 12, 8).scale(1, 1, 0.5);
  k.main.mesh('gold', boss, { x, y: y + 1.8, z, yaw });
  boss.dispose();
  for (const s of [-1, 1]) {
    const p = lp(x, z, yaw, s * 0.62, 0);
    k.props.box(am('rope'), { x: p.x, y: y + 2.95, z: p.z, sx: 0.04, sy: 0.5, sz: 0.04, yaw });
  }
}

function buildEntranceCourt(k: Kit, y: number): void {
  const mid = 193;
  // Gate from the road, low walls along the court's outer side.
  const gp = polar(mid, 52.2);
  gateArch(k, { x: gp.x, z: gp.z, y, yaw: yawOut(mid), w: 5.6, h: 6.0 });
  P.wallLine(k, arc(52.2, 181.5, mid - 4.9, 2), { y, h: 1.5, t: 0.7, cap: 'stone_light' });
  P.wallLine(k, arc(52.2, mid + 4.9, 207.2, 2), { y, h: 1.5, t: 0.7, cap: 'stone_light' });
  // Ringed paving, the fountain, the statue of Monk Gyatso, the gong.
  const f = polar(mid, 41);
  P.disc(k, f.x, f.z, y + 0.05, 8.6, am('courtRings'), 0.12, 56);
  P.fountain(k, { id: 'air:sat_entrance_fountain', label: 'Courtyard fountain', x: f.x, z: f.z, y: y + 0.05, r: 3.2 });
  const st = polar(mid, 33.6);
  k.main.box('stone_white', { x: st.x, y: y + 0.6, z: st.z, sx: 2.6, sy: 1.2, sz: 2.6, yaw: yawOut(mid) }, { collide: true, walkable: true });
  k.main.box('stone_light', { x: st.x, y: y + 1.25, z: st.z, sx: 2.8, sy: 0.14, sz: 2.8, yaw: yawOut(mid) });
  P.monkStatue(k, st.x, y + 1.32, st.z, yawOut(mid), 1.45);
  const gg = polar(SITES.gong.th, SITES.gong.r);
  gong(k, gg.x, y, gg.z, towardYaw(gg, f));
  // Cloister against the summit cliff behind the statue.
  P.arcade(k, { a: polar(183.5, 30.6), b: polar(202.5, 30.6), y, arches: 5, pier: 0.8, spring: 3.0, top: 4.7, depth: 1.2, roof: { side: -1, width: 2.6, height: 1.0 } });
  for (const [a, r] of [[184.5, 35.5], [201.5, 35.5], [184, 48.4], [202, 48.4]] as const) {
    const p = polar(a, r);
    P.pine(k, p.x, y, p.z, Math.round(a) % 3, 1.0);
  }
  for (const a of [187, 199]) {
    const p = polar(a, 45.6);
    bench(k, p.x, y, p.z, towardYaw(p, f));
  }
}

function buildMoonGateCourt(k: Kit, y: number): void {
  // Moon-gate wall between the entrance court and this one (radial wall).
  const wa = 207.6;
  const wc = polar(wa, 42.8);
  P.moonGate(k, { x: wc.x, z: wc.z, y, yaw: -wa * DEG, w: 17.2, h: 4.8, depth: 0.8, r: 2.0, cy: 2.04 });
  // Drum terrace against the summit cliff, reached by a curved double stair.
  const th = 224;
  const R = 5.4, H = 3.6;
  const dc = polar(th, summitRAt(th) + 0.6 + R);
  k.main.cylinder('stone_white', { x: dc.x, z: dc.z, y: y - 0.3, r: R, h: H + 0.3, segments: 40 }, { collide: true, walkable: true });
  k.main.cylinder(am('paintTeal'), { x: dc.x, z: dc.z, y: y + H - 0.62, r: R + 0.04, h: 0.22, segments: 40 });
  k.main.cylinder('stone_light', { x: dc.x, z: dc.z, y: y + H - 0.08, r: R + 0.12, h: 0.16, segments: 40 });
  const front = th * DEG;
  for (const side of [-1, 1]) {
    P.curvedStair(k, { cx: dc.x, cz: dc.z, rIn: R + 0.05, rOut: R + 2.2, a0: front + side * 0.42, a1: front + side * 1.95, y0: y, y1: y + H, walls: { h: 0.9, t: 0.28, inner: false } });
  }
  // Pierced parapet round the drum's top (open where the stairs arrive), a shrine and a pine on it.
  const n = 32;
  const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: dc.x + Math.cos((i / n) * Math.PI * 2) * (R - 0.25), z: dc.z + Math.sin((i / n) * Math.PI * 2) * (R - 0.25) }));
  P.balustrade(k, pts, {
    y: y + H,
    h: 0.85,
    skip: (i) => {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      return [front + 1.95, front - 1.95].some((t) => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))) < 0.2);
    },
  });
  const sh = lp(dc.x, dc.z, yawOut(th), 0, -2.6);
  smallShrine(k, sh.x, y + H, sh.z, yawOut(th));
  const pn = lp(dc.x, dc.z, yawOut(th), 2.6, 0.4);
  P.pine(k, pn.x, y + H, pn.z, 2, 0.75);
  swirl(k, dc.x, y + H + 0.03, dc.z, 1.6, 0);
  for (const a of [214, 234]) {
    const p = polar(a, 47.5);
    P.stoneLantern(k, p.x, y, p.z);
  }
}

function buildLabyrinthCourt(k: Kit, y: number): void {
  const lab = polar(254, 44);
  P.disc(k, lab.x, lab.z, y + 0.05, 7, am('labyrinth'), 0.12, 64);
  const pv = polar(271, 39);
  P.pavilion(k, { x: pv.x, z: pv.z, y, r: 3.4, h: 3.6, steps: 2, entrances: [towardYaw(pv, lab), yawOut(271)] });
  for (const a of [246, 262]) {
    const p = polar(a, 51.6);
    bench(k, p.x, y, p.z, towardYaw(p, lab));
  }
  for (const a of [247, 261]) {
    const p = polar(a, 36.2);
    P.stoneLantern(k, p.x, y, p.z);
  }
  const pn = polar(278, 33.5);
  P.pine(k, pn.x, y, pn.z, 1, 1.15);
}

function buildGardens(k: Kit, y: number): void {
  const rnd = new Random(SEED + 404);
  // Koi ponds with an arched footbridge over the larger one.
  const k1 = polar(297, 37.2), k2 = polar(322, 34.6);
  P.roundPool(k, { id: 'air:sat_koi_1', label: 'Koi pond', x: k1.x, z: k1.z, y, r: 3.4, rimH: 0.2 });
  P.roundPool(k, { id: 'air:sat_koi_2', label: 'Koi pond', x: k2.x, z: k2.z, y, r: 2.8, rimH: 0.2 });
  k.main.bridge({ a: v3(297, 37.2 - 5.6, y + 0.02), b: v3(297, 37.2 + 5.6, y + 0.02), width: 1.5, deck: 'wood', rail: 'wood_red', support: null, arch: 0.95 });
  for (const [c, n, r] of [[k1, 7, 2.6], [k2, 5, 2.0]] as const) {
    for (let i = 0; i < n; i++) {
      const a = rnd.range(0, 6.28), d = rnd.range(0.4, r);
      repeatProp(k.props, 'sat_koi', () => new THREE.IcosahedronGeometry(0.13, 0).scale(2.4, 0.45, 1), i % 3 ? 'cloth_orange' : 'cloth_white', { x: c.x + Math.cos(a) * d, y: y + 0.0, z: c.z + Math.sin(a) * d, yaw: rnd.range(0, 6.28) }, false);
    }
  }
  // Raked gravel beds with stones (liftable).
  for (const [a, r, w, l] of [[311, 32.6, 5.2, 7.2]] as const) {
    const p = polar(a, r);
    const yaw = along(a);
    k.props.box('stone_light', { x: p.x, y: y + 0.04, z: p.z, sx: w, sy: 0.08, sz: l, yaw });
    for (let i = 0; i < Math.floor(w / 0.45); i++) {
      const q = lp(p.x, p.z, yaw, -w / 2 + 0.25 + i * 0.45, 0);
      repeatProp(k.props, `sat_rake_${l}`, () => new THREE.BoxGeometry(0.07, 0.03, l - 0.3), 'stone_grey', { x: q.x, y: y + 0.095, z: q.z, yaw }, false);
    }
    for (let i = 0; i < 3; i++) {
      const q = lp(p.x, p.z, yaw, rnd.range(-w / 3, w / 3), rnd.range(-l / 3, l / 3));
      const s = rnd.range(0.35, 0.6);
      const g = boulder(i * 13 + a, s, s * 0.7, s * 0.9, 1);
      k.main.rock('stone_grey', g, { x: q.x, y: y + 0.08 + s * 0.35, z: q.z, yaw: rnd.range(0, 6.28) }, { shape: 'sphere', x: q.x, y: y + 0.08 + s * 0.35, z: q.z, r: s * 0.8, walkable: true, solid: true });
      g.dispose();
    }
  }
  // Shrines, benches, animal statues, prayer wheels, pines, lanterns.
  for (const a of [304, 334]) {
    const p = polar(a, summitRAt(a) + 1.9);
    smallShrine(k, p.x, y, p.z, yawOut(a));
  }
  for (const [a, r] of [[291, 42.6], [315, 40.8], [329, 41.2]] as const) {
    const p = polar(a, r);
    bench(k, p.x, y, p.z, yawOut(a) + Math.PI);
  }
  const bs = polar(303.5, 44.2);
  k.main.box('stone_white', { x: bs.x, y: y + 0.3, z: bs.z, sx: 2.2, sy: 0.6, sz: 3.2, yaw: along(303.5) }, { collide: true, walkable: true });
  P.bisonStatue(k, bs.x, y + 0.6, bs.z, along(303.5), 0.42);
  const ls = polar(318, 29.6);
  k.main.box('stone_white', { x: ls.x, y: y + 0.45, z: ls.z, sx: 1.0, sy: 0.9, sz: 1.0, yaw: yawOut(318) }, { collide: true, walkable: true });
  lemurStatue(k, ls.x, y + 0.9, ls.z, yawOut(318));
  const w0 = SITES.wheels;
  P.prayerWheels(k, polar(w0.th - 6.5, w0.r), polar(w0.th + 6.5, w0.r), y, 8);
  for (const [i, [a, r]] of ([[287, 37], [313, 37.5], [327.5, 29.8]] as const).entries()) {
    const p = polar(a, r);
    P.pine(k, p.x, y, p.z, i % 3, 0.95 + (i % 2) * 0.2);
  }
  for (const a of [296, 312, 326]) {
    const p = polar(a, 43.6);
    P.stoneLantern(k, p.x, y, p.z);
  }
}

/** Small stone statue of a winged lemur sitting up, ears wide. */
function lemurStatue(k: Kit, x: number, y: number, z: number, yaw: number): void {
  repeatProp(k.main, 'sat_lemur_statue', () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(new THREE.SphereGeometry(0.32, 10, 8).scale(1, 1.25, 0.9).translate(0, 0.42, 0));
    parts.push(new THREE.SphereGeometry(0.24, 10, 8).translate(0, 0.98, 0.04));
    for (const s of [-1, 1]) {
      parts.push(new THREE.ConeGeometry(0.16, 0.42, 6).rotateZ(-s * 1.1).translate(s * 0.34, 1.12, 0));
      parts.push(new THREE.BoxGeometry(0.5, 0.36, 0.04).rotateZ(s * 0.4).translate(s * 0.4, 0.5, -0.12));
    }
    parts.push(new THREE.CylinderGeometry(0.05, 0.03, 0.9, 5).rotateX(1.2).translate(0, 0.3, -0.5));
    return G.mergeAll(parts);
  }, 'stone_light', { x, y, z, yaw });
}

// ---------------------------------------------------------------------------
// L5: the great hall, a library, meditation terraces, the hall spring
// ---------------------------------------------------------------------------

export function buildHalls(k: Kit): void {
  const y = FL(5);
  hallOut(k, 2, summitRAt(2) + 0.3, y, { w: 17, d: 9, storeys: 2, roof: 'blue', balcony: true });
  hallOut(k, 31, summitRAt(31) + 0.3, y, { w: 9, d: 6, storeys: 2, roof: 'slate', door: false, steps: false });
  // Meditation terraces: low round platforms ringed with cushions.
  for (const m of meditationSpots()) {
    const top = P.steppedDisc(k, { x: m.x, z: m.z, y, r: 3.2, steps: 2, stepH: 0.3, top: 'paving' });
    P.cushions(k, m.x, top, m.z, 2.3, 8);
    swirl(k, m.x, top + 0.03, m.z, 1.0, m.th);
  }
  // The spring: a pool, a rill to the edge and the fall down to the orchard pool.
  const th = 70;
  const edge = edgeOf('halls', th);
  const sp = polar(th, 45.8);
  P.roundPool(k, { id: 'air:sat_hall_spring', label: 'Hall spring', x: sp.x, z: sp.z, y, r: 1.8, rimH: 0.4 });
  P.canal(k, { id: 'air:sat_hall_rill', label: 'Rill', a: polar(th, 48.1), b: polar(th, edge + 0.1), y, width: 0.8, wallH: 0.35, register: false });
  const lip = polar(th, edge + 0.25);
  P.waterfall(k, { id: 'air:sat_hall_falls', label: 'Hall falls', x: lip.x, y: y + 0.05, z: lip.z, yaw: yawOut(th), width: 1.1, drop: y - FL(2) + 0.1, out: 0.9 });
  // Lanterns along the outer side of the road.
  for (const a of [347, 357, 7, 17]) {
    const r = roadRadius(a) + 3.4;
    const p = polar(a, r);
    P.lanternPost(k, p.x, y, p.z, 'warm');
  }
}

/** Radius of the road's centre line at bearing θ on a flat run (for dressing beside it). */
function roadRadius(th: number): number {
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [t0, r0] = ROAD[i], [t1, r1] = ROAD[i + 1];
    for (const t of [th, th + 360, th + 720]) if (t >= t0 && t <= t1) return r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
  }
  return 40;
}

// ---------------------------------------------------------------------------
// L6: the summit
// ---------------------------------------------------------------------------

export function buildSummit(k: Kit): void {
  const y = FL(6);
  // Central tower on its stepped drum.
  const drumTop = P.steppedDisc(k, { x: C.x, z: C.z, y, r: 7.4, steps: 3, stepH: 0.5, stepW: 0.6 });
  const towerTop = P.roundTower(k, { x: C.x, z: C.z, y: drumTop, r: TOWER.r, h: TOWER.h, roofH: 16, bands: 10, windows: 11, balcony: true, door: yawOut(96), segments: 28 });
  // Prayer flags from the tower's balcony down to posts round the summit.
  const by = drumTop + TOWER.h * 0.78 + 1.0;
  for (const a of [45, 125, 315]) {
    const post = polar(a, summitRAt(a) - 1.4);
    k.main.box('wood_red', { x: post.x, y: y + 2.2, z: post.z, sx: 0.2, sy: 4.4, sz: 0.2 }, { collide: true, walkable: false });
    P.prayerFlags(k, v3(a, TOWER.r + 1.0, by), new THREE.Vector3(post.x, y + 4.3, post.z), 3.5, 0.8);
  }
  // Great-bell pavilion (north side), facing the tower.
  const bp = polar(270, 19);
  bellPavilion(k, bp.x, y, bp.z, yawOut(270) + Math.PI);
  // Two slender towers.
  const t2 = polar(222, 18), t3 = polar(330, 17.5);
  P.roundTower(k, { x: t2.x, z: t2.z, y, r: 3.0, h: 30, roofH: 8.6, bands: 5, windows: 5, door: yawOut(222) });
  P.roundTower(k, { x: t3.x, z: t3.z, y, r: 2.7, h: 23, roofH: 7.6, bands: 4, windows: 4, door: yawOut(330) });
  // The summit gate where the road arrives.
  const [ta, ra] = ROAD[ROAD.length - 2], [tb, rb] = ROAD[ROAD.length - 1];
  const a = polar(ta, ra), b = polar(tb, rb);
  const gyaw = Math.atan2(b.x - a.x, b.z - a.z);
  let gp = a;
  for (let t = 0; t <= 1; t += 0.02) {
    const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    gp = q;
    if (radiusOf(q.x, q.z) < summitRAt(thetaOf(q.x, q.z)) - 1.2) break;
  }
  gateArch(k, { x: gp.x, z: gp.z, y, yaw: gyaw, w: 5.4, h: 5.4 });
  // Glider launch: swirl marking, pennant poles, a low rail on its sides.
  const ls = shelf('launch');
  const lc = polar(ls.a, (ls.r0 + ls.r1) / 2 + 2);
  swirl(k, lc.x, floorY(ls.y) + 0.04, lc.z, 2.6, yawOut(ls.a));
  const lyaw = yawOut(ls.a);
  for (const side of [-1, 1]) {
    const q = lp(polar(ls.a, (ls.r0 + ls.r1) / 2).x, polar(ls.a, (ls.r0 + ls.r1) / 2).z, lyaw, side * (ls.w / 2 - 0.4), (ls.r1 - ls.r0) / 2 - 0.5);
    k.main.box('wood_dark', { x: q.x, y: floorY(ls.y) + 2.4, z: q.z, sx: 0.14, sy: 4.8, sz: 0.14 }, { collide: true, walkable: false });
    P.banner(k, q.x, floorY(ls.y) + 4.1, q.z, lyaw + Math.PI / 2, 0.6, 1.6, 'bannerYellow');
    const r0 = lp(polar(ls.a, (ls.r0 + ls.r1) / 2).x, polar(ls.a, (ls.r0 + ls.r1) / 2).z, lyaw, side * (ls.w / 2 - 0.25), -(ls.r1 - ls.r0) / 2 + 5.5);
    P.balustrade(k, [r0, { x: q.x, z: q.z }], { y: floorY(ls.y), h: 0.8 });
  }
  // Lanterns and benches round the plaza.
  for (const a of [70, 115, 165, 200, 250, 290, 350]) {
    const p = polar(a, summitRAt(a) - 1.6);
    P.stoneLantern(k, p.x, y, p.z);
  }
  for (const a of [104, 180, 300]) {
    const p = polar(a, 12.5);
    bench(k, p.x, y, p.z, yawOut(a) + Math.PI);
  }
  void towerTop;
}

/** Open bell pavilion: stone plinth, red posts, blue hip roof, the great bronze bell and a striker log. */
function bellPavilion(k: Kit, x: number, y: number, z: number, yaw: number): void {
  const b = k.main;
  b.box('stone_white', { x, y: y + 0.15, z, sx: 6.4, sy: 0.6, sz: 6.4, yaw }, { collide: true, walkable: true });
  const top = y + 0.45;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const p = lp(x, z, yaw, su * 2.6, sv * 2.6);
    b.box('wood_red', { x: p.x, y: top + 2.4, z: p.z, sx: 0.36, sy: 4.8, sz: 0.36, yaw }, { collide: true, walkable: false });
    b.box('stone_light', { x: p.x, y: top + 0.15, z: p.z, sx: 0.6, sy: 0.3, sz: 0.6, yaw });
  }
  b.box('wood_dark', { x, y: top + 4.85, z, sx: 5.9, sy: 0.3, sz: 0.32, yaw });
  b.box('wood_dark', { x, y: top + 4.85, z, sx: 0.32, sy: 0.3, sz: 5.9, yaw });
  b.box(am('trimOrange'), { x, y: top + 5.1, z, sx: 6.0, sy: 0.2, sz: 6.0, yaw });
  b.roof(am('roof'), { x, y: top + 5.2, z, w: 6.4, d: 6.4, height: 2.3, yaw, overhang: 1.1, curve: 0.95, style: 'hip', ridge: am('roofTrim') });
  const f = G.finialGeometry(0.75);
  b.mesh('gold', f, { x, y: top + 7.45, z });
  f.dispose();
  const bell = G.lathe([[0.02, 0], [1.08, 0], [1.02, 0.22], [0.86, 0.9], [0.74, 1.7], [0.52, 2.15], [0.2, 2.32], [0.02, 2.34]], 28, 1);
  b.mesh('bronze', bell, { x, y: top + 2.25, z });
  bell.dispose();
  b.box('bronze', { x, y: top + 4.75, z, sx: 0.2, sy: 0.25, sz: 0.2, yaw });
  const lg = lp(x, z, yaw, 0, 1.85);
  const log = new THREE.CylinderGeometry(0.2, 0.2, 2.6, 10).rotateZ(Math.PI / 2);
  b.mesh('wood', log, { x: lg.x, y: top + 3.05, z: lg.z, yaw: yaw + Math.PI / 2 });
  log.dispose();
  for (const s of [-1, 1]) {
    const r = lp(x, z, yaw, s * 0.9, 1.85);
    k.props.box(am('rope'), { x: r.x, y: top + 3.95, z: r.z, sx: 0.04, sy: 1.8, sz: 0.04, yaw });
  }
  b.collider({ shape: 'cylinder', x, y: top + 3.4, z, r: 1.05, hy: 1.2, walkable: false, solid: true });
}
