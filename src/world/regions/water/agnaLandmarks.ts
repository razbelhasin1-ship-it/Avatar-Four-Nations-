import * as THREE from 'three';
import { Random } from '../../../core/Random';
import { heightAt } from '../../Heightfield';
import type { ContentBuilder } from '../../kit/Builder';
import { cyl, Detail, grow, MeshAcc, prism, type RBox } from './agnaBuildings';
import { block, stairFlight, taperTube } from './agnaParts';
import { boulder, bulbDome, crystal, disc, dome, emblem, hull, mergeParts } from './geometry';
import { wtMat } from './materials';
import {
  AX,
  CANALS,
  CLIFF_FALLS,
  GATE_OUT,
  GATE_TOP,
  GATE_Z,
  JAW_TIP,
  L1,
  L4,
  MOAT,
  MOAT_WL,
  MOUTH,
  PALACE,
  PLATFORM,
  TUNE,
  WL,
  type Rect,
} from './nwtLayout';
import type { NwtKit } from './nwtKit';
import { banner, canalBoat, parapet, roundTower, V, waterfall } from './parts';

/**
 * Agna Qel'a landmarks: the Chief's palace (a seven-tier stepped pagoda of
 * ice on a platform over its moat, stairs framed by great tusks and carved
 * bear-head pillars, cascades pouring into the moat, a glowing doorway and
 * an emblem crown), the gate across the harbor mouth (gatehouse with the
 * tribe's emblem, wall walk, domed guard pavilions, watchtowers on the
 * cliff tops, spillways, icebergs outside), the cliff waterfalls, and the
 * boats in the harbor and canals.
 */

export const PLATFORM_RECT: Rect = [PALACE.x - PALACE.w / 2, PALACE.z - PALACE.d / 2, PALACE.x + PALACE.w / 2, PALACE.z + PALACE.d / 2];
export const GATE_STAIRS_X = [MOUTH.x0 + 3.4, MOUTH.x1 - 3.4];

/** Spout slot in a retaining wall (dark recess with an ice lip), facing yaw. */
function spout(cb: ContentBuilder, x: number, y: number, z: number, yaw: number, w: number): void {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  cb.box(wtMat('dark'), { x: x + fx * 0.03, y, z: z + fz * 0.03, sx: w + 0.6, sy: 0.7, sz: 0.08, yaw }, { castShadow: false });
  cb.box(wtMat('ice_trim'), { x: x + fx * 0.3, y: y - 0.5, z: z + fz * 0.3, sx: w + 1.2, sy: 0.3, sz: 0.6, yaw });
}

// ---------------------------------------------------------------------------
// The palace
// ---------------------------------------------------------------------------

/** Stylised carved bear head (snow-white ice, dark eyes and nose), facing +Z. */
function bearHead(): { head: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const skull = new THREE.SphereGeometry(1, 14, 10);
  skull.scale(1, 0.86, 1.12);
  const brow = new THREE.SphereGeometry(0.62, 10, 6);
  brow.scale(1.4, 0.55, 1);
  brow.translate(0, 0.42, 0.42);
  const snout = new THREE.CylinderGeometry(0.4, 0.56, 1.0, 12);
  snout.rotateX(Math.PI / 2);
  snout.translate(0, -0.22, 1.05);
  const muzzle = new THREE.SphereGeometry(0.42, 10, 6);
  muzzle.scale(1, 0.8, 0.8);
  muzzle.translate(0, -0.24, 1.5);
  const ears = [-1, 1].map((s) => {
    const e = new THREE.SphereGeometry(0.28, 8, 5);
    e.scale(1, 1, 0.6);
    e.translate(s * 0.64, 0.66, -0.1);
    return e;
  });
  const head = mergeParts([skull, brow, snout, muzzle, ...ears]);
  const eyes = [-1, 1].map((s) => {
    const e = new THREE.SphereGeometry(0.11, 8, 5);
    e.translate(s * 0.38, 0.16, 0.95);
    return e;
  });
  const nose = new THREE.SphereGeometry(0.17, 8, 5);
  nose.scale(1.3, 0.8, 0.8);
  nose.translate(0, -0.06, 1.86);
  return { head, dark: mergeParts([...eyes, nose]) };
}

