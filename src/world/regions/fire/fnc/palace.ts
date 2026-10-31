import * as THREE from 'three';
import { heightAt } from '../../../Heightfield';
import type { ContentBuilder } from '../../../kit/Builder';
import { basaltMat, crimsonMat, emberGlowMat, goldMat, paperMat } from '../materials';
import { P as FP, bannerPole, brazier, crest, roof, wallBanner } from '../parts';
import type { Cap } from './FireCapital';
import { FNC, PALACE, atAxis, atPolar } from './layout';
import { battlement, slabRect } from './kit';

/**
 * The Royal Palace on its barren, scorched hill inside a twelve-sided ring wall with guard towers.
 * One structure: a central tower with triple eaves; two smaller wings flank the main entrance, each
 * ending in a tower; the larger third wing opposite the entrance holds the throne room. Battered
 * dark-stone plinths, crimson walls, black and gold, steep red roofs with horns and crests —
 * "Egyptian, Chinese, scary". A grand stair climbs from the gate to the courtyard where the
 * nobles gather at dawn.
 *
 * Interiors (walkable): the entrance hall in the central tower; the throne room (black pillars on
 * gold bases, black tiled floor, the covered throne on its high platform behind a wall of fire,
 * an enormous dragon relief); the Royal Gallery of past Fire Lords in the west wing; the Agni Kai
 * arena, a partly indoor arena on the upper level east of the tower with seating on three sides.
 *
 * Axis coordinates: t east of V, s south of V. Hill top y = FNC.hillY.
 */

const H = FNC.hillY;
/** Palace floor (top of the plinths) and the courtyard. */
const PF = H + 1.2;
const CY = H + 0.2;
const L = (t: number, s: number) => atAxis(t, s);

export function* buildPalace(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const major = env.chunks.named('major', 'fnc_palace');
  const b = major.builder;
  const inner = env.chunks.named('props', 'fnc_palace_inner').builder;

  ringWall(cap, b);
  yield;
  scorchedHill(b);

  // --- Grand stair from the gate up to the courtyard, and the courtyard itself.
  const gateY = heightAt(L(0, PALACE.ringR - 2).x, L(0, PALACE.ringR - 2).z);
  b.stairs({ from: new THREE.Vector3(L(0, PALACE.ringR - 2).x, gateY, L(0, PALACE.ringR - 2).z), to: new THREE.Vector3(L(0, 27).x, CY, L(0, 27).z), width: 10, material: 'stone_light', sideMaterial: 'stone_dark' });
  const ct = L(0, 17);
  b.block('stone_dark', { x: ct.x, y: H - 3, z: ct.z, sx: 18, sy: CY - H + 3, sz: 20 }, { collide: true, walkable: true });
  slabRect(b, 'paving_dark', { x: ct.x, z: ct.z, y: CY + 0.03, w: 17.4, d: 19.4, thick: 0.1 });
  for (const side of [-1, 1]) {
    for (const s of [12, 20]) {
      const q = L(side * 7.6, s);
      brazier(b, cap.flames, { x: q.x, y: CY, z: q.z, size: 1.1 });
    }
  }
  // Steps up to the palace floor at the entrance and the two wing doors.
  b.stairs({ from: new THREE.Vector3(L(0, 10.2).x, CY, L(0, 10.2).z), to: new THREE.Vector3(L(0, 8.4).x, PF, L(0, 8.4).z), width: 4.4, material: 'stone_light' });
  for (const side of [-1, 1]) {
    const a = L(side * 7.2, 10), e = L(side * 8.6, 10);
    b.stairs({ from: new THREE.Vector3(a.x, CY, a.z), to: new THREE.Vector3(e.x, PF, e.z), width: 2.6, material: 'stone_light' });
  }
  cap.mark('courtyard', ct.x, CY, ct.z);
  yield;

  // --- Central tower (entrance hall inside) with triple eaves.
  centralTower(cap, b, inner);
  yield;
  // --- Front wings with end towers; the Royal Gallery in the west wing.
  for (const side of [-1, 1]) frontWing(cap, b, inner, side);
  yield;
  // --- Throne wing.
  throneRoom(cap, b, inner);
  yield;
  // --- Agni Kai arena.
  agniKai(cap, b, inner);
  yield;
}

