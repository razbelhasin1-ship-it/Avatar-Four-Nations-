import * as THREE from 'three';
import { heightAt } from '../../../Heightfield';
import { createWaterMaterial } from '../../../Water';
import type { P2 } from '../../../WorldLayout';
import type { ContentBuilder } from '../../../kit/Builder';
import { waterfallRibbon } from '../../air/geom';
import { crimsonMat, goldMat, paperMat } from '../materials';
import { bannerPole, brazier, crest, dragonStatue, hall, pagodaTower, roof, stoneLantern, tree } from '../parts';
import type { Cap } from './FireCapital';
import { CALDERA, CONFIG, FNC, atAxis, atPolar, polarOf } from './layout';
import { battlement, drapedStrip, rng, slabRect } from './kit';

/**
 * Hari Bulkan, the Royal Caldera City, on the crater floor: Hari Bulkan Square before the palace
 * with its proclamation dais, the avenue from the crater gate, a ring street round the palace wall,
 * tall narrow mansions on walled plots (some perched on the lip), the High Temple of the Fire Sages
 * with the Dragonbone Catacombs entrance in its court, the Royal Fire Academy for Girls and a
 * firebending academy, the Coronation Temple and Plaza by the big lake (fed by a waterfall from the
 * east peaks), the palace garden villa round the turtle-duck pond, the octagonal plaza in the west,
 * and watchtowers and bunkers along the lip. Quieter, cleaner and sparser than Harbor City.
 */

const Y = CALDERA.y;
const V = FNC.V;

/** Things on the crater floor the mansions keep clear of (centre, radius). */
function reserved(): Array<{ x: number; z: number; r: number }> {
  const out: Array<{ x: number; z: number; r: number }> = [];
  for (const l of [...CALDERA.bigLake, ...CALDERA.smallLakes]) out.push({ ...atPolar(l.phi, l.r), r: l.rad + 8 });
  const add = (p: { phi: number; r: number }, r: number) => out.push({ ...atPolar(p.phi, p.r), r });
  add(CALDERA.octagon, 19);
  add(CALDERA.coronation, 24);
  add(CALDERA.garden, 23);
  add(CALDERA.temple, 25);
  add({ phi: CALDERA.temple.phi, r: CALDERA.temple.r - 18 }, 16); // the High Temple court (Sage Hira's lessons)
  add(CALDERA.academy, 20);
  add(ACADEMY2, 17);
  add(CALDERA.waterfall, 14);
  return out;
}
const ACADEMY2 = { phi: 262, r: 88 };

function onSquareOrAvenue(x: number, z: number, m: number): boolean {
  const t = Math.abs(x - V.x), s = z - V.z;
  const Sq = CALDERA.square;
  if (s > Sq.s0 - m && s < Sq.s1 + m && t < Sq.half + m) return true;
  if (s > Sq.s1 - 2 && s < FNC.lipR + 4 && t < 7 + m) return true;
  return false;
}