function palace(k: NwtKit, det: Detail): void {
  const cb = k.mainBuilder();
  const acc = new MeshAcc();
  const [px0, pz0, px1, pz1] = PLATFORM_RECT;
  block(cb, px0, pz0, px1, pz1, PLATFORM, 'paving', 'ice');
  prism(acc, 'ice_trim', { cx: PALACE.x, cz: PALACE.z, hw: PALACE.w / 2 + 0.25, hd: PALACE.d / 2 + 0.25, r: 0.2 }, PLATFORM - 0.55, PLATFORM - 0.15);
  // Balustrades around the platform (open at the stair head).
  const half = 6;
  parapet(cb, 'ice_wall', px0 + 0.3, pz0 + 0.23, PALACE.x - half, pz0 + 0.23, PLATFORM, 0.9, 0.45, 'snow');
  parapet(cb, 'ice_wall', PALACE.x + half, pz0 + 0.23, px1 - 0.3, pz0 + 0.23, PLATFORM, 0.9, 0.45, 'snow');
  parapet(cb, 'ice_wall', px0 + 0.23, pz0 + 0.3, px0 + 0.23, pz1 - 0.3, PLATFORM, 0.9, 0.45, 'snow');
  parapet(cb, 'ice_wall', px1 - 0.23, pz0 + 0.3, px1 - 0.23, pz1 - 0.3, PLATFORM, 0.9, 0.45, 'snow');
  parapet(cb, 'ice_wall', px0 + 0.3, pz1 - 0.23, px1 - 0.3, pz1 - 0.23, PLATFORM, 0.9, 0.45, 'snow');

  // Grand stair over the moat, framed by tusks and bear-head pillars.
  const sz0 = -1470;
  stairFlight(cb, PALACE.x, sz0, pz0, L4, PLATFORM, 2 * half, true);
  for (const s of [-1, 1]) {
    for (const [z, y, sc] of [[sz0 + 1.5, L4 + 0.7, 1], [pz0 + 2.2, PLATFORM + 0.6, 0.72]] as const) {
      const bx = PALACE.x + s * (half + 0.4);
      const c = new THREE.CubicBezierCurve3(
        V(bx, y, z),
        V(bx + s * 2.3 * sc, y + 1.6 * sc, z - 5.5 * sc),
        V(bx + s * 3.2 * sc, y + 7.2 * sc, z - 3.6 * sc),
        V(bx + s * 1.2 * sc, y + 9.8 * sc, z + 0.4 * sc),
      );
      const tusk = taperTube(c, 0.85 * sc, 0.09, 18, 10);
      acc.add('bone', tusk);
      tusk.dispose();
      cyl(acc, 'ice_trim', bx, z, 1.05 * sc, y - 0.6, y + 0.5, 12);
      cb.collider({ shape: 'cylinder', x: bx, y: y + 0.9, z, r: 0.95 * sc, hy: 1.6, walkable: false, solid: true, surface: 'ice' });
    }
    // Bear-head pillar at the foot of the stair.
    const hx = PALACE.x + s * (half + 4.6), hz = sz0 - 0.5;
    cyl(acc, 'ice_trim', hx, hz, 1.0, L4, L4 + 0.6, 12);
    cyl(acc, 'ice_wall', hx, hz, 0.72, L4 + 0.6, L4 + 4.6, 12, 0.66);
    cyl(acc, 'ice_trim', hx, hz, 0.95, L4 + 4.6, L4 + 5.0, 12);
    const { head, dark } = bearHead();
    const m = new THREE.Matrix4().compose(V(hx, L4 + 5.85, hz), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI + s * 0.25), V(1, 1, 1));
    acc.add('snow', head, m);
    acc.add('dark', dark, m);
    head.dispose();
    dark.dispose();
    cb.collider({ shape: 'cylinder', x: hx, y: L4 + 3, z: hz, r: 1.0, hy: 3, walkable: false, solid: true, surface: 'ice' });
  }

  // Seven stepped tiers with arched windows (more of them lit higher up).
  const cz = PALACE.z + 1.5;
  let y = PLATFORM;
  let top: RBox = { cx: PALACE.x, cz, hw: 1, hd: 1, r: 0.5 };
  for (let i = 0; i < 7; i++) {
    const hw = 19 - 2.25 * i, hd = 13 - 1.45 * i, h = 5.8 - 0.32 * i;
    const b: RBox = { cx: PALACE.x, cz, hw, hd, r: Math.min(2.2, hd * 0.25) };
    prism(acc, 'ice_wall', b, y, y + h - 0.4);
    prism(acc, 'ice_trim', grow(b, 0.4), y + h - 0.4, y + h, 'snow', 'ice_trim');
    if (i > 0) det.merlons(grow(b, 0.4), y + h, 1.7);
    cb.collider({ shape: 'box', x: b.cx, y: y + h / 2, z: b.cz, hx: hw + 0.3, hy: h / 2, hz: hd + 0.3, walkable: true, solid: true, surface: 'ice' });
    for (const [len, yaw, at] of [
      [2 * hw, Math.PI, (u: number): [number, number] => [b.cx - u, cz - hd]],
      [2 * hw, 0, (u: number): [number, number] => [b.cx + u, cz + hd]],
      [2 * hd, -Math.PI / 2, (u: number): [number, number] => [b.cx - hw, cz - u]],
      [2 * hd, Math.PI / 2, (u: number): [number, number] => [b.cx + hw, cz + u]],
    ] as Array<[number, number, (u: number) => [number, number]]>) {
      const n = Math.floor((len - 2 * b.r - 1) / 2.6);
      for (let q = 0; q < n; q++) {
        const u = (q - (n - 1) / 2) * 2.6;
        if (i === 0 && yaw === Math.PI && Math.abs(u) < 4.2) continue; // the great doorway
        const [x, z] = at(u);
        det.window(x, y + 1.2, z, yaw, i >= 4, (q + i) % 3 !== 0);
      }
    }
    top = b;
    y += h;
  }
  // Crown: drum ringed with merlons, dome, spire and the emblem facing the city.
  cyl(acc, 'ice_trim', PALACE.x, cz, 4.3, y, y + 1.3, 24);
  det.merlons({ cx: PALACE.x, cz, hw: 4.3, hd: 4.3, r: 4.2 }, y + 1.3, 1.6);
  const dg = dome(3.9, 1.05, 24, 8);
  dg.translate(PALACE.x, y + 1.3, cz);
  acc.add('ice_wall', dg);
  dg.dispose();
  const sp = bulbDome(1.15, 6.2, 14);
  sp.translate(PALACE.x, y + 5.2, cz);
  acc.add('ice_trim', sp);
  sp.dispose();
  const ey = y - 2.4, ez = cz - top.hd - 0.35;
  const dsk = disc(2.3, 0.4, 32);
  cb.mesh(wtMat('ice_trim'), dsk, { x: PALACE.x, y: ey, z: ez, yaw: Math.PI });
  dsk.dispose();
  const em = emblem(1.95, 0.25, true);
  cb.mesh(wtMat('snow'), em, { x: PALACE.x, y: ey, z: ez - 0.26, yaw: Math.PI });
  em.dispose();

  // The glowing doorway, lanterns and banners either side.
  det.door(PALACE.x, PLATFORM, cz - 13, Math.PI, true, 2.6);
  for (const s of [-1, 1]) {
    det.wallLamp(PALACE.x + s * 3.6, PLATFORM + 4.4, cz - 13, Math.PI);
    banner(k.props, PALACE.x + s * 6.4, PLATFORM + 5.3, cz - 13.08, Math.PI, 1.7, 4.4, s < 0 ? 'banner_water' : 'banner_moon');
  }
  // Round towers on the platform's front corners.
  for (const s of [-1, 1]) roundTower(cb, PALACE.x + s * (PALACE.w / 2 - 3.6), pz0 + 3.6, PLATFORM, 2.7, 24, 'bulb');

  // Cascades from slots in the platform front into the moat.
  for (const s of [-1, 1]) {
    const x = PALACE.x + s * 16;
    spout(cb, x, PLATFORM - 0.85, pz0, Math.PI, 12);
    waterfall(k.wet, x, pz0 - 0.45, Math.PI, PLATFORM - 1.0, MOAT_WL, 12, 0.5);
    k.emitter('mist', 0.5, V(x, MOAT_WL + 0.6, (MOAT[1] + MOAT[3]) / 2), { radius: 4 }, 60, true);
  }
  acc.emit(cb);
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

