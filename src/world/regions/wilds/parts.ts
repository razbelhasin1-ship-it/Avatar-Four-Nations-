import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceType } from '../../../core/types';
import { heightAt } from '../../Heightfield';
import { matrixFor, type ContentBuilder } from '../../kit/Builder';
import type { KitMaterialName } from '../../kit/Materials';
import { liftableSize, rockExtents } from '../../LiftableRocks';
import { SIGN_NAMES, wildsMaterial, type SignName, type WildsMat } from './materials';

/**
 * Shared parts for the wilds sites: rocks, fences, palisades, tents, fire pits,
 * boats, palms, signposts, milestones, shrines, stone arch bridges...
 * All functions add to a ContentBuilder (merged per material / instanced).
 *
 * Yaw convention (kit): local +X → (cos yaw, 0, -sin yaw), local +Z → (sin yaw, 0, cos yaw).
 */

export type Mat = KitMaterialName | THREE.Material;
type B = ContentBuilder;

export const W = (n: WildsMat): THREE.Material => wildsMaterial(n);
export const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
export const ground = (x: number, z: number): number => heightAt(x, z);

/** Yaw so that local +X points from a to b. */
export function yawAlong(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(-(bz - az), bx - ax);
}

/** Yaw so that local +Z (front) faces direction (dx, dz). */
export function yawFacing(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lowest terrain height over a disc (samples). */
export function minGround(x: number, z: number, r: number): number {
  let m = heightAt(x, z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    m = Math.min(m, heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return m;
}

/** Highest terrain height over a disc (samples). */
export function maxGround(x: number, z: number, r: number): number {
  let m = heightAt(x, z);
  for (const f of [0.5, 1]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m = Math.max(m, heightAt(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f));
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Rocks
// ---------------------------------------------------------------------------

const rockCache = new Map<number, THREE.BufferGeometry>();

/** Unit-size (±0.5) faceted boulder, 6 variants. Shared — never disposed by builders (they clone). */
export function rockGeo(variant: number): THREE.BufferGeometry {
  const v = ((variant % 6) + 6) % 6;
  let g = rockCache.get(v);
  if (g) return g;
  const base = new THREE.IcosahedronGeometry(0.5, 1);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  g = mergeVertices(base);
  base.dispose();
  const r = rng(1013 + v * 77);
  const k = [r() * 6, r() * 6, r() * 6];
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.82 + 0.3 * (0.5 + 0.5 * Math.sin(x * 7.1 + k[0]) * Math.cos(z * 6.3 + k[1]) * Math.sin(y * 5.7 + k[2]));
    let yy = y * n;
    if (yy < -0.32) yy = -0.32 - (yy + 0.32) * 0.2; // flattened base
    p.setXYZ(i, x * n, yy, z * n);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(p.count * 2);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  rockCache.set(v, g);
  return g;
}

/**
 * Boulder resting on the ground: (x, z), base at y (default terrain), size sx/sy/sz.
 * Collider: yawed box (walkable top) slightly inside the visual.
 * Rocks an earthbender can lift (ctx.world.rocks) share one instanced draw per shape and
 * material; bigger ones (cliff and cave pieces), or `liftable: false`, merge into the scenery.
 */
export function rock(b: B, mat: Mat, x: number, z: number, sx: number, sy: number, sz: number, o: { y?: number; yaw?: number; variant?: number; collide?: boolean; pitch?: number; liftable?: boolean } = {}): void {
  const y = o.y ?? heightAt(x, z) - sy * 0.12;
  const yaw = o.yaw ?? 0;
  const v = (((o.variant ?? Math.floor(Math.abs(x * 7 + z * 13)) % 6) % 6) + 6) % 6;
  // Unit rock spans y ≈ -0.33 (flattened base) .. +0.5.
  const t = { x, y: y + sy * 0.33, z, yaw, sx, sy, sz, pitch: o.pitch ?? 0 };
  const col = o.collide !== false && sx > 0.6 && sz > 0.6 ? { shape: 'box' as const, x, y: y + sy * 0.38, z, hx: sx * 0.38, hy: sy * 0.38, hz: sz * 0.38, yaw, walkable: true, solid: true, surface: 'rock' as const } : undefined;
  const m = matrixFor(t);
  const ext = rockExtents(rockGeo(v), m);
  if (o.liftable !== false && liftableSize(ext.radius, ext.halfHeight)) {
    b.rockInstance(`wild_rock_${v}_${typeof mat === 'string' ? mat : mat.uuid}`, () => rockGeo(v).clone(), mat, m, col);
    return;
  }
  b.mesh(mat, rockGeo(v), t);
  if (col) b.collider(col);
}

// ---------------------------------------------------------------------------
// Ramps, drapes
// ---------------------------------------------------------------------------

/** Walkable ramp collider between two points (feet heights at each end). */
export function rampCollider(b: B, a: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, width: number, surface: SurfaceType = 'stone', thickness = 0.6): void {
  let lo = a, hi = c;
  if (lo.y > hi.y) [lo, hi] = [hi, lo];
  const run = Math.hypot(hi.x - lo.x, hi.z - lo.z);
  const rise = hi.y - lo.y;
  const yaw = yawAlong(lo.x, lo.z, hi.x, hi.z);
  const hy = rise / 2 + thickness / 2;
  b.collider({
    shape: 'box',
    x: (lo.x + hi.x) / 2,
    y: hi.y - hy,
    z: (lo.z + hi.z) / 2,
    hx: run / 2 + 0.05,
    hy,
    hz: width / 2,
    yaw,
    slopeRise: rise > 0.01 ? rise : 0,
    walkable: true,
    solid: true,
    surface,
  });
}

/** A plane draped over the terrain (fields, paths, plazas). No collider. */
export function drape(b: B, mat: Mat, cx: number, cz: number, w: number, d: number, o: { yaw?: number; lift?: number; seg?: number; tile?: number; castShadow?: boolean } = {}): void {
  const segX = Math.max(1, Math.ceil(w / (o.seg ?? 4)));
  const segZ = Math.max(1, Math.ceil(d / (o.seg ?? 4)));
  const g = new THREE.PlaneGeometry(w, d, segX, segZ);
  g.rotateX(-Math.PI / 2);
  const yaw = o.yaw ?? 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const tile = o.tile ?? 4;
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), lz = p.getZ(i);
    const wx = cx + lx * c + lz * s;
    const wz = cz - lx * s + lz * c;
    p.setXYZ(i, wx, heightAt(wx, wz) + (o.lift ?? 0.06), wz);
    uv.setXY(i, (lx + w / 2) / tile, (lz + d / 2) / tile);
  }
  g.computeVertexNormals();
  b.mesh(mat, g, { x: 0, y: 0, z: 0 }, { castShadow: o.castShadow ?? false });
  g.dispose();
}

/** Flat disc (paving, arena floor) at height y. */
export function disc(b: B, mat: Mat, x: number, y: number, z: number, r: number, h = 0.3, segments = 32): void {
  b.cylinder(mat, { x, y: y - h, z, r, h, segments });
}

// ---------------------------------------------------------------------------
// Fences, palisades, walls
// ---------------------------------------------------------------------------

/** Wooden fence along a polyline (posts + two rails), solid. Height h. */
export function fence(b: B, pts: Array<{ x: number; z: number }>, o: { h?: number; mat?: Mat; post?: Mat; closed?: boolean } = {}): void {
  const h = o.h ?? 1.1;
  const n = o.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 0.2) continue;
    const yaw = yawAlong(a.x, a.z, c.x, c.z);
    const count = Math.max(1, Math.round(len / 2.4));
    for (let k = 0; k <= count; k++) {
      if (k === count && (o.closed || i < n - 1)) continue;
      const t = k / count;
      const px = a.x + (c.x - a.x) * t, pz = a.z + (c.z - a.z) * t;
      const gy = heightAt(px, pz);
      b.box(o.post ?? 'wood_dark', { x: px, y: gy + h / 2 - 0.1, z: pz, sx: 0.16, sy: h + 0.2, sz: 0.16, yaw });
    }
    // Rails follow the terrain between posts.
    for (let k = 0; k < count; k++) {
      const t0 = k / count, t1 = (k + 1) / count;
      const x0 = a.x + (c.x - a.x) * t0, z0 = a.z + (c.z - a.z) * t0, x1 = a.x + (c.x - a.x) * t1, z1 = a.z + (c.z - a.z) * t1;
      const y0 = heightAt(x0, z0), y1 = heightAt(x1, z1);
      const sl = Math.hypot(x1 - x0, z1 - z0);
      const roll = Math.atan2(y1 - y0, sl);
      for (const ry of [0.45, 0.85]) {
        b.box(o.mat ?? 'wood', { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + ry * h, z: (z0 + z1) / 2, sx: Math.hypot(sl, y1 - y0) + 0.1, sy: 0.08, sz: 0.06, yaw, roll });
      }
    }
    const gm = Math.min(heightAt(a.x, a.z), heightAt(c.x, c.z), heightAt((a.x + c.x) / 2, (a.z + c.z) / 2));
    const gM = Math.max(heightAt(a.x, a.z), heightAt(c.x, c.z));
    b.collider({ shape: 'box', x: (a.x + c.x) / 2, y: (gm + gM + h) / 2 - 0.2, z: (a.z + c.z) / 2, hx: len / 2, hy: (gM + h - gm) / 2 + 0.2, hz: 0.12, yaw, walkable: false, solid: true, surface: 'wood' });
  }
}

let palisadeGeo: THREE.BufferGeometry | null = null;
function makePalisadeLog(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.17, 0.2, 1, 7);
  body.translate(0, 0.5, 0);
  const tip = new THREE.ConeGeometry(0.17, 0.35, 7);
  tip.translate(0, 1.17, 0);
  const g = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])!;
  body.dispose();
  tip.dispose();
  return g;
}