export function* buildCaldera(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const major = env.chunks.named('major', 'fnc_caldera');
  const b = major.builder;
  const props = env.chunks.named('props', 'fnc_caldera_props').builder;
  const Sq = CALDERA.square;

  // --- Hari Bulkan Square and the avenue.
  const sc = atAxis(0, (Sq.s0 + Sq.s1) / 2);
  slabRect(b, 'stone_tan', { x: sc.x, z: sc.z, y: Y + 0.05, w: Sq.half * 2, d: Sq.s1 - Sq.s0, thick: 0.3 });
  const a0 = Sq.s1, a1 = FNC.floorR - 2;
  const ac = atAxis(0, (a0 + a1) / 2);
  slabRect(b, 'paving', { x: ac.x, z: ac.z, y: Y + 0.05, w: 12, d: a1 - a0, thick: 0.3 });
  cap.mark('square', sc.x, Y, sc.z);
  // Proclamation dais at the square's north edge (before the palace gate), facing the square.
  const dz = atAxis(Sq.half - 8, Sq.s0 + 6);
  b.block('stone_light', { x: dz.x, y: Y, z: dz.z, sx: 9, sy: 1.6, sz: 7 }, { collide: true, walkable: true });
  b.stairs({ from: new THREE.Vector3(dz.x, Y, dz.z + 5.6), to: new THREE.Vector3(dz.x, Y + 1.6, dz.z + 3.5), width: 4, material: 'stone_light' });
  for (const [lx, lz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]] as const) b.cylinder(crimsonMat(), { x: dz.x + lx, y: Y + 1.6, z: dz.z + lz, r: 0.3, h: 4.2, segments: 8 }, { collide: true, walkable: false });
  roof(b, { x: dz.x, y: Y + 5.8, z: dz.z, w: 9.4, d: 7.4, h: 2.2, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 0.6, horns: 0.8, crest: 1 });
  cap.mark('proclamationDais', dz.x, Y + 1.6, dz.z);
  // Braziers and banners round the square; dragon statues and lanterns along the avenue.
  for (const side of [-1, 1]) {
    for (let s = Sq.s0 + 4; s <= Sq.s1 - 2; s += 9) {
      const p = atAxis(side * (Sq.half - 1.5), s);
      if (side > 0 && s < Sq.s0 + 12) continue;
      brazier(b, cap.flames, { x: p.x, y: Y, z: p.z, size: 0.95 });
    }
    for (let s = Sq.s0 + 8; s <= Sq.s1 - 4; s += 13) {
      const p = atAxis(side * (Sq.half + 1.2), s);
      bannerPole(props, { x: p.x, y: Y, z: p.z, yaw: 0, h: 9 });
    }
    for (let s = a0 + 6; s < a1 - 2; s += 7) {
      const p = atAxis(side * 7.6, s);
      props.lantern(new THREE.Vector3(p.x, Y + 2.8, p.z), { color: 'warm', post: true });
    }
    const st = atAxis(side * 8.2, a1 - 4);
    dragonStatue(b, { x: st.x, y: Y, z: st.z, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, s: 1.3, pedestalH: 1.4 });
  }
  yield;

  // --- Ring street round the palace wall and spokes to the districts.
  {
    const ring: P2[] = [];
    for (let a = -180; a <= 180; a += 4) ring.push(atPolar(a, FNC.ringR + 9));
    drapedStrip(b, 'paving', ring, 7, { tile: 4, y: () => Y, lift: 0.06 });
    for (const p of [CALDERA.temple, CALDERA.academy, ACADEMY2, CALDERA.octagon, CALDERA.coronation, CALDERA.garden]) {
      const pts: P2[] = [];
      for (let r = FNC.ringR + 12; r <= p.r - 8; r += 4) pts.push(atPolar(p.phi, r));
      if (pts.length > 1) drapedStrip(b, 'paving', pts, 5, { tile: 4, y: () => Y, lift: 0.06 });
    }
  }
  yield;

  // --- Waterfall from the east peaks into the big lake.
  {
    const wf = atPolar(CALDERA.waterfall.phi, CALDERA.waterfall.r);
    const topY = 190;
    const drop = topY - CALDERA.lakeLevel;
    const yaw = Math.atan2(V.x - wf.x, V.z - wf.z);
    const geo = waterfallRibbon(7, drop, { out: 3.4 });
    const m = new THREE.Mesh(geo, fallsMat());
    m.position.set(wf.x, topY, wf.z);
    m.rotation.y = yaw;
    m.renderOrder = 3;
    m.name = 'falls_hari_bulkan';
    major.add(m);
    cap.mark('waterfall', wf.x, topY, wf.z);
    env.waterIds.push('fire_capital:royal_falls');
    env.ctx.water.register({ id: 'fire_capital:royal_falls', type: 'waterfall', label: 'Royal Falls', x: wf.x, y: CALDERA.lakeLevel + 0.4, z: wf.z, r: 3.5, capacity: Infinity, regen: 0, size: 'medium' });
  }

  // --- Landmarks.
  coronationPlaza(cap, b);
  gardenVilla(cap, b, props);
  highTemple(cap, b);
  academy(cap, b, CALDERA.academy, 'girls');
  academy(cap, b, ACADEMY2, 'firebending');
  octagonPlaza(cap, b);
  yield;

  // --- Mansions: tall, narrow, red-roofed with gold trim, on walled plots.
  const res = reserved();
  const rnd = rng(CONFIG.seed ^ 0x6a11);
  let mansions = 0;
  const plotOk = (x: number, z: number, half: number): boolean => {
    if (onSquareOrAvenue(x, z, half + 3)) return false;
    for (const q of res) if (Math.hypot(x - q.x, z - q.z) < q.r + half) return false;
    const { r } = polarOf(x, z);
    return r > FNC.ringR + 12.5 + half && r < FNC.floorR - half + 0.5;
  };
  const taken: Array<{ x: number; z: number; r: number }> = [];
  const free = (x: number, z: number, half: number) => plotOk(x, z, half) && !taken.some((q) => Math.hypot(x - q.x, z - q.z) < q.r + half);
  for (const rr of [57.5, 68, 78.5, 89, 96.5]) {
    const step = (13.5 / rr) * (180 / Math.PI);
    for (let phi = -180 + ((rr * 7) % 13); phi < 180; phi += step + rnd() * 1.2) {
      const p = atPolar(phi, rr);
      const half = 5.6;
      if (!free(p.x, p.z, half)) continue;
      mansion(cap, b, props, p, Math.atan2(V.x - p.x, V.z - p.z), rnd);
      taken.push({ ...p, r: half });
      mansions++;
    }
    yield;
  }
  // Lower noble houses in the gaps (two storeys, cream walls, red roofs).
  let houses = 0;
  for (const rr of [62.5, 73, 84, 93]) {
    const step = (9 / rr) * (180 / Math.PI);
    for (let phi = -180; phi < 180; phi += step) {
      const p = atPolar(phi, rr);
      if (!free(p.x, p.z, 4.2)) continue;
      const arch = env.arch[rnd() < 0.5 ? 'N7' : rnd() < 0.5 ? 'N2' : 'N8'];
      env.chunks.addHouse(arch, p.x, Y, p.z, Math.atan2(V.x - p.x, V.z - p.z), { tint: new THREE.Color('#f4e8d2'), roofTint: new THREE.Color(rnd() < 0.5 ? '#a8302a' : '#9b2620') });
      taken.push({ ...p, r: 4.2 });
      houses++;
    }
  }
  cap.mark('nobleHouses', houses, 0, 0);
  yield;
  // A few mansions perched on the lip, either side of the gate.
  for (const phi of [62, 118, 160, 20]) {
    const p = atPolar(phi, FNC.lipR + 4);
    const gy = heightAt(p.x, p.z);
    if (gy > FNC.lipY + 30) continue;
    b.block('stone_dark', { x: p.x, y: Y - 1, z: p.z, sx: 9, sy: gy - Y + 1, sz: 9 }, { collide: true, walkable: true });
    pagodaTower(b, { x: p.x, y: gy, z: p.z, yaw: Math.atan2(V.x - p.x, V.z - p.z), size: 7.5, tiers: 4, tierH: 3.4, shrink: 0.93, wall: crimsonMat(), roofMat: 'roof_red', spire: 2.6 });
    mansions++;
  }
  cap.mark('mansions', mansions, 0, 0);

  // --- Watchtowers and bunkers along the lip.
  for (const phi of [74, 106, 140, 196, 250, 304, 0, 40]) {
    const p = atPolar(phi, FNC.lipR + 1.5);
    const gy = heightAt(p.x, p.z);
    b.block('stone_dark', { x: p.x, y: gy - 2, z: p.z, sx: 5, sy: 12, sz: 5 }, { collide: true, walkable: true });
    battlement(b, 'stone_dark', [
      { x: p.x - 2.5, z: p.z - 2.5 }, { x: p.x + 2.5, z: p.z - 2.5 }, { x: p.x + 2.5, z: p.z + 2.5 }, { x: p.x - 2.5, z: p.z + 2.5 }, { x: p.x - 2.5, z: p.z - 2.5 },
    ], { y: () => gy + 10, h: 0.9, thick: 0.5, cap: 'stone_tan' });
    roof(b, { x: p.x, y: gy + 13.4, z: p.z, w: 4, d: 4, h: 2.2, style: 'pyramid', mat: 'roof_red', trim: 'gold', tips: 0.3, finial: 0.9 });
    for (const [px, pz] of [[-1.7, -1.7], [1.7, -1.7], [1.7, 1.7], [-1.7, 1.7]] as const) b.box('wood_red', { x: p.x + px, y: gy + 11.7, z: p.z + pz, sx: 0.28, sy: 3.4, sz: 0.28 });
    brazier(b, cap.flames, { x: p.x, y: gy + 10, z: p.z, size: 0.6, style: 'bowl', collide: false });
  }
  for (const side of [-1, 1]) {
    // Bunkers flanking the crater gate, outside the lip.
    const p = atAxis(side * 18, FNC.road.gateS + 10);
    const gy = heightAt(p.x, p.z);
    b.block('stone_dark', { x: p.x, y: gy - 1, z: p.z, sx: 10, sy: 4.2, sz: 7, yaw: side * 0.2 }, { collide: true, walkable: true });
    b.box(slitMat(), { x: p.x, y: gy + 2.2, z: p.z + 3.52, sx: 6, sy: 0.4, sz: 0.06, yaw: side * 0.2 });
  }
  yield;
}

