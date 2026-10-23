import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceType } from '../../../core/types';
import type { ContentBuilder } from '../../kit/Builder';
import type { KitMaterialName } from '../../kit/Materials';
import type { FlameField } from './flames';
import {
  brazierBowlGeo,
  bushGeo,
  columnGeo,
  dragonGeo,
  eaveTipGeo,
  flameEmblemGeo,
  flameFinialGeo,
  hornGeo,
  mulberry,
  palmFrondsGeo,
  palmTrunkGeo,
  pineCanopyGeo,
  pineTrunkGeo,
  ringGeo,
  rockGeo,
  roofGeo,
  roundCanopyGeo,
  trunkGeo,
  willowCanopyGeo,
} from './geom';
import { bannerMat, barkMat, emberGlowMat, goldMat, jungleMat, lacquerRedMat, mapleMat, palmMat, paperMat, pineMat, willowMat } from './materials';

/**
 * Fire Nation architecture & prop assemblies on top of the shared kit
 * ContentBuilder. Every function adds merged geometry (or instances) plus the
 * matching colliders, so whatever is drawn is also what you collide with.
 *
 * Transform convention (same as the kit): yaw about +Y, local +X → (cos, -sin),
 * local +Z (front) → (sin, cos).
 */

export type Mat = KitMaterialName | THREE.Material;

// ---------------------------------------------------------------------------
// Shared prototypes (CPU-side only; ContentBuilder.mesh() clones them)
// ---------------------------------------------------------------------------

const protos = new Map<string, THREE.BufferGeometry>();
function proto(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = protos.get(key);
  if (!g) {
    g = make();
    protos.set(key, g);
  }
  return g;
}

export const P = {
  horn: () => proto('horn', hornGeo),
  tip: () => proto('tip', eaveTipGeo),
  emblem: () => proto('emblem', () => flameEmblemGeo(0.12)),
  finial: () => proto('finial', flameFinialGeo),
  column: () => proto('column', columnGeo),
  bowl: () => proto('bowl', brazierBowlGeo),
  dragon: () => proto('dragon', dragonGeo),
  crestRing: () => proto('crestRing', () => ringGeo(0.62, 0.5, 0.1, 28)),
  sphere: () => proto('sphere', () => new THREE.SphereGeometry(1, 10, 7)),
  cyl8: () => proto('cyl8', () => new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0)),
  cyl12: () => proto('cyl12', () => new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0)),
  cone8: () => proto('cone8', () => new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0)),
};