/** Twelve-sided ring wall with guard towers and the main gate (Fire Nation insignia). */
function ringWall(cap: Cap, b: ContentBuilder): void {
  const n = PALACE.sides;
  const R = PALACE.ringR;
  const gateHalf = 5;
  const vertex = (i: number) => atPolar(90 + (360 / n) * (i + 0.5), R);
  for (let i = 0; i < n; i++) {
    const a = vertex(i - 1), c = vertex(i);
    const pieces = i === 0 ? [[a, atPolar(90 - 7.6, R)], [atPolar(90 + 7.6, R), c]] : [[a, c]];
    for (const [p, q] of pieces) {
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const yaw = Math.atan2(q.x - p.x, q.z - p.z);
      const base = Math.min(heightAt(p.x, p.z), heightAt(q.x, q.z)) - 1;
      b.box('stone_dark', { x: mx, y: base + (PALACE.wallH + 1) / 2, z: mz, sx: 2.4, sy: PALACE.wallH + 1, sz: len, yaw }, { collide: true, walkable: true });
      b.box(crimsonMat(), { x: mx, y: base + PALACE.wallH - 0.6, z: mz, sx: 2.5, sy: 0.7, sz: len + 0.02, yaw });
      battlement(b, 'stone_dark', [p, q], { y: () => base + PALACE.wallH + 1, h: 0.9, thick: 0.6, cap: 'stone_tan' });
    }
    const v = vertex(i);
    const vb = heightAt(v.x, v.z) - 1;
    b.block('stone_dark', { x: v.x, y: vb, z: v.z, sx: 5.4, sy: PALACE.wallH + 6, sz: 5.4 }, { collide: true, walkable: true });
    b.box(crimsonMat(), { x: v.x, y: vb + PALACE.wallH + 4.6, z: v.z, sx: 5.6, sy: 1, sz: 5.6 });
    roof(b, { x: v.x, y: vb + PALACE.wallH + 8, z: v.z, w: 4.6, d: 4.6, h: 2.8, style: 'pyramid', mat: 'roof_red', trim: 'gold', tips: 0.45, finial: 1.1 });
    for (const [px, pz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]] as const) b.box('black_lacquer', { x: v.x + px, y: vb + PALACE.wallH + 7, z: v.z + pz, sx: 0.32, sy: 2.2, sz: 0.32 });
  }
  const g = atAxis(0, R);
  const gy = heightAt(g.x, g.z);
  for (const side of [-1, 1]) {
    const c = atAxis(side * (gateHalf + 2.6), R);
    b.block('stone_dark', { x: c.x, y: gy - 1, z: c.z, sx: 5.2, sy: 15, sz: 6.4 }, { collide: true, walkable: true });
    brazier(b, cap.flames, { x: c.x, y: gy, z: c.z + 4.8, size: 1.2 });
    bannerPole(b, { x: c.x + side * 3.4, y: gy, z: c.z + 3.8, yaw: 0, h: 11 });
  }
  b.block(crimsonMat(), { x: g.x, y: gy + 8.5, z: g.z, sx: gateHalf * 2 + 0.2, sy: 5.5, sz: 6.4 }, { collide: true, walkable: true });
  b.box('black_lacquer', { x: g.x, y: gy + 8.3, z: g.z, sx: gateHalf * 2 + 0.4, sy: 0.6, sz: 6.6 });
  roof(b, { x: g.x, y: gy + 14.6, z: g.z, w: 21, d: 8.4, h: 4.4, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 0.9, horns: 1.6, crest: 2.2 });
  // The great insignia on the gate.
  crest(b, { x: g.x, y: gy + 11.2, z: g.z + 3.3, yaw: 0, size: 4.4 });
  cap.mark('palaceGate', g.x, gy, g.z);
}

/** Dark basalt drape over the palace hill (barren, scorched; nothing grows here). */
function scorchedHill(b: ContentBuilder): void {
  const R = PALACE.ringR - 1.4;
  const rings = 14, segs = 48;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const r = (R * i) / rings;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = FNC.V.x + Math.cos(a) * r, z = FNC.V.z + Math.sin(a) * r;
      pos.push(x, heightAt(x, z) + 0.05, z);
      uv.push((x - FNC.V.x) / 4, (z - FNC.V.z) / 4);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * row + j, c = a + row;
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  b.mesh(basaltMat(), g, { x: 0, y: 0, z: 0 }, { castShadow: false });
  g.dispose();
}

