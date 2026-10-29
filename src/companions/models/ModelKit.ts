import * as THREE from 'three';
import { SimplexNoise } from '../../core/Noise';

/**
 * Procedural creature model kit.
 *
 * Creatures are built from smooth primitives (ellipsoids, tapered tubes, flat
 * shapes) attached to bones, merged into ONE skinned mesh per creature (one
 * draw call) with vertex colours. Rigid parts are weighted 100 % to their bone;
 * bodies that must bend smoothly (dragon spine, tails, necks) blend weights
 * between neighbouring bones.
 *
 * A built model is a cached ModelTemplate (geometry + bone layout + anchors);
 * each creature instantiates its own bones/skeleton over the shared geometry.
 *
 * Surface detail comes from the shared creature material: a per-vertex
 * `aPat` attribute selects a procedural pattern (fur streaks, overlapping
 * scales, feather barbs, shell plates, unlit glow) and fur gets a soft rim.
 *
 * Local conventions: +Z forward, +Y up, the creature's LEFT is +X. The model
 * root sits on the ground between the feet.
 */

export const PAT = { none: 0, scales: 1, fur: 2, feathers: 3, shell: 4, glow: 5 } as const;

/** Vertex colour from its bone-local position, normal and index in the piece. */
export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3, i: number) => THREE.ColorRepresentation;

export interface PieceOpts {
  color: THREE.ColorRepresentation | ColorFn;
  /** Surface pattern (PAT.*). */
  pat?: number;
  /** Per-vertex pattern (overrides `pat`); keep neighbouring codes adjacent (e.g. none ↔ scales). */
  patFn?: (p: THREE.Vector3, n: THREE.Vector3, i: number) => number;
  /** Multipliers applied to the geometry UVs to drive the pattern. */
  patScale?: [number, number];
  /**
   * Smooth skinning: weights for a vertex (given in the owning bone's local
   * space, bind pose; i = vertex index in the piece). Default: 100 % to the owning bone.
   */
  blend?: (p: THREE.Vector3, i: number) => Array<[string, number]>;
}

const noise = new SimplexNoise(424242);
const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpC = new THREE.Color();
const tmpM = new THREE.Matrix4();
const tmpM3 = new THREE.Matrix3();

// ---------------------------------------------------------------------------
// Geometry primitives (all return indexed BufferGeometry with uv)
// ---------------------------------------------------------------------------

export interface LumpOpts {
  /** Displacement amplitude (m) along the normal. */
  amp: number;
  /** Noise frequency (1/m). */
  freq: number;
  seed?: number;
  /** Squash the underside (bellies resting on legs). */
  flatBottom?: number;
}

/**
 * Vertex normals averaged over coincident positions, so UV seams (duplicated
 * vertices) do not show as lighting cracks.
 */
export function smoothNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const acc = new Map<string, [number, number, number]>();
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const a = acc.get(k);
    if (a) {
      a[0] += nrm.getX(i);
      a[1] += nrm.getY(i);
      a[2] += nrm.getZ(i);
    } else acc.set(k, [nrm.getX(i), nrm.getY(i), nrm.getZ(i)]);
  }
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(key(i))!;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    nrm.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
  }
  nrm.needsUpdate = true;
  return g;
}

/** Ellipsoid with optional fluffy lumps (noise displacement along normals). */
export function ellipsoid(rx: number, ry: number, rz: number, ws = 24, hs = 16, lumps?: LumpOpts): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, Math.max(6, Math.round(ws)), Math.max(4, Math.round(hs)));
  const pos = g.attributes.position as THREE.BufferAttribute;
  const seed = lumps?.seed ?? 0;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * rx, y = pos.getY(i) * ry, z = pos.getZ(i) * rz;
    if (lumps) {
      // Normal of the ellipsoid at this point.
      tmpN.set(x / (rx * rx), y / (ry * ry), z / (rz * rz)).normalize();
      const f = lumps.freq;
      const n1 = noise.noise3(x * f + seed, y * f - seed * 0.7, z * f + seed * 1.3);
      const n2 = noise.noise3(x * f * 2.3 - seed, y * f * 2.3, z * f * 2.3 + 5.1);
      const d = lumps.amp * (0.65 * (n1 * 0.5 + 0.5) + 0.35 * (n2 * 0.5 + 0.5));
      x += tmpN.x * d;
      y += tmpN.y * d;
      z += tmpN.z * d;
      if (lumps.flatBottom && y < -ry * 0.55) y = -ry * 0.55 + (y + ry * 0.55) * (1 - lumps.flatBottom);
    }
    pos.setXYZ(i, x, y, z);
  }
  return smoothNormals(g);
}