function gate(k: NwtKit, det: Detail): void {
  const cb = k.mainBuilder();
  const acc = new MeshAcc();
  const x0 = MOUTH.x0, x1 = MOUTH.x1, top = GATE_TOP;
  block(cb, x0, GATE_OUT, x1, GATE_Z, top, 'paving', 'ice', -12);
  prism(acc, 'ice_trim', { cx: AX, cz: (GATE_OUT + GATE_Z) / 2, hw: (x1 - x0) / 2, hd: (GATE_Z - GATE_OUT) / 2 + 0.25, r: 0.1 }, top - 0.6, top - 0.2);
  // Gatehouse on the seaward half (the wall walk passes behind it).
  const gz0 = GATE_OUT, gz1 = GATE_OUT + 6;
  const gh: RBox = { cx: AX, cz: (gz0 + gz1) / 2, hw: 15, hd: 3, r: 1.2 };
  prism(acc, 'ice_massive', gh, top, top + 8.4);
  prism(acc, 'ice_trim', grow(gh, 0.35), top + 8.4, top + 9.0, 'snow', 'ice_trim');
  cb.collider({ shape: 'box', x: AX, y: top + 4.5, z: gh.cz, hx: 15, hy: 4.5, hz: 3, walkable: true, solid: true, surface: 'ice' });
  det.merlons(grow(gh, 0.35), top + 9.0);
  for (const s of [-1, 1]) {
    cyl(acc, 'ice_wall', AX + s * 15, gh.cz, 2.4, top, top + 12, 16);
    cyl(acc, 'ice_trim', AX + s * 15, gh.cz, 2.65, top + 12, top + 12.5, 16);
    const bd = bulbDome(2.4, 5.2, 16);
    bd.translate(AX + s * 15, top + 12.5, gh.cz);
    acc.add('ice_wall', bd);
    bd.dispose();
    cb.collider({ shape: 'cylinder', x: AX + s * 15, y: top + 6, z: gh.cz, r: 2.45, hy: 6, walkable: false, solid: true, surface: 'ice' });
    det.window(AX + s * 15, top + 7.5, gh.cz - 2.4, Math.PI, true, true);
  }
  // The tribe's emblem facing the sea, and the water-gate arches.
  const dsk = disc(6.6, 0.6, 40);
  cb.mesh(wtMat('ice_trim'), dsk, { x: AX, y: top + 2.2, z: gz0 - 0.3, yaw: Math.PI });
  dsk.dispose();
  const em = emblem(5.6, 0.4, true);
  cb.mesh(wtMat('snow'), em, { x: AX, y: top + 2.2, z: gz0 - 0.62, yaw: Math.PI });
  em.dispose();
  det.door(AX, -0.5, gz0, Math.PI, false, 5.2);
  det.door(AX, WL - 0.6, GATE_Z, 0, false, 4.4);
  // Spillways: the harbor drains into the sea through two slots.
  for (const s of [-1, 1]) {
    const x = AX + s * 27;
    spout(cb, x, WL - 0.25, gz0, Math.PI, 5);
    waterfall(k.wet, x, gz0 - 0.45, Math.PI, WL - 0.4, 0.1, 5, 0.6);
    k.emitter('mist', 0.6, V(x, 0.8, gz0 - 2), { radius: 3 }, 80, true);
  }
  // Wall walk: crenellated seaward parapet, inner balustrade with gaps for the stairs.
  parapet(cb, 'ice_massive', x0 + 0.3, GATE_OUT + 0.25, AX - 15, GATE_OUT + 0.25, top, 1.0, 0.5, null);
  parapet(cb, 'ice_massive', AX + 15, GATE_OUT + 0.25, x1 - 0.3, GATE_OUT + 0.25, top, 1.0, 0.5, null);
  for (let x = x0 + 1.2; x < x1 - 1; x += 1.7) if (Math.abs(x - AX) > 15.5) det.merlon(x, top + 1.0, GATE_OUT + 0.25, 0);
  let xa = x0 + 0.3;
  for (const sx of GATE_STAIRS_X) {
    parapet(cb, 'ice_wall', xa, GATE_Z - 0.23, sx - 2.2, GATE_Z - 0.23, top, 0.9, 0.45, 'snow');
    xa = sx + 2.2;
  }
  parapet(cb, 'ice_wall', xa, GATE_Z - 0.23, x1 - 0.3, GATE_Z - 0.23, top, 0.9, 0.45, 'snow');
  for (const sx of GATE_STAIRS_X) stairFlight(cb, sx, -1864, GATE_Z, L1, top, 4.2, true);
  // Domed guard pavilions on the seaward half of the walk.
  for (const s of [-1, 1]) {
    const px = AX + s * 32, pz = GATE_OUT + 3.4;
    for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      cyl(acc, 'ice_trim', px + dx, pz + dz, 0.24, top, top + 2.9, 8);
      cb.collider({ shape: 'cylinder', x: px + dx, y: top + 1.45, z: pz + dz, r: 0.26, hy: 1.45, walkable: false, solid: true, surface: 'ice' });
    }
    prism(acc, 'ice_wall', { cx: px, cz: pz, hw: 2.1, hd: 2.1, r: 0.6 }, top + 2.9, top + 3.4, 'ice_trim', 'ice_wall');
    const d = dome(2.0, 0.9, 16, 6);
    d.translate(px, top + 3.4, pz);
    acc.add('ice_wall', d);
    d.dispose();
    det.lantern(px, top + 2.6, pz);
  }
  // Lanterns along the walk.
  for (let x = x0 + 8; x < x1 - 4; x += 12) if (Math.abs(x - AX) > 17 && Math.abs(Math.abs(x - AX) - 32) > 3) det.lantern(x, top + 2.4, GATE_OUT + 0.9);
  // Watchtowers on the cliff tops at the jaw tips.
  for (const x of [-297, -143]) {
    roundTower(cb, x, JAW_TIP + 12, TUNE.cliffTop - 0.5, 4.6, 15, 'bulb');
    det.lantern(x, TUNE.cliffTop + 10, JAW_TIP + 12 - 4.9);
  }
  // Jagged icebergs outside the gate (solid: boats and swimmers go round them).
  const rnd = new Random(1907);
  for (const [bx, bz, s] of [[-306, -1972, 11], [-256, -2018, 8], [-176, -1998, 9], [-128, -1968, 13], [-340, -2050, 16], [-100, -2058, 11], [-214, -2096, 9]] as const) {
    const shelf = boulder(310 + Math.round(bx), s * 1.5, s * 0.3, s * 1.3, 2);
    cb.mesh(wtMat('ice_massive'), shelf, { x: bx, y: -0.2, z: bz, yaw: rnd.range(0, 6) });
    shelf.dispose();
    const body = boulder(300 + Math.round(bx), s, s * 1.25, s * 0.85, 2);
    cb.mesh(wtMat('ice_massive'), body, { x: bx, y: s * 0.45, z: bz, yaw: rnd.range(0, 6) });
    body.dispose();
    const n = 3 + Math.round(rnd.range(0, 3));
    for (let i = 0; i < n; i++) {
      const a = rnd.range(0, 6.28), r = rnd.range(0, s * 0.45);
      const c = crystal(s * rnd.range(0.22, 0.34), s * rnd.range(1.4, 2.6), 0.4);
      cb.mesh(wtMat(i % 3 === 0 ? 'ice_clear' : 'ice_wall'), c, { x: bx + Math.cos(a) * r, y: s * 0.5, z: bz + Math.sin(a) * r, yaw: rnd.range(0, 6), pitch: rnd.range(-0.3, 0.3), roll: rnd.range(-0.3, 0.3) });
      c.dispose();
    }
    const floor = Math.min(-2, heightAt(bx, bz));
    cb.collider({ shape: 'cylinder', x: bx, y: (floor + s * 1.6) / 2, z: bz, r: s * 0.95, hy: (s * 1.6 - floor) / 2, walkable: true, solid: true, surface: 'ice' });
  }
  acc.emit(cb);
}

