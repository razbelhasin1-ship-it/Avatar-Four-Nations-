import * as THREE from 'three';
import type { ColliderDef, CollisionWorld } from './Collision';

/**
 * Rocks placed by region content that an earthbender can lift (player/play/RockLift).
 * ContentBuilder.rock() / rockInstance() keep each one out of the static merges (its own
 * mesh, or one instance of an InstancedMesh) and register it here, so it can be hidden
 * while lifted and moved, collider and all, to wherever it is set down. The world's
 * scattered vegetation rocks are lifted through VegetationSystem instead.
 *
 * Positions are not saved: a region rebuilt next session has its rocks back in place.
 */

/** Liftable size (metres): from a fist-sized stone up to a boulder, never anything house-sized. */
export const LIFT_MAX_RADIUS = 2.4;
export const LIFT_MAX_HEIGHT = 3.6;
const LIFT_MIN_RADIUS = 0.12;

export interface WorldRock {
  readonly id: number;
  /** Who registered it (the ContentBuilder): everything of an owner goes together. */
  readonly owner: object;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  /** Rock-local → world, scale included. */
  readonly matrix: THREE.Matrix4;
  /** Centre of the geometry's bounds (rock-local): the lifted rock pivots here. */
  readonly localCenter: THREE.Vector3;
  /** World centre of its bounds. */
  readonly center: THREE.Vector3;
  /** Horizontal and vertical half extents (world). */
  radius: number;
  halfHeight: number;
  lifted: boolean;
  readonly mesh: THREE.Mesh | null;
  readonly inst: THREE.InstancedMesh | null;
  readonly index: number;
  /** Its collider (0 = none) and the definition to rebuild it where it lands (offset from `center`). */
  colliderId: number;
  readonly collider: (ColliderDef & { dx: number; dy: number; dz: number }) | null;
}

const tBox = new THREE.Box3();
const tV = new THREE.Vector3();
const tM = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** World half extents of `geometry` placed by `matrix` (x/z radius, y half height) and its local centre. */
export function rockExtents(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, localCenter = new THREE.Vector3()): { radius: number; halfHeight: number; localCenter: THREE.Vector3 } {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  tBox.copy(geometry.boundingBox!);
  tBox.getCenter(localCenter);
  tBox.applyMatrix4(matrix);
  tBox.getSize(tV);
  return { radius: Math.max(tV.x, tV.z) / 2, halfHeight: tV.y / 2, localCenter };
}

/** Small enough to lift and big enough to be worth it. */
export function liftableSize(radius: number, halfHeight: number): boolean {
  return radius <= LIFT_MAX_RADIUS && halfHeight * 2 <= LIFT_MAX_HEIGHT && Math.max(radius, halfHeight) >= LIFT_MIN_RADIUS;
}

export class LiftableRocks {
  private readonly rocks: WorldRock[] = [];
  private nextId = 1;

  constructor(private readonly collision: CollisionWorld) {}

  get count(): number {
    return this.rocks.length;
  }

  /**
   * Register a rock (world `matrix`; its visual is `mesh` or instance `index` of `inst`) and
   * its collider (world coordinates, added here). Null when it is not a liftable size.
   */
  add(o: { owner: object; geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4; mesh?: THREE.Mesh; inst?: THREE.InstancedMesh; index?: number; collider?: ColliderDef }): WorldRock | null {
    const ext = rockExtents(o.geometry, o.matrix);
    if (!liftableSize(ext.radius, ext.halfHeight)) return null;
    const center = ext.localCenter.clone().applyMatrix4(o.matrix);
    const c = o.collider;
    const rock: WorldRock = {
      id: this.nextId++,
      owner: o.owner,
      geometry: o.geometry,
      material: o.material,
      matrix: o.matrix.clone(),
      localCenter: ext.localCenter.clone(),
      center,
      radius: ext.radius,
      halfHeight: ext.halfHeight,
      lifted: false,
      mesh: o.mesh ?? null,
      inst: o.inst ?? null,
      index: o.index ?? 0,
      colliderId: c ? this.collision.add(c) : 0,
      collider: c ? { ...c, dx: c.x - center.x, dy: c.y - center.y, dz: c.z - center.z } : null,
    };
    this.rocks.push(rock);
    return rock;
  }

