import * as THREE from 'three';

/**
 * CharMesh — geometry accumulator for procedural characters.
 *
 * Every visible part of a character (body, face, hair, clothing, props) is
 * appended to ONE builder and baked into ONE skinned BufferGeometry, so a whole
 * character renders in a single draw call with a single material.
 *
 * Per-vertex attributes (consumed by CharMaterial):
 *  - position / normal / uv           (uv only matters for PAL.ATLAS vertices)
 *  - skinIndex / skinWeight           (up to 4 bone influences)
 *  - aMat  = (palette slot, roughness, metalness, eye-glow mask)
 *  - aTat  = (tattoo s, tattoo t, tattoo path id)  — procedural tattoo coords
 *
 * Coordinates are in the humanoid root's local bind space (metres, Y up, +Z forward).
 */

/** Palette slots: per-vertex colour index resolved from material uniforms. */
export const PAL = {
  SKIN: 0,
  SKIN_SHADE: 1,
  LIP: 2,
  MOUTH: 3,
  HAIR: 4,
  BROW: 5,
  EYE_WHITE: 6,
  IRIS: 7,
  PUPIL: 8,
  LASH: 9,
  SCAR: 10,
  BURN: 11,
  STUBBLE: 12,
  HAIR_DARK: 13,
  PRIMARY: 14,
  SECONDARY: 15,
  ACCENT: 16,
  TRIM: 17,
  FUR: 18,
  FUR_DARK: 19,
  LEATHER: 20,
  LEATHER_DARK: 21,
  WOOD: 22,
  BONE: 23,
  STRAW: 24,
  WRAP: 25,
  GOLD: 26,
  STEEL: 27,
  METAL_DARK: 28,
  STONE: 29,
  STONE2: 30,
  /** Cloth sampled from the pattern-mask atlas (mixes primary/secondary/accent/trim). */
  ATLAS: 31,
} as const;
export type PalSlot = (typeof PAL)[keyof typeof PAL];
export const PALETTE_SIZE = 32;

/** Tattoo path ids (aTat.z). 0 = no tattoo coordinates. */
export const TAT = { NONE: 0, HEAD: 1, ARM_L: 2, ARM_R: 3, LEG_L: 4, LEG_R: 5 } as const;

/** Skin binding: flat list of (boneIndex, weight) pairs, up to 4 pairs. */
export type SkinSpec = readonly number[];

export function rigid(bone: number): SkinSpec {
  return [bone, 1];
}

/** Linear blend between two bones: t=0 → a, t=1 → b. */
export function blend2(a: number, b: number, t: number): SkinSpec {
  const k = Math.min(1, Math.max(0, t));
  if (k <= 0.001) return [a, 1];
  if (k >= 0.999) return [b, 1];
  return [a, 1 - k, b, k];
}

/** Weighted mix of several skin specs (weights need not be normalised). */
export function mixSkin(parts: Array<[SkinSpec, number]>): SkinSpec {
  const acc = new Map<number, number>();
  for (const [s, w] of parts) {
    if (w <= 0) continue;
    for (let i = 0; i < s.length; i += 2) acc.set(s[i], (acc.get(s[i]) ?? 0) + s[i + 1] * w);
  }
  const arr = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const tot = arr.reduce((s, e) => s + e[1], 0) || 1;
  const out: number[] = [];
  for (const [b, w] of arr) out.push(b, w / tot);
  return out;
}

export interface MatState {
  pal: number;
  rough: number;
  metal: number;
  eye: number;
}

export interface GridOpts {
  /** Last column duplicates the first position (seam with distinct u). */
  closedU?: boolean;
  /** Reverse triangle winding. */
  flip?: boolean;
  /** Also emit back faces (separate part, reversed winding). Optional palette for the back. */
  double?: boolean | { pal?: number };
  /** Smooth normals across coincident positions (default true). */
  smooth?: boolean;
}

/** Sample point written by grid callbacks. */
export interface P3 {
  x: number;
  y: number;
  z: number;
}

const _v = new THREE.Vector3();

export class CharMesh {
  private P: number[] = [];
  private N: number[] = [];
  private UV: number[] = [];
  private SI: number[] = [];
  private SW: number[] = [];
  private M: number[] = [];
  private T: number[] = [];
  private I: number[] = [];
  private partV = 0;
  private partI = 0;
  private hasNormalsFrom = -1;