/** Hemisphere-ish dome (shells): an ellipsoid cut at y = 0, with a flat underside. */
export function dome(rx: number, ry: number, rz: number, ws = 20, hs = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(rx, ry, rz);
  return smoothNormals(g);
}

/** Rotation-minimising frames along a polyline. */
function frames(points: THREE.Vector3[]): Array<{ t: THREE.Vector3; n: THREE.Vector3; b: THREE.Vector3 }> {
  const out: Array<{ t: THREE.Vector3; n: THREE.Vector3; b: THREE.Vector3 }> = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    if (t.lengthSq() < 1e-8) t.set(0, 0, 1);
    let n: THREE.Vector3;
    if (i === 0) {
      const ref = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      n = ref.clone().sub(t.clone().multiplyScalar(ref.dot(t))).normalize();
    } else {
      const prev = out[i - 1];
      n = prev.n.clone().sub(t.clone().multiplyScalar(prev.n.dot(t))).normalize();
      if (n.lengthSq() < 1e-8) n = prev.n.clone();
    }
    const bb = new THREE.Vector3().crossVectors(t, n).normalize();
    out.push({ t, n, b: bb });
  }
  return out;
}

export interface TubeOpts {
  radial?: number;
  /** Close the ends with rounded caps. */
  caps?: boolean;
  /** Cross-section scale along the frame normal (n) and binormal (b): flattens tubes (tails, fins). */
  squash?: [number, number];
  /** Per-ring radius multiplier noise (fluffy tubes). */
  lumps?: LumpOpts;
  /** Radius multiplier per vertex: angle around (0 = frame normal) and distance along (m). */
  profile?: (angle: number, along: number) => number;
}

/**
 * Tube through `points` with per-point radius. UV: u around (0..1), v along the
 * length in metres (so patterns keep their scale).
 */
export function tube(points: THREE.Vector3[], radii: number | number[] | ((t: number) => number), o: TubeOpts = {}): THREE.BufferGeometry {
  const radial = Math.max(4, Math.round(o.radial ?? 10));
  const fr = frames(points);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rOf = (i: number) => (typeof radii === 'number' ? radii : typeof radii === 'function' ? radii(i / Math.max(1, points.length - 1)) : radii[Math.min(radii.length - 1, i)]);
  const sq = o.squash ?? [1, 1];
  let along = 0;
  const rings: number[] = [];
  const addRing = (c: THREE.Vector3, f: { t: THREE.Vector3; n: THREE.Vector3; b: THREE.Vector3 }, r: number, v: number) => {
    rings.push(pos.length / 3);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cn = Math.cos(a) * sq[0], cb = Math.sin(a) * sq[1];
      let rr = o.profile ? r * o.profile(a, v) : r;
      if (o.lumps && r > 0) {
        const px = c.x + (f.n.x * cn + f.b.x * cb) * r, py = c.y + (f.n.y * cn + f.b.y * cb) * r, pz = c.z + (f.n.z * cn + f.b.z * cb) * r;
        const fq = o.lumps.freq;
        rr += o.lumps.amp * (noise.noise3(px * fq + (o.lumps.seed ?? 0), py * fq, pz * fq) * 0.5 + 0.5);
      }
      pos.push(c.x + (f.n.x * cn + f.b.x * cb) * rr, c.y + (f.n.y * cn + f.b.y * cb) * rr, c.z + (f.n.z * cn + f.b.z * cb) * rr);
      uv.push(j / radial, v);
    }
  };
  const capRings = 3;
  if (o.caps) {
    const r0 = rOf(0);
    for (let k = capRings; k >= 1; k--) {
      const a = (k / capRings) * (Math.PI / 2);
      const c = points[0].clone().addScaledVector(fr[0].t, -Math.sin(a) * r0 * 0.9);
      addRing(c, fr[0], Math.cos(a) * r0 + 0.0001, -Math.sin(a) * r0);
    }
  }
  for (let i = 0; i < points.length; i++) {
    if (i > 0) along += points[i].distanceTo(points[i - 1]);
    addRing(points[i], fr[i], rOf(i), along);
  }
  if (o.caps) {
    const last = points.length - 1;
    const r1 = rOf(last);
    for (let k = 1; k <= capRings; k++) {
      const a = (k / capRings) * (Math.PI / 2);
      const c = points[last].clone().addScaledVector(fr[last].t, Math.sin(a) * r1 * 0.9);
      addRing(c, fr[last], Math.cos(a) * r1 + 0.0001, along + Math.sin(a) * r1);
    }
  }
  for (let ri = 0; ri < rings.length - 1; ri++) {
    const a0 = rings[ri], b0 = rings[ri + 1];
    for (let j = 0; j < radial; j++) {
      const a = a0 + j, b = a0 + j + 1, c = b0 + j, d = b0 + j + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return smoothNormals(g);
}

/** Tapered capsule from the origin straight down (-Y) — legs. */
export function limb(len: number, r0: number, r1: number, radial = 10, lumps?: LumpOpts): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3(0, -len * (i / n), 0));
  return tube(pts, (t) => r0 + (r1 - r0) * t, { radial, caps: true, lumps });
}