/** Release cached prototypes (full shutdown only). */
export function disposeFirePrototypes(): void {
  for (const g of protos.values()) g.dispose();
  protos.clear();
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/** World XZ of a local offset (lx right, lz forward) from (x,z) rotated by yaw. */
export function local(x: number, z: number, yaw: number, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}

/** Yaw that makes local +Z point from (x,z) toward (tx,tz). */
export function yawTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

// ---------------------------------------------------------------------------
// Ground, slabs and walkable masks
// ---------------------------------------------------------------------------

/** Paved slab (visual + walkable collider). Top at `top`, rect in local frame around (x,z). */
export function slab(b: ContentBuilder, mat: Mat, o: { x: number; z: number; w: number; d: number; top: number; thick?: number; yaw?: number; surface?: SurfaceType; collide?: boolean }): void {
  const th = o.thick ?? 0.6;
  b.box(mat, { x: o.x, y: o.top - th / 2, z: o.z, sx: o.w, sy: th, sz: o.d, yaw: o.yaw ?? 0 }, { collide: o.collide ?? true, walkable: true, surface: o.surface ?? 'stone', castShadow: false });
}

/**
 * Fill a rectangle (axis-aligned, world) with walkable slabs except where
 * `hole(x,z)` is true, using row runs merged into rectangles (few colliders).
 * Visual boxes use `mat` (null = colliders only).
 */
export function maskSlab(
  b: ContentBuilder,
  mat: Mat | null,
  o: { x0: number; z0: number; x1: number; z1: number; cell: number; top: number; thick: number; surface?: SurfaceType },
  hole: (x: number, z: number) => boolean,
): void {
  const nx = Math.max(1, Math.round((o.x1 - o.x0) / o.cell));
  const nz = Math.max(1, Math.round((o.z1 - o.z0) / o.cell));
  const cx = (o.x1 - o.x0) / nx, cz = (o.z1 - o.z0) / nz;
  type Run = { i0: number; i1: number; j0: number };
  let open = new Map<string, Run>();
  const emit = (r: Run, j1: number) => {
    const x0 = o.x0 + r.i0 * cx, x1 = o.x0 + r.i1 * cx;
    const z0 = o.z0 + r.j0 * cz, z1 = o.z0 + j1 * cz;
    const w = x1 - x0, d = z1 - z0;
    if (mat) b.box(mat, { x: (x0 + x1) / 2, y: o.top - o.thick / 2, z: (z0 + z1) / 2, sx: w, sy: o.thick, sz: d }, { castShadow: false });
    b.collider({ shape: 'box', x: (x0 + x1) / 2, y: o.top - o.thick / 2, z: (z0 + z1) / 2, hx: w / 2, hy: o.thick / 2, hz: d / 2, yaw: 0, walkable: true, solid: true, surface: o.surface ?? 'stone' });
  };
  for (let j = 0; j <= nz; j++) {
    const runs: Array<[number, number]> = [];
    if (j < nz) {
      let start = -1;
      for (let i = 0; i <= nx; i++) {
        const solid = i < nx && !hole(o.x0 + (i + 0.5) * cx, o.z0 + (j + 0.5) * cz);
        if (solid && start < 0) start = i;
        else if (!solid && start >= 0) {
          runs.push([start, i]);
          start = -1;
        }
      }
    }
    const next = new Map<string, Run>();
    for (const [i0, i1] of runs) {
      const key = `${i0}:${i1}`;
      const prev = open.get(key);
      if (prev) {
        next.set(key, prev);
        open.delete(key);
      } else next.set(key, { i0, i1, j0: j });
    }
    for (const r of open.values()) emit(r, j);
    open = next;
  }
}

/**
 * Straight flight of steps with optional cheek walls. `from` = bottom front
 * edge centre (ground level), `to` = top landing edge centre. Uses the kit's
 * stairs (walkable ramp collider) and adds solid cheeks.
 */
export function flight(b: ContentBuilder, o: { from: THREE.Vector3; to: THREE.Vector3; width: number; mat: Mat; cheek?: Mat | null; cheekH?: number; step?: number; surface?: SurfaceType }): void {
  b.stairs({ from: o.from, to: o.to, width: o.width, material: o.mat, stepHeight: o.step ?? 0.2, surface: o.surface });
  if (o.cheek) {
    const dx = o.to.x - o.from.x, dz = o.to.z - o.from.z;
    const run = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const nx = -Math.sin(yaw), nz = -Math.cos(yaw); // perpendicular (local +Z of the stairs)
    const rise = o.to.y - o.from.y;
    const ch = o.cheekH ?? 0.9;
    for (const side of [-1, 1]) {
      const ox = nx * side * (o.width / 2 + 0.35), oz = nz * side * (o.width / 2 + 0.35);
      const pitch = Math.atan2(rise, run);
      const len = Math.hypot(run, rise);
      b.box(o.cheek, { x: (o.from.x + o.to.x) / 2 + ox, y: (o.from.y + o.to.y) / 2 + ch / 2, z: (o.from.z + o.to.z) / 2 + oz, sx: len + 0.4, sy: ch + 0.6, sz: 0.7, yaw, roll: pitch });
      // Collider: a solid box along the cheek (approximate the slope with a full-height box).
      b.collider({ shape: 'box', x: (o.from.x + o.to.x) / 2 + ox, y: (o.from.y + o.to.y) / 2 + ch / 2, z: (o.from.z + o.to.z) / 2 + oz, hx: run / 2, hy: rise / 2 + ch, hz: 0.35, yaw, walkable: false, solid: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

export interface RoofSpec {
  x: number;
  /** Eave height. */
  y: number;
  z: number;
  /** Footprint WITHOUT overhang. */
  w: number;
  d: number;
  /** Rise from eave to ridge. */
  h: number;
  yaw?: number;
  overhang?: number;
  curve?: number;
  style?: 'hip' | 'gable' | 'pyramid';
  mat?: Mat;
  trim?: Mat | null;
  ridge?: Mat | null;
  /** Gold curled horns at the ridge ends (size in m, 0 = none). */
  horns?: number;
  /** Gold upturned tips at the eave corners (size in m, 0 = none). */
  tips?: number;
  /** Flame emblem on the front of the ridge (size, 0 = none). */
  crest?: number;
  /** Apex finial for pyramid roofs (height, 0 = none). */
  finial?: number;
  segU?: number;
  segT?: number;
  thickness?: number;
}

/** Curved Fire Nation roof with gold trims and ornaments. Returns the ridge height. */
export function roof(b: ContentBuilder, o: RoofSpec): number {
  const ov = o.overhang ?? Math.min(2.2, Math.max(0.6, Math.min(o.w, o.d) * 0.16));
  const W = o.w + ov * 2, D = o.d + ov * 2;
  const style = o.style ?? 'hip';
  const curve = o.curve ?? Math.min(1.6, 0.35 + Math.min(W, D) * 0.05);
  const yaw = o.yaw ?? 0;
  const g = roofGeo(W, D, o.h, { style, curve, segU: o.segU ?? (W > 20 ? 8 : 5), segT: o.segT ?? 4, thickness: o.thickness ?? Math.min(0.5, 0.18 + W * 0.01) });
  b.mesh(o.mat ?? 'roof_dark', g.tiles, { x: o.x, y: o.y, z: o.z, yaw });
  if (o.trim !== null) b.mesh(o.trim ?? goldMat(), g.fascia, { x: o.x, y: o.y, z: o.z, yaw }, { castShadow: false });
  g.tiles.dispose();
  g.fascia.dispose();
  const top = o.y + o.h;
  const ridgeLen = style === 'gable' ? W : style === 'pyramid' ? 0 : Math.max(0.6, W - D);
  if (style !== 'pyramid' && o.ridge !== null) {
    const rh = Math.max(0.3, Math.min(0.9, W * 0.025));
    b.box(o.ridge ?? 'black_lacquer', { x: o.x, y: top + rh * 0.35, z: o.z, sx: ridgeLen + 0.2, sy: rh, sz: rh * 1.1, yaw });
    if (o.trim !== null) b.box(o.trim ?? goldMat(), { x: o.x, y: top + rh * 0.88, z: o.z, sx: ridgeLen + 0.25, sy: 0.08, sz: rh * 1.15, yaw }, { castShadow: false });
  }
  const hs = o.horns ?? 0;
  if (hs > 0 && style !== 'pyramid') {
    for (const side of [1, -1]) {
      const p = local(o.x, o.z, yaw, side * ridgeLen / 2, 0);
      b.mesh(goldMat(), P.horn(), { x: p.x, y: top + 0.1, z: p.z, yaw: yaw + (side > 0 ? 0 : Math.PI), sx: hs, sy: hs, sz: hs });
    }
  }
  const ts = o.tips ?? 0;
  if (ts > 0) {
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const p = local(o.x, o.z, yaw, (sx * W) / 2, (sz * D) / 2);
      // Point diagonally outward.
      const a = Math.atan2(-(sz * D), sx * W);
      b.mesh(goldMat(), P.tip(), { x: p.x, y: o.y + curve * 0.75, z: p.z, yaw: yaw + a, sx: ts, sy: ts, sz: ts }, { castShadow: false });
    }
  }
  const cs = o.crest ?? 0;
  if (cs > 0) {
    const p = local(o.x, o.z, yaw, 0, 0);
    b.mesh(goldMat(), P.emblem(), { x: p.x, y: top + 0.2, z: p.z, yaw, sx: cs, sy: cs, sz: cs * 2 });
  }
  const fs = o.finial ?? 0;
  if (fs > 0) {
    b.cylinder(goldMat(), { x: o.x, y: top - 0.2, z: o.z, r: 0.18 * fs, rTop: 0.06 * fs, h: fs * 0.45, segments: 8 });
    b.mesh(goldMat(), P.sphere(), { x: o.x, y: top + fs * 0.42, z: o.z, sx: 0.16 * fs, sy: 0.16 * fs, sz: 0.16 * fs });
    b.mesh(goldMat(), P.finial(), { x: o.x, y: top + fs * 0.5, z: o.z, yaw, sx: fs * 0.55, sy: fs * 0.55, sz: fs * 0.55 });
  }
  return top;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface HouseSpec {
  x: number;
  /** Floor (base) height. */
  y: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  floors?: number;
  wall?: Mat;
  upperWall?: Mat;
  roofMat?: Mat;
  post?: Mat;
  base?: Mat | null;
  /** Foundation depth below y (cliff / slope houses). */
  foundation?: number;
  seed?: number;
  ornate?: boolean;
  roofStyle?: 'hip' | 'gable';
  /** Collider: solid box with walkable roof landing (default true). */
  collide?: boolean;
}

/** City house: base, walls, posts, paper windows, door, 1–2 floors, curved roof. */
export function house(b: ContentBuilder, o: HouseSpec, detail?: ContentBuilder): void {
  const r = mulberry(o.seed ?? 1);
  const floors = o.floors ?? 1;
  const fh = 3.4;
  const h = floors * fh;
  const yaw = o.yaw;
  const wall = o.wall ?? 'plaster_cream';
  const post = o.post ?? lacquerRedMat();
  const found = o.foundation ?? 0.6;
  if (o.base !== null) b.block(o.base ?? 'stone_dark', { x: o.x, y: o.y - found, z: o.z, sx: o.w + 0.5, sy: found + 0.5, sz: o.d + 0.5, yaw });
  b.block(wall, { x: o.x, y: o.y + 0.5, z: o.z, sx: o.w, sy: fh - 0.5, sz: o.d, yaw });
  let top = o.y + fh;
  if (floors > 1) {
    // Overhanging upper floor with a skirt roof between floors.
    b.box('wood_dark', { x: o.x, y: top + 0.08, z: o.z, sx: o.w + 0.5, sy: 0.25, sz: o.d + 0.5, yaw });
    roof(b, { x: o.x, y: top - 0.05, z: o.z, w: o.w, d: o.d, h: 0.7, yaw, overhang: 0.75, curve: 0.25, mat: o.roofMat ?? 'roof_red', ridge: null, trim: o.ornate ? goldMat() : 'wood_dark', segU: 3, segT: 2 });
    b.block(o.upperWall ?? wall, { x: o.x, y: top + 0.2, z: o.z, sx: o.w - 0.4, sy: fh - 0.2, sz: o.d - 0.4, yaw });
    top += fh;
  }
  // Corner posts and a beam under the eaves.
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = o.x + c * sx * (o.w / 2) + s * sz * (o.d / 2);
    const pz = o.z - s * sx * (o.w / 2) + c * sz * (o.d / 2);
    b.box(post, { x: px, y: o.y + h / 2, z: pz, sx: 0.32, sy: h, sz: 0.32, yaw });
  }
  b.box('wood_dark', { x: o.x, y: top - 0.15, z: o.z, sx: o.w + 0.1, sy: 0.3, sz: o.d + 0.1, yaw });
  // Front: door + paper windows.
  const front = local(o.x, o.z, yaw, 0, o.d / 2 + 0.03);
  b.box('wood_red', { x: front.x, y: o.y + 1.15, z: front.z, sx: 1.3, sy: 2.2, sz: 0.08, yaw });
  for (let f = 0; f < floors; f++) {
    const wy = o.y + f * fh + (f === 0 ? 1.65 : 1.8);
    const nwin = Math.max(1, Math.floor(o.w / 3.2));
    for (let k = 0; k < nwin; k++) {
      const lx = -o.w / 2 + (k + 0.5) * (o.w / nwin);
      if (f === 0 && Math.abs(lx) < 1.2) continue;
      const p = local(o.x, o.z, yaw, lx, o.d / 2 + (f > 0 ? -0.17 : 0.03));
      (detail ?? b).box(paperMat(), { x: p.x, y: wy, z: p.z, sx: 1.05, sy: 0.95, sz: 0.06, yaw }, { castShadow: false });
    }
  }
  const roofH = Math.min(o.w, o.d) * (0.36 + r() * 0.08);
  const style = o.roofStyle ?? (r() < 0.35 ? 'gable' : 'hip');
  roof(b, {
    x: o.x,
    y: top,
    z: o.z,
    w: o.w,
    d: o.d,
    h: roofH,
    yaw,
    overhang: 0.9,
    curve: 0.55,
    style,
    mat: o.roofMat ?? 'roof_red',
    trim: o.ornate ? goldMat() : 'wood_dark',
    ridge: 'black_lacquer',
    horns: o.ornate ? 0.9 : 0,
    tips: o.ornate ? 0.6 : 0,
    segU: 4,
    segT: 3,
  });
  if (o.collide !== false) {
    const hy = (top + roofH * 0.45 - (o.y - found)) / 2;
    b.collider({ shape: 'box', x: o.x, y: o.y - found + hy, z: o.z, hx: o.w / 2 + 0.25, hy, hz: o.d / 2 + 0.25, yaw, walkable: true, solid: true, surface: 'stone' });
  }
}

export interface HallSpec {
  x: number;
  /** Floor height (top of plinth). */
  y: number;
  z: number;
  yaw: number;
  /** Enclosed body footprint. */
  w: number;
  d: number;
  /** Wall height of the main storey. */
  h: number;
  /** Veranda depth around the body (columns at the outer edge). */
  veranda?: number;
  colSpacing?: number;
  wall?: Mat;
  roofMat?: Mat;
  colMat?: Mat;
  /** Upper storey (smaller) with its own roof. */
  upper?: { h: number; inset: number; roofH: number };
  roofH?: number;
  horns?: number;
  crest?: number;
  /** Lattice panels on the front wall. */
  lattice?: boolean;
  /** Front doors (wide opening panel). */
  doors?: boolean;
  /** Solid collider for the body (default true). */
  collide?: boolean;
}

/** Grand hall: veranda columns, crimson body, gold bands, 1–2 tier curved roofs. Returns the top height. */
export function hall(b: ContentBuilder, o: HallSpec): number {
  const yaw = o.yaw;
  const ver = o.veranda ?? 2.5;
  const wall = o.wall ?? 'plaster_red';
  const colMat = o.colMat ?? lacquerRedMat();
  // Body.
  b.block(wall, { x: o.x, y: o.y, z: o.z, sx: o.w, sy: o.h, sz: o.d, yaw });
  // Gold band and dark frieze under the eaves.
  b.box('black_lacquer', { x: o.x, y: o.y + o.h - 0.6, z: o.z, sx: o.w + 0.1, sy: 1.2, sz: o.d + 0.1, yaw });
  b.box(goldMat(), { x: o.x, y: o.y + o.h - 1.25, z: o.z, sx: o.w + 0.14, sy: 0.14, sz: o.d + 0.14, yaw }, { castShadow: false });
  b.box(goldMat(), { x: o.x, y: o.y + 0.9, z: o.z, sx: o.w + 0.12, sy: 0.1, sz: o.d + 0.12, yaw }, { castShadow: false });
  if (o.collide !== false) b.collider({ shape: 'box', x: o.x, y: o.y + o.h / 2, z: o.z, hx: o.w / 2, hy: o.h / 2, hz: o.d / 2, yaw, walkable: false, solid: true });
  // Front lattice panels / doors.
  const front = (lx: number, off = 0.04) => local(o.x, o.z, yaw, lx, o.d / 2 + off);
  if (o.lattice !== false) {
    const bays = Math.max(3, Math.round(o.w / 4.2));
    for (let k = 0; k < bays; k++) {
      const lx = -o.w / 2 + (k + 0.5) * (o.w / bays);
      const p = front(lx);
      const isDoor = o.doors !== false && Math.abs(lx) < o.w / bays * 0.6;
      const ph = isDoor ? Math.min(o.h - 2.2, 5.2) : Math.min(o.h - 3.2, 3.6);
      const py = o.y + (isDoor ? ph / 2 + 0.05 : 1.3 + ph / 2);
      b.box(isDoor ? 'wood_red' : 'black_lacquer', { x: p.x, y: py, z: p.z, sx: (o.w / bays) * 0.7, sy: ph, sz: 0.1, yaw });
      const pf = front(lx, 0.1);
      b.box(goldMat(), { x: pf.x, y: py + ph / 2 + 0.06, z: pf.z, sx: (o.w / bays) * 0.74, sy: 0.12, sz: 0.06, yaw }, { castShadow: false });
      if (!isDoor) b.box(paperMat(), { x: pf.x, y: py, z: pf.z, sx: (o.w / bays) * 0.56, sy: ph * 0.7, sz: 0.04, yaw }, { castShadow: false });
    }
  }
  // Veranda columns.
  const W = o.w + ver * 2, D = o.d + ver * 2;
  if (ver > 0.5) {
    const sp = o.colSpacing ?? 4.5;
    const colR = Math.max(0.28, Math.min(0.55, o.h * 0.045));
    const nW = Math.max(2, Math.round(W / sp)), nD = Math.max(2, Math.round(D / sp));
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= nW; i++) pts.push([-W / 2 + (i * W) / nW, D / 2], [-W / 2 + (i * W) / nW, -D / 2]);
    for (let i = 1; i < nD; i++) pts.push([W / 2, -D / 2 + (i * D) / nD], [-W / 2, -D / 2 + (i * D) / nD]);
    for (const [lx, lz] of pts) {
      const p = local(o.x, o.z, yaw, lx, lz);
      b.mesh(colMat, P.column(), { x: p.x, y: o.y, z: p.z, sx: colR, sy: o.h, sz: colR });
      b.collider({ shape: 'cylinder', x: p.x, y: o.y + o.h / 2, z: p.z, r: colR + 0.05, hy: o.h / 2, walkable: false, solid: true });
    }
    // Architrave beams on the columns.
    for (const side of [1, -1]) {
      const p = local(o.x, o.z, yaw, 0, (side * D) / 2);
      b.box('black_lacquer', { x: p.x, y: o.y + o.h - 0.35, z: p.z, sx: W + 0.4, sy: 0.7, sz: 0.5, yaw });
      const q = local(o.x, o.z, yaw, (side * W) / 2, 0);
      b.box('black_lacquer', { x: q.x, y: o.y + o.h - 0.35, z: q.z, sx: 0.5, sy: 0.7, sz: D + 0.4, yaw });
    }
  }
  // Roofs.
  const horns = o.horns ?? Math.min(3.2, 0.9 + o.w * 0.04);
  const crest = o.crest ?? 0;
  let top: number;
  if (o.upper) {
    const u = o.upper;
    roof(b, { x: o.x, y: o.y + o.h, z: o.z, w: W, d: D, h: Math.max(1.2, Math.min(W, D) * 0.16), yaw, mat: o.roofMat, ridge: null, horns: 0, tips: horns * 0.45, overhang: 1.6, curve: 0.9, segU: 8, segT: 3 });
    const uw = o.w - u.inset * 2, ud = o.d - u.inset * 2;
    const uy = o.y + o.h + Math.max(1.0, Math.min(W, D) * 0.12);
    b.block(wall, { x: o.x, y: uy - 0.4, z: o.z, sx: uw, sy: u.h + 0.4, sz: ud, yaw });
    b.box('black_lacquer', { x: o.x, y: uy + u.h - 0.45, z: o.z, sx: uw + 0.1, sy: 0.9, sz: ud + 0.1, yaw });
    b.box(goldMat(), { x: o.x, y: uy + u.h - 0.95, z: o.z, sx: uw + 0.14, sy: 0.12, sz: ud + 0.14, yaw }, { castShadow: false });
    // Upper storey lattice band.
    for (const side of [1, -1]) {
      const p = local(o.x, o.z, yaw, 0, (side * ud) / 2 + side * 0.05);
      b.box(paperMat(), { x: p.x, y: uy + u.h * 0.45, z: p.z, sx: uw * 0.8, sy: u.h * 0.4, sz: 0.05, yaw }, { castShadow: false });
    }
    top = roof(b, { x: o.x, y: uy + u.h, z: o.z, w: uw, d: ud, h: u.roofH, yaw, mat: o.roofMat, horns, tips: horns * 0.5, crest, overhang: Math.min(3, uw * 0.1), curve: 1.2, segU: 8, segT: 5 });
  } else {
    top = roof(b, { x: o.x, y: o.y + o.h, z: o.z, w: W, d: D, h: o.roofH ?? Math.min(W, D) * 0.38, yaw, mat: o.roofMat, horns, tips: horns * 0.5, crest, overhang: 1.6, curve: 1.0, segU: 8, segT: 5 });
  }
  return top;
}

export interface PagodaSpec {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  /** Base storey width. */
  size: number;
  tiers: number;
  tierH?: number;
  shrink?: number;
  wall?: Mat;
  roofMat?: Mat;
  /** Spire height at the top. */
  spire?: number;
  collide?: boolean;
}

/** Multi-tier square pagoda with gold eave tips and a ringed spire. Returns the top height. */
export function pagodaTower(b: ContentBuilder, o: PagodaSpec): number {
  const yaw = o.yaw ?? 0;
  const tierH = o.tierH ?? o.size * 0.5;
  const shrink = o.shrink ?? 0.84;
  let y = o.y;
  let s = o.size;
  // Plinth.
  b.block('stone_dark', { x: o.x, y: y - 0.5, z: o.z, sx: s + 1.6, sy: 1.1, sz: s + 1.6, yaw });
  y += 0.6;
  for (let i = 0; i < o.tiers; i++) {
    const wh = i === 0 ? tierH * 1.25 : tierH;
    b.block(o.wall ?? 'plaster_red', { x: o.x, y, z: o.z, sx: s, sy: wh, sz: s, yaw });
    b.box('black_lacquer', { x: o.x, y: y + wh - 0.35, z: o.z, sx: s + 0.1, sy: 0.7, sz: s + 0.1, yaw });
    b.box(goldMat(), { x: o.x, y: y + wh - 0.75, z: o.z, sx: s + 0.14, sy: 0.1, sz: s + 0.14, yaw }, { castShadow: false });
    // Lattice windows on four sides.
    for (let k = 0; k < 4; k++) {
      const a = yaw + (k * Math.PI) / 2;
      const p = local(o.x, o.z, a, 0, s / 2 + 0.04);
      b.box(paperMat(), { x: p.x, y: y + wh * 0.5, z: p.z, sx: s * 0.42, sy: wh * 0.42, sz: 0.05, yaw: a }, { castShadow: false });
    }
    const rh = s * 0.22;
    roof(b, { x: o.x, y: y + wh, z: o.z, w: s, d: s, h: rh, yaw, style: 'pyramid', mat: o.roofMat ?? 'roof_dark', overhang: s * 0.24, curve: s * 0.09 + 0.3, tips: Math.max(0.5, s * 0.08), ridge: null, segU: 6, segT: 3 });
    y += wh + rh * 0.45;
    s *= shrink;
  }
  const sp = o.spire ?? o.size * 0.6;
  b.cylinder(goldMat(), { x: o.x, y: y - 0.2, z: o.z, r: 0.22, rTop: 0.08, h: sp, segments: 8 });
  for (let k = 0; k < 4; k++) b.cylinder(goldMat(), { x: o.x, y: y + sp * (0.15 + k * 0.13), z: o.z, r: 0.42 - k * 0.07, h: 0.12, segments: 10 });
  b.mesh(goldMat(), P.finial(), { x: o.x, y: y + sp - 0.2, z: o.z, yaw, sx: 0.9, sy: 0.9, sz: 0.9 });
  if (o.collide !== false) {
    const hy = (y - o.y) / 2;
    b.collider({ shape: 'box', x: o.x, y: o.y + hy, z: o.z, hx: o.size / 2 + 0.8, hy, hz: o.size / 2 + 0.8, yaw, walkable: false, solid: true });
  }
  return y + sp;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/** Crenellated parapet/wall along a polyline with a gold coping. Base `y` constant. */
export function parapet(b: ContentBuilder, pts: Array<{ x: number; z: number }>, o: { y: number; h: number; thick: number; mat?: Mat; cap?: Mat | null; merlons?: boolean; closed?: boolean; walkTop?: boolean }): void {
  const n = o.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 0.05) continue;
    const yaw = Math.atan2(-(c.z - a.z), c.x - a.x);
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
    b.box(o.mat ?? 'plaster_red', { x: mx, y: o.y + o.h / 2, z: mz, sx: len + o.thick, sy: o.h, sz: o.thick, yaw }, { collide: true, walkable: o.walkTop ?? false });
    if (o.cap !== null) b.box(o.cap ?? goldMat(), { x: mx, y: o.y + o.h + 0.06, z: mz, sx: len + o.thick + 0.1, sy: 0.12, sz: o.thick + 0.16, yaw }, { castShadow: false });
    if (o.merlons) {
      const count = Math.floor(len / 2.4);
      const cx = Math.cos(yaw), cz = -Math.sin(yaw);
      for (let k = 0; k < count; k++) {
        const along = -len / 2 + (k + 0.5) * (len / count);
        b.box(o.mat ?? 'plaster_red', { x: mx + cx * along, y: o.y + o.h + 0.5, z: mz + cz * along, sx: 1.1, sy: 0.9, sz: o.thick, yaw });
        b.box(o.cap ?? goldMat(), { x: mx + cx * along, y: o.y + o.h + 0.98, z: mz + cz * along, sx: 1.2, sy: 0.08, sz: o.thick + 0.1, yaw }, { castShadow: false });
      }
    }
  }
}

/** Wall following the terrain (top follows ground), with optional merlons. */
export function groundWall(b: ContentBuilder, pts: Array<{ x: number; z: number }>, o: { ground: (x: number, z: number) => number; h: number; thick: number; mat?: Mat; cap?: Mat | null; merlons?: boolean; seg?: number }): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const n = Math.max(1, Math.ceil(len / (o.seg ?? 6)));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const p0 = { x: a.x + (c.x - a.x) * t0, z: a.z + (c.z - a.z) * t0 };
      const p1 = { x: a.x + (c.x - a.x) * t1, z: a.z + (c.z - a.z) * t1 };
      const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
      const g0 = Math.min(o.ground(p0.x, p0.z), o.ground(p1.x, p1.z), o.ground(mx, mz)) - 1.2;
      const gTop = Math.max(o.ground(p0.x, p0.z), o.ground(p1.x, p1.z), o.ground(mx, mz)) + o.h;
      const sl = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const yaw = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
      b.box(o.mat ?? 'plaster_red', { x: mx, y: (g0 + gTop) / 2, z: mz, sx: sl + o.thick * 0.6, sy: gTop - g0, sz: o.thick, yaw }, { collide: true, walkable: true });
      if (o.cap !== null) b.box(o.cap ?? goldMat(), { x: mx, y: gTop + 0.06, z: mz, sx: sl + o.thick * 0.6, sy: 0.12, sz: o.thick + 0.14, yaw }, { castShadow: false });
      if (o.merlons) b.box(o.mat ?? 'plaster_red', { x: mx, y: gTop + 0.55, z: mz, sx: Math.min(1.2, sl * 0.45), sy: 1.0, sz: o.thick, yaw });
    }
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Bronze brazier with a live flame. style: tall pedestal, tripod or low bowl. */
export function brazier(b: ContentBuilder, flames: FlameField, o: { x: number; y: number; z: number; size?: number; style?: 'pedestal' | 'tripod' | 'bowl'; collide?: boolean }): void {
  const s = o.size ?? 1;
  const style = o.style ?? 'pedestal';
  let bowlY = o.y;
  if (style === 'pedestal') {
    b.cylinder('stone_dark', { x: o.x, y: o.y, z: o.z, r: 0.75 * s, rTop: 0.62 * s, h: 0.4 * s, segments: 8 });
    b.cylinder('bronze', { x: o.x, y: o.y + 0.4 * s, z: o.z, r: 0.22 * s, rTop: 0.3 * s, h: 1.2 * s, segments: 8 });
    bowlY = o.y + 1.6 * s;
  } else if (style === 'tripod') {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.box('bronze', { x: o.x + Math.cos(a) * 0.45 * s, y: o.y + 0.65 * s, z: o.z + Math.sin(a) * 0.45 * s, sx: 0.1 * s, sy: 1.35 * s, sz: 0.1 * s, yaw: -a, roll: 0.25 });
    }
    bowlY = o.y + 1.2 * s;
  }
  b.mesh('bronze', P.bowl(), { x: o.x, y: bowlY, z: o.z, sx: 0.7 * s, sy: 0.7 * s, sz: 0.7 * s });
  b.cylinder(emberGlowMat(), { x: o.x, y: bowlY + 0.3 * s, z: o.z, r: 0.55 * s, h: 0.06, segments: 10 }, {});
  flames.add(o.x, bowlY + 0.3 * s, o.z, 1.3 * s, 2.0 * s);
  if (o.collide !== false) b.collider({ shape: 'cylinder', x: o.x, y: o.y + (bowlY - o.y + 0.5 * s) / 2, z: o.z, r: 0.7 * s, hy: (bowlY - o.y + 0.5 * s) / 2, walkable: false, solid: true });
}

/** Tall banner pole with a hanging fire-emblem banner facing local +Z. */
export function bannerPole(b: ContentBuilder, o: { x: number; y: number; z: number; yaw: number; h?: number; w?: number; len?: number; mat?: THREE.Material; collide?: boolean }): void {
  const h = o.h ?? 9;
  const w = o.w ?? 1.8;
  const len = o.len ?? Math.min(h * 0.6, 5.5);
  b.cylinder('black_lacquer', { x: o.x, y: o.y, z: o.z, r: 0.12, rTop: 0.09, h, segments: 8 });
  b.cylinder('stone_dark', { x: o.x, y: o.y, z: o.z, r: 0.45, rTop: 0.35, h: 0.5, segments: 8 });
  b.mesh(goldMat(), P.finial(), { x: o.x, y: o.y + h - 0.05, z: o.z, yaw: o.yaw, sx: 0.55, sy: 0.55, sz: 0.55 }, { castShadow: false });
  // Crossbar and banner (offset slightly in front of the pole).
  const p = local(o.x, o.z, o.yaw, 0, 0.16);
  b.box(goldMat(), { x: p.x, y: o.y + h - 0.55, z: p.z, sx: w + 0.3, sy: 0.1, sz: 0.1, yaw: o.yaw }, { castShadow: false });
  const plane = new THREE.PlaneGeometry(w, len);
  b.mesh(o.mat ?? bannerMat(), plane, { x: p.x, y: o.y + h - 0.6 - len / 2, z: p.z, yaw: o.yaw }, { castShadow: false });
  plane.dispose();
  if (o.collide !== false) b.collider({ shape: 'cylinder', x: o.x, y: o.y + 1.5, z: o.z, r: 0.45, hy: 1.5, walkable: false, solid: true });
}

/** Banner hanging flat on a wall (front faces local +Z). */
export function wallBanner(b: ContentBuilder, o: { x: number; y: number; z: number; yaw: number; w: number; len: number; mat?: THREE.Material }): void {
  const plane = new THREE.PlaneGeometry(o.w, o.len);
  b.mesh(o.mat ?? bannerMat(), plane, { x: o.x, y: o.y - o.len / 2, z: o.z, yaw: o.yaw }, { castShadow: false });
  plane.dispose();
  b.box(goldMat(), { x: o.x, y: o.y + 0.05, z: o.z, sx: o.w + 0.25, sy: 0.12, sz: 0.12, yaw: o.yaw }, { castShadow: false });
}

/** Gold flame crest in a ring (gates, palace front). Faces local +Z. */
export function crest(b: ContentBuilder, o: { x: number; y: number; z: number; yaw: number; size: number }): void {
  b.mesh(goldMat(), P.crestRing(), { x: o.x, y: o.y, z: o.z, yaw: o.yaw, sx: o.size, sy: o.size, sz: 1 });
  b.mesh(goldMat(), P.emblem(), { x: o.x, y: o.y - o.size * 0.5, z: o.z, yaw: o.yaw, sx: o.size * 0.9, sy: o.size * 0.9, sz: 1.2 });
  b.mesh('black_lacquer', P.cyl12(), { x: o.x, y: o.y, z: o.z, pitch: Math.PI / 2, sx: o.size * 0.66, sy: 0.06, sz: o.size * 0.66 });
}

/** Stone lantern (tōrō style) — instanced. */
export function stoneLantern(b: ContentBuilder, o: { x: number; y: number; z: number; s?: number; collide?: boolean }): void {
  const s = o.s ?? 1;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y, o.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
  b.instance('fire_stone_lantern', () => stoneLanternGeo(), 'stone_grey', m);
  b.instance('fire_stone_lantern_glow', () => {
    const g = new THREE.BoxGeometry(0.36, 0.3, 0.36);
    g.translate(0, 1.15, 0);
    return g;
  }, 'lantern_warm', m, false);
  if (o.collide !== false) b.collider({ shape: 'cylinder', x: o.x, y: o.y + 0.8 * s, z: o.z, r: 0.35 * s, hy: 0.8 * s, walkable: false, solid: true });
}

function stoneLanternGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, y: number) => {
    g.translate(0, y, 0);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  add(new THREE.CylinderGeometry(0.32, 0.4, 0.2, 6), 0.1);
  add(new THREE.CylinderGeometry(0.1, 0.12, 0.65, 6), 0.52);
  add(new THREE.CylinderGeometry(0.34, 0.24, 0.14, 6), 0.9);
  // Light box frame posts.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const g = new THREE.BoxGeometry(0.07, 0.34, 0.07);
    g.translate(Math.cos(a) * 0.2, 1.15, Math.sin(a) * 0.2);
    parts.push(g.toNonIndexed());
  }
  add(new THREE.ConeGeometry(0.46, 0.32, 6), 1.47);
  add(new THREE.SphereGeometry(0.07, 5, 4), 1.68);
  return mergeAll(parts);
}

