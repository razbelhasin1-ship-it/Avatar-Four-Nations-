import * as THREE from 'three';
import type { SurfaceType } from '../core/types';

/**
 * Static + dynamic collision world for architecture and bending constructs.
 *
 * Colliders are Y-rotated boxes, vertical cylinders and spheres. Boxes and
 * cylinders can be `walkable` (their top is ground you can stand on) — bridges,
 * floors, stairs (box with `slope`), earth pillars, ice walls.
 *
 * Terrain itself is NOT in here; World combines terrain height with these.
 */

export type ColliderShape = 'box' | 'cylinder' | 'sphere';

export interface ColliderDef {
  shape: ColliderShape;
  /** Centre of the collider. For box/cylinder the vertical extent is center.y ± halfHeight. */
  x: number;
  y: number;
  z: number;
  /** Box half extents (local X/Z before yaw). */
  hx?: number;
  hz?: number;
  /** Vertical half extent (box & cylinder). */
  hy?: number;
  /** Cylinder / sphere radius. */
  r?: number;
  /** Box yaw (radians). */
  yaw?: number;
  /**
   * Ramp: top surface rises linearly along local +X from (y + hy - slopeRise) at -hx
   * to (y + hy) at +hx. Use for stairs and ramps.
   */
  slopeRise?: number;
  walkable?: boolean;
  /** Blocks horizontal movement (walls). Default true. */
  solid?: boolean;
  surface?: SurfaceType;
  tag?: string;
  /** Owner id for dynamic colliders (e.g. technique instance id). */
  owner?: number;
}

export interface Collider extends Required<Omit<ColliderDef, 'tag' | 'owner' | 'slopeRise'>> {
  id: number;
  tag?: string;
  owner?: number;
  slopeRise: number;
  /** Precomputed cos/sin of yaw. */
  c: number;
  s: number;
  /** Bounding radius in XZ for broadphase. */
  br: number;
  dynamic: boolean;
}

const CELL = 16;

function cellKey(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}

export interface GroundHit {
  y: number;
  surface: SurfaceType;
  colliderId: number;
}

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  colliderId: number;
}

export class CollisionWorld {
  private colliders = new Map<number, Collider>();
  private grid = new Map<number, Set<number>>();
  private nextId = 1;
  private readonly queryStamp = new Map<number, number>();
  private stamp = 0;

  add(def: ColliderDef, dynamic = false): number {
    const id = this.nextId++;
    const yaw = def.yaw ?? 0;
    const hx = def.hx ?? def.r ?? 0.5;
    const hz = def.hz ?? def.r ?? 0.5;
    const r = def.r ?? Math.max(hx, hz);
    const col: Collider = {
      id,
      shape: def.shape,
      x: def.x,
      y: def.y,
      z: def.z,
      hx,
      hz,
      hy: def.hy ?? (def.shape === 'sphere' ? r : 0.5),
      r,
      yaw,
      slopeRise: def.slopeRise ?? 0,
      walkable: def.walkable ?? false,
      solid: def.solid ?? true,
      surface: def.surface ?? 'stone',
      tag: def.tag,
      owner: def.owner,
      c: Math.cos(yaw),
      s: Math.sin(yaw),
      br: def.shape === 'box' ? Math.hypot(hx, hz) : r,
      dynamic,
    };
    this.colliders.set(id, col);
    this.insert(col);
    return id;
  }

  remove(id: number): void {
    const col = this.colliders.get(id);
    if (!col) return;
    this.forCells(col, (k) => this.grid.get(k)?.delete(id));
    this.colliders.delete(id);
  }

  /** Remove all colliders with a tag (e.g. when unloading a region). */
  removeByTag(tag: string): void {
    for (const c of [...this.colliders.values()]) if (c.tag === tag) this.remove(c.id);
  }

  get(id: number): Collider | undefined {
    return this.colliders.get(id);
  }