function mansion(cap: Cap, b: ContentBuilder, props: ContentBuilder, p: P2, yaw: number, rnd: () => number): void {
  // Walled plot with a gate toward the street (front = toward the palace).
  const W = 11.5;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx: number, lz: number) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c });
  const corners = [L(-W / 2, -W / 2), L(W / 2, -W / 2), L(W / 2, W / 2), L(3, W / 2)];
  const back = [L(-3, W / 2), L(-W / 2, W / 2), L(-W / 2, -W / 2)];
  for (const run of [corners, back]) {
    for (let i = 0; i < run.length - 1; i++) {
      const a = run[i], e = run[i + 1];
      const len = Math.hypot(e.x - a.x, e.z - a.z);
      b.box('plaster_cream', { x: (a.x + e.x) / 2, y: Y + 0.9, z: (a.z + e.z) / 2, sx: 0.5, sy: 1.8, sz: len, yaw: Math.atan2(e.x - a.x, e.z - a.z) }, { collide: true, walkable: false });
      b.box('roof_red', { x: (a.x + e.x) / 2, y: Y + 1.9, z: (a.z + e.z) / 2, sx: 0.8, sy: 0.22, sz: len + 0.2, yaw: Math.atan2(e.x - a.x, e.z - a.z) });
    }
  }
  // The tower house: 4–7 storeys, narrow, stepped eaves, gold trim.
  const tiers = 4 + Math.floor(rnd() * 4);
  const size = 5.8 + rnd() * 1.8;
  const hp = L(0, -1.5);
  pagodaTower(b, { x: hp.x, y: Y, z: hp.z, yaw, size, tiers, tierH: 3.5, shrink: 0.94, wall: rnd() < 0.55 ? crimsonMat() : 'plaster_cream', roofMat: rnd() < 0.85 ? 'roof_red' : 'roof_dark', spire: 2.2 });
  // Garden: a tree and a stone lantern.
  const tp = L((rnd() < 0.5 ? -1 : 1) * 4, 4);
  tree(props, rnd() < 0.5 ? 'maple' : 'pine', { x: tp.x, y: Y, z: tp.z, s: 4.5 + rnd() * 2.5, yaw: rnd() * 6, variant: Math.floor(rnd() * 4), collide: true });
  const lp = L(-4, 5);
  stoneLantern(props, { x: lp.x, y: Y, z: lp.z, s: 0.8 });
  void cap;
}

