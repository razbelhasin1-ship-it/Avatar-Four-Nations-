import * as THREE from 'three';
import type { GameContext } from '../../../../core/GameContext';
import { Random } from '../../../../core/Random';
import { defaultAnim } from '../../../../companions/models/CreatureModel';
import { SkyBisonModel } from '../../../../companions/models/SkyBison';
import type { Collider } from '../../../Collision';
import { BASE, C, COUNTS, SEED, TOWER, floorY, polar, shelf, yawOut } from './layout';
import { SPIRES } from './spires';

/**
 * The temple's sky bison: flocks circling the pinnacle at three heights, far herds as silhouettes,
 * bison taking off from and landing on the two ledges of the bison terrace, grazing, resting and
 * sleeping on it, calves that cannot fly yet, riders and hay cargo on some, and the whistle that
 * calls one down to a ledge.
 *
 * Rendering: the real bison model (companions/models/SkyBison) is baked once into a vertex
 * animation texture — a 12-frame flight cycle (two tail strokes, legs paddling), an 8-frame walk,
 * stand, graze and rest — and the ~15 bison nearest the camera are drawn with it as one instanced
 * mesh (the GPU plays the frames). Every other bison uses a light primitive bison with the same
 * proportions, colours and arrow, animated in its vertex shader. Far herds update a quarter as often.
 */

type Clip = 'fly' | 'walk' | 'stand' | 'graze' | 'rest';
const CLIPS: Array<[Clip, number]> = [['fly', 12], ['walk', 8], ['stand', 1], ['graze', 1], ['rest', 1]];
const VAT_W = 1024;
const LEG_IDS = ['FL', 'FR', 'ML', 'MR', 'BL', 'BR'];
const LEG_PHASE: Record<string, number> = { FL: 0, ML: (2 * Math.PI) / 3, BL: (4 * Math.PI) / 3, FR: Math.PI, MR: Math.PI + (2 * Math.PI) / 3, BR: Math.PI + (4 * Math.PI) / 3 };

// ---------------------------------------------------------------------------
// Vertex animation texture (baked from the real model)
// ---------------------------------------------------------------------------

interface Vat {
  geometry: THREE.BufferGeometry;
  pos: THREE.DataTexture;
  nor: THREE.DataTexture;
  rows: number;
  first: Record<Clip, number>;
}

