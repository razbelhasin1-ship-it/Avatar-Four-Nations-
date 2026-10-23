import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { Entity } from '../../entities/Entity';
import { getPlateauRuntime } from '../Heightfield';
import { CHUNK_SIZE, LOD_SPACING, type ChunkDetail } from '../Terrain';
import type { WorldUpdatable } from '../World';
import { attachEnvUniforms, ENV_NOISE_GLSL, ENV_PARS_GLSL, envUniforms, MAX_INTERACTORS } from './EnvShared';

/**
 * Instanced grass near the camera.
 *
 * Grass lives in 16 m tiles built from the terrain's LOD0 chunk detail records
 * (2 m heights, grass coverage and tint), so blades sit exactly on the rendered
 * ground, match its colour and are absent wherever the terrain is not grassy
 * (roads, water, rock, snow, sand, steep slopes). Each instance is a clump of
 * curved blades; the vertex shader applies wind, pushes blades away from the
 * player / nearby creatures (uInteract) and from world.fx.disturb impulses, and
 * thins clumps smoothly with distance. settings.graphics.grassDensity controls
 * spacing and radius live (0 disables grass entirely).
 */

const TILE = 12;
const MAX_PER_TILE = 1600;
const BLADES = 7;

interface TileData {
  key: string;
  tx: number;
  tz: number;
  count: number;
  /** x, y, z, rotation */
  offs: Float32Array;
  /** r, g, b, height scale */
  cols: Float32Array;
  density: number;
  lastUsed: number;
}

interface TileSlot {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  offs: THREE.InstancedBufferAttribute;
  cols: THREE.InstancedBufferAttribute;
  tile: TileData | null;
}

function hash2(x: number, z: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One clump of curved, tapered blades (local space, base at y = 0, unit height). */
function buildClumpGeometry(): { pos: Float32Array; nor: Float32Array; col: Float32Array; idx: Uint16Array } {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const segs = 2;
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + b * 0.9;
    const r = 0.04 + (b % 3) * 0.085;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    // Blade faces a random direction and leans outward.
    const face = a + 1.3 + b * 0.7;
    const sx = Math.cos(face), sz = Math.sin(face);
    const lean = 0.16 + (b % 3) * 0.09;
    const lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
    const hgt = 0.7 + (b % 3) * 0.15;
    const w = 0.06 + (b % 2) * 0.025;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = t * hgt;
      const bend = t * t;
      const cx = bx + lx * bend, cz = bz + lz * bend;
      const ww = w * (1 - t * 0.85);
      if (i < segs) {
        pos.push(cx - sx * ww, y, cz - sz * ww, cx + sx * ww, y, cz + sz * ww);
        nor.push(-sz, 0.6, sx, -sz, 0.6, sx);
        col.push(t, t, t, t, t, t);
      } else {
        pos.push(cx, y, cz);
        nor.push(-sz, 0.6, sx);
        col.push(1, 1, 1);
      }
    }
    for (let i = 0; i < segs - 1; i++) {
      const v = base + i * 2;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    const v = base + (segs - 1) * 2;
    idx.push(v, v + 1, v + 2);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), col: new Float32Array(col), idx: new Uint16Array(idx) };
}

const GRASS_VERT_PARS = /* glsl */ `
attribute vec4 aOffset;
attribute vec4 aColor;
uniform float uRadius;
uniform float uKeep;
varying float vGrassH;
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
`;

const GRASS_BEGIN = /* glsl */ `
float gH = position.y;
vec3 transformed = position;
float gc = cos( aOffset.w ), gs = sin( aOffset.w );
transformed.xz = mat2( gc, -gs, gs, gc ) * transformed.xz;
float gDist = length( aOffset.xz - cameraPosition.xz );
float gRank = envHash( aOffset.xz * 1.37 + 0.11 );
// Thin out with distance (rank-based so clumps disappear one by one) and shrink at the edge.
float gKeep = uKeep * ( 1.0 - 0.75 * smoothstep( uRadius * 0.35, uRadius, gDist ) );
float gVis = smoothstep( 0.0, 0.08, gKeep - gRank ) * ( 1.0 - smoothstep( uRadius * 0.8, uRadius, gDist ) );
float gScale = aColor.w * gVis;
transformed *= vec3( 0.7 + 0.3 * gScale, gScale, 0.7 + 0.3 * gScale );
transformed += aOffset.xyz;
float gFlex = gH * gH;
float gPhase = gRank * 6.2831;
transformed += envWindSway( aOffset.xyz, 0.45 * gFlex * aColor.w, gPhase );
vec2 gPush = envInteractPush( aOffset.xyz + vec3( 0.0, 0.25, 0.0 ) );
float gPl = min( length( gPush ), 1.2 );
transformed.xz += gPush * gFlex * 0.65 * aColor.w;
transformed.y -= gPl * gFlex * 0.42 * aColor.w;
vGrassH = gH;
`;

