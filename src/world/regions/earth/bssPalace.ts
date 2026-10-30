import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import { BSS, C, GROUND } from './bssLayout';
import { medallion, sign } from './bssKit';
import type { DistrictSite } from './bssLower';
import { NavTag } from './bssNav';
import { guardianStatue, lanternPost, paifang, pavilion, tree } from './parts';

/**
 * The Earth King's palace inside the arcaded wall ring (the Palace Loop runs on
 * top of it), laid out on a Forbidden City axis from south to north: the South
 * Gate (a red gate block with three passages under a double-eaved pavilion),
 * the Golden Water canal with five marble bridges, a three-tier white marble
 * platform with balustrades carrying the double-eaved throne hall (dark green
 * tiles, gold trim, pale columns, green banners, the throne on its dais), bell
 * and drum pavilions, and behind the inner wall the inner court: quarters,
 * kitchens, the garden pond and the menagerie.
 */

const P = BSS.palace;
const at = (x: number, z: number) => ({ x: C.x + x, z: C.z + z });
const ROOF_PAL = new THREE.Color(0.38, 0.58, 0.42);
const WALL_PAL = new THREE.Color(0.96, 0.86, 0.8);

export function buildPalace(site: DistrictSite): void {
  const { env } = site;
  const b = env.chunks.named('major', 'palace').builder;
  const d = env.chunks.named('props', 'palace_props').builder;
  southGate(site, b);
  goldenWater(site, d);
  platform(site, b, d);
  throneHall(site, b, d);
  sidePavilions(site, d);
  innerCourt(site, d);
  const n = at(0, -(P.gate.z0 + P.gate.z1) / 2);
  paifang(d, n.x, GROUND, n.z, 0, 8, 5.6, { roof: 'roof_green' });
  palaceNav(site);
  site.mark('palace', C.x, GROUND, C.z);
}

/** Thin gold strips along the four eave lines of a hip roof. */
function goldEaves(b: ContentBuilder, x: number, y: number, z: number, w: number, d: number, overhang: number): void {
  const W = w + overhang * 2, D = d + overhang * 2;
  b.box('gold', { x, y: y + 0.05, z: z + D / 2, sx: W, sy: 0.16, sz: 0.16 });
  b.box('gold', { x, y: y + 0.05, z: z - D / 2, sx: W, sy: 0.16, sz: 0.16 });
  b.box('gold', { x: x + W / 2, y: y + 0.05, z, sx: 0.16, sy: 0.16, sz: D });
  b.box('gold', { x: x - W / 2, y: y + 0.05, z, sx: 0.16, sy: 0.16, sz: D });
}

function banner(site: DistrictSite, b: ContentBuilder, x: number, z: number, y0: number, h: number, yaw: number): void {
  b.cylinder('wood_dark', { x, y: y0, z, r: 0.1, h, segments: 6 }, { collide: true });
  b.box('gold', { x, y: y0 + h + 0.15, z, sx: 0.22, sy: 0.3, sz: 0.22 });
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  b.box(site.env.mats.banner, { x: x + fx * 0.7, y: y0 + h - 2.0, z: z + fz * 0.7, sx: 0.04, sy: 3.4, sz: 1.2, yaw });
}

// ---------------------------------------------------------------------------
// South Gate (Meridian-like)
// ---------------------------------------------------------------------------