/** Sharpened-log palisade along a polyline (instanced logs), solid. */
export function palisade(b: B, pts: Array<{ x: number; z: number }>, h = 3): void {
  if (!palisadeGeo) palisadeGeo = makePalisadeLog();
  const m = new THREE.Matrix4();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const count = Math.max(1, Math.round(len / 0.38));
    for (let k = 0; k <= count; k++) {
      const t = k / count;
      const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
      const hh = h * (0.85 + 0.3 * ((Math.sin(x * 12.9 + z * 7.3) + 1) / 2));
      m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(x * 3.1) * 0.04, 0, Math.cos(z * 2.7) * 0.04)), new THREE.Vector3(1, hh, 1));
      b.instance('palisade_log', () => palisadeGeo!.clone(), 'wood_dark', m);
    }
    const gm = Math.min(heightAt(a.x, a.z), heightAt(c.x, c.z));
    const yaw = yawAlong(a.x, a.z, c.x, c.z);
    b.collider({ shape: 'box', x: (a.x + c.x) / 2, y: gm + h / 2, z: (a.z + c.z) / 2, hx: len / 2, hy: h / 2 + 0.5, hz: 0.25, yaw, walkable: false, solid: true, surface: 'wood' });
  }
}

// ---------------------------------------------------------------------------
// Camp props
// ---------------------------------------------------------------------------

