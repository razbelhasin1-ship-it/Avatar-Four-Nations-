import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import type { KitMaterialName } from '../../kit/Materials';
import type { P2 } from '../../WorldLayout';

/**
 * Kyoshi Island building kit (geometry only, merged into the region's chunk builders): rural Earth
 * Kingdom houses in a Japanese / Ainu register — weathered dark plank walls on raised floors with
 * outdoor stairs, steep plank or thatch roofs (grey tile at the harbor, dojo and shrine) — fences,
 * lanterns, barrels, nets, drying racks, laundry and the like.
 *
 * Frames: `yaw` is the facing (local +Z = front, toward the street); `off()` moves in that frame.
 */

export type Mat = KitMaterialName | THREE.Material;

export function off(o: P2, yaw: number, right: number, fwd: number): P2 {
  return { x: o.x + Math.sin(yaw) * fwd - Math.cos(yaw) * right, z: o.z + Math.cos(yaw) * fwd + Math.sin(yaw) * right };
}

/**
 * Height of a kit roof (Builder.roofGeometry, gable style) above its eave line at its gable ends,
 * `z` across from the ridge: the concave profile (steep at the ridge, flaring at the eaves) plus the
 * upturn of the eave corners. `hd` is half its width across, overhangs included.
 */
export function roofProfile(z: number, hd: number, height: number, curve: number): number {
  const t = Math.max(0, 1 - Math.abs(z) / hd);
  return height * Math.pow(t, 1.6) + curve * 0.8 * (1 - t) * (1 - t);
}

/**
 * Vertical ribbons in a roof's frame (ridge along X) at each x in `xs`, from bottom(z) up to top(z)
 * for |z| ≤ half: they close a two-layer thatch roof at its gable ends so it reads thick and solid.
 * UVs in metres / 2 like the roofs. For double-sided materials.
 */
export function ribbonGeometry(xs: number[], half: number, top: (z: number) => number, bottom: (z: number) => number, segs = 24): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const x of xs) {
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const z = -half + (i / segs) * half * 2;
      const tp = top(z), bt = Math.min(bottom(z), tp);
      pos.push(x, tp, z, x, bt, z);
      uv.push(z / 2, tp / 2, z / 2, bt / 2);
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A gable end wall in a roof's frame (ridge along X), at x, cut to the roof's underside `top(z)` for
 * |z| ≤ half, `t` thick; `notch` = [half width, height] leaves a doorway at its foot.
 */
export function profileWallGeometry(x: number, half: number, top: (z: number) => number, t: number, notch?: [number, number]): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const n = 20;
  sh.moveTo(-half, 0);
  for (let i = 0; i <= n; i++) {
    const z = -half + (i / n) * half * 2;
    sh.lineTo(z, Math.max(0.05, top(z)));
  }
  sh.lineTo(half, 0);
  if (notch) {
    sh.lineTo(notch[0], 0);
    sh.lineTo(notch[0], notch[1]);
    sh.lineTo(-notch[0], notch[1]);
    sh.lineTo(-notch[0], 0);
  }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  // Shape u → +Z (across), its depth → X.
  g.rotateY(-Math.PI / 2);
  g.translate(x, 0, 0);
  return g;
}

/**
 * A gable roof in the house frame of the kit roofs (ridge along the roof's X), open at its gable
 * ends: one layer for tile and shingles; thatch as two layers (the lower one wider and lower, so it
 * stays underneath) closed at the ends by straw ribbons, so it reads thick. Returns the underside
 * profile (height above the eave line, `z` across) for the gable walls under it.
 */
export function gableRoof(b: ContentBuilder, mat: Mat, o: { x: number; y: number; z: number; yaw: number; w: number; d: number; height: number; overhang: number; curve: number; thick: number; ridge: Mat | null }): (z: number) => number {
  b.roof(mat, { x: o.x, y: o.y, z: o.z, w: o.w, d: o.d, height: o.height, yaw: o.yaw, overhang: o.overhang, curve: o.curve, style: 'gable', ridge: o.ridge, open: true });
  const hd = o.d / 2 + o.overhang;
  const upper = (z: number) => roofProfile(z, hd, o.height, o.curve);
  if (o.thick <= 0) return upper;
  // The wider layer: `widen` more across; dropped enough to stay under the upper one everywhere.
  const widen = o.thick;
  const hdL = hd + widen;
  let gap = 0;
  for (let i = 0; i <= 40; i++) {
    const z = (i / 40) * hd;
    gap = Math.max(gap, roofProfile(z, hdL, o.height, o.curve) - upper(z));
  }
  const drop = gap + o.thick * 0.6;
  b.roof(mat, { x: o.x, y: o.y - drop, z: o.z, w: o.w, d: o.d + widen * 2, height: o.height, yaw: o.yaw, overhang: o.overhang, curve: o.curve, style: 'gable', ridge: null, open: true });
  const lower = (z: number) => roofProfile(z, hdL, o.height, o.curve) - drop;
  const ends = o.w / 2 + o.overhang - 0.01;
  const rib = ribbonGeometry([-ends, ends], hdL, (z) => (Math.abs(z) <= hd ? upper(z) : lower(z)), lower);
  b.mesh(mat, rib, { x: o.x, y: o.y, z: o.z, yaw: o.yaw });
  rib.dispose();
  return lower;
}

