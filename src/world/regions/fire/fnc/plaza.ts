import * as THREE from 'three';
import { heightAt } from '../../../Heightfield';
import type { ContentBuilder } from '../../../kit/Builder';
import { bannerMat, crimsonMat, goldMat, paperMat } from '../materials';
import { brazier, crest, hall, roof, tree, wallBanner } from '../parts';
import type { Cap } from './FireCapital';
import { FNC, PLAZA, atAxis, harborHalf } from './layout';
import { battlement, slabRect, wallFace } from './kit';
import { ballista, tank } from './machines';

/**
 * The Royal Plaza: a sand-coloured forum in a valley between cliffs, from the main tower at its
 * head (the only way up into Harbor City, through the passage in the tower's base) to the gate
 * pavilions on the inner quay. Two long still pools run down its length either side of the
 * central avenue; long red-roofed colonnaded halls (barracks, tank bays) line both sides; the
 * cliff rims carry battlements and ballistae; the small gatehouse stands on its platform at the
 * harbour end between two tiered gate pavilions.
 */

const Y = PLAZA.y;
const V = FNC.plaza;
const T = PLAZA.tower;
/** Main tower tiers: width, depth, storey height. */
const TIERS = [
  { w: 60, d: 27, h: 9 },
  { w: 50, d: 22, h: 8 },
  { w: 38, d: 17, h: 7.5 },
  { w: 24, d: 12, h: 7 },
];

/** Passage stair height at axis distance s (plaza gate → Royal Way). */
function stairY(s: number): number {
  const top = atAxis(0, V.passTopS + 0.5);
  const topY = heightAt(top.x, top.z);
  const u = Math.min(1, Math.max(0, (V.passFootS - 0.5 - s) / (V.passFootS - 0.5 - (V.passTopS + 0.5))));
  return Y + (topY - Y) * u;
}

