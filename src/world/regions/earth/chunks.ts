import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { ContentBuilder } from '../../kit/Builder';
import type { HouseArchetype } from './archetypes';

/**
 * Spatial chunking + distance LOD for large settlements.
 *
 * Every chunk owns a ContentBuilder (kit geometry merged per material) and a
 * list of house stamps that are merged into ONE mesh with the house atlas
 * material at finish(). Chunks are small enough for frustum culling to work
 * and are shown/hidden by distance according to their kind:
 *
 *   major  — walls, gatehouses, palace, viaducts: always drawn (also in 'far')
 *   houses — merged house batches: drawn within ~drawDistance
 *   props  — stalls, lanterns, trees, statues: drawn within ~150 m
 *   detail — laundry, crates, pots, small clutter: drawn within ~80 m
 *
 * Colliders never depend on LOD or quality settings.
 */

export type ChunkKind = 'major' | 'houses' | 'props' | 'detail';

interface HouseStamp {
  arch: HouseArchetype;
  m: THREE.Matrix4;
  color: THREE.Color;
  /** [additive: Ba Sing Se] Colour for roof vertices (archetypes with a roofMask). */
  roof?: THREE.Color;
}

/**
 * A tree mesh split by distance: trees within range draw the `near` model, the rest the lighter
 * `far` build (a tree geometry carries it as userData.far). Region trees have hundreds of copies
 * in view in Ba Sing Se, so only the close ones get the full model.
 */
interface TreeLod {
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  /** Every instance's matrix (16 floats each) and position, as built. */
  mats: Float32Array;
  xs: Float32Array;
  zs: Float32Array;
}

export class Chunk {
  readonly group = new THREE.Group();
  readonly builder: ContentBuilder;
  readonly stamps: HouseStamp[] = [];
  /** Geometries / materials created outside the builder (disposed with the chunk). */
  readonly ownedGeos: THREE.BufferGeometry[] = [];
  readonly ownedMats: THREE.Material[] = [];
  readonly trees: TreeLod[] = [];
  /** Camera position (chunk-local) at the last near/far tree split. */
  treeX = NaN;
  treeZ = NaN;
  cx = 0;
  cz = 0;
  r = 0;
  finished = false;
  constructor(ctx: GameContext, readonly key: string, readonly kind: ChunkKind, tag: string) {
    this.builder = new ContentBuilder(ctx, this.group, tag);
    this.group.name = key;
  }

  /** Add a custom mesh; its geometry (and optionally material) are disposed with the chunk. */
  add(obj: THREE.Mesh | THREE.InstancedMesh, ownMaterial = false): void {
    this.group.add(obj);
    this.ownedGeos.push(obj.geometry);
    if (ownMaterial) this.ownedMats.push(obj.material as THREE.Material);
  }
}