export interface HouseOpts {
  x: number;
  z: number;
  /** Ground under the house centre (the floor is raised above it). */
  y: number;
  yaw: number;
  w: number;
  d: number;
  /** Wall height above the floor. */
  h: number;
  /** Floor height above the ground (stilts / raised floor). */
  floor: number;
  roofH: number;
  roof: Mat;
  wall?: Mat;
  trim?: Mat;
  /** Stairs: up the front or along the side. */
  stairs?: 'front' | 'side' | 'none';
  porch?: boolean;
  /** Lowest ground under the footprint (deeper stilts on slopes). */
  minY?: number;
  /** Paper for lattice windows (one in each side wall, two flanking the door); else plain shutters. */
  windows?: Mat;
  /** A paper lantern hanging by the door. */
  lantern?: 'red' | 'warm';
  /** Thatch: a second, wider layer under the roof shows its thickness at the eaves and gables. */
  thickRoof?: boolean;
}

/**
 * A paper lattice window (two sliding panes) in a dark frame with a sill, on a wall whose outer face
 * is at `at`, facing `face` (yaw of the wall's outward normal); `y` is the window's centre height.
 */
export function paperWindow(b: ContentBuilder, at: P2, y: number, face: number, w: number, h: number, paper: Mat, frame: Mat = 'wood_dark'): void {
  const fx = Math.sin(face), fz = Math.cos(face);
  const out = (d: number): P2 => ({ x: at.x + fx * d, z: at.z + fz * d });
  const pane = out(0.08);
  b.box(paper, { x: pane.x, y, z: pane.z, sx: w, sy: h, sz: 0.04, yaw: face }, { castShadow: false });
  const f = out(0.11);
  const t = 0.09;
  for (const s of [-1, 1]) {
    const e = off(f, face, s * (w / 2 + t / 2), 0);
    b.box(frame, { x: e.x, y, z: e.z, sx: t, sy: h + t * 2, sz: 0.06, yaw: face }, { castShadow: false });
  }
  b.box(frame, { x: f.x, y: y + h / 2 + t / 2, z: f.z, sx: w + t * 2, sy: t, sz: 0.06, yaw: face }, { castShadow: false });
  b.box(frame, { x: f.x, y, z: f.z, sx: 0.045, sy: h, sz: 0.05, yaw: face }, { castShadow: false });
  const sill = out(0.15);
  b.box(frame, { x: sill.x, y: y - h / 2 - 0.05, z: sill.z, sx: w + 0.32, sy: 0.08, sz: 0.2, yaw: face }, { castShadow: false });
}

/**
 * A village lamp: a timber post on a stone footing with a little roof cap, and a paper lantern hanging
 * from an arm reaching `armYaw`-wards. Returns the lantern's centre (for the dusk lights).
 */
export function lanternPost(b: ContentBuilder, x: number, ground: number, z: number, armYaw: number, color: 'red' | 'warm' = 'warm'): THREE.Vector3 {
  b.box('stone_grey', { x, y: ground + 0.1, z, sx: 0.46, sy: 0.3, sz: 0.46, yaw: armYaw });
  b.box('wood', { x, y: ground + 1.55, z, sx: 0.17, sy: 2.9, sz: 0.17, yaw: armYaw }, { collide: true, solid: true, surface: 'wood' });
  b.roof('roof_dark', { x, y: ground + 3.0, z, w: 0.42, d: 0.42, height: 0.2, yaw: armYaw, overhang: 0.08, curve: 0.3, style: 'hip', ridge: null });
  const reach = 0.72;
  const arm = off({ x, z }, armYaw, 0, reach / 2);
  b.box('wood_dark', { x: arm.x, y: ground + 2.62, z: arm.z, sx: 0.08, sy: 0.08, sz: reach, yaw: armYaw }, { castShadow: false });
  const brace = off({ x, z }, armYaw, 0, 0.2);
  b.box('wood_dark', { x: brace.x, y: ground + 2.47, z: brace.z, sx: 0.05, sy: 0.05, sz: 0.42, yaw: armYaw, pitch: 0.75 }, { castShadow: false });
  const tip = off({ x, z }, armYaw, 0, reach - 0.06);
  b.box('iron', { x: tip.x, y: ground + 2.5, z: tip.z, sx: 0.02, sy: 0.22, sz: 0.02 }, { castShadow: false });
  const at = new THREE.Vector3(tip.x, ground + 2.12, tip.z);
  b.lantern(at, { color, hanging: true });
  return at;
}

