import * as THREE from 'three';
import { heightAt } from '../../../Heightfield';
import { brazier, crest, roof } from '../parts';
import { crimsonMat } from '../materials';
import type { Cap } from './FireCapital';
import { FNC, PLAZA, atAxis } from './layout';
import { slabRect, wallFace } from './kit';

/**
 * The Royal Plaza: a sand-coloured forum in a valley between cliffs, from the main tower at its
 * head (the only way up into Harbor City, through the passage in the tower's base) to the gate
 * pavilions on the inner quay. Two long still pools run down its length either side of the
 * central avenue. (Phase 1: ground, pools, valley walls, tower mass and passage, gatehouse
 * platform; the halls, pavilions and dressing come in phase 2.)
 */
export function* buildPlaza(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const major = env.chunks.named('major', 'fnc_plaza');
  const b = major.builder;
  const P = PLAZA;
  const Y = P.y;
  const V = FNC.plaza;

  // --- Paving: sand-coloured stone around the pools (the pools are basins in the ground).
  const pave = 'stone_tan' as const;
  const s0 = P.tower.s1, s1 = FNC.harbor.s0;
  const strip = (t0: number, t1: number, a: number, c: number) => {
    const m = atAxis((t0 + t1) / 2, (a + c) / 2);
    slabRect(b, pave, { x: m.x, z: m.z, y: Y + 0.05, w: t1 - t0, d: c - a, thick: 0.3 });
  };
  // Central avenue, between the pools and the halls, and the two ends.
  strip(-P.poolIn, P.poolIn, P.poolS0, P.poolS1);
  for (const side of [-1, 1]) {
    const a = side > 0 ? P.poolOut : -FNC.plaza.valleyHalf;
    const c = side > 0 ? FNC.plaza.valleyHalf : -P.poolOut;
    strip(a, c, P.poolS0, P.poolS1);
  }
  strip(-FNC.plaza.valleyHalf, FNC.plaza.valleyHalf, s0, P.poolS0);
  strip(-FNC.plaza.valleyHalf, FNC.plaza.valleyHalf, P.poolS1, s1);
  // Pool rims and the still water (waterbending sources).
  for (const side of [-1, 1]) {
    const tm = side * (P.poolIn + P.poolOut) / 2;
    const c = atAxis(tm, (P.poolS0 + P.poolS1) / 2);
    const w = P.poolOut - P.poolIn, d = P.poolS1 - P.poolS0;
    for (const [dt, ds, sx, sz] of [[-w / 2, 0, 0.5, d + 0.5], [w / 2, 0, 0.5, d + 0.5], [0, -d / 2, w + 0.5, 0.5], [0, d / 2, w + 0.5, 0.5]] as const) {
      const p = atAxis(tm + dt, (P.poolS0 + P.poolS1) / 2 + ds);
      b.box('stone_light', { x: p.x, y: Y + 0.12, z: p.z, sx, sy: 0.42, sz }, { collide: true, walkable: true, solid: false });
    }
    b.box('stone_dark', { x: c.x, y: Y - V.pool.depth + 0.05, z: c.z, sx: w, sy: 0.1, sz: d });
    cap.water(b, { id: `fire_capital:plaza_pool_${side > 0 ? 'e' : 'w'}`, label: 'Royal Plaza pool', type: 'canal', x: c.x, z: c.z, y: P.water, w: w - 0.1, d: d - 0.1, capacity: 600, regen: 6 });
  }

  // --- Valley walls (retaining faces from the floor up to the hills either side) and the head wall.
  for (const side of [-1, 1]) {
    const pts: Array<{ x: number; z: number }> = [];
    for (let s = FNC.plaza.s0; s <= FNC.harbor.s0 + 0.01; s += 4) pts.push(atAxis(side * FNC.plaza.valleyHalf, s));
    if (side < 0) pts.reverse();
    wallFace(b, 'stone_tan', side > 0 ? pts : pts, {
      top: (x, z) => Math.max(Y + 4, heightAt(x + side * 8, z) + 0.8),
      bottom: () => Y - 0.4,
      thick: 2.4,
      collide: true,
      cap: 'stone_light',
      capH: 0.5,
    });
  }
  {
    // Head wall behind the tower (split by the passage cut).
    const sh = FNC.plaza.s0;
    for (const side of [-1, 1]) {
      const a = atAxis(side * (V.passHalf + 0.6), sh), c = atAxis(side * FNC.plaza.valleyHalf, sh);
      wallFace(b, 'stone_tan', [a, c], { top: (x, z) => heightAt(x, z - 8) + 0.6, bottom: () => Y - 0.4, thick: 3, collide: true, cap: 'stone_light', capH: 0.5 });
    }
  }
  yield;

  // --- Main tower (mass; dressing in phase 2) with the passage through its base.
  const T = P.tower;
  const tc = atAxis(0, (T.s0 + T.s1) / 2);
  const depth = T.s1 - T.s0;
  const storey = 7.5;
  // Ground storey: two blocks either side of the passage + the lintel over it.
  for (const side of [-1, 1]) {
    const w = T.half - T.passHalf - 0.4;
    const c = atAxis(side * (T.passHalf + 0.4 + w / 2), (T.s0 + T.s1) / 2);
    b.block(crimsonMat(), { x: c.x, y: Y, z: c.z, sx: w, sy: storey, sz: depth }, { collide: true, walkable: false });
  }
  b.block('stone_dark', { x: tc.x, y: Y + 4.6, z: tc.z, sx: 2 * T.passHalf + 0.8, sy: storey - 4.6, sz: depth });
  // Upper storeys, stepping back.
  let y = Y + storey;
  const tiers = [
    { w: T.half * 2, d: depth, h: storey },
    { w: T.half * 2 - 8, d: depth - 6, h: storey },
    { w: T.half * 2 - 18, d: depth - 11, h: storey * 0.9 },
  ];
  for (let i = 0; i < tiers.length; i++) {
    const L = tiers[i];
    b.box('stone_dark', { x: tc.x, y: y + 0.4, z: tc.z, sx: L.w + 1.6, sy: 0.8, sz: L.d + 1.6 }, { collide: true, walkable: true });
    b.block(crimsonMat(), { x: tc.x, y: y + 0.8, z: tc.z, sx: L.w, sy: L.h - 0.8, sz: L.d }, { collide: true, walkable: false });
    const top = y + L.h;
    roof(b, { x: tc.x, y: top, z: tc.z, w: L.w + 1, d: L.d + 1, h: i === tiers.length - 1 ? 7 : 3.2, style: i === tiers.length - 1 ? 'hip' : 'hip', mat: 'roof_red', trim: 'gold', tips: 0.9, horns: i === tiers.length - 1 ? 1.6 : 0, crest: i === 0 ? 2.4 : 0, overhang: 2.2 });
    y = top + 1.4;
  }
  // The speech balcony on the south face (first upper storey), with the crest above.
  const bal = atAxis(0, T.s1 + 1.6);
  b.box('stone_dark', { x: bal.x, y: Y + storey + 0.3, z: bal.z, sx: 16, sy: 0.6, sz: 3.6 }, { collide: true, walkable: true });
  for (let k = -7; k <= 7; k += 1.4) {
    const q = atAxis(k, T.s1 + 3.2);
    b.box('gold', { x: q.x, y: Y + storey + 1.0, z: q.z, sx: 0.14, sy: 0.9, sz: 0.14 });
  }
  b.box('gold', { x: bal.x, y: Y + storey + 1.5, z: bal.z + 1.55, sx: 16, sy: 0.12, sz: 0.14 });
  crest(b, { x: bal.x, y: Y + storey * 2 - 1.5, z: atAxis(0, T.s1).z + 0.15, yaw: 0, size: 3.4 });
  cap.mark('mainTower', tc.x, Y, tc.z);
  cap.mark('balcony', bal.x, Y + storey + 0.6, bal.z);

  // Passage: stairs from the plaza gate up through the tower and the cut to the Royal Way.
  const foot = atAxis(0, V.passFootS - 0.5), top = atAxis(0, V.passTopS + 0.5);
  const topY = heightAt(top.x, top.z);
  b.stairs({ from: new THREE.Vector3(foot.x, Y, foot.z), to: new THREE.Vector3(top.x, topY, top.z), width: V.passHalf * 2 - 0.2, material: 'stone_light', sideMaterial: 'stone_dark' });
  for (const side of [-1, 1]) {
    const a = atAxis(side * (V.passHalf + 0.3), V.passTopS - 1), c = atAxis(side * (V.passHalf + 0.3), T.s0 + 0.5);
    wallFace(b, 'stone_dark', side > 0 ? [c, a] : [a, c], { top: (x, z) => Math.max(heightAt(x + side * 2, z), Y + 4) + 0.9, bottom: (x, z) => heightAt(x - side * 1, z) - 0.6, thick: 0.6, collide: true, cap: 'stone_light', capH: 0.3 });
  }
  cap.mark('passageTop', top.x, topY, top.z);
  // Braziers flanking the passage gate.
  for (const side of [-1, 1]) {
    const q = atAxis(side * (T.passHalf + 2.2), T.s1 + 1.2);
    brazier(b, cap.flames, { x: q.x, y: Y, z: q.z, size: 1.05 });
  }
  yield;

  // --- Gatehouse platform at the harbour end (the gatehouse itself in phase 2).
  const G = P.gatehouse;
  const gp = atAxis(G.t, G.s);
  b.block('stone_light', { x: gp.x, y: Y, z: gp.z, sx: G.w + 6, sy: G.plat, sz: G.d + 6 }, { collide: true, walkable: true });
  b.stairs({ from: new THREE.Vector3(gp.x, Y, gp.z - (G.d + 6) / 2 - 2.2), to: new THREE.Vector3(gp.x, Y + G.plat, gp.z - (G.d + 6) / 2), width: 6, material: 'stone_light' });
  b.stairs({ from: new THREE.Vector3(gp.x, Y, gp.z + (G.d + 6) / 2 + 2.2), to: new THREE.Vector3(gp.x, Y + G.plat, gp.z + (G.d + 6) / 2), width: 6, material: 'stone_light' });
  cap.mark('gatehouse', gp.x, Y + G.plat, gp.z);
  cap.mark('plazaSpawn', ...xyz(atAxis(0, 606), Y));
}

function xyz(p: { x: number; z: number }, y: number): [number, number, number] {
  return [p.x, y, p.z];
}