function southGate(site: DistrictSite, b: ContentBuilder): void {
  const { bm } = site;
  const g = P.gate;
  const zc = (g.z0 + g.z1) / 2, D = g.z1 - g.z0, H = g.h;
  // Solid parts around three passages: the centre one 6.4 m wide and 7 m high, the side ones 3.6 m and 5 m.
  const solids: Array<[number, number]> = [[-g.hw, -8.6], [-5, -3.2], [3.2, 5], [8.6, g.hw]];
  for (const [x0, x1] of solids) {
    const p = at((x0 + x1) / 2, zc);
    b.box('plaster_red', { x: p.x, y: GROUND + H / 2, z: p.z, sx: x1 - x0, sy: H, sz: D }, { collide: true });
    b.box('stone_white', { x: p.x, y: GROUND + 0.6, z: p.z, sx: x1 - x0 + 0.3, sy: 1.2, sz: D + 0.3 });
  }
  for (const [x0, x1, top] of [[-8.6, -5, 5], [5, 8.6, 5], [-3.2, 3.2, 7]] as const) {
    const p = at((x0 + x1) / 2, zc);
    b.box('plaster_red', { x: p.x, y: GROUND + (top + H) / 2, z: p.z, sx: x1 - x0, sy: H - top, sz: D }, { collide: true });
    b.box('wood_dark', { x: p.x, y: GROUND + top + 0.06, z: p.z, sx: x1 - x0 - 0.02, sy: 0.12, sz: D - 0.02 });
  }
  const c = at(0, zc);
  b.box('gold', { x: c.x, y: GROUND + H - 0.55, z: c.z, sx: g.hw * 2 + 0.06, sy: 0.3, sz: D + 0.06 });
  b.box('stone_white', { x: c.x, y: GROUND + H + 0.15, z: c.z, sx: g.hw * 2 + 0.6, sy: 0.3, sz: D + 0.6 }, { collide: true });
  for (const [lx, lz, sx, sz] of [[0, g.z1 + 0.1, g.hw * 2 + 0.4, 0.4], [0, g.z0 - 0.1, g.hw * 2 + 0.4, 0.4], [g.hw + 0.1, zc, 0.4, D], [-g.hw - 0.1, zc, 0.4, D]] as const) {
    const p = at(lx, lz);
    b.box('stone_white', { x: p.x, y: GROUND + H + 0.75, z: p.z, sx, sy: 0.9, sz }, { collide: true });
  }
  // Double-eaved gate pavilion on the terrace.
  const y0 = GROUND + H + 0.3;
  for (const lx of [-8.4, -5, -1.7, 1.7, 5, 8.4]) {
    for (const lz of [zc - 2.9, zc + 2.9]) {
      const p = at(lx, lz);
      b.cylinder('wood_red', { x: p.x, y: y0, z: p.z, r: 0.28, h: 5, segments: 10 }, { collide: true });
    }
  }
  b.box('plaster_red', { x: c.x, y: y0 + 2.5, z: c.z, sx: 15, sy: 5, sz: 4.4 }, { collide: true });
  b.box('wood_dark', { x: c.x, y: y0 + 4.8, z: c.z, sx: 17.6, sy: 0.6, sz: 6.6 });
  b.roof(bm.palaceRoof, { x: c.x, y: y0 + 5.1, z: c.z, w: 17.6, d: 6.6, height: 1.8, overhang: 1.3, curve: 0.9, style: 'hip', ridge: null });
  goldEaves(b, c.x, y0 + 5.1, c.z, 17.6, 6.6, 1.3);
  b.box('plaster_red', { x: c.x, y: y0 + 6.7, z: c.z, sx: 11.5, sy: 2.4, sz: 4.0 });
  b.roof(bm.palaceRoof, { x: c.x, y: y0 + 7.9, z: c.z, w: 13.5, d: 5.6, height: 3.2, overhang: 1.4, curve: 1.0, style: 'hip', ridge: 'gold' });
  goldEaves(b, c.x, y0 + 7.9, c.z, 13.5, 5.6, 1.4);
  // Plaque, emblems and banners on both faces.
  for (const [lz, yaw] of [[g.z1 + 0.06, 0], [g.z0 - 0.06, Math.PI]] as const) {
    const s = at(0, lz);
    sign(b, bm, '王宮', s.x, GROUND + 8.0, s.z, yaw, 1.25, { vertical: false });
    for (const lx of [-6.8, 6.8]) {
      const m = at(lx, lz);
      medallion(b, bm, m.x, GROUND + 7, m.z, yaw, 1.05, 0.2);
    }
    for (const lx of [-10.3, 10.3]) {
      const m = at(lx, lz + (yaw === 0 ? 0.04 : -0.04));
      b.box(site.env.mats.banner, { x: m.x, y: GROUND + 4.6, z: m.z, sx: 1.5, sy: 5.2, sz: 0.04, yaw });
    }
  }
}

// ---------------------------------------------------------------------------
// Golden Water canal and marble bridges
// ---------------------------------------------------------------------------

