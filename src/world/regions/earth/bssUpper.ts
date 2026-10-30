import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import type { P2 } from '../../WorldLayout';
import type { ArchetypeId } from './archetypes';
import { crates, lanternPost, planter, tree, type TreeKind } from './parts';
import { AVENUES, BSS, C, FOOT, GROUND, RING_STREETS, angleDiff, hash01, polar, ringLocal, wrapAngle } from './bssLayout';
import { medallion, pillarTower, sign } from './bssKit';
import { ringStreet, type DistrictSite } from './bssLower';
import { NavTag } from './bssNav';

/**
 * Upper Ring: sparse and formal. Walled estates with yellow-tiled roofs face a
 * tree-lined promenade (r 70); landmark exteriors in the outer row: the
 * Council's War Room (open hall with the floor map and stone tokens), the
 * Fancy Lady Day Spa, the Jasmine Dragon, Iroh and Zuko's apartment and Team
 * Avatar's house (a courtyard big enough for a bison), two fountain plazas;
 * four pagoda-roofed pillar towers flank the South line where it crosses the
 * palace axis. Estates are fitted between the viaducts, lift towers and
 * avenues before any ground is claimed.
 */

const ROOFS_UP = [new THREE.Color(1.0, 0.82, 0.34), new THREE.Color(0.96, 0.76, 0.28), new THREE.Color(1.0, 0.87, 0.44)];
const WALLS_UP = [new THREE.Color(1, 1, 1), new THREE.Color(0.98, 0.95, 0.88), new THREE.Color(0.95, 0.92, 0.86)];
const TREES: TreeKind[] = ['round', 'cypress', 'blossom', 'round'];

interface Row {
  r0: number;
  r1: number;
  /** +1: gate on the palace side (local +Z); −1: gate on the outer side. */
  gate: 1 | -1;
}
const OUTER: Row = { r0: 76, r1: 96.5, gate: 1 };
const INNER: Row = { r0: 50.5, r1: 63.8, gate: -1 };
const PROM = RING_STREETS.upper;
/** Lawn lane between neighbouring estates, and the target estate width. */
const GAP = 6;
const TARGET = 24;

interface Estate {
  row: Row;
  t: number;
  hw: number;
  kind: string;
}