/** Battered (sloping) dark-stone plinth under a building: Egyptian-heavy base. */
function plinth(b: ContentBuilder, t0: number, t1: number, s0: number, s1: number, top: number): void {
  const c = L((t0 + t1) / 2, (s0 + s1) / 2);
  const w = t1 - t0, d = s1 - s0;
  const bottom = H - 2.5;
  const hgt = top - bottom;
  const g = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 1.0, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  // Frustum: wider at the foot.
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < 0) {
      p.setX(i, p.getX(i) * 1.08);
      p.setZ(i, p.getZ(i) * 1.08);
    }
  }
  g.computeVertexNormals();
  b.mesh(basaltMat(), g, { x: c.x, y: bottom + hgt / 2, z: c.z, sx: w + 0.6, sy: hgt, sz: d + 0.6 });
  g.dispose();
  b.box(goldMat(), { x: c.x, y: top - 0.05, z: c.z, sx: w + 0.7, sy: 0.12, sz: d + 0.7 }, { castShadow: false });
  b.collider({ shape: 'box', x: c.x, y: (bottom + top) / 2, z: c.z, hx: (w + 0.6) / 2, hy: (top - bottom) / 2, hz: (d + 0.6) / 2, walkable: true, solid: true });
}

/** Hollow storey: four walls (thickness th) with door gaps; returns nothing. */
function walls(b: ContentBuilder, mat: THREE.Material | 'stone_dark', t0: number, t1: number, s0: number, s1: number, y: number, h: number, doors: Array<{ side: 'n' | 's' | 'e' | 'w'; at: number; w: number; h: number }>, th = 0.8): void {
  const wallRun = (side: 'n' | 's' | 'e' | 'w') => {
    const along = side === 'n' || side === 's';
    const a0 = along ? t0 : s0, a1 = along ? t1 : s1;
    const fixed = side === 'n' ? s0 : side === 's' ? s1 : side === 'e' ? t1 : t0;
    const gaps = doors.filter((d) => d.side === side).sort((p, q) => p.at - q.at);
    let cur = a0;
    const seg = (u0: number, u1: number, yy: number, hh: number) => {
      if (u1 - u0 < 0.05 || hh < 0.05) return;
      const m = along ? L((u0 + u1) / 2, fixed) : L(fixed, (u0 + u1) / 2);
      b.box(mat, { x: m.x, y: yy + hh / 2, z: m.z, sx: along ? u1 - u0 : th, sy: hh, sz: along ? th : u1 - u0 }, { collide: true, walkable: false });
    };
    for (const d of gaps) {
      seg(cur, d.at - d.w / 2, y, h);
      seg(d.at - d.w / 2, d.at + d.w / 2, y + d.h, h - d.h);
      cur = d.at + d.w / 2;
    }
    seg(cur, a1, y, h);
  };
  for (const s of ['n', 's', 'e', 'w'] as const) wallRun(s);
}