function bakeBison(detail: number): Vat {
  const model = new SkyBisonModel(0, detail);
  const mesh = model.mesh;
  const src = mesh.geometry;
  const V = src.getAttribute('position').count;
  const rows = Math.ceil(V / VAT_W);
  const F = CLIPS.reduce((s, c) => s + c[1], 0);
  const pos = new Float32Array(VAT_W * rows * F * 4);
  const nor = new Uint8Array(VAT_W * rows * F * 4);
  const work = new THREE.BufferGeometry();
  const wpos = new Float32Array(V * 3);
  work.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
  if (src.index) work.setIndex(src.index.clone());
  const tmp = new THREE.Vector3();
  const a = defaultAnim();
  let frame = 0;
  const first = {} as Record<Clip, number>;
  const capture = () => {
    model.root.updateMatrixWorld(true);
    for (let i = 0; i < V; i++) {
      mesh.getVertexPosition(i, tmp);
      wpos[i * 3] = tmp.x;
      wpos[i * 3 + 1] = tmp.y;
      wpos[i * 3 + 2] = tmp.z;
    }
    (work.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    work.computeVertexNormals();
    const n = work.getAttribute('normal');
    const base = frame * rows * VAT_W;
    for (let i = 0; i < V; i++) {
      const o = (base + i) * 4;
      pos[o] = wpos[i * 3];
      pos[o + 1] = wpos[i * 3 + 1];
      pos[o + 2] = wpos[i * 3 + 2];
      pos[o + 3] = 1;
      nor[o] = Math.round((n.getX(i) * 0.5 + 0.5) * 255);
      nor[o + 1] = Math.round((n.getY(i) * 0.5 + 0.5) * 255);
      nor[o + 2] = Math.round((n.getZ(i) * 0.5 + 0.5) * 255);
      nor[o + 3] = 255;
    }
    frame++;
  };
  const run = (secs: number, dt: number) => {
    for (let t = 0; t < secs; t += dt) {
      a.dt = dt;
      a.time += dt;
      model.update(a);
    }
  };
  const legs = (psi: number) => {
    for (const id of LEG_IDS) {
      const thigh = mesh.skeleton.getBoneByName(`thigh${id}`), shin = mesh.skeleton.getBoneByName(`shin${id}`);
      if (!thigh || !shin) continue;
      const sx = id[1] === 'L' ? 1 : -1;
      const paddle = Math.sin(psi + LEG_PHASE[id] * 0.5) * 0.35;
      thigh.rotation.set(paddle + (id[0] === 'F' ? -0.25 : id[0] === 'B' ? 0.35 : 0), 0, 0.12 * sx * (id[0] === 'M' ? 1.6 : 1));
      shin.rotation.set(0.5 + 0.25 * Math.sin(psi + LEG_PHASE[id]), 0, 0);
    }
  };
  // Flight: two tail strokes over 12 frames (the model strokes at 0.9 Hz), legs paddling once.
  Object.assign(a, { flying: true, grounded: false, speed: 10, vy: 0, action: 'none' });
  run(4, 0.05);
  const n = CLIPS[0][1];
  const fdt = 2 / (0.9 * n);
  first.fly = frame;
  for (let k = 0; k < n; k++) {
    a.dt = fdt;
    a.time += fdt;
    model.update(a);
    legs(((k + 1) / n) * Math.PI * 2);
    capture();
  }
  // Walk: one gait cycle (stride 2.4 m at 1.3 m/s) over 8 frames.
  Object.assign(a, { flying: false, grounded: true, speed: 1.3, action: 'none' });
  run(3, 0.05);
  first.walk = frame;
  const wdt = 2.4 / 1.3 / CLIPS[1][1];
  for (let k = 0; k < CLIPS[1][1]; k++) {
    a.dt = wdt;
    a.time += wdt;
    model.update(a);
    capture();
  }
  a.speed = 0;
  run(2.5, 0.05);
  first.stand = frame;
  capture();
  a.action = 'graze';
  run(2.5, 0.05);
  first.graze = frame;
  capture();
  a.action = 'rest';
  run(4, 0.05);
  first.rest = frame;
  capture();
  const ptex = new THREE.DataTexture(pos, VAT_W, rows * F, THREE.RGBAFormat, THREE.FloatType);
  const ntex = new THREE.DataTexture(nor, VAT_W, rows * F, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const t of [ptex, ntex]) {
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', (src.getAttribute('position') as THREE.BufferAttribute).clone());
  g.setAttribute('color', (src.getAttribute('color') as THREE.BufferAttribute).clone());
  if (src.index) g.setIndex(src.index.clone());
  g.computeBoundingSphere();
  work.dispose();
  return { geometry: g, pos: ptex, nor: ntex, rows, first };
}

function vatMaterial(vat: Vat): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  m.name = 'sat_bison_vat';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uVatPos = { value: vat.pos };
    sh.uniforms.uVatNor = { value: vat.nor };
    sh.uniforms.uVatRows = { value: vat.rows };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2D uVatPos;
uniform sampler2D uVatNor;
uniform float uVatRows;
attribute vec3 aAnim;
vec3 vatAt(highp sampler2D t, float f) {
  int id = gl_VertexID;
  ivec2 c = ivec2(id % ${VAT_W}, id / ${VAT_W} + int(f) * int(uVatRows));
  return texelFetch(t, c, 0).xyz;
}`,
      )
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(mix(vatAt(uVatNor, aAnim.x), vatAt(uVatNor, aAnim.y), aAnim.z) * 2.0 - 1.0);')
      .replace('#include <begin_vertex>', 'vec3 transformed = mix(vatAt(uVatPos, aAnim.x), vatAt(uVatPos, aAnim.y), aAnim.z);');
  };
  m.customProgramCacheKey = () => 'sat_bison_vat';
  return m;
}

// ---------------------------------------------------------------------------
// Far bison (primitives, animated in the vertex shader)
// ---------------------------------------------------------------------------

function farBisonGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: string, part: number) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    const c = new THREE.Color(col), cnt = n.getAttribute('position').count;
    const nrm = n.getAttribute('normal');
    const cols = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      const shade = 1 - 0.22 * Math.max(0, -nrm.getY(i));
      cols[i * 3] = c.r * shade;
      cols[i * 3 + 1] = c.g * shade;
      cols[i * 3 + 2] = c.b * shade;
    }
    n.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    n.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(cnt).fill(part), 1));
    parts.push(n);
  };
  const ell = (sx: number, sy: number, sz: number, x: number, y: number, z: number, seg = 12) => new THREE.SphereGeometry(1, seg, Math.max(6, seg - 4)).scale(sx, sy, sz).translate(x, y, z);
  const fur = '#f2efe8', dark = '#3a312b', arrow = '#7c4e2c', ivory = '#e6dcc4';
  add(ell(1.85, 1.25, 2.45, 0, 2.05, -0.1, 14), fur, 0);
  add(ell(1.72, 1.1, 1.4, 0, 2.35, 0.95), fur, 0);
  add(ell(1.05, 0.78, 0.95, 0, 2.2, 2.75), fur, 0);
  add(ell(0.55, 0.3, 0.26, 0, 1.92, 3.68, 8), dark, 0);
  for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.11, 0.48, 6).rotateZ(-s * 0.7).translate(s * 0.62, 2.88, 2.95), ivory, 0);
  add(ell(0.85, 0.52, 0.95, 0, 2.05, -2.45, 10), fur, 1);
  add(ell(1.35, 0.18, 1.05, 0, 2.12, -3.7, 12), fur, 1);
  const legs: Array<[number, number]> = [[1.2, 1.45], [-1.2, 1.45], [1.2, 0], [-1.2, 0], [1.2, -1.45], [-1.2, -1.45]];
  legs.forEach(([x, z], i) => {
    add(new THREE.CylinderGeometry(0.42, 0.48, 1.3, 8).translate(x, 0.85, z), fur, 2 + i);
    add(new THREE.CylinderGeometry(0.46, 0.46, 0.14, 8).translate(x, 0.2, z), dark, 2 + i);
  });
  // The arrow: a head on the forehead pointing at the nose, the shaft over the crown, back and tail.
  const spine: Array<[number, number]> = [[3.1, 2.98], [2.4, 3.05], [1.5, 3.42], [0.4, 3.32], [-0.8, 3.24], [-1.9, 2.98], [-2.7, 2.6], [-3.4, 2.34], [-4.4, 2.32]];
  for (let i = 0; i < spine.length - 1; i++) {
    const [z0, y0] = spine[i], [z1, y1] = spine[i + 1];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const g = new THREE.BoxGeometry(i >= 6 ? 0.55 : 0.4, 0.06, len + 0.05);
    g.rotateX(-Math.atan2(y1 - y0, z1 - z0));
    g.translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
    add(g, arrow, (z0 + z1) / 2 < -2.3 ? 1 : 0);
  }
  const head = new THREE.BufferGeometry();
  head.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 2.98, 2.9, 0.5, 2.98, 2.9, 0, 2.86, 3.45], 3));
  head.computeVertexNormals();
  add(head, arrow, 0);
  // Concatenate.
  let total = 0;
  for (const p of parts) total += p.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  for (const [nm, size] of [['position', 3], ['normal', 3], ['color', 3], ['aPart', 1]] as const) {
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const p of parts) {
      arr.set(p.getAttribute(nm).array as Float32Array, o);
      o += p.getAttribute(nm).array.length;
    }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, size));
  }
  for (const p of parts) p.dispose();
  out.computeBoundingSphere();
  return out;
}

function farMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.name = 'sat_bison_far';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aPart;
attribute vec4 aMove;
const vec3 HIPS[6] = vec3[6](vec3(1.2, 1.5, 1.45), vec3(-1.2, 1.5, 1.45), vec3(1.2, 1.5, 0.0), vec3(-1.2, 1.5, 0.0), vec3(1.2, 1.5, -1.45), vec3(-1.2, 1.5, -1.45));
vec3 rotX(vec3 p, vec3 pv, float a) {
  vec3 q = p - pv;
  float c = cos(a), s = sin(a);
  return pv + vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
float ph = aMove.x, fly = aMove.y, walk = aMove.z, rest = aMove.w;
if (aPart > 0.5 && aPart < 1.5) transformed = rotX(transformed, vec3(0.0, 2.05, -2.1), sin(ph) * 0.34 * fly + (0.1 + 0.25 * rest) * (1.0 - fly));
if (aPart > 1.5) {
  int li = int(aPart + 0.5) - 2;
  float off = float(li) * 1.0472;
  float sw = sin(ph * 0.5 + off) * 0.35 * fly + sin(ph + off) * 0.38 * walk;
  transformed = rotX(transformed, HIPS[li], sw + (li < 2 ? -0.25 : li > 3 ? 0.35 : 0.0) * fly);
  transformed.y += 0.55 * rest;
  transformed.x += sign(transformed.x) * 0.35 * rest;
}
transformed.y += sin(ph + 0.6) * 0.12 * fly - 1.05 * rest;`,
      );
  };
  m.customProgramCacheKey = () => 'sat_bison_far';
  return m;
}

