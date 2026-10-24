import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import type { KitMaterialName } from '../../kit/Materials';
import { MID, MID_INNER, MIDDLE_AVENUES, PALACE, qkey, UP, UP_FACE, UP_GATES, UP_INNER } from './bssLayout';
import { houseRowsGen, lanternsAlong, lastStats, pavedStrip } from './cityKit';
import type { EarthRegion } from './EarthRegion';
import type { BuildEnv } from './env';
import { bannerPole, crates, fountain, guardianStatue, hangingBanner, mat4, pavilion, planter, plaque, stoneLantern, tree } from './parts';
import { BSS } from './spots';

/**
 * Ba Sing Se, Middle and Upper Rings: avenues, the Stone Fist Dojo, the tea
 * shop, the university, garden ponds with a moon bridge, mansions, and the
 * Earth King's Palace on its stepped platform with grand stairs.
 */

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Stair flight along +X at a fixed z with side cheeks (walkable ramp collider). */
function flightX(b: ContentBuilder, x0: number, x1: number, y0: number, y1: number, z: number, w: number, mat: KitMaterialName, cheek: KitMaterialName): void {
  b.stairs({ from: v3(x0, y0, z), to: v3(x1, y1, z), width: w, material: mat, stepHeight: 0.25 });
  const run = x1 - x0, rise = y1 - y0;
  const pitch = Math.atan2(rise, run);
  for (const sd of [-1, 1]) {
    const cz = z + sd * (w / 2 + 0.35);
    b.box(cheek, { x: (x0 + x1) / 2, y: y0 + rise / 2 + 0.3, z: cz, sx: Math.hypot(run, rise) + 0.4, sy: 1.0, sz: 0.7, roll: pitch });
    b.box(cheek, { x: (x0 + x1) / 2, y: y0 + rise / 4, z: cz, sx: run, sy: rise / 2, sz: 0.7 });
    b.collider({ shape: 'box', x: (x0 + x1) / 2, y: y0 + (rise + 1.2) / 2, z: cz, hx: run / 2, hz: 0.35, hy: (rise + 1.2) / 2, slopeRise: rise, walkable: false, solid: true });
  }
}

/** Low balustrade (solid) along a straight edge. */
function balustrade(b: ContentBuilder, ax: number, az: number, bx: number, bz: number, y: number, mat: KitMaterialName = 'stone_white'): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.3) return;
  const yaw = Math.atan2(-(bz - az), bx - ax);
  b.box(mat, { x: (ax + bx) / 2, y: y + 0.45, z: (az + bz) / 2, sx: len, sy: 0.9, sz: 0.45, yaw }, { collide: true, walkable: false });
  b.box('gold', { x: (ax + bx) / 2, y: y + 0.93, z: (az + bz) / 2, sx: len, sy: 0.08, sz: 0.5, yaw }, { castShadow: false });
}

/** Rectangle edge balustrades with an opening of half-width `gap` centred on the west edge at z = gz. */
function tierRail(b: ContentBuilder, t: { x0: number; x1: number; z0: number; z1: number }, y: number, gz: number, gap: number): void {
  const i = 0.3;
  balustrade(b, t.x0 + i, t.z0 + i, t.x1 - i, t.z0 + i, y);
  balustrade(b, t.x0 + i, t.z1 - i, t.x1 - i, t.z1 - i, y);
  balustrade(b, t.x1 - i, t.z0 + i, t.x1 - i, t.z1 - i, y);
  balustrade(b, t.x0 + i, t.z0 + i, t.x0 + i, gz - gap, y);
  balustrade(b, t.x0 + i, gz + gap, t.x0 + i, t.z1 - i, y);
}