  // ---- current vertex state ----
  pal = 0;
  rough = 0.8;
  metal = 0;
  eye = 0;
  tatPath = 0;
  tatS = 0;
  tatT = 0;
  u = 0;
  v = 0;
  skin: SkinSpec = [0, 1];
  /** Optional transform for positions added through v3() (model-space matrix). */
  private mtx: THREE.Matrix4 | null = null;
  private readonly mtxStack: Array<THREE.Matrix4 | null> = [];

  get vertexCount(): number {
    return this.P.length / 3;
  }

  get indexCount(): number {
    return this.I.length;
  }

  mat(pal: number, rough = 0.8, metal = 0, eye = 0): this {
    this.pal = pal;
    this.rough = rough;
    this.metal = metal;
    this.eye = eye;
    return this;
  }

  saveMat(): MatState {
    return { pal: this.pal, rough: this.rough, metal: this.metal, eye: this.eye };
  }

  restoreMat(s: MatState): void {
    this.pal = s.pal;
    this.rough = s.rough;
    this.metal = s.metal;
    this.eye = s.eye;
  }

  tattoo(path: number, s = 0, t = 0): this {
    this.tatPath = path;
    this.tatS = s;
    this.tatT = t;
    return this;
  }

  pushMatrix(m: THREE.Matrix4 | null): void {
    this.mtxStack.push(this.mtx);
    if (!m) return;
    this.mtx = this.mtx ? this.mtx.clone().multiply(m) : m.clone();
  }

  popMatrix(): void {
    this.mtx = this.mtxStack.pop() ?? null;
  }

  /** Begin a part: normals are computed per part (no smoothing across parts). */
  begin(): void {
    this.partV = this.vertexCount;
    this.partI = this.I.length;
  }

  /** Post-adjust the normals of vertices [v0, v1) (stylised shading tweaks); `n` is renormalised after `fn`. */
  adjustNormals(v0: number, v1: number, fn: (p: P3, n: P3) => void): void {
    const p: P3 = { x: 0, y: 0, z: 0 };
    const n: P3 = { x: 0, y: 0, z: 0 };
    const P = this.P, N = this.N;
    for (let i = v0; i < v1; i++) {
      p.x = P[i * 3];
      p.y = P[i * 3 + 1];
      p.z = P[i * 3 + 2];
      n.x = N[i * 3];
      n.y = N[i * 3 + 1];
      n.z = N[i * 3 + 2];
      fn(p, n);
      const l = Math.hypot(n.x, n.y, n.z) || 1;
      N[i * 3] = n.x / l;
      N[i * 3 + 1] = n.y / l;
      N[i * 3 + 2] = n.z / l;
    }
  }

  /** Finish the current part: compute normals for its vertices. */
  end(smooth = true): void {
    this.computeNormals(this.partV, this.vertexCount, this.partI, this.I.length, smooth);
    this.partV = this.vertexCount;
    this.partI = this.I.length;
  }

  /** Add a vertex with the current state. Returns its index. */
  v3(x: number, y: number, z: number): number {
    if (this.mtx) {
      _v.set(x, y, z).applyMatrix4(this.mtx);
      x = _v.x;
      y = _v.y;
      z = _v.z;
    }
    const i = this.vertexCount;
    this.P.push(x, y, z);
    this.N.push(0, 0, 0);
    this.UV.push(this.u, this.v);
    const s = this.skin;
    let tot = 0;
    for (let k = 1; k < s.length && k < 8; k += 2) tot += s[k];
    tot = tot || 1;
    for (let k = 0; k < 4; k++) {
      const bi = s[k * 2];
      const bw = s[k * 2 + 1];
      if (bi !== undefined && bw !== undefined) {
        this.SI.push(bi);
        this.SW.push(bw / tot);
      } else {
        this.SI.push(0);
        this.SW.push(0);
      }
    }
    this.M.push(this.pal, this.rough, this.metal, this.eye);
    this.T.push(this.tatS, this.tatT, this.tatPath);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.I.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.I.push(a, b, c, a, c, d);
  }

  /** Read back a vertex position (model space). */
  pos(i: number, out: P3): P3 {
    out.x = this.P[i * 3];
    out.y = this.P[i * 3 + 1];
    out.z = this.P[i * 3 + 2];
    return out;
  }