/** Red paper lantern hanging from a bracket post (instanced). */
export function lanternPost(b: ContentBuilder, o: { x: number; y: number; z: number; yaw?: number; h?: number; collide?: boolean }): void {
  const h = o.h ?? 3.2;
  const yaw = o.yaw ?? 0;
  b.cylinder('black_lacquer', { x: o.x, y: o.y, z: o.z, r: 0.08, h, segments: 6 });
  const p = local(o.x, o.z, yaw, 0, 0.5);
  b.box('black_lacquer', { x: (o.x + p.x) / 2, y: o.y + h - 0.1, z: (o.z + p.z) / 2, sx: 0.08, sy: 0.08, sz: 0.62, yaw });
  hangingLantern(b, { x: p.x, y: o.y + h - 0.65, z: p.z });
  if (o.collide !== false) b.collider({ shape: 'cylinder', x: o.x, y: o.y + h / 2, z: o.z, r: 0.18, hy: h / 2, walkable: false, solid: true });
}

/** Red paper lantern with gold caps (instanced, no collider). (x,y,z) = lantern centre. */
export function hangingLantern(b: ContentBuilder, o: { x: number; y: number; z: number; s?: number }): void {
  const s = o.s ?? 1;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y, o.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
  b.instance('fire_lantern_body', () => {
    const g = new THREE.SphereGeometry(0.28, 8, 6);
    g.scale(1, 1.25, 1);
    return g;
  }, 'lantern_red', m, false);
  b.instance('fire_lantern_caps', () => {
    const a = new THREE.CylinderGeometry(0.16, 0.18, 0.08, 8);
    a.translate(0, 0.36, 0);
    const c = new THREE.CylinderGeometry(0.18, 0.16, 0.08, 8);
    c.translate(0, -0.36, 0);
    return mergeAll([a.toNonIndexed(), c.toNonIndexed()]);
  }, goldMat(), m, false);
}

