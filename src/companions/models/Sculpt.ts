import * as THREE from 'three';
import { SimplexNoise } from '../../core/Noise';

/**
 * Signed-distance sculpting for creature bodies.
 *
 * A species describes a body part as a field — smooth unions of ellipsoids and
 * round cones — and `sculpt()` polygonises its zero level with surface nets,
 * projects the vertices onto the surface and takes normals from the field
 * gradient. Necks melt into shoulders and cheeks into muzzles without the
 * seams that overlapping primitive meshes show.
 *
 * Fields are plain functions of (x, y, z) in the owning bone's local space.
 * Their distances are approximate (ellipsoids, smooth unions), which is fine
 * for meshing as long as features stay well above the cell size.
 *
 * `drape()` builds thin layers that hug a field's surface (markings, blankets).
 */

export type Field = (x: number, y: number, z: number) => number;

const noise = new SimplexNoise(9157);

/** Polynomial smooth union; k = blend radius (m). */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Smooth intersection. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** Ellipsoid centred at (cx, cy, cz) with radii (rx, ry, rz). */
export function sdEllipsoid(x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): number {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const qx = px / rx, qy = py / ry, qz = pz / rz;
  const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}

/** Round cone (tapered capsule) from a (radius ra) to b (radius rb). */
export function sdRoundCone(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = x - ax, pay = y - ay, paz = z - az;
  const yy = pax * bax + pay * bay + paz * baz;
  const zz = yy - l2;
  const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
  const x2 = qx * qx + qy * qy + qz * qz;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * zz * zz * l2 > k) return Math.sqrt(x2 + zz * zz * l2) * il2 - rb;
  if (Math.sign(yy) * a2 * yy * yy * l2 < k) return Math.sqrt(x2 + yy * yy * l2) * il2 - ra;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
}

/** Two-octave 0..1 noise for fur lumps (displace a field by `-amp * lumps(...)`). */
export function lumps(x: number, y: number, z: number, freq: number, seed = 0): number {
  const n1 = noise.noise3(x * freq + seed, y * freq - seed * 0.7, z * freq + seed * 1.3);
  const n2 = noise.noise3(x * freq * 2.3 - seed, y * freq * 2.3, z * freq * 2.3 + 5.1);
  return 0.65 * (n1 * 0.5 + 0.5) + 0.35 * (n2 * 0.5 + 0.5);
}

export interface SculptOpts {
  min: [number, number, number];
  max: [number, number, number];
  /** Grid cell size (m). */
  cell: number;
  /** Pattern coordinates (metres) for the creature material; default (x, z). */
  uv?: (p: THREE.Vector3, n: THREE.Vector3) => [number, number];
  /** Field used for shading normals only (detail finer than the mesh can carry). */
  shade?: Field;
  /** Newton steps projecting vertices onto the surface (default 1). */
  project?: number;
}

// Cube corners: bit 0 = +x, bit 1 = +y, bit 2 = +z. Edges join corners differing in one bit.
const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
const EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];

