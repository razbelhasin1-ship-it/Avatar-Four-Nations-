import * as THREE from 'three';
import type { SurfaceType } from '../../../core/types';
import type { ContentBuilder } from '../../kit/Builder';
import {
  archSlab,
  boxAt,
  bulbDome,
  clean,
  crystal,
  disc,
  dome,
  emblem,
  flatQuad,
  foamPatch,
  hull,
  mergeParts,
  panelWithArches,
  pillow,
  place,
  waterfallSheet,
  type Opening,
} from './geometry';
import { wtFoam, wtMat, wtWaterfall, type WTMaterialName } from './materials';

/**
 * Higher-level Water Tribe building blocks on top of the kit ContentBuilder.
 * Every walkable surface gets a matching collider; every solid structure a
 * solid collider. Pure visual details (trims, recess slabs, snow pillows) do
 * not collide.
 */

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Part bags: geometry collected per material, merged once
// ---------------------------------------------------------------------------

export type Bag = Map<WTMaterialName, THREE.BufferGeometry[]>;

export function bag(): Bag {
  return new Map();
}

export function put(b: Bag, mat: WTMaterialName, g: THREE.BufferGeometry): void {
  let arr = b.get(mat);
  if (!arr) {
    arr = [];
    b.set(mat, arr);
  }
  arr.push(g);
}

/** Merge a bag into one geometry per material. */
export function mergeBag(b: Bag): Map<WTMaterialName, THREE.BufferGeometry> {
  const out = new Map<WTMaterialName, THREE.BufferGeometry>();
  for (const [m, geos] of b) out.set(m, mergeParts(geos));
  return out;
}

/** Emit merged bag geometry into a builder with a transform. */
export function emit(cb: ContentBuilder, parts: Map<WTMaterialName, THREE.BufferGeometry>, x: number, y: number, z: number, yaw = 0, s = 1, sy = s, shadow = true): void {
  for (const [m, g] of parts) cb.mesh(wtMat(m), g, { x, y, z, yaw, sx: s, sy, sz: s }, { castShadow: shadow && m !== 'window' && m !== 'dark' });
}

/** Facade arch: dark recess (or lit window) with an ice trim frame. Wall face at local z = fz, facing +Z. */
export function facadeArch(b: Bag, x: number, y: number, fz: number, w: number, h: number, lit: boolean, frame = true, yaw = 0, cx = 0, cz = 0): void {
  // Slab protrudes 1..9 cm from the wall face; the frame sits just behind it.
  const g = archSlab(w, h, 0.08, 7);
  const t = new THREE.Matrix4().makeRotationY(yaw).setPosition(cx, 0, cz);
  g.applyMatrix4(t.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, fz + 0.05)));
  put(b, lit ? 'window' : 'dark', g);
  if (frame) {
    const f = archSlab(w + 0.36, h + 0.2, 0.06, 7);
    f.applyMatrix4(t.clone().multiply(new THREE.Matrix4().makeTranslation(x, y - 0.1, fz + 0.01)));
    put(b, 'ice_trim', f);
  }
}

// ---------------------------------------------------------------------------
// House archetypes (local: base y = 0, centred, front = +Z)
// ---------------------------------------------------------------------------

export interface Archetype {
  id: string;
  parts: Map<WTMaterialName, THREE.BufferGeometry>;
  /** Collider footprint (local, before scale). */
  col: { kind: 'box'; w: number; d: number; h: number } | { kind: 'cyl'; r: number; h: number };
}