function goldenWater(site: DistrictSite, b: ContentBuilder): void {
  const z = P.canalZ, hw = 17, w = 2.4;
  const c = at(0, z);
  site.water(b, { id: 'ba_sing_se:golden_water', label: 'Golden Water canal', x: c.x, z: c.z, y: GROUND + 0.22, w: hw * 2, d: w, capacity: 140, regen: 6, type: 'canal' });
  const bridges = [-12, -6, 0, 6, 12];
  const bw = (x: number) => (x === 0 ? 4.2 : 2.6);
  for (const side of [-1, 1]) {
    // Kerbs broken by the bridges.
    let x0 = -hw - 0.3;
    for (const bx of [...bridges, hw + 0.3 + bw(0)]) {
      const x1 = Math.min(bx - bw(bx) / 2, hw + 0.3);
      if (x1 > x0 + 0.2) {
        const p = at((x0 + x1) / 2, z + side * (w / 2 + 0.18));
        b.box('stone_white', { x: p.x, y: GROUND + 0.28, z: p.z, sx: x1 - x0, sy: 0.56, sz: 0.36 }, { collide: true });
      }
      x0 = bx + bw(bx) / 2;
    }
  }
  for (const side of [-1, 1]) {
    const p = at(side * (hw + 0.18), z);
    b.box('stone_white', { x: p.x, y: GROUND + 0.28, z: p.z, sx: 0.36, sy: 0.56, sz: w + 0.72 }, { collide: true });
  }
  for (const bx of bridges) {
    const a = at(bx, z + w / 2 + 1.6), e = at(bx, z - w / 2 - 1.6);
    b.bridge({ a: new THREE.Vector3(a.x, GROUND, a.z), b: new THREE.Vector3(e.x, GROUND, e.z), width: bw(bx), deck: 'stone_white', rail: 'stone_white', arch: bx === 0 ? 0.9 : 0.7 });
  }
}

// ---------------------------------------------------------------------------
// Three-tier marble platform
// ---------------------------------------------------------------------------

function balustrade(b: ContentBuilder, x0: number, z0: number, x1: number, z1: number, y: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.5) return;
  const a = at(x0, z0), e = at(x1, z1);
  const yaw = Math.atan2(e.x - a.x, e.z - a.z);
  b.box('stone_white', { x: (a.x + e.x) / 2, y: y + 0.95, z: (a.z + e.z) / 2, sx: 0.24, sy: 0.16, sz: len, yaw }, { collide: true, walkable: false });
  b.box('stone_white', { x: (a.x + e.x) / 2, y: y + 0.18, z: (a.z + e.z) / 2, sx: 0.3, sy: 0.36, sz: len, yaw });
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    b.box('stone_white', { x: a.x + (e.x - a.x) * t, y: y + 0.55, z: a.z + (e.z - a.z) * t, sx: 0.26, sy: 1.1, sz: 0.26, yaw });
  }
}

function platform(site: DistrictSite, b: ContentBuilder, d: ContentBuilder): void {
  const stairS = 9, stairN = 6;
  let prev = 0;
  for (let i = 0; i < P.tiers.length; i++) {
    const t = P.tiers[i];
    const c = at(0, (t.z0 + t.z1) / 2);
    const sz = t.z1 - t.z0, sx = t.hw * 2;
    b.box('stone_white', { x: c.x, y: GROUND + (t.h - 0.5) / 2, z: c.z, sx, sy: t.h + 0.5, sz }, { collide: true, walkable: true });
    b.box('stone_light', { x: c.x, y: GROUND + t.h - 0.11, z: c.z, sx: sx + 0.24, sy: 0.22, sz: sz + 0.24 });
    if (i === 0) b.box('stone_tan', { x: c.x, y: GROUND + 0.3, z: c.z, sx: sx + 0.5, sy: 0.6, sz: sz + 0.5 });
    const y = GROUND + t.h, e = t.hw - 0.25;
    balustrade(d, -e, t.z1 - 0.25, -stairS / 2 - 0.2, t.z1 - 0.25, y);
    balustrade(d, stairS / 2 + 0.2, t.z1 - 0.25, e, t.z1 - 0.25, y);
    balustrade(d, -e, t.z0 + 0.25, -stairN / 2 - 0.2, t.z0 + 0.25, y);
    balustrade(d, stairN / 2 + 0.2, t.z0 + 0.25, e, t.z0 + 0.25, y);
    balustrade(d, -e, t.z0 + 0.25, -e, t.z1 - 0.25, y);
    balustrade(d, e, t.z0 + 0.25, e, t.z1 - 0.25, y);
    const run = ((t.h - prev) / 0.3) * 0.36;
    const s0 = at(0, t.z1 + run), s1 = at(0, t.z1);
    b.stairs({ from: new THREE.Vector3(s0.x, GROUND + prev, s0.z), to: new THREE.Vector3(s1.x, GROUND + t.h, s1.z), width: stairS, material: 'stone_white' });
    const n0 = at(0, t.z0 - run), n1 = at(0, t.z0);
    b.stairs({ from: new THREE.Vector3(n0.x, GROUND + prev, n0.z), to: new THREE.Vector3(n1.x, GROUND + t.h, n1.z), width: stairN, material: 'stone_white' });
    prev = t.h;
  }
  // Terrace furniture: bronze cauldrons, lanterns and banners at the corners.
  const top = P.tiers[2];
  const yT = GROUND + top.h;
  for (const side of [-1, 1]) {
    const k = at(side * 10, 17.5);
    d.cylinder('stone_grey', { x: k.x, y: yT, z: k.z, r: 1.0, h: 0.5, segments: 8 }, { collide: true, walkable: true });
    d.cylinder('bronze', { x: k.x, y: yT + 0.5, z: k.z, r: 0.9, rTop: 1.15, h: 1.3, segments: 12 }, { collide: true });
    const l = at(side * 5.5, 19.5);
    lanternPost(d, l.x, yT, l.z, 'warm');
    const f = at(side * (top.hw - 1.4), top.z1 - 1.4);
    banner(site, d, f.x, f.z, yT, 8, side < 0 ? -Math.PI / 2 : Math.PI / 2);
    const g = at(side * (P.tiers[0].hw - 1.2), P.tiers[0].z1 - 1.2);
    banner(site, d, g.x, g.z, GROUND + P.tiers[0].h, 7, side < 0 ? -Math.PI / 2 : Math.PI / 2);
  }
}

