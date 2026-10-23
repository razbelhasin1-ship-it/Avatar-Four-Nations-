import * as THREE from 'three';
import { heightAt, materialAt, type MaterialSample } from './Heightfield';
import { WORLD_HALF } from './WorldLayout';

/**
 * Streams terrain chunks around a focus point with distance-based LOD.
 * Chunk geometry is built on the main thread within a per-frame time budget.
 */

export const CHUNK_SIZE = 64;
const LOD_SPACING = [2, 4, 8, 16];
const SKIRT_DEPTH = 6;

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh;
  lastUsed: number;
}

function chunkKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

/** Shared terrain material with splat blending injected into MeshStandardMaterial. */
export function createTerrainMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: false });
  const uniforms = {
    uDirt: { value: new THREE.Color('#7a6247') },
    uRock: { value: new THREE.Color('#827c74') },
    uSand: { value: new THREE.Color('#dcc896') },
    uSnow: { value: new THREE.Color('#eef3f9') },
    uIce: { value: new THREE.Color('#a8d4ec') },
    uAsh: { value: new THREE.Color('#4b4442') },
    uMud: { value: new THREE.Color('#5b4e36') },
    uDeep: { value: new THREE.Color('#0f3b56') },
    uTime: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 splatA;
attribute vec4 splatB;
attribute vec3 tint;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec3 vTint;
varying vec3 vTerrWorld;
varying vec3 vTerrNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSplatA = splatA;
vSplatB = splatB;
vTint = tint;
vTerrWorld = (modelMatrix * vec4(position, 1.0)).xyz;
vTerrNormal = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uDirt; uniform vec3 uRock; uniform vec3 uSand; uniform vec3 uSnow;
uniform vec3 uIce; uniform vec3 uAsh; uniform vec3 uMud; uniform vec3 uDeep;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec3 vTint;
varying vec3 vTerrWorld;
varying vec3 vTerrNormal;
float tHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float tNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float a = tHash(i), b = tHash(i+vec2(1.0,0.0)), c = tHash(i+vec2(0.0,1.0)), d = tHash(i+vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float tFbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*tNoise(p); p*=2.03; a*=0.5; } return s; }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 wp = vTerrWorld.xz;
  float n1 = tFbm(wp * 0.35);
  float n2 = tFbm(wp * 2.7);
  float n3 = tNoise(wp * 0.04);
  vec3 grass = vTint * (0.82 + 0.3 * n1) * (0.92 + 0.12 * n2);
  grass = mix(grass, grass * vec3(1.12, 1.05, 0.7), smoothstep(0.55, 0.8, n3) * 0.6);
  vec3 dirt = uDirt * (0.8 + 0.35 * n1) * (0.9 + 0.15 * n2);
  float strata = 0.5 + 0.5 * sin(vTerrWorld.y * 1.3 + n1 * 3.0);
  vec3 rock = uRock * (0.7 + 0.25 * n2 + 0.15 * strata) * (0.85 + 0.3 * n1);
  vec3 sand = uSand * (0.88 + 0.12 * n1) * (0.95 + 0.08 * sin(wp.x * 0.9 + wp.y * 0.6 + n1 * 4.0));
  vec3 snow = uSnow * (0.93 + 0.07 * n2);
  vec3 ice = uIce * (0.85 + 0.2 * n1);
  vec3 ash = uAsh * (0.75 + 0.4 * n2);
  vec3 mud = uMud * (0.75 + 0.35 * n1);
  vec4 a = vSplatA; vec4 b = vSplatB;
  // Sharpen blends with noise so transitions look natural rather than smeared.
  a = max(a + (n2 - 0.5) * 0.25 * step(0.02, a), 0.0);
  b = max(b + (n2 - 0.5) * 0.25 * step(0.02, b), 0.0);
  float sum = a.x + a.y + a.z + a.w + b.x + b.y + b.z + b.w + 1e-4;
  vec3 col = (grass * a.x + dirt * a.y + rock * a.z + sand * a.w + snow * b.x + ice * b.y + ash * b.z + mud * b.w) / sum;
  // Underwater tint for the sea floor (sea level y = 0).
  float depth = clamp(-vTerrWorld.y / 14.0, 0.0, 1.0);
  col = mix(col, uDeep, depth * 0.85);
  // Wet shoreline band.
  col *= 1.0 - 0.25 * smoothstep(1.2, 0.0, abs(vTerrWorld.y - 0.15)) * (1.0 - b.x);
  diffuseColor.rgb = col;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - vSplatB.y * 0.65 - vSplatB.x * 0.15, 0.08, 1.0);`,
      );
  };
  return mat;
}

const mScratch: MaterialSample = { w: new Float32Array(8), tint: [0, 0, 0] };

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Build a terrain chunk geometry with skirts. */
export function buildChunkGeometry(cx: number, cz: number, lod: number): THREE.BufferGeometry {
  const spacing = LOD_SPACING[lod];
  const n = CHUNK_SIZE / spacing + 1; // vertices per side
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  // Heights with a 1-sample border for normals.
  const gw = n + 2;
  const hs = new Float32Array(gw * gw);
  for (let j = 0; j < gw; j++) {
    for (let i = 0; i < gw; i++) {
      hs[j * gw + i] = heightAt(x0 + (i - 1) * spacing, z0 + (j - 1) * spacing);
    }
  }
  const vCount = n * n + 4 * n; // grid + skirt ring
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const spA = new Float32Array(vCount * 4);
  const spB = new Float32Array(vCount * 4);
  const tint = new Float32Array(vCount * 3);

  const writeVertex = (vi: number, i: number, j: number, yOffset: number) => {
    const h = hs[(j + 1) * gw + (i + 1)];
    const x = i * spacing;
    const z = j * spacing;
    pos[vi * 3] = x;
    pos[vi * 3 + 1] = h + yOffset;
    pos[vi * 3 + 2] = z;
    const hl = hs[(j + 1) * gw + i];
    const hr = hs[(j + 1) * gw + i + 2];
    const hd = hs[j * gw + i + 1];
    const hu = hs[(j + 2) * gw + i + 1];
    let nx = hl - hr, ny = 2 * spacing, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    nor[vi * 3] = nx;
    nor[vi * 3 + 1] = ny;
    nor[vi * 3 + 2] = nz;
    materialAt(x0 + x, z0 + z, h, 1 - ny, mScratch);
    const w = mScratch.w;
    spA[vi * 4] = w[0]; spA[vi * 4 + 1] = w[1]; spA[vi * 4 + 2] = w[2]; spA[vi * 4 + 3] = w[3];
    spB[vi * 4] = w[4]; spB[vi * 4 + 1] = w[5]; spB[vi * 4 + 2] = w[6]; spB[vi * 4 + 3] = w[7];
    tint[vi * 3] = srgbToLinear(mScratch.tint[0]);
    tint[vi * 3 + 1] = srgbToLinear(mScratch.tint[1]);
    tint[vi * 3 + 2] = srgbToLinear(mScratch.tint[2]);
  };

  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) writeVertex(j * n + i, i, j, 0);

  // Skirt ring: duplicate border vertices pushed down.
  const border: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) border.push([i, 0]);
  for (let j = 0; j < n; j++) border.push([n - 1, j]);
  for (let i = n - 1; i >= 0; i--) border.push([i, n - 1]);
  for (let j = n - 1; j >= 0; j--) border.push([0, j]);
  const skirtBase = n * n;
  border.forEach(([i, j], k) => writeVertex(skirtBase + k, i, j, -SKIRT_DEPTH * (1 + lod)));

  const quads = (n - 1) * (n - 1);
  const idx: number[] = new Array(quads * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // Alternate diagonal for less directional artefacts.
      if ((i + j) & 1) {
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = b; idx[p++] = c; idx[p++] = d;
      } else {
        idx[p++] = a; idx[p++] = c; idx[p++] = d;
        idx[p++] = a; idx[p++] = d; idx[p++] = b;
      }
    }
  }
  // Skirt quads (border order matches the `border` list above).
  let k = 0;
  const sides = [
    Array.from({ length: n }, (_, i) => i),
    Array.from({ length: n }, (_, j) => j * n + (n - 1)),
    Array.from({ length: n }, (_, i) => (n - 1) * n + (n - 1 - i)),
    Array.from({ length: n }, (_, j) => (n - 1 - j) * n),
  ];
  for (const side of sides) {
    for (let s = 0; s < n - 1; s++) {
      const top0 = side[s], top1 = side[s + 1];
      const bot0 = skirtBase + k + s, bot1 = skirtBase + k + s + 1;
      idx.push(top0, top1, bot0, top1, bot1, bot0);
    }
    k += n;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('splatA', new THREE.BufferAttribute(spA, 4));
  geo.setAttribute('splatB', new THREE.BufferAttribute(spB, 4));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export class TerrainManager {
  readonly group = new THREE.Group();
  readonly material = createTerrainMaterial();
  private chunks = new Map<string, Chunk>();
  private frame = 0;
  /** Chunks pending (re)build ordered by priority each frame. */
  private wanted: Array<{ cx: number; cz: number; lod: number; d: number }> = [];
  drawDistance = 800;
  lodBias = 0;
  castShadows = true;

  constructor() {
    this.group.name = 'terrain';
  }

  private lodFor(dist: number): number {
    const b = 1 + this.lodBias * 1.5;
    if (dist < 150 / b) return 0;
    if (dist < 340 / b) return 1;
    if (dist < 700 / b) return 2;
    return 3;
  }

  /**
   * Update streaming around `focus`. Builds chunks within `budgetMs`.
   * Returns number of chunks still pending.
   */
  update(focus: THREE.Vector3, budgetMs = 4): number {
    this.frame++;
    const range = this.drawDistance + CHUNK_SIZE;
    const c0x = Math.floor((focus.x - range) / CHUNK_SIZE);
    const c1x = Math.floor((focus.x + range) / CHUNK_SIZE);
    const c0z = Math.floor((focus.z - range) / CHUNK_SIZE);
    const c1z = Math.floor((focus.z + range) / CHUNK_SIZE);
    const maxC = Math.floor(WORLD_HALF / CHUNK_SIZE);
    this.wanted.length = 0;
    for (let cz = Math.max(-maxC, c0z); cz <= Math.min(maxC - 1, c1z); cz++) {
      for (let cx = Math.max(-maxC, c0x); cx <= Math.min(maxC - 1, c1x); cx++) {
        const mx = (cx + 0.5) * CHUNK_SIZE, mz = (cz + 0.5) * CHUNK_SIZE;
        const d = Math.max(0, Math.hypot(mx - focus.x, mz - focus.z) - CHUNK_SIZE * 0.7);
        if (d > range) continue;
        const lod = this.lodFor(d);
        const key = chunkKey(cx, cz);
        const ch = this.chunks.get(key);
        if (ch) {
          ch.lastUsed = this.frame;
          if (ch.lod !== lod) this.wanted.push({ cx, cz, lod, d });
        } else {
          this.wanted.push({ cx, cz, lod, d });
        }
      }
    }
    this.wanted.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    let built = 0;
    for (const w of this.wanted) {
      if (built > 0 && performance.now() - t0 > budgetMs) break;
      this.build(w.cx, w.cz, w.lod);
      built++;
    }
    // Evict chunks not used this frame.
    for (const [key, ch] of this.chunks) {
      if (ch.lastUsed !== this.frame) {
        this.group.remove(ch.mesh);
        ch.mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
    return Math.max(0, this.wanted.length - built);
  }

  private build(cx: number, cz: number, lod: number): void {
    const key = chunkKey(cx, cz);
    const geo = buildChunkGeometry(cx, cz, lod);
    const existing = this.chunks.get(key);
    if (existing) {
      existing.mesh.geometry.dispose();
      existing.mesh.geometry = geo;
      existing.lod = lod;
      existing.lastUsed = this.frame;
      existing.mesh.castShadow = this.castShadows && lod <= 1;
      return;
    }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.receiveShadow = true;
    mesh.castShadow = this.castShadows && lod <= 1;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `terrain_${key}`;
    this.group.add(mesh);
    this.chunks.set(key, { cx, cz, lod, mesh, lastUsed: this.frame });
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  dispose(): void {
    for (const ch of this.chunks.values()) {
      this.group.remove(ch.mesh);
      ch.mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.material.dispose();
  }
}