let tentGeo: THREE.BufferGeometry | null = null;

/** A-frame tent; (x, z) centre, front (opening) faces local +Z. */
export function tent(b: B, x: number, z: number, yaw: number, o: { w?: number; d?: number; h?: number; mat?: Mat; y?: number } = {}): void {
  if (!tentGeo) {
    tentGeo = new THREE.CylinderGeometry(1, 1, 1, 3, 1, false);
    tentGeo.rotateX(-Math.PI / 2);
    tentGeo.translate(0, 0.5, 0);
  }
  const w = o.w ?? 3, d = o.d ?? 3.6, h = o.h ?? 2.3;
  const y = o.y ?? heightAt(x, z) - 0.05;
  // Prism is along local Z after rotation; spans x ±0.866, y 0..1.5.
  b.mesh(o.mat ?? 'cloth_white', tentGeo, { x, y, z, yaw, sx: w / 1.732, sy: h / 1.5, sz: d });
  b.box('wood_dark', { x, y: y + h * 0.98, z, sx: 0.08, sy: 0.08, sz: d + 0.4, yaw });
  b.collider({ shape: 'box', x, y: y + h / 2, z, hx: w * 0.42, hy: h / 2, hz: d / 2, yaw, walkable: false, solid: true, surface: 'wood' });
}