/**
 * A raised plank house: posts, floor deck, plank walls with a door and shuttered windows, beams,
 * a steep gable roof, outdoor stairs, optional front veranda. One solid collider for the body,
 * walkable deck, stairs with a ramp collider.
 */
export function house(b: ContentBuilder, o: HouseOpts): void {
  const wall = o.wall ?? 'wood_dark';
  const trim = o.trim ?? 'wood';
  const yaw = o.yaw;
  const c: P2 = { x: o.x, z: o.z };
  const fy = o.y + o.floor;
  const base = Math.min(o.y, o.minY ?? o.y) - 0.3;
  // Stilts under the floor.
  for (const r of [-1, 0, 1]) for (const f of [-1, 1]) {
    const q = off(c, yaw, r * (o.w / 2 - 0.2), f * (o.d / 2 - 0.2));
    const hh = fy - base;
    b.box(trim, { x: q.x, y: base + hh / 2, z: q.z, sx: 0.26, sy: hh, sz: 0.26, yaw });
  }
  // Floor deck (walkable around the walls when there is a veranda).
  const porchD = o.porch ? 1.6 : 0;
  const deckC = off(c, yaw, 0, porchD / 2);
  b.box(trim, { x: deckC.x, y: fy - 0.12, z: deckC.z, sx: o.w + 0.4, sy: 0.24, sz: o.d + 0.4 + porchD, yaw }, { collide: true, walkable: true, solid: true, surface: 'wood' });
  // Walls (front with a door gap).
  const wy = fy + o.h / 2;
  const back = off(c, yaw, 0, -o.d / 2);
  b.box(wall, { x: back.x, y: wy, z: back.z, sx: o.w, sy: o.h, sz: 0.14, yaw });
  for (const s of [-1, 1]) {
    const q = off(c, yaw, s * o.w / 2, 0);
    b.box(wall, { x: q.x, y: wy, z: q.z, sx: 0.14, sy: o.h, sz: o.d, yaw });
  }
  const doorW = 1.2, side = (o.w - doorW) / 2;
  for (const s of [-1, 1]) {
    const q = off(c, yaw, s * (doorW / 2 + side / 2), o.d / 2);
    b.box(wall, { x: q.x, y: wy, z: q.z, sx: side, sy: o.h, sz: 0.14, yaw });
  }
  const lint = off(c, yaw, 0, o.d / 2);
  b.box(wall, { x: lint.x, y: fy + o.h - 0.25, z: lint.z, sx: doorW, sy: 0.5, sz: 0.14, yaw });
  // Dark doorway, a hanging cloth, shuttered windows.
  const door = off(c, yaw, 0, o.d / 2 - 0.12);
  b.box('wood_dark', { x: door.x, y: fy + (o.h - 0.5) / 2, z: door.z, sx: doorW, sy: o.h - 0.5, sz: 0.05, yaw }, { castShadow: false });
  const cloth = off(c, yaw, 0, o.d / 2 + 0.09);
  b.box('cloth_blue', { x: cloth.x, y: fy + o.h - 0.85, z: cloth.z, sx: doorW * 0.95, sy: 0.7, sz: 0.03, yaw }, { castShadow: false });
  if (o.windows) {
    // Paper lattice windows: one in each side wall (off(…, right) runs along yaw − π/2), two by the door.
    for (const s of [-1, 1]) paperWindow(b, off(c, yaw, s * (o.w / 2), 0), fy + o.h * 0.56, yaw - (s * Math.PI) / 2, 1.1, 0.8, o.windows);
    if (side > 1.25) {
      for (const s of [-1, 1]) paperWindow(b, off(c, yaw, s * (doorW / 2 + side / 2), o.d / 2), fy + o.h * 0.56, yaw, Math.min(1.1, side - 0.55), 0.75, o.windows);
    }
  } else {
    for (const s of [-1, 1]) {
      const q = off(c, yaw, s * (o.w / 2 + 0.08), 0);
      b.box('wood_dark', { x: q.x, y: fy + o.h * 0.58, z: q.z, sx: 0.05, sy: 0.7, sz: 1.0, yaw }, { castShadow: false });
      const f = off(c, yaw, s * (o.w / 2 + 0.11), 0);
      b.box(trim, { x: f.x, y: fy + o.h * 0.58, z: f.z, sx: 0.06, sy: 0.84, sz: 1.14, yaw }, { castShadow: false });
    }
  }
  if (o.lantern) {
    // A paper lantern on a bracket beside the door.
    const br = off(c, yaw, doorW / 2 + 0.27, o.d / 2 + 0.2);
    b.box('wood_dark', { x: br.x, y: fy + o.h - 0.3, z: br.z, sx: 0.06, sy: 0.06, sz: 0.42, yaw }, { castShadow: false });
    const lp = off(c, yaw, doorW / 2 + 0.27, o.d / 2 + 0.36);
    b.lantern(new THREE.Vector3(lp.x, fy + o.h - 0.62, lp.z), { color: o.lantern, hanging: true });
  }
  // Beams: sill and eave plates, corner posts.
  for (const yy of [fy + 0.08, fy + o.h - 0.06]) {
    for (const f of [-1, 1]) {
      const q = off(c, yaw, 0, f * (o.d / 2 + 0.04));
      b.box(trim, { x: q.x, y: yy, z: q.z, sx: o.w + 0.3, sy: 0.14, sz: 0.12, yaw });
    }
  }
  for (const r of [-1, 1]) for (const f of [-1, 1]) {
    const q = off(c, yaw, r * (o.w / 2), f * (o.d / 2));
    b.box(trim, { x: q.x, y: wy, z: q.z, sx: 0.22, sy: o.h + 0.1, sz: 0.22, yaw });
  }
  // Steep gable roof, ridge running front to back (gable ends face the street), open at the ends over
  // gable walls cut to its underside (thatch: thick, in two layers).
  const ry = fy + o.h;
  const under = gableRoof(b, o.roof, { x: o.x, y: ry, z: o.z, yaw: yaw + Math.PI / 2, w: o.d, d: o.w, height: o.roofH, overhang: 0.6, curve: 0.12, thick: o.thickRoof ? 0.3 : 0, ridge: o.thickRoof ? o.roof : trim });
  for (const f of [-1, 1]) {
    const ge = profileWallGeometry((f * o.d) / 2, o.w / 2, (z) => under(z) - 0.05, 0.16);
    b.mesh(wall, ge, { x: o.x, y: ry, z: o.z, yaw: yaw + Math.PI / 2 });
    ge.dispose();
  }
  // One collider for the body (to the eaves), so the roof stays decorative.
  b.collider({ shape: 'box', x: o.x, y: (fy + ry) / 2 + 0.3, z: o.z, hx: o.w / 2 + 0.1, hy: (ry - fy) / 2 + 0.3, hz: o.d / 2 + 0.1, yaw, walkable: true, solid: true, surface: 'wood' });
  // Stairs to the deck.
  if ((o.stairs ?? 'front') !== 'none' && o.floor > 0.25) {
    const st = o.stairs ?? 'front';
    const run = Math.max(1.2, o.floor * 1.5);
    if (st === 'front') {
      const top = off(c, yaw, o.w / 2 - 0.9, o.d / 2 + 0.2 + porchD);
      const bot = off(c, yaw, o.w / 2 - 0.9, o.d / 2 + 0.2 + porchD + run);
      b.stairs({ from: new THREE.Vector3(bot.x, o.y - 0.05, bot.z), to: new THREE.Vector3(top.x, fy, top.z), width: 1.1, material: trim, surface: 'wood' });
    } else {
      const top = off(c, yaw, o.w / 2 + 0.2, o.d / 2 - 0.8 + porchD);
      const bot = off(c, yaw, o.w / 2 + 0.2 + run, o.d / 2 - 0.8 + porchD);
      b.stairs({ from: new THREE.Vector3(bot.x, o.y - 0.05, bot.z), to: new THREE.Vector3(top.x, fy, top.z), width: 1.0, material: trim, surface: 'wood' });
    }
  }
  if (o.porch) {
    // Veranda roof on two posts.
    for (const r of [-1, 1]) {
      const q = off(c, yaw, r * (o.w / 2 - 0.15), o.d / 2 + porchD);
      b.box(trim, { x: q.x, y: fy + 1.2, z: q.z, sx: 0.16, sy: 2.4, sz: 0.16, yaw });
    }
    const pr = off(c, yaw, 0, o.d / 2 + porchD / 2 + 0.2);
    b.box(o.roof, { x: pr.x, y: fy + 2.45, z: pr.z, sx: o.w + 0.4, sy: 0.1, sz: porchD + 0.7, yaw, pitch: 0.28 });
  }
}