/** Polygonise the zero level of `f` inside [min, max] (surface nets). */
export function sculpt(f: Field, o: SculptOpts): THREE.BufferGeometry {
  const h = o.cell;
  const [x0, y0, z0] = o.min;
  const nx = Math.max(2, Math.ceil((o.max[0] - x0) / h));
  const ny = Math.max(2, Math.ceil((o.max[1] - y0) / h));
  const nz = Math.max(2, Math.ceil((o.max[2] - z0) / h));
  const sx = nx + 1, sxy = sx * (ny + 1);
  const vals = new Float32Array(sxy * (nz + 1));

  // Coarse pass: blocks of C³ cells that are far from the surface skip exact evaluation.
  const C = 4;
  const bx = Math.ceil(nx / C), by = Math.ceil(ny / C), bz = Math.ceil(nz / C);
  const cx = bx + 1, cxy = cx * (by + 1);
  const coarse = new Float32Array(cxy * (bz + 1));
  for (let k = 0; k <= bz; k++) for (let j = 0; j <= by; j++) for (let i = 0; i <= bx; i++) coarse[i + cx * j + cxy * k] = f(x0 + i * C * h, y0 + j * C * h, z0 + k * C * h);
  const far = C * h * 2.2;
  const block = new Float32Array(bx * by * bz);
  for (let k = 0; k < bz; k++) {
    for (let j = 0; j < by; j++) {
      for (let i = 0; i < bx; i++) {
        let mn = Infinity, mx = -Infinity;
        for (let c = 0; c < 8; c++) {
          const v = coarse[i + (c & 1) + cx * (j + ((c >> 1) & 1)) + cxy * (k + (c >> 2))];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        block[i + bx * (j + by * k)] = mn > far ? mn : mx < -far ? mx : 0;
      }
    }
  }
  for (let k = 0; k <= nz; k++) {
    const z = z0 + k * h, kb = Math.min(bz - 1, Math.floor(k / C));
    for (let j = 0; j <= ny; j++) {
      const y = y0 + j * h, jb = Math.min(by - 1, Math.floor(j / C));
      for (let i = 0; i <= nx; i++) {
        const fb = block[Math.min(bx - 1, Math.floor(i / C)) + bx * (jb + by * kb)];
        vals[i + sx * j + sxy * k] = fb !== 0 ? fb : f(x0 + i * h, y, z);
      }
    }
  }

  // One vertex per cell that the surface crosses: the mean of its edge crossings.
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const P: number[] = [];
  const v8 = new Float32Array(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const base = i + sx * j + sxy * k;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[base + (c & 1) + sx * ((c >> 1) & 1) + sxy * (c >> 2)];
          v8[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let ax = 0, ay = 0, az = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = EA[e], b = EB[e];
          const va = v8[a], vb = v8[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          ax += (a & 1) + ((b & 1) - (a & 1)) * t;
          ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          az += (a >> 2) + ((b >> 2) - (a >> 2)) * t;
          n++;
        }
        cellVert[i + nx * (j + ny * k)] = P.length / 3;
        P.push(x0 + (i + ax / n) * h, y0 + (j + ay / n) * h, z0 + (k + az / n) * h);
      }
    }
  }

  // One quad per grid edge with a sign change, joining the four cells around it.
  const I: number[] = [];
  const cv = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : cellVert[i + nx * (j + ny * k)]);
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) I.push(a, d, c, a, c, b);
    else I.push(a, b, c, a, c, d);
  };
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const id = i + sx * j + sxy * k;
        const in0 = vals[id] < 0;
        if (i < nx && in0 !== vals[id + 1] < 0) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !in0);
        if (j < ny && in0 !== vals[id + sx] < 0) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !in0);
        if (k < nz && in0 !== vals[id + sxy] < 0) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !in0);
      }
    }
  }

  // Project vertices onto the surface; normals and pattern coordinates from the field.
  const N = new Float32Array(P.length);
  const UV = new Float32Array((P.length / 3) * 2);
  const g = new THREE.Vector3();
  const p = new THREE.Vector3();
  const shade = o.shade ?? f;
  for (let vi = 0; vi < P.length; vi += 3) {
    p.set(P[vi], P[vi + 1], P[vi + 2]);
    for (let it = 0; it < (o.project ?? 1); it++) {
      const d = f(p.x, p.y, p.z);
      gradient(f, p, h * 0.25, g);
      const l2 = g.lengthSq();
      if (l2 < 1e-10) break;
      const step = Math.max(-h * 0.5, Math.min(h * 0.5, d / Math.sqrt(l2)));
      p.addScaledVector(g, -step / Math.sqrt(l2));
    }
    P[vi] = p.x;
    P[vi + 1] = p.y;
    P[vi + 2] = p.z;
    gradient(shade, p, h * 0.25, g).normalize();
    N[vi] = g.x;
    N[vi + 1] = g.y;
    N[vi + 2] = g.z;
    const uv = o.uv ? o.uv(p, g) : [p.x, p.z];
    UV[(vi / 3) * 2] = uv[0];
    UV[(vi / 3) * 2 + 1] = uv[1];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  geo.setIndex(I);
  return geo;
}

/**
 * Ambient occlusion per vertex from the field: how much room there is above
 * the surface (1 = open, 0 = deep crease). Bakes contact shading into colours.
 */
export function occlusionOf(g: THREE.BufferGeometry, f: Field, reach = 0.3): Float32Array {
  const pos = g.attributes.position as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute;
  const out = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const v = f(pos.getX(i) + nrm.getX(i) * reach, pos.getY(i) + nrm.getY(i) * reach, pos.getZ(i) + nrm.getZ(i) * reach);
    out[i] = Math.max(0, Math.min(1, v / reach));
  }
  return out;
}

/**
 * A lock of fur (or a mane strand): a tapering tube from `base` along `dir`
 * that droops under its own weight and ends in a point (taper < 1 keeps it
 * plump, > 1 makes it wispy). Open at the base, which is meant to sit inside
 * the surface it grows from.
 */