function boxHouse(id: string, w: number, h: number, d: number, opts: { lit: number; dome?: number; tier?: boolean; tower?: number; side?: boolean }): Archetype {
  const b = bag();
  put(b, 'ice_wall', boxAt(w, h, d));
  // plinth and band
  put(b, 'ice_trim', boxAt(w + 0.3, 0.45, d + 0.3));
  put(b, 'ice_trim', boxAt(w + 0.16, 0.22, d + 0.16, 0, h - 0.55));
  put(b, 'snow', pillow(w + 0.5, d + 0.5, 0.75, 0.35));
  b.get('snow')![b.get('snow')!.length - 1].translate(0, h - 0.1, 0);
  // facade: door + windows
  facadeArch(b, 0, 0.2, d / 2, 1.5, 2.5, false);
  const nWin = Math.max(1, Math.floor((w - 2.5) / 2.4));
  let k = 0;
  for (let i = 0; i < nWin; i++) {
    for (const side of [-1, 1]) {
      const x = side * (1.6 + i * 2.2 + 0.4);
      if (Math.abs(x) > w / 2 - 0.8) continue;
      facadeArch(b, x, 1.3, d / 2, 0.85, 1.35, (k++ + id.length) % 3 < opts.lit);
    }
  }
  if (opts.side !== false) {
    for (const sx of [-1, 1]) facadeArch(b, 0, 1.3, w / 2, 0.85, 1.35, k++ % 2 === 0, true, (sx * Math.PI) / 2);
  }
  let top = h + 0.6;
  if (opts.tier) {
    const w2 = w * 0.62, d2 = d * 0.6, h2 = h * 0.65;
    put(b, 'ice_wall', boxAt(w2, h2, d2, 0, h + 0.4, -d * 0.08));
    put(b, 'ice_trim', boxAt(w2 + 0.14, 0.2, d2 + 0.14, 0, h + 0.4 + h2 - 0.45, -d * 0.08));
    const p = pillow(w2 + 0.4, d2 + 0.4, 0.6, 0.3);
    p.translate(0, h + 0.4 + h2 - 0.1, -d * 0.08);
    put(b, 'snow', p);
    facadeArch(b, -w2 * 0.22, h + 1.3, d2 / 2 - d * 0.08, 0.8, 1.3, true);
    facadeArch(b, w2 * 0.22, h + 1.3, d2 / 2 - d * 0.08, 0.8, 1.3, false);
    top = h + 0.4 + h2 + 0.5;
  }
  if (opts.dome) {
    const dm = dome(opts.dome, 0.85, 14, 6);
    dm.translate(0, top - 0.15, opts.tier ? -d * 0.08 : 0);
    put(b, 'snow', dm);
    const ring = new THREE.CylinderGeometry(opts.dome * 1.04, opts.dome * 1.04, 0.3, 14);
    ring.translate(0, top - 0.05, opts.tier ? -d * 0.08 : 0);
    put(b, 'ice_trim', ring);
  }
  if (opts.tower) {
    const tw = Math.min(w, d) * 0.34;
    const tx = w / 2 - tw / 2 - 0.2, tz = -d / 2 + tw / 2 + 0.2;
    put(b, 'ice_wall', boxAt(tw, opts.tower, tw, tx, 0, tz));
    const p = pillow(tw + 0.4, tw + 0.4, 0.5, 0.25);
    p.translate(tx, opts.tower - 0.1, tz);
    put(b, 'snow', p);
    const bd = bulbDome(tw * 0.42, tw * 0.9, 10);
    bd.translate(tx, opts.tower + 0.3, tz);
    put(b, 'ice_trim', bd);
    facadeArch(b, tx, opts.tower - 2.2, tz + tw / 2, 0.6, 1.0, true, false);
  }
  return { id, parts: mergeBag(b), col: { kind: 'box', w: w + 0.3, d: d + 0.3, h: h + 0.5 } };
}

function domeHouse(id: string, r: number, h: number): Archetype {
  const b = bag();
  const body = new THREE.CylinderGeometry(r, r * 1.02, h, 18, 1);
  body.translate(0, h / 2, 0);
  put(b, 'ice_wall', body);
  const plinth = new THREE.CylinderGeometry(r + 0.2, r + 0.25, 0.45, 18);
  plinth.translate(0, 0.225, 0);
  put(b, 'ice_trim', plinth);
  const band = new THREE.CylinderGeometry(r + 0.08, r + 0.08, 0.25, 18);
  band.translate(0, h - 0.3, 0);
  put(b, 'ice_trim', band);
  const dm = dome(r * 1.05, 0.8, 18, 7);
  dm.translate(0, h - 0.05, 0);
  put(b, 'snow', dm);
  const cap = bulbDome(0.45, 1.1, 8);
  cap.translate(0, h + r * 0.8 - 0.2, 0);
  put(b, 'ice_trim', cap);
  // porch with door
  const porch = boxAt(2.4, 3.1, 1.4, 0, 0, r - 0.2);
  put(b, 'ice_wall', porch);
  const pc = pillow(2.8, 1.8, 0.45, 0.2);
  pc.translate(0, 3.0, r - 0.2);
  put(b, 'snow', pc);
  facadeArch(b, 0, 0.2, r + 0.5, 1.3, 2.3, false);
  // windows around the drum
  for (let i = 0; i < 5; i++) {
    // Angle around the drum (0 = +X, PI/2 = +Z front, which has the porch).
    const a = Math.PI / 2 + ((i + 1) / 6) * Math.PI * 2;
    facadeArch(b, 0, 1.2, r - 0.02, 0.8, 1.25, i % 2 === 0, true, Math.PI / 2 - a);
  }
  return { id, parts: mergeBag(b), col: { kind: 'cyl', r: r + 0.25, h: h + 0.4 } };
}

function longHall(id: string, w: number, h: number, d: number): Archetype {
  const b = bag();
  put(b, 'ice_wall', boxAt(w, h, d));
  put(b, 'ice_trim', boxAt(w + 0.3, 0.45, d + 0.3));
  // barrel vault roof of snow
  const vault = new THREE.CylinderGeometry(d / 2 + 0.25, d / 2 + 0.25, w + 0.4, 16, 1, false, 0, Math.PI);
  vault.rotateZ(Math.PI / 2);
  vault.rotateX(Math.PI / 2);
  vault.scale(1, 0.55, 1);
  vault.translate(0, h - 0.05, 0);
  put(b, 'snow', vault);
  const n = Math.max(2, Math.round(w / 4.5));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    facadeArch(b, x, 0.2, d / 2, i === Math.floor(n / 2) ? 2.6 : 1.3, i === Math.floor(n / 2) ? 3.1 : 2.2, i % 2 === 1);
  }
  for (const sx of [-1, 1]) facadeArch(b, 0, 1.4, w / 2, 1.0, 1.6, sx > 0, true, (sx * Math.PI) / 2);
  return { id, parts: mergeBag(b), col: { kind: 'box', w: w + 0.3, d: d + 0.3, h: h + 0.6 } };
}