/** Ring of stones with logs and an ember glow. Call site.addFire(x, y + 0.3, z) for flames. */
export function firePit(b: B, x: number, z: number, y = heightAt(x, z)): void {
  const m = new THREE.Matrix4();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    m.compose(new THREE.Vector3(x + Math.cos(a) * 0.95, y + 0.1, z + Math.sin(a) * 0.95), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 3), new THREE.Vector3(0.42, 0.3, 0.36));
    b.rockInstance('firepit_stone', () => rockGeo(i).clone(), 'stone_grey', m);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    b.box('wood_dark', { x: x + Math.cos(a) * 0.25, y: y + 0.18, z: z + Math.sin(a) * 0.25, sx: 1.1, sy: 0.16, sz: 0.16, yaw: a, roll: 0.25 });
  }
  b.cylinder('glow_fire', { x, y: y + 0.05, z, r: 0.42, rTop: 0.05, h: 0.5, segments: 8 });
  b.collider({ shape: 'cylinder', x, y: y + 0.2, z, r: 1.1, hy: 0.2, walkable: true, solid: false });
}

export function crate(b: B, x: number, z: number, s = 1, yaw = 0, y = heightAt(x, z)): void {
  b.box('wood', { x, y: y + s / 2, z, sx: s, sy: s, sz: s, yaw }, { collide: true, surface: 'wood' });
  b.box('wood_dark', { x, y: y + s / 2, z, sx: s * 1.02, sy: s * 0.14, sz: s * 1.02, yaw });
}

export function barrel(b: B, x: number, z: number, y = heightAt(x, z)): void {
  b.cylinder('wood_dark', { x, y, z, r: 0.42, rTop: 0.38, h: 1.05, segments: 10 }, { collide: true, surface: 'wood' });
  b.cylinder('iron', { x, y: y + 0.82, z, r: 0.4, h: 0.06, segments: 10 });
}

/** Lantern on a post standing at ground (x, y, z). */
export function lanternPost(b: B, x: number, z: number, color: 'red' | 'warm' | 'blue' = 'warm', y = heightAt(x, z)): void {
  b.lantern(v3(x, y + 2.9, z), { color, post: true });
  b.collider({ shape: 'cylinder', x, y: y + 1.3, z, r: 0.15, hy: 1.3, walkable: false, solid: true });
}

/** Cloth banner on a pole. Pole base at ground. */
export function bannerPole(b: B, x: number, z: number, yaw: number, mat: Mat, o: { h?: number; y?: number } = {}): void {
  const h = o.h ?? 5;
  const y = o.y ?? heightAt(x, z);
  b.cylinder('wood_dark', { x, y, z, r: 0.08, h: h + 0.3, segments: 6 }, { collide: true, walkable: false });
  b.box('wood_dark', { x, y: y + h, z, sx: 1.4, sy: 0.08, sz: 0.08, yaw });
  b.box(mat, { x, y: y + h - 1.4, z, sx: 1.2, sy: 2.6, sz: 0.04, yaw }, { castShadow: false });
}

// ---------------------------------------------------------------------------
// Boats
// ---------------------------------------------------------------------------

let hullGeo: THREE.BufferGeometry | null = null;

