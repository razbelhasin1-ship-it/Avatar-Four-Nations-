import * as THREE from 'three';
import { SimplexNoise } from '../../core/Noise';
import { Random } from '../../core/Random';

/**
 * Procedural, stylised vegetation and rock models built from simple primitives
 * with baked vertex colours (soft painterly gradients, darker canopy cores) and
 * a per-vertex `veg` attribute: x = wind weight (0 at the base, 1 at the tips),
 * y = how much the per-instance tint applies (leaves/petals yes, trunks no).
 *
 * Every species has up to three LODs (near / mid / far) sharing the same
 * silhouette so LOD swaps (dithered cross-fades) are not noticeable.
 */

export type SpeciesId =
  | 'broadleaf'
  | 'conifer'
  | 'pine_snow'
  | 'palm'
  | 'banyan'
  | 'mangrove'
  | 'bamboo'
  | 'blossom'
  | 'deadtree'
  | 'acacia'
  | 'bush'
  | 'bush_snow'
  | 'shrub_dry'
  | 'rock'
  | 'flowers'
  | 'reeds'
  | 'fern';

export type SpeciesCategory = 'tree' | 'bush' | 'rock' | 'small';

export interface SpeciesDef {
  id: SpeciesId;
  category: SpeciesCategory;
  /** Wind flexibility multiplier. */
  flex: number;
  /** Bends away from the player / impulses. */
  push: number;
  /** Casts shadows at LOD0. */
  shadow: boolean;
  /** Trunk collider radius at scale 1 (0 = none). */
  trunkR: number;
  /** Approximate height at scale 1 (culling). */
  height: number;
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  broadleaf: { id: 'broadleaf', category: 'tree', flex: 0.5, push: 0, shadow: true, trunkR: 0.35, height: 7 },
  conifer: { id: 'conifer', category: 'tree', flex: 0.35, push: 0, shadow: true, trunkR: 0.3, height: 11 },
  pine_snow: { id: 'pine_snow', category: 'tree', flex: 0.3, push: 0, shadow: true, trunkR: 0.3, height: 10 },
  palm: { id: 'palm', category: 'tree', flex: 0.8, push: 0, shadow: true, trunkR: 0.25, height: 8 },
  banyan: { id: 'banyan', category: 'tree', flex: 0.25, push: 0, shadow: true, trunkR: 1.25, height: 10 },
  mangrove: { id: 'mangrove', category: 'tree', flex: 0.45, push: 0, shadow: true, trunkR: 0.3, height: 6 },
  bamboo: { id: 'bamboo', category: 'tree', flex: 1.0, push: 0.25, shadow: true, trunkR: 0.45, height: 9 },
  blossom: { id: 'blossom', category: 'tree', flex: 0.55, push: 0, shadow: true, trunkR: 0.3, height: 6 },
  deadtree: { id: 'deadtree', category: 'tree', flex: 0.15, push: 0, shadow: true, trunkR: 0.3, height: 6 },
  acacia: { id: 'acacia', category: 'tree', flex: 0.4, push: 0, shadow: true, trunkR: 0.3, height: 6 },
  bush: { id: 'bush', category: 'bush', flex: 0.6, push: 0.55, shadow: false, trunkR: 0, height: 1.6 },
  bush_snow: { id: 'bush_snow', category: 'bush', flex: 0.4, push: 0.4, shadow: false, trunkR: 0, height: 1.4 },
  shrub_dry: { id: 'shrub_dry', category: 'bush', flex: 0.5, push: 0.5, shadow: false, trunkR: 0, height: 1.1 },
  rock: { id: 'rock', category: 'rock', flex: 0, push: 0, shadow: true, trunkR: 0, height: 1.4 },
  flowers: { id: 'flowers', category: 'small', flex: 1.0, push: 1.0, shadow: false, trunkR: 0, height: 0.5 },
  reeds: { id: 'reeds', category: 'small', flex: 1.2, push: 0.9, shadow: false, trunkR: 0, height: 1.8 },
  fern: { id: 'fern', category: 'small', flex: 0.8, push: 0.9, shadow: false, trunkR: 0, height: 0.8 },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

const noise3 = new SimplexNoise(31337);
const tmpC = new THREE.Color();

function lin(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/** Accumulates indexed triangles with position/normal/colour/veg attributes. */
class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  veg: number[] = [];
  idx: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color, wind: number, tint: number): number {
    this.pos.push(x, y, z);
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    this.nor.push(nx / l, ny / l, nz / l);
    this.col.push(c.r, c.g, c.b);
    this.veg.push(wind, tint);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Tapered cylinder between two points (open ends), colour gradient bottom->top. */
  tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg: number, c0: THREE.Color, c1: THREE.Color, w0: number, w1: number, tint = 0, rings = 1): void {
    const axis = b.clone().sub(a);
    const len = axis.length();
    axis.normalize();
    const ref = Math.abs(axis.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const base = this.pos.length / 3;
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const rad = r0 + (r1 - r0) * t;
      const center = a.clone().addScaledVector(axis, len * t);
      tmpC.copy(c0).lerp(c1, t);
      for (let s = 0; s < seg; s++) {
        const ang = (s / seg) * Math.PI * 2;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const nx = u.x * dx + v.x * dy, ny = u.y * dx + v.y * dy, nz = u.z * dx + v.z * dy;
        this.vertex(center.x + nx * rad, center.y + ny * rad, center.z + nz * rad, nx, ny, nz, tmpC, w0 + (w1 - w0) * t, tint);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < seg; s++) {
        const s1 = (s + 1) % seg;
        const i0 = base + r * seg + s, i1 = base + r * seg + s1, j0 = base + (r + 1) * seg + s, j1 = base + (r + 1) * seg + s1;
        this.tri(i0, j0, i1);
        this.tri(i1, j0, j1);
      }
    }
  }