/** Multi-storey hall with a colonnade and stacked curved roofs. Returns the roof top height. */
function grandHall(
  b: ContentBuilder,
  m: BuildEnv['mats'],
  o: { x: number; z: number; y: number; w: number; d: number; h: number; storeys: number; roof: KitMaterialName; wall: KitMaterialName; yaw?: number; front?: boolean },
): number {
  const yaw = o.yaw ?? 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (lx: number, lz: number) => ({ x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c });
  b.block('stone_white', { x: o.x, y: o.y, z: o.z, sx: o.w + 2.4, sy: 0.8, sz: o.d + 2.4, yaw }, { collide: true, walkable: true });
  let y = o.y + 0.8;
  let w = o.w, d = o.d, h = o.h;
  for (let k = 0; k < o.storeys; k++) {
    b.block(o.wall, { x: o.x, y, z: o.z, sx: w, sy: h, sz: d, yaw });
    if (k === 0) b.collider({ shape: 'box', x: o.x, y: y + h / 2, z: o.z, hx: w / 2 + 0.3, hz: d / 2 + 0.3, hy: h / 2, yaw, walkable: true, solid: true });
    // Colonnade (red columns) on all faces.
    const nx = Math.max(3, Math.round(w / 3.4)), nz = Math.max(3, Math.round(d / 3.4));
    for (let i = 0; i <= nx; i++) {
      for (const sd of [-1, 1]) {
        const p = L(-w / 2 + (i * w) / nx, sd * (d / 2 + 0.25));
        b.box('wood_red', { x: p.x, y: y + h / 2, z: p.z, sx: 0.55, sy: h, sz: 0.55, yaw });
      }
    }
    for (let i = 1; i < nz; i++) {
      for (const sd of [-1, 1]) {
        const p = L(sd * (w / 2 + 0.25), -d / 2 + (i * d) / nz);
        b.box('wood_red', { x: p.x, y: y + h / 2, z: p.z, sx: 0.55, sy: h, sz: 0.55, yaw });
      }
    }
    // Lattice window band + gold frieze.
    b.box('wood_dark', { x: o.x, y: y + h * 0.55, z: o.z, sx: w + 0.12, sy: h * 0.32, sz: d + 0.12, yaw });
    b.box('gold', { x: o.x, y: y + h - 0.35, z: o.z, sx: w + 0.7, sy: 0.4, sz: d + 0.7, yaw });
    y += h;
    const rh = Math.min(w, d) * (k === o.storeys - 1 ? 0.36 : 0.22);
    b.roof(o.roof, { x: o.x, y, z: o.z, w, d, height: rh, yaw, overhang: k === o.storeys - 1 ? 2.4 : 2.8, style: 'hip', curve: 0.95, ridge: 'gold' });
    if (k === o.storeys - 1) {
      for (const sd of [-1, 1]) {
        const p = L(sd * Math.max(0.6, (w - d) / 2 + 0.5), 0);
        b.box('gold', { x: p.x, y: y + rh + 0.7, z: p.z, sx: 0.7, sy: 1.4, sz: 0.7, yaw });
      }
      y += rh;
    } else {
      y += rh * 0.45;
    }
    w *= 0.7;
    d *= 0.74;
    h *= 0.72;
  }
  if (o.front !== false) {
    // Emblem plaque above the main door (front = local +Z).
    const p = L(0, o.d / 2 + 0.3);
    plaque(b, m, p.x, o.y + 0.8 + o.h * 0.78, p.z, yaw, Math.min(2.4, o.h * 0.2));
    b.box('wood_red', { x: p.x, y: o.y + 0.8 + 2.2, z: p.z, sx: 3.6, sy: 4.4, sz: 0.2, yaw });
  }
  return y;
}

// ---------------------------------------------------------------------------
// Palace
// ---------------------------------------------------------------------------

