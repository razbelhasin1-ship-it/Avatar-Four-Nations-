import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import type { P2 } from '../../WorldLayout';
import type { ArchetypeId, HouseArchetype } from './archetypes';
import type { BuildEnv } from './env';
import { stripGeometry } from './geom';
import { laundry, lanternPost } from './parts';

/**
 * Settlement layout helpers shared by Ba Sing Se, Gaoling and Riverbend:
 * concentric house rows (instanced/merged archetypes with colliders), paved
 * strips, lantern lines, laundry across lanes.
 */

export interface RowOpts {
  /** Ring centre. */
  c: P2;
  /** Outer radius of the band (footprints stay inside rOuter - edge). */
  rOuter: number;
  /** Clear street along the outer edge. */
  edge: number;
  /** Stop when rows get this close to the centre. */
  rStop: number;
  y: number;
  types: Array<[ArchetypeId, number]>;
  /** Row depth (m) and street width between facing row pairs. */
  pitch: number;
  street: number;
  /** Gap between neighbouring houses along a row [min, max]. */
  gap: [number, number];
  /** Radial alleys every `alleyEvery` radians (0 = none), `alleyW` metres wide. */
  alleyEvery: number;
  alleyW: number;
  scale?: [number, number];
  /** Extra rejection (corners are tested); true = blocked. */
  reject?: (x: number, z: number) => boolean;
  /** Probability to leave an empty lot (gardens / courtyards). */
  vacancy?: number;
  /** Laundry lines across the lanes between facing rows (probability per house). */
  laundry?: number;
  /** Tint palette. */
  tints?: THREE.ColorRepresentation[];
  /** Called for each empty lot (small gardens, wells...). */
  onVacant?: (x: number, z: number, yaw: number, hw: number, hd: number) => void;
}

function pickWeighted<T>(rnd: { next(): number }, list: Array<[T, number]>): T {
  let tot = 0;
  for (const [, w] of list) tot += w;
  let r = rnd.next() * tot;
  for (const [v, w] of list) {
    r -= w;
    if (r <= 0) return v;
  }
  return list[list.length - 1][0];
}

/** Placement statistics of the last houseRows() call (debugging). */
export const lastStats = { lots: 0, outside: 0, rejected: 0, blocked: 0 };