export function* buildUpperRing(site: DistrictSite): Generator<unknown, void, unknown> {
  const { env, nav } = site;
  const UT = NavTag.upper;
  const hard = (x: number, z: number, m: number) => env.excl.pointBlocked(x, z, m);
  const U = BSS.upper;
  const landmarks: Estate[] = [
    { row: OUTER, t: U.warRoom.t, hw: U.warRoom.hw, kind: 'war_room' },
    { row: OUTER, t: U.fancyLady.t, hw: U.fancyLady.hw, kind: 'fancy_lady' },
    { row: OUTER, t: U.jasmineDragon.t, hw: U.jasmineDragon.hw, kind: 'jasmine_dragon' },
    { row: OUTER, t: U.irohApartment.t, hw: U.irohApartment.hw, kind: 'iroh_apartment' },
    { row: OUTER, t: U.avatarHouse.t, hw: U.avatarHouse.hw, kind: 'avatar_house' },
    ...U.fountains.map((f, i) => ({ row: OUTER, t: f.t, hw: f.hw, kind: `fountain_${i}` })),
  ];
  // ---- Plan: fit estates into the free arcs of each row (clear of piers, lift towers and avenues).
  const boxFree = (row: Row, t: number, hw: number): boolean => {
    const rc = (row.r0 + row.r1) / 2, hd = (row.r1 - row.r0) / 2;
    const F = ringLocal(polar(t, rc));
    for (let lx = -hw; lx <= hw + 0.01; lx += 2.5) {
      for (let lz = -hd; lz <= hd + 0.01; lz += 2.5) {
        const p = F.at(lx, lz);
        if (hard(p.x, p.z, 0.6)) return false;
      }
    }
    return true;
  };
  const estates: Estate[] = [];
  for (const row of [OUTER, INNER]) {
    const occ: Array<[number, number]> = [];
    for (const l of landmarks) if (l.row === row) {
      const h = Math.asin((l.hw + GAP / 2) / row.r0);
      occ.push([l.t - h, l.t + h]);
    }
    for (const a of AVENUES) {
      if (a.r0 > row.r1) continue;
      const h = Math.asin((a.width / 2 + GAP / 2) / row.r0);
      occ.push([a.theta - h, a.theta + h]);
    }
    const iv = occ.map(([a, b]): [number, number] => [wrapAngle(a), wrapAngle(a) + (b - a)]).sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < iv.length; i++) {
      const g0 = iv[i][1], g1 = i + 1 < iv.length ? iv[i + 1][0] : iv[0][0] + Math.PI * 2;
      const L = (g1 - g0) * row.r0;
      if (L < 10) continue;
      const n = Math.max(1, Math.round((L + GAP) / (TARGET + GAP)));
      const w = (L - (n - 1) * GAP) / n;
      for (let k = 0; k < n; k++) {
        const t = g0 + (k * (w + GAP) + w / 2) / row.r0;
        // Shrink an estate that meets a pier or lift tower; give up below 7 m.
        let hw = w / 2;
        while (hw >= 3.5 && !boxFree(row, t, hw)) hw -= 1.5;
        if (hw >= 3.5) estates.push({ row, t, hw, kind: 'estate' });
      }
    }
  }
  // Promenade trees and lamps (planned against the same obstacles).
  const gates = [...landmarks, ...estates].map((e) => e.t);
  const promTrees: P2[] = [];
  for (const [r, step] of [[PROM.r + PROM.width / 2 + 1.0, 10], [PROM.r - PROM.width / 2 - 1.0, 10]] as const) {
    for (let t = 0.01; t < Math.PI * 2; t += step / r) {
      const p = polar(t, r);
      if (hard(p.x, p.z, 1.2) || nearAvenue(t, r, 3) || gates.some((q) => Math.abs(angleDiff(q, t)) * r < 3.4)) continue;
      promTrees.push(p);
    }
  }
  const promLamps: P2[] = [];
  for (const r of [PROM.r + PROM.width / 2 - 0.4, PROM.r - PROM.width / 2 + 0.4]) {
    for (let t = 0.05; t < Math.PI * 2; t += 21 / r) {
      const p = polar(t, r);
      if (!nearAvenue(t, r, 1.5) && !hard(p.x, p.z, 0.8)) promLamps.push(p);
    }
  }

  // ---- Claim the ground.
  ringStreet(site, PROM.r, PROM.width, UT);
  for (const a of AVENUES) {
    const r0 = Math.max(a.r0, BSS.palace.gate.z1 + 0.5), r1 = FOOT.upperIn + 1;
    const p0 = polar(a.theta, r0), p1 = polar(a.theta, r1);
    env.excl.seg(p0.x, p0.z, p1.x, p1.z, a.width / 2 + 0.5);
    nav.street([p0, polar(a.theta, PROM.r), polar(a.theta, FOOT.upperOut + 1)], UT | NavTag.street, 9, 5);
    const x = polar(a.theta, PROM.r);
    nav.join(x.x, x.z, 6);
  }
  yield;
  for (const e of landmarks) {
    const F = ringLocal(polar(e.t, (e.row.r0 + e.row.r1) / 2));
    env.excl.box(F.at(0, 0).x, F.at(0, 0).z, e.hw, (e.row.r1 - e.row.r0) / 2, F.yaw);
  }
  warRoom(site, landmarks[0]);
  fancyLady(site, landmarks[1]);
  jasmineDragon(site, landmarks[2]);
  irohApartment(site, landmarks[3]);
  avatarHouse(site, landmarks[4]);
  for (const f of landmarks.slice(5)) fountainPlaza(site, f);
  yield;
  let k = 0;
  for (const e of estates) estate(site, e, k++);
  site.mark('upperEstates', estates.length, GROUND, 0);
  yield;
  // ---- Promenade dressing and the palace-axis towers.
  for (let i = 0; i < promTrees.length; i++) {
    const p = promTrees[i];
    tree(env.chunks.at('props', p.x, p.z).builder, env.mats, p.x, GROUND, p.z, 0.8 + hash01(i, 601) * 0.25, TREES[i % TREES.length], i);
  }
  for (const p of promLamps) lanternPost(env.chunks.at('props', p.x, p.z).builder, p.x, GROUND, p.z, 'warm');
  axisTowers(site);
  // Park trees scattered over the open lawns.
  let n = 0;
  for (let r = BSS.palace.gate.z1 + 3; r < FOOT.upperIn - 2; r += 7) {
    for (let t = 0; t < Math.PI * 2; t += 7 / r) {
      n++;
      const p = polar(t + (hash01(n, 611) - 0.5) * (4 / r), r + (hash01(n, 612) - 0.5) * 3);
      if (hash01(n, 613) > 0.3 || env.excl.pointBlocked(p.x, p.z, 2.4)) continue;
      tree(env.chunks.at('props', p.x, p.z).builder, env.mats, p.x, GROUND, p.z, 0.8 + hash01(n, 614) * 0.4, TREES[n % TREES.length], n);
    }
  }
}