export type TreeKind = 'pine' | 'willow' | 'maple' | 'palm' | 'jungle' | 'bush';

/** Instanced tree (trunk + canopy) with a trunk collider. s = total height (m). */
export function tree(b: ContentBuilder, kind: TreeKind, o: { x: number; y: number; z: number; s: number; yaw?: number; variant?: number; collide?: boolean }): void {
  const v = (o.variant ?? 0) % 3;
  const yaw = o.yaw ?? 0;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y, o.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(o.s, o.s, o.s));
  const seed = 100 + v * 17;
  switch (kind) {
    case 'pine':
      b.instance(`fire_pine_trunk_${v}`, () => pineTrunkGeo(seed), barkMat(), m);
      b.instance(`fire_pine_leaves_${v}`, () => pineCanopyGeo(seed), pineMat(), m);
      break;
    case 'willow':
      b.instance(`fire_willow_trunk`, () => trunkGeo(), barkMat(), m);
      b.instance(`fire_willow_leaves_${v}`, () => willowCanopyGeo(seed), willowMat(), m);
      break;
    case 'maple':
      b.instance(`fire_maple_trunk`, () => trunkGeo(), barkMat(), m);
      b.instance(`fire_maple_leaves_${v}`, () => roundCanopyGeo(seed), mapleMat(), m);
      break;
    case 'palm':
      b.instance(`fire_palm_trunk_${v}`, () => palmTrunkGeo(seed), barkMat(), m);
      b.instance(`fire_palm_fronds_${v}`, () => palmFrondsGeo(seed), palmMat(), m);
      break;
    case 'jungle':
      b.instance(`fire_jungle_trunk`, () => trunkGeo(), barkMat(), m);
      b.instance(`fire_jungle_leaves_${v}`, () => roundCanopyGeo(seed + 5), jungleMat(), m);
      break;
    case 'bush':
      b.instance(`fire_bush_${v}`, () => bushGeo(seed), jungleMat(), m);
      return;
  }
  if (o.collide !== false) b.collider({ shape: 'cylinder', x: o.x, y: o.y + 1.5, z: o.z, r: Math.max(0.25, o.s * 0.035), hy: 1.5, walkable: false, solid: true });
}

