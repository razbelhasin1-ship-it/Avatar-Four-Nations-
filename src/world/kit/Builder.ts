import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameContext } from '../../core/GameContext';
import type { SurfaceType } from '../../core/types';
import type { ColliderDef } from '../Collision';
import { kitMaterial, type KitMaterialName } from './Materials';

/**
 * ContentBuilder — assemble static architecture efficiently.
 *
 *   const b = new ContentBuilder(ctx, region.group, 'ba_sing_se');
 *   b.box('stone_tan', { x, y, z, sx: 10, sy: 4, sz: 2, yaw }, { collide: true });
 *   b.stairs({ from, to, width: 4, material: 'stone_light' });
 *   b.finish();   // merges geometry per material into a few meshes
 *
 * Geometry added with box()/mesh() is merged per material at finish() (one draw
 * call per material per builder). Repeated props use instance() (InstancedMesh).
 * Colliders are registered immediately (tagged so the region can remove them).
 *
 * Transform convention: (x, y, z) is the CENTER of boxes unless noted; `yaw`
 * rotates about +Y with three.js convention (local +X → (cos yaw, 0, -sin yaw)),
 * identical to Collision.ts box yaw.
 */

export interface Xform {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  /** Optional extra rotations (radians). */
  pitch?: number;
  roll?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

export interface CollideOpts {
  collide?: boolean;
  /** Top surface walkable (floors, platforms, stairs). Default true for collide boxes. */
  walkable?: boolean;
  surface?: SurfaceType;
  /** Blocks movement horizontally. Default true. */
  solid?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

type MatKey = KitMaterialName | THREE.Material;

interface Batch {
  material: THREE.Material;
  geos: THREE.BufferGeometry[];
  castShadow: boolean;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export function matrixFor(t: Xform, out = new THREE.Matrix4()): THREE.Matrix4 {
  tmpE.set(t.pitch ?? 0, t.yaw ?? 0, t.roll ?? 0, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpS.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  tmpP.set(t.x, t.y, t.z);
  return out.compose(tmpP, tmpQ, tmpS);
}

/** Normalise geometry attributes so everything merges (position, normal, uv; indexed). */
function normalise(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = g;
  if (!geo.index) {
    const n = geo.getAttribute('position').count;
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(idx);
  }
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (!geo.getAttribute('uv')) {
    const n = geo.getAttribute('position').count;
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }
  geo.morphAttributes = {};
  return geo;
}

/** Scale a BoxGeometry's UVs per face so textures keep their world size (tile = metres per repeat). */
export function boxUVs(g: THREE.BoxGeometry, sx: number, sy: number, sz: number, tile = 2): THREE.BoxGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each with 1 segment)
  const dims: Array<[number, number]> = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  uv.needsUpdate = true;
  return g;
}

export class ContentBuilder {
  private batches = new Map<THREE.Material, Batch>();
  private instances = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; matrices: THREE.Matrix4[]; castShadow: boolean }>();
  readonly colliderIds: number[] = [];
  readonly meshes: THREE.Object3D[] = [];
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];

  constructor(
    readonly ctx: GameContext,
    readonly group: THREE.Group,
    /** Collider tag (usually the region id) so everything can be removed together. */
    readonly tag: string,
  ) {}

  private mat(m: MatKey): THREE.Material {
    return typeof m === 'string' ? kitMaterial(m) : m;
  }

  /** Add arbitrary geometry (cloned & transformed) to the merge batch of a material. */
  mesh(material: MatKey, geometry: THREE.BufferGeometry, t: Xform, opts: { castShadow?: boolean } = {}): void {
    const mat = this.mat(material);
    const g = normalise(geometry.clone());
    g.applyMatrix4(matrixFor(t, tmpM));
    let b = this.batches.get(mat);
    if (!b) {
      b = { material: mat, geos: [], castShadow: opts.castShadow ?? true };
      this.batches.set(mat, b);
    }
    b.geos.push(g);
  }