function nearAvenue(theta: number, r: number, margin: number): boolean {
  for (const a of AVENUES) {
    const d = Math.abs(Math.sin(theta - a.theta)) * r;
    if (Math.cos(theta - a.theta) > 0 && r >= a.r0 - 2 && d < a.width / 2 + margin) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

type Frame = ReturnType<typeof ringLocal>;

function frameOf(e: Estate): { F: Frame; c: P2; hd: number; g: 1 | -1 } {
  const c = polar(e.t, (e.row.r0 + e.row.r1) / 2);
  return { F: ringLocal(c), c, hd: (e.row.r1 - e.row.r0) / 2, g: e.row.gate };
}

function floor(site: DistrictSite, F: Frame, c: P2, w: number, d: number, mat: Parameters<ContentBuilder['mesh']>[0], y = 0.07): void {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  site.env.chunks.at('major', c.x, c.z).builder.mesh(mat, geo, { x: c.x, y: GROUND + y, z: c.z, yaw: F.yaw }, { castShadow: false });
  geo.dispose();
}

/** Estate wall with yellow tile coping; a gap of `gate` metres on the gate side (local z = g·hd). */
function estateWall(b: ContentBuilder, F: Frame, hw: number, hd: number, g: number, gate: number, wall: Parameters<ContentBuilder['box']>[0] = 'plaster_white', H = 2.7): void {
  const seg = (lx0: number, lz0: number, lx1: number, lz1: number) => {
    const a = F.at(lx0, lz0), c = F.at(lx1, lz1);
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 0.3) return;
    const yaw = Math.atan2(c.x - a.x, c.z - a.z);
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
    b.box(wall, { x: mx, y: GROUND + H / 2, z: mz, sx: 0.5, sy: H, sz: len, yaw }, { collide: true });
    b.box('roof_gold', { x: mx, y: GROUND + H + 0.12, z: mz, sx: 0.95, sy: 0.24, sz: len + 0.35, yaw });
    b.box('stone_grey', { x: mx, y: GROUND + 0.25, z: mz, sx: 0.7, sy: 0.5, sz: len, yaw });
  };
  seg(-hw, -hd, -hw, hd);
  seg(hw, -hd, hw, hd);
  seg(-hw, -g * hd, hw, -g * hd);
  seg(-hw, g * hd, -gate / 2, g * hd);
  seg(gate / 2, g * hd, hw, g * hd);
}

/** Roofed gate in the estate wall with open red leaves and lanterns. */
function gatehouse(b: ContentBuilder, F: Frame, hd: number, g: number, w = 3.6): void {
  for (const sx of [-1, 1]) {
    for (const dz of [-0.55, 0.55]) {
      const p = F.at(sx * (w / 2 + 0.25), g * hd + dz);
      b.cylinder('wood_red', { x: p.x, y: GROUND, z: p.z, r: 0.2, h: 3.3, segments: 8 }, { collide: true });
    }
    const leaf = F.at(sx * (w / 2 - 0.1), g * (hd - 0.95));
    b.box('wood_red', { x: leaf.x, y: GROUND + 1.3, z: leaf.z, sx: 0.1, sy: 2.6, sz: 1.7, yaw: F.yaw });
    const l = F.at(sx * (w / 2 - 0.2), g * (hd + 0.75));
    b.lantern(new THREE.Vector3(l.x, GROUND + 2.75, l.z), { color: 'red', hanging: true });
  }
  const r = F.at(0, g * hd);
  b.box('wood_dark', { x: r.x, y: GROUND + 3.3, z: r.z, sx: w + 1.2, sy: 0.3, sz: 1.6, yaw: F.yaw });
  b.roof('roof_gold', { x: r.x, y: GROUND + 3.45, z: r.z, w: w + 1.4, d: 1.8, height: 1.1, yaw: F.yaw, overhang: 0.55, curve: 0.8, style: 'hip', ridge: null });
  b.box('stone_light', { x: r.x, y: GROUND + 0.08, z: r.z, sx: w, sy: 0.16, sz: 1.4, yaw: F.yaw });
}

function house(site: DistrictSite, id: ArchetypeId, F: Frame, lx: number, lz: number, yaw: number, s: number, wall: THREE.Color, roof: THREE.Color, y = GROUND): void {
  const p = F.at(lx, lz);
  site.env.chunks.addHouse(site.env.arch[id], p.x, y, p.z, yaw, { scale: s, tint: wall, roofTint: roof });
}

/** Yaw facing local +Z (g = 1) or −Z (g = −1). */
const faceYaw = (F: Frame, g: number) => F.yaw + (g > 0 ? 0 : Math.PI);

// ---------------------------------------------------------------------------
// Generic walled estate
// ---------------------------------------------------------------------------

function estate(site: DistrictSite, e: Estate, k: number): void {
  const { env, nav } = site;
  const { F, c, hd, g } = frameOf(e);
  const hw = e.hw;
  const u = (i: number) => hash01(k, 700 + i, Math.round(e.row.r0));
  env.excl.box(c.x, c.z, hw, hd, F.yaw);
  const b = env.chunks.at('props', c.x, c.z).builder;
  const wall = WALLS_UP[Math.floor(u(1) * WALLS_UP.length)];
  const roof = ROOFS_UP[Math.floor(u(2) * ROOFS_UP.length)];
  floor(site, F, c, hw * 2 - 0.6, hd * 2 - 0.6, u(3) < 0.5 ? 'paving' : 'stone_tan');
  estateWall(b, F, hw, hd, g, 3.6, u(4) < 0.5 ? 'plaster_white' : 'plaster_cream');
  gatehouse(b, F, hd, g);
  // Main hall across the back, facing the gate; side wings when the estate is wide enough.
  const deep = hd * 2 > 16;
  const id: ArchetypeId = deep ? (u(5) < 0.55 ? 'N8' : 'N6') : hw > 6.5 ? 'N8' : 'N1';
  const A = env.arch[id];
  let s = deep ? 1.1 + u(6) * 0.25 : 1.0;
  s = Math.min(s, (hw * 2 - 1.6) / A.w, (hd * 2 - 5) / (A.d + A.front));
  if (s > 0.7) house(site, id, F, 0, -g * (hd - 0.7 - (A.d * s) / 2), faceYaw(F, g), s, wall, roof);
  const wingId: ArchetypeId = u(7) < 0.5 ? 'N1' : 'N3';
  const W = env.arch[wingId];
  if (deep && hw >= 11.5) {
    for (const side of [-1, 1]) {
      const lx = side * (hw - 0.7 - W.d / 2), lz = g * (hd - 2.6 - W.w / 2);
      house(site, wingId, F, lx, lz, F.yaw - (side * Math.PI) / 2, 1, wall, roof);
    }
  }
  const tz = g * (hd - (deep && hw >= 11.5 ? 1.5 : 2.6));
  for (const side of [-1, 1]) {
    const t = F.at(side * (hw - 2.3), tz);
    if (u(8 + side) < 0.8) tree(b, env.mats, t.x, GROUND, t.z, 0.75 + u(10) * 0.25, TREES[(k + side + 2) % TREES.length], k + side);
    else planter(b, env.mats, t.x, GROUND, t.z, 1);
  }
  const door = F.at(0, g * (hd + 1.2));
  nav.poi(door.x, door.z, NavTag.upper | NavTag.home, faceYaw(F, -g));
}

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

function warRoom(site: DistrictSite, e: Estate): void {
  const { env, bm, nav } = site;
  const { F, c, hd, g } = frameOf(e);
  const b = env.chunks.named('props', 'upper_war_room').builder;
  floor(site, F, c, e.hw * 2 - 0.4, hd * 2 - 0.4, 'stone_grey');
  // Podium and an open-fronted hall of grey stone with a yellow-tiled double roof.
  const hz = -g * 2.2, D = 14, Wd = 20, H = 6;
  const pod = F.at(0, hz);
  b.box('stone_grey', { x: pod.x, y: GROUND + 0.45, z: pod.z, sx: Wd + 1.6, sy: 0.9, sz: D + 1.6, yaw: F.yaw }, { collide: true, walkable: true });
  const y0 = GROUND + 0.9;
  const back = F.at(0, hz - g * (D / 2 - 0.3));
  b.box('stone_grey', { x: back.x, y: y0 + H / 2, z: back.z, sx: Wd, sy: H, sz: 0.6, yaw: F.yaw }, { collide: true });
  for (const side of [-1, 1]) {
    const s = F.at(side * (Wd / 2 - 0.3), hz);
    b.box('stone_grey', { x: s.x, y: y0 + H / 2, z: s.z, sx: 0.6, sy: H, sz: D, yaw: F.yaw }, { collide: true });
  }
  for (let lx = -Wd / 2 + 1; lx <= Wd / 2 - 1 + 0.01; lx += (Wd - 2) / 5) {
    const p = F.at(lx, hz + g * (D / 2 - 0.4));
    b.cylinder('stone_light', { x: p.x, y: y0, z: p.z, r: 0.35, h: H, segments: 10 }, { collide: true });
  }
  const top = F.at(0, hz);
  b.box('wood_dark', { x: top.x, y: y0 + H + 0.2, z: top.z, sx: Wd + 0.6, sy: 0.4, sz: D + 0.6, yaw: F.yaw });
  b.roof('roof_gold', { x: top.x, y: y0 + H + 0.4, z: top.z, w: Wd + 0.6, d: D + 0.6, height: 2.2, yaw: F.yaw, overhang: 1.4, curve: 0.9, style: 'hip', ridge: null });
  b.box('stone_grey', { x: top.x, y: y0 + H + 2.4, z: top.z, sx: Wd - 6, sy: 1.8, sz: D - 6, yaw: F.yaw });
  b.roof('roof_gold', { x: top.x, y: y0 + H + 3.3, z: top.z, w: Wd - 5, d: D - 5, height: 3.4, yaw: F.yaw, overhang: 1.4, curve: 1.0, style: 'hip', ridge: 'gold' });
  // The floor map with stone tokens.
  const map = new THREE.PlaneGeometry(14, 10.5);
  map.rotateX(-Math.PI / 2);
  b.mesh(bm.warMap, map, { x: top.x, y: y0 + 0.03, z: top.z, yaw: faceYaw(F, -g) }, { castShadow: false });
  map.dispose();
  for (let i = 0; i < 26; i++) {
    const lx = (hash01(i, 801) - 0.5) * 12, lz = (hash01(i, 802) - 0.5) * 9;
    const p = F.at(lx * -g, hz + lz * -g);
    // Map space: the island chain lies on the left of the map.
    const fire = lx < -3.4;
    b.cylinder(fire ? 'stone_red' : 'jade', { x: p.x, y: y0 + 0.03, z: p.z, r: 0.2, h: 0.28, segments: 8 });
  }
  const s = F.at(0, hz + g * (D / 2 + 0.02));
  sign(b, bm, '戰情室', s.x, y0 + H - 0.6, s.z, faceYaw(F, g), 0.9, { vertical: false });
  for (const side of [-1, 1]) {
    const m = F.at(side * (Wd / 2 - 3), hz + g * (D / 2 + 0.05));
    medallion(b, bm, m.x, y0 + H - 0.7, m.z, faceYaw(F, g), 0.7, 0.15);
    const l = F.at(side * 4.5, g * (hd - 1.5));
    lanternPost(b, l.x, GROUND, l.z, 'warm');
  }
  nav.street([polar(e.t, PROM.r), F.at(0, hz + g * (D / 2 + 1))], NavTag.upper | NavTag.street, 6, 5);
  nav.poi(F.at(0, hz + g * 4).x, F.at(0, hz + g * 4).z, NavTag.upper | NavTag.work | NavTag.patrol, faceYaw(F, -g));
  site.mark('war_room', top.x, y0, top.z);
}

function fancyLady(site: DistrictSite, e: Estate): void {
  const { env, bm, nav } = site;
  const { F, c, hd, g } = frameOf(e);
  const b = env.chunks.named('props', 'upper_fancy_lady').builder;
  floor(site, F, c, e.hw * 2 - 0.4, hd * 2 - 0.4, 'paving');
  const A = env.arch.N8, s = 1.4;
  const bz = g * (hd - 1.0 - (A.d * s) / 2) - g * 0;
  house(site, 'N8', F, -2.5, -bz, faceYaw(F, g), s, new THREE.Color(1, 0.94, 0.94), ROOFS_UP[0]);
  // Steaming pool garden beside the house.
  const pc = F.at(e.hw - 3.6, -g * 2.5);
  site.water(b, { id: 'ba_sing_se:fancy_lady_pool', label: 'Fancy Lady Day Spa pool', x: pc.x, z: pc.z, y: GROUND + 0.28, w: 5.6, d: 5.6, circle: true, capacity: 70, regen: 4, type: 'pond' });
  const rim = new THREE.TorusGeometry(2.95, 0.28, 6, 32);
  rim.rotateX(-Math.PI / 2);
  b.mesh('stone_white', rim, { x: pc.x, y: GROUND + 0.22, z: pc.z });
  rim.dispose();
  site.smoke.push({ x: pc.x, y: GROUND + 0.7, z: pc.z, rate: 0.45, steam: true });
  estateWall(b, F, e.hw, hd, g, 4.2, 'plaster_cream', 2.2);
  const front = g * (hd - 0.2);
  for (const side of [-1, 1]) {
    const p = F.at(side * 3.0, front + g * 0.6);
    planter(b, env.mats, p.x, GROUND, p.z, 1.0);
    const l = F.at(side * 1.6, g * (hd + 0.5));
    b.lantern(new THREE.Vector3(l.x, GROUND + 2.6, l.z), { color: 'red', hanging: true });
  }
  const sg = F.at(-4.6, g * (hd + 0.32));
  sign(b, bm, '貴婦水療', sg.x, GROUND + 2.2, sg.z, faceYaw(F, g), 2.2, { vertical: true, bg: '#6a2a3a' });
  const aw = F.at(-2.5, bz * -1 + g * ((A.d * s) / 2 + 1.0));
  b.box('cloth_red', { x: aw.x, y: GROUND + 3.2, z: aw.z, sx: 6.4, sy: 0.08, sz: 2.0, yaw: F.yaw });
  const door = F.at(0, g * (hd + 1.2));
  nav.poi(door.x, door.z, NavTag.upper | NavTag.shop, faceYaw(F, -g));
  site.mark('fancy_lady_day_spa', c.x, GROUND, c.z);
}

function jasmineDragon(site: DistrictSite, e: Estate): void {
  const { env, bm, nav } = site;
  const { F, c, hd, g } = frameOf(e);
  const b = env.chunks.named('props', 'upper_jasmine_dragon').builder;
  floor(site, F, c, e.hw * 2 - 0.4, hd * 2 - 0.4, 'paving');
  const A = env.arch.N8, s = 1.55;
  const bodyZ = -g * (hd - 0.8 - (A.d * s) / 2);
  house(site, 'N8', F, 0, bodyZ, faceYaw(F, g), s, new THREE.Color(0.98, 0.95, 0.86), ROOFS_UP[1]);
  const fz = bodyZ + g * ((A.d * s) / 2);
  const sg = F.at(0, fz + g * 0.08);
  sign(b, bm, '茉莉龍', sg.x, GROUND + 4.3, sg.z, faceYaw(F, g), 1.25, { vertical: false });
  nav.street([polar(e.t, PROM.r), F.at(0, fz + g * 1.2)], NavTag.upper | NavTag.street, 6, 5);
  // Tea terrace: tables under parasols, potted plants, lanterns strung across the front.
  for (let i = 0; i < 8; i++) {
    const lx = [-8.2, -3.6, 3.6, 8.2][i % 4], lz = fz + g * (3.0 + Math.floor(i / 4) * 4.0);
    const p = F.at(lx, lz);
    b.cylinder('wood', { x: p.x, y: GROUND + 0.74, z: p.z, r: 0.7, h: 0.08, segments: 12 });
    b.cylinder('wood_dark', { x: p.x, y: GROUND, z: p.z, r: 0.1, h: 0.74, segments: 6 }, { collide: true });
    b.cylinder('wood_dark', { x: p.x, y: GROUND + 0.82, z: p.z, r: 0.05, h: 1.7, segments: 5 });
    b.roof(i % 2 ? 'cloth_green' : 'cloth_yellow', { x: p.x, y: GROUND + 2.45, z: p.z, w: 1.8, d: 1.8, height: 0.6, overhang: 0.25, curve: 0.3, style: 'pagoda', ridge: null });
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2 + i;
      b.cylinder('wood_dark', { x: p.x + Math.cos(a) * 1.15, y: GROUND, z: p.z + Math.sin(a) * 1.15, r: 0.22, h: 0.46, segments: 8 });
    }
    nav.poi(p.x + 1.15, p.z, NavTag.upper | NavTag.tea | NavTag.bench, 0);
  }
  for (const side of [-1, 1]) {
    const p = F.at(side * (e.hw - 1.4), g * (hd - 1.2));
    planter(b, env.mats, p.x, GROUND, p.z, 1.1);
    const l = F.at(side * 3.4, fz + g * 0.6);
    b.lantern(new THREE.Vector3(l.x, GROUND + 3.0, l.z), { color: 'warm', hanging: true });
  }
  crates(b, F.at(e.hw - 2, bodyZ).x, GROUND, F.at(e.hw - 2, bodyZ).z, env.rnd, 2);
  nav.poi(F.at(0, fz + g * 0.8).x, F.at(0, fz + g * 0.8).z, NavTag.upper | NavTag.shop | NavTag.tea, faceYaw(F, -g));
  site.mark('jasmine_dragon', c.x, GROUND, c.z);
}

