import * as THREE from 'three';
import { Random } from '../../core/Random';
import { Field, pfbm, worley } from '../env/ProcTex';

/**
 * Procedural city paving with real stone shapes: albedo, normal and roughness maps generated once
 * per kind and colour (tileable, cached), meant for world-space mapping (pavingMaterial) so the
 * stones keep their real size on any ground mesh.
 *
 *  - flag:   running-bond flagstones of uneven widths, chipped bevelled edges, dark grout.
 *  - cobble: rounded setts packed in sand, each stone its own shade.
 *  - slab:   big cut slabs with hairline joints and faint veining, smoother and paler.
 *  - earth:  packed earth with pebbles and wheel-worn patches.
 *
 * Weathering: a few stones cracked, grime gathered in the joints, moss in old joints (`moss`),
 * paler polish where feet wear the stone.
 */

export type PavingKind = 'flag' | 'cobble' | 'slab' | 'earth';

export interface PavingSet {
  /** Albedo (sRGB rgb) with roughness in the alpha channel (read by pavingMaterial). */
  map: THREE.DataTexture;
  /** Normal map (half the albedo's resolution: stone relief needs less detail than colour). */
  normalMap: THREE.DataTexture;
  /** Metres one tile of the textures covers. */
  tile: number;
}

/** Metres per texture tile for each kind (stone sizes follow from the layouts below). */
const TILE: Record<PavingKind, number> = { flag: 4, cobble: 2.4, slab: 7.2, earth: 6 };

const cache = new Map<string, PavingSetInternal>();

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hexRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

interface Layers {
  S: number;
  h: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  rough: Float32Array;
}

function layers(S: number): Layers {
  const n = S * S;
  return { S, h: new Float32Array(n), r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), rough: new Float32Array(n) };
}

/** Per-row stone boundaries (pixels) for a running bond, wrapping around the tile; rows vary in height. */
function bondRows(S: number, rows: number, minW: number, maxW: number, rnd: Random): Array<{ y0: number; y1: number; off: number; cuts: number[] }> {
  const hs = Array.from({ length: rows }, () => rnd.range(0.78, 1.22));
  const sum = hs.reduce((a, b) => a + b, 0);
  const out: Array<{ y0: number; y1: number; off: number; cuts: number[] }> = [];
  let y = 0;
  for (let i = 0; i < rows; i++) {
    const y1 = i === rows - 1 ? S : y + (hs[i] / sum) * S;
    const cuts = [0];
    let x = 0;
    while (x < S) {
      const w = rnd.range(minW, maxW);
      x += w;
      if (S - x < minW * 0.6) x = S;
      cuts.push(Math.min(S, x));
    }
    out.push({ y0: y, y1, off: Math.floor(rnd.range(0, S)), cuts });
    y = y1;
  }
  return out;
}