function coronationPlaza(cap: Cap, b: ContentBuilder): void {
  const p = atPolar(CALDERA.coronation.phi, CALDERA.coronation.r);
  const yaw = Math.atan2(V.x - p.x, V.z - p.z);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx: number, lz: number) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c });
  // Raised plaza with stairs on the palace side; the temple at the back (lake side).
  b.block('stone_light', { x: p.x, y: Y, z: p.z, sx: 30, sy: 1.2, sz: 26, yaw }, { collide: true, walkable: true });
  const st = L(0, 13 + 2.2);
  b.stairs({ from: new THREE.Vector3(st.x, Y, st.z), to: new THREE.Vector3(L(0, 13).x, Y + 1.2, L(0, 13).z), width: 10, material: 'stone_light' });
  const tp = L(0, -7);
  hall(b, { x: tp.x, y: Y + 1.2, z: tp.z, yaw, w: 16, d: 8, h: 7, veranda: 2.4, colSpacing: 3.6, roofMat: 'roof_red', horns: 1.6, crest: 1.8, upper: { h: 4, inset: 2.4, roofH: 3.6 } });
  for (const lx of [-11, 11]) {
    const q = L(lx, 6);
    brazier(b, cap.flames, { x: q.x, y: Y + 1.2, z: q.z, size: 1.2 });
    const bp = L(lx, 11);
    bannerPole(b, { x: bp.x, y: Y + 1.2, z: bp.z, yaw, h: 10 });
  }
  cap.mark('coronation', p.x, Y + 1.2, p.z);
}