/** Rock / boulder (instanced, optional collider). */
export function rock(b: ContentBuilder, o: { x: number; y: number; z: number; s: number; sy?: number; yaw?: number; variant?: number; mat?: Mat; collide?: boolean }): void {
  const v = (o.variant ?? 0) % 4;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y, o.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw ?? 0), new THREE.Vector3(o.s, o.sy ?? o.s * 0.7, o.s));
  const matKey = typeof o.mat === 'string' ? o.mat : o.mat ? o.mat.uuid.slice(0, 8) : 'stone_grey';
  b.instance(`fire_rock_${v}_${matKey}`, () => rockGeo(31 + v * 13), o.mat ?? 'stone_grey', m);
  if (o.collide) b.collider({ shape: 'cylinder', x: o.x, y: o.y + (o.sy ?? o.s * 0.7) * 0.4, z: o.z, r: o.s * 0.85, hy: (o.sy ?? o.s * 0.7) * 0.6, walkable: true, solid: true, surface: 'rock' });
}

/** Coiled dragon statue on a pedestal (faces local +Z). */
export function dragonStatue(b: ContentBuilder, o: { x: number; y: number; z: number; yaw: number; s: number; mat?: Mat; pedestal?: Mat | null; pedestalH?: number }): void {
  const ph = o.pedestal === null ? 0 : (o.pedestalH ?? o.s * 0.35);
  if (o.pedestal !== null) {
    b.block(o.pedestal ?? 'stone_dark', { x: o.x, y: o.y, z: o.z, sx: o.s * 0.8, sy: ph, sz: o.s * 0.8, yaw: o.yaw });
    b.box(goldMat(), { x: o.x, y: o.y + ph - 0.08, z: o.z, sx: o.s * 0.84, sy: 0.12, sz: o.s * 0.84, yaw: o.yaw }, { castShadow: false });
  }
  b.mesh(o.mat ?? goldMat(), P.dragon(), { x: o.x, y: o.y + ph, z: o.z, yaw: o.yaw, sx: o.s, sy: o.s, sz: o.s });
  b.collider({ shape: 'box', x: o.x, y: o.y + (ph + o.s) / 2, z: o.z, hx: o.s * 0.42, hy: (ph + o.s) / 2, hz: o.s * 0.42, yaw: o.yaw, walkable: false, solid: true });
}