export function buildPalace(env: BuildEnv, site: EarthRegion): void {
  const b = env.chunks.named('major', 'palace').builder;
  const t = PALACE.tiers;
  let base = UP.level;
  for (let i = 0; i < t.length; i++) {
    const r = t[i];
    const w = r.x1 - r.x0, d = r.z1 - r.z0, h = r.top - base;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    b.block('stone_white', { x: cx, y: base - 0.4, z: cz, sx: w, sy: h + 0.4, sz: d }, { collide: true, walkable: true });
    b.box('stone_light', { x: cx, y: base + 0.5, z: cz, sx: w + 0.6, sy: 1.0, sz: d + 0.6 });
    b.box('gold', { x: cx, y: r.top - 0.6, z: cz, sx: w + 0.3, sy: 0.35, sz: d + 0.3 }, { castShadow: false });
    b.box('paving', { x: cx, y: r.top + 0.01, z: cz, sx: w - 0.2, sy: 0.04, sz: d - 0.2 }, { castShadow: false });
    tierRail(b, r, r.top, PALACE.z, PALACE.stairWidth / 2 + 0.8);
    base = r.top;
  }
  // Grand west stairs.
  for (const f of PALACE.flights) flightX(b, f.x0, f.x1, f.y0, f.y1, PALACE.z, PALACE.stairWidth, 'stone_white', 'stone_light');
  // Gold guardian lions flanking each flight.
  for (const f of PALACE.flights) {
    for (const sd of [-1, 1]) guardianStatue(b, f.x0 - 1.8, f.y0, PALACE.z + sd * (PALACE.stairWidth / 2 + 2.4), -Math.PI / 2, 0.75, 'gold');
  }
  // Main hall on the top tier (front faces west toward the stairs).
  const hl = PALACE.hall;
  const top = grandHall(b, env.mats, { x: (hl.x0 + hl.x1) / 2, z: (hl.z0 + hl.z1) / 2, y: t[2].top, w: hl.z1 - hl.z0, d: hl.x1 - hl.x0, h: 10, storeys: 3, roof: 'roof_green', wall: 'plaster_cream', yaw: -Math.PI / 2 });
  site.mark('palaceTop', (hl.x0 + hl.x1) / 2, top, (hl.z0 + hl.z1) / 2);
  // Corner pavilions on the second tier and side halls on the first.
  for (const [x, z] of [[833, -76], [833, -24], [895, -76], [895, -24]]) pavilion(b, x, t[1].top, z, 4.5, 4.5, 4, 0, 'roof_green', 2);
  // Banners on the tier faces.
  for (const z of [-80, -64, -36, -20]) hangingBanner(b, env.mats, t[0].x0 - 0.1, t[0].top - 0.3, z, Math.PI, 2.6, 5.2);
  env.excl.rect(t[0].x0 - 9, t[0].z0 - 3, t[0].x1 + 3, t[0].z1 + 3);
}

// ---------------------------------------------------------------------------
// Middle Ring
// ---------------------------------------------------------------------------