function gardenVilla(cap: Cap, b: ContentBuilder, props: ContentBuilder): void {
  const pond = atPolar(CALDERA.garden.phi, CALDERA.garden.r);
  // Villa on the palace side of the pond, facing it.
  const toV = Math.atan2(V.x - pond.x, V.z - pond.z);
  const vp = { x: pond.x + Math.sin(toV) * 14, z: pond.z + Math.cos(toV) * 14 };
  hall(b, { x: vp.x, y: Y + 0.6, z: vp.z, yaw: toV + Math.PI, w: 14, d: 6, h: 4.6, veranda: 2, colSpacing: 3, roofMat: 'roof_red', horns: 1, lattice: true });
  b.block('stone_light', { x: vp.x, y: Y - 0.2, z: vp.z, sx: 19, sy: 0.8, sz: 11, yaw: toV }, { collide: true, walkable: true });
  // Trees and stone lanterns round the pond.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    const r = CALDERA.garden.pondR + 4 + (i % 3) * 1.6;
    const q = { x: pond.x + Math.cos(a) * r, z: pond.z + Math.sin(a) * r };
    if (Math.hypot(q.x - vp.x, q.z - vp.z) < 9) continue;
    if (i % 2 === 0) tree(props, i % 4 === 0 ? 'willow' : 'maple', { x: q.x, y: Y, z: q.z, s: 6 + (i % 3), yaw: i, variant: i, collide: true });
    else stoneLantern(props, { x: q.x, y: Y, z: q.z, s: 0.8 });
  }
  cap.mark('gardenPond', pond.x, CALDERA.lakeLevel, pond.z);
  cap.mark('gardenVilla', vp.x, Y + 0.6, vp.z);
}

