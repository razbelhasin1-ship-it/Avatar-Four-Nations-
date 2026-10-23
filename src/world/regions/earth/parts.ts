import * as THREE from 'three';
import type { Random } from '../../../core/Random';
import { ContentBuilder, roofGeometry } from '../../kit/Builder';
import type { KitMaterialName } from '../../kit/Materials';
import type { EarthMaterials } from './materials';

/**
 * Reusable Earth Kingdom props. Repeated small things go through
 * ContentBuilder.instance() (one InstancedMesh per key per chunk); unique
 * pieces are merged per material. Colliders are added only where a player
 * could otherwise walk through something solid.
 */

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export function mat4(x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx, pitch = 0, roll = 0): THREE.Matrix4 {
  tmpE.set(pitch, yaw, roll, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpS.set(sx, sy, sz);
  tmpP.set(x, y, z);
  return tmpM.compose(tmpP, tmpQ, tmpS).clone();
}

// ---------------------------------------------------------------------------
// Vegetation
// ---------------------------------------------------------------------------

function canopyGeometry(kind: 'round' | 'blossom' | 'bush'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blobs: Array<[number, number, number, number]> =
    kind === 'bush'
      ? [[0, 0.5, 0, 0.8], [0.5, 0.4, 0.2, 0.55], [-0.4, 0.35, -0.2, 0.5]]
      : [[0, 3.6, 0, 1.9], [1.1, 3.1, 0.4, 1.3], [-1.0, 3.2, -0.5, 1.35], [0.2, 4.4, -0.3, 1.2]];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1, 0.82, 1);
    g.translate(x, y, z);
    parts.push(g);
  }
  return mergeAll(parts);
}

function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers: Array<[number, number, number]> = [[1.8, 2.6, 2.0], [1.4, 4.0, 1.8], [1.0, 5.3, 1.6], [0.6, 6.4, 1.3]];
  for (const [r, y, h] of tiers) {
    const g = new THREE.ConeGeometry(r, h, 7);
    g.translate(0, y, 0);
    parts.push(g);
  }
  return mergeAll(parts);
}

function cypressGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 7, 6);
  g.scale(0.9, 3.4, 0.9);
  g.translate(0, 4.2, 0);
  return g;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small local merge (avoids importing addons here).
  let nv = 0, ni = 0;
  for (const p of parts) {
    const q = p.index ? p : p.toNonIndexed();
    nv += q.getAttribute('position').count;
    ni += q.index ? q.index.count : q.getAttribute('position').count;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), idx: number[] = [];
  let vo = 0;
  for (const p of parts) {
    const pa = p.getAttribute('position') as THREE.BufferAttribute;
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    const na = p.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      pos.set([pa.getX(i), pa.getY(i), pa.getZ(i)], (vo + i) * 3);
      nrm.set([na.getX(i), na.getY(i), na.getZ(i)], (vo + i) * 3);
    }
    if (p.index) for (let i = 0; i < p.index.count; i++) idx.push(p.index.getX(i) + vo);
    else for (let i = 0; i < pa.count; i++) idx.push(vo + i);
    vo += pa.count;
    p.dispose();
  }
  void ni;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
  g.setIndex(idx);
  return g;
}

export type TreeKind = 'round' | 'pine' | 'blossom' | 'bush' | 'cypress';