function irohApartment(site: DistrictSite, e: Estate): void {
  const { env, nav } = site;
  const { F, c, hd, g } = frameOf(e);
  const b = env.chunks.named('props', 'upper_iroh').builder;
  floor(site, F, c, e.hw * 2 - 0.4, hd * 2 - 0.4, 'stone_tan');
  const A = env.arch.N4, s = 1.35;
  const bodyZ = -g * (hd - 1.0 - (A.d * s) / 2);
  house(site, 'N4', F, 0, bodyZ, faceYaw(F, g), s, new THREE.Color(0.97, 0.93, 0.85), ROOFS_UP[2]);
  // A small front garden with a tea table.
  const fz = bodyZ + g * ((A.d * s) / 2);
  const t = F.at(2.6, fz + g * 3.4);
  b.cylinder('wood', { x: t.x, y: GROUND + 0.7, z: t.z, r: 0.55, h: 0.07, segments: 10 });
  b.cylinder('wood_dark', { x: t.x, y: GROUND, z: t.z, r: 0.09, h: 0.7, segments: 6 });
  const tr = F.at(-3.6, fz + g * 3.6);
  tree(b, env.mats, tr.x, GROUND, tr.z, 0.75, 'blossom', 3);
  nav.poi(F.at(0, g * (hd + 1.2)).x, F.at(0, g * (hd + 1.2)).z, NavTag.upper | NavTag.home, faceYaw(F, -g));
  site.mark('iroh_apartment', c.x, GROUND, c.z);
}