  /** Register a collider in the world. Returns its id. */
  collider(def: ColliderDef): number {
    const id = this.ctx.world.collision.add({ ...def, tag: def.tag ?? this.tag });
    this.colliderIds.push(id);
    return id;
  }

  /** Axis-aligned (yawed) box: center x,y,z; size sx,sy,sz. */
  box(material: MatKey, t: Xform & { sx: number; sy: number; sz: number }, c: CollideOpts = {}): void {
    const g = new THREE.BoxGeometry(1, 1, 1);
    boxUVs(g, t.sx, t.sy, t.sz);
    this.mesh(material, g, t, { castShadow: c.castShadow });
    g.dispose();
    if (c.collide) {
      this.collider({ shape: 'box', x: t.x, y: t.y, z: t.z, hx: t.sx / 2, hy: t.sy / 2, hz: t.sz / 2, yaw: t.yaw ?? 0, walkable: c.walkable ?? true, solid: c.solid ?? true, surface: c.surface ?? 'stone' });
    }
  }

  /** Box whose BOTTOM sits at y (convenient for buildings on the ground). */
  block(material: MatKey, t: Xform & { sx: number; sy: number; sz: number }, c: CollideOpts = {}): void {
    this.box(material, { ...t, y: t.y + t.sy / 2 }, c);
  }

  /** Vertical cylinder; (x,y,z) is the BOTTOM centre. */
  cylinder(material: MatKey, t: { x: number; y: number; z: number; r: number; h: number; rTop?: number; segments?: number }, c: CollideOpts = {}): void {
    const g = new THREE.CylinderGeometry(t.rTop ?? t.r, t.r, t.h, t.segments ?? 14);
    this.mesh(material, g, { x: t.x, y: t.y + t.h / 2, z: t.z });
    g.dispose();
    if (c.collide) this.collider({ shape: 'cylinder', x: t.x, y: t.y + t.h / 2, z: t.z, r: Math.max(t.r, t.rTop ?? t.r), hy: t.h / 2, walkable: c.walkable ?? true, solid: c.solid ?? true, surface: c.surface ?? 'stone' });
  }

  /**
   * Straight stairs from `from` (bottom of first step) to `to` (top landing),
   * with a walkable ramp collider so characters walk up smoothly.
   */
  stairs(o: { from: THREE.Vector3; to: THREE.Vector3; width: number; material: MatKey; stepHeight?: number; sideMaterial?: MatKey; surface?: SurfaceType }): void {
    const dx = o.to.x - o.from.x, dz = o.to.z - o.from.z;
    const run = Math.hypot(dx, dz);
    const rise = o.to.y - o.from.y;
    if (run < 0.1 || rise <= 0) return;
    const yaw = Math.atan2(-dz, dx); // local +X points from bottom to top
    const steps = Math.max(1, Math.round(rise / (o.stepHeight ?? 0.25)));
    const sh = rise / steps;
    const sd = run / steps;
    const cx = Math.cos(yaw), sz = -Math.sin(yaw);
    for (let i = 0; i < steps; i++) {
      const along = (i + 0.5) * sd;
      const h = (i + 1) * sh;
      this.box(o.material, { x: o.from.x + cx * along, y: o.from.y + h / 2, z: o.from.z + sz * along, sx: sd + 0.02, sy: h, sz: o.width, yaw });
    }
    // Ramp collider covering the whole flight.
    this.collider({
      shape: 'box',
      x: (o.from.x + o.to.x) / 2,
      y: o.from.y + rise / 2,
      z: (o.from.z + o.to.z) / 2,
      hx: run / 2,
      hy: rise / 2,
      hz: o.width / 2,
      yaw,
      slopeRise: rise,
      walkable: true,
      solid: true,
      surface: o.surface ?? 'stone',
    });
  }