export function* buildMiddleRing(env: BuildEnv, site: EarthRegion): Generator<unknown, void, unknown> {
  const { chunks, mats, excl, rnd } = env;
  const Y = MID.level;
  // Avenues (exclusions first).
  for (const av of MIDDLE_AVENUES) excl.polyline(av.points, av.width / 2 + 2.5);
  const P = BSS.middlePlaza;
  excl.circle(P.x, P.z, P.r + 3);
  const D = BSS.dojo;
  excl.rect(D.yard.x - D.yard.hw - 2, D.yard.z - D.yard.hd - 2, D.hall.x + D.hall.w / 2 + 3, D.yard.z + D.yard.hd + 2);
  excl.rect(D.street.x - 4, D.street.z0, D.street.x + 4, D.street.z1);
  excl.rect(BSS.teaShop.x - 11, BSS.teaShop.z - 8, BSS.teaShop.x + 11, BSS.teaShop.z + 22);
  excl.rect(BSS.university.x - 22, BSS.university.z - 14, BSS.university.x + 36, BSS.university.z + 22);
  excl.circle(BSS.gardenW.x, BSS.gardenW.z, BSS.gardenW.r + 14);
  excl.circle(BSS.gardenE.x, BSS.gardenE.z, BSS.gardenE.r + 10);
  yield;

  const pb = chunks.named('major', 'ground').builder;
  for (const av of MIDDLE_AVENUES) {
    pavedStrip(pb, mats.road, av.points, av.width, Y + 0.03, 4);
    lanternsAlong(env, av.points, av.width / 2 + 0.8, Y, 16, 'warm');
  }
  // Middle plaza (landmark): paving disc, ring of stone lanterns and banner poles (centre kept open).
  {
    const b = chunks.named('props', 'mid_plaza').builder;
    const g = new THREE.CylinderGeometry(P.r, P.r, 0.1, 40);
    b.mesh('paving_dark', g, { x: P.x, y: Y - 0.01, z: P.z }, { castShadow: false });
    g.dispose();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      if (Math.abs(Math.sin(a)) < 0.45) continue; // keep the avenue axis open
      stoneLantern(b, P.x + Math.cos(a) * (P.r + 1.5), Y, P.z + Math.sin(a) * (P.r + 1.5), 1.3);
    }
    for (const sd of [-1, 1]) bannerPole(b, mats, P.x, Y, P.z + sd * (P.r + 3.5), 0, 9);
  }
  yield;

  // --- Stone Fist Dojo: open sparring yard (training_lien) + hall facing it.
  {
    const b = chunks.named('major', `q:${qkey(D.hall.x, D.hall.z)}`).builder;
    const pr = chunks.named('props', 'mid_dojo_props').builder;
    const yd = D.yard;
    b.box('stone_tan', { x: yd.x, y: Y - 0.03, z: yd.z, sx: yd.hw * 2, sy: 0.12, sz: yd.hd * 2 }, { castShadow: false });
    b.box('paving_dark', { x: yd.x, y: Y - 0.02, z: yd.z, sx: yd.hw * 2 - 4, sy: 0.12, sz: yd.hd * 2 - 4 }, { castShadow: false });
    // Low yard wall with an entrance on the north side.
    const wallH = 1.2;
    const seg = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(-(bz - az), bx - ax);
      b.box('stone_light', { x: (ax + bx) / 2, y: Y + wallH / 2, z: (az + bz) / 2, sx: len, sy: wallH, sz: 0.6, yaw }, { collide: true, walkable: true });
      b.box('roof_green', { x: (ax + bx) / 2, y: Y + wallH + 0.1, z: (az + bz) / 2, sx: len, sy: 0.2, sz: 0.9, yaw });
    };
    const x0 = yd.x - yd.hw, x1 = yd.x + yd.hw, z0 = yd.z - yd.hd, z1 = yd.z + yd.hd;
    seg(x0, z0, D.street.x - 3.5, z0);
    seg(D.street.x + 3.5, z0, x1, z0);
    seg(x0, z0, x0, z1);
    seg(x0, z1, x1, z1);
    // Dojo hall on the east side (front faces west into the yard).
    grandHall(b, mats, { x: D.hall.x, z: D.hall.z, y: Y, w: D.hall.d, d: D.hall.w, h: 6.5, storeys: 2, roof: 'roof_green', wall: 'plaster_cream', yaw: -Math.PI / 2 });
    // Training props: wooden dummies, weapon racks, stone blocks along the walls (inside the margin).
    // Props only in the yard corners (outside the 12.5 m sparring circle).
    for (const [cx, cz] of [[x0 + 1.6, z1 - 1.6], [x0 + 3.4, z1 - 1.6], [x0 + 1.6, z1 - 3.4]]) {
      pr.cylinder('wood', { x: cx, y: Y, z: cz, r: 0.22, h: 1.8, segments: 8 }, { collide: true, walkable: false });
      pr.box('wood', { x: cx, y: Y + 1.4, z: cz, sx: 0.12, sy: 0.12, sz: 1.2 });
    }
    for (const [cx, cz] of [[x1 - 1.4, z0 + 1.4], [x1 - 1.4, z1 - 1.4], [x0 + 1.4, z0 + 4.5]]) pr.block('stone_grey', { x: cx, y: Y, z: cz, sx: 1.3, sy: 1.1, sz: 1.1, yaw: cx * 0.7 }, { collide: true, walkable: true });
    for (const sd of [-1, 1]) {
      bannerPole(pr, mats, D.street.x + sd * 5, Y, z0 - 1.5, Math.PI, 7);
      guardianStatue(pr, D.street.x + sd * 6.5, Y, z0 - 6, Math.PI, 0.6);
    }
    plaque(pr, mats, D.hall.x - D.hall.w / 2 - 0.5, Y + 6.2, D.hall.z, -Math.PI / 2, 1.4);
    pavedStrip(chunks.named('major', 'ground').builder, mats.road, [{ x: D.street.x, z: D.street.z0 }, { x: D.street.x, z: D.street.z1 }], 6, Y + 0.035, 4);
    lanternsAlong(env, [{ x: D.street.x, z: D.street.z0 + 4 }, { x: D.street.x, z: D.street.z1 - 3 }], 3.6, Y, 12);
    site.mark('dojoYard', yd.x, Y, yd.z);
    // Students practising at the yard edges.
    let seed = 7300;
    for (const [x, z, yaw] of [[x0 + 2.2, z0 + 2.2, Math.PI * 0.75], [x0 + 5.5, z1 - 2.2, Math.PI / 2], [x1 - 2.6, z1 - 3.6, -Math.PI / 2]] as Array<[number, number, number]>) {
      site.npc({ id: `bss_amb_dojo_student_${seed}`, name: 'Dojo Student', role: 'student', nation: 'earth', element: 'earth', appearanceSeed: seed++, x, z, y: Y, yaw, behavior: { type: 'train' }, region: 'ba_sing_se', marker: 'none' });
    }
  }
  yield;

  // --- Tea shop with a terrace (counter = merchant_bss_tea).
  {
    const T = BSS.teaShop;
    const b = chunks.named('props', 'mid_tea').builder;
    b.building({ x: T.x, y: Y, z: T.z, w: 16, d: 10, h: 7, wall: 'plaster_cream', roof: 'roof_green', trim: 'wood_red', floors: 2, roofStyle: 'hip', roofHeight: 3.4, plinth: 'stone_light' });
    b.box('cloth_green', { x: T.x, y: Y + 3.1, z: T.z + 6.2, sx: 15, sy: 0.06, sz: 2.6, pitch: 0.22 });
    for (let i = 0; i < 6; i++) {
      const x = T.x - 6 + (i % 3) * 6, z = T.z + 10 + Math.floor(i / 3) * 5;
      b.cylinder('wood_dark', { x, y: Y, z, r: 0.75, h: 0.8, segments: 10 }, { collide: true, walkable: true });
      for (const a of [0, 2.1, 4.2]) b.cylinder('wood', { x: x + Math.cos(a) * 1.3, y: Y, z: z + Math.sin(a) * 1.3, r: 0.25, h: 0.45, segments: 8 });
    }
    hangingBanner(b, mats, T.x, Y + 6.6, T.z + 5.15, 0, 3.2, 2);
    site.npc({ id: 'bss_amb_tea_server', name: 'Tea Server', role: 'villager', nation: 'earth', appearanceSeed: 7350, x: T.x + 4, z: T.z + 9, y: Y, yaw: 0, behavior: { type: 'wander', radius: 5 }, region: 'ba_sing_se', marker: 'none' });
    site.npc({ id: 'bss_amb_tea_guest', name: 'Tea Drinker', role: 'noble', nation: 'earth', appearanceSeed: 7351, x: T.x - 6, z: T.z + 11.5, y: Y, yaw: Math.PI, behavior: { type: 'idle', variant: 'sit' }, region: 'ba_sing_se', marker: 'none' });
  }
  // --- University: great hall + library pagoda + courtyard.
  {
    const U0 = BSS.university;
    const b = chunks.named('major', `q:${qkey(BSS.university.x, BSS.university.z)}`).builder;
    grandHall(b, mats, { x: U0.x, z: U0.z, y: Y, w: 34, d: 16, h: 7, storeys: 2, roof: 'roof_green', wall: 'plaster_white', yaw: 0 });
    const pg = { x: U0.x + 28, z: U0.z - 4 };
    let y = Y;
    let s = 9;
    for (let k = 0; k < 4; k++) {
      b.block(k === 0 ? 'stone_light' : 'plaster_white', { x: pg.x, y, z: pg.z, sx: s, sy: 4.2, sz: s });
      if (k === 0) b.collider({ shape: 'box', x: pg.x, y: y + 2.1, z: pg.z, hx: s / 2, hz: s / 2, hy: 2.1, walkable: true, solid: true });
      y += 4.2;
      b.roof('roof_green', { x: pg.x, y, z: pg.z, w: s, d: s, height: s * 0.28, overhang: 1.6, style: 'pagoda', curve: 1, ridge: null });
      y += s * 0.12;
      s *= 0.8;
    }
    b.box('gold', { x: pg.x, y: y + 1.2, z: pg.z, sx: 0.5, sy: 2.4, sz: 0.5 });
    b.box('paving', { x: U0.x, y: Y - 0.02, z: U0.z + 15, sx: 30, sy: 0.1, sz: 12 }, { castShadow: false });
    const pr = chunks.named('props', 'mid_university_props').builder;
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) tree(pr, mats, U0.x + sd * (6 + i * 4.5), Y, U0.z + 19, 1.1, 'cypress', i + sd);
    site.npc({ id: 'bss_amb_scholar', name: 'University Scholar', role: 'villager', nation: 'earth', appearanceSeed: 7360, x: U0.x - 4, z: U0.z + 13, y: Y, yaw: 0, behavior: { type: 'wander', radius: 6 }, region: 'ba_sing_se', marker: 'none' });
  }
  yield;

  // --- Gardens: ponds (water sources), moon bridge, trees, pavilion.
  {
    const G = BSS.gardenW;
    const b = chunks.named('props', 'mid_garden_w').builder;
    const lawn = new THREE.CircleGeometry(G.r + 12, 40);
    lawn.rotateX(-Math.PI / 2);
    chunks.named('major', 'ground').builder.mesh(mats.hedge, lawn, { x: G.x, y: Y + 0.02, z: G.z }, { castShadow: false });
    lawn.dispose();
    fountain(b, G.x, Y, G.z, G.r, { id: 'bss_middle_garden_pond', label: 'Middle Ring garden pond', capacity: 140, regen: 3, spout: false, type: 'pond' });
    env.waterIds.push('bss_middle_garden_pond');
    b.bridge({ a: v3(G.x - G.r - 6, Y, G.z), b: v3(G.x + G.r + 6, Y, G.z), width: 2.6, deck: 'wood_red', rail: 'wood_red', support: null, arch: 2.6, surface: 'wood' });
    site.mark('moonBridge', G.x, Y + 2.6, G.z);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3;
      if (Math.abs(Math.sin(a)) < 0.3) continue; // bridge ends
      const r = G.r + rnd.range(4, 9);
      tree(b, mats, G.x + Math.cos(a) * r, Y, G.z + Math.sin(a) * r, rnd.range(0.9, 1.3), i % 3 === 0 ? 'blossom' : i % 3 === 1 ? 'round' : 'cypress', a * 3);
    }
    pavilion(b, G.x, Y, G.z + G.r + 9, 5, 5, 3.6, 0, 'roof_green', 2);
    const E = BSS.gardenE;
    const be = chunks.named('props', 'mid_garden_e').builder;
    fountain(be, E.x, Y, E.z, E.r, { id: 'bss_middle_east_pond', label: 'Middle Ring east garden pond', capacity: 110, regen: 2.5, spout: true, type: 'pond' });
    env.waterIds.push('bss_middle_east_pond');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      tree(be, mats, E.x + Math.cos(a) * (E.r + 5), Y, E.z + Math.sin(a) * (E.r + 5), 1.1, i % 2 ? 'blossom' : 'round', a * 2);
    }
  }
  yield;

  // --- Houses (larger, with gardens).
  const n = yield* houseRowsGen(env, {
    c: { x: MID.x, z: MID.z },
    rOuter: MID_INNER - 1,
    edge: 6,
    rStop: 20,
    y: Y,
    types: [['M1', 2], ['M2', 1.6], ['G1', 1.1], ['L4', 0.7], ['L2', 0.6], ['L3', 0.6]],
    pitch: 12.5,
    street: 6.5,
    gap: [1.6, 4.5],
    alleyEvery: 0.3,
    alleyW: 5,
    reject: (x, z) => Math.hypot(x - UP.x, z - UP.z) < UP_FACE + 7,
    vacancy: 0.14,
    laundry: 0.08,
    tints: ['#ffffff', '#f6f0e4', '#fbf4e8', '#efe8da'],
    onVacant: (x, z, _yaw, hw) => {
      const b = chunks.at('props', x, z).builder;
      tree(b, mats, x, Y, z, 1 + rnd.range(0, 0.4), rnd.chance(0.4) ? 'blossom' : 'round', rnd.range(0, 6));
      if (hw > 4) stoneLantern(b, x + hw * 0.6, Y, z, 1);
    },
  });
  site.mark('middleHouses', n, 0, 0);
  site.mark('middleStats', lastStats.lots, lastStats.blocked, lastStats.rejected * 1000 + lastStats.outside);
  void crates;
  void mat4;
}