function avatarHouse(site: DistrictSite, e: Estate): void {
  const { env, nav } = site;
  const { F, c, hd, g } = frameOf(e);
  const b = env.chunks.named('props', 'upper_avatar_house').builder;
  floor(site, F, c, e.hw * 2 - 0.6, hd * 2 - 0.6, 'paving');
  estateWall(b, F, e.hw, hd, g, 5.0, 'plaster_white', 2.9);
  gatehouse(b, F, hd, g, 5.0);
  // A modest house across the back; the courtyard in front stays open — room for a sky bison.
  const A = env.arch.N6, s = 1.0;
  house(site, 'N6', F, 0, -g * (hd - 0.7 - (A.d * s) / 2), faceYaw(F, g), s, WALLS_UP[1], ROOFS_UP[0]);
  for (const side of [-1, 1]) {
    const t = F.at(side * (e.hw - 1.8), g * (hd - 1.8));
    tree(b, env.mats, t.x, GROUND, t.z, 0.9, side < 0 ? 'blossom' : 'round', side);
  }
  const well = F.at(e.hw - 3, -g * 1);
  b.cylinder('stone_grey', { x: well.x, y: GROUND, z: well.z, r: 0.9, h: 0.8, segments: 12 }, { collide: true, walkable: true });
  nav.poi(F.at(0, g * (hd + 1.2)).x, F.at(0, g * (hd + 1.2)).z, NavTag.upper | NavTag.home, faceYaw(F, -g));
  site.mark('avatar_house', c.x, GROUND, c.z);
}