function nobleHouse(id: string): Archetype {
  const w = 13, h = 6.2, d = 9.5;
  const b = bag();
  // main body set back behind a colonnade
  put(b, 'ice_wall', boxAt(w, h, d - 2.4, 0, 0, -1.2));
  put(b, 'ice_trim', boxAt(w + 0.3, 0.5, d + 0.3));
  // colonnade front: arched panel
  const arc = panelWithArches(w, h, 0.9, [
    { x: -4.2, y: 0, w: 2.6, h: 4.3 },
    { x: 0, y: 0, w: 3.0, h: 4.8 },
    { x: 4.2, y: 0, w: 2.6, h: 4.3 },
  ]);
  arc.translate(0, 0, d / 2 - 0.45);
  put(b, 'ice_wall', arc);
  // back wall of the porch (dark doors)
  facadeArch(b, 0, 0.45, d / 2 - 2.4, 1.6, 2.7, false);
  facadeArch(b, -4.2, 1.3, d / 2 - 2.4, 1.0, 1.7, true, false);
  facadeArch(b, 4.2, 1.3, d / 2 - 2.4, 1.0, 1.7, true, false);
  put(b, 'ice_trim', boxAt(w + 0.2, 0.3, d + 0.2, 0, h - 0.6));
  const p = pillow(w + 0.6, d + 0.6, 0.8, 0.35);
  p.translate(0, h - 0.1, 0);
  put(b, 'snow', p);
  const dm = dome(3.2, 0.9, 16, 7);
  dm.translate(0, h + 0.55, -1);
  put(b, 'snow', dm);
  const drum = new THREE.CylinderGeometry(3.3, 3.3, 0.5, 16);
  drum.translate(0, h + 0.6, -1);
  put(b, 'ice_trim', drum);
  const spire = bulbDome(0.55, 1.6, 8);
  spire.translate(0, h + 0.55 + 2.8, -1);
  put(b, 'ice_trim', spire);
  for (const sx of [-1, 1]) {
    facadeArch(b, 0, 1.4, w / 2, 1.0, 1.8, true, true, (sx * Math.PI) / 2);
  }
  return { id, parts: mergeBag(b), col: { kind: 'box', w: w + 0.3, d: d + 0.3, h: h + 0.6 } };
}

let kitCache: Map<string, Archetype> | null = null;

/** The Northern Water Tribe house kit (built once, shared, disposed by disposeHouseKit). */
export function houseKit(): Map<string, Archetype> {
  if (kitCache) return kitCache;
  const k = new Map<string, Archetype>();
  const add = (a: Archetype) => k.set(a.id, a);
  add(boxHouse('cottage', 7, 4, 6, { lit: 1 }));
  add(boxHouse('cottage_dome', 7.5, 4.2, 6.5, { lit: 1, dome: 2.0 }));
  add(boxHouse('twostorey', 9, 4.2, 7.5, { lit: 2, tier: true }));
  add(boxHouse('tower', 8, 4.4, 7, { lit: 1, tower: 9.5 }));
  add(boxHouse('tier_dome', 10, 4.6, 8, { lit: 2, tier: true, dome: 1.7 }));
  add(domeHouse('dome', 3.8, 3.4));
  add(longHall('hall', 15, 5, 8));
  add(nobleHouse('noble'));
  kitCache = k;
  return k;
}

export function disposeHouseKit(): void {
  if (!kitCache) return;
  for (const a of kitCache.values()) for (const g of a.parts.values()) g.dispose();
  kitCache = null;
}

/** Place an archetype (merged into the builder) with a matching collider. */
export function placeHouse(cb: ContentBuilder, a: Archetype, x: number, y: number, z: number, yaw: number, s = 1): void {
  emit(cb, a.parts, x, y, z, yaw, s);
  if (a.col.kind === 'box') {
    cb.collider({ shape: 'box', x, y: y + (a.col.h * s) / 2, z, hx: (a.col.w * s) / 2, hz: (a.col.d * s) / 2, hy: (a.col.h * s) / 2, yaw, walkable: true, solid: true, surface: 'snow' });
  } else {
    cb.collider({ shape: 'cylinder', x, y: y + (a.col.h * s) / 2, z, r: a.col.r * s, hy: (a.col.h * s) / 2, walkable: true, solid: true, surface: 'snow' });
  }
}

/** Footprint half-extents (world, unrotated) of an archetype at scale s. */
export function houseHalf(a: Archetype, s = 1): { hw: number; hd: number } {
  return a.col.kind === 'box' ? { hw: (a.col.w * s) / 2, hd: (a.col.d * s) / 2 } : { hw: a.col.r * s + 1.3 * s, hd: a.col.r * s + 1.3 * s };
}

// ---------------------------------------------------------------------------
// Ground: podium slabs, canals, quays
// ---------------------------------------------------------------------------