  /**
   * Generic parametric surface: (nu+1) × (nv+1) vertices. `fn(i, j, u, v, out)` writes
   * the position and may set builder state (pal, skin, uv, tattoo) for that vertex.
   * Triangles are wound so that dP/du × dP/dv faces out (use `flip` otherwise).
   */
  grid(nu: number, nv: number, fn: (i: number, j: number, u: number, v: number, out: P3) => void, opts: GridOpts = {}): void {
    const p: P3 = { x: 0, y: 0, z: 0 };
    const emit = (back: boolean) => {
      this.begin();
      const base = this.vertexCount;
      const saved = this.saveMat();
      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          const u = i / nu;
          const v = j / nv;
          fn(opts.closedU && i === nu ? 0 : i, j, u, v, p);
          if (back && typeof opts.double === 'object' && opts.double.pal !== undefined) this.pal = opts.double.pal;
          this.v3(p.x, p.y, p.z);
          if (back) this.restoreMat(saved);
        }
      }
      const row = nu + 1;
      const flip = !!opts.flip !== back;
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const a = base + j * row + i;
          const b = a + 1;
          const c = a + row + 1;
          const d = a + row;
          if (flip) this.quad(a, d, c, b);
          else this.quad(a, b, c, d);
        }
      }
      this.end(opts.smooth !== false);
    };
    emit(false);
    if (opts.double) emit(true);
  }

  /** Axis-aligned (optionally transformed) box with flat faces. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const faces: Array<[number[], number[], number[], number[]]> = [
      [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
      [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
      [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
      [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
      [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    ];
    this.begin();
    for (const f of faces) {
      const idx = f.map((c) => this.v3(cx + c[0] * hx, cy + c[1] * hy, cz + c[2] * hz));
      this.quad(idx[0], idx[1], idx[2], idx[3]);
    }
    this.end(false);
  }

  /** Ellipsoid (poles on ±Y) with optional per-vertex deformation. */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, nu = 12, nv = 8, deform?: (p: P3, nx: number, ny: number, nz: number) => void): void {
    this.grid(
      nu,
      nv,
      (_i, _j, u, v, out) => {
        const th = u * Math.PI * 2;
        const ph = v * Math.PI; // v=0 bottom, v=1 top
        const nx = Math.sin(ph) * Math.sin(th);
        const ny = -Math.cos(ph);
        const nz = Math.sin(ph) * Math.cos(th);
        out.x = cx + nx * rx;
        out.y = cy + ny * ry;
        out.z = cz + nz * rz;
        if (deform) deform(out, nx, ny, nz);
      },
      { closedU: true },
    );
  }

  /**
   * Tube along a polyline with per-point radius (parallel-transport frames).
   * `radius(k, t)` with k = point index, t = 0..1 along the path.
   */
  tube(path: P3[], radius: (k: number, t: number) => number, segs = 8, opts: { capStart?: boolean; capEnd?: boolean; rz?: (k: number, t: number) => number; perPoint?: (k: number, t: number) => void; up?: P3 } = {}): void {
    const n = path.length;
    if (n < 2) return;
    const T: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      const a = path[Math.max(0, k - 1)], b = path[Math.min(n - 1, k + 1)];
      T.push(new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize());
    }
    // Initial normal: perpendicular to T0, biased by `up`.
    const up = opts.up ? new THREE.Vector3(opts.up.x, opts.up.y, opts.up.z) : Math.abs(T[0].y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const Nn: THREE.Vector3[] = [];
    const B: THREE.Vector3[] = [];
    let nrm = up.clone().sub(T[0].clone().multiplyScalar(up.dot(T[0]))).normalize();
    for (let k = 0; k < n; k++) {
      if (k > 0) {
        // parallel transport
        const axis = new THREE.Vector3().crossVectors(T[k - 1], T[k]);
        const s = axis.length();
        if (s > 1e-6) {
          const ang = Math.atan2(s, T[k - 1].dot(T[k]));
          nrm = nrm.clone().applyAxisAngle(axis.normalize(), ang);
        }
      }
      Nn.push(nrm.clone());
      B.push(new THREE.Vector3().crossVectors(T[k], nrm).normalize());
    }
    const total = (() => {
      let L = 0;
      for (let k = 1; k < n; k++) L += Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y, path[k].z - path[k - 1].z);
      return L || 1;
    })();
    const tAt: number[] = [0];
    for (let k = 1; k < n; k++) tAt.push(tAt[k - 1] + Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y, path[k].z - path[k - 1].z) / total);
    const capS = opts.capStart ? 1 : 0;
    const capE = opts.capEnd ? 1 : 0;
    const rows = n + capS + capE;
    this.grid(
      segs,
      rows - 1,
      (_i, j, u, _v, out) => {
        let k = j - capS;
        let shrink = 1;
        if (k < 0) {
          k = 0;
          shrink = 0;
        } else if (k > n - 1) {
          k = n - 1;
          shrink = 0;
        }
        const t = tAt[k];
        opts.perPoint?.(k, t);
        const th = u * Math.PI * 2;
        const r = radius(k, t) * shrink;
        const r2 = (opts.rz ? opts.rz(k, t) : radius(k, t)) * shrink;
        const c = path[k];
        const cs = Math.cos(th), sn = Math.sin(th);
        out.x = c.x + Nn[k].x * cs * r + B[k].x * sn * r2;
        out.y = c.y + Nn[k].y * cs * r + B[k].y * sn * r2;
        out.z = c.z + Nn[k].z * cs * r + B[k].z * sn * r2;
      },
      { closedU: true },
    );
  }

  /** Copy an arbitrary BufferGeometry (non-indexed or indexed) with the current state. */
  addGeometry(g: THREE.BufferGeometry, m?: THREE.Matrix4, smooth = false): void {
    const pos = g.getAttribute('position');
    const index = g.getIndex();
    this.begin();
    const base = this.vertexCount;
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (m) _v.applyMatrix4(m);
      this.v3(_v.x, _v.y, _v.z);
    }
    if (index) for (let i = 0; i < index.count; i += 3) this.tri(base + index.getX(i), base + index.getX(i + 1), base + index.getX(i + 2));
    else for (let i = 0; i < pos.count; i += 3) this.tri(base + i, base + i + 1, base + i + 2);
    this.end(smooth);
  }

  private computeNormals(v0: number, v1: number, i0: number, i1: number, smooth: boolean): void {
    if (v1 <= v0) return;
    const P = this.P, N = this.N, I = this.I;
    for (let i = v0 * 3; i < v1 * 3; i++) N[i] = 0;
    for (let t = i0; t < i1; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const abx = P[b] - P[a], aby = P[b + 1] - P[a + 1], abz = P[b + 2] - P[a + 2];
      const acx = P[c] - P[a], acy = P[c + 1] - P[a + 1], acz = P[c + 2] - P[a + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      for (const o of [a, b, c]) {
        N[o] += nx;
        N[o + 1] += ny;
        N[o + 2] += nz;
      }
    }
    if (smooth) {
      // Average normals of coincident vertices (UV seams, poles) within this part.
      const map = new Map<string, number[]>();
      for (let i = v0; i < v1; i++) {
        const k = `${Math.round(P[i * 3] * 5000)},${Math.round(P[i * 3 + 1] * 5000)},${Math.round(P[i * 3 + 2] * 5000)}`;
        let l = map.get(k);
        if (!l) map.set(k, (l = []));
        l.push(i);
      }
      for (const l of map.values()) {
        if (l.length < 2) continue;
        let sx = 0, sy = 0, sz = 0;
        for (const i of l) {
          sx += N[i * 3];
          sy += N[i * 3 + 1];
          sz += N[i * 3 + 2];
        }
        for (const i of l) {
          N[i * 3] = sx;
          N[i * 3 + 1] = sy;
          N[i * 3 + 2] = sz;
        }
      }
    }
    for (let i = v0; i < v1; i++) {
      const x = N[i * 3], y = N[i * 3 + 1], z = N[i * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      N[i * 3] = x / l;
      N[i * 3 + 1] = y / l;
      N[i * 3 + 2] = z / l;
    }
  }

  /** Bake into a BufferGeometry with all character attributes. */
  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const n = this.vertexCount;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.M, 4));
    g.setAttribute('aTat', new THREE.Float32BufferAttribute(this.T, 3));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    return g;
  }
}