/** Boat hull along local +X, length 1, beam ~0.32, depth 0.16 (scaled by caller). */
function makeHull(): THREE.BufferGeometry {
  const N = 12;
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = 5; // deck-left, chine-left, keel, chine-right, deck-right
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = t - 0.5;
    const w = Math.pow(Math.sin(Math.PI * t), 0.7) * 0.16 + 0.002;
    const sheer = 0.16 + 0.06 * Math.pow(Math.abs(t - 0.5) * 2, 2);
    pos.push(x, sheer, -w, x, 0.04, -w * 0.7, x, 0, 0, x, 0.04, w * 0.7, x, sheer, w);
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < ring - 1; k++) {
      const a = i * ring + k, c = (i + 1) * ring + k;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  // Deck (thwart planks) as a flat surface slightly below the sheer.
  const base = pos.length / 3;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = t - 0.5;
    const w = Math.pow(Math.sin(Math.PI * t), 0.7) * 0.15;
    pos.push(x, 0.1, -w, x, 0.1, w);
  }
  for (let i = 0; i < N; i++) {
    const a = base + i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Moored boat: centre (x, z), waterline y, heading yaw (local +X = bow). Optional mast & sail. */
export function boat(b: B, x: number, y: number, z: number, yaw: number, len: number, o: { mast?: boolean; sail?: Mat; collide?: boolean } = {}): void {
  if (!hullGeo) hullGeo = makeHull();
  b.mesh(W('hull'), hullGeo, { x, y: y - len * 0.05, z, yaw, sx: len, sy: len, sz: len });
  if (o.mast) {
    const mh = len * 0.75;
    b.cylinder('wood_dark', { x, y: y + len * 0.05, z, r: 0.07 * Math.max(1, len / 6), h: mh, segments: 6 });
    // Sail: thin box across the beam, slightly aft of the mast.
    const cx = Math.cos(yaw), sz = -Math.sin(yaw);
    b.box(o.sail ?? W('sail'), { x: x - cx * len * 0.12, y: y + len * 0.05 + mh * 0.55, z: z - sz * len * 0.12, sx: len * 0.22, sy: mh * 0.75, sz: 0.04, yaw }, { castShadow: false });
  }
  if (o.collide) b.collider({ shape: 'box', x, y: y + len * 0.06, z, hx: len * 0.45, hy: len * 0.12, hz: len * 0.15, yaw, walkable: true, solid: true, surface: 'wood' });
}

// ---------------------------------------------------------------------------
// Palms
// ---------------------------------------------------------------------------

let palmSeg: THREE.BufferGeometry | null = null;
let palmFrond: THREE.BufferGeometry | null = null;
const UP = new THREE.Vector3(0, 1, 0);

function makeFrond(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(3.4, 0.9, 6, 1);
  g.translate(1.7, 0, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const taper = 1 - x / 3.6;
    p.setXYZ(i, x, -0.09 * x * x + 0.25 * x, y * taper * 0.9);
  }
  g.computeVertexNormals();
  return g;
}

/** Palm tree with a curved trunk and drooping fronds (instanced), base at ground. */
export function palm(b: B, x: number, z: number, h: number, seed: number, y = heightAt(x, z)): void {
  if (!palmSeg) {
    palmSeg = new THREE.CylinderGeometry(0.17, 0.22, 1, 7);
    palmSeg.translate(0, 0.5, 0);
  }
  if (!palmFrond) palmFrond = makeFrond();
  const r = rng(seed);
  const leanA = r() * Math.PI * 2, lean = 0.12 + r() * 0.25;
  const segs = 6;
  let px = x, py = y - 0.2, pz = z;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const dir = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const bend = lean * t * 1.6;
    dir.set(Math.cos(leanA) * bend, 1, Math.sin(leanA) * bend).normalize();
    const len = h / segs;
    q.setFromUnitVectors(UP, dir);
    const sc = 1.15 - 0.3 * (i / segs);
    m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sc, len * 1.04, sc));
    b.instance('palm_seg', () => palmSeg!.clone(), W('palm_trunk'), m);
    px += dir.x * len;
    py += dir.y * len;
    pz += dir.z * len;
  }
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r() * 0.4;
    const tilt = -0.15 - r() * 0.35;
    q.setFromEuler(new THREE.Euler(0, a, tilt, 'YXZ'));
    const s = 0.85 + r() * 0.35;
    m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(s, s, s));
    b.instance('palm_frond', () => palmFrond!.clone(), W('palm_leaf'), m, false);
  }
  // Coconut cluster.
  m.compose(new THREE.Vector3(px, py - 0.35, pz), q.identity(), new THREE.Vector3(0.5, 0.4, 0.5));
  b.instance('palm_nuts', () => new THREE.IcosahedronGeometry(0.6, 0), 'wood_dark', m, false);
  b.collider({ shape: 'cylinder', x, y: y + 1.5, z, r: 0.3, hy: 1.5, walkable: false, solid: true, surface: 'wood' });
}