/** Bilinear, wrapping sample of a tileable field at (u, v) repeated `rep` times across the tile. */
function sampler(f: Field, rep: number): (u: number, v: number) => number {
  const n = f.size, d = f.data;
  return (u, v) => {
    const x = (u * rep * n) % n, y = (v * rep * n) % n;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const a = d[y0 * n + x0], b = d[y0 * n + x1], c = d[y1 * n + x0], e = d[y1 * n + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
  };
}

const fieldCache = new Map<string, Field>();
function field(freq: number, oct: number, seed: number): Field {
  const k = `${freq}:${oct}:${seed}`;
  let f = fieldCache.get(k);
  if (!f) {
    f = new Field(128, (u, v) => pfbm(u, v, freq, oct, seed));
    fieldCache.set(k, f);
  }
  return f;
}

/** Paint rows [y0, y1) of the layers (call over the whole height, in any number of slices). */
function painter(L: Layers, kind: PavingKind, base: string, seed: number, moss: number): (y0: number, y1: number) => void {
  const { S } = L;
  // Tileable noise fields (computed once at 128², sampled with wrap): fine pitting, mid mottling,
  // chipped edges, moss patches.
  const fineN = sampler(field(12, 3, seed + 11), 4);
  const midN = sampler(field(9, 4, seed + 23), 1);
  const chipN = sampler(field(16, 2, seed + 31), 4);
  const mossN = sampler(field(16, 3, seed + 61), 1);
  const grainN = sampler(field(16, 2, seed + 71), 8);
  const rnd = new Random(seed);
  const [br, bg, bb] = hexRgb(base);
  const w = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  // Per-stone shade / tint tables (indexed by a stone hash).
  const rand = (id: number, k: number) => ((Math.sin(id * (12.9898 + k * 7.13) + seed * (1 + k)) * 43758.5453) % 1 + 1) % 1;
  const shade = (id: number) => 0.8 + 0.36 * rand(id, 0);
  const warm = (id: number) => (rand(id, 1) - 0.5) * 0.12;
  const greyK = (id: number) => (rand(id, 2) < 0.3 ? 0.55 : 0);
  const crackSeed = seed * 7 + 3;
  const rows = kind === 'flag' ? bondRows(S, 6, S * 0.14, S * 0.3, rnd) : kind === 'slab' ? bondRows(S, 3, S * 0.3, S * 0.52, rnd) : [];

  return (y0, y1) => {
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      const fine = fineN(u, v);
      const mid = midN(u, v);
      let stone = 0, edge = 0, id = 0, joint = 0;
      if (kind === 'flag' || kind === 'slab') {
        let ri = 0;
        while (ri < rows.length - 1 && y >= rows[ri].y1) ri++;
        const row = rows[ri];
        const xr = (x - row.off + S * 2) % S;
        let k = 0;
        while (k < row.cuts.length - 2 && xr >= row.cuts[k + 1]) k++;
        const dx = Math.min(xr - row.cuts[k], row.cuts[k + 1] - xr);
        const dy = Math.min(y - row.y0, row.y1 - y);
        // Chipped, uneven edges.
        const chip = (chipN(u, v) - 0.5) * (kind === 'flag' ? S * 0.01 : S * 0.004);
        const d = Math.min(dx, dy) + chip;
        id = ri * 31 + k * 7 + 1;
        const gw = kind === 'flag' ? S * 0.0038 : S * 0.0022;
        const bev = kind === 'flag' ? S * 0.009 : S * 0.004;
        stone = sstep(gw, gw + bev, d);
        edge = 1 - sstep(gw + bev, gw + bev * 3, d);
        joint = 1 - stone;
      } else if (kind === 'cobble') {
        worley(u, v, 13, seed + 41, 0.85, w);
        const d = w.f2 - w.f1;
        id = Math.floor(w.id * 9973) + 1;
        stone = sstep(0.05, 0.2, d + (fine - 0.5) * 0.06);
        // Domed setts.
        stone *= Math.sqrt(clamp01(1 - w.f1 * w.f1 * 0.9));
        edge = 1 - sstep(0.2, 0.42, d);
        joint = 1 - sstep(0.02, 0.12, d);
      } else {
        // Packed earth with pebbles.
        worley(u, v, 34, seed + 51, 1, w);
        const peb = sstep(0.32, 0.12, w.f1) * (w.id > 0.55 ? 1 : 0);
        stone = peb;
        id = Math.floor(w.id * 977) + 1;
        edge = 0;
        joint = 0;
      }
      // Height: stone tops with slight per-stone tilt and fine pitting; grout below.
      const tilt = kind === 'earth' ? 0 : (shade(id + 5) - 0.99) * 0.25;
      let h = kind === 'earth' ? mid * 0.35 + stone * 0.35 + fine * 0.08 : stone * (0.82 + tilt) + fine * 0.05 + mid * 0.04;
      // A few cracked stones.
      if (kind !== 'earth' && shade(id + 13) > 1.1) {
        const cr = Math.abs(pfbm(u, v, 22, 3, crackSeed + id) - 0.5);
        const crack = 1 - sstep(0.004, 0.018, cr);
        h -= crack * 0.25 * stone;
        joint = Math.max(joint, crack * 0.8 * stone);
      }
      L.h[i] = h;
      // Colour: per-stone shade and warmth, speckle, grime in joints, wear polish on the tops.
      const s = kind === 'earth' ? 0.92 + mid * 0.18 : shade(id);
      const wv = kind === 'earth' ? (mid - 0.5) * 0.06 : warm(id);
      // Stone grain: mottling across each stone and a fine speckle.
      const grain = grainN(u, v);
      const tex = (0.86 + mid * 0.2) * (0.92 + fine * 0.12) * (0.94 + grain * 0.12);
      let r = br * s * (1 + wv) * tex;
      let g = bg * s * tex;
      let b = bb * s * (1 - wv) * tex;
      if (kind === 'earth') {
        // Pebbles a little paler and greyer than the soil.
        const pk = stone * 0.6;
        r = r * (1 - pk) + br * 1.15 * pk;
        g = g * (1 - pk) + bg * 1.12 * pk;
        b = b * (1 - pk) + bb * 1.2 * pk;
      }
      // Some stones greyer, some warmer.
      if (kind !== 'earth') {
        const gk2 = greyK(id), lum = (r + g + b) / 3;
        r += (lum - r) * gk2;
        g += (lum - g) * gk2;
        b += (lum - b) * gk2;
      }
      // Joints filled with sand and grit (darker and duller than the stone, never black);
      // a little grime along the edges and in the low patches.
      const grime = clamp01(edge * 0.22 + (1 - mid) * 0.1);
      const gk = 1 - grime * 0.45;
      r *= gk;
      g *= gk;
      b *= gk;
      if (joint > 0) {
        const jr = br * 0.6 * (0.85 + fine * 0.3), jg = bg * 0.56 * (0.85 + fine * 0.3), jb = bb * 0.5 * (0.85 + fine * 0.3);
        r = r * (1 - joint) + jr * joint;
        g = g * (1 - joint) + jg * joint;
        b = b * (1 - joint) + jb * joint;
      }
      // Moss in old joints.
      if (moss > 0 && joint > 0.4) {
        const m = clamp01((mossN(u, v) - 0.45) * 4) * moss * joint;
        r = r * (1 - m) + 0.18 * m;
        g = g * (1 - m) + 0.26 * m;
        b = b * (1 - m) + 0.1 * m;
      }
      L.r[i] = r;
      L.g[i] = g;
      L.b[i] = b;
      const polish = kind === 'slab' ? 0.55 : kind === 'flag' ? 0.74 : kind === 'cobble' ? 0.7 : 0.93;
      L.rough[i] = clamp01(polish + (1 - stone) * 0.25 + joint * 0.1 + (fine - 0.5) * 0.12 + grime * 0.08);
    }
  }
  };
}