/** Stylised tree (instanced). Trunks get a thin collider so players don't walk through. */
export function tree(b: ContentBuilder, m: EarthMaterials, x: number, y: number, z: number, s: number, kind: TreeKind, rot: number, collide = true): void {
  const trunkH = kind === 'bush' ? 0 : kind === 'pine' ? 2.2 : kind === 'cypress' ? 1.4 : 2.8;
  if (trunkH > 0) {
    b.instance('tree_trunk', () => {
      const g = new THREE.CylinderGeometry(0.16, 0.28, 1, 6);
      g.translate(0, 0.5, 0);
      return g;
    }, m.bark, mat4(x, y, z, rot, s, trunkH * s, s));
    if (collide) b.collider({ shape: 'cylinder', x, y: y + 1.5, z, r: 0.35 * s, hy: 1.5, walkable: false, solid: true });
  }
  const mat = kind === 'blossom' ? m.blossom : kind === 'pine' || kind === 'cypress' ? m.leafDark : kind === 'bush' ? m.hedge : rot > 3 ? m.leafLight : m.leaf;
  const key = kind === 'blossom' ? 'tree_canopy_blossom' : kind === 'pine' ? 'tree_pine' : kind === 'cypress' ? 'tree_cypress' : kind === 'bush' ? 'tree_bush' : rot > 3 ? 'tree_canopy_light' : 'tree_canopy';
  const factory = kind === 'pine' ? pineGeometry : kind === 'cypress' ? cypressGeometry : () => canopyGeometry(kind === 'bush' ? 'bush' : kind === 'blossom' ? 'blossom' : 'round');
  b.instance(key, factory, mat, mat4(x, y, z, rot, s, s, s));
}

// ---------------------------------------------------------------------------
// Street furniture
// ---------------------------------------------------------------------------

/** Lantern on a wooden post (kit lantern instancing). */
export function lanternPost(b: ContentBuilder, x: number, y: number, z: number, color: 'red' | 'warm' = 'red'): void {
  b.lantern(new THREE.Vector3(x, y + 2.75, z), { color, post: true });
  b.box('wood_dark', { x, y: y + 3.05, z, sx: 0.5, sy: 0.08, sz: 0.5 });
}

/** Stone garden lantern (toro). */
export function stoneLantern(b: ContentBuilder, x: number, y: number, z: number, s = 1): void {
  b.cylinder('stone_grey', { x, y, z, r: 0.35 * s, h: 0.25 * s, segments: 6 });
  b.cylinder('stone_grey', { x, y: y + 0.25 * s, z, r: 0.13 * s, h: 0.75 * s, segments: 6 });
  b.box('stone_grey', { x, y: y + 1.12 * s, z, sx: 0.55 * s, sy: 0.24 * s, sz: 0.55 * s });
  b.box('lantern_warm', { x, y: y + 1.36 * s, z, sx: 0.32 * s, sy: 0.26 * s, sz: 0.32 * s }, { castShadow: false });
  b.cylinder('stone_grey', { x, y: y + 1.49 * s, z, r: 0.48 * s, rTop: 0.06 * s, h: 0.32 * s, segments: 6 });
  b.collider({ shape: 'cylinder', x, y: y + 0.8 * s, z, r: 0.35 * s, hy: 0.8 * s, walkable: false, solid: true });
}

/** A string of lanterns between two points with a sagging rope. */
export function lanternString(b: ContentBuilder, m: EarthMaterials, a: THREE.Vector3, c: THREE.Vector3, sag: number, count: number, color: 'red' | 'warm' = 'red'): void {
  const seg = 8;
  let prev = a.clone();
  for (let i = 1; i <= seg; i++) {
    const t = i / seg;
    const p = a.clone().lerp(c, t);
    p.y -= sag * 4 * t * (1 - t);
    rope(b, m, prev, p);
    prev = p;
  }
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const p = a.clone().lerp(c, t);
    p.y -= sag * 4 * t * (1 - t) + 0.35;
    b.instance(`lantern_${color}`, () => new THREE.CylinderGeometry(0.22, 0.26, 0.55, 10), color === 'red' ? 'lantern_red' : 'lantern_warm', mat4(p.x, p.y, p.z), false);
  }
}

/** Thin rope segment between two points. */
export function rope(b: ContentBuilder, m: EarthMaterials, a: THREE.Vector3, c: THREE.Vector3, thick = 0.035): void {
  const d = c.clone().sub(a);
  const len = d.length();
  if (len < 0.01) return;
  const mid = a.clone().add(c).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const mm = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(thick, len, thick));
  b.instance('rope', () => new THREE.CylinderGeometry(1, 1, 1, 4), m.rope, mm, false);
}