/** Axis-aligned walkable slab (street/plaza level) from `bottom` to `top`. */
export function slab(cb: ContentBuilder, mat: WTMaterialName, x0: number, z0: number, x1: number, z1: number, top: number, bottom: number, surface: SurfaceType = 'packedsnow', collide = true): void {
  const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
  if (w < 0.05 || d < 0.05) return;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  cb.box(wtMat(mat), { x: cx, y: (top + bottom) / 2, z: cz, sx: w, sy: top - bottom, sz: d }, { collide, walkable: true, surface });
}

/** Rotated walkable slab: centre (cx, cz), length along local X (yaw), width along local Z. */
export function slabRot(cb: ContentBuilder, mat: WTMaterialName, cx: number, cz: number, len: number, wid: number, yaw: number, top: number, bottom: number, surface: SurfaceType = 'packedsnow'): void {
  cb.box(wtMat(mat), { x: cx, y: (top + bottom) / 2, z: cz, sx: len, sy: top - bottom, sz: wid, yaw }, { collide: true, walkable: true, surface });
}

/** Collects water surface geometry (one merged mesh per water material). */
export class WaterSheets {
  private readonly geos = new Map<THREE.Material, THREE.BufferGeometry[]>();

  rect(mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y: number): void {
    const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
    const g = flatQuad(w, d, Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(d / 8)));
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.add(mat, g);
  }

  rot(mat: THREE.Material, cx: number, cz: number, len: number, wid: number, yaw: number, y: number): void {
    const g = flatQuad(len, wid, Math.max(1, Math.round(len / 8)), Math.max(1, Math.round(wid / 8)));
    g.rotateY(yaw);
    g.translate(cx, y, cz);
    this.add(mat, g);
  }

  /**
   * Flowing water strip for the flow shader: UV u runs across (0..1), v runs
   * downstream in metres / 8 (as world rivers), so the current visibly moves
   * in direction `dir`.
   */
  flow(mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y: number, dir: '+x' | '-x' | '+z' | '-z'): void {
    const alongX = dir === '+x' || dir === '-x';
    const len = alongX ? x1 - x0 : z1 - z0, wid = alongX ? z1 - z0 : x1 - x0;
    const nl = Math.max(1, Math.round(len / 6)), nw = Math.max(1, Math.round(wid / 6));
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    for (let i = 0; i <= nl; i++) {
      for (let j = 0; j <= nw; j++) {
        const a = i / nl, b = j / nw;
        P.push(alongX ? x0 + (x1 - x0) * a : x0 + (x1 - x0) * b, y, alongX ? z0 + (z1 - z0) * b : z0 + (z1 - z0) * a);
        N.push(0, 1, 0);
        U.push(b, ((dir === '+x' || dir === '+z' ? a : 1 - a) * len) / 8);
      }
    }
    for (let i = 0; i < nl; i++) {
      for (let j = 0; j < nw; j++) {
        const k = i * (nw + 1) + j, r = nw + 1;
        if (alongX) I.push(k, k + 1, k + r, k + 1, k + r + 1, k + r);
        else I.push(k, k + r, k + 1, k + 1, k + r, k + r + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    this.add(mat, g);
  }

  disc(mat: THREE.Material, x: number, z: number, r: number, y: number, segs = 32): void {
    const g = new THREE.CircleGeometry(r, segs);
    g.rotateX(-Math.PI / 2);
    g.translate(x, y, z);
    this.add(mat, g);
  }

  add(mat: THREE.Material, g: THREE.BufferGeometry): void {
    let arr = this.geos.get(mat);
    if (!arr) {
      arr = [];
      this.geos.set(mat, arr);
    }
    arr.push(clean(g));
  }

  /** Emit into a builder (merged per material; no shadows). */
  flush(cb: ContentBuilder): void {
    for (const [m, arr] of this.geos) {
      for (const g of arr) {
        cb.mesh(m, g, { x: 0, y: 0, z: 0 }, { castShadow: false });
        g.dispose();
      }
    }
    this.geos.clear();
  }
}

/**
 * Canal channel (axis-aligned): dark bed, water surface, and a walkable
 * (non-solid) floor collider so anyone who falls in can wade to the steps.
 */
export function canalRect(cb: ContentBuilder, sheets: WaterSheets, water: THREE.Material, x0: number, z0: number, x1: number, z1: number, level: number, floorY: number): void {
  const lx = Math.min(x0, x1), hx = Math.max(x0, x1), lz = Math.min(z0, z1), hz = Math.max(z0, z1);
  cb.box(wtMat('canal_bed'), { x: (lx + hx) / 2, y: floorY - 0.2, z: (lz + hz) / 2, sx: hx - lx, sy: 0.4, sz: hz - lz }, { castShadow: false });
  cb.collider({ shape: 'box', x: (lx + hx) / 2, y: floorY - 0.2, z: (lz + hz) / 2, hx: (hx - lx) / 2, hy: 0.2, hz: (hz - lz) / 2, walkable: true, solid: false, surface: 'water' });
  sheets.rect(water, lx, lz, hx, hz, level);
}

/** Low parapet (solid, not walkable) along a segment at street level. */
export function parapet(cb: ContentBuilder, mat: WTMaterialName, ax: number, az: number, bx: number, bz: number, y: number, h = 0.75, t = 0.45, cap: WTMaterialName | null = 'snow'): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.1) return;
  const yaw = Math.atan2(-(bz - az), bx - ax);
  const cx = (ax + bx) / 2, cz = (az + bz) / 2;
  cb.box(wtMat(mat), { x: cx, y: y + h / 2, z: cz, sx: len, sy: h, sz: t, yaw }, { collide: true, walkable: false });
  if (cap) {
    const p = pillow(len + 0.1, t + 0.16, 0.22, 0.1, 1);
    cb.mesh(wtMat(cap), p, { x: cx, y: y + h - 0.04, z: cz, yaw });
    p.dispose();
  }
}