/** Split-rail fence along a polyline at ground height y(x, z). */
export function fence(b: ContentBuilder, pts: P2[], y: (x: number, z: number) => number, mat: Mat = 'wood'): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const L = Math.hypot(c.x - a.x, c.z - a.z);
    const n = Math.max(1, Math.round(L / 2.6));
    const yaw = Math.atan2(c.x - a.x, c.z - a.z);
    for (let k = 0; k <= n; k++) {
      if (k === n && i < pts.length - 2) continue;
      const x = a.x + ((c.x - a.x) * k) / n, z = a.z + ((c.z - a.z) * k) / n;
      b.box(mat, { x, y: y(x, z) + 0.55, z, sx: 0.14, sy: 1.1, sz: 0.14, yaw });
    }
    for (let k = 0; k < n; k++) {
      const x = a.x + ((c.x - a.x) * (k + 0.5)) / n, z = a.z + ((c.z - a.z) * (k + 0.5)) / n;
      const gy = y(x, z);
      for (const hy of [0.45, 0.85]) b.box(mat, { x, y: gy + hy, z, sx: 0.07, sy: 0.08, sz: L / n + 0.1, yaw }, { castShadow: false });
    }
  }
}

/** A barrel (optionally with a lid of fish / water). */
export function barrel(b: ContentBuilder, x: number, y: number, z: number, s = 1, collide = true): void {
  b.cylinder('wood', { x, y, z, r: 0.34 * s, rTop: 0.3 * s, h: 0.95 * s, segments: 10 }, collide ? { collide: true, solid: true } : {});
  for (const hy of [0.18, 0.75]) b.cylinder('iron', { x, y: y + hy * s, z, r: 0.35 * s, h: 0.05 * s, segments: 10 });
}