/** Laundry line with hanging cloths between two anchor points. */
export function laundry(b: ContentBuilder, m: EarthMaterials, a: THREE.Vector3, c: THREE.Vector3, rnd: Random): void {
  const sag = 0.35;
  lanternString(b, m, a, c, sag, 0);
  const n = Math.max(2, Math.floor(a.distanceTo(c) / 1.1));
  const cloths: KitMaterialName[] = ['cloth_white', 'cloth_green', 'cloth_yellow', 'cloth_white', 'cloth_blue', 'cloth_red', 'cloth_orange'];
  const yaw = Math.atan2(-(c.z - a.z), c.x - a.x);
  for (let i = 1; i < n; i++) {
    if (rnd.chance(0.25)) continue;
    const t = i / n;
    const p = a.clone().lerp(c, t);
    p.y -= sag * 4 * t * (1 - t);
    const w = rnd.range(0.45, 0.8), h = rnd.range(0.55, 1.0);
    b.box(rnd.pick(cloths), { x: p.x, y: p.y - h / 2 - 0.02, z: p.z, sx: w, sy: h, sz: 0.03, yaw }, { castShadow: false });
  }
}

/** Market stall: counter, posts, sloped cloth awning and goods. */
export function marketStall(b: ContentBuilder, x: number, y: number, z: number, yaw: number, awning: KitMaterialName, rnd: Random, w = 3.2, d = 2): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx: number, lz: number) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
  // Counter
  const ctr = P(0, d * 0.25);
  b.box('wood', { x: ctr.x, y: y + 0.5, z: ctr.z, sx: w, sy: 1, sz: 0.7, yaw });
  b.box('wood_dark', { x: ctr.x, y: y + 1.03, z: ctr.z, sx: w + 0.1, sy: 0.07, sz: 0.8, yaw });
  // Posts
  for (const lx of [-w / 2, w / 2]) for (const lz of [-d / 2, d / 2]) {
    const p = P(lx, lz);
    b.box('wood_dark', { x: p.x, y: y + (lz < 0 ? 1.4 : 1.15), z: p.z, sx: 0.1, sy: lz < 0 ? 2.8 : 2.3, sz: 0.1, yaw });
  }
  // Awning (slopes toward the front, +Z local)
  const aw = P(0, 0);
  b.box(awning, { x: aw.x, y: y + 2.55, z: aw.z, sx: w + 0.5, sy: 0.05, sz: d + 0.6, yaw, pitch: 0.24 }, { castShadow: true });
  // Goods on the counter
  const goods: KitMaterialName[] = ['cloth_yellow', 'jade', 'cloth_red', 'bronze', 'cloth_orange', 'cloth_green', 'gold'];
  for (let i = 0; i < 5; i++) {
    const g = P(-w / 2 + 0.35 + i * ((w - 0.7) / 4), d * 0.25 + rnd.range(-0.15, 0.15));
    const sz = rnd.range(0.18, 0.32);
    b.box(rnd.pick(goods), { x: g.x, y: y + 1.07 + sz / 2, z: g.z, sx: sz, sy: sz, sz: sz, yaw: rnd.range(0, 1) });
  }
  // Baskets / crates behind
  for (let i = 0; i < 2; i++) {
    const p = P(rnd.range(-w / 2 + 0.4, w / 2 - 0.4), -d / 2 + 0.35);
    b.cylinder('wood', { x: p.x, y, z: p.z, r: 0.28, rTop: 0.34, h: 0.45, segments: 8 });
  }
  const col = P(0, 0);
  b.collider({ shape: 'box', x: col.x, y: y + 0.6, z: col.z, hx: w / 2 + 0.05, hz: d / 2 + 0.05, hy: 0.6, yaw, walkable: true, solid: true, surface: 'wood' });
}