function highTemple(cap: Cap, b: ContentBuilder): void {
  const p = atPolar(CALDERA.temple.phi, CALDERA.temple.r);
  const yaw = Math.atan2(V.x - p.x, V.z - p.z);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx: number, lz: number) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c });
  // Stepped podium, the great hall, a five-tier spire behind.
  for (let k = 0; k < 3; k++) b.block('stone_light', { x: p.x, y: Y + k * 0.7, z: p.z, sx: 30 - k * 3, sy: 0.7, sz: 22 - k * 3, yaw }, { collide: true, walkable: true });
  const top = Y + 2.1;
  const fr = L(0, 11 + 1.8);
  b.stairs({ from: new THREE.Vector3(fr.x, Y, fr.z), to: new THREE.Vector3(L(0, 8).x, top, L(0, 8).z), width: 12, material: 'stone_light' });
  hall(b, { x: p.x, y: top, z: p.z, yaw, w: 18, d: 9, h: 7.5, veranda: 2.4, colSpacing: 3.6, roofMat: 'roof_red', horns: 2, crest: 2.2, upper: { h: 4.2, inset: 2.6, roofH: 4 } });
  const sp = L(0, -15);
  pagodaTower(b, { x: sp.x, y: Y, z: sp.z, yaw, size: 9, tiers: 5, tierH: 4, shrink: 0.86, wall: crimsonMat(), roofMat: 'roof_red', spire: 5 });
  for (const lx of [-12, 12]) {
    const q = L(lx, 13);
    brazier(b, cap.flames, { x: q.x, y: Y, z: q.z, size: 1.3 });
  }
  // The court before the temple (Sage Hira's lessons) — paved, open.
  const court = atPolar(CALDERA.temple.phi, CALDERA.temple.r - 18);
  slabRect(b, 'stone_tan', { x: court.x, z: court.z, y: Y + 0.06, w: 30, d: 26, yaw, thick: 0.3 });
  // Dragonbone Catacombs: a stairwell down into the dark at the court's side, behind a gate.
  const cc = { x: court.x + c * 13, z: court.z - s * 13 };
  b.block('stone_dark', { x: cc.x, y: Y, z: cc.z, sx: 4.6, sy: 0.5, sz: 6.4, yaw }, { collide: false });
  b.box(voidMat(), { x: cc.x, y: Y + 0.52, z: cc.z, sx: 3, sy: 0.04, sz: 4.6, yaw });
  for (const lx of [-1.9, 1.9]) {
    const q = { x: cc.x + lx * c, z: cc.z - lx * s };
    b.box('stone_dark', { x: q.x, y: Y + 1.5, z: q.z, sx: 0.6, sy: 3, sz: 0.6, yaw }, { collide: true, walkable: false });
  }
  b.box('stone_dark', { x: cc.x, y: Y + 3.2, z: cc.z, sx: 4.6, sy: 0.6, sz: 0.8, yaw });
  crest(b, { x: cc.x, y: Y + 3.9, z: cc.z, yaw: yaw, size: 1 });
  cap.mark('temple', p.x, top, p.z);
  cap.mark('templeCourt', court.x, Y, court.z);
  cap.mark('catacombs', cc.x, Y, cc.z);
}

