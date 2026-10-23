import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import type { KitMaterialName } from '../../kit/Materials';
import type { P2 } from '../../WorldLayout';
import type { ChunkSet } from './chunks';
import { archBlockGeometry } from './geom';
import type { EarthMaterials } from './materials';
import { hangingBanner, plaque } from './parts';

/**
 * City walls: battered crenellated wall loops with walkable tops, monumental
 * arched gatehouses with gate-tower halls, and wall stairs. Everything here is
 * 'major' (visible from afar). Colliders:
 *   - wall body: solid, not walkable (covers the battered base)
 *   - walkway: walkable slab at the top
 *   - parapets: solid strips along both edges (with gaps at stair landings)
 */

export interface WallStyle {
  height: number;
  thick: number;
  batterOut: number;
  batterIn: number;
  body: KitMaterialName;
  trim: KitMaterialName;
  band?: KitMaterialName;
  bands?: number[];
  plinthH: number;
  walk: KitMaterialName;
  merlonW: number;
  merlonH: number;
  merlonGap: number;
  parapetH: number;
  innerParapetH: number;
  /** Crenellate the inner edge too (city-side merlons). */
  innerMerlons?: boolean;
}

/**
 * Prism along local X (length L, centred) with a convex polygon profile in
 * local (z, y). Flat shaded, outward-facing triangles.
 */