// ---------------------------------------------------------------------------
// Throne hall
// ---------------------------------------------------------------------------

function throneHall(site: DistrictSite, b: ContentBuilder, d: ContentBuilder): void {
  const { bm, env } = site;
  const h = P.hall;
  const y0 = GROUND + P.tiers[2].h;
  const zc = (h.z0 + h.z1) / 2, depth = h.z1 - h.z0, W = h.hw * 2;
  const c = at(0, zc);
  const Hw = 11;
  const fz = h.z1 - 2; // front wall, set back behind the colonnade
  // Interior floor, walls and the open front with a wide doorway.
  b.box('stone_grey', { x: c.x, y: y0 + 0.04, z: at(0, (h.z0 + fz) / 2).z, sx: W - 1, sy: 0.08, sz: fz - h.z0 - 0.6 });
  const back = at(0, h.z0 + 0.3);
  b.box('plaster_red', { x: back.x, y: y0 + Hw / 2, z: back.z, sx: W, sy: Hw, sz: 0.6 }, { collide: true });
  for (const side of [-1, 1]) {
    const s = at(side * (h.hw - 0.3), (h.z0 + fz) / 2);
    b.box('plaster_red', { x: s.x, y: y0 + Hw / 2, z: s.z, sx: 0.6, sy: Hw, sz: fz - h.z0 }, { collide: true });
    const f = at(side * (h.hw + 3.2) / 2, fz);
    b.box('plaster_red', { x: f.x, y: y0 + Hw / 2, z: f.z, sx: h.hw - 3.2, sy: Hw, sz: 0.6 }, { collide: true });
    for (const lx of [5.2, 8.6, 12]) {
      const p = at(side * lx, fz + 0.32);
      d.box('wood_red', { x: p.x, y: y0 + 3.4, z: p.z, sx: 2.4, sy: 5.6, sz: 0.08 });
      d.box('gold', { x: p.x, y: y0 + 3.4, z: p.z + 0.05, sx: 2.0, sy: 0.12, sz: 0.04 });
    }
    const leaf = at(side * 3.0, fz - 1.5);
    d.box('wood_red', { x: leaf.x, y: y0 + 3.1, z: leaf.z, sx: 0.14, sy: 6.2, sz: 2.9 });
  }
  const lintel = at(0, fz);
  b.box('plaster_red', { x: lintel.x, y: y0 + (6.6 + Hw) / 2, z: lintel.z, sx: 6.4, sy: Hw - 6.6, sz: 0.6 }, { collide: true });
  // Pale front colonnade on white bases.
  for (let lx = -14; lx <= 14; lx += 4) {
    const p = at(lx, h.z1 - 0.45);
    b.cylinder('stone_white', { x: p.x, y: y0, z: p.z, r: 0.62, h: 0.42, segments: 10 });
    b.cylinder('stone_light', { x: p.x, y: y0 + 0.42, z: p.z, r: 0.42, h: Hw - 0.42, segments: 12 }, { collide: true });
  }
  // Ceiling, bracket band, lower eave, upper storey, upper roof.
  b.box('wood_red', { x: c.x, y: y0 + Hw + 0.2, z: c.z, sx: W + 0.6, sy: 0.4, sz: depth + 0.6 });
  b.box('wood_dark', { x: c.x, y: y0 + Hw - 0.35, z: c.z, sx: W + 1.0, sy: 0.7, sz: depth + 1.0 });
  b.roof(bm.palaceRoof, { x: c.x, y: y0 + Hw + 0.4, z: c.z, w: W + 1, d: depth + 1, height: 3, overhang: 1.9, curve: 0.9, style: 'hip', ridge: null });
  goldEaves(b, c.x, y0 + Hw + 0.4, c.z, W + 1, depth + 1, 1.9);
  const uy = y0 + Hw + 2.0;
  b.box('plaster_red', { x: c.x, y: uy + 2.3, z: c.z, sx: W - 5, sy: 4.6, sz: depth - 4 }, { collide: true });
  b.box('wood_dark', { x: c.x, y: uy + 1.6, z: at(0, zc + (depth - 4) / 2 + 0.03).z, sx: W - 7, sy: 1.1, sz: 0.06 });
  b.box('wood_dark', { x: c.x, y: uy + 4.4, z: c.z, sx: W - 4.4, sy: 0.6, sz: depth - 3.4 });
  b.roof(bm.palaceRoof, { x: c.x, y: uy + 4.6, z: c.z, w: W - 3, d: depth - 2, height: 6.5, overhang: 2.2, curve: 1.0, style: 'hip', ridge: 'gold' });
  goldEaves(b, c.x, uy + 4.6, c.z, W - 3, depth - 2, 2.2);
  const pl = at(0, zc + (depth - 4) / 2 + 0.06);
  sign(b, bm, '正殿', pl.x, uy + 2.6, pl.z, 0, 1.5, { vertical: false });
  // The throne on its dais, a screen and banners behind it, red interior columns, lanterns.
  for (let k = 0; k < 3; k++) {
    const s = at(0, h.z0 + 3.2 - k * 0.15);
    d.box('stone_white', { x: s.x, y: y0 + 0.17 + k * 0.34, z: s.z + 0.0, sx: 8 - k * 1.2, sy: 0.34, sz: 4.6 - k * 0.9 }, { collide: true, walkable: true });
  }
  // Throne: lacquered seat with gold armrests and a tall carved back, a green cushion.
  const th = at(0, h.z0 + 2.8);
  const ty = y0 + 1.02;
  d.box('black_lacquer', { x: th.x, y: ty + 0.25, z: th.z, sx: 2.0, sy: 0.5, sz: 1.2 }, { collide: true });
  d.box('cloth_green', { x: th.x, y: ty + 0.56, z: th.z + 0.05, sx: 1.6, sy: 0.12, sz: 1.0 });
  for (const side of [-1, 1]) {
    d.box('gold', { x: th.x + side * 0.95, y: ty + 0.8, z: th.z + 0.05, sx: 0.22, sy: 0.6, sz: 1.15 });
    d.box('gold', { x: th.x + side * 0.95, y: ty + 1.12, z: th.z + 0.62, sx: 0.3, sy: 0.18, sz: 0.3 });
  }
  d.box('black_lacquer', { x: th.x, y: ty + 1.6, z: th.z - 0.55, sx: 2.0, sy: 2.2, sz: 0.16 });
  d.box('gold', { x: th.x, y: ty + 1.6, z: th.z - 0.5, sx: 1.6, sy: 1.8, sz: 0.1 });
  d.box('gold', { x: th.x, y: ty + 2.85, z: th.z - 0.55, sx: 2.5, sy: 0.32, sz: 0.24 });
  const scr = at(0, h.z0 + 0.75);
  d.box('black_lacquer', { x: scr.x, y: y0 + 3.4, z: scr.z, sx: 7, sy: 6.6, sz: 0.25 });
  d.box('gold', { x: scr.x, y: y0 + 3.4, z: scr.z - 0.02, sx: 7.3, sy: 6.9, sz: 0.2 });
  medallion(d, bm, scr.x, y0 + 4.6, scr.z + 0.16, 0, 1.4, 0.15);
  for (const side of [-1, 1]) {
    const bn = at(side * 6.2, h.z0 + 0.65);
    d.box(env.mats.banner, { x: bn.x, y: y0 + 5.2, z: bn.z, sx: 1.6, sy: 6.4, sz: 0.04 });
    for (const lz of [-2.2, -7.4]) {
      const col = at(side * 6.5, lz);
      d.cylinder('wood_red', { x: col.x, y: y0, z: col.z, r: 0.5, h: Hw, segments: 12 }, { collide: true });
    }
    d.lantern(new THREE.Vector3(at(side * 3.6, -4.6).x, y0 + 7.4, at(side * 3.6, -4.6).z), { color: 'warm', hanging: true });
  }
  site.mark('throne', th.x, y0 + 1.65, th.z);
}