/** Coping strip along a canal edge (visual only, flush with the street). */
export function coping(cb: ContentBuilder, ax: number, az: number, bx: number, bz: number, y: number, w = 0.6): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.1) return;
  const yaw = Math.atan2(-(bz - az), bx - ax);
  cb.box(wtMat('ice_trim'), { x: (ax + bx) / 2, y: y - 0.12, z: (az + bz) / 2, sx: len, sy: 0.3, sz: w, yaw }, { castShadow: false });
}

/** Straight stair flight with a ramp collider, plus side cheeks. `from` = bottom of first step, `to` = top landing. */
export function flight(cb: ContentBuilder, from: THREE.Vector3, to: THREE.Vector3, width: number, mat: WTMaterialName = 'ice_trim', cheeks: WTMaterialName | null = 'ice_wall', surface: SurfaceType = 'ice'): void {
  cb.stairs({ from, to, width, material: wtMat(mat), stepHeight: 0.25, surface });
  if (!cheeks) return;
  const dx = to.x - from.x, dz = to.z - from.z;
  const run = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx);
  const nx = Math.sin(yaw), nz = Math.cos(yaw); // local +Z (perpendicular)
  const rise = to.y - from.y;
  for (const side of [-1, 1]) {
    const ox = nx * side * (width / 2 + 0.25), oz = nz * side * (width / 2 + 0.25);
    // cheek wall as a sloped box
    const len = Math.hypot(run, rise);
    const pitchRoll = Math.atan2(rise, run);
    cb.box(wtMat(cheeks), { x: (from.x + to.x) / 2 + ox, y: from.y + rise / 2 + 0.35, z: (from.z + to.z) / 2 + oz, sx: len, sy: 0.7, sz: 0.5, yaw, roll: pitchRoll });
  }
}

// ---------------------------------------------------------------------------
// Bridges
// ---------------------------------------------------------------------------

/**
 * Vault under an arched deck: x across the span (±(span/2 + extra)), y = 0 at
 * the base, top edge follows the deck underside (endDrop at the ends, + rise
 * at mid-span), with an arched opening notched from the base. Extruded along Z.
 */
export function bridgeVault(span: number, extra: number, endDrop: number, rise: number, openW: number, openH: number, depth: number, segs = 10): THREE.BufferGeometry {
  const L = span / 2 + extra;
  const r = openW / 2;
  // Semicircular head when tall enough, otherwise a flattened (elliptic) arch.
  const ry = Math.min(r, openH);
  const springY = Math.max(0, openH - ry);
  const s = new THREE.Shape();
  s.moveTo(-L, 0);
  s.lineTo(-r, 0);
  s.lineTo(-r, springY);
  for (let i = 1; i < segs; i++) {
    const a = Math.PI - (i / segs) * Math.PI;
    s.lineTo(Math.cos(a) * r, springY + Math.sin(a) * ry);
  }
  s.lineTo(r, springY);
  s.lineTo(r, 0);
  s.lineTo(L, 0);
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const x = L - (i / n) * 2 * L;
    const t = Math.max(0, Math.min(1, (x + span / 2) / span));
    s.lineTo(x, endDrop + rise * 4 * t * (1 - t) - 0.02);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: segs });
  g.translate(0, 0, -depth / 2);
  return g;
}

export interface IceBridgeOpts {
  a: THREE.Vector3;
  b: THREE.Vector3;
  width: number;
  /** Extra height at mid-span. */
  arch: number;
  /** Bottom of the vault (canal bed / water). */
  baseY: number;
  parapet?: number;
  emblem?: boolean;
  deck?: WTMaterialName;
  wall?: WTMaterialName;
  surface?: SurfaceType;
}

/**
 * Arched ice bridge: walkable deck (ramp colliders per segment), solid
 * parapets, an arch vault underneath and optional emblem medallions.
 */