const GRASS_PROJECT = /* glsl */ `
vec4 mvPosition = viewMatrix * vec4( transformed, 1.0 );
gl_Position = projectionMatrix * mvPosition;
`;

function createGrassMaterial(radius: { value: number }, keep: { value: number }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    attachEnvUniforms(shader);
    shader.uniforms.uRadius = radius;
    shader.uniforms.uKeep = keep;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GRASS_VERT_PARS)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize( vec3( 0.0, 1.0, 0.0 ) + normal * 0.25 );')
      .replace('#include <begin_vertex>', GRASS_BEGIN)
      .replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb = aColor.rgb * mix( 0.78, 1.28, color.r ) * vec3( 1.0, 1.0, 0.92 ) + vec3( 0.02, 0.025, 0.0 ) * color.r;')
      .replace('#include <project_vertex>', GRASS_PROJECT)
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4( transformed, 1.0 );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGrassH;')
      // Both blade faces are lit like the ground (no flipped, black back faces).
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );')
      .replace('#include <opaque_fragment>', '  outgoingLight += diffuseColor.rgb * vGrassH * 0.12;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'grass-v2';
  return mat;
}

export class GrassSystem implements WorldUpdatable {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, TileData>();
  private readonly slots: TileSlot[] = [];
  private readonly baseGeo: THREE.BufferGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly uRadius = { value: 40 };
  private readonly uKeep = { value: 1 };
  private density = 1;
  private radius = 40;
  private frame = 0;
  private plats: ReadonlyArray<{ x: number; z: number; r: number }> = [];
  private readonly ents: Entity[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  enabled = true;
  /** Instances drawn last frame (stats). */
  drawn = 0;

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'grass';
    const c = buildClumpGeometry();
    this.baseGeo = new THREE.BufferGeometry();
    this.baseGeo.setAttribute('position', new THREE.BufferAttribute(c.pos, 3));
    this.baseGeo.setAttribute('normal', new THREE.BufferAttribute(c.nor, 3));
    this.baseGeo.setAttribute('color', new THREE.BufferAttribute(c.col, 3));
    this.baseGeo.setIndex(new THREE.BufferAttribute(c.idx, 1));
    this.material = createGrassMaterial(this.uRadius, this.uKeep);
    ctx.world.group.add(this.group);
    this.applySettings();
    ctx.events.on('settings:changed', () => this.applySettings());
  }

  private applySettings(): void {
    const d = Math.max(0, Math.min(1.5, this.ctx.settings.data.graphics.grassDensity));
    if (d !== this.density) {
      this.density = d;
      // Spacing depends on density: rebuild tiles.
      this.tiles.clear();
      for (const s of this.slots) s.tile = null;
    }
    this.radius = d <= 0 ? 0 : 16 + 22 * Math.min(d, 1.5);
    this.uRadius.value = this.radius;
    this.uKeep.value = 1;
  }