/** Crates & barrels cluster (instanced). */
export function cargo(b: ContentBuilder, o: { x: number; y: number; z: number; yaw?: number; seed: number; n?: number; collide?: boolean }): void {
  const r = mulberry(o.seed);
  const n = o.n ?? 4;
  for (let i = 0; i < n; i++) {
    const p = local(o.x, o.z, o.yaw ?? 0, (r() - 0.5) * 3, (r() - 0.5) * 2);
    const isBarrel = r() < 0.4;
    const s = 0.8 + r() * 0.4;
    const stack = !isBarrel && r() < 0.3 ? 1 : 0;
    for (let k = 0; k <= stack; k++) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, o.y + k * s, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI), new THREE.Vector3(s, s, s));
      if (isBarrel)
        b.instance('fire_barrel', () => {
          const g = new THREE.CylinderGeometry(0.38, 0.38, 0.95, 10);
          g.translate(0, 0.475, 0);
          return g;
        }, 'wood_dark', m);
      else
        b.instance('fire_crate', () => {
          const g = new THREE.BoxGeometry(0.95, 0.95, 0.95);
          g.translate(0, 0.475, 0);
          return g;
        }, 'wood', m);
    }
    if (o.collide !== false) b.collider({ shape: 'box', x: p.x, y: o.y + (stack + 1) * s * 0.5, z: p.z, hx: 0.5 * s, hy: (stack + 1) * s * 0.5, hz: 0.5 * s, yaw: 0, walkable: true, solid: true, surface: 'wood' });
  }
}