/** A seated monk (rider) and a hay cargo on a saddle platform, in bison-local space. */
function riderGeometry(): THREE.BufferGeometry {
  return mergeColored([
    [new THREE.CylinderGeometry(0.22, 0.42, 0.75, 8).translate(0, 3.85, 2.05), '#d9902a'],
    [new THREE.SphereGeometry(0.3, 8, 6).scale(1.2, 0.5, 1.1).translate(0, 3.52, 2.15), '#a8441c'],
    [new THREE.SphereGeometry(0.17, 10, 8).translate(0, 4.38, 2.08), '#c9935f'],
    [new THREE.BoxGeometry(0.06, 0.06, 1.4).translate(0, 3.7, 2.75), '#5a3a1e'],
  ]);
}
function cargoGeometry(): THREE.BufferGeometry {
  return mergeColored([
    [new THREE.BoxGeometry(2.6, 0.14, 3.0).translate(0, 3.42, -0.35), '#7a3b22'],
    [new THREE.BoxGeometry(2.7, 0.3, 0.12).translate(0, 3.62, 1.12), '#5a2a14'],
    [new THREE.BoxGeometry(2.7, 0.3, 0.12).translate(0, 3.62, -1.82), '#5a2a14'],
    [new THREE.BoxGeometry(1.0, 0.6, 1.3).translate(-0.62, 3.8, -0.35), '#d8bf6a'],
    [new THREE.BoxGeometry(1.0, 0.6, 1.3).translate(0.62, 3.8, -0.35), '#cdb35e'],
    [new THREE.BoxGeometry(1.0, 0.55, 1.2).translate(0, 4.36, -0.3), '#dcc675'],
  ]);
}
function mergeColored(list: Array<[THREE.BufferGeometry, string]>): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const [g0, c] of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const cc = new THREE.Color(c);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(cc.r, cc.g, cc.b);
    }
    g.dispose();
    if (g !== g0) g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

type State = 'ground' | 'walkOut' | 'takeoff' | 'cruise' | 'approach' | 'land' | 'waiting';

interface Flock {
  r: number;
  y: number;
  speed: number;
  dir: number;
  ang: number;
  cx: number;
  cz: number;
  far: boolean;
  wob: number;
}

interface Agent {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  bank: number;
  state: State;
  t: number;
  dur: number;
  flock: number;
  slot: THREE.Vector3;
  spot: number;
  ledge: number;
  target: THREE.Vector3;
  calf: boolean;
  scale: number;
  rider: boolean;
  cargo: boolean;
  clip: Clip;
  act: 'stand' | 'graze' | 'rest';
  actT: number;
  phase: number;
  col: number | null;
  called: boolean;
  home: THREE.Vector3;
  /** Belongs to a far herd for good (others only roost with the far herds at night). */
  farHome: boolean;
}

/** Does a collider (other than the floor at height `floor`) cover a circle of radius `rad` at (x, z)? */
function blocks(c: Collider, x: number, z: number, rad: number, floor: number): boolean {
  if (c.y + c.hy < floor + 0.35 || c.y - c.hy > floor + 4) return false;
  if (c.shape === 'box') {
    const dx = x - c.x, dz = z - c.z;
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const qx = Math.max(0, Math.abs(lx) - c.hx), qz = Math.max(0, Math.abs(lz) - c.hz);
    return qx * qx + qz * qz < rad * rad;
  }
  return Math.hypot(x - c.x, z - c.z) < rad + c.r;
}

/**
 * Free resting places on the bison terrace for bodies lying along the terrace (tangential), found
 * against the colliders actually built there (loggia, pond, troughs, hay, tower, caves), clear of
 * the road; `n` places at least `gap` apart inside the bearing range.
 */
function findSpots(ctx: GameContext, n: number, a0: number, a1: number, rMin: number, rMax: number, half: number, rad: number, gap: number, avoid: THREE.Vector3[]): Array<{ p: THREE.Vector3; yaw: number }> {
  const y = floorY(18);
  const out: Array<{ p: THREE.Vector3; yaw: number }> = [];
  for (let r = rMax; r >= rMin && out.length < n; r -= 1.5) {
    for (let a = a0; a <= a1 && out.length < n; a += 1.5) {
      const p = polar(a, r);
      if (out.some((o) => Math.hypot(o.p.x - p.x, o.p.z - p.z) < gap) || avoid.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < gap * 0.75 + 3)) continue;
      const yaw = yawOut(a + 90);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      let free = true;
      for (const t of [-half, 0, half]) {
        const cx = p.x + fx * t, cz = p.z + fz * t;
        ctx.world.collision.query(cx, cz, rad + 6, (c) => {
          if (free && blocks(c, cx, cz, rad, y)) free = false;
        });
        if (!free) break;
      }
      if (free) out.push({ p: new THREE.Vector3(p.x, y, p.z), yaw });
    }
  }
  return out;
}