/** Central tower: entrance hall inside, triple eaves above. */
function centralTower(cap: Cap, b: ContentBuilder, inner: ContentBuilder): void {
  const T = 7.5;
  plinth(b, -T - 1, T + 1, -T - 1, T + 1, PF);
  const hall = 9;
  walls(b, interiorMat(), -T, T, -T, T, PF, hall, [
    { side: 's', at: 0, w: 4.4, h: 6 },
    { side: 'n', at: 0, w: 4, h: 6 },
    { side: 'w', at: 0, w: 3, h: 4.6 },
    { side: 'e', at: 0, w: 3, h: 4.6 },
  ]);
  const c = L(0, 0);
  // Floor, ceiling, gold bands, a crest over the entrance.
  b.box('black_lacquer', { x: c.x, y: PF + 0.02, z: c.z, sx: T * 2 - 0.2, sy: 0.06, sz: T * 2 - 0.2 });
  b.box('stone_dark', { x: c.x, y: PF + hall + 0.3, z: c.z, sx: T * 2 + 0.4, sy: 0.6, sz: T * 2 + 0.4 }, { collide: true, walkable: true });
  b.box(goldMat(), { x: c.x, y: PF + hall - 1.2, z: c.z, sx: T * 2 + 0.06, sy: 0.18, sz: T * 2 + 0.06 }, { castShadow: false });
  crest(b, { x: c.x, y: PF + 7.4, z: L(0, T).z + 0.45, yaw: 0, size: 2.2 });
  // Inside: braziers either side of the throne corridor, banners.
  for (const side of [-1, 1]) {
    const q = L(side * 4.6, -4.6);
    brazier(inner, cap.flames, { x: q.x, y: PF, z: q.z, size: 0.9 });
    const w = L(side * (T - 0.45), 2);
    wallBanner(inner, { x: w.x, y: PF + 6.5, z: w.z, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2, w: 2, len: 5 });
  }
  // Tiers above (triple eaves).
  let y = PF + hall + 0.6;
  roof(b, { x: c.x, y, z: c.z, w: T * 2 + 3, d: T * 2 + 3, h: 2.6, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 1.1, overhang: 2.4, curve: 1.2 });
  const tiers = [{ w: 11, h: 6.5 }, { w: 8, h: 5.5 }];
  y += 2.4;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    b.block(crimsonMat(), { x: c.x, y, z: c.z, sx: t.w, sy: t.h, sz: t.w });
    b.box(paperMat(), { x: c.x, y: y + t.h * 0.55, z: c.z, sx: t.w + 0.05, sy: t.h * 0.32, sz: t.w + 0.05 }, { castShadow: false });
    b.box('black_lacquer', { x: c.x, y: y + t.h - 0.4, z: c.z, sx: t.w + 0.1, sy: 0.8, sz: t.w + 0.1 });
    const last = i === tiers.length - 1;
    roof(b, { x: c.x, y: y + t.h, z: c.z, w: t.w + 2.4, d: t.w + 2.4, h: last ? 6 : 2.6, style: last ? 'pyramid' : 'hip', mat: 'roof_red', trim: 'gold', tips: 1, horns: last ? 0 : 1.6, finial: last ? 3.2 : 0, crest: i === 0 ? 1.8 : 0, overhang: 2, curve: 1.2 });
    y += t.h + 2.6;
  }
  cap.mark('palace', c.x, PF, c.z);
  cap.mark('palaceHall', c.x, PF, c.z);
}