// ---------------------------------------------------------------------------
// Bell and drum pavilions, inner court
// ---------------------------------------------------------------------------

function sidePavilions(site: DistrictSite, b: ContentBuilder): void {
  for (const side of [-1, 1]) {
    const p = at(side * 30.5, 8);
    pavilion(b, p.x, GROUND, p.z, 5.6, 5.6, 3.8, 0, 'roof_green', 2);
    if (side < 0) b.cylinder('bronze', { x: p.x, y: GROUND + 1.6, z: p.z, r: 0.85, rTop: 0.55, h: 1.9, segments: 14 });
    else b.cylinder('wood_red', { x: p.x, y: GROUND + 0.5, z: p.z, r: 1.0, h: 1.4, segments: 16 }, { collide: true });
  }
  for (const side of [-1, 1]) {
    const g = at(side * 10, 37.6);
    guardianStatue(b, g.x, GROUND, g.z, 0, 1.15, 'bronze');
  }
  for (const lx of [-15, 15]) {
    const l = at(lx, 30.2);
    lanternPost(b, l.x, GROUND, l.z, 'warm');
  }
}

function innerCourt(site: DistrictSite, b: ContentBuilder): void {
  const { env, bm } = site;
  const wz = P.innerWallZ;
  for (const side of [-1, 1]) {
    const w = at(side * 15.5, wz);
    b.box('plaster_red', { x: w.x, y: GROUND + 2, z: w.z, sx: 25, sy: 4, sz: 0.8 }, { collide: true });
    b.box(bm.palaceRoof, { x: w.x, y: GROUND + 4.15, z: w.z, sx: 25.6, sy: 0.3, sz: 1.7 });
    b.box('gold', { x: w.x, y: GROUND + 3.9, z: w.z, sx: 25.1, sy: 0.12, sz: 0.85 });
  }
  const g = at(0, wz);
  paifang(b, g.x, GROUND, g.z, 0, 6, 5.2, { roof: 'roof_green' });
  // Garden: pond with a stone rim, a little pavilion and trees.
  const pond = at(0, -32.5);
  site.water(b, { id: 'ba_sing_se:palace_pond', label: 'Palace garden pond', x: pond.x, z: pond.z, y: GROUND + 0.22, w: 10, d: 10, circle: true, capacity: 120, regen: 5, type: 'pond' });
  const rim = new THREE.TorusGeometry(5.1, 0.32, 6, 40);
  rim.rotateX(-Math.PI / 2);
  b.mesh('stone_white', rim, { x: pond.x, y: GROUND + 0.18, z: pond.z });
  rim.dispose();
  const pv = at(-9.5, -32.5);
  pavilion(b, pv.x, GROUND, pv.z, 3.6, 3.6, 3.0, Math.PI / 4, 'roof_green', 1);
  for (const [lx, lz, k] of [[7.5, -29, 'blossom'], [8, -36, 'cypress'], [-4, -38, 'round'], [4, -38.2, 'blossom'], [-7, -27, 'cypress']] as const) {
    const t = at(lx, lz);
    tree(b, env.mats, t.x, GROUND, t.z, 0.85, k, lx);
  }
  // Quarters facing the garden, the kitchens with a smoking chimney, the menagerie pen.
  for (const side of [-1, 1]) {
    const q = at(side * 17, -30);
    env.chunks.addHouse(env.arch.N1, q.x, GROUND, q.z, side < 0 ? Math.PI / 2 : -Math.PI / 2, { scale: 1.05, tint: WALL_PAL, roofTint: ROOF_PAL });
  }
  const k = at(28, -17);
  env.chunks.addHouse(env.arch.N2, k.x, GROUND, k.z, 0, { scale: 1.0, tint: WALL_PAL, roofTint: ROOF_PAL });
  const ch = at(28, -19.2);
  site.smoke.push({ x: ch.x, y: GROUND + 9.5, z: ch.z, rate: 0.22 });
  const m = at(-28.5, -15);
  for (const [x0, z0, x1, z1] of [[-32, -18, -25, -18], [-32, -12, -25, -12], [-32, -18, -32, -12], [-25, -18, -25, -16], [-25, -14, -25, -12]] as const) {
    const a = at(x0, z0), e = at(x1, z1);
    const len = Math.hypot(e.x - a.x, e.z - a.z), yaw = Math.atan2(e.x - a.x, e.z - a.z);
    b.box('wood_red', { x: (a.x + e.x) / 2, y: GROUND + 1.0, z: (a.z + e.z) / 2, sx: 0.12, sy: 0.14, sz: len, yaw }, { collide: true, walkable: false });
    b.box('wood_red', { x: (a.x + e.x) / 2, y: GROUND + 0.5, z: (a.z + e.z) / 2, sx: 0.1, sy: 0.12, sz: len, yaw });
    for (let i = 0; i <= Math.round(len / 1.5); i++) {
      const t = i / Math.max(1, Math.round(len / 1.5));
      b.box('wood_dark', { x: a.x + (e.x - a.x) * t, y: GROUND + 0.6, z: a.z + (e.z - a.z) * t, sx: 0.16, sy: 1.2, sz: 0.16 });
    }
  }
  const sh = at(-30.2, -16.2);
  for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.cylinder('wood_dark', { x: sh.x + dx, y: GROUND, z: sh.z + dz, r: 0.12, h: 2.4, segments: 6 }, { collide: true });
  b.roof('roof_green', { x: sh.x, y: GROUND + 2.4, z: sh.z, w: 3, d: 3, height: 1.0, overhang: 0.5, curve: 0.6, style: 'hip', ridge: null });
  b.box('stone_grey', { x: m.x + 1.5, y: GROUND + 0.3, z: m.z + 1.6, sx: 2.2, sy: 0.6, sz: 0.8 }, { collide: true });
  const sg = at(-25, -15);
  sign(b, bm, '獸苑', sg.x + 0.1, GROUND + 1.9, sg.z, Math.PI / 2, 0.7, { vertical: true });
  site.mark('menagerie', m.x, GROUND, m.z);
}