  /** Cone with a jittered, drooping rim (conifer tiers). */
  cone(baseY: number, apexY: number, r: number, seg: number, cBase: THREE.Color, cTip: THREE.Color, w0: number, w1: number, rng: Random, droop = 0.25, snow: THREE.Color | null = null): void {
    const base = this.pos.length / 3;
    const slope = r / (apexY - baseY);
    for (let s = 0; s < seg; s++) {
      const ang = (s / seg) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const rr = r * rng.range(0.82, 1.12);
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const ny = slope;
      const y = baseY - droop * rng.range(0.5, 1.2);
      this.vertex(dx * rr, y, dz * rr, dx, ny, dz, cBase, w0, 1);
    }
    const apex = this.vertex(0, apexY, 0, 0, 1, 0, snow ?? cTip, w1, snow ? 0.3 : 1);
    // Mid ring so snow can sit on the upper half.
    const mid = this.pos.length / 3;
    for (let s = 0; s < seg; s++) {
      const i = base + s;
      const x = this.pos[i * 3] * 0.5, z = this.pos[i * 3 + 2] * 0.5, y = (this.pos[i * 3 + 1] + apexY) * 0.5;
      const dx = Math.cos((s / seg) * Math.PI * 2), dz = Math.sin((s / seg) * Math.PI * 2);
      this.vertex(x, y, z, dx, slope, dz, snow ? snow : tmpC.copy(cBase).lerp(cTip, 0.5), (w0 + w1) / 2, snow ? 0.35 : 1);
    }
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      this.tri(base + s, mid + s, base + s1);
      this.tri(base + s1, mid + s, mid + s1);
      this.tri(mid + s, apex, mid + s1);
    }
    // Underside (dark) so tiers read from below.
    const under = this.vertex(0, baseY + (apexY - baseY) * 0.15, 0, 0, -1, 0, tmpC.copy(cBase).multiplyScalar(0.45), w0, 1);
    for (let s = 0; s < seg; s++) this.tri(base + (s + 1) % seg, under, base + s);
  }

  /**
   * Noise-displaced icosphere blob. Normals point away from `nc` (canopy centre)
   * blended with the blob normal — the classic soft stylised foliage look.
   */
  blob(center: THREE.Vector3, radii: THREE.Vector3, detail: number, seed: number, jitter: number, colorFn: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color, wind: number, tint: number, nc: THREE.Vector3 | null = null, flat = false): void {
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const p = geo.getAttribute('position');
    const tmp = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < p.count; i++) {
      tmp.fromBufferAttribute(p, i).normalize();
      const n = 1 + jitter * noise3.noise3(tmp.x * 1.7 + seed, tmp.y * 1.7 - seed * 0.3, tmp.z * 1.7 + seed * 0.7);
      verts.push(new THREE.Vector3(center.x + tmp.x * radii.x * n, center.y + tmp.y * radii.y * n, center.z + tmp.z * radii.z * n));
    }
    // Icosahedron geometry is non-indexed: build per-face or merged vertices.
    if (flat) {
      for (let i = 0; i < verts.length; i += 3) {
        const a = verts[i], b = verts[i + 1], c = verts[i + 2];
        nrm.subVectors(b, a).cross(tmp.subVectors(c, a)).normalize();
        const col = colorFn(a.clone().add(b).add(c).multiplyScalar(1 / 3), nrm);
        const ia = this.vertex(a.x, a.y, a.z, nrm.x, nrm.y, nrm.z, col, wind, tint);
        const ib = this.vertex(b.x, b.y, b.z, nrm.x, nrm.y, nrm.z, col, wind, tint);
        const ic = this.vertex(c.x, c.y, c.z, nrm.x, nrm.y, nrm.z, col, wind, tint);
        this.tri(ia, ib, ic);
      }
    } else {
      // Weld identical positions for smooth shading.
      const map = new Map<string, number>();
      const local: number[] = [];
      for (let i = 0; i < verts.length; i++) {
        tmp.fromBufferAttribute(p, i);
        const key = `${tmp.x.toFixed(4)},${tmp.y.toFixed(4)},${tmp.z.toFixed(4)}`;
        let id = map.get(key);
        if (id === undefined) {
          const v = verts[i];
          nrm.copy(v).sub(nc ?? center).normalize();
          const own = tmp.clone().normalize();
          nrm.lerp(own, nc ? 0.35 : 1).normalize();
          const col = colorFn(v, nrm);
          id = this.vertex(v.x, v.y, v.z, nrm.x, nrm.y, nrm.z, col, wind, tint);
          map.set(key, id);
        }
        local.push(id);
      }
      for (let i = 0; i < local.length; i += 3) this.tri(local[i], local[i + 1], local[i + 2]);
    }
    geo.dispose();
  }

  /** Curved strip (palm frond, fern frond, reed blade). */
  strip(points: THREE.Vector3[], widths: number[], side: THREE.Vector3, c0: THREE.Color, c1: THREE.Color, w0: number, w1: number, tint = 1, foldUp = 0.25): void {
    const base = this.pos.length / 3;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = points[i];
      const dir = (i < n - 1 ? points[i + 1].clone().sub(p) : p.clone().sub(points[i - 1])).normalize();
      const nrm = new THREE.Vector3().crossVectors(side, dir).normalize();
      if (nrm.y < 0) nrm.negate();
      tmpC.copy(c0).lerp(c1, t);
      const w = widths[i];
      const wt = w0 + (w1 - w0) * t;
      this.vertex(p.x - side.x * w, p.y - side.y * w + w * foldUp, p.z - side.z * w, nrm.x, nrm.y, nrm.z, tmpC, wt, tint);
      this.vertex(p.x, p.y, p.z, nrm.x, nrm.y, nrm.z, tmpC, wt, tint);
      this.vertex(p.x + side.x * w, p.y + side.y * w + w * foldUp, p.z + side.z * w, nrm.x, nrm.y, nrm.z, tmpC, wt, tint);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 3, b = base + (i + 1) * 3;
      this.tri(a, b, a + 1);
      this.tri(a + 1, b, b + 1);
      this.tri(a + 1, b + 1, a + 2);
      this.tri(a + 2, b + 1, b + 2);
      // back faces
      this.tri(a + 1, b, a);
      this.tri(b + 1, b, a + 1);
      this.tri(b + 1, a + 1, a + 2);
      this.tri(b + 2, b + 1, a + 2);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('veg', new THREE.Float32BufferAttribute(this.veg, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Foliage colour: darker inside/below, lighter on top. */
function foliageColor(dark: THREE.Color, mid: THREE.Color, light: THREE.Color, top: number, bottom: number) {
  const out = new THREE.Color();
  return (p: THREE.Vector3, n: THREE.Vector3): THREE.Color => {
    const h = Math.min(1, Math.max(0, (p.y - bottom) / Math.max(0.01, top - bottom)));
    const up = Math.max(0, n.y);
    out.copy(dark).lerp(mid, Math.min(1, h * 1.3)).lerp(light, Math.max(0, up * 0.55 + h * 0.35 - 0.3));
    return out;
  };
}

// ---------------------------------------------------------------------------
// Species builders: return [lod0, lod1, lod2] (lod2 may be null)
// ---------------------------------------------------------------------------

type LODs = [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry | null];

function broadleaf(): LODs {
  const trunk0 = lin('#4f3a2b'), trunk1 = lin('#6f5642');
  const dark = lin('#29421c'), mid = lin('#4c7a2c'), light = lin('#8bb64e');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(11);
    const seg = lod === 0 ? 7 : lod === 1 ? 5 : 4;
    g.tube(V(0, -0.4, 0), V(0.15, 3.4, 0.05), 0.34, 0.17, seg, trunk0, trunk1, 0, 0.15, 0, lod === 0 ? 3 : 1);
    if (lod === 0) {
      g.tube(V(0.1, 2.6, 0), V(1.3, 4.0, 0.4), 0.12, 0.05, 5, trunk1, trunk1, 0.1, 0.45);
      g.tube(V(0.1, 2.8, 0), V(-1.1, 4.2, -0.5), 0.11, 0.05, 5, trunk1, trunk1, 0.1, 0.45);
      g.tube(V(0.1, 3.0, 0), V(0.2, 4.4, -1.2), 0.1, 0.05, 5, trunk1, trunk1, 0.1, 0.45);
    }
    const nc = V(0.1, 4.6, 0);
    const col = foliageColor(dark, mid, light, 6.8, 2.6);
    const blobs = lod === 2 ? [[0.1, 4.7, 0, 2.6]] : [[0.1, 4.9, 0, 2.1], [1.5, 4.3, 0.5, 1.5], [-1.4, 4.4, -0.4, 1.5], [0.3, 4.2, -1.5, 1.4], [-0.3, 4.0, 1.5, 1.4], [0.9, 5.7, -0.6, 1.3], [-0.8, 5.6, 0.7, 1.2]];
    const det = lod === 0 ? 2 : 1;
    for (const [x, y, z, r] of blobs) {
      g.blob(V(x, y, z), V(r, r * 0.85, r), lod === 2 ? 1 : det, rng.range(0, 100), 0.18, col, 0.8, 1, nc);
    }
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function conifer(snow: boolean): LODs {
  const trunk0 = lin('#4a372a'), trunk1 = lin('#5d4535');
  const base = snow ? lin('#2f4b38') : lin('#2a4c34'), tip = snow ? lin('#46694c') : lin('#4c7d50');
  const snowC = snow ? lin('#eef4fb') : null;
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(snow ? 23 : 21);
    g.tube(V(0, -0.4, 0), V(0, 9.5, 0), 0.28, 0.06, lod === 0 ? 6 : 4, trunk0, trunk1, 0, 0.3, 0, 1);
    const tiers = lod === 0 ? 5 : lod === 1 ? 3 : 1;
    const seg = lod === 0 ? 9 : lod === 1 ? 7 : 6;
    for (let i = 0; i < tiers; i++) {
      const t = tiers === 1 ? 0 : i / (tiers - 1);
      const y0 = tiers === 1 ? 1.6 : 1.6 + t * 6.2;
      const h = tiers === 1 ? 9.6 : 3.4 - t * 1.4;
      const r = tiers === 1 ? 2.3 : 2.5 - t * 1.75;
      g.cone(y0, y0 + h, r, seg, base, tip, 0.25 + t * 0.3, 0.5 + t * 0.4, rng, lod === 0 ? 0.35 : 0.2, snowC);
    }
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function palm(): LODs {
  const trunk0 = lin('#7a6247'), trunk1 = lin('#9a845e');
  const f0 = lin('#3f7428'), f1 = lin('#86b44a');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    // Curved trunk.
    const pts: THREE.Vector3[] = [];
    const n = lod === 0 ? 7 : 4;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(V(Math.sin(t * 1.4) * 1.3, -0.3 + t * 7.4, 0));
    }
    for (let i = 0; i < n; i++) g.tube(pts[i], pts[i + 1], 0.24 - i * 0.012, 0.23 - (i + 1) * 0.012, lod === 0 ? 6 : 4, trunk0, trunk1, i / n * 0.4, (i + 1) / n * 0.4, 0, 1);
    const top = pts[n];
    const fronds = lod === 0 ? 9 : lod === 1 ? 6 : 5;
    for (let k = 0; k < fronds; k++) {
      const a = (k / fronds) * Math.PI * 2 + 0.3;
      const dir = V(Math.cos(a), 0, Math.sin(a));
      const side = V(-dir.z, 0, dir.x);
      const segs = lod === 0 ? 6 : 3;
      const fp: THREE.Vector3[] = [];
      const ws: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        fp.push(top.clone().addScaledVector(dir, t * 3.6).add(V(0, 0.6 * Math.sin(t * Math.PI * 0.6) - t * t * 2.2, 0)));
        ws.push(0.08 + 0.42 * Math.sin(t * Math.PI) * (1 - t * 0.3));
      }
      g.strip(fp, ws, side, f0, f1, 0.5, 1.0, 1, -0.15);
    }
    if (lod === 0) {
      const nut = lin('#5a4a2c');
      for (let k = 0; k < 3; k++) g.blob(top.clone().add(V(Math.cos(k * 2.1) * 0.3, -0.35, Math.sin(k * 2.1) * 0.3)), V(0.2, 0.22, 0.2), 0, k, 0.05, () => nut, 0.4, 0);
    }
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function banyan(): LODs {
  const bark0 = lin('#4b4636'), bark1 = lin('#6a6450');
  const dark = lin('#22331a'), mid = lin('#3e5a28'), light = lin('#6f8f3c');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(31);
    g.tube(V(0, -0.5, 0), V(0.3, 6.5, 0.2), 1.3, 0.75, lod === 0 ? 10 : 6, bark0, bark1, 0, 0.1, 0, lod === 0 ? 3 : 1);
    // Buttress roots.
    const roots = lod === 0 ? 7 : lod === 1 ? 5 : 0;
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * Math.PI * 2 + rng.range(-0.2, 0.2);
      g.tube(V(Math.cos(a) * 0.6, 1.8, Math.sin(a) * 0.6), V(Math.cos(a) * 2.6, -0.4, Math.sin(a) * 2.6), 0.45, 0.15, 5, bark1, bark0, 0, 0);
    }
    // Aerial roots dropping from the canopy.
    const aerial = lod === 0 ? 12 : lod === 1 ? 6 : 0;
    for (let i = 0; i < aerial; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(2.6, 5.2);
      g.tube(V(Math.cos(a) * r, 7.4, Math.sin(a) * r), V(Math.cos(a) * r * 1.05, -0.3, Math.sin(a) * r * 1.05), 0.08, 0.12, 4, bark1, bark0, 0.25, 0.05);
    }
    const nc = V(0, 8, 0);
    const col = foliageColor(dark, mid, light, 10.5, 6.5);
    const blobs = lod === 2 ? [[0, 8.4, 0, 5.6]] : [[0, 8.8, 0, 3.4], [3.2, 8.0, 0.8, 2.8], [-3.0, 8.2, -0.6, 2.9], [0.6, 8.1, 3.1, 2.7], [-0.8, 8.0, -3.2, 2.7], [2.3, 9.4, -2.1, 2.2], [-2.2, 9.5, 2.0, 2.2]];
    for (const [x, y, z, r] of blobs) g.blob(V(x, y, z), V(r, r * 0.55, r), lod === 0 ? 2 : 1, rng.range(0, 99), 0.2, col, 0.55, 1, nc);
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function mangrove(): LODs {
  const bark0 = lin('#4a4034'), bark1 = lin('#655846');
  const dark = lin('#26391d'), mid = lin('#46642b'), light = lin('#7c9a44');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(37);
    g.tube(V(0, 0.4, 0), V(0.1, 4.2, 0), 0.24, 0.13, lod === 0 ? 6 : 4, bark0, bark1, 0.0, 0.25);
    // Arching prop roots springing from the lower trunk and curving down into the mud.
    const roots = lod === 0 ? 11 : lod === 1 ? 6 : 4;
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const r = rng.range(0.95, 1.75);
      const y0 = rng.range(0.9, 2.1);
      const ca = Math.cos(a), sa = Math.sin(a);
      const p0 = V(ca * 0.14, y0, sa * 0.14);
      const p1 = V(ca * r * 0.5, y0 + 0.22, sa * r * 0.5);
      const p2 = V(ca * r * 0.88, y0 * 0.5, sa * r * 0.88);
      const p3 = V(ca * r * 1.02, -0.45, sa * r * 1.02);
      const seg = lod === 0 ? 4 : 3;
      g.tube(p0, p1, 0.075, 0.06, seg, bark1, bark1, 0.02, 0.02);
      if (lod < 2) {
        g.tube(p1, p2, 0.06, 0.055, seg, bark1, bark0, 0.02, 0);
        g.tube(p2, p3, 0.055, 0.05, seg, bark0, bark0, 0, 0);
      } else g.tube(p1, p3, 0.06, 0.05, seg, bark1, bark0, 0.02, 0);
    }
    const nc = V(0, 4.8, 0);
    const col = foliageColor(dark, mid, light, 6.5, 3.6);
    const blobs = lod === 2 ? [[0, 4.9, 0, 2.2]] : [[0, 5.0, 0, 1.7], [1.2, 4.5, 0.4, 1.3], [-1.1, 4.6, -0.5, 1.3], [0.2, 4.4, -1.3, 1.2], [-0.3, 4.4, 1.2, 1.2]];
    for (const [x, y, z, r] of blobs) g.blob(V(x, y, z), V(r, r * 0.7, r), lod === 0 ? 2 : 1, rng.range(0, 99), 0.18, col, 0.7, 1, nc);
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function bamboo(): LODs {
  const stalk0 = lin('#6f8a33'), stalk1 = lin('#a3b552');
  const leaf0 = lin('#3c6a26'), leaf1 = lin('#78a63e');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(41);
    const stalks = lod === 0 ? 11 : lod === 1 ? 7 : 4;
    for (let i = 0; i < stalks; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 0.8);
      const h = rng.range(6, 9.5);
      const lean = rng.range(0.4, 1.2);
      const b = V(Math.cos(a) * r, -0.3, Math.sin(a) * r);
      const t = V(Math.cos(a) * (r + lean), h, Math.sin(a) * (r + lean));
      g.tube(b, t, 0.08, 0.05, lod === 0 ? 5 : 3, stalk0, stalk1, 0, 1, 0, lod === 0 ? 4 : 1);
      if (lod < 2) {
        const tufts = lod === 0 ? 4 : 2;
        for (let k = 0; k < tufts; k++) {
          const tt = 0.55 + (k / tufts) * 0.45;
          const p = b.clone().lerp(t, tt);
          const da = rng.range(0, Math.PI * 2);
          const dir = V(Math.cos(da), -0.25, Math.sin(da)).normalize();
          const side = V(-dir.z, 0, dir.x);
          g.strip([p, p.clone().addScaledVector(dir, 0.8), p.clone().addScaledVector(dir, 1.5).add(V(0, -0.25, 0))], [0.02, 0.13, 0.02], side, leaf0, leaf1, 0.7 + tt * 0.3, 1.0, 1, 0);
        }
      } else {
        g.blob(t.clone().add(V(0, -1.2, 0)), V(1.0, 1.4, 1.0), 0, i, 0.2, () => leaf0, 0.9, 1);
      }
    }
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function blossom(): LODs {
  const trunk0 = lin('#3f2c27'), trunk1 = lin('#58403a');
  const dark = lin('#c46e8e'), mid = lin('#ef9fbc'), light = lin('#fde1ea');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(51);
    g.tube(V(0, -0.4, 0), V(0.4, 1.8, 0.1), 0.26, 0.2, lod === 0 ? 6 : 4, trunk0, trunk1, 0, 0.1);
    g.tube(V(0.4, 1.8, 0.1), V(-0.2, 3.2, 0.3), 0.2, 0.13, lod === 0 ? 6 : 4, trunk1, trunk1, 0.1, 0.25);
    if (lod === 0) {
      g.tube(V(0.3, 2.2, 0.1), V(1.6, 3.4, -0.2), 0.1, 0.05, 4, trunk1, trunk1, 0.15, 0.5);
      g.tube(V(0.0, 2.8, 0.2), V(-1.5, 3.6, 0.6), 0.09, 0.05, 4, trunk1, trunk1, 0.15, 0.5);
    }
    const nc = V(0, 3.9, 0);
    const col = foliageColor(dark, mid, light, 5.4, 2.6);
    const blobs = lod === 2 ? [[0, 3.9, 0, 2.3]] : [[-0.1, 4.1, 0.2, 1.7], [1.4, 3.6, -0.2, 1.3], [-1.4, 3.7, 0.6, 1.3], [0.3, 3.5, 1.4, 1.1], [0.2, 3.6, -1.3, 1.2], [0.4, 4.7, -0.4, 1.0]];
    for (const [x, y, z, r] of blobs) g.blob(V(x, y, z), V(r, r * 0.75, r), lod === 0 ? 2 : 1, rng.range(0, 99), 0.22, col, 0.75, 1, nc);
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function deadtree(): LODs {
  const c0 = lin('#211c1b'), c1 = lin('#3d3532');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(61);
    const seg = lod === 0 ? 6 : 4;
    const p0 = V(0, -0.4, 0), p1 = V(0.3, 2.4, 0.1), p2 = V(-0.1, 4.6, 0.3);
    g.tube(p0, p1, 0.3, 0.2, seg, c0, c1, 0, 0.05);
    g.tube(p1, p2, 0.2, 0.08, seg, c1, c1, 0.05, 0.15);
    const branches = lod === 0 ? 6 : lod === 1 ? 4 : 2;
    for (let i = 0; i < branches; i++) {
      const t = rng.range(0.35, 0.95);
      const s = p1.clone().lerp(p2, t);
      const a = rng.range(0, Math.PI * 2);
      const e = s.clone().add(V(Math.cos(a) * rng.range(1, 2), rng.range(0.4, 1.4), Math.sin(a) * rng.range(1, 2)));
      g.tube(s, e, 0.08, 0.02, lod === 0 ? 4 : 3, c1, c1, 0.1, 0.3);
      if (lod === 0) {
        const e2 = e.clone().add(V(rng.range(-0.6, 0.6), rng.range(0.2, 0.7), rng.range(-0.6, 0.6)));
        g.tube(e, e2, 0.03, 0.01, 3, c1, c1, 0.3, 0.4);
      }
    }
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function acacia(): LODs {
  const trunk0 = lin('#4c3d2e'), trunk1 = lin('#6a5640');
  const dark = lin('#3c4a22'), mid = lin('#67792f'), light = lin('#a3ad52');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(71);
    g.tube(V(0, -0.4, 0), V(0.2, 2.4, 0), 0.26, 0.18, lod === 0 ? 6 : 4, trunk0, trunk1, 0, 0.1);
    const arms: Array<[number, number, number]> = [[1.6, 4.4, 0.6], [-1.4, 4.6, -0.5], [0.2, 4.8, -1.5]];
    for (const [x, y, z] of arms) g.tube(V(0.2, 2.3, 0), V(x, y, z), 0.15, 0.07, lod === 0 ? 5 : 3, trunk1, trunk1, 0.1, 0.35);
    const col = foliageColor(dark, mid, light, 5.6, 4.3);
    const blobs = lod === 2 ? [[0.1, 5.0, 0, 3.2]] : [[0.2, 5.1, 0, 2.6], [1.8, 4.9, 0.6, 1.9], [-1.6, 5.0, -0.5, 2.0]];
    for (const [x, y, z, r] of blobs) g.blob(V(x, y, z), V(r, r * 0.28, r), lod === 0 ? 2 : 1, rng.range(0, 99), 0.18, col, 0.6, 1, V(0, 4.6, 0));
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function bush(kind: 'green' | 'snow' | 'dry'): LODs {
  const dark = kind === 'dry' ? lin('#4d4a2a') : lin('#27401b');
  const mid = kind === 'dry' ? lin('#7c7440') : lin('#4a7330');
  const light = kind === 'snow' ? lin('#eef4f9') : kind === 'dry' ? lin('#a8a060') : lin('#86ad4c');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(kind === 'snow' ? 83 : kind === 'dry' ? 85 : 81);
    const nc = V(0, 0.4, 0);
    const base = foliageColor(dark, mid, light, 1.5, 0);
    const col = kind === 'snow'
      ? (p: THREE.Vector3, n: THREE.Vector3) => (n.y > 0.45 ? tmpC.copy(light) : base(p, n))
      : base;
    const blobs = lod === 2 ? [[0, 0.5, 0, 0.95]] : [[0, 0.55, 0, 0.8], [0.6, 0.45, 0.2, 0.6], [-0.5, 0.42, -0.25, 0.62], [0.1, 0.4, -0.6, 0.55]];
    const jitter = kind === 'dry' ? 0.45 : 0.2;
    for (const [x, y, z, r] of blobs) g.blob(V(x, y, z), V(r, r * 0.8, r), lod === 0 ? 2 : 1, rng.range(0, 99), jitter, col, 0.6, kind === 'snow' ? 0.4 : 1, nc);
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function rock(): LODs {
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const dark = lin('#5a5550'), mid = lin('#7d776f'), light = lin('#a29b90'), moss = lin('#5f7038');
    const col = (p: THREE.Vector3, n: THREE.Vector3) => {
      const c = tmpC.copy(dark).lerp(mid, Math.min(1, (p.y + 0.4) / 1.0)).lerp(light, Math.max(0, n.y) * 0.4);
      if (n.y > 0.75) c.lerp(moss, 0.35);
      return c;
    };
    g.blob(V(0, 0.25, 0), V(1, 0.66, 0.85), lod === 0 ? 2 : lod === 1 ? 1 : 0, 7, 0.32, col, 0, 1, null, true);
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function flowers(): LODs {
  const stem = lin('#3d6a28');
  const petal = lin('#ffffff');
  const centerC = lin('#f2c94c');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(91);
    const count = lod === 0 ? 9 : 5;
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 0.55);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = rng.range(0.22, 0.45);
      // Stem (thin blade).
      const side = V(Math.cos(a + 1.5), 0, Math.sin(a + 1.5));
      g.strip([V(x, -0.05, z), V(x + 0.02, h * 0.5, z), V(x, h, z)], [0.012, 0.01, 0.006], side, stem, stem, 0, 0.8, 0, 0);
      // Petals: a small star facing up.
      const petals = 5;
      const center = g.vertex(x, h + 0.01, z, 0, 1, 0, centerC, 1, 0);
      const ring: number[] = [];
      for (let k = 0; k < petals * 2; k++) {
        const pa = (k / (petals * 2)) * Math.PI * 2 + a;
        const pr = k % 2 === 0 ? 0.075 : 0.03;
        ring.push(g.vertex(x + Math.cos(pa) * pr, h - (k % 2 === 0 ? 0.015 : 0), z + Math.sin(pa) * pr, 0, 1, 0, petal, 1, 1));
      }
      for (let k = 0; k < ring.length; k++) {
        g.tri(center, ring[(k + 1) % ring.length], ring[k]);
        g.tri(center, ring[k], ring[(k + 1) % ring.length]);
      }
    }
    return g.build();
  };
  return [build(0), build(1), null];
}

function reeds(): LODs {
  const c0 = lin('#4f6e2c'), c1 = lin('#a7a65a'), head = lin('#8a5a34'), head1 = lin('#a56f42');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(95);
    const blades = lod === 0 ? 14 : 7;
    for (let i = 0; i < blades; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 0.5);
      const h = rng.range(1.0, 1.9);
      const lean = rng.range(0.1, 0.45);
      const b = V(Math.cos(a) * r, -0.1, Math.sin(a) * r);
      const dir = V(Math.cos(a), 0, Math.sin(a));
      const side = V(-dir.z, 0, dir.x);
      const pts = [b, b.clone().add(V(dir.x * lean * 0.3, h * 0.55, dir.z * lean * 0.3)), b.clone().add(V(dir.x * lean, h, dir.z * lean))];
      g.strip(pts, [0.035, 0.025, 0.004], side, c0, c1, 0, 1, 1, 0);
      if (i % 4 === 0) g.tube(pts[1].clone().add(V(0, h * 0.15, 0)), pts[1].clone().add(V(dir.x * lean * 0.2, h * 0.38, dir.z * lean * 0.2)), 0.04, 0.034, lod === 0 ? 7 : 5, head, head1, 0.6, 0.8);
    }
    return g.build();
  };
  return [build(0), build(1), null];
}

function fern(): LODs {
  const c0 = lin('#2e5223'), c1 = lin('#5f8f3a');
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(97);
    const fronds = lod === 0 ? 8 : 5;
    for (let k = 0; k < fronds; k++) {
      const a = (k / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const dir = V(Math.cos(a), 0, Math.sin(a));
      const side = V(-dir.z, 0, dir.x);
      const len = rng.range(0.6, 0.95);
      const pts = [V(0, 0, 0), dir.clone().multiplyScalar(len * 0.4).add(V(0, len * 0.45, 0)), dir.clone().multiplyScalar(len * 0.85).add(V(0, len * 0.4, 0)), dir.clone().multiplyScalar(len).add(V(0, len * 0.15, 0))];
      g.strip(pts, [0.02, 0.14, 0.1, 0.01], side, c0, c1, 0.1, 1, 1, 0.1);
    }
    return g.build();
  };
  return [build(0), build(1), null];
}

let cache: Map<SpeciesId, LODs> | null = null;

/** Build (once) and return the LOD geometries of every species. */
export function speciesGeometries(): Map<SpeciesId, LODs> {
  if (cache) return cache;
  cache = new Map<SpeciesId, LODs>([
    ['broadleaf', broadleaf()],
    ['conifer', conifer(false)],
    ['pine_snow', conifer(true)],
    ['palm', palm()],
    ['banyan', banyan()],
    ['mangrove', mangrove()],
    ['bamboo', bamboo()],
    ['blossom', blossom()],
    ['deadtree', deadtree()],
    ['acacia', acacia()],
    ['bush', bush('green')],
    ['bush_snow', bush('snow')],
    ['shrub_dry', bush('dry')],
    ['rock', rock()],
    ['flowers', flowers()],
    ['reeds', reeds()],
    ['fern', fern()],
  ]);
  return cache;
}

export function disposeSpeciesGeometries(): void {
  if (!cache) return;
  for (const lods of cache.values()) for (const g of lods) g?.dispose();
  cache = null;
}