export interface LodRanges {
  houses: number;
  props: number;
  detail: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class ChunkSet {
  private readonly map = new Map<string, Chunk>();
  houseCount = 0;
  private level: 'full' | 'far' | 'hidden' = 'full';

  constructor(
    private readonly ctx: GameContext,
    readonly root: THREE.Group,
    readonly tag: string,
    readonly cell = 128,
  ) {}

  get chunks(): IterableIterator<Chunk> {
    return this.map.values();
  }

  named(kind: ChunkKind, key: string): Chunk {
    const k = `${kind}:${key}`;
    let c = this.map.get(k);
    if (!c) {
      c = new Chunk(this.ctx, k, kind, this.tag);
      this.map.set(k, c);
      this.root.add(c.group);
    }
    return c;
  }

  at(kind: ChunkKind, x: number, z: number, cell = kind === 'props' ? this.cell * 2 : kind === 'houses' ? this.cell * 1.5 : this.cell): Chunk {
    return this.named(kind, `${Math.floor(x / cell)}:${Math.floor(z / cell)}`);
  }

  /**
   * Stamp a house archetype. `y` is the ground under its centre. Registers a
   * solid, walkable-roof collider (independent of LOD/quality).
   */
  addHouse(arch: HouseArchetype, x: number, y: number, z: number, yaw: number, opts: { scale?: number; tint?: THREE.Color; roofTint?: THREE.Color; collide?: boolean } = {}): void {
    const s = opts.scale ?? 1;
    tmpQ.setFromAxisAngle(UP, yaw);
    tmpS.set(s, s, s);
    tmpP.set(x, y, z);
    const m = new THREE.Matrix4().compose(tmpP, tmpQ, tmpS);
    const c = this.at('houses', x, z);
    c.stamps.push({ arch, m, color: opts.tint ?? new THREE.Color(1, 1, 1), roof: opts.roofTint });
    this.houseCount++;
    if (opts.collide !== false) {
      c.builder.collider({
        shape: 'box',
        x,
        y: y + (arch.colH * s) / 2,
        z,
        hx: arch.colHX * s,
        hz: arch.colHZ * s,
        hy: (arch.colH * s) / 2,
        yaw,
        walkable: true,
        solid: true,
        surface: 'stone',
      });
    }
  }

  /** Merge kit batches and house stamps; compute chunk bounds. */
  finish(houseMaterial: THREE.Material): void {
    const it = this.finishSteps(houseMaterial);
    while (!it.next().done);
  }

  /** finish() as a generator yielding after each chunk (time-sliced construction). */
  *finishSteps(houseMaterial: THREE.Material): Generator<unknown, void, unknown> {
    for (const c of [...this.map.values()]) {
      if (c.finished) continue;
      c.finished = true;
      c.builder.finish();
      addFarTrees(c);
      if (c.stamps.length) {
        const geo = mergeStamps(c.stamps);
        const mesh = new THREE.Mesh(geo, houseMaterial);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.name = `${c.key}:houses`;
        c.add(mesh);
        c.stamps.length = 0;
      }
      const box = new THREE.Box3();
      c.group.updateMatrixWorld(true);
      box.setFromObject(c.group);
      if (box.isEmpty()) {
        c.cx = c.cz = c.r = 0;
      } else {
        c.cx = (box.min.x + box.max.x) / 2;
        c.cz = (box.min.z + box.max.z) / 2;
        c.r = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
      }
      if (c.kind !== 'major') c.group.visible = false;
      yield;
    }
  }

  setLevel(level: 'full' | 'far' | 'hidden'): void {
    this.level = level;
    this.root.visible = level !== 'hidden';
  }

  /** Distance-based visibility (and near/far trees within r.detail); call a few times per second. */
  updateLod(cam: THREE.Vector3, r: LodRanges): void {
    const far = this.level !== 'full';
    for (const c of this.map.values()) {
      if (c.kind === 'major') {
        c.group.visible = true;
      } else if (far) {
        c.group.visible = false;
      } else {
        const d = Math.max(0, Math.hypot(cam.x - c.cx, cam.z - c.cz) - c.r);
        const range = c.kind === 'houses' ? r.houses : c.kind === 'props' ? r.props : r.detail;
        c.group.visible = d < range;
      }
      if (c.group.visible && c.trees.length) splitTrees(c, cam, r.detail);
    }
  }

  stats(): { chunks: number; meshes: number; colliders: number; houses: number; visible: number } {
    let meshes = 0, colliders = 0, visible = 0;
    for (const c of this.map.values()) {
      meshes += c.group.children.length;
      colliders += c.builder.colliderIds.length;
      if (c.group.visible) visible++;
    }
    return { chunks: this.map.size, meshes, colliders, houses: this.houseCount, visible };
  }

  dispose(): void {
    for (const c of this.map.values()) {
      // Far tree geometries go with their near ones (the builder's); the far meshes' buffers here.
      for (const t of c.trees) t.far.dispose();
      c.trees.length = 0;
      c.builder.dispose();
      for (const g of c.ownedGeos) g.dispose();
      for (const m of c.ownedMats) m.dispose();
      c.group.clear();
      this.root.remove(c.group);
    }
    this.map.clear();
  }
}

/** Give each tree mesh whose geometry carries a far build (userData.far) a far copy, empty until split. */
function addFarTrees(c: Chunk): void {
  for (const o of [...c.group.children]) {
    if (!(o instanceof THREE.InstancedMesh)) continue;
    const farGeo = o.geometry.userData.far as THREE.BufferGeometry | undefined;
    if (!farGeo) continue;
    const n = o.count;
    const mats = new Float32Array(o.instanceMatrix.array);
    const xs = new Float32Array(n), zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = mats[i * 16 + 12];
      zs[i] = mats[i * 16 + 14];
    }
    const far = new THREE.InstancedMesh(farGeo, o.material, n);
    far.name = `${o.name}:far`;
    far.castShadow = o.castShadow;
    far.receiveShadow = o.receiveShadow;
    far.count = 0;
    far.visible = false;
    o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    c.group.add(far);
    c.trees.push({ near: o, far, mats, xs, zs });
  }
}