/** Front wing on one side with its end tower; the west wing holds the Royal Gallery. */
function frontWing(cap: Cap, b: ContentBuilder, inner: ContentBuilder, side: number): void {
  const t0 = side < 0 ? -17 : 9, t1 = side < 0 ? -9 : 17;
  const s0 = 6, s1 = 23;
  plinth(b, t0 - 0.6, t1 + 0.6, s0, s1 + 6.5, PF);
  const h = 6.4;
  const doorT = side < 0 ? t1 : t0; // courtyard face
  walls(b, interiorMat(), t0, t1, s0, s1, PF, h, [{ side: side < 0 ? 'e' : 'w', at: 10, w: 2.6, h: 4.2 }]);
  void doorT;
  const c = L((t0 + t1) / 2, (s0 + s1) / 2);
  b.box('black_lacquer', { x: c.x, y: PF + 0.02, z: c.z, sx: t1 - t0 - 0.2, sy: 0.06, sz: s1 - s0 - 0.2 });
  b.box('stone_dark', { x: c.x, y: PF + h + 0.25, z: c.z, sx: t1 - t0 + 0.3, sy: 0.5, sz: s1 - s0 + 0.3 }, { collide: true, walkable: true });
  roof(b, { x: c.x, y: PF + h + 0.5, z: c.z, w: t1 - t0 + 2.4, d: s1 - s0 + 2.4, h: 3.6, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 0.9, horns: 1.2, overhang: 1.8, curve: 1.1 });
  // Lattice windows on the courtyard face.
  for (let s = s0 + 3; s < s1 - 1; s += 4) {
    if (Math.abs(s - 10) < 2) continue;
    const q = L(side < 0 ? t1 + 0.42 : t0 - 0.42, s);
    b.box(paperMat(), { x: q.x, y: PF + 3.6, z: q.z, sx: 0.05, sy: 2.4, sz: 2.4 }, { castShadow: false });
  }
  // End tower (three tiers).
  const tc = L((t0 + t1) / 2, s1 + 3.2);
  let y = PF;
  for (let i = 0; i < 3; i++) {
    const w = 7.6 - i * 1.6, hh = i === 0 ? 7 : 5;
    b.block(crimsonMat(), { x: tc.x, y, z: tc.z, sx: w, sy: hh, sz: w }, i === 0 ? { collide: true, walkable: true } : {});
    b.box('black_lacquer', { x: tc.x, y: y + hh - 0.35, z: tc.z, sx: w + 0.1, sy: 0.7, sz: w + 0.1 });
    roof(b, { x: tc.x, y: y + hh, z: tc.z, w: w + 2, d: w + 2, h: i === 2 ? 4.4 : 2.2, style: i === 2 ? 'pyramid' : 'hip', mat: 'roof_red', trim: 'gold', tips: 0.8, finial: i === 2 ? 2.2 : 0, overhang: 1.6, curve: 1.2 });
    y += hh + 2.2;
  }
  if (side < 0) {
    // The Royal Gallery: tall portraits of past Fire Lords down both walls.
    const portraits = portraitMats();
    let k = 0;
    for (let s = s0 + 2.6; s < s1 - 1.5; s += 3.4) {
      for (const tt of [t0 + 0.45, t1 - 0.45]) {
        if (tt === t1 - 0.45 && Math.abs(s - 10) < 2.2) continue;
        const q = L(tt, s);
        const yaw = tt < (t0 + t1) / 2 ? Math.PI / 2 : -Math.PI / 2;
        inner.box('black_lacquer', { x: q.x, y: PF + 3.2, z: q.z, sx: 1.9, sy: 3.9, sz: 0.12, yaw });
        inner.box(goldMat(), { x: q.x, y: PF + 5.25, z: q.z, sx: 2.0, sy: 0.14, sz: 0.16, yaw });
        const off = tt < (t0 + t1) / 2 ? 0.08 : -0.08;
        inner.box(portraits[k++ % portraits.length], { x: q.x + off, y: PF + 3.2, z: q.z, sx: 1.55, sy: 3.4, sz: 0.04, yaw });
      }
    }
    // Lamps along the gallery and gold sconces between the portraits.
    for (let s = s0 + 4; s < s1; s += 6) {
      const q = L((t0 + t1) / 2, s);
      inner.lantern(new THREE.Vector3(q.x, PF + 5, q.z), { color: 'warm', hanging: true });
    }
    for (let s = s0 + 4.3; s < s1 - 1; s += 3.4) {
      for (const tt of [t0 + 0.5, t1 - 0.5]) {
        const q = L(tt, s);
        inner.box(goldMat(), { x: q.x, y: PF + 4.4, z: q.z, sx: 0.24, sy: 0.5, sz: 0.24 });
        inner.box(emberGlowMat(), { x: q.x, y: PF + 4.8, z: q.z, sx: 0.18, sy: 0.32, sz: 0.18 });
      }
    }
    cap.mark('gallery', c.x, PF, c.z);
  } else {
    // East wing: the stair up to the Agni Kai arena runs along its north end (outside).
    cap.mark('eastWing', c.x, PF, c.z);
  }
}