/** Points along a quadratic bezier. */
export function bezier(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, n = 8): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(new THREE.Vector3(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z));
  }
  return out;
}

/** Cone/horn pointing +Y. */
export function cone(r: number, h: number, radial = 8): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, radial, 2);
  g.translate(0, h / 2, 0);
  return g;
}

/** Thin extruded flat shape in the XY plane (wings, fins, ears, tail paddles). */
export function flat(shape: THREE.Shape, thickness: number, curveSegments = 10): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.4, bevelSize: thickness * 0.4, bevelSegments: 1, curveSegments });
  g.translate(0, 0, -thickness / 2);
  // ExtrudeGeometry is non-indexed with UVs in shape units — fine for patterns.
  g.computeVertexNormals();
  return g;
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

export interface XForm {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
}

/** Apply a transform to a geometry (in place) and return it. */
export function xf(g: THREE.BufferGeometry, t: XForm): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(t.rot ?? [0, 0, 0]), 'XYZ'));
  const s = typeof t.scale === 'number' ? new THREE.Vector3(t.scale, t.scale, t.scale) : new THREE.Vector3(...(t.scale ?? [1, 1, 1]));
  m.compose(new THREE.Vector3(...(t.pos ?? [0, 0, 0])), q, s);
  g.applyMatrix4(m);
  return g;
}

/** Mirror a geometry across X (left ↔ right) — fixes winding. */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = g.clone();
  c.scale(-1, 1, 1);
  const idx = c.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  } else {
    const p = c.attributes.position as THREE.BufferAttribute;
    const swap = (attr: THREE.BufferAttribute | undefined, size: number) => {
      if (!attr) return;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < size; k++) {
          const t = arr[(i + 1) * size + k];
          arr[(i + 1) * size + k] = arr[(i + 2) * size + k];
          arr[(i + 2) * size + k] = t;
        }
      }
    };
    swap(p, 3);
    swap(c.attributes.uv as THREE.BufferAttribute | undefined, 2);
  }
  c.computeVertexNormals();
  return c;
}

// ---------------------------------------------------------------------------
// Builder & template
// ---------------------------------------------------------------------------

interface BoneDef {
  name: string;
  parent: number;
  pos: THREE.Vector3;
}

export interface ModelTemplate {
  geometry: THREE.BufferGeometry;
  bones: BoneDef[];
  inverses: THREE.Matrix4[];
  anchors: Record<string, { bone: string; pos: THREE.Vector3 }>;
  /** Bounding sphere in model space (generous: covers animation). */
  sphere: THREE.Sphere;
}