  /**
   * Wall along a polyline. Each segment is a box collider. Options: crenellations
   * (merlons on top), a walkway on top (walkable), base plinth.
   */
  wall(points: THREE.Vector2[] | Array<{ x: number; z: number }>, o: { baseY: number | ((x: number, z: number) => number); height: number; thickness: number; material: MatKey; crenel?: MatKey | null; plinth?: MatKey | null; walkable?: boolean; closed?: boolean }): void {
    const pts = points.map((p: any) => ({ x: p.x, z: p.z ?? p.y }));
    const n = o.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
      const by = typeof o.baseY === 'function' ? Math.min(o.baseY(a.x, a.z), o.baseY(b.x, b.z), o.baseY(mx, mz)) - 0.5 : o.baseY;
      const h = o.height + (typeof o.baseY === 'function' ? 0.5 : 0);
      this.box(o.material, { x: mx, y: by + h / 2, z: mz, sx: len + o.thickness * 0.5, sy: h, sz: o.thickness, yaw }, { collide: true, walkable: o.walkable ?? true });
      if (o.plinth) this.box(o.plinth, { x: mx, y: by + 0.4, z: mz, sx: len + o.thickness, sy: 0.8, sz: o.thickness * 1.25, yaw });
      if (o.crenel) {
        const count = Math.floor(len / 2.2);
        const cxv = Math.cos(yaw), czv = -Math.sin(yaw);
        for (let k = 0; k < count; k++) {
          const along = -len / 2 + (k + 0.5) * (len / count);
          for (const side of [-1, 1]) {
            const ox = -czv * side * (o.thickness / 2 - 0.25), oz = cxv * side * (o.thickness / 2 - 0.25);
            this.box(o.crenel, { x: mx + cxv * along + ox, y: by + h + 0.45, z: mz + czv * along + oz, sx: 1.1, sy: 0.9, sz: 0.5, yaw });
          }
        }
      }
    }
  }

  /**
   * Curved-eave East-Asian roof over a rectangular footprint.
   * (x,y,z): centre at the EAVE height. w along local X, d along local Z.
   * style: 'hip' (four slopes), 'gable' (two slopes along X), 'pagoda' (strong upturned corners).
   */
  roof(material: MatKey, o: { x: number; y: number; z: number; w: number; d: number; height: number; yaw?: number; overhang?: number; curve?: number; style?: 'hip' | 'gable' | 'pagoda'; ridge?: MatKey | null }): void {
    const g = roofGeometry(o.w + (o.overhang ?? 0.8) * 2, o.d + (o.overhang ?? 0.8) * 2, o.height, o.style ?? 'hip', o.curve ?? (o.style === 'pagoda' ? 0.9 : 0.45));
    this.mesh(material, g, { x: o.x, y: o.y, z: o.z, yaw: o.yaw ?? 0 });
    g.dispose();
    if (o.ridge !== null) {
      const ridgeLen = o.style === 'gable' ? o.w + (o.overhang ?? 0.8) * 2 : Math.max(0.5, (o.w - o.d) + 1);
      this.box(o.ridge ?? 'roof_dark', { x: o.x, y: o.y + o.height + 0.12, z: o.z, sx: Math.max(0.6, ridgeLen), sy: 0.3, sz: 0.35, yaw: o.yaw ?? 0 });
    }
  }

  /** A simple building: walls + optional floors + roof + door, with a solid collider. Base at ground y. */
  building(o: { x: number; y: number; z: number; w: number; d: number; h: number; yaw?: number; wall: MatKey; roof: MatKey; trim?: MatKey; roofStyle?: 'hip' | 'gable' | 'pagoda'; roofHeight?: number; floors?: number; door?: boolean; windows?: boolean; plinth?: MatKey | null }): void {
    const yaw = o.yaw ?? 0;
    if (o.plinth !== null) this.block(o.plinth ?? 'stone_grey', { x: o.x, y: o.y - 0.3, z: o.z, sx: o.w + 0.6, sy: 0.6, sz: o.d + 0.6, yaw }, { collide: true, surface: 'stone' });
    this.block(o.wall, { x: o.x, y: o.y, z: o.z, sx: o.w, sy: o.h, sz: o.d, yaw });
    // Solid collider reaching halfway up the roof so agile benders can land on rooftops.
    const roofH = o.roofHeight ?? Math.min(o.w, o.d) * 0.45;
    this.collider({ shape: 'box', x: o.x, y: o.y + (o.h + roofH * 0.5) / 2, z: o.z, hx: o.w / 2 + 0.2, hy: (o.h + roofH * 0.5) / 2, hz: o.d / 2 + 0.2, yaw, walkable: true, solid: true, surface: 'stone' });
    const floors = o.floors ?? 1;
    const trim = o.trim ?? 'wood_dark';
    const cx = Math.cos(yaw), sz = -Math.sin(yaw);
    const fx = Math.sin(yaw), fz = Math.cos(yaw); // local +Z (front)
    for (let f = 1; f < floors; f++) {
      const fy = o.y + (o.h / floors) * f;
      this.box(trim, { x: o.x, y: fy, z: o.z, sx: o.w + 0.2, sy: 0.25, sz: o.d + 0.2, yaw });
      // intermediate eave skirt
      this.roof(o.roof, { x: o.x, y: fy + 0.1, z: o.z, w: o.w, d: o.d, height: 0.6, yaw, overhang: 0.7, style: 'hip', ridge: null });
    }
    // corner posts
    for (const sx of [-1, 1]) for (const sd of [-1, 1]) {
      const px = o.x + cx * sx * (o.w / 2) + fx * sd * (o.d / 2);
      const pz = o.z + sz * sx * (o.w / 2) + fz * sd * (o.d / 2);
      this.box(trim, { x: px, y: o.y + o.h / 2, z: pz, sx: 0.3, sy: o.h, sz: 0.3, yaw });
    }
    if (o.door !== false) {
      const dx = o.x + fx * (o.d / 2 + 0.02), dz = o.z + fz * (o.d / 2 + 0.02);
      this.box('wood_dark', { x: dx, y: o.y + 1.1, z: dz, sx: 1.3, sy: 2.2, sz: 0.1, yaw });
    }
    if (o.windows !== false) {
      for (let f = 0; f < floors; f++) {
        const wy = o.y + (o.h / floors) * f + Math.min(2.2, (o.h / floors) * 0.6);
        for (const side of [-1, 1]) {
          const ox = cx * side * (o.w * 0.28), oz = sz * side * (o.w * 0.28);
          this.box('lantern_warm', { x: o.x + ox + fx * (o.d / 2 + 0.03), y: wy, z: o.z + oz + fz * (o.d / 2 + 0.03), sx: 0.8, sy: 0.7, sz: 0.05, yaw }, { castShadow: false });
        }
      }
    }
    this.roof(o.roof, { x: o.x, y: o.y + o.h, z: o.z, w: o.w, d: o.d, height: o.roofHeight ?? Math.min(o.w, o.d) * 0.45, yaw, style: o.roofStyle ?? 'hip' });
  }

  /** Walkable bridge (deck + railings + supports) from a to b. y values are deck heights. */
  bridge(o: { a: THREE.Vector3; b: THREE.Vector3; width: number; deck: MatKey; rail?: MatKey | null; support?: MatKey | null; arch?: number; supportBottom?: number; surface?: SurfaceType }): void {
    const len = Math.hypot(o.b.x - o.a.x, o.b.z - o.a.z);
    const yaw = Math.atan2(-(o.b.z - o.a.z), o.b.x - o.a.x);
    const segs = Math.max(1, Math.ceil(len / ((o.arch ?? 0) > 0.05 ? 1.2 : 4)));
    const cx = Math.cos(yaw), sz = -Math.sin(yaw);
    const nx = -sz, nz = cx; // perpendicular (local +Z)
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs, tm = (t0 + t1) / 2;
      const archY = (t: number) => (o.arch ?? 0) * 4 * t * (1 - t);
      const y0 = o.a.y + (o.b.y - o.a.y) * t0 + archY(t0);
      const y1 = o.a.y + (o.b.y - o.a.y) * t1 + archY(t1);
      const ym = (y0 + y1) / 2;
      const px = o.a.x + (o.b.x - o.a.x) * tm, pz = o.a.z + (o.b.z - o.a.z) * tm;
      const segLen = len / segs;
      const pitch = Math.atan2(y1 - y0, segLen);
      // Slope length plus a small overlap so consecutive segments join without gaps.
      const deckLen = Math.hypot(segLen, y1 - y0) + 0.12;
      this.mesh(o.deck, boxUVs(new THREE.BoxGeometry(1, 1, 1), deckLen, 0.4, o.width), { x: px, y: ym - 0.2, z: pz, yaw, roll: pitch, sx: deckLen, sy: 0.4, sz: o.width });
      {
        // Walkable deck collider: a ramp rising along local +X toward the higher end.
        const rise = Math.abs(y1 - y0);
        const hi = Math.max(y0, y1);
        const hy = rise / 2 + 0.2;
        this.collider({
          shape: 'box',
          x: px,
          y: hi - hy,
          z: pz,
          hx: segLen / 2 + 0.05,
          hy,
          hz: o.width / 2,
          yaw: y1 >= y0 ? yaw : yaw + Math.PI,
          slopeRise: rise > 0.01 ? rise : 0,
          walkable: true,
          solid: true,
          surface: o.surface ?? 'wood',
        });
      }
      if (o.rail !== null) {
        for (const side of [-1, 1]) {
          const rx = px + nx * side * (o.width / 2 - 0.1), rz = pz + nz * side * (o.width / 2 - 0.1);
          this.box(o.rail ?? o.deck, { x: rx, y: ym + 0.55, z: rz, sx: deckLen, sy: 0.12, sz: 0.12, yaw, roll: pitch });
          if (i % 2 === 0 || segs < 4) this.box(o.rail ?? o.deck, { x: rx, y: ym + 0.25, z: rz, sx: 0.14, sy: 0.7, sz: 0.14, yaw });
          this.collider({ shape: 'box', x: rx, y: ym + 0.5, z: rz, hx: segLen / 2, hy: 0.6, hz: 0.12, yaw, walkable: false, solid: true });
        }
      }
      if (o.support !== null && o.supportBottom !== undefined && i % 2 === 0 && i > 0) {
        const h = ym - 0.4 - o.supportBottom;
        if (h > 0.5) this.box(o.support ?? 'stone_grey', { x: px, y: o.supportBottom + h / 2, z: pz, sx: 1.2, sy: h, sz: o.width * 0.9, yaw }, { collide: true, walkable: false });
      }
    }
  }

  /** Hanging/standing lantern (instanced). Optionally adds a real point light when dynamic lights are on. */
  lantern(pos: THREE.Vector3, o: { color?: 'red' | 'warm' | 'blue'; hanging?: boolean; post?: boolean } = {}): void {
    const key = `lantern_${o.color ?? 'red'}`;
    const m = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
    this.instance(key, () => new THREE.CylinderGeometry(0.22, 0.26, 0.55, 10), (o.color ?? 'red') === 'red' ? 'lantern_red' : o.color === 'blue' ? 'lantern_blue' : 'lantern_warm', m, false);
    if (o.post) {
      // Post from the ground (pos.y - 2.6) up to just under the lantern.
      this.box('wood_dark', { x: pos.x, y: pos.y - 1.6, z: pos.z, sx: 0.14, sy: 2.6, sz: 0.14 });
    }
  }

  /**
   * Instanced prop: geometryFactory is called once per key. Many instances
   * share one draw call. Use for houses, crates, lanterns, statues, posts.
   */
  instance(key: string, geometryFactory: () => THREE.BufferGeometry, material: MatKey, matrix: THREE.Matrix4, castShadow = true): void {
    let inst = this.instances.get(key);
    if (!inst) {
      const geo = geometryFactory();
      this.ownedGeometries.push(geo);
      inst = { geo, mat: this.mat(material), matrices: [], castShadow };
      this.instances.set(key, inst);
    }
    inst.matrices.push(matrix.clone());
  }

  /** Flat water surface (pond, canal, fountain basin) that also registers a water source. */
  waterSurface(o: { id: string; label: string; x: number; z: number; y: number; w: number; d: number; yaw?: number; circle?: boolean; capacity?: number; regen?: number; type?: 'pond' | 'canal' | 'fountain' | 'puddle' | 'lake'; material?: THREE.Material }): THREE.Mesh {
    const geo = o.circle ? new THREE.CircleGeometry(o.w / 2, 40) : new THREE.PlaneGeometry(o.w, o.d, 8, 8);
    geo.rotateX(-Math.PI / 2);
    const mat = o.material ?? this.defaultWaterMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(o.x, o.y, o.z);
    mesh.rotation.y = o.yaw ?? 0;
    mesh.renderOrder = 2;
    mesh.name = `water_${o.id}`;
    this.group.add(mesh);
    this.meshes.push(mesh);
    this.ownedGeometries.push(geo);
    this.ctx.water.register({
      id: o.id,
      type: o.type ?? 'pond',
      label: o.label,
      x: o.x,
      y: o.y,
      z: o.z,
      r: o.circle ? o.w / 2 : Math.min(o.w, o.d) / 2,
      capacity: o.capacity ?? 120,
      regen: o.regen ?? 3,
    });
    return mesh;
  }

  private static waterMat: THREE.MeshStandardMaterial | null = null;
  private defaultWaterMaterial(): THREE.Material {
    if (!ContentBuilder.waterMat) {
      ContentBuilder.waterMat = new THREE.MeshStandardMaterial({ color: '#3a8fb5', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82 });
    }
    return ContentBuilder.waterMat;
  }

  /** Merge all batches into meshes and add instanced meshes. Call once after building. */
  finish(): void {
    for (const b of this.batches.values()) {
      if (!b.geos.length) continue;
      // Merge in chunks to keep index ranges reasonable.
      const CHUNK = 400;
      for (let i = 0; i < b.geos.length; i += CHUNK) {
        const part = b.geos.slice(i, i + CHUNK);
        const merged = mergeGeometries(part, false);
        for (const g of part) g.dispose();
        if (!merged) continue;
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        const mesh = new THREE.Mesh(merged, b.material);
        mesh.castShadow = b.castShadow;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
        this.meshes.push(mesh);
        this.ownedGeometries.push(merged);
      }
    }
    this.batches.clear();
    for (const inst of this.instances.values()) {
      const im = new THREE.InstancedMesh(inst.geo, inst.mat, inst.matrices.length);
      inst.matrices.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = inst.castShadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      this.meshes.push(im);
    }
    this.instances.clear();
  }

  /** Remove everything this builder created (meshes, colliders). Materials are shared and kept. */
  dispose(): void {
    for (const id of this.colliderIds) this.ctx.world.collision.remove(id);
    this.colliderIds.length = 0;
    for (const m of this.meshes) this.group.remove(m);
    this.meshes.length = 0;
    for (const g of this.ownedGeometries) g.dispose();
    this.ownedGeometries.length = 0;
  }
}