  /**
   * Nearest free, visible rock hit by the ray within maxDist: bounding sphere plus aim assist
   * (`slack` metres, and `cone` metres per metre of distance).
   */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, slack: number, cone: number): { rock: WorldRock; distance: number } | null {
    let best: { rock: WorldRock; distance: number } | null = null;
    for (const r of this.rocks) {
      if (r.lifted) continue;
      const ox = r.center.x - origin.x, oy = r.center.y - origin.y, oz = r.center.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      const rad = Math.max(r.radius, r.halfHeight) * 0.95 + slack + cone * Math.max(0, t);
      if (t < 0 || t - rad > maxDist) continue;
      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      if (d2 > rad * rad) continue;
      const hitT = Math.max(0, t - Math.sqrt(Math.max(0, rad * rad - d2)));
      if (best && hitT >= best.distance) continue;
      if (!this.shown(r)) continue;
      best = { rock: r, distance: hitT };
    }
    return best;
  }

  /** Nearest free, visible rock within `radius` metres of (x, z) on the ground plane that `accept` agrees to. */
  nearest(x: number, z: number, radius: number, accept?: (r: WorldRock) => boolean): WorldRock | null {
    let best: WorldRock | null = null;
    let bestD = radius;
    for (const r of this.rocks) {
      if (r.lifted) continue;
      const d = Math.hypot(r.center.x - x, r.center.z - z);
      if (d > bestD || !this.shown(r) || (accept && !accept(r))) continue;
      best = r;
      bestD = d;
    }
    return best;
  }

  /** Lifted: its visual is hidden and its collider removed until it is put down. */
  take(rock: WorldRock): boolean {
    if (rock.lifted || !this.rocks.includes(rock)) return false;
    rock.lifted = true;
    if (rock.mesh) rock.mesh.visible = false;
    if (rock.inst) {
      rock.inst.setMatrixAt(rock.index, ZERO);
      rock.inst.instanceMatrix.needsUpdate = true;
    }
    if (rock.colliderId) this.collision.remove(rock.colliderId);
    rock.colliderId = 0;
    return true;
  }

  /** Put down at `matrix` (rock-local → world), or back where it was. False if it was removed meanwhile. */
  put(rock: WorldRock, matrix?: THREE.Matrix4): boolean {
    if (!this.rocks.includes(rock)) return false;
    if (matrix) {
      rock.matrix.copy(matrix);
      rock.center.copy(rock.localCenter).applyMatrix4(matrix);
      const ext = rockExtents(rock.geometry, matrix);
      rock.radius = ext.radius;
      rock.halfHeight = ext.halfHeight;
    }
    const parent = rock.mesh?.parent ?? rock.inst?.parent ?? null;
    // The visual lives in its region's group: world → that group's space.
    const local = parent ? tM.copy(parent.matrixWorld).invert().multiply(rock.matrix) : tM.copy(rock.matrix);
    if (rock.mesh) {
      rock.mesh.matrix.copy(local);
      rock.mesh.matrixWorldNeedsUpdate = true;
      rock.mesh.visible = true;
    }
    if (rock.inst) {
      rock.inst.setMatrixAt(rock.index, local);
      rock.inst.instanceMatrix.needsUpdate = true;
      rock.inst.computeBoundingSphere();
    }
    const c = rock.collider;
    if (c && !rock.colliderId) {
      const { dx, dy, dz, ...def } = c;
      rock.colliderId = this.collision.add({ ...def, x: rock.center.x + dx, y: rock.center.y + dy, z: rock.center.z + dz });
    }
    rock.lifted = false;
    return true;
  }

  /** Forget everything an owner registered (its region is being disposed) and remove their colliders. */
  removeOwner(owner: object): void {
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      if (r.owner !== owner) continue;
      if (r.colliderId) this.collision.remove(r.colliderId);
      this.rocks.splice(i, 1);
    }
  }

  /** Rocks near a point, for tests and debugging. */
  near(x: number, z: number, radius: number): Array<{ id: number; pos: number[]; radius: number; height: number; lifted: boolean; instanced: boolean; collider: boolean }> {
    return this.rocks
      .filter((r) => Math.hypot(r.center.x - x, r.center.z - z) <= radius)
      .map((r) => ({ id: r.id, pos: [+r.center.x.toFixed(2), +r.center.y.toFixed(2), +r.center.z.toFixed(2)], radius: +r.radius.toFixed(2), height: +(r.halfHeight * 2).toFixed(2), lifted: r.lifted, instanced: !!r.inst, collider: r.colliderId !== 0 }));
  }

  /** In the scene and not hidden (regions hide far detail layers). */
  private shown(r: WorldRock): boolean {
    let o: THREE.Object3D | null = r.mesh ?? r.inst;
    if (!o) return false;
    while (o) {
      if (!o.visible) return false;
      if ((o as THREE.Scene).isScene) return true;
      o = o.parent;
    }
    return false;
  }
}