function toTexture(S: number, data: Uint8Array, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const SRGB = new Uint8Array(4096);
for (let i = 0; i < 4096; i++) SRGB[i] = Math.round(Math.pow(i / 4095, 1 / 2.2) * 255);
const srgb = (c: number) => SRGB[Math.round(clamp01(c) * 4095)];

/** Encode rows [y0, y1) of albedo (+ roughness in alpha). */
function encodeAlbedo(L: Layers, out: Uint8Array, y0: number, y1: number): void {
  const S = L.S;
  for (let i = y0 * S; i < y1 * S; i++) {
    const o = i * 4;
    out[o] = srgb(L.r[i]);
    out[o + 1] = srgb(L.g[i]);
    out[o + 2] = srgb(L.b[i]);
    out[o + 3] = Math.round(clamp01(L.rough[i]) * 255);
  }
}

/** Encode rows [y0, y1) of the half-resolution normal map from the height field (wrapping). */
function encodeNormals(L: Layers, kind: PavingKind, out: Uint8Array, y0: number, y1: number): void {
  const S = L.S, N = S >> 1;
  const strength = (kind === 'slab' ? 2.2 : kind === 'earth' ? 3.0 : 4.2) * 0.5 * (S / 512);
  const H = (x: number, y: number) => L.h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < N; x++) {
      const sx = x * 2, sy = y * 2;
      const hx = H(sx + 1, sy) + H(sx + 1, sy + 1) - H(sx - 1, sy) - H(sx - 1, sy + 1);
      const hy = H(sx, sy + 1) + H(sx + 1, sy + 1) - H(sx, sy - 1) - H(sx + 1, sy - 1);
      const nx = -hx * strength, ny = -hy * strength;
      const l = Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * N + x) * 4;
      out[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
}

interface PavingSetInternal extends PavingSet {
  users: Set<THREE.MeshStandardMaterial>;
}

/** Build a set synchronously (small sizes: the first, instant look). */
function buildNow(kind: PavingKind, base: string, seed: number, S: number, moss: number): { map: THREE.DataTexture; normalMap: THREE.DataTexture } {
  const L = layers(S);
  painter(L, kind, base, seed, moss)(0, S);
  const alb = new Uint8Array(S * S * 4);
  encodeAlbedo(L, alb, 0, S);
  const N = S >> 1;
  const nrm = new Uint8Array(N * N * 4);
  encodeNormals(L, kind, nrm, 0, N);
  return { map: toTexture(S, alb, true), normalMap: toTexture(N, nrm, false) };
}

// Full-resolution sets are generated a few rows at a time between frames (6 ms slices) so a city
// streaming in never stalls the game; materials swap to them when they are done.
interface Job {
  set: PavingSetInternal;
  kind: PavingKind;
  L: Layers;
  paint: (y0: number, y1: number) => void;
  phase: 0 | 1 | 2;
  y: number;
  alb: Uint8Array;
  nrm: Uint8Array;
}
const jobs: Job[] = [];
let pumping = false;

function pump(): void {
  const t0 = performance.now();
  while (jobs.length && performance.now() - t0 < 6) {
    const j = jobs[0];
    const S = j.L.S;
    if (j.phase === 0) {
      const y1 = Math.min(S, j.y + 8);
      j.paint(j.y, y1);
      j.y = y1;
      if (j.y >= S) {
        j.phase = 1;
        j.y = 0;
      }
    } else if (j.phase === 1) {
      const y1 = Math.min(S, j.y + 64);
      encodeAlbedo(j.L, j.alb, j.y, y1);
      j.y = y1;
      if (j.y >= S) {
        j.phase = 2;
        j.y = 0;
      }
    } else {
      const N = S >> 1;
      const y1 = Math.min(N, j.y + 64);
      encodeNormals(j.L, j.kind, j.nrm, j.y, y1);
      j.y = y1;
      if (j.y >= N) {
        jobs.shift();
        const old = [j.set.map, j.set.normalMap];
        j.set.map = toTexture(S, j.alb, true);
        j.set.normalMap = toTexture(N, j.nrm, false);
        for (const m of j.set.users) {
          m.map = j.set.map;
          if (!m.userData.pavFlat) m.normalMap = j.set.normalMap;
        }
        for (const t of old) t.dispose();
      }
    }
  }
  if (jobs.length) setTimeout(pump, 0);
  else pumping = false;
}

/** Full-resolution jobs still running (tests / debug). */
export function pavingPending(): number {
  return jobs.length;
}

/**
 * Textures for a paving kind in a base colour (cached for the app's life). Returns at once with a
 * 128² version; larger sizes are generated progressively and swapped into every material made
 * from the set (pavingMaterial).
 */
export function pavingSet(kind: PavingKind, base: string, seed = 1, size = 512, moss = 0): PavingSet {
  const key = `${kind}:${base}:${seed}:${size}:${moss}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const first = Math.min(size, 128);
  const now = buildNow(kind, base, seed, first, moss);
  const set: PavingSetInternal = { map: now.map, normalMap: now.normalMap, tile: TILE[kind], users: new Set() };
  cache.set(key, set);
  if (size > first) {
    const L = layers(size);
    jobs.push({ set, kind, L, paint: painter(L, kind, base, seed, moss), phase: 0, y: 0, alb: new Uint8Array(size * size * 4), nrm: new Uint8Array((size >> 1) * (size >> 1) * 4) });
    if (!pumping) {
      pumping = true;
      setTimeout(pump, 0);
    }
  }
  return set;
}

/**
 * Ground material for a paving set, mapped in world space (x/z) so stones keep their real size on
 * any mesh, with a large-scale tone variation that hides the repeat. Polygon offset keeps planar
 * paving above the terrain.
 */
export function pavingMaterial(set: PavingSet, o: { tint?: string; offset?: number; normal?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    color: o.tint ?? '#ffffff',
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(o.normal ?? 1, o.normal ?? 1),
  });
  (set as PavingSetInternal).users?.add(m);
  m.addEventListener('dispose', () => {
    for (const c of cache.values()) c.users.delete(m);
  });
  const off = o.offset ?? -2;
  m.polygonOffset = true;
  m.polygonOffsetFactor = off;
  m.polygonOffsetUnits = off * 2;
  const tile = set.tile;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPavTile = { value: 1 / tile };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uPavTile;\nvarying vec3 vPavWorld;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
vec4 pavW = modelMatrix * vec4(position, 1.0);
#ifdef USE_INSTANCING
pavW = modelMatrix * instanceMatrix * vec4(position, 1.0);
#endif
vPavWorld = pavW.xyz;
vec2 pavUv = pavW.xz * uPavTile;
#ifdef USE_MAP
vMapUv = pavUv;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv = pavUv;
#endif
`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPavWorld;\nfloat pavHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat pavNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(pavHash(i), pavHash(i + vec2(1.0, 0.0)), u.x), mix(pavHash(i + vec2(0.0, 1.0)), pavHash(i + vec2(1.0, 1.0)), u.x), u.y); }')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
// Large-scale tone: sun-bleached and dirtier stretches, so the tile never visibly repeats.
float pavMacro = pavNoise(vPavWorld.xz * 0.045) * 0.6 + pavNoise(vPavWorld.xz * 0.17 + 7.3) * 0.4;
diffuseColor.rgb *= 0.88 + 0.24 * pavMacro;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
// Roughness lives in the albedo's alpha: polished stone tops, gritty joints.
roughnessFactor = clamp(sampledDiffuseColor.a, 0.05, 1.0);`,
      );
  };
  m.customProgramCacheKey = () => 'paving_world_uv';
  return m;
}

/**
 * Move a paving material onto another set of the same kind (a different resolution after a
 * graphics change): it shows that set's textures now and follows its progressive upgrade.
 */
export function repave(m: THREE.MeshStandardMaterial, set: PavingSet, relief = true): void {
  for (const c of cache.values()) c.users.delete(m);
  (set as PavingSetInternal).users?.add(m);
  m.map = set.map;
  setPavingRelief(m, relief, set);
}

/**
 * Stone relief (the normal map) on or off: the cheapest paving keeps its painted shading only
 * (low-end settings). Toggling it recompiles the material once.
 */
export function setPavingRelief(m: THREE.MeshStandardMaterial, on: boolean, set?: PavingSet): void {
  m.userData.pavFlat = !on;
  const want = on ? (set?.normalMap ?? [...cache.values()].find((c) => c.users.has(m))?.normalMap ?? null) : null;
  if ((m.normalMap === null) !== (want === null)) m.needsUpdate = true;
  m.normalMap = want;
}