/** Barrels and crates cluster (instanced). */
export function crates(b: ContentBuilder, x: number, y: number, z: number, rnd: Random, n = 3): void {
  for (let i = 0; i < n; i++) {
    const ox = x + rnd.range(-0.9, 0.9), oz = z + rnd.range(-0.9, 0.9);
    if (rnd.chance(0.5)) {
      b.instance('barrel', () => {
        const g = new THREE.CylinderGeometry(0.32, 0.32, 0.85, 10);
        g.translate(0, 0.425, 0);
        return g;
      }, 'wood', mat4(ox, y, oz, rnd.range(0, 3)));
    } else {
      const s = rnd.range(0.5, 0.8);
      b.instance('crate', () => {
        const g = new THREE.BoxGeometry(1, 1, 1);
        g.translate(0, 0.5, 0);
        return g;
      }, 'wood', mat4(ox, y, oz, rnd.range(0, 3), s));
    }
  }
}

/** Potted plant / small shrub in a stone planter. */
export function planter(b: ContentBuilder, m: EarthMaterials, x: number, y: number, z: number, s = 1): void {
  b.instance('planter', () => {
    const g = new THREE.CylinderGeometry(0.42, 0.32, 0.55, 8);
    g.translate(0, 0.275, 0);
    return g;
  }, 'stone_grey', mat4(x, y, z, 0, s));
  tree(b, m, x, y + 0.4 * s, z, 0.6 * s, 'bush', x + z, false);
}

/** Flag/banner pole with a hanging Earth Kingdom banner. */
export function bannerPole(b: ContentBuilder, m: EarthMaterials, x: number, y: number, z: number, yaw: number, h = 7): void {
  b.cylinder('wood_dark', { x, y, z, r: 0.12, h, segments: 6 }, { collide: true, walkable: false });
  b.box('gold', { x, y: y + h + 0.1, z, sx: 0.25, sy: 0.25, sz: 0.25 });
  const c = Math.cos(yaw), s = Math.sin(yaw);
  b.box('wood_dark', { x: x + c * 0.7, y: y + h - 0.3, z: z - s * 0.7, sx: 1.6, sy: 0.08, sz: 0.08, yaw });
  hangingBanner(b, m, x + c * 0.75, y + h - 0.35, z - s * 0.75, yaw, 1.3, 3.2);
}

/** A flat cloth banner hanging down from (x, top, z), facing yaw. */
export function hangingBanner(b: ContentBuilder, m: EarthMaterials, x: number, top: number, z: number, yaw: number, w: number, h: number): void {
  const g = new THREE.PlaneGeometry(w, h);
  b.mesh(m.banner, g, { x, y: top - h / 2, z, yaw: yaw + Math.PI / 2 }, { castShadow: false });
  g.dispose();
}

/** Emblem plaque (disc) facing yaw (local +Z). */
export function plaque(b: ContentBuilder, m: EarthMaterials, x: number, y: number, z: number, yaw: number, r: number): void {
  const g = new THREE.CircleGeometry(r, 24);
  b.mesh(m.plaque, g, { x, y, z, yaw });
  g.dispose();
  const ring = new THREE.TorusGeometry(r, r * 0.08, 6, 24);
  b.mesh('gold', ring, { x, y, z, yaw });
  ring.dispose();
}

/** Ceremonial gateway (paifang): pillars, beams and a curved roof. */
export function paifang(b: ContentBuilder, x: number, y: number, z: number, yaw: number, width: number, height: number, o: { pillar?: KitMaterialName; roof?: KitMaterialName; posts?: number } = {}): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const posts = o.posts ?? 2;
  for (let i = 0; i < posts; i++) {
    const lx = -width / 2 + (i * width) / (posts - 1);
    const px = x + lx * c, pz = z - lx * s;
    const h = i === 0 || i === posts - 1 ? height : height * 0.85;
    b.box(o.pillar ?? 'wood_red', { x: px, y: y + h / 2, z: pz, sx: 0.55, sy: h, sz: 0.55, yaw }, { collide: true, walkable: false });
    b.box('stone_grey', { x: px, y: y + 0.35, z: pz, sx: 0.9, sy: 0.7, sz: 0.9, yaw }, { collide: true, walkable: false });
  }
  b.box('wood_dark', { x, y: y + height - 0.3, z, sx: width + 1.4, sy: 0.4, sz: 0.5, yaw });
  b.box(o.pillar ?? 'wood_red', { x, y: y + height - 1.2, z, sx: width + 0.4, sy: 0.3, sz: 0.4, yaw });
  b.box('jade', { x, y: y + height - 0.75, z, sx: width * 0.4, sy: 0.6, sz: 0.3, yaw });
  b.roof(o.roof ?? 'roof_green', { x, y: y + height - 0.1, z, w: width + 1.2, d: 1.2, height: 0.9, yaw, overhang: 0.5, style: 'hip', curve: 0.5 });
}