export class ModelBuilder {
  private readonly defs: BoneDef[] = [];
  private readonly index = new Map<string, number>();
  private readonly world: THREE.Matrix4[] = [];
  private readonly P: number[] = [];
  private readonly N: number[] = [];
  private readonly C: number[] = [];
  private readonly T: number[] = [];
  private readonly SI: number[] = [];
  private readonly SW: number[] = [];
  private readonly I: number[] = [];
  private readonly anchorDefs: Record<string, { bone: string; pos: THREE.Vector3 }> = {};
  /** Extra radius added to the bounding sphere (animation reach). */
  pad = 1;

  /** Define a bone at (x, y, z) relative to its parent (rest rotation is identity). */
  bone(name: string, parent: string | null, x: number, y: number, z: number): this {
    const p = parent ? this.index.get(parent) : -1;
    if (p === undefined) throw new Error(`[ModelKit] unknown parent bone ${parent}`);
    const pos = new THREE.Vector3(x, y, z);
    this.index.set(name, this.defs.length);
    this.defs.push({ name, parent: p, pos });
    const m = new THREE.Matrix4().makeTranslation(x, y, z);
    if (p >= 0) m.premultiply(this.world[p]);
    this.world.push(m);
    return this;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  /** Model-space rest position of a bone. */
  bonePos(name: string): THREE.Vector3 {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`[ModelKit] unknown bone ${name}`);
    return new THREE.Vector3().setFromMatrixPosition(this.world[i]);
  }

  anchor(name: string, bone: string, x: number, y: number, z: number): this {
    this.anchorDefs[name] = { bone, pos: new THREE.Vector3(x, y, z) };
    return this;
  }

  /** Add geometry defined in `bone`'s local space. The geometry is consumed (disposed). */
  add(bone: string, g: THREE.BufferGeometry, o: PieceOpts): this {
    const bi = this.index.get(bone);
    if (bi === undefined) throw new Error(`[ModelKit] unknown bone ${bone}`);
    const geo = g.index ? g : g;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const base = this.P.length / 3;
    const toModel = this.world[bi];
    tmpM3.getNormalMatrix(toModel);
    const fixed = typeof o.color === 'function' ? null : new THREE.Color(o.color);
    const pat = o.pat ?? PAT.none;
    const su = o.patScale?.[0] ?? 1, sv = o.patScale?.[1] ?? 1;
    const weights: Array<[number, number]> = [];
    for (let i = 0; i < pos.count; i++) {
      tmpV.fromBufferAttribute(pos, i);
      tmpN.fromBufferAttribute(nrm, i);
      if (fixed) tmpC.copy(fixed);
      else tmpC.set((o.color as ColorFn)(tmpV, tmpN, i));
      this.C.push(tmpC.r, tmpC.g, tmpC.b);
      this.T.push(uv ? uv.getX(i) * su : 0, uv ? uv.getY(i) * sv : 0, o.patFn ? o.patFn(tmpV, tmpN, i) : pat, 0);
      // Skin weights (computed in bone-local space).
      weights.length = 0;
      if (o.blend) {
        for (const [bn, w] of o.blend(tmpV, i)) {
          const j = this.index.get(bn);
          if (j !== undefined && w > 0) weights.push([j, w]);
        }
      }
      if (!weights.length) weights.push([bi, 1]);
      weights.sort((a, b) => b[1] - a[1]);
      let sum = 0;
      for (let k = 0; k < Math.min(4, weights.length); k++) sum += weights[k][1];
      for (let k = 0; k < 4; k++) {
        const w = weights[k];
        this.SI.push(w ? w[0] : 0);
        this.SW.push(w ? w[1] / sum : 0);
      }
      tmpV.applyMatrix4(toModel);
      tmpN.applyMatrix3(tmpM3).normalize();
      this.P.push(tmpV.x, tmpV.y, tmpV.z);
      this.N.push(tmpN.x, tmpN.y, tmpN.z);
    }
    if (geo.index) {
      const a = geo.index.array;
      for (let i = 0; i < a.length; i++) this.I.push(base + a[i]);
    } else {
      for (let i = 0; i < pos.count; i++) this.I.push(base + i);
    }
    geo.dispose();
    return this;
  }