export function* buildPlaza(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const major = env.chunks.named('major', 'fnc_plaza');
  const b = major.builder;
  const props = env.chunks.named('props', 'fnc_plaza_props').builder;
  const P = PLAZA;

  // --- Paving: sand-coloured stone around the pools (the pools are basins in the ground).
  const pave = 'stone_tan' as const;
  const s0 = T.s1, s1 = FNC.harbor.s0;
  const strip = (t0: number, t1: number, a: number, c: number) => {
    const m = atAxis((t0 + t1) / 2, (a + c) / 2);
    slabRect(b, pave, { x: m.x, z: m.z, y: Y + 0.05, w: t1 - t0, d: c - a, thick: 0.3 });
  };
  strip(-P.poolIn, P.poolIn, P.poolS0, P.poolS1);
  strip(P.poolOut, V.valleyHalf, P.poolS0, P.poolS1);
  strip(-V.valleyHalf, -P.poolOut, P.poolS0, P.poolS1);
  strip(-V.valleyHalf, V.valleyHalf, s0, P.poolS0);
  strip(-V.valleyHalf, V.valleyHalf, P.poolS1, s1);
  // Pool rims and the still water (waterbending sources).
  for (const side of [-1, 1]) {
    const tm = (side * (P.poolIn + P.poolOut)) / 2;
    const c = atAxis(tm, (P.poolS0 + P.poolS1) / 2);
    const w = P.poolOut - P.poolIn, d = P.poolS1 - P.poolS0;
    for (const [dt, ds, sx, sz] of [[-w / 2, 0, 0.5, d + 0.5], [w / 2, 0, 0.5, d + 0.5], [0, -d / 2, w + 0.5, 0.5], [0, d / 2, w + 0.5, 0.5]] as const) {
      const p = atAxis(tm + dt, (P.poolS0 + P.poolS1) / 2 + ds);
      b.box('stone_light', { x: p.x, y: Y + 0.12, z: p.z, sx, sy: 0.42, sz }, { collide: true, walkable: true, solid: false });
    }
    b.box('stone_dark', { x: c.x, y: Y - V.pool.depth + 0.05, z: c.z, sx: w, sy: 0.1, sz: d });
    cap.water(b, { id: `fire_capital:plaza_pool_${side > 0 ? 'e' : 'w'}`, label: 'Royal Plaza pool', type: 'canal', x: c.x, z: c.z, y: P.water, w: w - 0.1, d: d - 0.1, capacity: 600, regen: 6 });
  }

  // --- Valley walls (retaining faces up to the hills either side), the head wall, the corners.
  for (const side of [-1, 1]) {
    const pts: Array<{ x: number; z: number }> = [];
    for (let s = V.s0; s <= FNC.harbor.s0 + 0.01; s += 4) pts.push(atAxis(side * V.valleyHalf, s));
    wallFace(b, 'stone_tan', pts, { top: (x, z) => rimY(x, z, side), bottom: () => Y - 0.4, thick: 2.4, collide: true, cap: 'stone_light', capH: 0.5 });
    // Corner wall to the harbour wall at the plaza's south end.
    const a = atAxis(side * (V.valleyHalf - 1), FNC.harbor.s0 + 0.2), e = atAxis(side * (harborHalf(FNC.harbor.s0) + FNC.harbor.quayW + 1.5), FNC.harbor.s0 + 0.2);
    wallFace(b, 'stone_tan', [a, e], { top: (x, z) => Math.max(Y + 5, heightAt(x, z - 6) + 0.8), bottom: () => FNC.harbor.bedY, thick: 3, collide: true, cap: 'stone_light', capH: 0.5 });
  }
  for (const side of [-1, 1]) {
    const a = atAxis(side * (V.passHalf + 0.6), V.s0), c = atAxis(side * V.valleyHalf, V.s0);
    wallFace(b, 'stone_tan', [a, c], { top: (x, z) => heightAt(x, z - 8) + 0.6, bottom: () => Y - 0.4, thick: 3, collide: true, cap: 'stone_light', capH: 0.5 });
  }
  yield;

  // --- Main tower with the passage through its base.
  buildTower(cap, b, props);
  yield;

  // --- Side halls: barracks and tank bays (colonnades face the forum).
  const hallS = [578, 604, 630];
  for (const side of [-1, 1]) {
    for (let i = 0; i < hallS.length; i++) {
      const c = atAxis(side * (P.hallIn + P.hallOut) / 2, hallS[i]);
      const yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      hall(b, { x: c.x, y: Y, z: c.z, yaw, w: 22, d: 6.6, h: 6.4, veranda: 2.2, colSpacing: 3.7, roofMat: 'roof_red', lattice: i !== 1, doors: i !== 1, horns: 1.2, upper: i === 1 ? { h: 3.4, inset: 1.4, roofH: 2.6 } : undefined });
      if (i === 1) {
        // Tank bays: two wide dark doorways and the tanks parked before them.
        for (const k of [-5.5, 5.5]) {
          const d = atAxis(side * (P.hallIn + 0.7 + 1.1), hallS[i] + k);
          b.box(bayMat(), { x: d.x, y: Y + 2.3, z: d.z, sx: 0.12, sy: 4.6, sz: 7.2 });
          const tp = atAxis(side * (P.hallIn - 5.6), hallS[i] + k);
          tank(props, tp.x, Y, tp.z, side < 0 ? Math.PI / 2 : -Math.PI / 2);
        }
        cap.mark(`tankBay${side > 0 ? 'E' : 'W'}`, c.x, Y, c.z);
      }
      // Lanterns between the halls.
      const lp = atAxis(side * (P.hallIn - 1.4), hallS[i] + 13);
      props.lantern(new THREE.Vector3(lp.x, Y + 3.4, lp.z), { color: 'warm', post: true });
    }
  }
  yield;

  // --- Gate pavilions and the gatehouse at the harbour end.
  for (const t of P.pavilions) gatePavilion(b, atAxis(t, P.pavilionS));
  // Steps from the inner quay up onto the plaza across its full width.
  {
    const a = atAxis(0, FNC.harbor.s0 + 1.6), c = atAxis(0, FNC.harbor.s0 - 0.6);
    b.stairs({ from: new THREE.Vector3(a.x, FNC.harbor.quayY, a.z), to: new THREE.Vector3(c.x, Y + 0.05, c.z), width: V.valleyHalf * 2 - 1, material: 'stone_light' });
  }
  const G = P.gatehouse;
  const gp = atAxis(G.t, G.s);
  b.block('stone_light', { x: gp.x, y: Y, z: gp.z, sx: G.w + 6, sy: G.plat, sz: G.d + 6 }, { collide: true, walkable: true });
  b.box('stone_dark', { x: gp.x, y: Y + G.plat - 0.1, z: gp.z, sx: G.w + 6.3, sy: 0.25, sz: G.d + 6.3 });
  for (const dz of [-1, 1]) {
    b.stairs({ from: new THREE.Vector3(gp.x, Y, gp.z + dz * ((G.d + 6) / 2 + 2.2)), to: new THREE.Vector3(gp.x, Y + G.plat, gp.z + dz * ((G.d + 6) / 2)), width: 6, material: 'stone_light' });
  }
  hall(b, { x: gp.x, y: Y + G.plat, z: gp.z, yaw: 0, w: G.w, d: G.d - 3, h: 4.6, veranda: 1.5, colSpacing: 3, roofMat: 'roof_red', horns: 1, crest: 1.2 });
  cap.mark('gatehouse', gp.x, Y + G.plat, gp.z);

  // --- Shrubs at the near ends of the pools, braziers at the far ends, lamps and banners.
  for (const side of [-1, 1]) {
    const tm = (side * (P.poolIn + P.poolOut)) / 2;
    for (const ds of [0, 1]) {
      const p = atAxis(tm + (ds ? side * 2.2 : 0), P.poolS1 + 2.6 + ds * 0.4);
      props.cylinder('stone_light', { x: p.x, y: Y, z: p.z, r: 1.1, h: 0.6, segments: 10 }, { collide: true, walkable: false });
      tree(props, 'bush', { x: p.x, y: Y + 0.55, z: p.z, s: 2.2 + ds * 0.4, variant: ds });
    }
    const bz = atAxis(tm, P.poolS0 - 2.4);
    brazier(b, cap.flames, { x: bz.x, y: Y, z: bz.z, size: 1.15 });
  }
  cap.mark('plazaSpawn', atAxis(0, 606).x, Y, atAxis(0, 606).z);

  // --- Rims: battlements with ballistae and corner watchtowers.
  for (const side of [-1, 1]) {
    const pts: Array<{ x: number; z: number }> = [];
    for (let s = V.s0 + 2; s <= FNC.harbor.s0 - 2; s += 4) pts.push(atAxis(side * (V.valleyHalf + 1.6), s));
    battlement(b, 'stone_tan', pts, { y: (x, z) => rimY(x, z, side) + 0.5, h: 1.1, thick: 0.8, cap: 'stone_light' });
    for (let s = V.s0 + 16; s < FNC.harbor.s0 - 8; s += 22) {
      const q = atAxis(side * (V.valleyHalf + 4.6), s);
      ballista(props, q.x, heightAt(q.x, q.z), q.z, side < 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    for (const s of [V.s0 + 4, FNC.harbor.s0 - 4]) {
      const q = atAxis(side * (V.valleyHalf + 5), s);
      const gy = heightAt(q.x, q.z) - 1;
      b.block('stone_dark', { x: q.x, y: gy, z: q.z, sx: 6, sy: 9, sz: 6 }, { collide: true, walkable: true });
      roof(b, { x: q.x, y: gy + 12, z: q.z, w: 4.4, d: 4.4, h: 2.4, style: 'pyramid', mat: 'roof_red', trim: 'gold', tips: 0.4, finial: 1 });
      for (const [px, pz] of [[-1.9, -1.9], [1.9, -1.9], [1.9, 1.9], [-1.9, 1.9]] as const) b.box('wood_red', { x: q.x + px, y: gy + 10.5, z: q.z + pz, sx: 0.3, sy: 3, sz: 0.3 });
    }
  }
}

/** Top of the valley wall on one side: the hill ground just behind it. */
function rimY(x: number, z: number, side: number): number {
  return Math.max(Y + 4, heightAt(x + side * 8, z) + 0.8);
}

let bay: THREE.MeshStandardMaterial | null = null;
function bayMat(): THREE.MeshStandardMaterial {
  if (!bay) bay = new THREE.MeshStandardMaterial({ color: '#141010', roughness: 0.95 });
  return bay;
}

/** The main tower: four crimson tiers with stacked curved roofs, the speech balcony, banners, and the passage. */
function buildTower(cap: Cap, b: ContentBuilder, props: ContentBuilder): void {
  const tc = atAxis(0, (T.s0 + T.s1) / 2);
  const ph = T.passHalf;
  // Ground tier (+ second): solid either side of the passage, rising tunnel ceiling over it.
  const g = TIERS[0], u = TIERS[1];
  const lowTop = Y + g.h + u.h;
  for (const side of [-1, 1]) {
    const w = g.w / 2 - ph - 0.4;
    const c = atAxis(side * (ph + 0.4 + w / 2), (T.s0 + T.s1) / 2);
    b.block(crimsonMat(), { x: c.x, y: Y, z: c.z, sx: w, sy: g.h, sz: g.d }, { collide: true, walkable: false });
  }
  // Tunnel ceiling: steps following the stair (headroom 2.9 m) up to the top of the second tier.
  const steps = 6;
  for (let k = 0; k < steps; k++) {
    const sa = T.s1 - (k * (T.s1 - T.s0)) / steps, sb = T.s1 - ((k + 1) * (T.s1 - T.s0)) / steps;
    const ceil = stairY(sb) + 2.9;
    if (ceil >= lowTop - 0.2) continue;
    const m = atAxis(0, (sa + sb) / 2);
    b.block('stone_dark', { x: m.x, y: ceil, z: m.z, sx: ph * 2 + 0.8, sy: lowTop - ceil, sz: sa - sb + 0.02 }, { collide: true, walkable: false });
  }
  // Gate frame at the plaza face.
  const gf = atAxis(0, T.s1 + 0.05);
  b.box(goldMat(), { x: gf.x, y: Y + 6.6, z: gf.z, sx: ph * 2 + 1.2, sy: 0.4, sz: 0.3 });
  for (const side of [-1, 1]) b.box(goldMat(), { x: gf.x + side * (ph + 0.4), y: Y + 3.3, z: gf.z, sx: 0.4, sy: 6.6, sz: 0.3 });
  // Lattice windows along the ground tier front.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const p = atAxis(side * (ph + 4.5 + k * 5), T.s1 + 0.06);
      b.box('black_lacquer', { x: p.x, y: Y + 4.4, z: p.z, sx: 3.2, sy: 3.4, sz: 0.1 });
      b.box(paperMat(), { x: p.x, y: Y + 4.4, z: p.z + 0.04, sx: 2.6, sy: 2.6, sz: 0.04 });
    }
  }
  // Tiers 2..4 (tier 2 sits over the ground tier, with its eave roof between).
  let y = Y + g.h;
  for (let i = 0; i < TIERS.length; i++) {
    const L = TIERS[i];
    if (i > 0) {
      b.box('black_lacquer', { x: tc.x, y: y + 0.4, z: tc.z, sx: L.w + 0.6, sy: 0.8, sz: L.d + 0.6 }, { collide: true, walkable: true });
      if (i === 1) {
        // Second tier: solid sides, the tunnel continues under it (already filled above the stair).
        for (const side of [-1, 1]) {
          const w = L.w / 2 - ph - 0.4;
          const c = atAxis(side * (ph + 0.4 + w / 2), (T.s0 + T.s1) / 2);
          b.block(crimsonMat(), { x: c.x, y: y + 0.8, z: c.z, sx: w, sy: L.h - 0.8, sz: L.d }, { collide: true, walkable: false });
        }
        const lm = atAxis(0, (T.s0 + T.s1) / 2);
        b.block(crimsonMat(), { x: lm.x, y: Math.max(y + 0.8, lowTop - 0.01) - 0.01, z: lm.z, sx: ph * 2 + 0.8, sy: 0.02, sz: L.d });
      } else {
        b.block(crimsonMat(), { x: tc.x, y: y + 0.8, z: tc.z, sx: L.w, sy: L.h - 0.8, sz: L.d }, { collide: true, walkable: false });
      }
      // Paper window band.
      const wb = atAxis(0, (T.s0 + T.s1) / 2 + L.d / 2 + 0.06);
      b.box(paperMat(), { x: wb.x, y: y + L.h * 0.55, z: wb.z, sx: L.w * 0.78, sy: L.h * 0.34, sz: 0.05 }, { castShadow: false });
    }
    const top = y + L.h;
    b.box('black_lacquer', { x: tc.x, y: top - 0.5, z: tc.z, sx: L.w + 0.12, sy: 1, sz: L.d + 0.12 });
    b.box(goldMat(), { x: tc.x, y: top - 1.1, z: tc.z, sx: L.w + 0.16, sy: 0.14, sz: L.d + 0.16 }, { castShadow: false });
    const last = i === TIERS.length - 1;
    roof(b, { x: tc.x, y: top, z: tc.z, w: L.w + 1.4, d: L.d + 1.4, h: last ? 7.5 : 3.4, style: 'hip', mat: 'roof_red', trim: 'gold', tips: last ? 1.4 : 1.0, horns: last ? 2.2 : 0, crest: i === 0 ? 2.6 : last ? 2.0 : 0, overhang: 2.6, curve: 1.1 });
    y = top + (last ? 0 : 2.4);
  }
  // Speech balcony on the second tier's face.
  const bal = atAxis(0, T.s1 + 1.8);
  const by = Y + g.h + 2.4;
  b.box('stone_dark', { x: bal.x, y: by, z: bal.z, sx: 18, sy: 0.6, sz: 4.2 }, { collide: true, walkable: true });
  for (let k = -8.4; k <= 8.4; k += 1.2) {
    const q = atAxis(k, T.s1 + 3.7);
    b.box(goldMat(), { x: q.x, y: by + 0.75, z: q.z, sx: 0.14, sy: 0.9, sz: 0.14 }, { castShadow: false });
  }
  b.box(goldMat(), { x: bal.x, y: by + 1.25, z: atAxis(0, T.s1 + 3.7).z, sx: 17.2, sy: 0.12, sz: 0.16 }, { castShadow: false });
  crest(b, { x: bal.x, y: by + 6.4, z: atAxis(0, (T.s0 + T.s1) / 2 + TIERS[1].d / 2 + 0.2).z, yaw: 0, size: 3.6 });
  cap.mark('mainTower', tc.x, Y, tc.z);
  cap.mark('balcony', bal.x, by + 0.3, bal.z);
  // Long banners on the ground tier.
  for (const t of [-22, -12, 12, 22]) {
    const q = atAxis(t, T.s1 + 0.25);
    wallBanner(b, { x: q.x, y: Y + g.h - 1.2, z: q.z, yaw: 0, w: 2.6, len: 7.2, mat: bannerMat() });
  }
  // Passage: stairs from the plaza gate up through the tower and the cut to the Royal Way.
  const foot = atAxis(0, V.passFootS - 0.5), topP = atAxis(0, V.passTopS + 0.5);
  const topY = heightAt(topP.x, topP.z);
  b.stairs({ from: new THREE.Vector3(foot.x, Y, foot.z), to: new THREE.Vector3(topP.x, topY, topP.z), width: ph * 2 - 0.2, material: 'stone_light', sideMaterial: 'stone_dark' });
  for (const side of [-1, 1]) {
    const a = atAxis(side * (ph + 0.3), V.passTopS - 1), c = atAxis(side * (ph + 0.3), T.s0 + 0.5);
    wallFace(b, 'stone_dark', [a, c], { top: (x, z) => Math.max(heightAt(x + side * 2, z), Y + 4) + 0.9, bottom: (x, z) => heightAt(x - side * 1, z) - 0.6, thick: 0.6, collide: true, cap: 'stone_light', capH: 0.3 });
  }
  cap.mark('passageTop', topP.x, topY, topP.z);
  for (const side of [-1, 1]) {
    const q = atAxis(side * (ph + 2.4), T.s1 + 1.4);
    brazier(b, cap.flames, { x: q.x, y: Y, z: q.z, size: 1.05 });
  }
  // Lamps inside the passage.
  for (let s = T.s1 - 6; s > V.passTopS + 4; s -= 9) {
    const q = atAxis(ph - 0.25, s);
    props.lantern(new THREE.Vector3(q.x, stairY(s) + 2.2, q.z), { color: 'warm', hanging: true });
  }
}