/**
 * Roof geometry with upturned eaves. Centred at origin, eaves at y=0, ridge at y=height.
 * UVs: u along the eave, v up the slope (for roofTiles textures).
 */
export function roofGeometry(w: number, d: number, height: number, style: 'hip' | 'gable' | 'pagoda', curve: number): THREE.BufferGeometry {
  const segs = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const hw = w / 2, hd = d / 2;
  // Ridge extent along X for hip roofs.
  const ridgeHalf = style === 'gable' ? hw : Math.max(0, hw - hd);
  const lift = (t: number, cornerness: number) => {
    // t: 0 at eave, 1 at ridge. Concave profile + corner upturn.
    const concave = Math.pow(t, 1.6);
    return height * concave + curve * (1 - t) * (1 - t) * cornerness * 0.8;
  };
  const addQuadGrid = (corner: (u: number, t: number) => [number, number, number], uLen: number, vLen: number) => {
    const base = positions.length / 3;
    for (let j = 0; j <= segs; j++) {
      for (let i = 0; i <= segs; i++) {
        const u = i / segs, t = j / segs;
        const p = corner(u, t);
        positions.push(p[0], p[1], p[2]);
        uvs.push((u * uLen) / 2, (t * vLen) / 2);
      }
    }
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = base + j * (segs + 1) + i;
        const b = a + 1;
        const c = a + (segs + 1);
        const dd = c + 1;
        indices.push(a, c, b, b, c, dd);
      }
    }
  };
  // Long sides (front +Z and back -Z): from eave edge to ridge line.
  for (const side of [1, -1]) {
    addQuadGrid(
      (u, t) => {
        const xe = -hw + u * w; // eave x
        const xr = Math.max(-ridgeHalf, Math.min(ridgeHalf, xe)); // ridge x
        const x = xe + (xr - xe) * t;
        const z = side * hd * (1 - t);
        const corner = Math.pow(Math.abs(u - 0.5) * 2, 6);
        return [x, lift(t, corner), z];
      },
      w,
      Math.hypot(hd, height),
    );
  }
  if (style !== 'gable') {
    // Hip ends (left/right): triangles from eave to ridge end point.
    for (const side of [1, -1]) {
      addQuadGrid(
        (u, t) => {
          const ze = -hd + u * d;
          const x = side * (hw + (ridgeHalf - hw) * t);
          const z = ze * (1 - t);
          const corner = Math.pow(Math.abs(u - 0.5) * 2, 6);
          return [x, lift(t, corner), z];
        },
        d,
        Math.hypot(hw - ridgeHalf, height),
      );
    }
  } else {
    // Gable triangles (vertical end walls under the roof).
    for (const side of [1, -1]) {
      const base = positions.length / 3;
      positions.push(side * hw * 0.95, 0, -hd * 0.95, side * hw * 0.95, 0, hd * 0.95, side * hw * 0.95, height * 0.98, 0);
      uvs.push(0, 0, 1, 0, 0.5, 1);
      indices.push(base, base + 1, base + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  // Make it double-sided by duplicating with flipped winding (roofs are seen from below at eaves).
  const flipped = g.clone();
  const idx = flipped.getIndex()!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  flipped.computeVertexNormals();
  const merged = mergeGeometries([g, flipped], false)!;
  g.dispose();
  flipped.dispose();
  return merged;
}

/** Tiered pagoda tower: stacked floors with roofs. Base at y. */
export function pagoda(b: ContentBuilder, o: { x: number; y: number; z: number; size: number; tiers: number; yaw?: number; wall: MatKey; roof: MatKey; trim?: MatKey; finial?: MatKey }): number {
  let y = o.y;
  let s = o.size;
  const tierH = o.size * 0.55;
  for (let i = 0; i < o.tiers; i++) {
    b.block(o.wall, { x: o.x, y, z: o.z, sx: s, sy: tierH, sz: s, yaw: o.yaw }, { collide: i === 0, walkable: false });
    b.roof(o.roof, { x: o.x, y: y + tierH, z: o.z, w: s, d: s, height: s * 0.28, yaw: o.yaw, style: 'pagoda', overhang: s * 0.22, ridge: null });
    y += tierH + s * 0.2;
    s *= 0.8;
  }
  b.cylinder(o.finial ?? 'gold', { x: o.x, y: y - s * 0.1, z: o.z, r: 0.12 * o.size * 0.2 + 0.05, rTop: 0.02, h: o.size * 0.6 });
  return y;
}
