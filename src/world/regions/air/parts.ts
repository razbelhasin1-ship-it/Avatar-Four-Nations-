import * as THREE from 'three';
import type { WaterSourceDef } from '../../../combat/WaterSources';
import type { GameContext } from '../../../core/GameContext';
import type { SurfaceType } from '../../../core/types';
import { ContentBuilder, matrixFor } from '../../kit/Builder';
import type { KitMaterialName } from '../../kit/Materials';
import * as G from './geom';
import { airMat, type AirMaterialName } from './materials';

/**
 * Air Nomad architecture parts built on the shared ContentBuilder kit:
 * round towers with conical teal roofs, the great spire, balustrades and
 * parapets, straight and curved stairs (with ramp colliders), arcades, moon
 * gates, raised pools/fountains/waterfalls (registered water sources), and
 * props (lanterns, prayer flags, banners, bonsai pines, hay, statues).
 *
 * Every walkable surface gets a matching walkable collider; walls, railings
 * and props get solid colliders. Visual-only pieces never collide.
 */

export type Mat = KitMaterialName | THREE.Material;
export interface P2 {
  x: number;
  z: number;
}

/** Builders of one zone: architecture (always), props (hidden when far), extras (hidden when far or on low settings). */
export interface Kit {
  ctx: GameContext;
  main: ContentBuilder;
  props: ContentBuilder;
  extra: ContentBuilder;
  /** Standalone meshes (water) owned by the zone. */
  addMesh(mesh: THREE.Object3D, group?: 'main' | 'props' | 'extra'): void;
  /** Register a water source owned by the region (unregistered on dispose). */
  registerWater(def: WaterSourceDef): void;
}

export const am = (n: AirMaterialName): THREE.Material => airMat(n);