/** Open pavilion (columns + roof + raised floor). Walkable floor. */
export function pavilion(b: ContentBuilder, x: number, y: number, z: number, w: number, d: number, h: number, yaw: number, roof: KitMaterialName = 'roof_green', tiers = 1): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  b.block('stone_light', { x, y, z, sx: w + 1, sy: 0.5, sz: d + 1, yaw }, { collide: true, surface: 'stone' });
  for (const lx of [-w / 2, w / 2]) for (const lz of [-d / 2, d / 2]) {
    const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
    b.cylinder('wood_red', { x: px, y: y + 0.5, z: pz, r: 0.18, h: h, segments: 8 }, { collide: true, walkable: false });
  }
  b.box('wood_dark', { x, y: y + 0.5 + h - 0.2, z, sx: w + 0.4, sy: 0.35, sz: d + 0.4, yaw });
  let ry = y + 0.5 + h;
  let rw = w, rd = d;
  for (let t = 0; t < tiers; t++) {
    b.roof(roof, { x, y: ry, z, w: rw, d: rd, height: Math.min(rw, rd) * 0.45, yaw, overhang: 0.9, style: t === tiers - 1 ? 'hip' : 'hip', curve: 0.6 });
    ry += Math.min(rw, rd) * 0.45 + 0.6;
    rw *= 0.62;
    rd *= 0.62;
    if (t < tiers - 1) b.block('wood_red', { x, y: ry - 0.6 - Math.min(rw, rd) * 0.2, z, sx: rw, sy: 1.2, sz: rd, yaw });
  }
}

/** Guardian statue (stylised badgermole / lion-dog on a plinth). Solid. */
export function guardianStatue(b: ContentBuilder, x: number, y: number, z: number, yaw: number, s = 1, mat: KitMaterialName = 'stone_grey'): void {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const L = (lx: number, ly: number, lz: number) => ({ x: x + lx * c + lz * sn, y: y + ly, z: z - lx * sn + lz * c });
  b.block('stone_dark', { x, y, z, sx: 2.2 * s, sy: 1.4 * s, sz: 3.0 * s, yaw }, { collide: true, walkable: true });
  const top = 1.4 * s;
  // Body
  const body = L(0, top + 1.0 * s, -0.2 * s);
  b.box(mat, { x: body.x, y: body.y, z: body.z, sx: 1.4 * s, sy: 1.5 * s, sz: 2.2 * s, yaw });
  // Head
  const head = L(0, top + 2.15 * s, 0.85 * s);
  b.box(mat, { x: head.x, y: head.y, z: head.z, sx: 1.25 * s, sy: 1.05 * s, sz: 1.0 * s, yaw });
  const snout = L(0, top + 1.95 * s, 1.45 * s);
  b.box(mat, { x: snout.x, y: snout.y, z: snout.z, sx: 0.8 * s, sy: 0.55 * s, sz: 0.5 * s, yaw });
  // Claws / front legs
  for (const side of [-1, 1]) {
    const leg = L(side * 0.5 * s, top + 0.45 * s, 0.75 * s);
    b.box(mat, { x: leg.x, y: leg.y, z: leg.z, sx: 0.45 * s, sy: 0.9 * s, sz: 0.55 * s, yaw });
    const claw = L(side * 0.5 * s, top + 0.1 * s, 1.1 * s);
    b.box('stone_light', { x: claw.x, y: claw.y, z: claw.z, sx: 0.6 * s, sy: 0.2 * s, sz: 0.4 * s, yaw });
    const ear = L(side * 0.5 * s, top + 2.8 * s, 0.7 * s);
    b.box(mat, { x: ear.x, y: ear.y, z: ear.z, sx: 0.25 * s, sy: 0.35 * s, sz: 0.2 * s, yaw });
  }
}