// ---------------------------------------------------------------------------
// Cliff waterfalls, boats
// ---------------------------------------------------------------------------

function cliffFalls(k: NwtKit): void {
  for (const f of CLIFF_FALLS) {
    const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
    waterfall(k.wet, f.x + fx * 0.35, f.z + fz * 0.35, f.yaw, TUNE.cliffTop + 0.4, f.bottom, f.w, 0.9);
    k.emitter('mist', 0.55, V(f.x + fx * 2.5, f.bottom + 1.0, f.z + fz * 2.5), { radius: f.w * 0.4 }, 90, true);
  }
}

/** A Water Tribe sailing ship: hull, deck, mast, a blue sail with the emblem. */
function ship(cb: ContentBuilder, x: number, z: number, yaw: number, s = 1): void {
  const m = new THREE.Matrix4().compose(V(x, WL - 0.7 * s, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw), V(s, s, s));
  cb.instance('agna_ship_hull', () => hull(13, 3.8, 1.9, 18, 8), wtMat('wood'), m);
  cb.instance('agna_ship_rig', () => {
    const deck = new THREE.BoxGeometry(2.6, 0.12, 9.5);
    deck.translate(0, 1.5, 0);
    const mast = new THREE.CylinderGeometry(0.12, 0.18, 9, 8);
    mast.translate(0, 6, 0.6);
    const yard = new THREE.CylinderGeometry(0.07, 0.07, 5.4, 6);
    yard.rotateZ(Math.PI / 2);
    yard.translate(0, 9.6, 0.7);
    const boom = yard.clone();
    boom.translate(0, -5.4, 0);
    return mergeParts([deck, mast, yard, boom]);
  }, wtMat('wood'), m);
  cb.instance('agna_ship_sail', () => {
    const g = new THREE.PlaneGeometry(5.0, 5.2, 4, 4);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0.55 * Math.cos((p.getX(i) / 5) * Math.PI) * (0.6 + 0.4 * Math.sin(((p.getY(i) + 2.6) / 5.2) * Math.PI)));
    g.computeVertexNormals();
    g.translate(0, 6.9, 0.85);
    return g;
  }, wtMat('banner_water'), m);
}