/** Two-tier gate pavilion: red columns, a lower eave roof, an upper crimson storey and a horned roof. */
function gatePavilion(b: ContentBuilder, p: { x: number; z: number }): void {
  const W = 10;
  b.block('stone_light', { x: p.x, y: Y, z: p.z, sx: W + 1.6, sy: 0.32, sz: W + 1.6 }, { collide: true, walkable: true });
  const yb = Y + 0.32;
  for (const lx of [-W / 2, -W / 6, W / 6, W / 2]) {
    for (const lz of [-W / 2, W / 2]) {
      b.cylinder(crimsonMat(), { x: p.x + lx, y: yb, z: p.z + lz, r: 0.36, h: 6.2, segments: 10 }, { collide: true, walkable: false });
      b.cylinder(goldMat(), { x: p.x + lx, y: yb, z: p.z + lz, r: 0.46, h: 0.4, segments: 10 });
    }
  }
  for (const lz of [-W / 6, W / 6]) {
    for (const lx of [-W / 2, W / 2]) b.cylinder(crimsonMat(), { x: p.x + lx, y: yb, z: p.z + lz, r: 0.36, h: 6.2, segments: 10 }, { collide: true, walkable: false });
  }
  b.box('black_lacquer', { x: p.x, y: yb + 6.4, z: p.z, sx: W + 0.8, sy: 0.7, sz: W + 0.8 });
  b.box(goldMat(), { x: p.x, y: yb + 6.0, z: p.z, sx: W + 0.9, sy: 0.12, sz: W + 0.9 }, { castShadow: false });
  roof(b, { x: p.x, y: yb + 6.75, z: p.z, w: W + 2, d: W + 2, h: 2.2, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 0.8, overhang: 1.8, curve: 1.1 });
  b.block(crimsonMat(), { x: p.x, y: yb + 8.2, z: p.z, sx: 6, sy: 3.6, sz: 6 });
  b.box(paperMat(), { x: p.x, y: yb + 10, z: p.z, sx: 6.1, sy: 1.4, sz: 6.1 }, { castShadow: false });
  b.box('black_lacquer', { x: p.x, y: yb + 11.6, z: p.z, sx: 6.3, sy: 0.5, sz: 6.3 });
  roof(b, { x: p.x, y: yb + 11.85, z: p.z, w: 7.4, d: 7.4, h: 3.2, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 0.8, horns: 1.1, crest: 1.2, overhang: 1.8, curve: 1.2 });
}