export function furLock(base: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, droop = 0.25, radial = 6, rings = 4, taper = 0.75): THREE.BufferGeometry {
  const d = dir.clone().normalize();
  const mid = base.clone().addScaledVector(d, len * 0.55);
  mid.y -= droop * len * 0.25;
  const tip = base.clone().addScaledVector(d, len);
  tip.y -= droop * len;
  const a = tip.clone().sub(base).normalize();
  const ref = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const P: number[] = [], UV: number[] = [], I: number[] = [];
  const pt = new THREE.Vector3(), tan = new THREE.Vector3(), nn = new THREE.Vector3(), bb = new THREE.Vector3();
  const at = (t: number, out: THREE.Vector3) => {
    const u = 1 - t;
    return out.set(u * u * base.x + 2 * u * t * mid.x + t * t * tip.x, u * u * base.y + 2 * u * t * mid.y + t * t * tip.y, u * u * base.z + 2 * u * t * mid.z + t * t * tip.z);
  };
  for (let k = 0; k < rings; k++) {
    const t = k / rings;
    at(t, pt);
    at(Math.min(1, t + 0.05), tan).sub(at(Math.max(0, t - 0.05), bb)).normalize();
    nn.crossVectors(tan, ref).normalize();
    bb.crossVectors(tan, nn).normalize();
    const rr = r * Math.pow(1 - t, taper) * (k === 0 ? 1 : 1 + 0.12 * Math.sin(k * 2.1));
    for (let j = 0; j < radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      P.push(pt.x + (nn.x * c + bb.x * s) * rr, pt.y + (nn.y * c + bb.y * s) * rr, pt.z + (nn.z * c + bb.z * s) * rr);
      UV.push((j / radial) * r * 6, t * len);
    }
  }
  P.push(tip.x, tip.y, tip.z);
  UV.push(0, len);
  for (let k = 0; k < rings - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const a0 = k * radial + j, a1 = k * radial + ((j + 1) % radial);
      const b0 = a0 + radial, b1 = a1 + radial;
      I.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const tipI = rings * radial, last = (rings - 1) * radial;
  for (let j = 0; j < radial; j++) I.push(last + j, tipI, last + ((j + 1) % radial));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  // Faces must wind outward: check one side quad against the radial direction.
  const p0 = new THREE.Vector3().fromArray(P, 0), p1 = new THREE.Vector3().fromArray(P, radial * 3), p2 = new THREE.Vector3().fromArray(P, 3);
  const fn = p1.clone().sub(p0).cross(p2.clone().sub(p0));
  if (fn.dot(p0.clone().sub(base)) < 0) {
    const idx = g.index!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}

/** Field gradient by central differences (unnormalised direction, |g| ≈ 1 for distances). */
export function gradient(f: Field, p: THREE.Vector3, eps: number, out = new THREE.Vector3()): THREE.Vector3 {
  const i2 = 1 / (2 * eps);
  return out.set(
    (f(p.x + eps, p.y, p.z) - f(p.x - eps, p.y, p.z)) * i2,
    (f(p.x, p.y + eps, p.z) - f(p.x, p.y - eps, p.z)) * i2,
    (f(p.x, p.y, p.z + eps) - f(p.x, p.y, p.z - eps)) * i2,
  );
}

/** Outward unit normal of the field at p. */
export function fieldNormal(f: Field, p: THREE.Vector3, eps = 0.01): THREE.Vector3 {
  return gradient(f, p, eps).normalize();
}

/** March from `from` along unit `dir` to the field's surface (null if missed within maxT). */
export function surfaceHit(f: Field, from: THREE.Vector3, dir: THREE.Vector3, maxT = 12): THREE.Vector3 | null {
  const p = new THREE.Vector3();
  let t = 0;
  let prev = f(from.x, from.y, from.z);
  if (prev < 0) return from.clone();
  for (let i = 0; i < 400 && t < maxT; i++) {
    const step = Math.max(prev * 0.7, 0.004);
    p.copy(from).addScaledVector(dir, t + step);
    const v = f(p.x, p.y, p.z);
    if (v < 0) {
      // Bisect the bracketed crossing.
      let lo = t, hi = t + step;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        p.copy(from).addScaledVector(dir, mid);
        if (f(p.x, p.y, p.z) < 0) hi = mid;
        else lo = mid;
      }
      return p.copy(from).addScaledVector(dir, hi);
    }
    t += step;
    prev = v;
  }
  return null;
}

/**
 * A polyline in the YZ plane (x = 0) traced over a field's surface, measured by
 * arc length — the "midline" that markings running along a body follow.
 */
export class SurfacePath {
  readonly pts: THREE.Vector3[] = [];
  readonly s: number[] = [];

  constructor(pts: THREE.Vector3[]) {
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) acc += pts[i].distanceTo(pts[i - 1]);
      this.pts.push(pts[i]);
      this.s.push(acc);
    }
  }

  get length(): number {
    return this.s[this.s.length - 1];
  }

  /** Point at arc length s, with the in-plane outward normal (perpendicular to the path, turned toward `outward`). */
  at(s: number, outward: (p: THREE.Vector3) => THREE.Vector3): { p: THREE.Vector3; n: THREE.Vector3 } {
    const S = this.s, P = this.pts;
    let i = 1;
    while (i < S.length - 1 && S[i] < s) i++;
    const t = Math.max(0, Math.min(1, (s - S[i - 1]) / Math.max(1e-6, S[i] - S[i - 1])));
    const p = P[i - 1].clone().lerp(P[i], t);
    const tan = P[i].clone().sub(P[i - 1]).normalize();
    const n = new THREE.Vector3(0, -tan.z, tan.y);
    if (n.dot(outward(p)) < 0) n.negate();
    return { p, n };
  }

  /** Arc length of the path point nearest to (y, z), and the distance to it. */
  project(y: number, z: number): { s: number; d: number } {
    const P = this.pts, S = this.s;
    let best = Infinity, bs = 0;
    for (let i = 1; i < P.length; i++) {
      const ay = P[i - 1].y, az = P[i - 1].z;
      const dy = P[i].y - ay, dz = P[i].z - az;
      const l2 = dy * dy + dz * dz;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((y - ay) * dy + (z - az) * dz) / l2)) : 0;
      const ey = ay + dy * t - y, ez = az + dz * t - z;
      const d2 = ey * ey + ez * ez;
      if (d2 < best) {
        best = d2;
        bs = S[i - 1] + (S[i] - S[i - 1]) * t;
      }
    }
    return { s: bs, d: Math.sqrt(best) };
  }
}