function boats(k: NwtKit): void {
  const cb = k.props;
  const rnd = new Random(2207);
  const [hx0, , hx1] = CANALS.harbor;
  ship(cb, AX - 14, -1868, 0.08);
  ship(cb, AX + 12, -1846, Math.PI - 0.1);
  ship(cb, AX - 2, -1826, 0.04, 0.85);
  for (const [x, z, yaw] of [
    [hx0 + 1.6, -1850, 0], [hx0 + 1.6, -1822, Math.PI], [hx1 - 1.6, -1868, Math.PI], [hx1 - 1.6, -1812, 0],
    [-241.3, -1786, Math.PI], [-241.3, -1712, 0], [-232.7, -1690, Math.PI], [-198.7, -1782, 0], [-207.3, -1740, Math.PI], [-198.7, -1662, 0],
    [-322, -1745.3, Math.PI / 2], [-268, -1750.7, -Math.PI / 2], [-360, -1697.3, Math.PI / 2], [-122, -1745.3, -Math.PI / 2], [-80, -1702.7, Math.PI / 2], [-160, -1697.3, -Math.PI / 2],
  ] as Array<[number, number, number]>) canalBoat(cb, x, WL, z, yaw + rnd.range(-0.04, 0.04), rnd.range(4.6, 5.6));
}

/** Build the landmarks; their lanterns are recorded in `det.glow`. */
export function buildLandmarks(k: NwtKit, det: Detail): void {
  palace(k, det);
  gate(k, det);
  cliffFalls(k);
  boats(k);
}