// ---------------------------------------------------------------------------
// Walking graph
// ---------------------------------------------------------------------------

function palaceNav(site: DistrictSite): void {
  const { nav } = site;
  const T = NavTag.palace;
  const top = P.tiers[2];
  nav.street([at(0, P.gate.z1 + 5), at(0, (P.gate.z0 + P.gate.z1) / 2), at(0, P.canalZ + 3.5), at(0, P.canalZ - 3.5), at(0, P.tiers[0].z1 + 2.8), at(0, top.z1 - 1), at(0, P.terraceZ), at(0, P.hall.z1 + 0.8)], T | NavTag.street, 6, 5);
  nav.street([at(0, P.terraceZ), at(top.hw - 2, P.terraceZ), at(top.hw - 2, top.z0 + 1), at(0, top.z0 + 1), at(0, P.tiers[0].z0 - 2.8), at(0, P.innerWallZ), at(0, -26.5)], T | NavTag.street, 6, 3);
  nav.street([at(-24, -22), at(0, P.tiers[0].z0 - 2.8), at(26, -22)], T | NavTag.street, 6, 3);
  nav.poi(at(0, P.hall.z1 + 0.2).x, at(0, P.hall.z1 + 0.2).z, T | NavTag.work, Math.PI);
  nav.poi(at(-6, P.terraceZ).x, at(-6, P.terraceZ).z, T | NavTag.square, 0);
  nav.poi(at(6, P.terraceZ).x, at(6, P.terraceZ).z, T | NavTag.square, 0);
  nav.poi(at(0, -26.6).x, at(0, -26.6).z, T | NavTag.water | NavTag.bench, Math.PI);
  nav.poi(at(-21, -15).x, at(-21, -15).z, T | NavTag.work, -Math.PI / 2);
  nav.poi(at(28, -12.6).x, at(28, -12.6).z, T | NavTag.work, Math.PI);
}