export function iceBridge(cb: ContentBuilder, o: IceBridgeOpts): void {
  const deckMat = o.deck ?? 'paving';
  const wallMat = o.wall ?? 'ice_wall';
  const len = Math.hypot(o.b.x - o.a.x, o.b.z - o.a.z);
  const yaw = Math.atan2(-(o.b.z - o.a.z), o.b.x - o.a.x);
  const ux = Math.cos(yaw), uz = -Math.sin(yaw); // along
  const nx = -uz, nz = ux; // across (local +Z)
  const segs = Math.max(2, Math.ceil(len / (o.arch > 0.05 ? 1.6 : 4)));
  const archY = (t: number) => o.arch * 4 * t * (1 - t);
  const deckY = (t: number) => o.a.y + (o.b.y - o.a.y) * t + archY(t);
  const ph = o.parapet ?? 0.9;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs, tm = (t0 + t1) / 2;
    const y0 = deckY(t0), y1 = deckY(t1), ym = (y0 + y1) / 2;
    const px = o.a.x + (o.b.x - o.a.x) * tm, pz = o.a.z + (o.b.z - o.a.z) * tm;
    const segLen = len / segs;
    const pitch = Math.atan2(y1 - y0, segLen);
    const dl = Math.hypot(segLen, y1 - y0) + 0.1;
    cb.box(wtMat(deckMat), { x: px, y: ym - 0.3, z: pz, sx: dl, sy: 0.6, sz: o.width, yaw, roll: pitch });
    const rise = Math.abs(y1 - y0);
    const hi = Math.max(y0, y1);
    const hy = rise / 2 + 0.3;
    cb.collider({ shape: 'box', x: px, y: hi - hy, z: pz, hx: segLen / 2 + 0.06, hy, hz: o.width / 2, yaw: y1 >= y0 ? yaw : yaw + Math.PI, slopeRise: rise > 0.01 ? rise : 0, walkable: true, solid: true, surface: o.surface ?? 'ice' });
    if (ph > 0) {
      for (const side of [-1, 1]) {
        const rx = px + nx * side * (o.width / 2 - 0.22), rz = pz + nz * side * (o.width / 2 - 0.22);
        cb.box(wtMat(wallMat), { x: rx, y: ym + ph / 2 - 0.05, z: rz, sx: dl, sy: ph + 0.1, sz: 0.44, yaw, roll: pitch });
        cb.collider({ shape: 'box', x: rx, y: ym + ph / 2, z: rz, hx: segLen / 2, hy: ph / 2 + 0.2, hz: 0.22, yaw, walkable: false, solid: true });
      }
    }
  }
  // Snow caps along the parapets (one pillow per side, slightly arched by segments).
  if (ph > 0) {
    const capSegs = Math.max(2, Math.ceil(segs / 2));
    for (let i = 0; i < capSegs; i++) {
      const t0 = i / capSegs, t1 = (i + 1) / capSegs, tm = (t0 + t1) / 2;
      const y0 = deckY(t0), y1 = deckY(t1);
      const pitch = Math.atan2(y1 - y0, len / capSegs);
      for (const side of [-1, 1]) {
        const g = pillow(Math.hypot(len / capSegs, y1 - y0) + 0.1, 0.62, 0.22, 0.1, 1);
        cb.mesh(wtMat('snow'), g, { x: o.a.x + (o.b.x - o.a.x) * tm + nx * side * (o.width / 2 - 0.22), y: (y0 + y1) / 2 + ph - 0.02, z: o.a.z + (o.b.z - o.a.z) * tm + nz * side * (o.width / 2 - 0.22), yaw, roll: pitch });
        g.dispose();
      }
    }
  }
  // Arch vault (visual): spans the gap under the deck with an arched opening; its top follows the deck curve.
  const endDrop = Math.min(o.a.y, o.b.y) - 0.6 - o.baseY;
  if (endDrop > 0.6) {
    const openW = Math.max(1, len - 2.4);
    const openH = Math.max(0.8, Math.min(endDrop + o.arch - 0.45, openW / 2 + endDrop * 0.5));
    const g = bridgeVault(len, 0.5, endDrop, o.arch, openW, openH, o.width - 0.1);
    cb.mesh(wtMat(wallMat), g, { x: (o.a.x + o.b.x) / 2, y: o.baseY, z: (o.a.z + o.b.z) / 2, yaw });
    g.dispose();
  }
  if (o.emblem) {
    const mid = deckY(0.5);
    for (const side of [-1, 1]) {
      const cx = (o.a.x + o.b.x) / 2 + nx * side * (o.width / 2 + 0.05), cz = (o.a.z + o.b.z) / 2 + nz * side * (o.width / 2 + 0.05);
      const faceYaw = yaw + (side > 0 ? 0 : Math.PI);
      const r = 1.25;
      const dsk = disc(r, 0.3, 28);
      cb.mesh(wtMat('ice_trim'), dsk, { x: cx, y: mid + 0.05, z: cz, yaw: faceYaw });
      dsk.dispose();
      const em = emblem(r * 0.85, 0.16, false);
      cb.mesh(wtMat('snow'), em, { x: cx + nx * side * 0.18, y: mid + 0.05, z: cz + nz * side * 0.18, yaw: faceYaw });
      em.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// Waterfalls
// ---------------------------------------------------------------------------

export interface FallInfo {
  x: number;
  z: number;
  topY: number;
  bottomY: number;
  width: number;
  /** Facing direction of the fall (unit XZ). */
  fx: number;
  fz: number;
}

/**
 * Falling-water sheet from (x, topY, z) down to bottomY, facing yaw (water
 * leaves the lip along local +Z), with a foam patch at the bottom.
 */
export function waterfall(cb: ContentBuilder, x: number, z: number, yaw: number, topY: number, bottomY: number, width: number, lip = 0.5, foam = true): FallInfo {
  const h = topY - bottomY;
  const sheet = waterfallSheet(width, h, lip, Math.max(2, Math.round(width / 2)), Math.max(4, Math.round(h / 1.2)));
  cb.mesh(wtWaterfall(), sheet, { x, y: topY, z, yaw }, { castShadow: false });
  sheet.dispose();
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  if (foam) {
    const fp = foamPatch(width, Math.max(1.5, Math.min(4, h * 0.45)));
    cb.mesh(wtFoam(), fp, { x: x + fx * lip * 0.9, y: bottomY + 0.03, z: z + fz * lip * 0.9, yaw }, { castShadow: false });
    fp.dispose();
  }
  return { x, z, topY, bottomY, width, fx, fz };
}

// ---------------------------------------------------------------------------
// Towers, lanterns, banners, boats, drifts
// ---------------------------------------------------------------------------

/** Round ice tower with a snow dome / bulb crown; solid collider; walkable top ring is not provided. */
export function roundTower(cb: ContentBuilder, x: number, z: number, baseY: number, r: number, h: number, crown: 'dome' | 'bulb' | 'flat' = 'bulb', windows = true): number {
  const body = new THREE.CylinderGeometry(r * 0.94, r, h, 20, 1);
  cb.mesh(wtMat('ice_massive'), body, { x, y: baseY + h / 2, z });
  body.dispose();
  for (const [yy, rr] of [[h * 0.45, 1.04], [h - 0.6, 1.08]] as const) {
    const band = new THREE.CylinderGeometry(r * 0.94 * rr, r * 0.94 * rr, 0.5, 20);
    cb.mesh(wtMat('ice_trim'), band, { x, y: baseY + yy, z });
    band.dispose();
  }
  // crenellated rim
  const n = Math.max(8, Math.round(r * 2.2));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    cb.box(wtMat('ice_massive'), { x: x + Math.cos(a) * r * 0.9, y: baseY + h + 0.5, z: z + Math.sin(a) * r * 0.9, sx: 1.1, sy: 1.0, sz: 0.7, yaw: -a + Math.PI / 2 });
  }
  let top = baseY + h + 1;
  if (crown === 'dome' || crown === 'bulb') {
    const d = crown === 'dome' ? dome(r * 0.78, 0.9, 18, 7) : bulbDome(r * 0.7, r * 1.7, 16);
    cb.mesh(wtMat(crown === 'dome' ? 'snow' : 'ice_trim'), d, { x, y: baseY + h, z });
    d.dispose();
    top = baseY + h + (crown === 'dome' ? r * 0.7 : r * 1.7);
  }
  if (windows) {
    const rows = Math.max(1, Math.floor(h / 7));
    for (let j = 0; j < rows; j++) {
      const yy = 4 + j * 7;
      const rad = r * (1 - (0.06 * yy) / h) + 0.02;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + j * 0.4;
        const g = archSlab(0.9, 1.6, 0.12, 6);
        cb.mesh(wtMat(j === rows - 1 && i % 2 === 0 ? 'window' : 'dark'), g, { x: x + Math.cos(a) * rad, y: baseY + yy, z: z + Math.sin(a) * rad, yaw: Math.PI / 2 - a }, { castShadow: false });
        g.dispose();
      }
    }
  }
  cb.collider({ shape: 'cylinder', x, y: baseY + h / 2, z, r, hy: h / 2, walkable: false, solid: true });
  return top;
}