/** Concentric rows of houses (fronts alternate outward / inward so pairs face a lane). Returns the count. */
export function houseRows(env: BuildEnv, o: RowOpts): number {
  lastStats.lots = lastStats.outside = lastStats.rejected = lastStats.blocked = 0;
  const rnd = env.rnd;
  const tints = (o.tints ?? ['#ffffff', '#f4efe6', '#efe9dc', '#fbf6ea', '#e9e4da', '#f7efe2']).map((c) => new THREE.Color(c));
  let count = 0;
  let k = 0;
  let rho = o.rOuter - o.edge - o.pitch / 2;
  const rowRadii: Array<{ rho: number; out: boolean }> = [];
  while (rho > o.rStop) {
    rowRadii.push({ rho, out: k % 2 === 0 });
    rho -= o.pitch + (k % 2 === 1 ? o.street : 0);
    k++;
  }
  const corners = (x: number, z: number, yaw: number, hw: number, hd: number): P2[] => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const out: P2[] = [];
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, hd], [0, -hd]]) out.push({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
    return out;
  };
  const fronts: Array<{ k: number; th: number; x: number; z: number; h: number }> = [];
  rowRadii.forEach(({ rho: r, out }, ki) => {
    let th = rnd.range(0, 0.05);
    const end = th + Math.PI * 2 - 0.02;
    while (th < end) {
      const id = pickWeighted(rnd, o.types);
      const a: HouseArchetype = env.arch[id];
      const sc = o.scale ? rnd.range(o.scale[0], o.scale[1]) : 1;
      const w = a.spanW * sc;
      const d = Math.min(a.spanD * sc, o.pitch - 0.4);
      const gap = rnd.range(o.gap[0], o.gap[1]);
      const dth = (w + gap) / r;
      // Radial alleys: if this lot would straddle an alley line, restart just past it.
      if (o.alleyEvery > 0) {
        const half = o.alleyW / 2 / r;
        const j0 = Math.floor((th - half) / o.alleyEvery), j1 = Math.floor((th + dth + half) / o.alleyEvery);
        if (j1 !== j0) {
          th = j1 * o.alleyEvery + half + 0.001;
          continue;
        }
      }
      const tm = th + dth / 2;
      th += dth;
      const ox = Math.cos(tm), oz = Math.sin(tm);
      const x = o.c.x + ox * r, z = o.c.z + oz * r;
      const yaw = out ? Math.atan2(ox, oz) : Math.atan2(-ox, -oz);
      const hw = w / 2, hd = d / 2;
      const cs = corners(x, z, yaw, hw, hd);
      lastStats.lots++;
      if (cs.some((p) => Math.hypot(p.x - o.c.x, p.z - o.c.z) > o.rOuter - o.edge)) {
        lastStats.outside++;
        continue;
      }
      if (o.reject && cs.some((p) => o.reject!(p.x, p.z))) {
        lastStats.rejected++;
        continue;
      }
      if (env.excl.rectBlocked(x, z, hw, hd, yaw, 0.6)) {
        lastStats.blocked++;
        continue;
      }
      if (o.vacancy && rnd.chance(o.vacancy)) {
        o.onVacant?.(x, z, yaw, hw, hd);
        continue;
      }
      env.chunks.addHouse(a, x, o.y, z, yaw, { scale: sc, tint: tints[Math.floor(rnd.next() * tints.length)] });
      count++;
      const fx = x + Math.sin(yaw) * (a.d * sc) / 2, fz = z + Math.cos(yaw) * (a.d * sc) / 2;
      fronts.push({ k: ki, th: tm, x: fx, z: fz, h: a.h * sc });
    }
  });
  // Laundry lines between facing rows (row 2j+1 faces row 2j+2).
  if (o.laundry && o.laundry > 0) {
    const byRow = new Map<number, typeof fronts>();
    for (const f of fronts) {
      let l = byRow.get(f.k);
      if (!l) byRow.set(f.k, (l = []));
      l.push(f);
    }
    for (const [k1, list] of byRow) {
      if (k1 % 2 !== 1) continue;
      const other = byRow.get(k1 + 1);
      if (!other || !other.length) continue;
      for (const f of list) {
        if (!rnd.chance(o.laundry)) continue;
        // Nearest facing front by angle.
        let best = other[0], bd = Infinity;
        for (const g of other) {
          const d = Math.abs(g.th - f.th);
          if (d < bd) {
            bd = d;
            best = g;
          }
        }
        const span = Math.hypot(best.x - f.x, best.z - f.z);
        if (span > 14 || span < 3) continue;
        const y = o.y + Math.min(f.h, best.h) * 0.8;
        const b = env.chunks.at('detail', f.x, f.z).builder;
        laundry(b, env.mats, new THREE.Vector3(f.x, y, f.z), new THREE.Vector3(best.x, y, best.z), rnd);
      }
    }
  }
  return count;
}

/** Paved strip (avenue, street) following a polyline, merged into a chunk builder. */
export function pavedStrip(b: ContentBuilder, mat: THREE.Material, pts: P2[], width: number, y: number, tile = 5): void {
  const g = stripGeometry(densify(pts, 6), width / 2, y, tile);
  b.mesh(mat, g, { x: 0, y: 0, z: 0 }, { castShadow: false });
  g.dispose();
}

/** Insert points so long straight runs follow the ground and chunk bounds stay sane. */
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

/** Lantern posts along both sides of a polyline every `every` metres. */
export function lanternsAlong(env: BuildEnv, pts: P2[], halfW: number, y: number, every: number, color: 'red' | 'warm' = 'red'): void {
  const d = densify(pts, 1);
  let acc = every / 2;
  for (let i = 1; i < d.length; i++) {
    const a = d[i - 1], b = d[i];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    acc += l;
    if (acc < every) continue;
    acc = 0;
    const tx = (b.x - a.x) / (l || 1), tz = (b.z - a.z) / (l || 1);
    for (const sd of [-1, 1]) {
      const x = b.x - tz * sd * halfW, z = b.z + tx * sd * halfW;
      const pb = env.chunks.at('props', x, z).builder;
      lanternPost(pb, x, y, z, color);
      pb.collider({ shape: 'cylinder', x, y: y + 1.5, z, r: 0.2, hy: 1.5, walkable: false, solid: true });
    }
  }
}

/** Unit direction and length of a segment. */
export function segDir(a: P2, b: P2): { x: number; z: number; len: number } {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len, len };
}
