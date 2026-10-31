import type { GameContext } from '../../../../core/GameContext';
import type { Collider } from '../../../Collision';
import { C, inArc, radiusOf, thetaOf } from './layout';

/**
 * Walkability grid of one level of the temple, built from what is actually there: a cell is free
 * when the level's floor is under it (no edge, no drop) and no wall, plinth, pool rim, prop or
 * stair mass stands in it. Monks plan their spurs off the road with it (A* plus string pulling).
 */

/**
 * Does a collider block walking at floor height `floor` round (x, z) (radius r)? Walkable tops a
 * step or less above the floor (stair ramps included, at their height there) do not; dynamic
 * colliders (bison, doors) are ignored: they move.
 */
export function blocksWalk(ctx: GameContext, c: Collider, x: number, z: number, r: number, floor: number): boolean {
  if (c.dynamic) return false;
  if (c.y - c.hy > floor + 1.8 || c.y + c.hy < floor + 0.3) return false;
  if (c.walkable) {
    const top = ctx.world.collision.topAt(c, x, z, r);
    if (top !== -Infinity && top <= floor + 0.45) return false;
  }
  if (c.shape === 'box') {
    const dx = x - c.x, dz = z - c.z;
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const qx = Math.max(0, Math.abs(lx) - c.hx), qz = Math.max(0, Math.abs(lz) - c.hz);
    return qx * qx + qz * qz < r * r;
  }
  return Math.hypot(x - c.x, z - c.z) < r + c.r;
}

export interface Area {
  a0: number;
  a1: number;
  r0: number;
  r1: number;
}

export class WalkGrid {
  readonly cell: number;
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  readonly free: Uint8Array;

  /** Grid over the given polar areas (bearings in degrees) at walking height `floor`. */
  constructor(ctx: GameContext, readonly floor: number, areas: Area[], cell = 1.2) {
    this.cell = cell;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const a of areas) {
      for (let t = a.a0; t <= a.a1 + 0.01; t += 2) {
        for (const r of [a.r0, a.r1]) {
          const x = C.x + Math.cos((t * Math.PI) / 180) * r, z = C.z + Math.sin((t * Math.PI) / 180) * r;
          x0 = Math.min(x0, x);
          z0 = Math.min(z0, z);
          x1 = Math.max(x1, x);
          z1 = Math.max(z1, z);
        }
      }
    }
    this.x0 = x0 - cell;
    this.z0 = z0 - cell;
    this.w = Math.ceil((x1 - x0) / cell) + 3;
    this.h = Math.ceil((z1 - z0) / cell) + 3;
    this.free = new Uint8Array(this.w * this.h);
    const col = ctx.world.collision;
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = this.x0 + (i + 0.5) * cell, z = this.z0 + (j + 0.5) * cell;
        const th = thetaOf(x, z), r = radiusOf(x, z);
        if (!areas.some((a) => r >= a.r0 && r <= a.r1 && inArc(th, a.a0, a.a1))) continue;
        const g = col.groundAt(x, z, floor + 0.45);
        if (!g || Math.abs(g.y - floor) > 0.35) continue;
        let ok = true;
        col.query(x, z, 2, (c) => {
          if (ok && blocksWalk(ctx, c, x, z, 0.42, floor)) ok = false;
        });
        if (ok) this.free[i + j * this.w] = 1;
      }
    }
  }

  private ix(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return i + j * this.w;
  }

  isFree(x: number, z: number): boolean {
    const k = this.ix(x, z);
    return k >= 0 && this.free[k] === 1;
  }

  /** Nearest free cell centre within `maxR` metres (or null). */
  nearestFree(x: number, z: number, maxR = 5): { x: number; z: number } | null {
    if (this.isFree(x, z)) return { x, z };
    const n = Math.ceil(maxR / this.cell);
    let best: { x: number; z: number } | null = null, bd = Infinity;
    const ci = Math.floor((x - this.x0) / this.cell), cj = Math.floor((z - this.z0) / this.cell);
    for (let dj = -n; dj <= n; dj++) {
      for (let di = -n; di <= n; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h || !this.free[i + j * this.w]) continue;
        const px = this.x0 + (i + 0.5) * this.cell, pz = this.z0 + (j + 0.5) * this.cell;
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bd) {
          bd = d;
          best = { x: px, z: pz };
        }
      }
    }
    return best;
  }

  /** Straight walk from a to b stays on free cells. */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / (this.cell * 0.4)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (!this.isFree(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** A* over free cells (8-connected), string-pulled; null if no way. Endpoints snap to free cells. */
  path(ax: number, az: number, bx: number, bz: number): Array<{ x: number; z: number }> | null {
    const a = this.nearestFree(ax, az), b = this.nearestFree(bx, bz);
    if (!a || !b) return null;
    if (this.los(a.x, a.z, b.x, b.z)) return [a, b];
    const s = this.ix(a.x, a.z), g = this.ix(b.x, b.z);
    const W = this.w, N = this.w * this.h;
    const gs = new Float32Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap: Array<[number, number]> = [];
    const gx = g % W, gz = (g / W) | 0;
    const hf = (k: number) => {
      const dx = Math.abs((k % W) - gx), dz = Math.abs(((k / W) | 0) - gz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    const push = (k: number, f: number) => {
      heap.push([f, k]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0][1];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    gs[s] = 0;
    push(s, hf(s));
    let found = false;
    let iter = 0;
    while (heap.length && iter++ < 60000) {
      const k = pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === g) {
        found = true;
        break;
      }
      const kx = k % W, kz = (k / W) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = kx + dx, nz = kz + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= this.h) continue;
          const nk = nx + nz * W;
          if (!this.free[nk] || closed[nk]) continue;
          // No corner cutting.
          if (dx && dz && (!this.free[kx + dx + kz * W] || !this.free[kx + (kz + dz) * W])) continue;
          const ng = gs[k] + (dx && dz ? 1.414 : 1);
          if (ng < gs[nk]) {
            gs[nk] = ng;
            from[nk] = k;
            push(nk, ng + hf(nk));
          }
        }
      }
    }
    if (!found) return null;
    const cells: Array<{ x: number; z: number }> = [];
    for (let k = g; k !== -1; k = from[k]) cells.push({ x: this.x0 + ((k % W) + 0.5) * this.cell, z: this.z0 + (((k / W) | 0) + 0.5) * this.cell });
    cells.reverse();
    cells[0] = a;
    cells[cells.length - 1] = b;
    // String pulling: keep the farthest point in sight.
    const out = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.los(cells[i].x, cells[i].z, cells[j].x, cells[j].z)) j--;
      out.push(cells[j]);
      i = j;
    }
    return out;
  }
}