/** Lantern on an ice post (instanced). (x, y, z) = ground point. */
export function lanternPost(cb: ContentBuilder, x: number, y: number, z: number, color: 'blue' | 'warm' = 'blue', h = 2.6): void {
  const m = new THREE.Matrix4().makeTranslation(x, y, z);
  cb.instance('wt_lantern_post', () => {
    const post = new THREE.CylinderGeometry(0.09, 0.13, h, 6);
    post.translate(0, h / 2, 0);
    const base = new THREE.CylinderGeometry(0.28, 0.32, 0.3, 8);
    base.translate(0, 0.15, 0);
    const arm = new THREE.BoxGeometry(0.7, 0.08, 0.08);
    arm.translate(0.25, h - 0.1, 0);
    return mergeParts([post, base, arm]);
  }, wtMat('ice_trim'), m);
  const lm = new THREE.Matrix4().makeTranslation(x + 0.52, y + h - 0.45, z);
  cb.instance(`wt_lantern_${color}`, () => {
    const body = new THREE.CylinderGeometry(0.2, 0.24, 0.5, 8);
    const cap = new THREE.ConeGeometry(0.28, 0.22, 8);
    cap.translate(0, 0.35, 0);
    return mergeParts([body, cap]);
  }, wtMat(color === 'blue' ? 'lantern_blue' : 'window'), lm, false);
  cb.collider({ shape: 'cylinder', x, y: y + h / 2, z, r: 0.18, hy: h / 2, walkable: false, solid: true });
}