/** The throne room in the north wing. */
function throneRoom(cap: Cap, b: ContentBuilder, inner: ContentBuilder): void {
  const t0 = -8, t1 = 8, s0 = -28, s1 = -7.5;
  plinth(b, t0 - 0.8, t1 + 0.8, s0 - 0.8, s1, PF);
  const h = 10;
  walls(b, interiorMat(), t0, t1, s0, s1, PF, h, [{ side: 's', at: 0, w: 4, h: 6 }]);
  const c = L(0, (s0 + s1) / 2);
  // Black tiled floor, the ceiling, gold frieze.
  b.box('black_lacquer', { x: c.x, y: PF + 0.03, z: c.z, sx: t1 - t0 - 0.2, sy: 0.06, sz: s1 - s0 - 0.2 });
  for (let s = s0 + 1; s < s1; s += 2) {
    const q = L(0, s);
    inner.box(goldMat(), { x: q.x, y: PF + 0.065, z: q.z, sx: t1 - t0 - 0.4, sy: 0.01, sz: 0.04 }, { castShadow: false });
  }
  b.box('stone_dark', { x: c.x, y: PF + h + 0.35, z: c.z, sx: t1 - t0 + 0.4, sy: 0.7, sz: s1 - s0 + 0.4 }, { collide: true, walkable: true });
  b.box(goldMat(), { x: c.x, y: PF + h - 0.9, z: c.z, sx: t1 - t0 - 1.3, sy: 0.2, sz: s1 - s0 - 1.3 }, { castShadow: false });
  roof(b, { x: c.x, y: PF + h + 0.7, z: c.z, w: t1 - t0 + 3, d: s1 - s0 + 3, h: 5.4, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 1.2, horns: 2.2, crest: 2, overhang: 2.2, curve: 1.2 });
  // Black pillars on gold bases.
  for (const tt of [-4.4, 4.4]) {
    for (const s of [-11, -15, -19]) {
      const q = L(tt, s);
      inner.cylinder(goldMat(), { x: q.x, y: PF, z: q.z, r: 0.85, rTop: 0.72, h: 0.8, segments: 12 });
      inner.cylinder('black_lacquer', { x: q.x, y: PF + 0.8, z: q.z, r: 0.55, h: h - 1.6, segments: 12 }, { collide: true, walkable: false });
      inner.cylinder(goldMat(), { x: q.x, y: PF + h - 0.9, z: q.z, r: 0.7, rTop: 0.85, h: 0.5, segments: 12 });
    }
  }
  // The high platform with steps, the covered throne, the wall of fire before it.
  const dz0 = -26.8, dz1 = -21.2, dh = 2.4;
  const dc = L(0, (dz0 + dz1) / 2);
  b.box('black_lacquer', { x: dc.x, y: PF + dh / 2, z: dc.z, sx: 11, sy: dh, sz: dz1 - dz0 }, { collide: true, walkable: true });
  b.box(goldMat(), { x: dc.x, y: PF + dh - 0.04, z: dc.z, sx: 11.1, sy: 0.12, sz: dz1 - dz0 + 0.1 }, { castShadow: false });
  // Side stair (east): the wall of fire runs unbroken across the platform's front.
  const sa = L(6.5, dz1 + 0.4), sb = L(6.5, dz0 + 2.2);
  b.stairs({ from: new THREE.Vector3(sa.x, PF, sa.z), to: new THREE.Vector3(sb.x, PF + dh, sb.z), width: 2, material: 'black_lacquer' });
  b.box('black_lacquer', { x: L(5.9, dz0 + 1.2).x, y: PF + dh / 2, z: L(5.9, dz0 + 1.2).z, sx: 1.4, sy: dh, sz: 2.2 }, { collide: true, walkable: true });
  const th = L(0, dz0 + 1.6);
  const ty = PF + dh;
  inner.box('black_lacquer', { x: th.x, y: ty + 0.55, z: th.z, sx: 2.2, sy: 1.1, sz: 1.6 });
  inner.box(crimsonMat(), { x: th.x, y: ty + 1.18, z: th.z, sx: 1.8, sy: 0.16, sz: 1.3 });
  inner.box('black_lacquer', { x: th.x, y: ty + 2.4, z: th.z - 0.7, sx: 2.4, sy: 2.6, sz: 0.3 });
  inner.box(goldMat(), { x: th.x, y: ty + 3.75, z: th.z - 0.7, sx: 2.6, sy: 0.2, sz: 0.36 });
  for (const tt of [-1.4, 1.4]) {
    const q = L(tt, dz0 + 1.6);
    inner.box(goldMat(), { x: q.x, y: ty + 0.9, z: q.z, sx: 0.2, sy: 0.7, sz: 1.5 });
  }
  // Canopy over the throne.
  for (const [tt, ss] of [[-2, dz0 + 0.5], [2, dz0 + 0.5], [-2, dz0 + 3.2], [2, dz0 + 3.2]] as const) {
    const q = L(tt, ss);
    inner.cylinder(goldMat(), { x: q.x, y: ty, z: q.z, r: 0.12, h: 4.4, segments: 8 });
  }
  roof(inner, { x: th.x, y: ty + 4.4, z: L(0, dz0 + 1.85).z, w: 4.6, d: 3.4, h: 1.4, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 0.5, horns: 0.7, overhang: 0.5, curve: 1 });
  // Wall of fire along the platform's front.
  const wf = L(0, dz1 + 0.9);
  inner.box(emberGlowMat(), { x: wf.x, y: PF + 0.18, z: wf.z, sx: 10.4, sy: 0.3, sz: 0.7 });
  for (let tt = -4.8; tt <= 4.81; tt += 1.2) {
    const q = L(tt, dz1 + 0.9);
    cap.flames.add(q.x, PF + 0.3, q.z, 1.25, 3.4);
  }
  // The dragon relief on the back wall: a great gold dragon breathing fire on a red field.
  const rw = L(0, s0 + 0.48);
  b.box(interiorMat(), { x: rw.x, y: PF + h / 2 + 0.6, z: rw.z, sx: t1 - t0 - 1.6, sy: h - 2.2, sz: 0.1 });
  inner.mesh(reliefMat(), FP.dragon(), { x: rw.x, y: PF + 4.2, z: rw.z + 0.35, yaw: Math.PI / 2, sx: 4.2, sy: 4.2, sz: 1.2 });
  for (let k = 0; k < 5; k++) {
    const q = L(3.6 + k * 0.6, s0 + 0.55);
    inner.box(emberGlowMat(), { x: q.x, y: PF + 7.2 - k * 0.2, z: q.z, sx: 0.5, sy: 0.9 + k * 0.25, sz: 0.06 });
  }
  // Braziers flanking the doors.
  for (const side of [-1, 1]) {
    const q = L(side * 5.6, s1 - 1.6);
    brazier(inner, cap.flames, { x: q.x, y: PF, z: q.z, size: 0.9 });
  }
  cap.mark('throneRoom', c.x, PF, c.z);
  cap.mark('throne', th.x, ty, th.z);
}