// ---------------------------------------------------------------------------
// Upper Ring
// ---------------------------------------------------------------------------

export function* buildUpperRing(env: BuildEnv, site: EarthRegion): Generator<unknown, void, unknown> {
  const { chunks, mats, excl, rnd } = env;
  const Y = UP.level;
  const gw = UP_GATES[0];
  // Forecourt avenue from the west gate to the palace stairs.
  const fx0 = gw.x + 2, fx1 = PALACE.flights[0].x0;
  excl.rect(fx0 - 4, PALACE.z - 26, fx1 + 2, PALACE.z + 26);
  for (const g of UP_GATES.slice(1)) excl.seg(g.x, g.z, g.x - g.nx * 30, g.z - g.nz * 30, 8);
  const b = chunks.named('major', 'ground').builder;
  b.box('paving', { x: (fx0 + fx1) / 2, y: Y - 0.02, z: PALACE.z, sx: fx1 - fx0, sy: 0.1, sz: 18 }, { castShadow: false });
  const pr = chunks.named('props', 'upper_props').builder;
  for (const f of BSS.upperFountains) {
    const id = `bss_upper_fountain_${f.z < PALACE.z ? 'n' : 's'}`;
    fountain(pr, f.x, Y, f.z, 4.5, { id, label: 'Upper Ring fountain', capacity: 80, regen: 2 });
    env.waterIds.push(id);
  }
  for (let x = fx0 + 4; x < fx1 - 2; x += 7) {
    for (const sd of [-1, 1]) {
      const z = PALACE.z + sd * 10.5;
      if (BSS.upperFountains.some((f) => Math.hypot(f.x - x, f.z - z) < 7.5)) continue;
      bannerPole(pr, mats, x, Y, z, sd > 0 ? 0 : Math.PI, 8);
    }
  }
  for (const g of UP_GATES.slice(1)) lanternsAlong(env, [{ x: g.x - g.nx * 4, z: g.z - g.nz * 4 }, { x: g.x - g.nx * 22, z: g.z - g.nz * 22 }], 7, Y, 9, 'warm');
  yield;
  // Grand mansions in the north and south crescents (fronts face the palace).
  let mansions = 0;
  for (const [x, z, yaw] of [[828, -106, 0], [884, -106, 0], [828, 6, Math.PI], [884, 6, Math.PI]] as Array<[number, number, number]>) {
    const a = env.arch.G1;
    if (excl.rectBlocked(x, z, (a.spanW * 1.3) / 2, (a.spanD * 1.3) / 2, yaw, 0.3)) continue;
    chunks.addHouse(a, x, Y, z, yaw, { scale: 1.3, tint: new THREE.Color('#fffaf0') });
    excl.box(x, z, (a.spanW * 1.3) / 2, (a.spanD * 1.3) / 2, yaw);
    mansions++;
  }
  // Mansions with gardens around the palace platform.
  const n = yield* houseRowsGen(env, {
    c: { x: UP.x, z: UP.z },
    rOuter: UP_INNER - 1,
    edge: 5,
    rStop: 40,
    y: Y,
    types: [['G1', 2], ['M2', 1.4], ['M1', 1.2]],
    scale: [1.05, 1.2],
    pitch: 13,
    street: 6,
    gap: [3, 6],
    alleyEvery: 0,
    alleyW: 0,
    vacancy: 0.2,
    tints: ['#ffffff', '#fbf6ea', '#f3efe6'],
    onVacant: (x, z) => {
      const bb = chunks.at('props', x, z).builder;
      tree(bb, mats, x, Y, z, 1.2, 'blossom', rnd.range(0, 6));
      planter(bb, mats, x + 3, Y, z + 2, 1.2);
    },
  });
  site.mark('upperHouses', n + mansions, 0, 0);
  site.mark('upperStats', lastStats.lots, lastStats.blocked, lastStats.rejected * 1000 + lastStats.outside);
  // Blossom trees ringing the terrace edge.
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const x = UP.x + Math.cos(a) * (UP_INNER - 3), z = UP.z + Math.sin(a) * (UP_INNER - 3);
    if (excl.pointBlocked(x, z, 1.5)) continue;
    tree(chunks.at('props', x, z).builder, mats, x, Y, z, 0.9, 'blossom', a * 5, true);
  }
}
