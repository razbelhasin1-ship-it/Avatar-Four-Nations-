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
}

export class Chunk {
  readonly group = new THREE.Group();
  readonly builder: ContentBuilder;
  readonly stamps: HouseStamp[] = [];
  /** Geometries / materials created outside the builder (disposed with the chunk). */
  readonly ownedGeos: THREE.BufferGeometry[] = [];
  readonly ownedMats: THREE.Material[] = [];
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
  addHouse(arch: HouseArchetype, x: number, y: number, z: number, yaw: number, opts: { scale?: number; tint?: THREE.Color; collide?: boolean } = {}): void {
    const s = opts.scale ?? 1;
    tmpQ.setFromAxisAngle(UP, yaw);
    tmpS.set(s, s, s);
    tmpP.set(x, y, z);
    const m = new THREE.Matrix4().compose(tmpP, tmpQ, tmpS);
    const c = this.at('houses', x, z);
    c.stamps.push({ arch, m, color: opts.tint ?? new THREE.Color(1, 1, 1) });
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

  /** Distance-based visibility; call a few times per second. */
  updateLod(cam: THREE.Vector3, r: LodRanges): void {
    const far = this.level !== 'full';
    for (const c of this.map.values()) {
      if (c.kind === 'major') {
        c.group.visible = true;
        continue;
      }
      if (far) {
        c.group.visible = false;
        continue;
      }
      const d = Math.max(0, Math.hypot(cam.x - c.cx, cam.z - c.cz) - c.r);
      const range = c.kind === 'houses' ? r.houses : c.kind === 'props' ? r.props : r.detail;
      c.group.visible = d < range;
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
      c.builder.dispose();
      for (const g of c.ownedGeos) g.dispose();
      for (const m of c.ownedMats) m.dispose();
      c.group.clear();
      this.root.remove(c.group);
    }
    this.map.clear();
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
      col[o] = s.color.r;
      col[o + 1] = s.color.g;
      col[o + 2] = s.color.b;
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