/** A fishing net hung on two poles / drying rack with fish. */
export function dryingRack(b: ContentBuilder, x: number, y: number, z: number, yaw: number, fish = true): void {
  const c = { x, z };
  for (const s of [-1, 1]) {
    const q = off(c, yaw, s * 1.6, 0);
    b.box('wood', { x: q.x, y: y + 1.05, z: q.z, sx: 0.1, sy: 2.1, sz: 0.1, yaw });
  }
  for (const hy of [1.4, 1.95]) b.box('wood', { x, y: y + hy, z, sx: 3.4, sy: 0.07, sz: 0.07, yaw }, { castShadow: false });
  if (fish) {
    for (let i = 0; i < 9; i++) {
      const q = off(c, yaw, -1.4 + i * 0.35, 0);
      b.box(i % 3 === 0 ? 'stone_grey' : 'cloth_orange', { x: q.x, y: y + 1.2 + (i % 2) * 0.55, z: q.z, sx: 0.08, sy: 0.42, sz: 0.16, yaw }, { castShadow: false });
    }
  } else {
    // A fishing net drying over the rails.
    const net = new THREE.PlaneGeometry(3.1, 1.3, 1, 1);
    b.mesh('stone_grey', net, { x, y: y + 1.25, z, yaw });
    net.dispose();
  }
}

/** Laundry line between two posts with a few cloths. */
export function laundry(b: ContentBuilder, a: P2, c: P2, y: number): void {
  const L = Math.hypot(c.x - a.x, c.z - a.z);
  const yaw = Math.atan2(c.x - a.x, c.z - a.z);
  for (const p of [a, c]) b.box('wood', { x: p.x, y: y + 1.0, z: p.z, sx: 0.09, sy: 2.0, sz: 0.09 });
  b.box('wood', { x: (a.x + c.x) / 2, y: y + 1.9, z: (a.z + c.z) / 2, sx: 0.03, sy: 0.03, sz: L, yaw }, { castShadow: false });
  const cloths: KitMaterialName[] = ['cloth_blue', 'cloth_white', 'cloth_green', 'cloth_blue', 'cloth_yellow'];
  const n = Math.max(2, Math.floor(L / 1.1));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.7) / (n + 0.4);
    const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
    b.box(cloths[i % cloths.length], { x, y: y + 1.55, z, sx: 0.02, sy: 0.65, sz: 0.62, yaw }, { castShadow: false });
  }
}