const tmpCam = new THREE.Vector3();

/** Split a chunk's trees between their near and far copies by distance from the camera (after moves of 4 m+). */
function splitTrees(c: Chunk, cam: THREE.Vector3, range: number): void {
  c.group.worldToLocal(tmpCam.copy(cam));
  const mx = tmpCam.x - c.treeX, mz = tmpCam.z - c.treeZ;
  if (mx * mx + mz * mz < 16) return;
  c.treeX = tmpCam.x;
  c.treeZ = tmpCam.z;
  const r2 = range * range;
  for (const t of c.trees) {
    const near = t.near.instanceMatrix.array as Float32Array, far = t.far.instanceMatrix.array as Float32Array;
    let a = 0, b = 0;
    for (let i = 0; i < t.xs.length; i++) {
      const dx = t.xs[i] - tmpCam.x, dz = t.zs[i] - tmpCam.z;
      const m = t.mats.subarray(i * 16, i * 16 + 16);
      if (dx * dx + dz * dz < r2) near.set(m, 16 * a++);
      else far.set(m, 16 * b++);
    }
    t.near.count = a;
    t.far.count = b;
    // An empty copy would still cost a draw call.
    t.near.visible = a > 0;
    t.far.visible = b > 0;
    t.near.instanceMatrix.needsUpdate = true;
    t.far.instanceMatrix.needsUpdate = true;
    // Bounds follow the new counts (recomputed on the next frustum test).
    t.near.boundingSphere = null;
    t.far.boundingSphere = null;
  }
}

/** Merge house stamps into one geometry with per-vertex tint colours. */
function mergeStamps(stamps: HouseStamp[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const s of stamps) {
    nv += s.arch.geo.pos.length / 3;
    ni += s.arch.geo.idx.length;
  }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const s of stamps) {
    const g = s.arch.geo;
    nm.getNormalMatrix(s.m);
    const e = s.m.elements;
    const n = g.pos.length / 3;
    const mask = s.roof ? s.arch.roofMask : undefined;
    for (let i = 0; i < n; i++) {
      const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
      const o = (vo + i) * 3;
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      v.set(g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2]).applyMatrix3(nm).normalize();
      nrm[o] = v.x;
      nrm[o + 1] = v.y;
      nrm[o + 2] = v.z;
      const cc = mask && mask[i] ? s.roof! : s.color;
      col[o] = cc.r;
      col[o + 1] = cc.g;
      col[o + 2] = cc.b;
      uv[(vo + i) * 2] = g.uv[i * 2];
      uv[(vo + i) * 2 + 1] = g.uv[i * 2 + 1];
    }
    for (let k = 0; k < g.idx.length; k++) idx[io + k] = g.idx[k] + vo;
    vo += n;
    io += g.idx.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  void tmpM;
  return geo;
}