// ---------------------------------------------------------------------------
// Roadside: signposts, milestones, shrines
// ---------------------------------------------------------------------------

/** Board with text from the sign atlas on both faces. */
function signBoard(name: SignName): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const rows = SIGN_NAMES.length + 1;
  const row = SIGN_NAMES.indexOf(name) + 1;
  // Canvas row 0 is the top; texture v=1 is the top.
  const v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (f === 4 || f === 5) uv.setXY(i, uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
      else uv.setXY(i, 0.02 + uv.getX(i) * 0.05, 0.97 + uv.getY(i) * 0.02);
    }
  }
  return g;
}

/** Signpost with arms pointing toward destinations (dir = world direction yaw of travel). */
export function signpost(b: B, x: number, z: number, arms: Array<{ name: SignName; toward: { x: number; z: number } }>, y = heightAt(x, z)): void {
  b.cylinder('wood_dark', { x, y: y - 0.3, z, r: 0.12, h: 3.6, segments: 8 }, { collide: true, walkable: false });
  b.cylinder('wood_dark', { x, y: y + 3.3, z, r: 0.18, rTop: 0.02, h: 0.35, segments: 8 });
  arms.forEach((a, i) => {
    const dx = a.toward.x - x, dz = a.toward.z - z;
    const yaw = Math.atan2(-dz, dx); // local +X toward destination
    const len = 2.3;
    const cx = Math.cos(yaw), sz = -Math.sin(yaw);
    const g = signBoard(a.name);
    b.mesh(W('sign'), g, { x: x + cx * (len / 2 + 0.1), y: y + 2.85 - i * 0.52, z: z + sz * (len / 2 + 0.1), yaw, sx: len, sy: 0.42, sz: 0.06 });
    g.dispose();
  });
}

/** Small carved mile stone. */
export function milestone(b: B, x: number, z: number, yaw: number, y = heightAt(x, z)): void {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.15, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1));
  b.instance('milestone', () => {
    const body = new THREE.BoxGeometry(0.5, 1.1, 0.32);
    body.translate(0, 0.55, 0);
    const cap = new THREE.CylinderGeometry(0.02, 0.36, 0.3, 4);
    cap.rotateY(Math.PI / 4);
    cap.translate(0, 1.25, 0);
    const g = mergeGeometries([body.toNonIndexed(), cap.toNonIndexed()])!;
    body.dispose();
    cap.dispose();
    return g;
  }, 'stone_light', m);
  b.collider({ shape: 'box', x, y: y + 0.5, z, hx: 0.25, hy: 0.6, hz: 0.16, yaw, walkable: true, solid: true });
}

/** Roadside shrine: stone base, small roofed altar, lanterns and offerings. Front faces local +Z. */
export function roadShrine(b: B, x: number, z: number, yaw: number, o: { roof?: Mat; y?: number } = {}): void {
  const y = o.y ?? heightAt(x, z);
  b.block('stone_grey', { x, y: y - 0.3, z, sx: 2.6, sy: 0.75, sz: 2, yaw }, { collide: true });
  b.block('stone_light', { x, y: y + 0.45, z, sx: 1.4, sy: 1.1, sz: 1, yaw }, { collide: true });
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  b.box('black_lacquer', { x: x + fx * 0.48, y: y + 1, z: z + fz * 0.48, sx: 0.7, sy: 0.6, sz: 0.06, yaw });
  b.box('gold', { x: x + fx * 0.52, y: y + 1.05, z: z + fz * 0.52, sx: 0.22, sy: 0.22, sz: 0.04, yaw }, { castShadow: false });
  for (const s of [-1, 1]) {
    const cx = Math.cos(yaw), sz = -Math.sin(yaw);
    b.box('wood_red', { x: x + cx * s * 0.62, y: y + 1.1, z: z + sz * s * 0.62, sx: 0.12, sy: 1.3, sz: 0.12, yaw });
    b.lantern(v3(x + cx * s * 1.05 + fx * 0.75, y + 0.75, z + sz * s * 1.05 + fz * 0.75), { color: 'red' });
  }
  b.roof(o.roof ?? 'roof_green', { x, y: y + 1.75, z, w: 1.5, d: 1.1, height: 0.55, yaw, overhang: 0.35, style: 'hip' });
  b.cylinder('bronze', { x: x + fx * 0.75, y: y + 0.45, z: z + fz * 0.75, r: 0.18, rTop: 0.22, h: 0.18, segments: 10 });
}