  /** Move a dynamic collider (e.g. rising earth pillar). */
  update(id: number, patch: Partial<Pick<ColliderDef, 'x' | 'y' | 'z' | 'hy' | 'hx' | 'hz' | 'r' | 'yaw'>>): void {
    const col = this.colliders.get(id);
    if (!col) return;
    this.forCells(col, (k) => this.grid.get(k)?.delete(id));
    Object.assign(col, patch);
    col.c = Math.cos(col.yaw);
    col.s = Math.sin(col.yaw);
    col.br = col.shape === 'box' ? Math.hypot(col.hx, col.hz) : col.r;
    this.insert(col);
  }

  get count(): number {
    return this.colliders.size;
  }

  private forCells(col: Collider, fn: (key: number) => void): void {
    const x0 = Math.floor((col.x - col.br) / CELL), x1 = Math.floor((col.x + col.br) / CELL);
    const z0 = Math.floor((col.z - col.br) / CELL), z1 = Math.floor((col.z + col.br) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) fn(cellKey(cx, cz));
  }

  private insert(col: Collider): void {
    this.forCells(col, (k) => {
      let set = this.grid.get(k);
      if (!set) {
        set = new Set();
        this.grid.set(k, set);
      }
      set.add(col.id);
    });
  }

  /** Visit colliders overlapping an XZ circle (each once). */
  query(x: number, z: number, radius: number, fn: (c: Collider) => void): void {
    const stamp = ++this.stamp;
    const x0 = Math.floor((x - radius) / CELL), x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL), z1 = Math.floor((z + radius) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const set = this.grid.get(cellKey(cx, cz));
        if (!set) continue;
        for (const id of set) {
          if (this.queryStamp.get(id) === stamp) continue;
          this.queryStamp.set(id, stamp);
          const c = this.colliders.get(id);
          if (!c) continue;
          const dx = c.x - x, dz = c.z - z;
          const rr = c.br + radius;
          if (dx * dx + dz * dz <= rr * rr) fn(c);
        }
      }
    }
  }

  /** Local XZ of point in a box collider frame. */
  private toLocal(c: Collider, x: number, z: number): [number, number] {
    const dx = x - c.x, dz = z - c.z;
    // Rotate by -yaw. With yaw rotation about +Y: world = (lx*c + lz*s, -lx*s + lz*c)
    return [dx * c.c - dz * c.s, dx * c.s + dz * c.c];
  }

  /** Top height of a walkable collider at (x,z), or -Infinity if outside its footprint. */
  topAt(c: Collider, x: number, z: number, margin = 0): number {
    if (c.shape === 'box') {
      const [lx, lz] = this.toLocal(c, x, z);
      if (Math.abs(lx) > c.hx + margin || Math.abs(lz) > c.hz + margin) return -Infinity;
      const top = c.y + c.hy;
      if (c.slopeRise > 0) {
        const t = Math.max(0, Math.min(1, (lx + c.hx) / (2 * c.hx)));
        return top - c.slopeRise * (1 - t);
      }
      return top;
    }
    if (c.shape === 'cylinder') {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > (c.r + margin) * (c.r + margin)) return -Infinity;
      return c.y + c.hy;
    }
    const dx = x - c.x, dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > c.r * c.r) return -Infinity;
    return c.y + Math.sqrt(c.r * c.r - d2);
  }

  /**
   * Highest walkable collider top under (x,z) that is at or below `maxY`
   * (feet height + step allowance). Returns null if none.
   */
  groundAt(x: number, z: number, maxY: number, footRadius = 0.25): GroundHit | null {
    let best: GroundHit | null = null;
    this.query(x, z, footRadius, (c) => {
      if (!c.walkable) return;
      const top = this.topAt(c, x, z, footRadius * 0.6);
      if (top === -Infinity || top > maxY) return;
      if (!best || top > best.y) best = { y: top, surface: c.surface, colliderId: c.id };
    });
    return best;
  }

  /**
   * Push a vertical capsule (approximated as cylinder: position = feet, radius,
   * height) out of solid colliders. Colliders whose top is below feet + stepUp are
   * ignored (you step onto them instead). Mutates `pos`. Returns true if pushed.
   */
  resolveCylinder(pos: THREE.Vector3, radius: number, height: number, stepUp = 0.45): boolean {
    let pushed = false;
    this.query(pos.x, pos.z, radius + 0.1, (c) => {
      if (!c.solid) return;
      const bottom = c.y - c.hy;
      let top = c.y + c.hy;
      if (c.shape === 'sphere') top = c.y + c.r;
      if (pos.y + height <= bottom || pos.y >= top - 0.02) return;
      if (c.walkable && top - pos.y <= stepUp) return;
      if (c.shape === 'box') {
        // Ramps are walkable along their slope; only block from the sides when well below top.
        let effTop = top;
        if (c.slopeRise > 0) {
          effTop = this.topAt(c, pos.x, pos.z, radius);
          if (effTop !== -Infinity && effTop - pos.y <= stepUp + 0.2) return;
        }
        const [lx, lz] = this.toLocal(c, pos.x, pos.z);
        const ox = c.hx + radius - Math.abs(lx);
        const oz = c.hz + radius - Math.abs(lz);
        if (ox <= 0 || oz <= 0) return;
        let nlx = lx, nlz = lz;
        if (ox < oz) nlx = Math.sign(lx || 1) * (c.hx + radius);
        else nlz = Math.sign(lz || 1) * (c.hz + radius);
        // back to world
        pos.x = c.x + nlx * c.c + nlz * c.s;
        pos.z = c.z - nlx * c.s + nlz * c.c;
        pushed = true;
      } else {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const d = Math.hypot(dx, dz);
        let rr = c.r + radius;
        if (c.shape === 'sphere') {
          const cy = Math.max(pos.y, Math.min(pos.y + height, c.y));
          const dy = cy - c.y;
          const rAtY = Math.sqrt(Math.max(0, c.r * c.r - dy * dy));
          rr = rAtY + radius;
        }
        if (d >= rr) return;
        const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
        pos.x = c.x + nx * rr;
        pos.z = c.z + nz * rr;
        pushed = true;
      }
    });
    return pushed;
  }

  /** Lowest solid collider bottom above a point (ceiling check for jumping). */
  ceilingAt(x: number, z: number, fromY: number, radius = 0.3): number {
    let best = Infinity;
    this.query(x, z, radius, (c) => {
      if (!c.solid) return;
      const bottom = c.y - c.hy;
      if (bottom < fromY) return;
      const inside = c.shape === 'box' ? this.topAt(c, x, z, radius) !== -Infinity : Math.hypot(x - c.x, z - c.z) < c.r + radius;
      if (inside && bottom < best) best = bottom;
    });
    return best;
  }

  /** Overlap test for a sphere against solid colliders. */
  overlapSphere(center: THREE.Vector3, radius: number): Collider | null {
    let hit: Collider | null = null;
    this.query(center.x, center.z, radius, (c) => {
      if (hit || !c.solid) return;
      if (c.shape === 'box') {
        const [lx, lz] = this.toLocal(c, center.x, center.z);
        const qx = Math.max(-c.hx, Math.min(c.hx, lx));
        const qz = Math.max(-c.hz, Math.min(c.hz, lz));
        const qy = Math.max(c.y - c.hy, Math.min(c.y + c.hy, center.y));
        const dx = lx - qx, dz = lz - qz, dy = center.y - qy;
        if (dx * dx + dy * dy + dz * dz < radius * radius) hit = c;
      } else if (c.shape === 'cylinder') {
        const d = Math.hypot(center.x - c.x, center.z - c.z);
        if (d < c.r + radius && center.y > c.y - c.hy - radius && center.y < c.y + c.hy + radius) hit = c;
      } else {
        const d = Math.hypot(center.x - c.x, center.y - c.y, center.z - c.z);
        if (d < c.r + radius) hit = c;
      }
    });
    return hit;
  }

  /** Ray vs colliders (slab test for boxes, analytic for cylinders/spheres). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter?: (c: Collider) => boolean): RayHit | null {
    let best: RayHit | null = null;
    const steps = Math.ceil(maxDist / CELL) + 1;
    const visited = new Set<number>();
    for (let i = 0; i <= steps; i++) {
      const t = Math.min(maxDist, i * CELL);
      const px = origin.x + dir.x * t, pz = origin.z + dir.z * t;
      this.query(px, pz, CELL * 0.75, (c) => {
        if (visited.has(c.id)) return;
        visited.add(c.id);
        if (!c.solid || (filter && !filter(c))) return;
        const hit = this.rayCollider(c, origin, dir, maxDist);
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      });
      if (best && (best as RayHit).distance < t) break;
    }
    return best;
  }

  private rayCollider(c: Collider, o: THREE.Vector3, d: THREE.Vector3, maxDist: number): RayHit | null {
    if (c.shape === 'box') {
      const [ox, oz] = this.toLocal(c, o.x, o.z);
      const dx = d.x * c.c - d.z * c.s;
      const dz = d.x * c.s + d.z * c.c;
      const oy = o.y - c.y;
      let tmin = 0, tmax = maxDist;
      let nAxis = -1, nSign = 0;
      const slab = (oo: number, dd: number, h: number, axis: number): boolean => {
        if (Math.abs(dd) < 1e-9) return oo >= -h && oo <= h;
        let t1 = (-h - oo) / dd, t2 = (h - oo) / dd;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        // Entering face normal opposes the ray direction on this axis.
        if (t1 > tmin) { tmin = t1; nAxis = axis; nSign = dd > 0 ? -1 : 1; }
        if (t2 < tmax) tmax = t2;
        return tmin <= tmax;
      };
      if (!slab(ox, dx, c.hx, 0) || !slab(oy, d.y, c.hy, 1) || !slab(oz, dz, c.hz, 2)) return null;
      if (tmin <= 0 || tmin > maxDist) return null;
      const n = new THREE.Vector3();
      if (nAxis === 1) n.set(0, nSign, 0);
      else {
        const lx = nAxis === 0 ? nSign : 0, lz = nAxis === 2 ? nSign : 0;
        n.set(lx * c.c + lz * c.s, 0, -lx * c.s + lz * c.c);
      }
      return { distance: tmin, point: o.clone().addScaledVector(d, tmin), normal: n, colliderId: c.id };
    }
    if (c.shape === 'cylinder') {
      const ox = o.x - c.x, oz = o.z - c.z;
      const a = d.x * d.x + d.z * d.z;
      if (a < 1e-9) return null;
      const b = 2 * (ox * d.x + oz * d.z);
      const cc = ox * ox + oz * oz - c.r * c.r;
      const disc = b * b - 4 * a * cc;
      if (disc < 0) return null;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t <= 0 || t > maxDist) return null;
      const y = o.y + d.y * t;
      if (y < c.y - c.hy || y > c.y + c.hy) return null;
      const p = o.clone().addScaledVector(d, t);
      return { distance: t, point: p, normal: new THREE.Vector3(p.x - c.x, 0, p.z - c.z).normalize(), colliderId: c.id };
    }
    const oc = new THREE.Vector3(o.x - c.x, o.y - c.y, o.z - c.z);
    const b = oc.dot(d);
    const cc = oc.lengthSq() - c.r * c.r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t <= 0 || t > maxDist) return null;
    const p = o.clone().addScaledVector(d, t);
    return { distance: t, point: p, normal: p.clone().sub(new THREE.Vector3(c.x, c.y, c.z)).normalize(), colliderId: c.id };
  }

  clearDynamic(): void {
    for (const c of [...this.colliders.values()]) if (c.dynamic) this.remove(c.id);
  }

  clear(): void {
    this.colliders.clear();
    this.grid.clear();
  }
}