  /** Add geometry mirrored to the right side (−X) on a mirrored bone. */
  addPair(boneL: string, boneR: string, g: THREE.BufferGeometry, o: PieceOpts): this {
    const m = mirrorX(g);
    this.add(boneL, g, o);
    const blend = o.blend;
    this.add(boneR, m, {
      ...o,
      color: typeof o.color === 'function' ? (p, n, i) => (o.color as ColorFn)(new THREE.Vector3(-p.x, p.y, p.z), new THREE.Vector3(-n.x, n.y, n.z), i) : o.color,
      blend: blend ? (p, i) => blend(new THREE.Vector3(-p.x, p.y, p.z), i).map(([b, w]) => [b.replace(/L(\d*)$/, 'R$1'), w] as [string, number]) : undefined,
    });
    return this;
  }

  build(): ModelTemplate {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aPat', new THREE.Float32BufferAttribute(this.T, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    const vcount = this.P.length / 3;
    g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingSphere();
    const sphere = g.boundingSphere!.clone();
    sphere.radius += this.pad;
    const inverses = this.world.map((m) => m.clone().invert());
    return { geometry: g, bones: this.defs.map((d) => ({ name: d.name, parent: d.parent, pos: d.pos.clone() })), inverses, anchors: { ...this.anchorDefs }, sphere };
  }
}

// ---------------------------------------------------------------------------
// Shared material
// ---------------------------------------------------------------------------

const VERT_PARS = /* glsl */ `
attribute vec4 aPat;
varying vec4 vPat;
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vPat;
uniform float uCmpRim;
float cmpHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cmpPattern(vec4 p) {
  float k = p.z;
  if (k < 0.5) return 1.0;
  if (k < 1.5) {
    vec2 g = p.xy;
    float row = floor(g.y);
    g.x += mod(row, 2.0) * 0.5;
    vec2 f = vec2(fract(g.x) - 0.5, fract(g.y) - 0.2);
    float d = length(vec2(f.x * 1.1, f.y));
    float edge = smoothstep(0.36, 0.5, d);
    float sheen = 1.0 - smoothstep(0.0, 0.45, d);
    return 0.9 - 0.3 * edge + 0.14 * sheen + 0.08 * (cmpHash(floor(g)) - 0.5);
  }
  if (k < 2.5) {
    float n = cmpHash(floor(p.xy * vec2(70.0, 7.0)));
    float n2 = cmpHash(floor(p.xy * vec2(21.0, 2.5)) + 3.1);
    return 0.86 + 0.13 * n + 0.07 * n2;
  }
  if (k < 3.5) {
    vec2 g = p.xy * vec2(8.0, 12.0);
    g.x += mod(floor(g.y), 2.0) * 0.5;
    vec2 f = fract(g);
    float vane = 1.0 - abs(f.x - 0.5) * 2.0;
    return 0.78 + 0.26 * smoothstep(0.0, 1.0, vane) * (0.55 + 0.45 * f.y);
  }
  if (k < 4.5) {
    vec2 g = p.xy * 3.2;
    g.x += mod(floor(g.y), 2.0) * 0.5;
    vec2 f = abs(fract(g) - 0.5);
    float e = max(f.x * 1.15 + f.y * 0.55, f.y * 1.15);
    return 1.0 - 0.38 * smoothstep(0.4, 0.5, e);
  }
  return 1.0;
}
`;

let sharedMaterial: THREE.MeshStandardMaterial | null = null;
const rimUniform = { value: 0.3 };

/** The one material every creature renders with (vertex colours + patterns + rim). */
export function creatureMaterial(): THREE.MeshStandardMaterial {
  if (sharedMaterial) return sharedMaterial;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  m.name = 'CreatureMaterial';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCmpRim = rimUniform;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = aPat;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= cmpPattern(vPat);')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          float cmpK = vPat.z;
          if (cmpK > 4.5) {
            outgoingLight = diffuseColor.rgb * 1.7;
          } else {
            float cmpF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.4);
            float cmpFur = (cmpK > 1.5 && cmpK < 2.5) ? 1.0 : 0.3;
            outgoingLight += diffuseColor.rgb * cmpF * uCmpRim * cmpFur;
          }
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'a4n-creature-v1';
  sharedMaterial = m;
  return m;
}