// ---------------------------------------------------------------------------
// Earth Kingdom buildings
// ---------------------------------------------------------------------------

/** Earth Kingdom house: stone base course, plaster upper walls, wood trim, tiled roof. Front faces local +Z. */
export function ekHouse(b: B, x: number, z: number, yaw: number, o: { w?: number; d?: number; floors?: number; y?: number; wall?: Mat; roof?: Mat; base?: Mat; roofStyle?: 'hip' | 'gable' | 'pagoda' }): void {
  const w = o.w ?? 7, d = o.d ?? 6, floors = o.floors ?? 1;
  const y = o.y ?? minGround(x, z, Math.max(w, d) * 0.5);
  const h = 3.2 * floors;
  b.block(o.base ?? 'stone_grey', { x, y: y - 0.4, z, sx: w + 0.3, sy: 1.5, sz: d + 0.3, yaw });
  b.building({ x, y: y + 1.1, z, w, d, h: h - 1.1, yaw, wall: o.wall ?? 'plaster_cream', roof: o.roof ?? 'roof_green', trim: 'wood_dark', roofStyle: o.roofStyle ?? 'hip', floors, plinth: null, roofHeight: Math.min(w, d) * 0.42 });
  // Base collider (building() adds the main collider from y+1.1).
  b.collider({ shape: 'box', x, y: y + 0.35, z, hx: w / 2 + 0.15, hy: 0.75, hz: d / 2 + 0.15, yaw, walkable: true, solid: true, surface: 'stone' });
}

/** Adobe house (desert): rounded-ish block, flat roof with parapet, dark doorway. Front faces local +Z. */
export function adobeHouse(b: B, x: number, z: number, yaw: number, o: { w?: number; d?: number; h?: number; y?: number; dome?: boolean } = {}): void {
  const w = o.w ?? 6, d = o.d ?? 5, h = o.h ?? 3.4;
  const y = o.y ?? minGround(x, z, Math.max(w, d) * 0.5) - 0.1;
  const A = W('adobe');
  b.block(A, { x, y, z, sx: w, sy: h, sz: d, yaw }, { collide: true, surface: 'plaster' });
  b.block(A, { x, y: y + h, z, sx: w + 0.3, sy: 0.35, sz: d + 0.3, yaw });
  const fx = Math.sin(yaw), fz = Math.cos(yaw), cx = Math.cos(yaw), sz = -Math.sin(yaw);
  for (const s of [-1, 1]) b.block(A, { x: x + cx * s * (w / 2), y: y + h + 0.35, z: z + sz * s * (w / 2), sx: 0.3, sy: 0.5, sz: d + 0.3, yaw });
  b.box(W('dark'), { x: x + fx * (d / 2 + 0.01), y: y + 1.1, z: z + fz * (d / 2 + 0.01), sx: 1.1, sy: 2.1, sz: 0.04, yaw });
  for (const s of [-1, 1]) b.box(W('dark'), { x: x + fx * (d / 2 + 0.01) + cx * s * (w * 0.3), y: y + 2.2, z: z + fz * (d / 2 + 0.01) + sz * s * (w * 0.3), sx: 0.6, sy: 0.5, sz: 0.04, yaw });
  // Roof beams poking out of the facade.
  for (let k = -2; k <= 2; k++) b.box('wood_dark', { x: x + cx * k * (w / 5) + fx * (d / 2 + 0.2), y: y + h - 0.35, z: z + sz * k * (w / 5) + fz * (d / 2 + 0.2), sx: 0.14, sy: 0.14, sz: 0.6, yaw });
  if (o.dome) b.mesh(A, new THREE.SphereGeometry(Math.min(w, d) * 0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), { x, y: y + h + 0.2, z });
}