function ledgePoint(i: number, out: number): THREE.Vector3 {
  const s = shelf(i === 0 ? 'landing_main' : 'landing_ne');
  const p = polar(s.a, s.r0 + (s.r1 - s.r0) * out);
  return new THREE.Vector3(p.x, floorY(s.y), p.z);
}

interface Obstacle {
  x: number;
  z: number;
  r: number;
  top: number;
}

export interface HerdStats {
  total: number;
  flying: number;
  grounded: number;
  calves: number;
  near: number;
  riders: number;
  spots: number;
}

export class Herd {
  readonly group = new THREE.Group();
  private agents: Agent[] = [];
  private flocks: Flock[] = [];
  private spots: Array<{ p: THREE.Vector3; yaw: number }> = [];
  private taken: number[] = [];
  private obstacles: Obstacle[] = [];
  private near: THREE.InstancedMesh;
  private far: THREE.InstancedMesh;
  private riders: THREE.InstancedMesh;
  private cargo: THREE.InstancedMesh;
  private nearAnim: THREE.InstancedBufferAttribute;
  private farMove: THREE.InstancedBufferAttribute;
  private readonly rnd = new Random(SEED + 909);
  private frame = 0;
  /** Landing lanes of the two ledges: free from this time on, and held by a called bison. */
  private laneFree = [0, 0];
  private laneHold: Array<Agent | null> = [null, null];
  /** Bison on their way down (approaching or landing), counted each frame. */
  private inbound = 0;
  private time = 0;
  private ctx: GameContext | null = null;
  private readonly owned: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  private stats: HerdStats = { total: 0, flying: 0, grounded: 0, calves: 0, near: 0, riders: 0, spots: 0 };
  // Scratch (no per-frame allocation).
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly sc = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private order: number[] = [];
  private dist: Float32Array;