/** Rim strength (fur sheen) — lowered at night. */
export function setCreatureRim(v: number): void {
  rimUniform.value = v;
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

export interface ModelInstance {
  mesh: THREE.SkinnedMesh;
  bones: Map<string, THREE.Bone>;
  rest: Map<string, THREE.Vector3>;
  anchors: Record<string, THREE.Object3D>;
}

export function instantiate(t: ModelTemplate, material: THREE.Material = creatureMaterial()): ModelInstance {
  const bones: THREE.Bone[] = [];
  const map = new Map<string, THREE.Bone>();
  const rest = new Map<string, THREE.Vector3>();
  for (const d of t.bones) {
    const b = new THREE.Bone();
    b.name = d.name;
    b.position.copy(d.pos);
    if (d.parent >= 0) bones[d.parent].add(b);
    bones.push(b);
    map.set(d.name, b);
    rest.set(d.name, d.pos.clone());
  }
  const mesh = new THREE.SkinnedMesh(t.geometry, material);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones, t.inverses.map((m) => m.clone())), new THREE.Matrix4());
  mesh.boundingSphere = t.sphere.clone();
  mesh.frustumCulled = true;
  const anchors: Record<string, THREE.Object3D> = {};
  for (const [name, a] of Object.entries(t.anchors)) {
    const o = new THREE.Object3D();
    o.name = 'anchor_' + name;
    o.position.copy(a.pos);
    map.get(a.bone)?.add(o);
    anchors[name] = o;
  }
  return { mesh, bones: map, rest, anchors };
}

/** Bind an additional skinned mesh (saddle, harness) to an existing instance's skeleton. */
export function attachSkinned(inst: ModelInstance, t: ModelTemplate, material: THREE.Material = creatureMaterial()): THREE.SkinnedMesh {
  // Accessory templates are built with the same bone layout; map their bone indices onto this skeleton.
  const bones = t.bones.map((d) => inst.bones.get(d.name)!);
  const m = new THREE.SkinnedMesh(t.geometry, material);
  m.bind(new THREE.Skeleton(bones, t.inverses.map((x) => x.clone())), new THREE.Matrix4());
  m.boundingSphere = t.sphere.clone();
  inst.mesh.add(m);
  return m;
}

// ---------------------------------------------------------------------------
// Template cache (geometry is shared by all individuals of a species/variant)
// ---------------------------------------------------------------------------

const cache = new Map<string, ModelTemplate>();

export function cachedTemplate(key: string, build: () => ModelTemplate): ModelTemplate {
  let t = cache.get(key);
  if (!t) {
    t = build();
    cache.set(key, t);
  }
  return t;
}

/** Free every cached geometry (session end). Instances must already be removed. */
export function clearTemplateCache(): void {
  for (const t of cache.values()) t.geometry.dispose();
  cache.clear();
}

export function templateCacheSize(): number {
  return cache.size;
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

export function mix(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)));
}

export function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Signed distance to an arrow (pointing +y in its 2D frame), for markings. */
export function arrowMask(x: number, y: number, len: number, shaftW: number, headW: number, headL: number): number {
  // inside → 1, outside → 0 with soft edge.
  const yy = y + len / 2;
  if (yy < 0 || yy > len) return 0;
  const headStart = len - headL;
  let half: number;
  if (yy < headStart) half = shaftW / 2;
  else half = (headW / 2) * (1 - (yy - headStart) / headL);
  const d = half - Math.abs(x);
  return smooth(-0.04, 0.04, d);
}

/** Deterministic 0..1 noise for colour variation. */
export function cnoise(x: number, y: number, z: number, f = 1): number {
  return noise.noise3(x * f, y * f, z * f) * 0.5 + 0.5;
}

void tmpM;