function fountainPlaza(site: DistrictSite, e: Estate): void {
  const { env, nav } = site;
  const { F, c } = frameOf(e);
  const b = env.chunks.at('props', c.x, c.z).builder;
  nav.street([polar(e.t, PROM.r), F.at(0, -e.hw + 1)], NavTag.upper | NavTag.square, 6, 5);
  const disc = new THREE.CircleGeometry(e.hw + 0.5, 36);
  disc.rotateX(-Math.PI / 2);
  env.chunks.at('major', c.x, c.z).builder.mesh('paving', disc, { x: c.x, y: GROUND + 0.075, z: c.z }, { castShadow: false });
  disc.dispose();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.box('stone_light', { x: c.x + Math.cos(a) * 3.6, y: GROUND + 0.3, z: c.z + Math.sin(a) * 3.6, sx: 0.5, sy: 0.6, sz: 1.5, yaw: Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2 }, { collide: true, walkable: true });
  }
  site.water(b, { id: `ba_sing_se:upper_fountain_${Math.round(e.t * 100)}`, label: 'Upper Ring fountain', x: c.x, z: c.z, y: GROUND + 0.45, w: 6.8, d: 6.8, circle: true, capacity: 90, regen: 6, type: 'fountain' });
  b.cylinder('stone_white', { x: c.x, y: GROUND, z: c.z, r: 0.7, h: 1.6, segments: 10 }, { collide: true });
  b.cylinder('stone_white', { x: c.x, y: GROUND + 1.6, z: c.z, r: 1.4, rTop: 1.6, h: 0.3, segments: 14 });
  b.cylinder('stone_white', { x: c.x, y: GROUND + 1.9, z: c.z, r: 0.3, h: 1.0, segments: 8 });
  b.cylinder('gold', { x: c.x, y: GROUND + 2.9, z: c.z, r: 0.55, rTop: 0.7, h: 0.25, segments: 12 });
  site.smoke.push({ x: c.x, y: GROUND + 3.3, z: c.z, rate: 0.25, steam: true });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = { x: c.x + Math.cos(a) * (e.hw - 0.6), z: c.z + Math.sin(a) * (e.hw - 0.6) };
    tree(b, env.mats, p.x, GROUND, p.z, 0.8, i % 2 ? 'blossom' : 'round', a);
    const s = { x: c.x + Math.cos(a + Math.PI / 4) * 5.4, z: c.z + Math.sin(a + Math.PI / 4) * 5.4 };
    b.box('stone_light', { x: s.x, y: GROUND + 0.23, z: s.z, sx: 0.6, sy: 0.46, sz: 2.0, yaw: Math.atan2(Math.cos(a + Math.PI / 4), Math.sin(a + Math.PI / 4)) }, { collide: true, walkable: true });
    nav.poi(s.x, s.z, NavTag.upper | NavTag.bench | NavTag.water, Math.atan2(c.x - s.x, c.z - s.z));
  }
  site.mark(`upper_fountain_${Math.round((e.t * 180) / Math.PI)}`, c.x, GROUND, c.z);
}

/** Four pagoda-roofed pillar towers flanking the South line where it crosses the palace axis. */
function axisTowers(site: DistrictSite): void {
  const { env, bm } = site;
  const b = env.chunks.named('major', 'upper_axis_towers').builder;
  for (const sx of [-1, 1]) {
    for (const lz of [50.6, 65.6]) {
      let x = C.x + sx * 9.8, z = C.z + lz;
      for (let k = 0; k < 4 && env.excl.pointBlocked(x, z, 2.4); k++) x += sx * 1.5;
      if (env.excl.pointBlocked(x, z, 2.4)) continue;
      pillarTower(b, bm, x, z, GROUND, 0, 4.2, 30);
      env.excl.box(x, z, 2.6, 2.6, 0);
    }
  }
}