  constructor(ctx: GameContext, quality: 'low' | 'medium' | 'high') {
    const adults = quality === 'low' ? 26 : quality === 'medium' ? 38 : COUNTS.bison;
    const calves = quality === 'low' ? 3 : 4;
    const nearMax = quality === 'low' ? 8 : COUNTS.nearBison;
    const vat = bakeBison(0.5);
    const vm = vatMaterial(vat);
    const fg = farBisonGeometry(), fm = farMaterial();
    const rg = riderGeometry(), cg = cargoGeometry();
    const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.owned.push(vat.geometry, vat.pos, vat.nor, vm, fg, fm, rg, cg, plain);
    const total = adults + calves;
    this.near = new THREE.InstancedMesh(vat.geometry, vm, nearMax);
    this.nearAnim = new THREE.InstancedBufferAttribute(new Float32Array(nearMax * 3), 3);
    this.nearAnim.setUsage(THREE.DynamicDrawUsage);
    vat.geometry.setAttribute('aAnim', this.nearAnim);
    this.far = new THREE.InstancedMesh(fg, fm, total);
    this.farMove = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
    this.farMove.setUsage(THREE.DynamicDrawUsage);
    fg.setAttribute('aMove', this.farMove);
    this.riders = new THREE.InstancedMesh(rg, plain, total);
    this.cargo = new THREE.InstancedMesh(cg, plain, total);
    for (const im of [this.near, this.far, this.riders, this.cargo]) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      this.group.add(im);
    }
    this.near.name = 'sat_bison_near';
    this.far.name = 'sat_bison_far';
    this.group.name = 'sat_herd';
    this.vatFirst = vat.first;
    // Flight corridors: three loops round the pinnacle, two far herds.
    this.flocks = [
      { r: 136, y: BASE + 66, speed: 9.5, dir: 1, ang: 0, cx: C.x, cz: C.z, far: false, wob: 0.3 },
      { r: 192, y: BASE + 104, speed: 10.5, dir: -1, ang: 2, cx: C.x, cz: C.z, far: false, wob: 1.7 },
      { r: 300, y: BASE + 168, speed: 12, dir: 1, ang: 4, cx: C.x, cz: C.z, far: false, wob: 2.9 },
      { r: 620, y: BASE + 140, speed: 13, dir: -1, ang: 1, cx: C.x - 80, cz: C.z + 60, far: true, wob: 4.1 },
      { r: 820, y: BASE + 200, speed: 13.5, dir: 1, ang: 3.4, cx: C.x + 120, cz: C.z - 90, far: true, wob: 5.3 },
    ];
    for (const [deg, d, r, topY] of SPIRES) {
      const p = polar(deg, d);
      this.obstacles.push({ x: p.x, z: p.z, r: r * 1.35 + 16, top: topY + 25 });
    }
    this.obstacles.push({ x: C.x, z: C.z, r: 112, top: BASE + 118 }, { x: C.x, z: C.z, r: 22, top: BASE + 110 + TOWER.h + 30 });
    const o = polar(160, 117);
    this.obstacles.push({ x: o.x, z: o.z, r: 16, top: BASE + 14 });
    // Agents.
    // Resting places on the bison terrace, found against what is built there: calves by the hay
    // yard, adults along the terrace (bodies lying along it, clear of the road).
    const calfSpots = findSpots(ctx, calves, 272, 300, 70, 78, 0.9, 0.95, 4.4, []);
    this.spots = findSpots(ctx, 14, 263, 337, 65.5, 77.6, 2.8, 1.95, 9.2, calfSpots.map((c) => c.p));
    // The landing ledges hold two resting bison each (clear of their landing lane in the middle).
    for (const i of [0, 1]) {
      const s = shelf(i === 0 ? 'landing_main' : 'landing_ne');
      for (const u of [-1, 1]) {
        const c = polar(s.a + (u * (s.w / 2 - 3.2)) / ((s.r0 + s.r1) / 2) / (Math.PI / 180), s.r0 + (s.r1 - s.r0) * 0.6);
        this.spots.push({ p: new THREE.Vector3(c.x, floorY(s.y), c.z), yaw: yawOut(s.a) });
      }
    }
    this.stats.spots = this.spots.length;
    const grounded = Math.min(this.spots.length, Math.round(adults * 0.26));
    for (let i = 0; i < total; i++) {
      const calf = i >= adults;
      const a: Agent = {
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, bank: 0, state: 'cruise', t: 0, dur: 0,
        flock: 0, slot: new THREE.Vector3(), spot: -1, ledge: 0, target: new THREE.Vector3(),
        calf, scale: calf ? this.rnd.range(0.4, 0.48) : this.rnd.range(0.92, 1.08), rider: false, cargo: false,
        clip: 'fly', act: 'stand', actT: 0, phase: this.rnd.range(0, 12), col: null, called: false, home: new THREE.Vector3(), farHome: false,
      };
      if (calf) {
        const cs = calfSpots[i - adults] ?? calfSpots[0] ?? { p: new THREE.Vector3(polar(284, 74).x, floorY(18), polar(284, 74).z), yaw: 0 };
        a.home.copy(cs.p);
        a.pos.copy(a.home);
        a.state = 'ground';
        a.yaw = this.rnd.range(0, 6.28);
        a.act = 'graze';
        a.dur = 1e9;
      } else if (i < grounded) {
        this.ground(a, i);
        a.dur = this.rnd.range(20, 160);
      } else {
        const f = i % 7 < 2 ? 0 : i % 7 < 4 ? 1 : i % 7 < 5 ? 2 : i % 7 < 6 ? 3 : 4;
        a.flock = f;
        const fl = this.flocks[f];
        a.slot.set(this.rnd.range(-1, 1) * (fl.far ? 40 : 22), this.rnd.range(-1, 1) * (fl.far ? 18 : 9), this.rnd.range(-1, 1) * (fl.far ? 40 : 22));
        const ang = fl.ang + this.rnd.range(-0.5, 0.5);
        a.pos.set(fl.cx + Math.cos(ang) * fl.r, fl.y, fl.cz + Math.sin(ang) * fl.r).add(a.slot);
        a.vel.set(-Math.sin(ang) * fl.dir, 0, Math.cos(ang) * fl.dir).multiplyScalar(fl.speed);
        a.state = 'cruise';
        a.dur = this.rnd.range(30, 140);
        a.farHome = fl.far;
        a.rider = !fl.far && this.rnd.chance(0.35);
        a.cargo = !fl.far && !a.rider && this.rnd.chance(0.25);
      }
      this.agents.push(a);
    }
    this.calves = calves;
    this.dist = new Float32Array(total);
    this.order = Array.from({ length: total }, (_, i) => i);
  }

  private readonly vatFirst: Record<Clip, number>;
  private readonly calves: number;

  get state(): HerdStats {
    return { ...this.stats };
  }

  /** Where bison rest on the terrace (monks tend them and sleep beside them). */
  restingPlaces(): Array<{ p: THREE.Vector3; yaw: number }> {
    return this.spots.slice(0, this.spots.length - 4);
  }

  /** Positions of all bison (tests). */
  positions(): Array<{ x: number; y: number; z: number; state: State; calf: boolean }> {
    return this.agents.map((a) => ({ x: +a.pos.x.toFixed(1), y: +a.pos.y.toFixed(1), z: +a.pos.z.toFixed(1), state: a.state, calf: a.calf }));
  }

  sessionStart(ctx: GameContext): void {
    this.ctx = ctx;
    for (const a of this.agents) if (this.isGrounded(a)) this.syncCollider(a);
  }

  sessionEnd(): void {
    if (this.ctx) for (const a of this.agents) this.dropCollider(a);
    this.ctx = null;
  }

  private isGrounded(a: Agent): boolean {
    return a.state === 'ground' || a.state === 'walkOut' || a.state === 'waiting';
  }

  /** Put an adult on a free ground spot (or the ledge). */
  private ground(a: Agent, hint: number): void {
    let s = -1;
    for (let k = 0; k < this.spots.length; k++) {
      const c = (hint + k) % this.spots.length;
      if (!this.taken.includes(c)) {
        s = c;
        break;
      }
    }
    if (s < 0) {
      a.state = 'cruise';
      return;
    }
    this.taken.push(s);
    a.spot = s;
    a.pos.copy(this.spots[s].p);
    a.vel.set(0, 0, 0);
    a.yaw = this.spots[s].yaw + (this.rnd.chance(0.5) ? Math.PI : 0);
    a.state = 'ground';
    a.t = 0;
    a.act = this.rnd.chance(0.5) ? 'graze' : 'stand';
    a.actT = this.rnd.range(6, 30);
  }

  private freeSpot(a: Agent): void {
    const i = this.taken.indexOf(a.spot);
    if (i >= 0) this.taken.splice(i, 1);
    a.spot = -1;
  }

  /** Whistle: the nearest flying bison of the near loops glides down to ledge `i` and waits there. */
  call(i: number): Agent | null {
    const ledge = ledgePoint(i, 0.55);
    let best: Agent | null = null, bd = Infinity;
    for (const a of this.agents) {
      if (a.calf || a.called || this.flocks[a.flock].far || (a.state !== 'cruise' && a.state !== 'takeoff')) continue;
      const d = a.pos.distanceTo(ledge);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (!best) return null;
    best.called = true;
    best.ledge = i;
    this.startApproach(best);
    return best;
  }

  /** The bison waiting on a ledge for the player (after a whistle), if any. */
  waitingAt(i: number): Agent | null {
    return this.agents.find((a) => a.called && a.state === 'waiting' && a.ledge === i) ?? null;
  }

  /** Send a waiting bison back to the sky. */
  release(a: Agent): void {
    if (a.ledge >= 0 && this.laneHold[a.ledge] === a) this.laneHold[a.ledge] = null;
    if (a.ledge >= 0) this.laneFree[a.ledge] = this.time + 6;
    a.called = false;
    a.yaw = yawOut(shelf(a.ledge === 0 ? 'landing_main' : 'landing_ne').a);
    a.state = 'takeoff';
    a.t = 0;
    this.dropCollider(a);
  }

  private startApproach(a: Agent): void {
    a.state = 'approach';
    a.t = 0;
    const s = shelf(a.ledge === 0 ? 'landing_main' : 'landing_ne');
    const out = polar(s.a, s.r1 + 42);
    a.home.set(out.x, floorY(s.y) + 16, out.z);
    a.target.copy(a.home);
  }

  private laneOpen(i: number): boolean {
    return this.time >= this.laneFree[i] && !this.laneHold[i];
  }

  update(dt: number, ctx: GameContext): void {
    this.time += dt;
    this.frame++;
    const hour = ctx.world.sky.timeOfDay;
    const night = hour < 5.5 || hour > 20.5;
    const dawn = hour >= 5.5 && hour < 7.5;
    const dusk = hour >= 18 && hour <= 20.5;
    for (const f of this.flocks) f.ang += (f.speed / f.r) * f.dir * dt;
    this.inbound = 0;
    for (const a of this.agents) if ((a.state === 'approach' || a.state === 'land') && !a.called) this.inbound++;
    let flying = 0, grounded = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const fl = this.flocks[a.flock];
      // Far herds tick a quarter as often.
      if (fl.far && a.state === 'cruise' && !a.calf) {
        if ((this.frame + i) % 4 !== 0) {
          a.pos.addScaledVector(a.vel, dt);
          a.phase += dt * 0.9 * Math.PI * 2;
          flying++;
          continue;
        }
        this.step(a, dt * 4, ctx, night, dawn, dusk);
      } else this.step(a, dt, ctx, night, dawn, dusk);
      if (this.isGrounded(a)) grounded++;
      else flying++;
    }
    this.stats.flying = flying;
    this.stats.grounded = grounded;
    this.stats.total = this.agents.length;
    this.stats.calves = this.calves;
    this.render(ctx);
  }

  private step(a: Agent, dt: number, ctx: GameContext, night: boolean, dawn: boolean, dusk: boolean): void {
    a.t += dt;
    switch (a.state) {
      case 'ground':
      case 'waiting': {
        a.clip = a.act === 'rest' ? 'rest' : a.act === 'graze' ? 'graze' : 'stand';
        a.actT -= dt;
        if (a.actT <= 0) {
          const r = this.rnd.next();
          a.act = night ? 'rest' : r < 0.45 ? 'graze' : r < 0.75 ? 'stand' : 'rest';
          a.actT = this.rnd.range(8, 34);
          if (a.calf && !night && this.rnd.chance(0.5)) {
            // Calves wander a few steps round the hay.
            a.target.set(a.home.x + this.rnd.range(-4, 4), a.home.y, a.home.z + this.rnd.range(-4, 4));
            a.state = 'walkOut';
            a.ledge = -1;
          }
        }
        if (a.state === 'waiting' && a.t > 60) this.release(a);
        if (a.state === 'ground' && !a.calf && a.t > a.dur && !night && (!dusk || dawn)) {
          // Walk out to a ledge and take off.
          a.ledge = this.rnd.chance(0.5) ? 0 : 1;
          a.target.copy(ledgePoint(a.ledge, 0.12));
          a.state = 'walkOut';
          a.t = 0;
        }
        if (dawn && a.state === 'ground' && !a.calf && a.t > 4 + (a.spot % 6) * 3) a.dur = 0;
        break;
      }
      case 'walkOut': {
        a.clip = 'walk';
        this.v.subVectors(a.target, a.pos);
        this.v.y = 0;
        const d = this.v.length();
        if (d < 0.6) {
          if (a.calf || a.ledge < 0) {
            a.state = 'ground';
            a.act = 'graze';
            a.actT = this.rnd.range(8, 20);
            break;
          }
          if (!this.laneOpen(a.ledge)) {
            // Wait at the inner end of the ledge for the lane.
            a.clip = 'stand';
            break;
          }
          this.laneFree[a.ledge] = this.time + 7;
          this.freeSpot(a);
          a.state = 'takeoff';
          a.t = 0;
          this.dropCollider(a);
          this.gust(ctx, a.pos, 1);
          break;
        }
        this.v.multiplyScalar(1 / d);
        const sp = (a.calf ? 0.8 : 1.3) * Math.min(1, d);
        a.pos.addScaledVector(this.v, sp * dt);
        a.yaw = turnTo(a.yaw, Math.atan2(this.v.x, this.v.z), dt * 1.6);
        a.phase += (sp / (2.4 * a.scale)) * Math.PI * 2 * dt;
        this.syncCollider(a);
        break;
      }
      case 'takeoff': {
        a.clip = 'fly';
        const up = Math.min(1, a.t / 1.2);
        const fwd = Math.min(1, a.t / 3);
        a.vel.set(Math.sin(a.yaw) * 7 * fwd, 4.2 * up * (1 - Math.max(0, a.t - 4) / 2), Math.cos(a.yaw) * 7 * fwd);
        a.pos.addScaledVector(a.vel, dt);
        a.pitch = -0.25 * up * (1 - fwd * 0.6);
        a.phase += dt * 1.6 * Math.PI * 2;
        if (a.t > 5.5) {
          a.state = 'cruise';
          a.t = 0;
          a.dur = this.rnd.range(90, 300);
          a.flock = this.rnd.next() < 0.45 ? 0 : this.rnd.next() < 0.7 ? 1 : 2;
          a.slot.set(this.rnd.range(-22, 22), this.rnd.range(-9, 9), this.rnd.range(-22, 22));
          a.rider = this.rnd.chance(0.3);
          a.cargo = !a.rider && this.rnd.chance(0.25);
        }
        break;
      }
      case 'cruise': {
        a.clip = 'fly';
        const fl = this.flocks[a.flock];
        const wob = Math.sin(this.time * 0.05 + fl.wob) * 0.18;
        const ang = fl.ang + (fl.dir * (a.slot.x + 30)) / fl.r;
        const rr = fl.r * (1 + wob) + a.slot.z;
        this.w.set(fl.cx + Math.cos(ang) * rr, fl.y + a.slot.y + Math.sin(this.time * 0.11 + fl.wob) * 12, fl.cz + Math.sin(ang) * rr);
        this.fly(a, this.w, fl.speed, dt);
        // Flights that run out during the dawn takeoff are stretched, so the herd does not all come
        // back at once when the morning starts.
        if (dawn && a.t > a.dur) a.dur = a.t + this.rnd.range(20, 160);
        const landing = !fl.far && !a.calf && ((a.t > a.dur && !dawn) || (dusk && a.t > 8) || (night && a.t > 4));
        if (landing && this.taken.length + this.inbound < this.spots.length && this.inbound < 5) {
          this.inbound++;
          a.ledge = this.rnd.chance(0.5) ? 0 : 1;
          this.startApproach(a);
        } else if (landing && (dusk || night) && this.taken.length + this.inbound >= this.spots.length) {
          // No room left on the terrace: roost with the far herds tonight.
          a.flock = this.rnd.chance(0.5) ? 3 : 4;
          a.t = 0;
          a.slot.set(this.rnd.range(-40, 40), this.rnd.range(-18, 18), this.rnd.range(-40, 40));
        } else if (fl.far && !a.farHome && !dusk && !night && a.t > (dawn ? this.rnd.range(5, 40) : 20)) {
          // Morning: back from the far herds to the temple's loops.
          a.flock = this.rnd.chance(0.45) ? 0 : this.rnd.chance(0.6) ? 1 : 2;
          a.t = 0;
          a.dur = this.rnd.range(90, 300);
          a.slot.set(this.rnd.range(-22, 22), this.rnd.range(-9, 9), this.rnd.range(-22, 22));
        }
        break;
      }
      case 'approach': {
        a.clip = 'fly';
        const open = this.laneOpen(a.ledge);
        if (!open && a.pos.distanceTo(a.home) < 40) {
          // Hold: circle over the approach point until the ledge's lane is free.
          const ang = this.time * 0.35 + a.slot.x;
          a.target.set(a.home.x + Math.cos(ang) * 26, a.home.y + 6 + Math.abs(a.slot.y), a.home.z + Math.sin(ang) * 26);
        } else a.target.copy(a.home);
        this.fly(a, a.target, 10, dt);
        if (open && a.pos.distanceTo(a.home) < 14) {
          this.laneFree[a.ledge] = this.time + 16;
          a.state = 'land';
          a.t = 0;
          a.target.copy(ledgePoint(a.ledge, a.called ? 0.55 : this.rnd.range(0.5, 0.66)));
        }
        break;
      }
      case 'land': {
        a.clip = 'fly';
        this.v.subVectors(a.target, a.pos);
        const d = this.v.length();
        const sp = Math.max(1.2, Math.min(9, d * 0.42));
        this.v.multiplyScalar(1 / Math.max(d, 0.001));
        a.vel.lerp(this.w.copy(this.v).multiplyScalar(sp), Math.min(1, dt * 2));
        a.pos.addScaledVector(a.vel, dt);
        const hv = Math.hypot(a.vel.x, a.vel.z);
        if (hv > 0.3) a.yaw = turnTo(a.yaw, Math.atan2(a.vel.x, a.vel.z), dt * 1.5);
        a.pitch = d < 9 ? -0.3 * (1 - d / 9) : 0;
        a.bank *= 1 - Math.min(1, dt * 2);
        a.phase += dt * (d < 9 ? 2.2 : 1.0) * Math.PI * 2;
        if (d < 0.9) {
          a.pos.copy(a.target);
          a.vel.set(0, 0, 0);
          a.pitch = 0;
          this.gust(ctx, a.pos, 1.3);
          ctx.audio.play('creature.skybison.huff', { position: a.pos, volume: 0.7, range: 120 });
          if (a.called) {
            a.state = 'waiting';
            a.t = 0;
            a.act = 'stand';
            a.actT = 30;
            this.laneHold[a.ledge] = a;
            this.syncCollider(a);
          } else {
            this.laneFree[a.ledge] = this.time + 7;
            this.ground(a, this.rnd.int(0, this.spots.length - 1));
            if ((a.state as State) === 'ground') {
              // Walk in from the ledge to the spot.
              const spot = this.spots[a.spot].p.clone();
              a.pos.copy(a.target);
              a.target.copy(spot);
              a.state = 'walkOut';
              a.ledge = -1;
              a.dur = this.rnd.range(40, 200);
              a.t = 0;
            }
          }
        }
        break;
      }
    }
  }

  /** Steer toward a point at a cruising speed (separation from flock mates, obstacle avoidance). */
  private fly(a: Agent, target: THREE.Vector3, speed: number, dt: number): void {
    const v = this.v.subVectors(target, a.pos);
    const d = v.length();
    v.multiplyScalar(speed / Math.max(d, 0.001));
    if (d < 20) v.multiplyScalar(Math.max(0.55, d / 20));
    // Separation from neighbours.
    for (const b of this.agents) {
      if (b === a || b.flock !== a.flock || b.state === 'ground') continue;
      const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < 18 * 18 && dd > 1e-4) {
        const k = ((18 - Math.sqrt(dd)) / 18) * 6;
        const inv = 1 / Math.sqrt(dd);
        v.x += dx * inv * k;
        v.y += dy * inv * k * 0.4;
        v.z += dz * inv * k;
      }
    }
    // Obstacles: steer round spires, the pinnacle and the tower (look ahead ~3 s).
    const ax = a.pos.x + a.vel.x * 3, az = a.pos.z + a.vel.z * 3;
    for (const o of this.obstacles) {
      if (a.pos.y > o.top || (a.state === 'land' && o.r > 100)) continue;
      const dx = ax - o.x, dz = az - o.z;
      const dd = Math.hypot(dx, dz);
      if (dd < o.r && dd > 1e-3) {
        const k = ((o.r - dd) / o.r) * speed * 1.6;
        v.x += (dx / dd) * k;
        v.z += (dz / dd) * k;
        if (o.top - a.pos.y < 30) v.y += k * 0.3;
      }
    }
    const before = a.yaw;
    a.vel.lerp(v, Math.min(1, dt * 0.9));
    a.pos.addScaledVector(a.vel, dt);
    const hv = Math.hypot(a.vel.x, a.vel.z);
    if (hv > 0.5) a.yaw = turnTo(a.yaw, Math.atan2(a.vel.x, a.vel.z), dt * 1.2);
    const turn = wrap(a.yaw - before) / Math.max(dt, 1e-3);
    a.bank += (Math.max(-0.45, Math.min(0.45, -turn * 0.9)) - a.bank) * Math.min(1, dt * 2);
    a.pitch += (Math.max(-0.3, Math.min(0.3, -Math.atan2(a.vel.y, Math.max(1, hv)) * 0.8)) - a.pitch) * Math.min(1, dt * 2);
    a.phase += dt * (0.9 + Math.max(0, a.vel.y) * 0.08) * Math.PI * 2;
  }

  private gust(ctx: GameContext, p: THREE.Vector3, s: number): void {
    this.w.set(p.x, p.y + 0.4, p.z);
    ctx.vfx.burst('dust', this.w, { count: Math.round(8 * s), radius: 3.5 * s, size: 2.2 });
    ctx.vfx.burst('air', this.w, { count: Math.round(6 * s), radius: 2.5 * s, size: 1.6 });
    ctx.vfx.ring(this.w, '#e8f2ff', 5 * s, 0.7, { opacity: 0.35 });
  }

  private syncCollider(a: Agent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = a.scale;
    const def = { x: a.pos.x + Math.sin(a.yaw) * 0.2 * s, y: a.pos.y + 1.7 * s, z: a.pos.z + Math.cos(a.yaw) * 0.2 * s, hx: 1.7 * s, hy: 1.6 * s, hz: 3.4 * s, yaw: a.yaw };
    if (a.col === null) a.col = ctx.world.collision.add({ shape: 'box', ...def, solid: true, walkable: true, tag: 'air_temple_summit' }, true);
    else ctx.world.collision.update(a.col, def);
  }

  private dropCollider(a: Agent): void {
    if (a.col !== null && this.ctx) this.ctx.world.collision.remove(a.col);
    a.col = null;
  }

  // ---------------------------------------------------------------- render

  private render(ctx: GameContext): void {
    const cam = ctx.camera.position;
    const n = this.agents.length;
    for (let i = 0; i < n; i++) this.dist[i] = this.agents[i].pos.distanceToSquared(cam);
    this.order.sort((x, y) => this.dist[x] - this.dist[y]);
    let ni = 0, fi = 0, ri = 0, ci = 0;
    const nearMax = this.nearAnim.count;
    const rows = this.vatFirst;
    for (const i of this.order) {
      const a = this.agents[i];
      this.e.set(a.pitch, a.yaw, a.bank, 'YXZ');
      this.q.setFromEuler(this.e);
      this.sc.setScalar(a.scale);
      this.m4.compose(a.pos, this.q, this.sc);
      const useNear = ni < nearMax && this.dist[i] < 190 * 190;
      if (useNear) {
        this.near.setMatrixAt(ni, this.m4);
        const [n0, cnt] = clipRange(a.clip, rows);
        let fa = n0, fb = n0, bl = 0;
        if (cnt > 1) {
          const per = a.clip === 'fly' ? (Math.PI * 4) / cnt : (Math.PI * 2) / cnt;
          const f = (((a.phase / per) % cnt) + cnt) % cnt;
          const k = Math.floor(f);
          fa = n0 + k;
          fb = n0 + ((k + 1) % cnt);
          bl = f - k;
        }
        this.nearAnim.setXYZ(ni, fa, fb, bl);
        ni++;
      } else {
        this.far.setMatrixAt(fi, this.m4);
        const fly = a.clip === 'fly' ? 1 : 0;
        this.farMove.setXYZW(fi, a.clip === 'fly' ? a.phase : a.phase, fly, a.clip === 'walk' ? 1 : 0, a.clip === 'rest' ? 1 : 0);
        fi++;
      }
      if (a.rider && !this.isGrounded(a)) this.riders.setMatrixAt(ri++, this.m4);
      if (a.cargo) this.cargo.setMatrixAt(ci++, this.m4);
    }
    this.near.count = ni;
    this.far.count = fi;
    this.riders.count = ri;
    this.cargo.count = ci;
    this.stats.near = ni;
    this.stats.riders = ri;
    for (const im of [this.near, this.far, this.riders, this.cargo]) im.instanceMatrix.needsUpdate = true;
    this.nearAnim.needsUpdate = true;
    this.farMove.needsUpdate = true;
  }

  dispose(): void {
    this.sessionEnd();
    this.group.removeFromParent();
    for (const o of this.owned) o.dispose();
    for (const im of [this.near, this.far, this.riders, this.cargo]) im.dispose();
  }
}

function clipRange(c: Clip, first: Record<Clip, number>): [number, number] {
  const n = CLIPS.find((x) => x[0] === c)![1];
  return [first[c], n];
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function turnTo(cur: number, want: number, max: number): number {
  const d = wrap(want - cur);
  return cur + Math.max(-max, Math.min(max, d));
}