// ---------------------------------------------------------------------------
// Stone arch bridge
// ---------------------------------------------------------------------------

/**
 * Stone arch bridge from a to c (deck top heights in .y) with a parabolic hump.
 * Deck + parapets + walkable ramp colliders come from kit bridge(); spandrel
 * walls with arch openings and piers are added between them. `waterY` is the
 * water surface under the bridge, `nArches` the number of spans.
 */
export function stoneArchBridge(b: B, a: THREE.Vector3, c: THREE.Vector3, o: { width: number; hump: number; waterY: number; nArches: number; deck?: Mat; wall?: Mat; rail?: Mat }): void {
  const wall = o.wall ?? 'stone_tan';
  b.bridge({ a, b: c, width: o.width, deck: o.deck ?? 'paving', rail: o.rail ?? wall, support: null, arch: o.hump, surface: 'stone' });
  const len = Math.hypot(c.x - a.x, c.z - a.z);
  const yaw = yawAlong(a.x, a.z, c.x, c.z);
  const deckY = (t: number) => a.y + (c.y - a.y) * t + o.hump * 4 * t * (1 - t);
  const bottom = o.waterY - 4;
  const spring = o.waterY + 0.4;
  const n = o.nArches;
  const cxv = Math.cos(yaw), czv = -Math.sin(yaw);
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const s0 = t0 * len, s1 = t1 * len;
    const shape = new THREE.Shape();
    shape.moveTo(s0, bottom);
    shape.lineTo(s1, bottom);
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const t = t1 - (t1 - t0) * (i / steps);
      shape.lineTo(t * len, deckY(t) - 0.38);
    }
    shape.lineTo(s0, bottom);
    const span = s1 - s0;
    const minDeck = Math.min(deckY(t0), deckY(t1), deckY((t0 + t1) / 2)) - 0.38;
    const pierW = Math.min(2.2, span * 0.18);
    const openHalf = span / 2 - pierW / 2;
    const rise = Math.min(openHalf, minDeck - 0.9 - spring);
    if (rise > 0.8 && openHalf > 1) {
      const hole = new THREE.Path();
      const mid = (s0 + s1) / 2;
      hole.moveTo(mid - openHalf, bottom + 0.6);
      hole.lineTo(mid - openHalf, spring);
      hole.absellipse(mid, spring, openHalf, rise, Math.PI, 0, true, 0);
      hole.lineTo(mid + openHalf, bottom + 0.6);
      hole.lineTo(mid - openHalf, bottom + 0.6);
      shape.holes.push(hole);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: o.width - 0.3, bevelEnabled: false, curveSegments: 14 });
    geo.translate(0, 0, -(o.width - 0.3) / 2);
    b.mesh(wall, geo, { x: a.x, y: 0, z: a.z, yaw });
    geo.dispose();
    // Pier colliders (solid, under the deck) at each span boundary inside the bridge.
    if (k > 0) {
      const t = t0;
      const px = a.x + cxv * len * t, pz = a.z + czv * len * t;
      const top = deckY(t) - 1.2;
      if (top > bottom + 1) b.collider({ shape: 'box', x: px, y: (top + bottom) / 2, z: pz, hx: pierW / 2, hy: (top - bottom) / 2, hz: o.width / 2, yaw, walkable: false, solid: true, surface: 'stone' });
      // Cutwater on the pier faces.
      for (const side of [-1, 1]) {
        const nx = -czv * side, nz = cxv * side;
        b.box(wall, { x: px + nx * (o.width / 2 + 0.3), y: (spring + bottom) / 2 + 0.6, z: pz + nz * (o.width / 2 + 0.3), sx: pierW * 0.7, sy: spring - bottom + 1.2, sz: 0.9, yaw });
      }
    }
  }
}