/** The Agni Kai arena: a raised, roofed (partly indoor) arena east of the tower, seating on three sides. */
function agniKai(cap: Cap, b: ContentBuilder, inner: ContentBuilder): void {
  const t0 = 11, t1 = 28, s0 = -16, s1 = 3;
  const AY = PF + 4.4;
  plinth(b, t0, t1, s0, s1, AY);
  const c = L((t0 + t1) / 2, (s0 + s1) / 2);
  slabRect(b, 'stone_tan', { x: c.x, z: c.z, y: AY + 0.03, w: t1 - t0 - 0.6, d: s1 - s0 - 0.6, thick: 0.1 });
  // Flame circle on the duel floor.
  const ring = new THREE.RingGeometry(3.6, 4.0, 40);
  ring.rotateX(-Math.PI / 2);
  inner.mesh(crimsonMat(), ring, { x: c.x, y: AY + 0.1, z: c.z });
  ring.dispose();
  // Seating tiers on the north, east and south sides.
  for (const [side, len] of [['n', t1 - t0 - 2], ['s', t1 - t0 - 2], ['e', s1 - s0 - 2]] as const) {
    for (let k = 0; k < 3; k++) {
      const off = 1.2 + k * 1.1;
      const ty = AY + 0.45 + k * 0.45;
      const q = side === 'n' ? L((t0 + t1) / 2, s0 + off) : side === 's' ? L((t0 + t1) / 2, s1 - off) : L(t1 - off, (s0 + s1) / 2);
      b.box('wood_red', { x: q.x, y: ty, z: q.z, sx: side === 'e' ? 1.0 : len - k * 2, sy: 0.9, sz: side === 'e' ? len - k * 2 : 1.0 }, { collide: true, walkable: true });
    }
  }
  // Roof on columns (open sides).
  for (const tt of [t0 + 0.4, (t0 + t1) / 2, t1 - 0.4]) {
    for (const ss of [s0 + 0.4, s1 - 0.4]) {
      const q = L(tt, ss);
      b.cylinder(crimsonMat(), { x: q.x, y: AY, z: q.z, r: 0.42, h: 8, segments: 10 }, { collide: true, walkable: false });
    }
  }
  for (const ss of [s0 + 0.4 + 6, s1 - 0.4 - 6]) {
    const q = L(t1 - 0.4, ss);
    b.cylinder(crimsonMat(), { x: q.x, y: AY, z: q.z, r: 0.42, h: 8, segments: 10 }, { collide: true, walkable: false });
  }
  b.box('black_lacquer', { x: c.x, y: AY + 8.2, z: c.z, sx: t1 - t0 + 0.6, sy: 0.7, sz: s1 - s0 + 0.6 });
  roof(b, { x: c.x, y: AY + 8.5, z: c.z, w: t1 - t0 + 3, d: s1 - s0 + 3, h: 4.6, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 1.1, horns: 1.8, crest: 1.6, overhang: 2, curve: 1.2 });
  // Stair up from the hill top (west side, along the tower's east face).
  const sa = L(10.2, 5.8), sb = L(10.2, -4.4);
  b.stairs({ from: new THREE.Vector3(sa.x, CY, sa.z), to: new THREE.Vector3(sb.x, AY, sb.z), width: 2.6, material: 'stone_light' });
  b.box('stone_dark', { x: L(10.6, -5.6).x, y: AY - 0.25, z: L(10.6, -5.6).z, sx: 1.8, sy: 0.5, sz: 3 }, { collide: true, walkable: true });
  for (const ss of [s0 + 2, s1 - 2]) {
    const q = L(t0 + 1.2, ss);
    brazier(b, cap.flames, { x: q.x, y: AY, z: q.z, size: 0.85 });
  }
  cap.mark('agniKai', c.x, AY, c.z);
}

