import * as THREE from 'three';
import { heightAt } from '../../../Heightfield';
import type { ContentBuilder } from '../../../kit/Builder';
import type { KitMaterialName } from '../../../kit/Materials';
import type { P2 } from '../../../WorldLayout';

/** Builders' shared helpers for the Fire Nation capital (geometry only; no state). */

export type Mat = KitMaterialName | THREE.Material;

/** Insert points so long runs follow the ground. */
export function densify(pts: P2[], step: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * A strip of paving draped over the ground (or at y(x, z)) along a polyline. Cross-section samples
 * follow the ground so streets hug slopes; UVs repeat every `tile` metres.
 */
export function drapedStrip(b: ContentBuilder, mat: Mat, pts: P2[], width: number, o: { y?: (x: number, z: number) => number; lift?: number; tile?: number; step?: number; across?: number } = {}): void {
  const yFn = o.y ?? heightAt;
  const lift = o.lift ?? 0.06;
  const tile = o.tile ?? 4;
  const d = densify(pts, o.step ?? 3);
  const n = d.length;
  if (n < 2) return;
  const across = Math.max(1, o.across ?? Math.ceil(width / 3));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = d[Math.max(0, i - 1)], c = d[Math.min(n - 1, i + 1)];
    let tx = c.x - a.x, tz = c.z - a.z;
    const L = Math.hypot(tx, tz) || 1;
    tx /= L;
    tz /= L;
    if (i > 0) run += Math.hypot(d[i].x - d[i - 1].x, d[i].z - d[i - 1].z);
    for (let k = 0; k <= across; k++) {
      const off = (k / across - 0.5) * width;
      const x = d[i].x - tz * off, z = d[i].z + tx * off;
      pos.push(x, yFn(x, z) + lift, z);
      uv.push((off + width / 2) / tile, run / tile);
    }
  }
  const row = across + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * row + k, b2 = a + 1, c = a + row, e = c + 1;
      idx.push(a, c, b2, b2, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  b.mesh(mat, g, { x: 0, y: 0, z: 0 }, { castShadow: false });
  g.dispose();
}

/** Flat rectangle of paving (yaw about its centre) at height y. */
export function slabRect(b: ContentBuilder, mat: Mat, o: { x: number; z: number; y: number; w: number; d: number; yaw?: number; thick?: number; collide?: boolean }): void {
  const th = o.thick ?? 0.3;
  b.box(mat, { x: o.x, y: o.y - th / 2, z: o.z, sx: o.w, sy: th, sz: o.d, yaw: o.yaw ?? 0 }, o.collide ? { collide: true, walkable: true, solid: true, surface: 'stone' } : {});
}

/**
 * Vertical wall face along a polyline between a top line and a bottom (both functions of x/z):
 * retaining walls, quay faces, cliff dressings. Thickness extends to the left of the travel
 * direction (-normal) so the visible face is on the right (+normal) side.
 */
export function wallFace(b: ContentBuilder, mat: Mat, pts: P2[], o: { top: (x: number, z: number) => number; bottom: (x: number, z: number) => number; thick?: number; tile?: number; step?: number; collide?: boolean; cap?: Mat | null; capH?: number }): void {
  const d = densify(pts, o.step ?? 4);
  const th = o.thick ?? 1.2;
  for (let i = 0; i < d.length - 1; i++) {
    const a = d[i], c = d[i + 1];
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 0.05) continue;
    const yaw = Math.atan2(c.x - a.x, c.z - a.z);
    const top = Math.max(o.top(a.x, a.z), o.top(c.x, c.z), o.top(mx, mz));
    const bot = Math.min(o.bottom(a.x, a.z), o.bottom(c.x, c.z), o.bottom(mx, mz));
    const h = top - bot;
    if (h < 0.1) continue;
    // Local +X of a yaw'd box points to the right of the travel direction (+normal).
    const nx = Math.cos(yaw), nz = -Math.sin(yaw);
    const cx = mx - nx * (th / 2) * 0, cz = mz - nz * (th / 2) * 0;
    b.box(mat, { x: cx, y: bot + h / 2, z: cz, sx: th, sy: h, sz: len + 0.04, yaw }, o.collide ? { collide: true, walkable: true, solid: true, surface: 'stone' } : {});
    if (o.cap) {
      const ch = o.capH ?? 0.35;
      b.box(o.cap, { x: cx, y: top + ch / 2, z: cz, sx: th + 0.3, sy: ch, sz: len + 0.06, yaw });
    }
  }
}

/** Crenellated parapet along a polyline at ground + offset (battlements). */
export function battlement(b: ContentBuilder, mat: Mat, pts: P2[], o: { y: (x: number, z: number) => number; h?: number; thick?: number; merlon?: number; gap?: number; collide?: boolean; cap?: Mat }): void {
  const h = o.h ?? 1.1, th = o.thick ?? 0.7;
  const d = densify(pts, 3);
  for (let i = 0; i < d.length - 1; i++) {
    const a = d[i], c = d[i + 1];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 0.05) continue;
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
    const yaw = Math.atan2(c.x - a.x, c.z - a.z);
    const y = Math.max(o.y(a.x, a.z), o.y(c.x, c.z));
    b.box(mat, { x: mx, y: y + h / 2, z: mz, sx: th, sy: h, sz: len + 0.05, yaw }, o.collide !== false ? { collide: true, walkable: false, solid: true } : {});
  }
  // Merlons every `gap` metres.
  const m = o.merlon ?? 0.6, gap = o.gap ?? 2.2;
  const dd = densify(pts, 0.5);
  let acc = 0;
  for (let i = 1; i < dd.length; i++) {
    const a = dd[i - 1], c = dd[i];
    acc += Math.hypot(c.x - a.x, c.z - a.z);
    if (acc < gap) continue;
    acc = 0;
    const yaw = Math.atan2(c.x - a.x, c.z - a.z);
    b.box(o.cap ?? mat, { x: c.x, y: o.y(c.x, c.z) + h + m / 2, z: c.z, sx: th + 0.05, sy: m, sz: 0.8, yaw });
  }
}

/** Seeded RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Max / min ground height under a rotated rectangle (sampled). */
export function groundSpan(x: number, z: number, w: number, d: number, yaw: number): { min: number; max: number } {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let mn = Infinity, mx = -Infinity;
  for (const lx of [-0.5, 0, 0.5]) {
    for (const lz of [-0.5, 0, 0.5]) {
      const px = x + (lx * w) * c + (lz * d) * s;
      const pz = z - (lx * w) * s + (lz * d) * c;
      const h = heightAt(px, pz);
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
  }
  return { min: mn, max: mx };
}