/**
 * Market stall with an awning. Front (counter) faces local +Z; the merchant
 * stands behind the counter at local z ≈ -0.15 (keep in sync with spots).
 */
export function stall(b: ContentBuilder, o: { x: number; y: number; z: number; yaw: number; w?: number; awning?: THREE.Material | Mat; seed: number }): void {
  const w = o.w ?? 4;
  const d = 2.6;
  const yaw = o.yaw;
  // Counter.
  const cpos = local(o.x, o.z, yaw, 0, 0.85);
  b.box('wood_dark', { x: cpos.x, y: o.y + 0.5, z: cpos.z, sx: w, sy: 1.0, sz: 0.7, yaw }, { collide: true, walkable: true, surface: 'wood' });
  b.box('wood', { x: cpos.x, y: o.y + 1.04, z: cpos.z, sx: w + 0.1, sy: 0.08, sz: 0.8, yaw });
  // Posts and awning.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = local(o.x, o.z, yaw, (sx * w) / 2, (sz * d) / 2);
    b.box('wood_dark', { x: p.x, y: o.y + 1.3, z: p.z, sx: 0.14, sy: 2.6, sz: 0.14, yaw });
  }
  const aw = local(o.x, o.z, yaw, 0, 0.2);
  b.box(o.awning ?? 'cloth_red', { x: aw.x, y: o.y + 2.75, z: aw.z, sx: w + 0.6, sy: 0.06, sz: d + 0.9, yaw, pitch: 0.18 });
  // Goods at the back.
  const gp = local(o.x, o.z, yaw, 0, -1.35);
  cargo(b, { x: gp.x, y: o.y, z: gp.z, yaw, seed: o.seed, n: 2, collide: false });
  b.collider({ shape: 'box', x: gp.x, y: o.y + 1, z: gp.z, hx: w / 2, hy: 1, hz: 0.45, yaw, walkable: false, solid: true });
}

// ---------------------------------------------------------------------------

export function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.map((g) => {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    return g;
  });
  const merged = mergeGeometriesSafe(list);
  for (const g of list) g.dispose();
  return merged;
}

function mergeGeometriesSafe(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const allIndexed = list.every((g) => !!g.index);
  const norm = allIndexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of norm) for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  return mergeGeometries(norm, false)!;
}