export function prismGeometry(profile: Array<[number, number]>, L: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const n = profile.length;
  const x0 = -L / 2, x1 = L / 2;
  let cz = 0, cy = 0, area = 0;
  for (let i = 0; i < n; i++) {
    cz += profile[i][0] / n;
    cy += profile[i][1] / n;
    const [za, ya] = profile[i], [zb, yb] = profile[(i + 1) % n];
    area += za * yb - zb * ya;
  }
  const tri = (a: number[], b: number[], c: number[], nx: number, ny: number, nz: number) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) nrm.push(nx, ny, nz);
  };
  for (let i = 0; i < n; i++) {
    const [za, ya] = profile[i];
    const [zb, yb] = profile[(i + 1) % n];
    const dz = zb - za, dy = yb - ya;
    // Normal of (a0,a1,b1) winding in (y,z): (-dz, dy)
    let ny = -dz, nz = dy;
    const l = Math.hypot(ny, nz) || 1;
    ny /= l;
    nz /= l;
    const mz = (za + zb) / 2 - cz, my = (ya + yb) / 2 - cy;
    const a0 = [x0, ya, za], a1 = [x1, ya, za], b1 = [x1, yb, zb], b0 = [x0, yb, zb];
    if (ny * my + nz * mz >= 0) {
      tri(a0, a1, b1, 0, ny, nz);
      tri(a0, b1, b0, 0, ny, nz);
    } else {
      tri(a0, b1, a1, 0, -ny, -nz);
      tri(a0, b0, b1, 0, -ny, -nz);
    }
  }
  // Caps: for a CCW profile (area > 0) the fan (0,i,i+1) faces -X.
  const ccw = area > 0;
  for (let i = 1; i < n - 1; i++) {
    const p0 = profile[0], pa = profile[i], pb = profile[i + 1];
    const A = (x: number, p: [number, number]) => [x, p[1], p[0]];
    if (ccw) {
      tri(A(x0, p0), A(x0, pa), A(x0, pb), -1, 0, 0);
      tri(A(x1, p0), A(x1, pb), A(x1, pa), 1, 0, 0);
    } else {
      tri(A(x0, p0), A(x0, pb), A(x0, pa), -1, 0, 0);
      tri(A(x1, p0), A(x1, pa), A(x1, pb), 1, 0, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

/**
 * Closed centre-line loop r = f(θ) around a centre, finely sampled so points
 * can be addressed by arc length s.
 */
export class LoopPath {
  readonly pts: P2[] = [];
  readonly cum: number[] = [0];
  readonly total: number;
  constructor(readonly c: P2, readonly rf: (theta: number) => number, readonly n = 1440) {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const r = rf(t);
      this.pts.push({ x: c.x + Math.cos(t) * r, z: c.z + Math.sin(t) * r });
    }
    for (let i = 0; i < n; i++) {
      const a = this.pts[i], b = this.pts[(i + 1) % n];
      this.cum.push(this.cum[i] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.total = this.cum[n];
  }

  wrap(s: number): number {
    const t = s % this.total;
    return t < 0 ? t + this.total : t;
  }

  /** Point at arc length s (wraps). */
  at(s: number): P2 {
    s = this.wrap(s);
    let lo = 0, hi = this.n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo], b = this.pts[(lo + 1) % this.n];
    const seg = this.cum[lo + 1] - this.cum[lo] || 1;
    const t = (s - this.cum[lo]) / seg;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Arc length at angle θ. */
  sOf(theta: number): number {
    const t = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const f = (t / (Math.PI * 2)) * this.n;
    const i = Math.floor(f) % this.n;
    return this.cum[i] + (this.cum[i + 1] - this.cum[i]) * (f - Math.floor(f));
  }

  /** Outward unit normal (radial from the centre) at a point. */
  outward(x: number, z: number): P2 {
    const dx = x - this.c.x, dz = z - this.c.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  /** Point at s offset along the outward normal. */
  offset(s: number, d: number): P2 {
    const p = this.at(s);
    const o = this.outward(p.x, p.z);
    return { x: p.x + o.x * d, z: p.z + o.z * d };
  }
}

export interface LoopWallOpts {
  path: LoopPath;
  /** Arc-length ranges [s0, s1] to build (s1 may exceed total to wrap). */
  sections: Array<[number, number]>;
  /** Arc-length ranges without the inner parapet (stair landings). */
  parapetGaps: Array<[number, number]>;
  baseY: number;
  style: WallStyle;
  /** Chunk key prefix; the loop is split into `arcs` major chunks. */
  key: string;
  arcs: number;
  segLen?: number;
  /** Optional chunk key per segment (overrides key/arcs). */
  chunkKey?: (a: P2, b: P2) => string;
}

/** Complement of gap ranges on a loop (gaps given as centre ± half). */
export function sectionsBetween(total: number, gaps: Array<[number, number]>): Array<[number, number]> {
  const g = gaps.map(([a, b]) => [((a % total) + total) % total, ((b % total) + total) % total] as [number, number]).map(([a, b]) => (b < a ? [a, b + total] : [a, b]) as [number, number]);
  g.sort((p, q) => p[0] - q[0]);
  if (!g.length) return [[0, total]];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < g.length; i++) {
    const end = g[i][1];
    const next = i + 1 < g.length ? g[i + 1][0] : g[0][0] + total;
    if (next > end + 0.5) out.push([end, next]);
  }
  return out;
}

/** Build a wall loop from explicit sections (segments end exactly at section ends). */
export function loopWall(chunks: ChunkSet, o: LoopWallOpts): void {
  const segLen = o.segLen ?? 15;
  const total = o.path.total;
  for (const [s0, s1] of o.sections) {
    const n = Math.max(1, Math.ceil((s1 - s0) / segLen));
    for (let i = 0; i < n; i++) {
      const sa = s0 + ((s1 - s0) * i) / n, sb = s0 + ((s1 - s0) * (i + 1)) / n;
      const sm = (sa + sb) / 2;
      const a = o.path.at(sa), b = o.path.at(sb);
      // Drop the inner parapet on any segment overlapping a gap (stair landings).
      const pg = o.parapetGaps.some(([g0, g1]) => [0, total, -total, 2 * total].some((off) => sa + off < g1 && sb + off > g0));
      const arc = Math.min(o.arcs - 1, Math.floor((o.path.wrap(sm) / total) * o.arcs));
      const c = chunks.named('major', o.chunkKey ? o.chunkKey(a, b) : `${o.key}:${arc}`);
      const first = i === 0, last = i === n - 1;
      wallSegment(c.builder, a, b, o.path.outward((a.x + b.x) / 2, (a.z + b.z) / 2), o.baseY, o.style, pg, first || last ? 0.05 : 0.35);
    }
  }
}

/** One straight wall segment from a to b (centre line), outward normal `out`. */
export function wallSegment(b: ContentBuilder, a: P2, c: P2, out: P2, baseY: number, s: WallStyle, parapetGap = false, extend = 0.35): void {
  const dx = c.x - a.x, dz = c.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const yaw = Math.atan2(-dz, dx);
  // Local +Z in world = (sin yaw, cos yaw); flip the profile if that points inward.
  const lz = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const sign = lz.x * out.x + lz.z * out.z >= 0 ? 1 : -1;
  const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
  const L = len + extend * 2;
  const t = s.thick / 2;
  const H = s.height;
  const prof: Array<[number, number]> = [
    [sign * -(t + s.batterIn), 0],
    [sign * (t + s.batterOut), 0],
    [sign * t, H],
    [sign * -t, H],
  ];
  const body = prismGeometry(prof, L);
  b.mesh(s.body, body, { x: mx, y: baseY, z: mz, yaw });
  body.dispose();
  // Local offset helper (z across the wall, outward positive).
  const at = (zOff: number) => ({ x: mx + out.x * zOff, z: mz + out.z * zOff });
  // Plinth
  if (s.plinthH > 0) {
    const w = s.thick + s.batterIn + s.batterOut + 1.0;
    const p = at((s.batterOut - s.batterIn) / 2);
    b.box(s.trim, { x: p.x, y: baseY + s.plinthH / 2, z: p.z, sx: L, sy: s.plinthH, sz: w, yaw });
  }
  // Bands
  for (const f of s.bands ?? []) {
    const y = H * f;
    const k = y / H;
    const wo = t + s.batterOut * (1 - k), wi = t + s.batterIn * (1 - k);
    const p = at((wo - wi) / 2);
    b.box(s.band ?? s.trim, { x: p.x, y: baseY + y, z: p.z, sx: L, sy: 0.55, sz: wo + wi + 0.6, yaw });
  }
  // Coping + walkway
  b.box(s.trim, { x: mx, y: baseY + H - 0.25, z: mz, sx: L, sy: 0.5, sz: s.thick + 0.5, yaw });
  b.box(s.walk, { x: mx, y: baseY + H + 0.03, z: mz, sx: L, sy: 0.06, sz: s.thick - 1.6, yaw }, { castShadow: false });
  // Outer parapet + merlons
  const po = at(t - 0.45);
  b.box(s.body, { x: po.x, y: baseY + H + s.parapetH / 2, z: po.z, sx: L, sy: s.parapetH, sz: 0.9, yaw });
  const count = Math.max(1, Math.floor(L / (s.merlonW + s.merlonGap)));
  const dirx = dx / len, dirz = dz / len;
  for (let k = 0; k < count; k++) {
    const along = -L / 2 + (k + 0.5) * (L / count);
    b.box(s.body, { x: po.x + dirx * along, y: baseY + H + s.parapetH + s.merlonH / 2, z: po.z + dirz * along, sx: s.merlonW, sy: s.merlonH, sz: 0.9, yaw });
  }
  // Inner parapet (with optional merlons)
  if (!parapetGap) {
    const pi = at(-t + 0.3);
    b.box(s.body, { x: pi.x, y: baseY + H + s.innerParapetH / 2, z: pi.z, sx: L, sy: s.innerParapetH, sz: 0.6, yaw });
    if (s.innerMerlons) {
      for (let k = 0; k < count; k++) {
        const along = -L / 2 + (k + 0.5) * (L / count);
        b.box(s.body, { x: pi.x + dirx * along, y: baseY + H + s.innerParapetH + s.merlonH * 0.4, z: pi.z + dirz * along, sx: s.merlonW * 0.8, sy: s.merlonH * 0.8, sz: 0.6, yaw });
      }
    }
    b.collider({ shape: 'box', x: pi.x, y: baseY + H + 0.7, z: pi.z, hx: L / 2, hz: 0.3, hy: 0.7, yaw, walkable: false, solid: true });
  }
  // Colliders: body (solid), walkway (walkable), outer parapet.
  const bc = at((s.batterOut - s.batterIn) / 2);
  b.collider({ shape: 'box', x: bc.x, y: baseY + H / 2, z: bc.z, hx: L / 2, hz: t + (s.batterIn + s.batterOut) / 2, hy: H / 2, yaw, walkable: false, solid: true });
  b.collider({ shape: 'box', x: mx, y: baseY + H - 0.25, z: mz, hx: L / 2, hz: t, hy: 0.25, yaw, walkable: true, solid: true });
  b.collider({ shape: 'box', x: po.x, y: baseY + H + 0.9, z: po.z, hx: L / 2, hz: 0.45, hy: 0.9, yaw, walkable: false, solid: true });
}

export interface GatehouseOpts {
  x: number;
  z: number;
  /** Outward unit direction (passage axis). */
  out: P2;
  baseY: number;
  width: number;
  depth: number;
  height: number;
  passageW: number;
  spring: number;
  body: KitMaterialName;
  trim: KitMaterialName;
  roof: KitMaterialName;
  /** Gate-tower hall on top (chenglou). */
  tower?: { w: number; d: number; h: number; tiers: number };
  banners?: boolean;
  doors?: boolean;
}

/** Monumental arched gatehouse. Local X along the wall, local Z outward. */
export function gatehouse(b: ContentBuilder, m: EarthMaterials, o: GatehouseOpts): void {
  const yaw = Math.atan2(o.out.x, o.out.z); // local +Z → out
  const right = { x: Math.cos(yaw), z: -Math.sin(yaw) }; // local +X
  const L = (lx: number, lz: number) => ({ x: o.x + right.x * lx + o.out.x * lz, z: o.z + right.z * lx + o.out.z * lz });
  const W = o.width, D = o.depth, H = o.height;
  const g = archBlockGeometry(W, H, D, o.passageW, o.spring, 14);
  b.mesh(o.body, g, { x: o.x, y: o.baseY, z: o.z, yaw });
  g.dispose();
  // Plinths on the flanks, bands above the arch, coping.
  for (const side of [-1, 1]) {
    const fw = (W - o.passageW) / 2;
    const p = L(side * (o.passageW / 2 + fw / 2), 0);
    b.box(o.trim, { x: p.x, y: o.baseY + 1.2, z: p.z, sx: fw + 0.6, sy: 2.4, sz: D + 0.8, yaw });
  }
  const apex = o.spring + o.passageW / 2;
  for (const y of [apex + 2.2, H - 1.5]) b.box(o.trim, { x: o.x, y: o.baseY + y, z: o.z, sx: W + 0.6, sy: 0.6, sz: D + 0.6, yaw });
  // Arch voussoir trim on both faces
  for (const side of [-1, 1]) {
    const segs = 9;
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI - (i / segs) * Math.PI;
      const r = o.passageW / 2 + 0.5;
      const lx = Math.cos(a) * r, ly = o.spring + Math.sin(a) * r;
      const p = L(lx, side * (D / 2 + 0.15));
      b.box(o.trim, { x: p.x, y: o.baseY + ly, z: p.z, sx: 1.3, sy: 1.0, sz: 0.4, yaw, roll: a + Math.PI / 2 });
    }
  }
  // Top walkway + merlons on both edges
  b.box(o.trim, { x: o.x, y: o.baseY + H - 0.25, z: o.z, sx: W, sy: 0.5, sz: D + 0.4, yaw });
  b.box('paving', { x: o.x, y: o.baseY + H + 0.03, z: o.z, sx: W - 1.6, sy: 0.06, sz: D - 1.6, yaw }, { castShadow: false });
  for (const side of [-1, 1]) {
    const pz = side * (D / 2 - 0.45);
    const p = L(0, pz);
    b.box(o.body, { x: p.x, y: o.baseY + H + 0.6, z: p.z, sx: W, sy: 1.2, sz: 0.9, yaw });
    const count = Math.floor(W / 2.4);
    for (let k = 0; k < count; k++) {
      const lx = -W / 2 + (k + 0.5) * (W / count);
      const q = L(lx, pz);
      b.box(o.body, { x: q.x, y: o.baseY + H + 1.2 + 0.55, z: q.z, sx: 1.2, sy: 1.1, sz: 0.9, yaw });
    }
    b.collider({ shape: 'box', x: p.x, y: o.baseY + H + 0.9, z: p.z, hx: W / 2, hz: 0.45, hy: 0.9, yaw, walkable: false, solid: true });
  }
  // Colliders: flanks + lintel (walkable tops).
  const fw = (W - o.passageW) / 2;
  for (const side of [-1, 1]) {
    const p = L(side * (o.passageW / 2 + fw / 2), 0);
    b.collider({ shape: 'box', x: p.x, y: o.baseY + H / 2, z: p.z, hx: fw / 2, hz: D / 2 + 0.3, hy: H / 2, yaw, walkable: true, solid: true });
  }
  b.collider({ shape: 'box', x: o.x, y: o.baseY + (apex + H) / 2, z: o.z, hx: o.passageW / 2 + 0.1, hz: D / 2, hy: (H - apex) / 2, yaw, walkable: true, solid: true });
  // Doors swung open against the passage walls (inner half).
  if (o.doors !== false) {
    const leafW = Math.min(o.passageW / 2, D * 0.45);
    const leafH = o.spring + 0.5;
    for (const side of [-1, 1]) {
      const p = L(side * (o.passageW / 2 - 0.35), -D / 2 + leafW / 2 + 0.6);
      b.box('wood_dark', { x: p.x, y: o.baseY + leafH / 2, z: p.z, sx: 0.5, sy: leafH, sz: leafW, yaw });
      for (let r = 1; r < 6; r++) {
        const q = L(side * (o.passageW / 2 - 0.62), -D / 2 + leafW / 2 + 0.6);
        b.box('bronze', { x: q.x, y: o.baseY + (leafH * r) / 6, z: q.z, sx: 0.12, sy: 0.25, sz: leafW * 0.9, yaw });
      }
      b.collider({ shape: 'box', x: p.x, y: o.baseY + leafH / 2, z: p.z, hx: 0.25, hz: leafW / 2, hy: leafH / 2, yaw, walkable: false, solid: true });
    }
  }
  // Emblem plaque and banners on the outer face (and a plaque inside).
  for (const side of [1, -1]) {
    const pp = L(0, side * (D / 2 + 0.12));
    const faceYaw = side > 0 ? yaw : yaw + Math.PI;
    plaque(b, m, pp.x, o.baseY + apex + (H - apex) * 0.45, pp.z, faceYaw, Math.min(3.2, (H - apex) * 0.3));
    if (o.banners !== false && side > 0) {
      for (const bx of [-1, 1]) {
        const q = L(bx * (o.passageW / 2 + (W - o.passageW) / 4), D / 2 + 0.15);
        hangingBanner(b, m, q.x, o.baseY + H - 2.5, q.z, yaw - Math.PI / 2, Math.min(4.2, (W - o.passageW) / 4), Math.min(16, H * 0.5));
      }
    }
  }
  // Gate tower hall (chenglou) on the outer half of the top.
  if (o.tower) {
    const tw = o.tower;
    const cz = D / 2 - tw.d / 2 - 1.4;
    const c0 = L(0, cz);
    let y = o.baseY + H;
    let w = tw.w, d = tw.d;
    for (let t = 0; t < tw.tiers; t++) {
      const h = t === 0 ? tw.h : tw.h * 0.75;
      b.block('plaster_tan', { x: c0.x, y, z: c0.z, sx: w, sy: h, sz: d, yaw });
      // Red columns on the long faces
      const cols = Math.max(3, Math.round(w / 3.2));
      for (let k = 0; k <= cols; k++) {
        const lx = -w / 2 + (k * w) / cols;
        for (const sd of [-1, 1]) {
          const q = L(lx, cz + sd * (d / 2 + 0.12));
          b.box('wood_red', { x: q.x, y: y + h / 2, z: q.z, sx: 0.45, sy: h, sz: 0.3, yaw });
        }
      }
      // Lattice window bands
      for (const sd of [-1, 1]) {
        const q = L(0, cz + sd * (d / 2 + 0.06));
        b.box('wood_dark', { x: q.x, y: y + h * 0.55, z: q.z, sx: w * 0.9, sy: h * 0.38, sz: 0.1, yaw });
      }
      b.box('wood_dark', { x: c0.x, y: y + h - 0.2, z: c0.z, sx: w + 0.5, sy: 0.4, sz: d + 0.5, yaw });
      if (t === 0) b.collider({ shape: 'box', x: c0.x, y: y + h / 2, z: c0.z, hx: w / 2, hz: d / 2, hy: h / 2, yaw, walkable: true, solid: true });
      y += h;
      const roofH = Math.min(w, d) * (t === tw.tiers - 1 ? 0.42 : 0.28);
      b.roof(o.roof, { x: c0.x, y, z: c0.z, w, d, height: roofH, yaw, overhang: t === tw.tiers - 1 ? 1.8 : 2.2, style: 'hip', curve: 0.9, ridge: t === tw.tiers - 1 ? 'roof_dark' : null });
      if (t === tw.tiers - 1) {
        for (const sd of [-1, 1]) {
          const q = L(sd * Math.max(0.5, (w - d) / 2 + 0.3), cz);
          b.box('gold', { x: q.x, y: y + roofH + 0.55, z: q.z, sx: 0.5, sy: 0.9, sz: 0.5, yaw });
        }
      }
      y += roofH * 0.35;
      w *= 0.72;
      d *= 0.72;
    }
  }
}

export interface StairOpts {
  /** Bottom start point (ground) on the stair centre line. */
  x: number;
  z: number;
  /** Unit direction of ascent. */
  dir: P2;
  baseY: number;
  rise: number;
  width: number;
  tread?: number;
  material: KitMaterialName;
  /** Side that gets a railing: +1 = right of ascent, -1 = left, 0 = none, 2 = both. */
  rail: -1 | 0 | 1 | 2;
  /** Flat landing length at the top. */
  landing?: number;
  railMat?: KitMaterialName;
}

/** Long straight stairs with a walkable ramp collider, top landing and railings. */
export function longStairs(b: ContentBuilder, o: StairOpts): { top: P2; topY: number; run: number } {
  const tread = o.tread ?? 0.42;
  const steps = Math.max(1, Math.round(o.rise / 0.25));
  const run = steps * tread;
  const from = new THREE.Vector3(o.x, o.baseY, o.z);
  const to = new THREE.Vector3(o.x + o.dir.x * run, o.baseY + o.rise, o.z + o.dir.z * run);
  b.stairs({ from, to, width: o.width, material: o.material, stepHeight: o.rise / steps });
  const yaw = Math.atan2(-o.dir.z, o.dir.x);
  const right = { x: -o.dir.z, z: o.dir.x }; // right of ascent (dir rotated +90° in xz)
  const land = o.landing ?? 0;
  if (land > 0) {
    const lc = { x: to.x + o.dir.x * land / 2, z: to.z + o.dir.z * land / 2 };
    b.box(o.material, { x: lc.x, y: o.baseY + o.rise / 2, z: lc.z, sx: land + 0.05, sy: o.rise, sz: o.width, yaw }, { collide: true, walkable: true });
  }
  const sides: number[] = o.rail === 2 ? [-1, 1] : o.rail === 0 ? [] : [o.rail];
  for (const side of sides) {
    const off = side * (o.width / 2 - 0.15);
    const cx = (from.x + to.x) / 2 + right.x * off, cz = (from.z + to.z) / 2 + right.z * off;
    const pitch = Math.atan2(o.rise, run);
    // Visual sloped balustrade
    b.box(o.railMat ?? o.material, { x: cx, y: o.baseY + o.rise / 2 + 0.55, z: cz, sx: Math.hypot(run, o.rise), sy: 0.22, sz: 0.3, yaw, roll: pitch });
    b.box(o.railMat ?? o.material, { x: cx, y: o.baseY + o.rise / 2 + 0.25, z: cz, sx: Math.hypot(run, o.rise), sy: 0.6, sz: 0.18, yaw, roll: pitch });
    // Ramp-shaped rail collider (top 1 m above the steps)
    b.collider({ shape: 'box', x: cx, y: o.baseY + (o.rise + 1.0) / 2, z: cz, hx: run / 2, hz: 0.18, hy: (o.rise + 1.0) / 2, yaw, slopeRise: o.rise, walkable: false, solid: true });
    if (land > 0) {
      const lx = to.x + o.dir.x * land / 2 + right.x * off, lz = to.z + o.dir.z * land / 2 + right.z * off;
      b.box(o.railMat ?? o.material, { x: lx, y: o.baseY + o.rise + 0.5, z: lz, sx: land, sy: 1.0, sz: 0.3, yaw }, { collide: true, walkable: false });
    }
  }
  return { top: { x: to.x, z: to.z }, topY: to.y, run };
}