/** Hanging banner (double-sided cloth) from a top bar. (x, topY, z), facing yaw. */
export function banner(cb: ContentBuilder, x: number, topY: number, z: number, yaw: number, w: number, h: number, mat: WTMaterialName = 'banner_water'): void {
  const g = new THREE.PlaneGeometry(w, h, 1, 4);
  // slight billow
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const yy = p.getY(i);
    p.setZ(i, Math.sin((yy / h + 0.5) * Math.PI) * 0.12);
  }
  g.computeVertexNormals();
  cb.mesh(wtMat(mat), g, { x, y: topY - h / 2, z, yaw }, { castShadow: false });
  g.dispose();
  const bar = new THREE.CylinderGeometry(0.06, 0.06, w + 0.4, 6);
  bar.rotateZ(Math.PI / 2);
  cb.mesh(wtMat('ice_trim'), bar, { x, y: topY + 0.05, z, yaw });
  bar.dispose();
}

/** Canal boat (instanced hull + dark floor + seats); waterline at y. */
export function canalBoat(cb: ContentBuilder, x: number, y: number, z: number, yaw: number, len = 5.2): void {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(len / 5.2, len / 5.2, len / 5.2));
  cb.instance('wt_boat_hull', () => hull(5.2, 1.35, 0.62), wtMat('wood'), m);
  cb.instance('wt_boat_trim', () => {
    const bow = new THREE.ConeGeometry(0.09, 0.9, 6);
    bow.rotateX(-0.5);
    bow.translate(0, 1.0, 2.55);
    const stern = new THREE.ConeGeometry(0.09, 0.8, 6);
    stern.rotateX(0.5);
    stern.translate(0, 0.95, -2.5);
    const seat1 = new THREE.BoxGeometry(1.1, 0.07, 0.3);
    seat1.translate(0, 0.45, 0.8);
    const seat2 = seat1.clone();
    seat2.translate(0, 0, -1.6);
    return mergeParts([bow, stern, seat1, seat2]);
  }, wtMat('bone'), m);
  cb.instance('wt_boat_floor', () => {
    const f = new THREE.BoxGeometry(0.8, 0.05, 3.6);
    f.translate(0, 0.12, 0);
    return f;
  }, wtMat('dark'), m, false);
}

/** Soft snow drift (visual only). Base at y. */
export function drift(cb: ContentBuilder, x: number, y: number, z: number, w: number, d: number, h: number, yaw = 0): void {
  const g = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  cb.mesh(wtMat('snow'), g, { x, y: y - 0.05, z, yaw, sx: w / 2, sy: h, sz: d / 2 }, { castShadow: false });
  g.dispose();
}

/** Ice crystal spike group (visual), base at y. */
export function iceSpikes(cb: ContentBuilder, x: number, y: number, z: number, h: number, seed: number, mat: WTMaterialName = 'ice_clear'): void {
  const parts: THREE.BufferGeometry[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const hh = h * (0.5 + rnd() * 0.6) * (i === 0 ? 1.2 : 1);
    const c = crystal(hh * 0.13, hh);
    const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : h * 0.18 * (0.5 + rnd());
    place(c, Math.cos(a) * d, -0.1, Math.sin(a) * d, rnd() * 3, 1, 1, 1, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5);
    parts.push(c);
  }
  const g = mergeParts(parts);
  cb.mesh(wtMat(mat), g, { x, y, z });
  g.dispose();
}

/** Crate / barrel stack props (instanced). */
export function barrel(cb: ContentBuilder, x: number, y: number, z: number, s = 1): void {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
  cb.instance('wt_barrel', () => {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 1.0, 10);
    g.translate(0, 0.5, 0);
    return g;
  }, wtMat('wood'), m);
}

export function crate(cb: ContentBuilder, x: number, y: number, z: number, yaw = 0, s = 1): void {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(s, s, s));
  cb.instance('wt_crate', () => {
    const g = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    g.translate(0, 0.45, 0);
    return g;
  }, wtMat('wood'), m);
}

/** Drying rack with hanging fish (SWT/NWT harbor). Base at y; along local X. */
export function dryingRack(cb: ContentBuilder, x: number, y: number, z: number, yaw: number, len = 3.2): void {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(len / 3.2, 1, 1));
  cb.instance('wt_rack', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1.5, 1.5]) {
      for (const sz of [-0.35, 0.35]) {
        const p = new THREE.CylinderGeometry(0.05, 0.06, 2.1, 5);
        place(p, sx, 1.0, 0, 0, 1, 1, 1, sz * 0.5, 0);
        parts.push(p);
      }
    }
    const bar = new THREE.CylinderGeometry(0.04, 0.04, 3.4, 5);
    bar.rotateZ(Math.PI / 2);
    bar.translate(0, 1.95, 0);
    parts.push(bar);
    return mergeParts(parts);
  }, wtMat('wood'), m);
  cb.instance('wt_rack_fish', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const f = new THREE.ConeGeometry(0.1, 0.6, 4);
      f.rotateX(Math.PI);
      f.scale(1, 1, 0.3);
      f.translate(-1.3 + i * 0.43, 1.6, 0);
      parts.push(f);
    }
    return mergeParts(parts);
  }, wtMat('fish'), m, false);
}