export interface DrapeOpts {
  /** Rows (arc length along the path) and the half-width of the layer at each row. */
  rows: number[];
  halfWidth: (s: number, row: number) => number;
  cols: number;
  /** Height above the surface (m). */
  lift: number;
  /** Outward direction used to aim rays at the surface from the path. */
  outward: (p: THREE.Vector3) => THREE.Vector3;
}

/**
 * A thin layer hugging the field's surface along a SurfacePath: each row is a
 * span [-w, w] across (x), cast onto the surface and lifted by `lift`.
 * Pattern coordinates are (across, along) in metres.
 */
export function drape(f: Field, path: SurfacePath, o: DrapeOpts): THREE.BufferGeometry {
  const P: number[] = [], N: number[] = [], UV: number[] = [], I: number[] = [];
  const dir = new THREE.Vector3();
  const from = new THREE.Vector3();
  const cols = Math.max(1, o.cols);
  for (let r = 0; r < o.rows.length; r++) {
    const s = o.rows[r];
    const w = Math.max(0, o.halfWidth(s, r));
    const { p, n } = path.at(s, o.outward);
    for (let c = 0; c <= cols; c++) {
      const x = -w + (2 * w * c) / cols;
      from.set(x, p.y + n.y * 1.2, p.z + n.z * 1.2);
      dir.set(0, -n.y, -n.z);
      const hit = surfaceHit(f, from, dir, 4) ?? new THREE.Vector3(x, p.y, p.z);
      const nn = fieldNormal(f, hit);
      hit.addScaledVector(nn, o.lift);
      P.push(hit.x, hit.y, hit.z);
      N.push(nn.x, nn.y, nn.z);
      UV.push(x, s);
    }
    if (r > 0) {
      const a0 = (r - 1) * (cols + 1), b0 = r * (cols + 1);
      for (let c = 0; c < cols; c++) I.push(a0 + c, a0 + c + 1, b0 + c, a0 + c + 1, b0 + c + 1, b0 + c);
    }
  }
  // Wind the faces toward the surface normal (the path may run either way).
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  let facing = 0;
  for (let t = 0; t < I.length; t += 3) {
    va.fromArray(P, I[t] * 3);
    vb.fromArray(P, I[t + 1] * 3).sub(va);
    vc.fromArray(P, I[t + 2] * 3).sub(va);
    facing += vb.cross(vc).dot(va.fromArray(N, I[t] * 3));
  }
  if (facing < 0) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setIndex(I);
  return geo;
}