let interior: THREE.MeshStandardMaterial | null = null;
/** Crimson for walls seen from inside: a faint warm glow stands in for lamp light. */
function interiorMat(): THREE.MeshStandardMaterial {
  if (!interior) interior = new THREE.MeshStandardMaterial({ color: '#8a1c14', emissive: '#3a0a06', emissiveIntensity: 1, roughness: 0.55 });
  return interior;
}
let relief: THREE.MeshStandardMaterial | null = null;
/** Gold relief catching the firelight. */
function reliefMat(): THREE.MeshStandardMaterial {
  if (!relief) relief = new THREE.MeshStandardMaterial({ color: '#d8a838', metalness: 0.7, roughness: 0.35, emissive: '#7a3a08', emissiveIntensity: 0.9 });
  return relief;
}

// ---------------------------------------------------------------------------
// Portraits (procedural: a robed figure with a flame crown on a dark red ground)
// ---------------------------------------------------------------------------

let portraits: THREE.MeshStandardMaterial[] | null = null;
function portraitMats(): THREE.MeshStandardMaterial[] {
  if (portraits) return portraits;
  portraits = [];
  if (typeof document === 'undefined') {
    portraits.push(new THREE.MeshStandardMaterial({ color: '#5a1410' }));
    return portraits;
  }
  const robes = ['#8a1a14', '#6e1410', '#a02818', '#7a2a12', '#5e0e0c', '#922016'];
  for (let i = 0; i < 6; i++) {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 280;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#3a0c0a';
    g.fillRect(0, 0, 128, 280);
    g.fillStyle = 'rgba(200,150,60,0.25)';
    g.fillRect(6, 6, 116, 268);
    g.fillStyle = '#2a0808';
    g.fillRect(10, 10, 108, 260);
    // Robe (trapezoid), shoulders, head, beard, topknot crown.
    g.fillStyle = robes[i];
    g.beginPath();
    g.moveTo(30, 270);
    g.lineTo(98, 270);
    g.lineTo(88, 120);
    g.lineTo(40, 120);
    g.closePath();
    g.fill();
    g.fillStyle = '#c8a038';
    g.fillRect(60, 125, 8, 140);
    g.fillStyle = '#d9b48a';
    g.beginPath();
    g.ellipse(64, 98, 17, 21, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = i % 2 ? '#2a1a14' : '#d8d2c8';
    g.beginPath();
    g.moveTo(52, 108);
    g.lineTo(76, 108);
    g.lineTo(64, 140 + (i % 3) * 8);
    g.closePath();
    g.fill();
    g.fillStyle = '#1a1210';
    g.fillRect(48, 72, 32, 10);
    g.fillStyle = '#e0b040';
    g.beginPath();
    g.moveTo(58, 72);
    g.lineTo(64, 52);
    g.lineTo(70, 72);
    g.closePath();
    g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    portraits.push(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.42 }));
  }
  return portraits;
}