/** Yaw such that local +X points along (dx, dz). */
export function alongYaw(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/** Yaw such that local +Z (front) faces (dx, dz). */
export function faceYaw(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

const tmpM = new THREE.Matrix4();

function inst(b: ContentBuilder, key: string, factory: () => THREE.BufferGeometry, mat: Mat, t: Parameters<typeof matrixFor>[0], castShadow = true): void {
  b.instance(key, factory, mat as any, matrixFor(t, tmpM), castShadow);
}

// ---------------------------------------------------------------------------
// Towers
// ---------------------------------------------------------------------------

export interface TowerOpts {
  x: number;
  z: number;
  /** Base (floor) height of the shaft. */
  y: number;
  r: number;
  h: number;
  roofH?: number;
  wall?: Mat;
  band?: Mat;
  bands?: number;
  windows?: number;
  finial?: number;
  /** Foundation depth below y (towers standing on slopes/cliffs). */
  base?: number;
  balcony?: boolean;
  segments?: number;
  collide?: boolean;
  /** Door facing (yaw) — adds a portal with a small roof. */
  door?: number;
}

/** Round tower with banding, windows, cone roof and gold finial. Returns the apex height. */
export function roundTower(k: Kit, o: TowerOpts): number {
  const seg = o.segments ?? 20;
  const wall = o.wall ?? 'plaster_cream';
  const band = o.band ?? 'stone_white';
  const roofH = o.roofH ?? o.r * 2.3;
  const b = k.main;
  if (o.base && o.base > 0) {
    b.cylinder('stone_white', { x: o.x, z: o.z, y: o.y - o.base, r: o.r * 1.14, rTop: o.r * 1.06, h: o.base + 0.05, segments: seg });
  }
  b.cylinder('stone_white', { x: o.x, z: o.z, y: o.y, r: o.r + 0.3, h: 0.9, segments: seg });
  b.cylinder(wall, { x: o.x, z: o.z, y: o.y + 0.9, r: o.r, h: o.h - 0.9, segments: seg });
  const nb = o.bands ?? Math.max(1, Math.floor(o.h / 5));
  for (let i = 1; i <= nb; i++) {
    const by = o.y + (o.h * i) / (nb + 1);
    b.cylinder(band, { x: o.x, z: o.z, y: by, r: o.r + 0.1, h: 0.32, segments: seg });
  }
  b.cylinder('stone_white', { x: o.x, z: o.z, y: o.y + o.h - 0.5, r: o.r + 0.32, h: 0.5, segments: seg });
  if (o.balcony) {
    const by = o.y + o.h * 0.78;
    b.cylinder('stone_white', { x: o.x, z: o.z, y: by, r: o.r + 1.0, h: 0.35, segments: seg });
    const n = Math.max(10, Math.round(((o.r + 0.9) * Math.PI * 2) / 0.6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      inst(k.props, 'tower_baluster', () => new THREE.CylinderGeometry(0.06, 0.07, 0.7, 5), 'stone_white', { x: o.x + Math.cos(a) * (o.r + 0.85), y: by + 0.7, z: o.z + Math.sin(a) * (o.r + 0.85) }, false);
    }
    b.cylinder('stone_white', { x: o.x, z: o.z, y: by + 1.05, r: o.r + 0.95, rTop: o.r + 0.95, h: 0.14, segments: seg });
  }
  const roof = G.coneRoof(o.r + 0.32, roofH, { segments: seg + 4 });
  b.mesh(am('roof'), roof, { x: o.x, y: o.y + o.h, z: o.z });
  roof.dispose();
  if ((o.finial ?? 1) > 0) {
    const f = G.finialGeometry(o.finial ?? Math.max(0.6, o.r * 0.28));
    b.mesh('gold', f, { x: o.x, y: o.y + o.h + roofH * 0.965, z: o.z });
    f.dispose();
  }
  const nw = o.windows ?? Math.max(1, Math.floor(o.h / 6));
  const per = Math.max(4, Math.round((Math.PI * 2 * o.r) / 3.2));
  for (let row = 0; row < nw; row++) {
    const wy = o.y + 2.2 + ((o.h - 4) * (row + 0.5)) / nw;
    for (let i = 0; i < per; i++) {
      const a = ((i + (row % 2) * 0.5) / per) * Math.PI * 2;
      const wx = o.x + Math.cos(a) * (o.r - 0.05), wz = o.z + Math.sin(a) * (o.r - 0.05);
      inst(k.props, 'tower_window', () => archedWindowGeo(), am('window'), { x: wx, y: wy, z: wz, yaw: faceYaw(Math.cos(a), Math.sin(a)) }, false);
    }
  }
  if (o.door !== undefined) portal(k, o.x + Math.sin(o.door) * o.r, o.y, o.z + Math.cos(o.door) * o.r, o.door, 2.4, 3.6);
  if (o.collide !== false) {
    const bottom = o.y - (o.base ?? 0);
    const top = o.y + o.h + roofH * 0.35;
    b.collider({ shape: 'cylinder', x: o.x, y: (bottom + top) / 2, z: o.z, r: o.r + 0.32, hy: (top - bottom) / 2, walkable: false, solid: true, surface: 'stone' });
  }
  return o.y + o.h + roofH;
}

let archedWindowCache: THREE.BufferGeometry | null = null;
/** Arched window panel (box with a rounded top), facing +Z. Shared geometry factory. */
export function archedWindowGeo(): THREE.BufferGeometry {
  if (archedWindowCache) return archedWindowCache.clone();
  const box = new THREE.BoxGeometry(0.8, 1.2, 0.22);
  const top = new THREE.CylinderGeometry(0.4, 0.4, 0.22, 10, 1, false, 0, Math.PI);
  top.rotateX(Math.PI / 2);
  top.rotateZ(Math.PI / 2);
  top.translate(0, 0.6, 0);
  archedWindowCache = G.mergeAll([box, top]);
  return archedWindowCache.clone();
}

/** Door portal: a dark recess with a stone frame and a little teal roof, facing yaw. Base at (x, y, z). */
export function portal(k: Kit, x: number, y: number, z: number, yaw: number, w: number, h: number): void {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const b = k.main;
  b.box(am('shadow'), { x: x + fx * 0.05, y: y + h / 2, z: z + fz * 0.05, sx: w, sy: h, sz: 0.3, yaw });
  const archTop = new THREE.CylinderGeometry(w / 2, w / 2, 0.3, 14, 1, false, 0, Math.PI);
  archTop.rotateX(Math.PI / 2);
  archTop.rotateZ(Math.PI / 2);
  b.mesh(am('shadow'), archTop, { x: x + fx * 0.05, y: y + h, z: z + fz * 0.05, yaw });
  archTop.dispose();
  for (const s of [-1, 1]) {
    const px = x + Math.cos(yaw) * s * (w / 2 + 0.25), pz = z - Math.sin(yaw) * s * (w / 2 + 0.25);
    b.box('stone_white', { x: px + fx * 0.25, y: y + (h + w / 2) / 2, z: pz + fz * 0.25, sx: 0.5, sy: h + w / 2, sz: 0.5, yaw });
  }
  b.box('stone_white', { x: x + fx * 0.25, y: y + h + w / 2 + 0.2, z: z + fz * 0.25, sx: w + 1.2, sy: 0.4, sz: 0.6, yaw });
  b.roof(am('roof'), { x: x + fx * 0.6, y: y + h + w / 2 + 0.4, z: z + fz * 0.6, w: w + 1.0, d: 1.2, height: 0.7, yaw, style: 'gable', overhang: 0.3, ridge: am('roofTrim') });
}

// ---------------------------------------------------------------------------
// The great spire
// ---------------------------------------------------------------------------

export interface SpireTier {
  r: number;
  h: number;
  /** Teal skirt roof at the top of this tier. */
  skirt?: boolean;
  /** Open belfry arches instead of a solid drum. */
  belfry?: boolean;
}

/** Tall central spire made of stacked drums with skirts, windows, bands and a crowning cone. Returns apex y. */
export function spire(k: Kit, o: { x: number; z: number; y: number; tiers: SpireTier[]; roofH: number; finial: number; door?: number }): number {
  const b = k.main;
  let y = o.y;
  b.cylinder('stone_white', { x: o.x, z: o.z, y, r: o.tiers[0].r + 0.8, h: 1.2, segments: 32 });
  b.cylinder('stone_white', { x: o.x, z: o.z, y: y + 1.2, r: o.tiers[0].r + 0.4, h: 0.6, segments: 32 });
  y += 0.4;
  o.tiers.forEach((t, i) => {
    const seg = 28;
    if (t.belfry) {
      const n = 8;
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2;
        b.box('stone_white', { x: o.x + Math.cos(a) * (t.r - 0.4), y: y + t.h / 2, z: o.z + Math.sin(a) * (t.r - 0.4), sx: 0.9, sy: t.h, sz: 0.9, yaw: faceYaw(Math.cos(a), Math.sin(a)) });
      }
      b.cylinder(am('shadow'), { x: o.x, z: o.z, y, r: t.r * 0.55, h: t.h, segments: 12 });
      // Bell
      b.cylinder('bronze', { x: o.x, z: o.z, y: y + t.h * 0.35, r: t.r * 0.42, rTop: t.r * 0.2, h: t.h * 0.45, segments: 14 });
      b.cylinder('stone_white', { x: o.x, z: o.z, y: y + t.h - 0.6, r: t.r + 0.1, h: 0.6, segments: seg });
    } else {
      b.cylinder(i % 2 ? 'plaster_white' : 'plaster_cream', { x: o.x, z: o.z, y, r: t.r, h: t.h, segments: seg });
      // Fine horizontal bands like the painted temple.
      const nb = Math.max(1, Math.floor(t.h / 3.2));
      for (let j = 1; j <= nb; j++) b.cylinder('stone_light', { x: o.x, z: o.z, y: y + (t.h * j) / (nb + 1), r: t.r + 0.08, h: 0.22, segments: seg });
      // Windows: two rows per tier.
      const per = Math.max(6, Math.round((Math.PI * 2 * t.r) / 3.4));
      for (let row = 0; row < 2; row++) {
        const wy = y + t.h * (row === 0 ? 0.3 : 0.68);
        for (let j = 0; j < per; j++) {
          const a = ((j + row * 0.5) / per) * Math.PI * 2 + i * 0.2;
          inst(k.props, 'spire_window', () => archedWindowGeo(), am('window'), { x: o.x + Math.cos(a) * (t.r - 0.05), y: wy, z: o.z + Math.sin(a) * (t.r - 0.05), yaw: faceYaw(Math.cos(a), Math.sin(a)), sx: 1.15, sy: 1.25, sz: 1 }, false);
        }
      }
    }
    // Cornice
    b.cylinder('stone_white', { x: o.x, z: o.z, y: y + t.h - 0.1, r: t.r + 0.45, h: 0.55, segments: seg });
    if (t.skirt) {
      const next = o.tiers[i + 1];
      const out = Math.max(1.2, t.r - (next ? next.r : t.r * 0.8) + 1.4);
      const sk = G.skirtRoof(next ? next.r : t.r * 0.8, out, Math.max(1.6, out * 0.75), seg);
      b.mesh(am('roof'), sk, { x: o.x, y: y + t.h + 0.35, z: o.z });
      sk.dispose();
    }
    y += t.h;
  });
  const top = o.tiers[o.tiers.length - 1];
  const roof = G.coneRoof(top.r + 0.4, o.roofH, { segments: 32, overhang: top.r * 0.45 + 0.6 });
  b.mesh(am('roof'), roof, { x: o.x, y: y + 0.4, z: o.z });
  roof.dispose();
  const f = G.finialGeometry(o.finial);
  b.mesh('gold', f, { x: o.x, y: y + 0.4 + o.roofH * 0.965, z: o.z });
  f.dispose();
  // Collider: stepped cylinders (solid, not walkable beyond the base cornice).
  let cy = o.y;
  for (const t of o.tiers) {
    b.collider({ shape: 'cylinder', x: o.x, y: cy + t.h / 2, z: o.z, r: t.r + 0.45, hy: t.h / 2 + 0.05, walkable: false, solid: true, surface: 'stone' });
    cy += t.h;
  }
  if (o.door !== undefined) portal(k, o.x + Math.sin(o.door) * (o.tiers[0].r + 0.1), o.y + 0.4, o.z + Math.cos(o.door) * (o.tiers[0].r + 0.1), o.door, 3.2, 5.2);
  return y + 0.4 + o.roofH;
}

// ---------------------------------------------------------------------------
// Railings, parapets, walls
// ---------------------------------------------------------------------------

export interface RailOpts {
  /** Walking-surface height under the rail. */
  y: number;
  h?: number;
  closed?: boolean;
  /** Skip segment i (openings). */
  skip?: (i: number) => boolean;
  material?: Mat;
  collide?: boolean;
  /** Use a solid parapet (wall) instead of balusters. */
  solid?: boolean;
  thickness?: number;
}

/** Balustrade (posts, rails, turned balusters) or solid parapet along a polyline at constant height. */
export function balustrade(k: Kit, pts: P2[], o: RailOpts): void {
  const h = o.h ?? 1.05;
  const mat = o.material ?? 'stone_white';
  const n = o.closed ? pts.length : pts.length - 1;
  const t = o.thickness ?? (o.solid ? 0.45 : 0.3);
  for (let i = 0; i < n; i++) {
    if (o.skip?.(i)) continue;
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const L = Math.hypot(c.x - a.x, c.z - a.z);
    if (L < 0.05) continue;
    const yaw = alongYaw(c.x - a.x, c.z - a.z);
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
    if (o.solid) {
      k.main.box(mat, { x: mx, y: o.y + (h - 0.12) / 2, z: mz, sx: L + t * 0.5, sy: h - 0.12, sz: t, yaw });
      k.main.box('stone_light', { x: mx, y: o.y + h - 0.06, z: mz, sx: L + t * 0.5 + 0.08, sy: 0.14, sz: t + 0.12, yaw });
    } else {
      k.main.box(mat, { x: mx, y: o.y + 0.1, z: mz, sx: L, sy: 0.2, sz: t + 0.04, yaw });
      k.main.box(mat, { x: mx, y: o.y + h - 0.08, z: mz, sx: L + 0.1, sy: 0.16, sz: t + 0.06, yaw });
      const nb = Math.max(1, Math.floor(L / 0.42));
      for (let j = 0; j < nb; j++) {
        const f = (j + 0.5) / nb;
        inst(k.props, `baluster_${Math.round(h * 100)}`, () => balusterGeo(h - 0.36), mat, { x: a.x + (c.x - a.x) * f, y: o.y + 0.2, z: a.z + (c.z - a.z) * f }, false);
      }
      inst(k.main, `bal_post_${Math.round(h * 100)}`, () => new THREE.BoxGeometry(0.34, h + 0.14, 0.34).translate(0, (h + 0.14) / 2, 0), mat, { x: a.x, y: o.y, z: a.z, yaw });
      if (!o.closed && i === n - 1) inst(k.main, `bal_post_${Math.round(h * 100)}`, () => new THREE.BoxGeometry(0.34, h + 0.14, 0.34).translate(0, (h + 0.14) / 2, 0), mat, { x: c.x, y: o.y, z: c.z, yaw });
    }
    if (o.collide !== false) {
      const ch = Math.max(h, 1.0) + 0.1;
      k.main.collider({ shape: 'box', x: mx, y: o.y + ch / 2 - 0.05, z: mz, hx: L / 2 + 0.05, hy: ch / 2 + 0.05, hz: Math.max(0.2, t / 2), yaw, walkable: false, solid: true });
    }
  }
}

function balusterGeo(h: number): THREE.BufferGeometry {
  const prof: Array<[number, number]> = [
    [0.075, 0],
    [0.095, h * 0.08],
    [0.06, h * 0.22],
    [0.1, h * 0.5],
    [0.055, h * 0.8],
    [0.08, h * 0.92],
    [0.07, h],
  ];
  return G.lathe(prof, 6, 1);
}

/** Points on a circular arc (inclusive), world angle convention. */
export function arcPoints(cx: number, cz: number, r: number, a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return out;
}

/** Thick wall with cap along a polyline (solid, walkable top optional). */
export function wallLine(k: Kit, pts: P2[], o: { y: number; h: number; t: number; material?: Mat; cap?: Mat | null; walkableTop?: boolean; closed?: boolean; collide?: boolean }): void {
  const n = o.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const L = Math.hypot(c.x - a.x, c.z - a.z);
    if (L < 0.05) continue;
    const yaw = alongYaw(c.x - a.x, c.z - a.z);
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
    k.main.box(o.material ?? 'stone_white', { x: mx, y: o.y + o.h / 2, z: mz, sx: L + o.t * 0.5, sy: o.h, sz: o.t, yaw }, { collide: o.collide !== false, walkable: !!o.walkableTop });
    if (o.cap !== null) k.main.box(o.cap ?? 'stone_light', { x: mx, y: o.y + o.h + 0.08, z: mz, sx: L + o.t * 0.5 + 0.1, sy: 0.16, sz: o.t + 0.16, yaw });
  }
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

export interface FlightOpts {
  a: P2;
  b: P2;
  y0: number;
  y1: number;
  width: number;
  material?: Mat;
  stepH?: number;
  /** Bottom of the step blocks (default y0 - 0.25). */
  base?: number;
  /** Side parapets (solid walls following the slope). */
  walls?: { h: number; t: number; material?: Mat } | null;
  surface?: SurfaceType;
  builder?: ContentBuilder;
}

/**
 * Straight flight of steps from a (bottom, y0) to b (top, y1). The pitch line
 * runs through the tread midpoints and is matched by a walkable ramp collider,
 * so feet stay within half a riser of the visible treads.
 */
export function flight(k: Kit, o: FlightOpts): void {
  const dx = o.b.x - o.a.x, dz = o.b.z - o.a.z;
  const run = Math.hypot(dx, dz);
  const rise = o.y1 - o.y0;
  if (run < 0.1) return;
  const yaw = alongYaw(dx, dz);
  const ux = dx / run, uz = dz / run;
  const nx = -uz, nz = ux;
  const N = Math.max(1, Math.round(Math.abs(rise) / (o.stepH ?? 0.2)));
  const sh = rise / N, sd = run / N;
  const base = o.base ?? Math.min(o.y0, o.y1) - 0.25;
  const b = o.builder ?? k.main;
  const mat = o.material ?? 'stone_white';
  for (let i = 0; i < N; i++) {
    const along = (i + 0.5) * sd;
    const top = o.y0 + (i + 0.5) * sh;
    b.box(mat, { x: o.a.x + ux * along, y: (top + base) / 2, z: o.a.z + uz * along, sx: sd + 0.02, sy: Math.max(0.05, top - base), sz: o.width, yaw });
  }
  const hi = Math.max(o.y0, o.y1);
  const hy = (hi - base) / 2;
  b.collider({
    shape: 'box',
    x: (o.a.x + o.b.x) / 2,
    y: base + hy,
    z: (o.a.z + o.b.z) / 2,
    hx: run / 2,
    hz: o.width / 2,
    hy,
    yaw: rise >= 0 ? yaw : yaw + Math.PI,
    slopeRise: Math.abs(rise),
    walkable: true,
    solid: true,
    surface: o.surface ?? 'stone',
  });
  if (o.walls) {
    for (const s of [-1, 1]) {
      const off = o.width / 2 + o.walls.t / 2;
      slopedWall(k, {
        a: { x: o.a.x + nx * off * s, z: o.a.z + nz * off * s },
        b: { x: o.b.x + nx * off * s, z: o.b.z + nz * off * s },
        y0: o.y0,
        y1: o.y1,
        base,
        h: o.walls.h,
        t: o.walls.t,
        material: o.walls.material ?? mat,
        builder: b,
      });
    }
  }
}

/** Sloped parapet wall from a (walking height y0) to b (y1), top h above the walking line. */
export function slopedWall(k: Kit, o: { a: P2; b: P2; y0: number; y1: number; base: number; h: number; t: number; material?: Mat; builder?: ContentBuilder; collide?: boolean }): void {
  const dx = o.b.x - o.a.x, dz = o.b.z - o.a.z;
  const run = Math.hypot(dx, dz);
  if (run < 0.05) return;
  const yaw = alongYaw(dx, dz);
  const b = o.builder ?? k.main;
  // Hexahedron: flat bottom at `base`, top following the slope + h (built directly, no extrusion).
  const ux = dx / run, uz = dz / run, nx = -uz * (o.t / 2), nz = ux * (o.t / 2);
  const ta = o.y0 + o.h, tb = o.y1 + o.h;
  const v = [
    [o.a.x - nx, o.base, o.a.z - nz], [o.b.x - nx, o.base, o.b.z - nz], [o.b.x - nx, tb, o.b.z - nz], [o.a.x - nx, ta, o.a.z - nz],
    [o.a.x + nx, o.base, o.a.z + nz], [o.b.x + nx, o.base, o.b.z + nz], [o.b.x + nx, tb, o.b.z + nz], [o.a.x + nx, ta, o.a.z + nz],
  ];
  b.mesh(o.material ?? 'stone_white', hexahedron(v), { x: 0, y: 0, z: 0 });
  // Coping along the top.
  const len = Math.hypot(run, o.y1 - o.y0);
  b.box('stone_light', { x: (o.a.x + o.b.x) / 2, y: (o.y0 + o.y1) / 2 + o.h + 0.07, z: (o.a.z + o.b.z) / 2, sx: len + 0.05, sy: 0.14, sz: o.t + 0.12, yaw, roll: Math.atan2(o.y1 - o.y0, run) });
  if (o.collide !== false) {
    const lo = Math.min(o.y0, o.y1), hi = Math.max(o.y0, o.y1);
    const top = hi + o.h + 0.05;
    const bottom = Math.min(o.base, lo - 0.5);
    b.collider({
      shape: 'box',
      x: (o.a.x + o.b.x) / 2,
      y: (top + bottom) / 2,
      z: (o.a.z + o.b.z) / 2,
      hx: run / 2,
      hz: Math.max(0.2, o.t / 2),
      hy: (top - bottom) / 2,
      yaw: o.y1 >= o.y0 ? yaw : yaw + Math.PI,
      slopeRise: hi - lo,
      walkable: false,
      solid: true,
    });
  }
}

/**
 * Hexahedron from 8 corners (0-3 one side: bottom-a, bottom-b, top-b, top-a;
 * 4-7 the other side in the same order). Flat-shaded, UVs in world metres / 2.
 */
export function hexahedron(v: number[][]): THREE.BufferGeometry {
  const faces = [
    [0, 1, 2, 3],
    [5, 4, 7, 6],
    [4, 0, 3, 7],
    [1, 5, 6, 2],
    [3, 2, 6, 7],
    [4, 5, 1, 0],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (const f of faces) {
    const base = pos.length / 3;
    const p = f.map((i) => new THREE.Vector3(v[i][0], v[i][1], v[i][2]));
    e1.subVectors(p[1], p[0]);
    e2.subVectors(p[3], p[0]);
    n.crossVectors(e1, e2).normalize();
    const w = p[0].distanceTo(p[1]), h = p[0].distanceTo(p[3]);
    const fuv = [[0, 0], [w / 2, 0], [w / 2, h / 2], [0, h / 2]];
    for (let i = 0; i < 4; i++) {
      pos.push(p[i].x, p[i].y, p[i].z);
      uv.push(fuv[i][0], fuv[i][1]);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Ensure outward winding: if the first face normal points inward, flip all.
  const c = new THREE.Vector3();
  for (const q of v) c.add(new THREE.Vector3(q[0], q[1], q[2]));
  c.multiplyScalar(1 / 8);
  const nrm = g.getAttribute('normal');
  const p0 = new THREE.Vector3(pos[0], pos[1], pos[2]);
  if (new THREE.Vector3(nrm.getX(0), nrm.getY(0), nrm.getZ(0)).dot(p0.sub(c)) < 0) {
    const ia = g.getIndex()!;
    for (let i = 0; i < ia.count; i += 3) {
      const t = ia.getX(i + 1);
      ia.setX(i + 1, ia.getX(i + 2));
      ia.setX(i + 2, t);
    }
    g.computeVertexNormals();
  }
  return g;
}

/**
 * Many boxes merged into one geometry without per-box BufferGeometry objects
 * (stairs with hundreds of treads). Box transform as in ContentBuilder.box().
 */
export class BoxBatch {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];
  private static tpl: { p: number[][]; n: number[][]; d: Array<[number, number]> } | null = null;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  get count(): number {
    return this.pos.length / 72;
  }
  add(t: { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw?: number; roll?: number; pitch?: number }, tile = 2): void {
    if (!BoxBatch.tpl) {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const pa = g.getAttribute('position'), na = g.getAttribute('normal');
      const p: number[][] = [], n: number[][] = [];
      for (let i = 0; i < pa.count; i++) {
        p.push([pa.getX(i), pa.getY(i), pa.getZ(i)]);
        n.push([na.getX(i), na.getY(i), na.getZ(i)]);
      }
      const ua = g.getAttribute('uv');
      const d: Array<[number, number]> = [];
      for (let i = 0; i < ua.count; i++) d.push([ua.getX(i), ua.getY(i)]);
      BoxBatch.tpl = { p, n, d };
      g.dispose();
    }
    const T = BoxBatch.tpl;
    matrixFor(t, this.m);
    this.q.setFromRotationMatrix(new THREE.Matrix4().extractRotation(this.m));
    const base = this.pos.length / 3;
    const dims: Array<[number, number]> = [[t.sz, t.sy], [t.sz, t.sy], [t.sx, t.sz], [t.sx, t.sz], [t.sx, t.sy], [t.sx, t.sy]];
    for (let i = 0; i < 24; i++) {
      this.v.set(T.p[i][0], T.p[i][1], T.p[i][2]).applyMatrix4(this.m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.set(T.n[i][0], T.n[i][1], T.n[i][2]).applyQuaternion(this.q);
      this.nor.push(this.v.x, this.v.y, this.v.z);
      const f = Math.floor(i / 4);
      this.uv.push((T.d[i][0] * dims[f][0]) / tile, (T.d[i][1] * dims[f][1]) / tile);
    }
    for (let f = 0; f < 6; f++) {
      const a = base + f * 4;
      this.idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
  /** Add the batch to a builder (merged with that material) and free it. */
  flush(b: ContentBuilder, material: Mat): void {
    if (!this.pos.length) return;
    const g = this.geometry();
    b.mesh(material as any, g, { x: 0, y: 0, z: 0 });
    g.dispose();
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }
}

export interface CurvedStairOpts {
  cx: number;
  cz: number;
  rIn: number;
  rOut: number;
  /** Angle at the bottom step and at the top step (world convention). */
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  stepH?: number;
  base?: number;
  material?: Mat;
  walls?: { h: number; t: number; material?: Mat; inner?: boolean; outer?: boolean } | null;
}

/** Helical (curved) stair with ramp colliders along the arc and stepped curved parapets. */
export function curvedStair(k: Kit, o: CurvedStairOpts): void {
  const rise = o.y1 - o.y0;
  const N = Math.max(2, Math.round(rise / (o.stepH ?? 0.2)));
  const base = o.base ?? o.y0 - 0.2;
  const mat = o.material ?? 'stone_white';
  const b = k.main;
  const wallMat = o.walls?.material ?? mat;
  for (let i = 0; i < N; i++) {
    const t0 = o.a0 + ((o.a1 - o.a0) * i) / N;
    const t1 = o.a0 + ((o.a1 - o.a0) * (i + 1)) / N;
    const top = o.y0 + (i + 0.5) * (rise / N);
    const g = G.annulusSector(o.rIn, o.rOut, t0, t1, base, top, 2);
    b.mesh(mat, g, { x: o.cx, y: 0, z: o.cz });
    g.dispose();
    if (o.walls) {
      const wt = o.walls.t;
      if (o.walls.outer !== false) {
        const w = G.annulusSector(o.rOut, o.rOut + wt, t0, t1, base, top + o.walls.h, 2);
        b.mesh(wallMat, w, { x: o.cx, y: 0, z: o.cz });
        w.dispose();
      }
      if (o.walls.inner !== false) {
        const w = G.annulusSector(Math.max(0.05, o.rIn - wt), o.rIn, t0, t1, base, top + o.walls.h, 2);
        b.mesh(wallMat, w, { x: o.cx, y: 0, z: o.cz });
        w.dispose();
      }
    }
  }
  // Colliders: ramp boxes along the arc (≤ 12° each).
  const sweep = o.a1 - o.a0;
  const M = Math.max(2, Math.ceil(Math.abs(sweep) / ((12 * Math.PI) / 180)));
  const rc = (o.rIn + o.rOut) / 2;
  const dir = Math.sign(sweep) || 1;
  for (let m = 0; m < M; m++) {
    const p0 = o.a0 + (sweep * m) / M, p1 = o.a0 + (sweep * (m + 1)) / M;
    const pm = (p0 + p1) / 2;
    const tx = -Math.sin(pm) * dir, tz = Math.cos(pm) * dir;
    const yaw = alongYaw(tx, tz);
    const segRise = rise / M;
    const yEnd = o.y0 + segRise * (m + 1);
    const len = rc * Math.abs(p1 - p0);
    const hy = (yEnd - base) / 2;
    b.collider({ shape: 'box', x: o.cx + Math.cos(pm) * rc, y: base + hy, z: o.cz + Math.sin(pm) * rc, hx: len / 2 + 0.12, hz: (o.rOut - o.rIn) / 2, hy, yaw, slopeRise: segRise, walkable: true, solid: true, surface: 'stone' });
    if (o.walls) {
      for (const side of [o.walls.outer !== false ? 1 : 0, o.walls.inner !== false ? -1 : 0]) {
        if (!side) continue;
        const rr = side > 0 ? o.rOut + o.walls.t / 2 : o.rIn - o.walls.t / 2;
        const top = yEnd + o.walls.h;
        const whi = (top - base) / 2;
        b.collider({ shape: 'box', x: o.cx + Math.cos(pm) * rr, y: base + whi, z: o.cz + Math.sin(pm) * rr, hx: (rr * Math.abs(p1 - p0)) / 2 + 0.1, hz: Math.max(0.2, o.walls.t / 2), hy: whi, yaw, slopeRise: segRise, walkable: false, solid: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Arcades, gates
// ---------------------------------------------------------------------------

export interface ArcadeOpts {
  a: P2;
  b: P2;
  y: number;
  arches: number;
  pier: number;
  spring: number;
  top: number;
  depth: number;
  material?: Mat;
  /** Lean-to roof over the arcade, sloping down toward this side (+1 / -1 of the left normal). */
  roof?: { side: number; width: number; height: number } | null;
  collide?: boolean;
}

/** Row of round arches on square piers (Air Temple courtyard arcades). */
export function arcade(k: Kit, o: ArcadeOpts): void {
  const dx = o.b.x - o.a.x, dz = o.b.z - o.a.z;
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  const yaw = alongYaw(dx, dz);
  const span = (L - (o.arches + 1) * o.pier) / o.arches;
  const mat = o.material ?? 'stone_white';
  const b = k.main;
  for (let i = 0; i <= o.arches; i++) {
    const along = o.pier / 2 + i * (span + o.pier);
    const px = o.a.x + ux * along, pz = o.a.z + uz * along;
    b.box(mat, { x: px, y: o.y + o.spring / 2, z: pz, sx: o.pier, sy: o.spring, sz: o.depth, yaw }, { collide: o.collide !== false, walkable: false });
    // Base and capital mouldings.
    b.box('stone_light', { x: px, y: o.y + 0.25, z: pz, sx: o.pier + 0.3, sy: 0.5, sz: o.depth + 0.3, yaw });
    b.box('stone_light', { x: px, y: o.y + o.spring - 0.15, z: pz, sx: o.pier + 0.25, sy: 0.3, sz: o.depth + 0.25, yaw });
  }
  const sp = G.archSpandrel(span, o.spring, o.top, o.depth);
  for (let i = 0; i < o.arches; i++) {
    const along = o.pier + span / 2 + i * (span + o.pier);
    b.mesh(mat, sp, { x: o.a.x + ux * along, y: o.y, z: o.a.z + uz * along, yaw });
  }
  sp.dispose();
  b.box('stone_light', { x: (o.a.x + o.b.x) / 2, y: o.y + o.top + 0.15, z: (o.a.z + o.b.z) / 2, sx: L + 0.4, sy: 0.3, sz: o.depth + 0.4, yaw });
  if (o.collide !== false) {
    // Solid masonry above the arches (blocks jumping through the spandrels).
    const lo = o.y + o.spring + span * 0.5 - 0.2;
    b.collider({ shape: 'box', x: (o.a.x + o.b.x) / 2, y: (lo + o.y + o.top + 0.3) / 2, z: (o.a.z + o.b.z) / 2, hx: L / 2, hz: o.depth / 2, hy: (o.y + o.top + 0.3 - lo) / 2, yaw, walkable: true, solid: true });
  }
  if (o.roof) {
    const nx = -uz * o.roof.side, nz = ux * o.roof.side;
    const w = o.roof.width;
    const cx = (o.a.x + o.b.x) / 2 + nx * (w / 2 - o.depth / 2), cz = (o.a.z + o.b.z) / 2 + nz * (w / 2 - o.depth / 2);
    const tilt = Math.atan2(o.roof.height, w);
    const slopeLen = Math.hypot(w, o.roof.height) + 0.8;
    // Roof plane: a thin tiled slab sloping down away from the arcade.
    const slab = new THREE.BoxGeometry(L + 1.2, 0.25, slopeLen);
    b.mesh(am('roof'), slab, { x: cx, y: o.y + o.top + 0.45 + o.roof.height / 2, z: cz, yaw, pitch: o.roof.side * tilt });
    slab.dispose();
  }
}

/** Moon gate: freestanding wall with a circular opening; walk-through clearance guaranteed by split colliders. */
export function moonGate(k: Kit, o: { x: number; z: number; y: number; yaw: number; w: number; h: number; depth: number; r: number; cy: number; material?: Mat; topWalk?: boolean }): void {
  const b = k.main;
  const g = G.moonGateWall(o.w, o.h, o.depth, o.cy, o.r);
  b.mesh(o.material ?? 'plaster_white', g, { x: o.x, y: o.y, z: o.z, yaw: o.yaw });
  g.dispose();
  const ring = G.moonGateRing(o.cy, o.r + 0.12, 0.22);
  for (const s of [-1, 1]) {
    const f = s * (o.depth / 2 + 0.05);
    b.mesh('stone_light', ring, { x: o.x + Math.sin(o.yaw) * f, y: o.y, z: o.z + Math.cos(o.yaw) * f, yaw: o.yaw });
  }
  ring.dispose();
  b.box('stone_light', { x: o.x, y: o.y + o.h + 0.12, z: o.z, sx: o.w + 0.3, sy: 0.24, sz: o.depth + 0.3, yaw: o.yaw });
  // Colliders: the two jambs (outside the opening at walking heights) and the lintel mass above it.
  const open = Math.sqrt(Math.max(0, o.r * o.r - Math.max(0, o.cy - 2.2) ** 2));
  const jamb = (o.w / 2 - open) / 2;
  const cx = Math.cos(o.yaw), sz = -Math.sin(o.yaw);
  for (const s of [-1, 1]) {
    const off = open + jamb;
    b.collider({ shape: 'box', x: o.x + cx * off * s, y: o.y + o.h / 2, z: o.z + sz * off * s, hx: jamb, hz: o.depth / 2, hy: o.h / 2, yaw: o.yaw, walkable: !!o.topWalk, solid: true });
  }
  const lintel0 = o.y + o.cy + o.r * 0.92;
  if (lintel0 < o.y + o.h) b.collider({ shape: 'box', x: o.x, y: (lintel0 + o.y + o.h) / 2, z: o.z, hx: open + 0.05, hz: o.depth / 2, hy: (o.y + o.h - lintel0) / 2, yaw: o.yaw, walkable: !!o.topWalk, solid: true });
}

// ---------------------------------------------------------------------------
// Water: pools, fountains, falls
// ---------------------------------------------------------------------------

/** Raised round basin with a stone rim, mosaic floor and a registered water source. */
export function roundPool(k: Kit, o: { id: string; label: string; x: number; z: number; y: number; r: number; rimH?: number; rim?: number; capacity?: number; regen?: number; type?: 'pond' | 'fountain' }): THREE.Mesh {
  const rimH = o.rimH ?? 0.7;
  const rim = o.rim ?? 0.55;
  const b = k.main;
  const ringG = G.annulusSector(o.r, o.r + rim, 0, Math.PI * 2, o.y - 0.3, o.y + rimH, 28);
  b.mesh('stone_white', ringG, { x: o.x, y: 0, z: o.z });
  ringG.dispose();
  const capG = G.annulusSector(o.r - 0.05, o.r + rim + 0.08, 0, Math.PI * 2, o.y + rimH, o.y + rimH + 0.1, 28);
  b.mesh('stone_light', capG, { x: o.x, y: 0, z: o.z });
  capG.dispose();
  const floor = new THREE.CylinderGeometry(o.r, o.r, 0.12, 28);
  b.mesh(am('mosaic'), floor, { x: o.x, y: o.y + 0.02, z: o.z });
  floor.dispose();
  // Rim colliders (walkable rim top) as a ring of boxes; floor walkable.
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    const rr = o.r + rim / 2;
    const chord = 2 * (o.r + rim) * Math.sin(Math.PI / n) + 0.1;
    b.collider({ shape: 'box', x: o.x + Math.cos(a) * rr, y: o.y + (rimH + 0.1 - 0.3) / 2, z: o.z + Math.sin(a) * rr, hx: chord / 2, hz: rim / 2 + 0.05, hy: (rimH + 0.1 + 0.3) / 2, yaw: alongYaw(-Math.sin(a), Math.cos(a)), walkable: true, solid: true, surface: 'stone' });
  }
  b.collider({ shape: 'cylinder', x: o.x, y: o.y - 0.1, z: o.z, r: o.r, hy: 0.18, walkable: true, solid: false, surface: 'stone' });
  const level = o.y + rimH - 0.14;
  const wg = G.waterDisc(o.r + 0.02, 40);
  const water = new THREE.Mesh(wg, am('water'));
  water.position.set(o.x, level, o.z);
  water.renderOrder = 2;
  water.name = `water_${o.id}`;
  k.addMesh(water, 'main');
  k.registerWater({ id: o.id, type: o.type ?? 'pond', label: o.label, x: o.x, y: level, z: o.z, r: o.r, capacity: o.capacity ?? 140, regen: o.regen ?? 3 });
  return water;
}

/** Tiered fountain: basin pool, column, upper bowl with a falling water curtain. */
export function fountain(k: Kit, o: { id: string; label: string; x: number; z: number; y: number; r: number }): void {
  roundPool(k, { id: o.id, label: o.label, x: o.x, z: o.z, y: o.y, r: o.r, rimH: 0.65, type: 'fountain', capacity: 90, regen: 2.5 });
  const b = k.main;
  b.cylinder('stone_white', { x: o.x, z: o.z, y: o.y, r: 0.45, rTop: 0.32, h: 2.0, segments: 12 }, { collide: true, walkable: false });
  const bowlR = Math.min(1.5, o.r * 0.42);
  const bowl = G.lathe([[0.3, 0], [bowlR * 0.7, 0.18], [bowlR, 0.45], [bowlR + 0.08, 0.55], [bowlR - 0.1, 0.55]], 18, 1);
  b.mesh('stone_white', bowl, { x: o.x, y: o.y + 2.0, z: o.z });
  bowl.dispose();
  const top = new THREE.SphereGeometry(0.3, 10, 8);
  b.mesh('gold', top, { x: o.x, y: o.y + 2.75, z: o.z });
  top.dispose();
  const wd = G.waterDisc(bowlR - 0.08, 20);
  const w = new THREE.Mesh(wd, am('water'));
  w.position.set(o.x, o.y + 2.5, o.z);
  w.renderOrder = 2;
  k.addMesh(w, 'main');
  // Curtain of water falling from the bowl's lip into the basin.
  const curtain = new THREE.CylinderGeometry(bowlR + 0.06, bowlR + 0.32, 1.8, 24, 3, true);
  const n = curtain.getAttribute('position').count;
  curtain.setAttribute('fall', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  curtain.setAttribute('rapid', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  const uv = curtain.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * 3, (1 - uv.getY(i)) * 0.6);
  const cm = new THREE.Mesh(curtain, am('falls'));
  cm.position.set(o.x, o.y + 2.55 - 0.9, o.z);
  cm.renderOrder = 3;
  k.addMesh(cm, 'props');
}

/**
 * Waterfall pouring from a lip at (x, y, z) toward yaw (local +Z = flow
 * direction), registered as a 'waterfall' water source at the lip.
 */
export function waterfall(k: Kit, o: { id: string; label: string; x: number; y: number; z: number; yaw: number; width: number; drop: number; out?: number; register?: boolean }): THREE.Mesh {
  const g = G.waterfallRibbon(o.width, o.drop, { out: o.out ?? 1.2 });
  const m = new THREE.Mesh(g, am('falls'));
  m.position.set(o.x, o.y, o.z);
  m.rotation.y = o.yaw;
  m.renderOrder = 3;
  m.name = `falls_${o.id}`;
  k.addMesh(m, 'main');
  if (o.register !== false) k.registerWater({ id: o.id, type: 'waterfall', label: o.label, x: o.x, y: o.y - 0.3, z: o.z, r: Math.max(0.8, o.width / 2), capacity: Infinity, regen: 0, size: 'medium' });
  return m;
}

/** Straight open channel (canal) with stone walls and flowing water toward b; registered as a canal source. */
export function canal(k: Kit, o: { id: string; label: string; a: P2; b: P2; y: number; width: number; wallH?: number; register?: boolean }): void {
  const dx = o.b.x - o.a.x, dz = o.b.z - o.a.z;
  const L = Math.hypot(dx, dz);
  const yaw = alongYaw(dx, dz);
  const nx = -dz / L, nz = dx / L;
  const wallH = o.wallH ?? 0.55;
  const mx = (o.a.x + o.b.x) / 2, mz = (o.a.z + o.b.z) / 2;
  const b = k.main;
  b.box(am('mosaic'), { x: mx, y: o.y + 0.05, z: mz, sx: L, sy: 0.1, sz: o.width, yaw });
  for (const s of [-1, 1]) {
    const off = o.width / 2 + 0.22;
    b.box('stone_white', { x: mx + nx * off * s, y: o.y + wallH / 2, z: mz + nz * off * s, sx: L + 0.44, sy: wallH, sz: 0.44, yaw }, { collide: true, walkable: true });
  }
  const wg = G.waterRect(o.width, L, 0.4);
  const w = new THREE.Mesh(wg, am('falls'));
  w.position.set(mx, o.y + wallH - 0.15, mz);
  // waterRect flows toward local +Z: orient local +Z along (dx, dz).
  w.rotation.y = faceYaw(dx, dz);
  w.renderOrder = 2;
  k.addMesh(w, 'main');
  b.collider({ shape: 'box', x: mx, y: o.y, z: mz, hx: L / 2, hz: o.width / 2, hy: 0.12, yaw, walkable: true, solid: false, surface: 'stone' });
  if (o.register !== false) k.registerWater({ id: o.id, type: 'canal', label: o.label, x: mx, y: o.y + wallH - 0.15, z: mz, r: o.width / 2, path: [o.a, o.b], capacity: Infinity, regen: 0, size: 'medium' });
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Stone lantern with a glowing core (instanced) and a small solid collider. */
export function stoneLantern(k: Kit, x: number, y: number, z: number, collide = true): void {
  inst(k.props, 'stone_lantern', () => G.stoneLantern(), 'stone_white', { x, y, z });
  inst(k.props, 'stone_lantern_light', () => G.stoneLanternLight(), 'lantern_warm', { x, y, z }, false);
  if (collide) k.props.collider({ shape: 'cylinder', x, y: y + 1.1, z, r: 0.38, hy: 1.1, walkable: false, solid: true });
}

/** Lantern on a wooden post. */
export function lanternPost(k: Kit, x: number, y: number, z: number, color: 'red' | 'warm' | 'blue' = 'warm'): void {
  k.props.lantern(new THREE.Vector3(x, y + 2.75, z), { color, post: true });
  k.props.box('wood_dark', { x, y: y + 2.95, z, sx: 0.5, sy: 0.08, sz: 0.08 });
  k.props.collider({ shape: 'cylinder', x, y: y + 1.4, z, r: 0.2, hy: 1.4, walkable: false, solid: true });
}

/** Hanging lantern (no collider). */
export function hangingLantern(k: Kit, x: number, y: number, z: number, color: 'red' | 'warm' | 'blue' = 'warm'): void {
  k.props.lantern(new THREE.Vector3(x, y, z), { color });
}

const FLAG_MATS: KitMaterialName[] = ['cloth_blue', 'cloth_white', 'cloth_red', 'cloth_green', 'cloth_yellow'];

/** String of five-colour prayer flags sagging between two points. */
export function prayerFlags(k: Kit, a: THREE.Vector3, b: THREE.Vector3, sag = 0.8, spacing = 0.62): void {
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < 0.5) return;
  const yaw = alongYaw(b.x - a.x, b.z - a.z);
  const at = (t: number) => new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t);
  const segs = Math.max(4, Math.round(L / 2));
  for (let i = 0; i < segs; i++) {
    const p0 = at(i / segs), p1 = at((i + 1) / segs);
    const len = p0.distanceTo(p1);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const pitch = Math.atan2(p1.y - p0.y, Math.hypot(p1.x - p0.x, p1.z - p0.z));
    inst(k.props, 'flag_rope', () => new THREE.BoxGeometry(1, 0.03, 0.03), am('rope'), { x: mid.x, y: mid.y, z: mid.z, yaw, roll: pitch, sx: len + 0.02 }, false);
  }
  const n = Math.floor(L / spacing);
  for (let i = 1; i < n; i++) {
    const p = at(i / n);
    const mat = FLAG_MATS[i % FLAG_MATS.length];
    inst(k.props, `flag_${mat}`, () => G.flagQuad(), mat, { x: p.x, y: p.y, z: p.z, yaw, roll: (Math.sin(i * 1.7) * 0.08) }, false);
  }
}

/** Hanging emblem banner with a top rod, facing yaw. Top edge at y. */
export function banner(k: Kit, x: number, y: number, z: number, yaw: number, w = 1.6, h = 4.2, mat: AirMaterialName = 'banner'): void {
  const g = G.bannerQuad(w, h);
  k.props.mesh(am(mat), g, { x, y, z, yaw }, { castShadow: false });
  g.dispose();
  k.props.box('wood_dark', { x, y: y + 0.08, z, sx: w + 0.4, sy: 0.12, sz: 0.12, yaw: yaw + 0 }, { castShadow: false });
}

/** Bonsai pine in a round stone planter (planter top at y + 0.6), with trunk collider. */
export function pine(k: Kit, x: number, y: number, z: number, variant: number, scale = 1, yaw = 0, planter = true): void {
  if (planter) {
    k.main.cylinder('stone_white', { x, z, y, r: 1.25 * scale, rTop: 1.35 * scale, h: 0.6, segments: 14 }, { collide: true, walkable: true });
    k.main.cylinder(am('grass'), { x, z, y: y + 0.6, r: 1.2 * scale, h: 0.04, segments: 14 });
  }
  const py = planter ? y + 0.6 : y;
  inst(k.props, `pine_trunk_${variant}`, () => G.pineTrunk(variant), 'wood_dark', { x, y: py, z, yaw, sx: scale, sy: scale, sz: scale });
  inst(k.props, `pine_pads_${variant}`, () => G.pinePads(variant), am('foliage'), { x, y: py, z, yaw, sx: scale, sy: scale, sz: scale });
  if (!planter) k.props.collider({ shape: 'cylinder', x, y: py + 1.5 * scale, z, r: 0.4 * scale, hy: 1.5 * scale, walkable: false, solid: true });
}

/** Round hay bale (walkable top). */
export function hayBale(k: Kit, x: number, y: number, z: number, yaw: number): void {
  inst(k.props, 'hay_bale', () => G.hayBale(), am('straw'), { x, y, z, yaw });
  inst(k.props, 'hay_bands', () => G.hayBands(), am('strawBand'), { x, y, z, yaw }, false);
  k.props.collider({ shape: 'box', x, y: y + 0.55, z, hx: 0.68, hz: 0.58, hy: 0.55, yaw, walkable: true, solid: true, surface: 'grass' });
}

/** Stack of rectangular straw blocks (2 x 2 x levels). */
export function hayStack(k: Kit, x: number, y: number, z: number, yaw: number, levels = 2): void {
  const cx = Math.cos(yaw), sz = -Math.sin(yaw);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (let l = 0; l < levels; l++) {
    for (let i = 0; i < 2 - (l === levels - 1 && levels > 2 ? 1 : 0); i++) {
      for (let j = 0; j < 2; j++) {
        const ox = (i - 0.5) * 1.52, oz = (j - 0.5) * 0.92;
        inst(k.props, 'hay_block', () => G.hayBlock(), am('straw'), { x: x + cx * ox + fx * oz, y: y + l * 0.75, z: z + sz * ox + fz * oz, yaw });
      }
    }
  }
  k.props.collider({ shape: 'box', x, y: y + (levels * 0.75) / 2, z, hx: 1.55, hz: 0.95, hy: (levels * 0.75) / 2, yaw, walkable: true, solid: true, surface: 'grass' });
}

/** Robed monk statue on a plinth (solid). */
export function monkStatue(k: Kit, x: number, y: number, z: number, yaw: number, scale = 1): void {
  inst(k.main, 'monk_statue', () => G.monkStatue(), 'stone_light', { x, y, z, yaw, sx: scale, sy: scale, sz: scale });
  k.main.collider({ shape: 'box', x, y: y + 1.7 * scale, z, hx: 0.75 * scale, hz: 0.75 * scale, hy: 1.7 * scale, yaw, walkable: false, solid: true });
}

/** Sky bison sculpture (solid, walkable back). */
export function bisonStatue(k: Kit, x: number, y: number, z: number, yaw: number, scale = 1): void {
  const g = G.bisonStatue();
  k.main.mesh('stone_light', g, { x, y: y + 0.4 * scale, z, yaw, sx: scale, sy: scale, sz: scale });
  g.dispose();
  k.main.collider({ shape: 'box', x, y: y + 1.75 * scale, z, hx: 1.8 * scale, hz: 3.6 * scale, hy: 1.75 * scale, yaw, walkable: true, solid: true });
}

export function prayerWheels(k: Kit, a: P2, b: P2, y: number, n: number): void {
  const yaw = alongYaw(b.x - a.x, b.z - a.z);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    inst(k.props, 'prayer_wheel', () => G.prayerWheel(), 'bronze', { x, y, z, yaw });
  }
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  k.props.box('wood_dark', { x: mx, y: y + 1.75, z: mz, sx: L + 0.3, sy: 0.12, sz: 0.2, yaw });
  k.props.box('wood_dark', { x: mx, y: y + 0.1, z: mz, sx: L + 0.3, sy: 0.2, sz: 0.4, yaw });
  k.props.collider({ shape: 'box', x: mx, y: y + 0.9, z: mz, hx: L / 2 + 0.1, hz: 0.3, hy: 0.9, yaw, walkable: false, solid: true });
}

/** Meditation cushions in a ring. */
export function cushions(k: Kit, x: number, y: number, z: number, r: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    inst(k.extra, 'cushion', () => G.cushion(), 'cloth_orange', { x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r }, false);
  }
}

/** Air-ball pole: a slender wooden pole with a flat walkable top (cylinder collider). */
export function pole(k: Kit, x: number, y: number, z: number, h: number): void {
  inst(k.main, 'ab_pole', () => new THREE.CylinderGeometry(0.2, 0.26, 1, 8).translate(0, 0.5, 0), 'wood', { x, y, z, sy: h });
  inst(k.main, 'ab_pole_cap', () => new THREE.CylinderGeometry(0.34, 0.3, 0.12, 10), 'wood_red', { x, y: y + h, z });
  k.main.collider({ shape: 'cylinder', x, y: y + h / 2, z, r: 0.34, hy: h / 2 + 0.06, walkable: true, solid: true, surface: 'wood' });
}

/** Flat paved slab with a walkable collider (top at y). */
export function slab(k: Kit, x: number, z: number, y: number, sx: number, sz: number, yaw = 0, material: Mat = 'paving', thick = 0.5): void {
  k.main.box(material, { x, y: y - thick / 2, z, sx, sy: thick, sz, yaw }, { collide: true, walkable: true, surface: 'stone', castShadow: false });
}

/** Round paved disc with a walkable cylinder collider (top at y). */
export function disc(k: Kit, x: number, z: number, y: number, r: number, material: Mat = 'paving', thick = 0.5, segments = 40): void {
  k.main.cylinder(material, { x, z, y: y - thick, r, h: thick, segments }, { collide: true, walkable: true });
}

// ---------------------------------------------------------------------------
// Frames, platforms, pavilions, cascades (additions)
// ---------------------------------------------------------------------------

/** Local frame: u along local +X, v along local +Z (front), origin o, yaw. */
export interface Frame {
  x: number;
  z: number;
  yaw: number;
}

/** World XZ of local (u, v) in a frame (three.js yaw convention). */
export function fp(f: Frame, u: number, v: number): P2 {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return { x: f.x + c * u + s * v, z: f.z - s * u + c * v };
}

/** Round platform with concentric steps (each riser <= stepUp, so no ramps needed). Top at y + steps * stepH. */
export function steppedDisc(k: Kit, o: { x: number; z: number; y: number; r: number; steps: number; stepH?: number; stepW?: number; material?: Mat; top?: Mat; segments?: number; base?: number }): number {
  const sh = o.stepH ?? 0.3;
  const sw = o.stepW ?? 0.55;
  const seg = o.segments ?? 36;
  const base = o.base ?? o.y - 0.4;
  for (let i = 0; i < o.steps; i++) {
    const r = o.r + (o.steps - 1 - i) * sw;
    const top = o.y + (i + 1) * sh;
    const mat = i === o.steps - 1 ? o.top ?? o.material ?? 'stone_white' : o.material ?? 'stone_white';
    k.main.cylinder(mat, { x: o.x, z: o.z, y: base, r, h: top - base, segments: seg }, { collide: true, walkable: true });
  }
  return o.y + o.steps * sh;
}

/**
 * Air Nomad pavilion (gazebo): slender columns on a stepped round platform,
 * a teal frieze, a concave n-sided teal roof with a gold finial. Entrances are
 * left open on the given yaw(s); other bays get a low railing.
 */
export function pavilion(k: Kit, o: { x: number; z: number; y: number; r: number; h: number; roofH?: number; sides?: number; steps?: number; entrances?: number[]; railing?: boolean; finial?: number }): number {
  const sides = o.sides ?? 8;
  const steps = o.steps ?? 3;
  const floor = steppedDisc(k, { x: o.x, z: o.z, y: o.y, r: o.r + 0.6, steps, top: 'paving' });
  const phase = Math.PI / sides;
  const colR = o.r - 0.35;
  const cols: P2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    const p = { x: o.x + Math.cos(a) * colR, z: o.z + Math.sin(a) * colR };
    cols.push(p);
    inst(k.main, 'pav_col', () => G.lathe([[0.26, 0], [0.26, 0.25], [0.19, 0.4], [0.17, 0.9], [0.17, 0.97], [0.24, 1]], 10, 1), 'plaster_white', { x: p.x, y: floor, z: p.z, sy: o.h });
    inst(k.main, 'pav_col_base', () => new THREE.CylinderGeometry(0.32, 0.36, 0.3, 10).translate(0, 0.15, 0), 'stone_light', { x: p.x, y: floor, z: p.z });
    k.main.collider({ shape: 'cylinder', x: p.x, y: floor + o.h / 2, z: p.z, r: 0.28, hy: o.h / 2, walkable: false, solid: true });
  }
  // Frieze ring + ceiling (bottom cap), gold band.
  k.main.cylinder(am('paintTeal'), { x: o.x, z: o.z, y: floor + o.h, r: o.r + 0.05, h: 0.7, segments: sides * 2 });
  k.main.cylinder('gold', { x: o.x, z: o.z, y: floor + o.h + 0.7, r: o.r + 0.12, h: 0.12, segments: sides * 2 });
  // Little round medallions on the frieze.
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    inst(k.props, 'pav_medal', () => new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12).rotateX(Math.PI / 2), 'stone_white', { x: o.x + Math.cos(a) * (o.r + 0.08), y: floor + o.h + 0.35, z: o.z + Math.sin(a) * (o.r + 0.08), yaw: faceYaw(Math.cos(a), Math.sin(a)) }, false);
  }
  const roofH = o.roofH ?? o.r * 1.15;
  const roof = G.polyRoof(o.r + 0.1, roofH, sides, 0.9, 0);
  k.main.mesh(am('roof'), roof, { x: o.x, y: floor + o.h + 0.82, z: o.z });
  roof.dispose();
  const f = G.finialGeometry(o.finial ?? 0.7);
  k.main.mesh('gold', f, { x: o.x, y: floor + o.h + 0.82 + roofH * 0.965, z: o.z });
  f.dispose();
  if (o.railing !== false) {
    const ent = o.entrances ?? [0];
    for (let i = 0; i < sides; i++) {
      const a = cols[i], b = cols[(i + 1) % sides];
      const mid = Math.atan2((a.z + b.z) / 2 - o.z, (a.x + b.x) / 2 - o.x);
      // Bay direction in yaw terms: front (+Z local) facing (cos mid, sin mid).
      const bayYaw = faceYaw(Math.cos(mid), Math.sin(mid));
      const open = ent.some((e) => Math.abs(Math.atan2(Math.sin(bayYaw - e), Math.cos(bayYaw - e))) < Math.PI / sides + 0.01);
      if (open) continue;
      balustrade(k, [a, b], { y: floor, h: 0.75 });
    }
  }
  return floor;
}

/**
 * Waterfall cascading down the terrain from a lip: a ribbon that follows the
 * slope (offset above the ground) or free-falls where the cliff overhangs.
 * Registered as a waterfall water source at the lip.
 */
export function cascade(k: Kit, o: { id: string; label: string; x: number; z: number; y: number; dirX: number; dirZ: number; width: number; length: number; heightAt: (x: number, z: number) => number; minY?: number; register?: boolean }): THREE.Mesh {
  const L = Math.hypot(o.dirX, o.dirZ);
  const dx = o.dirX / L, dz = o.dirZ / L;
  const nx = -dz, nz = dx;
  const pos: number[] = [];
  const uv: number[] = [];
  const fall: number[] = [];
  const rapid: number[] = [];
  const idx: number[] = [];
  const step = 1.0;
  const rows = Math.max(2, Math.ceil(o.length / step));
  let y = o.y;
  let vy = 0;
  let vacc = 0;
  let px = o.x, pz = o.z, py = o.y;
  let gPrev = o.heightAt(o.x, o.z);
  for (let j = 0; j <= rows; j++) {
    const s = j * step;
    const cx = o.x + dx * s, cz = o.z + dz * s;
    const half = (o.width / 2) * (1 + 0.5 * (s / o.length));
    let g = -Infinity;
    for (const t of [-1, 0, 1]) g = Math.max(g, o.heightAt(cx + nx * half * t, cz + nz * half * t));
    // Ballistic fall (horizontal speed ~4 m/s), never below the ground + offset.
    if (j > 0) {
      vy += 9.8 * (step / 4) * (step / 4) * 2;
      y -= vy;
    }
    // Stand off steep rock more (coarse terrain LODs bulge past the true surface on cliffs).
    const steep = Math.max(0, Math.min(2, (gPrev - g) / step)) / 2;
    gPrev = g;
    const floor = g + 0.5 + 2.4 * steep;
    if (y < floor) {
      y = floor;
      vy = 0.4;
    }
    if (o.minY !== undefined && y < o.minY) break;
    if (j > 0) vacc += Math.hypot(cx - px, y - py, cz - pz);
    px = cx;
    pz = cz;
    py = y;
    pos.push(cx - nx * half - o.x, y - o.y, cz - nz * half - o.z, cx + nx * half - o.x, y - o.y, cz + nz * half - o.z);
    uv.push(0, vacc / 6, 1, vacc / 6);
    fall.push(1, 1);
    rapid.push(1, 1);
  }
  const n = pos.length / 6;
  for (let j = 0; j < n - 1; j++) {
    // Wound so the front face looks up/out, away from the rock.
    const a = j * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('fall', new THREE.Float32BufferAttribute(fall, 1));
  geo.setAttribute('rapid', new THREE.Float32BufferAttribute(rapid, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, am('falls'));
  m.position.set(o.x, o.y, o.z);
  m.renderOrder = 3;
  m.name = `falls_${o.id}`;
  k.addMesh(m, 'main');
  if (o.register !== false) k.registerWater({ id: o.id, type: 'waterfall', label: o.label, x: o.x + dx * 1.5, y: o.y - 0.4, z: o.z + dz * 1.5, r: Math.max(1, o.width / 2), capacity: Infinity, regen: 0, size: 'medium' });
  return m;
}

/** Balustrade along a circular arc (centre, radius, angle range), split into ~seg-metre pieces. */
export function arcRail(k: Kit, cx: number, cz: number, r: number, a0: number, a1: number, y: number | ((x: number, z: number) => number), o: { seg?: number; h?: number; solid?: boolean } = {}): void {
  const len = Math.abs(a1 - a0) * r;
  const n = Math.max(1, Math.round(len / (o.seg ?? 4)));
  const pts = arcPoints(cx, cz, r, a0, a1, n);
  if (typeof y === 'number') {
    balustrade(k, pts, { y, h: o.h, solid: o.solid });
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const m = { x: (pts[i].x + pts[i + 1].x) / 2, z: (pts[i].z + pts[i + 1].z) / 2 };
    balustrade(k, [pts[i], pts[i + 1]], { y: y(m.x, m.z), h: o.h, solid: o.solid });
  }
}

/**
 * Monks' quarters / refectory / scriptorium: a plastered house on a stone
 * plinth with arched windows, a door portal facing local +Z, skirt roofs
 * between floors and a teal hip roof. Solid (walkable roof) collider.
 */
export function quarters(k: Kit, o: { x: number; z: number; y: number; w: number; d: number; floors?: number; yaw?: number; roofH?: number; wall?: Mat }): void {
  const yaw = o.yaw ?? 0;
  const floors = o.floors ?? 2;
  // Single-storey halls are taller so the door portal and its little roof sit under the eaves.
  const fh = floors === 1 ? 4.7 : 3.4;
  const h = floors * fh;
  const roofH = o.roofH ?? Math.min(o.w, o.d) * 0.5;
  const b = k.main;
  const base = o.y + 0.45;
  b.block('stone_white', { x: o.x, y: o.y - 0.4, z: o.z, sx: o.w + 0.9, sy: 0.85, sz: o.d + 0.9, yaw }, { collide: true, walkable: true });
  b.block(o.wall ?? 'plaster_cream', { x: o.x, y: base, z: o.z, sx: o.w, sy: h, sz: o.d, yaw });
  b.collider({ shape: 'box', x: o.x, y: base + (h + roofH * 0.4) / 2, z: o.z, hx: o.w / 2 + 0.1, hy: (h + roofH * 0.4) / 2, hz: o.d / 2 + 0.1, yaw, walkable: true, solid: true });
  const cx = Math.cos(yaw), sz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (let f = 1; f < floors; f++) {
    const fy = base + f * fh;
    b.box('stone_light', { x: o.x, y: fy, z: o.z, sx: o.w + 0.3, sy: 0.3, sz: o.d + 0.3, yaw });
    b.roof(am('roof'), { x: o.x, y: fy + 0.12, z: o.z, w: o.w, d: o.d, height: 0.7, yaw, overhang: 0.85, style: 'hip', curve: 0.4, ridge: null });
  }
  // Corner pilasters.
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      b.box('stone_white', { x: o.x + cx * s1 * (o.w / 2) + fx * s2 * (o.d / 2), y: base + h / 2, z: o.z + sz * s1 * (o.w / 2) + fz * s2 * (o.d / 2), sx: 0.5, sy: h, sz: 0.5, yaw });
    }
  }
  // Arched windows on the long faces.
  const per = Math.max(1, Math.floor(o.w / 3.2));
  for (let f = 0; f < floors; f++) {
    const wy = base + f * fh + 1.25;
    for (let i = 0; i < per; i++) {
      const u = (i + 0.5) * (o.w / per) - o.w / 2;
      if (f === 0 && Math.abs(u) < 1.3) continue; // door
      for (const s of [-1, 1]) {
        const off = s * (o.d / 2 + 0.02);
        inst(k.props, 'q_window', () => archedWindowGeo(), am('window'), { x: o.x + cx * u + fx * off, y: wy, z: o.z + sz * u + fz * off, yaw: s > 0 ? yaw : yaw + Math.PI }, false);
      }
    }
  }
  portal(k, o.x + fx * (o.d / 2), base, o.z + fz * (o.d / 2), yaw, 1.8, 2.5);
  b.roof(am('roof'), { x: o.x, y: base + h, z: o.z, w: o.w, d: o.d, height: roofH, yaw, style: 'hip', overhang: 0.8, curve: 0.35, ridge: am('roofTrim') });
  const fin = G.finialGeometry(0.35);
  for (const s of [-1, 1]) {
    const ridge = Math.max(0.5, (o.w - o.d) / 2 + 0.5);
    b.mesh('gold', fin, { x: o.x + cx * s * ridge, y: base + h + roofH + 0.1, z: o.z + sz * s * ridge });
  }
  fin.dispose();
}

/** Terrain-hugging lawn disc (visual): polar grid `lift` above the ground, UVs in world metres / tile. */
export function lawnGeometry(cx: number, cz: number, r: number, heightAt: (x: number, z: number) => number, lift = 0.08, tile = 3): THREE.BufferGeometry {
  const rings = 20, segs = 96;
  const pos: number[] = [cx, heightAt(cx, cz) + lift, cz];
  const uv: number[] = [cx / tile, cz / tile];
  for (let i = 1; i <= rings; i++) {
    const rr = (r * i) / rings;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      pos.push(x, heightAt(x, z) + lift, z);
      uv.push(x / tile, z / tile);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    const r0 = 1 + (i - 1) * segs, r1 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(r0 + j, r0 + j1, r1 + j, r0 + j1, r1 + j1, r1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