function academy(cap: Cap, b: ContentBuilder, at: { phi: number; r: number }, kind: 'girls' | 'firebending'): void {
  const p = atPolar(at.phi, at.r);
  const yaw = Math.atan2(V.x - p.x, V.z - p.z);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx: number, lz: number) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c });
  const W = kind === 'girls' ? 26 : 22;
  // Walled compound: training yard in front, the academy hall at the back.
  const ring = [L(-W / 2, W / 2), L(-W / 2, -W / 2), L(W / 2, -W / 2), L(W / 2, W / 2)];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], e = ring[i + 1];
    b.box('plaster_cream', { x: (a.x + e.x) / 2, y: Y + 1.4, z: (a.z + e.z) / 2, sx: 0.6, sy: 2.8, sz: Math.hypot(e.x - a.x, e.z - a.z), yaw: Math.atan2(e.x - a.x, e.z - a.z) }, { collide: true, walkable: false });
  }
  for (const lx of [-W / 2, W / 2]) {
    const a = L(lx, W / 2), e = L(Math.sign(lx) * 3, W / 2);
    b.box('plaster_cream', { x: (a.x + e.x) / 2, y: Y + 1.4, z: (a.z + e.z) / 2, sx: 0.6, sy: 2.8, sz: Math.hypot(e.x - a.x, e.z - a.z), yaw: Math.atan2(e.x - a.x, e.z - a.z) }, { collide: true, walkable: false });
  }
  const hp = L(0, -W / 2 + 6);
  hall(b, { x: hp.x, y: Y + 0.3, z: hp.z, yaw, w: W - 6, d: 7, h: 6, veranda: 1.8, colSpacing: 3.2, roofMat: 'roof_red', horns: 1.2, upper: kind === 'girls' ? { h: 3.4, inset: 2, roofH: 3 } : undefined });
  const yard = L(0, 4);
  slabRect(b, 'stone_tan', { x: yard.x, z: yard.z, y: Y + 0.05, w: W - 2, d: W / 2 + 2, yaw, thick: 0.3 });
  for (const lx of [-W / 2 + 2.5, W / 2 - 2.5]) {
    const q = L(lx, W / 2 - 2.5);
    brazier(b, cap.flames, { x: q.x, y: Y, z: q.z, size: 0.9, style: 'tripod' });
  }
  cap.mark(kind === 'girls' ? 'academyGirls' : 'academy', yard.x, Y, yard.z);
}

function octagonPlaza(cap: Cap, b: ContentBuilder): void {
  const p = atPolar(CALDERA.octagon.phi, CALDERA.octagon.r);
  const R = CALDERA.octagon.rad;
  const g = new THREE.CylinderGeometry(R, R, 0.3, 8, 1);
  b.mesh('stone_tan', g, { x: p.x, y: Y + 0.05 - 0.15, z: p.z, yaw: Math.PI / 8 });
  g.dispose();
  const g2 = new THREE.CylinderGeometry(R + 0.6, R + 0.6, 0.22, 8, 1, true);
  b.mesh('stone_light', g2, { x: p.x, y: Y + 0.1, z: p.z, yaw: Math.PI / 8 });
  g2.dispose();
  // Central flame column.
  b.cylinder('stone_dark', { x: p.x, y: Y, z: p.z, r: 1.6, rTop: 1.2, h: 1.2, segments: 8 }, { collide: true, walkable: true });
  b.cylinder(crimsonMat(), { x: p.x, y: Y + 1.2, z: p.z, r: 0.7, rTop: 0.6, h: 5, segments: 8 }, { collide: true, walkable: false });
  b.cylinder(goldMat(), { x: p.x, y: Y + 6.2, z: p.z, r: 0.95, h: 0.3, segments: 12 });
  brazier(b, cap.flames, { x: p.x, y: Y + 6.5, z: p.z, size: 1, style: 'bowl', collide: false });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    stoneLantern(b, { x: p.x + Math.cos(a) * (R - 1.2), y: Y, z: p.z + Math.sin(a) * (R - 1.2), s: 0.7 });
  }
  void paperMat;
  cap.mark('octagon', p.x, Y, p.z);
}

let falls: THREE.ShaderMaterial | null = null;
function fallsMat(): THREE.ShaderMaterial {
  if (!falls) falls = createWaterMaterial({ shallow: '#d2f0f4', deep: '#6fb6c8', absorb: 0.4, opacity: 0.9, flowSpeed: 2.8, foam: 0.9, waveAmp: 0 });
  return falls;
}
let voidM: THREE.MeshStandardMaterial | null = null;
function voidMat(): THREE.MeshStandardMaterial {
  if (!voidM) voidM = new THREE.MeshStandardMaterial({ color: '#050404', roughness: 1 });
  return voidM;
}
let slit: THREE.MeshStandardMaterial | null = null;
function slitMat(): THREE.MeshStandardMaterial {
  if (!slit) slit = new THREE.MeshStandardMaterial({ color: '#0b0908', roughness: 1 });
  return slit;
}