  private onPlateau(x: number, z: number): boolean {
    for (const p of this.plats) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < p.r * p.r) return true;
    }
    return false;
  }

  /** Build the instance data of one tile from the terrain chunk detail. */
  private buildTile(tx: number, tz: number, det: ChunkDetail): TileData {
    const spacing = 0.46 / Math.sqrt(Math.max(0.25, this.density));
    const n = Math.min(Math.floor(TILE / spacing), Math.floor(Math.sqrt(MAX_PER_TILE)));
    const offs = new Float32Array(n * n * 4);
    const cols = new Float32Array(n * n * 4);
    const gn = CHUNK_SIZE / LOD_SPACING[0] + 1;
    const x0 = tx * TILE, z0 = tz * TILE;
    const cx0 = det.cx * CHUNK_SIZE, cz0 = det.cz * CHUNK_SIZE;
    let count = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5 + (hash2(tx * 97 + i, tz * 89 + j, 1) - 0.5) * 0.9) * (TILE / n);
        const z = z0 + (j + 0.5 + (hash2(tx * 97 + i, tz * 89 + j, 2) - 0.5) * 0.9) * (TILE / n);
        const lx = (x - cx0) / LOD_SPACING[0], lz = (z - cz0) / LOD_SPACING[0];
        const gi = Math.min(gn - 2, Math.max(0, Math.floor(lx))), gj = Math.min(gn - 2, Math.max(0, Math.floor(lz)));
        const fx = lx - gi, fz = lz - gj;
        const a = gj * gn + gi, b = a + 1, c = a + gn, d = c + 1;
        const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
        const cover = det.grass[a] * w00 + det.grass[b] * w10 + det.grass[c] * w01 + det.grass[d] * w11;
        const r = hash2(tx * 131 + i, tz * 71 + j, 3);
        if (r > cover * 1.15 - 0.08) continue;
        if (this.onPlateau(x, z)) continue;
        const h = det.h[a] * w00 + det.h[b] * w10 + det.h[c] * w01 + det.h[d] * w11;
        const o = count * 4;
        offs[o] = x;
        offs[o + 1] = h - 0.03;
        offs[o + 2] = z;
        offs[o + 3] = hash2(i, j, tx * 7 + tz * 13) * Math.PI * 2;
        const tr = det.tint[a * 3] * w00 + det.tint[b * 3] * w10 + det.tint[c * 3] * w01 + det.tint[d * 3] * w11;
        const tg = det.tint[a * 3 + 1] * w00 + det.tint[b * 3 + 1] * w10 + det.tint[c * 3 + 1] * w01 + det.tint[d * 3 + 1] * w11;
        const tb = det.tint[a * 3 + 2] * w00 + det.tint[b * 3 + 2] * w10 + det.tint[c * 3 + 2] * w01 + det.tint[d * 3 + 2] * w11;
        const v = 0.85 + hash2(i, j, 77) * 0.3;
        cols[o] = tr * v;
        cols[o + 1] = tg * v;
        cols[o + 2] = tb * v;
        // Taller, lusher grass where coverage is full; short tufts at the edges.
        cols[o + 3] = (0.28 + 0.26 * cover) * (0.75 + hash2(i, j, 99) * 0.5);
        count++;
      }
    }
    return { key: tx + ',' + tz, tx, tz, count, offs, cols, density: this.density, lastUsed: this.frame };
  }

  private newSlot(): TileSlot {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = this.baseGeo.index;
    geo.setAttribute('position', this.baseGeo.getAttribute('position'));
    geo.setAttribute('normal', this.baseGeo.getAttribute('normal'));
    geo.setAttribute('color', this.baseGeo.getAttribute('color'));
    const offs = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_TILE * 4), 4);
    const cols = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_TILE * 4), 4);
    offs.setUsage(THREE.DynamicDrawUsage);
    cols.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOffset', offs);
    geo.setAttribute('aColor', cols);
    geo.instanceCount = 0;
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'grass_tile';
    this.group.add(mesh);
    const slot: TileSlot = { mesh, geo, offs, cols, tile: null };
    this.slots.push(slot);
    return slot;
  }

  private assign(slot: TileSlot, t: TileData): void {
    slot.tile = t;
    (slot.offs.array as Float32Array).set(t.offs.subarray(0, t.count * 4));
    (slot.cols.array as Float32Array).set(t.cols.subarray(0, t.count * 4));
    slot.offs.clearUpdateRanges();
    slot.offs.addUpdateRange(0, t.count * 4);
    slot.offs.needsUpdate = true;
    slot.cols.clearUpdateRanges();
    slot.cols.addUpdateRange(0, t.count * 4);
    slot.cols.needsUpdate = true;
    slot.geo.instanceCount = t.count;
  }

  private updateInteractors(ctx: GameContext): void {
    const arr = envUniforms.uInteract.value;
    let n = 0;
    const p = ctx.player;
    if (p && ctx.session.active) {
      const pp = p.position;
      arr[n++].set(pp.x, pp.y, pp.z, 1.1);
      this.ents.length = 0;
      ctx.entities.queryRadius(pp, 30, undefined, this.ents);
      for (const e of this.ents) {
        if (n >= MAX_INTERACTORS) break;
        if (e === (p as unknown as Entity)) continue;
        const ep = e.position;
        arr[n++].set(ep.x, ep.y, ep.z, 1.0);
      }
    }
    for (let i = n; i < MAX_INTERACTORS; i++) arr[i].set(0, -9999, 0, 0);
  }

  update(_dt: number, ctx: GameContext, _focus: THREE.Vector3): void {
    this.frame++;
    this.updateInteractors(ctx);
    if (!this.enabled || this.radius <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    if (!this.plats.length) this.plats = getPlateauRuntime();
    const cam = ctx.camera;
    const cp = cam.position;
    const R = this.radius;
    // Grass only matters near the ground.
    const terrainY = ctx.world.terrain.heightAt(cp.x, cp.z);
    if (cp.y - terrainY > R * 1.5) {
      this.group.visible = false;
      return;
    }
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const t0x = Math.floor((cp.x - R) / TILE), t1x = Math.floor((cp.x + R) / TILE);
    const t0z = Math.floor((cp.z - R) / TILE), t1z = Math.floor((cp.z + R) / TILE);
    const wanted: Array<{ tx: number; tz: number; d: number }> = [];
    for (let tz = t0z; tz <= t1z; tz++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const mx = (tx + 0.5) * TILE, mz = (tz + 0.5) * TILE;
        const d = Math.hypot(mx - cp.x, mz - cp.z) - TILE * 0.71;
        if (d > R) continue;
        wanted.push({ tx, tz, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    const keep = new Set<string>();
    for (const w of wanted) {
      const key = w.tx + ',' + w.tz;
      keep.add(key);
      let t = this.tiles.get(key);
      if (!t) {
        if (performance.now() - t0 > 1.2) continue;
        const det = ctx.world.terrain.detailAt((w.tx + 0.5) * TILE, (w.tz + 0.5) * TILE);
        if (!det) continue;
        t = this.buildTile(w.tx, w.tz, det);
        this.tiles.set(key, t);
      }
      t.lastUsed = this.frame;
    }
    // Assign tiles to slots (reuse slots whose tile is no longer wanted).
    const free: TileSlot[] = [];
    const shown = new Set<string>();
    for (const s of this.slots) {
      if (s.tile && keep.has(s.tile.key) && this.tiles.get(s.tile.key) === s.tile) shown.add(s.tile.key);
      else {
        s.tile = null;
        s.geo.instanceCount = 0;
        free.push(s);
      }
    }
    for (const w of wanted) {
      const key = w.tx + ',' + w.tz;
      if (shown.has(key)) continue;
      const t = this.tiles.get(key);
      if (!t || t.count === 0) continue;
      const slot = free.pop() ?? this.newSlot();
      this.assign(slot, t);
      shown.add(key);
    }
    // Frustum culling per tile.
    let drawn = 0;
    for (const s of this.slots) {
      if (!s.tile) {
        s.mesh.visible = false;
        continue;
      }
      const t = s.tile;
      this.box.min.set(t.tx * TILE - 1, -1e4, t.tz * TILE - 1);
      this.box.max.set((t.tx + 1) * TILE + 1, 1e4, (t.tz + 1) * TILE + 1);
      // Tighten Y from the camera's terrain height band (cheap and conservative).
      this.box.min.y = terrainY - 200;
      this.box.max.y = terrainY + 200;
      s.mesh.visible = this.frustum.intersectsBox(this.box);
      if (s.mesh.visible) drawn += t.count;
    }
    this.drawn = drawn;
    // Evict cached tiles not used recently.
    if (this.tiles.size > 260) {
      for (const [k, t] of this.tiles) if (this.frame - t.lastUsed > 600) this.tiles.delete(k);
    }
  }

  stats(): { tiles: number; slots: number; drawn: number; radius: number } {
    return { tiles: this.tiles.size, slots: this.slots.filter((s) => s.tile).length, drawn: this.drawn, radius: this.radius };
  }

  dispose(): void {
    for (const s of this.slots) {
      this.group.remove(s.mesh);
      s.geo.dispose();
    }
    this.slots.length = 0;
    this.tiles.clear();
    this.baseGeo.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