/** Standing figure statue (Earth King / sage) on a pedestal. */
export function figureStatue(b: ContentBuilder, x: number, y: number, z: number, yaw: number, s = 1, mat: KitMaterialName = 'bronze'): void {
  b.block('stone_light', { x, y, z, sx: 3 * s, sy: 2 * s, sz: 3 * s, yaw }, { collide: true, walkable: true });
  const top = y + 2 * s;
  b.cylinder(mat, { x, y: top, z, r: 0.9 * s, rTop: 0.55 * s, h: 2.6 * s, segments: 10 });
  b.cylinder(mat, { x, y: top + 2.6 * s, z, r: 0.5 * s, rTop: 0.62 * s, h: 0.9 * s, segments: 10 });
  b.cylinder(mat, { x, y: top + 3.45 * s, z, r: 0.38 * s, rTop: 0.34 * s, h: 0.7 * s, segments: 10 });
  b.box(mat, { x, y: top + 4.3 * s, z, sx: 0.5 * s, sy: 0.35 * s, sz: 0.3 * s, yaw });
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (const side of [-1, 1]) {
    b.box(mat, { x: x + side * 0.62 * s * c, y: top + 2.6 * s, z: z - side * 0.62 * s * sn, sx: 0.3 * s, sy: 1.6 * s, sz: 0.35 * s, yaw, roll: side * 0.15 });
  }
}

/** Round fountain with a spout; registers a finite water source. */
export function fountain(b: ContentBuilder, x: number, y: number, z: number, r: number, o: { id: string; label: string; capacity?: number; regen?: number; spout?: boolean; type?: 'fountain' | 'pond' }): void {
  const rimH = 0.6;
  const segs = 14;
  // Rim: ring of stone blocks with colliders (inside stays open).
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const len = 2 * Math.PI * r / segs + 0.12;
    const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
    // Long axis tangent to the circle: local +X → (cos yaw, -sin yaw) = (-sin a, cos a).
    const yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
    b.box('stone_light', { x: cx, y: y + rimH / 2, z: cz, sx: len, sy: rimH, sz: 0.55, yaw }, { collide: true, walkable: true });
  }
  // Basin floor (dark stone) slightly above ground to avoid z-fighting.
  b.cylinder('stone_dark', { x, y: y + 0.01, z, r: r - 0.2, h: 0.06, segments: 24 });
  b.waterSurface({ id: o.id, label: o.label, x, z, y: y + rimH - 0.12, w: (r - 0.25) * 2, d: (r - 0.25) * 2, circle: true, capacity: o.capacity ?? 70, regen: o.regen ?? 1.5, type: o.type ?? 'fountain' });
  if (o.spout !== false) {
    b.cylinder('stone_light', { x, y, z, r: 0.45, h: 1.6, segments: 10 }, { collide: true, walkable: false });
    b.cylinder('stone_light', { x, y: y + 1.6, z, r: 0.9, rTop: 0.4, h: 0.35, segments: 12 });
    b.cylinder('stone_light', { x, y: y + 1.95, z, r: 0.18, h: 0.7, segments: 8 });
    b.box('jade', { x, y: y + 2.75, z, sx: 0.35, sy: 0.35, sz: 0.35, yaw: 0.78 });
  }
}

/** A roofed station/hall roof helper using the kit roof geometry directly. */
export function roofOnly(b: ContentBuilder, mat: KitMaterialName, x: number, y: number, z: number, w: number, d: number, h: number, yaw = 0, style: 'hip' | 'gable' | 'pagoda' = 'hip', curve = 0.5): void {
  const g = roofGeometry(w, d, h, style, curve);
  b.mesh(mat, g, { x, y, z, yaw });
  g.dispose();
}
