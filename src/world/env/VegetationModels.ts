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
  | 'ice_rock'
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
  // The Water Tribes' boulders are white ice (never earthbendable): placed instead of rocks there.
  ice_rock: { id: 'ice_rock', category: 'rock', flex: 0, push: 0, shadow: true, trunkR: 0, height: 1.4 },
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

  /**
   * Cone with a jittered, drooping rim (conifer tiers). With `notch` < 1 the rim is a star: even
   * vertices are branch tips (full radius, drooping, the lighter `cTip`), odd ones notches between
   * the branches (`notch` × radius, tucked up, the darker `cBase`).
   */
  cone(baseY: number, apexY: number, r: number, seg: number, cBase: THREE.Color, cTip: THREE.Color, w0: number, w1: number, rng: Random, droop = 0.25, snow: THREE.Color | null = null, notch = 1): void {
    const base = this.pos.length / 3;
    const slope = r / (apexY - baseY);
    const star = notch < 1;
    for (let s = 0; s < seg; s++) {
      const point = !star || s % 2 === 0;
      const ang = (s / seg) * Math.PI * 2 + rng.range(-0.15, 0.15) * (star ? 0.35 : 1);
      const rr = point ? r * rng.range(0.82, 1.12) : r * notch * rng.range(0.9, 1.05);
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const ny = slope;
      const y = point ? baseY - droop * rng.range(0.5, 1.2) : baseY + (apexY - baseY) * 0.14;
      this.vertex(dx * rr, y, dz * rr, dx, ny, dz, star && point ? cTip : cBase, w0, 1);
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
    // Underside (darker) so tiers read from below.
    const under = this.vertex(0, baseY + (apexY - baseY) * 0.15, 0, 0, -1, 0, tmpC.copy(cBase).multiplyScalar(star ? 0.62 : 0.45), w0, 1);
    for (let s = 0; s < seg; s++) this.tri(base + (s + 1) % seg, under, base + s);
  }

  /**
   * Noise-displaced icosphere blob. Normals point away from `nc` (canopy centre)
   * blended with the blob normal — the classic soft stylised foliage look.
   */
  blob(center: THREE.Vector3, radii: THREE.Vector3, detail: number, seed: number, jitter: number, colorFn: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color, wind: number, tint: number, nc: THREE.Vector3 | null = null, flat = false, upBias = 0): void {
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
          // Leaf clumps: turn normals a little skyward so undersides catch sky light, not go black.
          if (upBias) nrm.setY(nrm.y + upBias).normalize();
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

  /** A two-sided triangle (a palm leaflet), its normal turned to face up. */
  leaflet(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color, wind: number): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (n.y < 0) n.negate();
    const ia = this.vertex(a.x, a.y, a.z, n.x, n.y, n.z, col, wind * 0.85, 1);
    const ib = this.vertex(b.x, b.y, b.z, n.x, n.y, n.z, col, wind * 0.85, 1);
    const ic = this.vertex(c.x, c.y, c.z, n.x, n.y, n.z, col, wind, 1);
    this.tri(ia, ib, ic);
    this.tri(ia, ic, ib);
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

// ---------------------------------------------------------------------------
// Trees: a branching skeleton (trunk with root flares, limbs, twigs) carrying a
// crown of many small leaf clumps, each its own shade, with gaps between them,
// so a tree reads as a tree near and far (LOD1/LOD2 keep the silhouette with
// fewer, bigger clumps). The same builders make the region trees (treeModel).
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

interface Pal {
  dark: THREE.Color;
  mid: THREE.Color;
  light: THREE.Color;
  /** Some clumps lean toward this (sun-yellowed, paler or blushing leaves). */
  accent: THREE.Color;
  bark0: THREE.Color;
  bark1: THREE.Color;
}

const pal = (dark: string, mid: string, light: string, accent: string, bark0: string, bark1: string): Pal => ({
  dark: lin(dark),
  mid: lin(mid),
  light: lin(light),
  accent: lin(accent),
  bark0: lin(bark0),
  bark1: lin(bark1),
});

const PALETTES = {
  broadleaf: pal('#2c4a20', '#4b7d30', '#8fbf55', '#a9bb4c', '#5e4835', '#866c52'),
  broadleaf_light: pal('#38592a', '#5d9140', '#a6cf6c', '#c4c95c', '#5a4533', '#806850'),
  maple: pal('#7a2c16', '#c75a2a', '#f19445', '#e9b84f', '#4c392d', '#6a5243'),
  jungle: pal('#1d3a1b', '#35672b', '#6f9f44', '#5f8f36', '#4d4936', '#6c6650'),
  blossom: pal('#b45b80', '#ec9dbc', '#ffe1ec', '#fff3f6', '#4a3530', '#6a5149'),
  acacia: pal('#3b4c20', '#667a30', '#a5b25a', '#b9aa50', '#5b4a37', '#7d6851'),
  willow: pal('#30502a', '#5b893c', '#a0c66a', '#bcd27c', '#57483a', '#776351'),
  banyan: pal('#22381b', '#3f5f2a', '#78983f', '#8a9a46', '#55503f', '#77705a'),
  mangrove: pal('#253b1d', '#46652c', '#7f9d47', '#90a050', '#4f4436', '#6d5f4b'),
  cypress: pal('#1d3523', '#2f5636', '#5c8a55', '#6e8f4e', '#4e3b2e', '#6a5240'),
  bush: pal('#26401b', '#467130', '#86ad4c', '#9fb24a', '#4a3a2c', '#4a3a2c'),
  bush_dry: pal('#4d4a2a', '#7c7440', '#a8a060', '#b4a254', '#4a3a2c', '#4a3a2c'),
  bush_snow: pal('#27401b', '#4a7330', '#eef4f9', '#f4f8fb', '#4a3a2c', '#4a3a2c'),
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** A clump's colour: never black underneath, lit on top, mottled; `shade` and `accent` vary per clump. */
function clumpColor(p: Pal, shade: number, accent: number, top: number, bottom: number) {
  const out = new THREE.Color();
  return (v: THREE.Vector3, n: THREE.Vector3): THREE.Color => {
    const h = clamp01((v.y - bottom) / Math.max(0.01, top - bottom));
    const up = Math.max(0, n.y);
    const mott = noise3.noise3(v.x * 0.85, v.y * 0.85, v.z * 0.85);
    out.copy(p.dark).lerp(p.mid, 0.4 + 0.6 * clamp01(h * 1.1 + up * 0.35 + mott * 0.15));
    out.lerp(p.light, clamp01(up * 0.55 + h * 0.3 - 0.28 + mott * 0.12));
    if (accent > 0) out.lerp(p.accent, accent);
    return out.multiplyScalar(shade);
  };
}

/** Clumps scattered over an ellipsoidal crown (the first one crowns the top). */
function crownClumps(g: GeoBuilder, rng: Random, p: Pal, c: THREE.Vector3, rad: number, h: number, count: number, r: [number, number], flat: number, det: number, wind = 0.65): void {
  const top = c.y + h * 0.5 + r[1] * flat, bottom = c.y - h * 0.5 - r[1] * flat;
  const nc = V(c.x, c.y - h * 0.3, c.z);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng.range(-0.3, 0.3);
    const d = i === 0 ? 0 : rad * Math.sqrt(rng.range(0.25, 1));
    const pos = i === 0 ? V(c.x, c.y + h * 0.35, c.z) : V(c.x + Math.cos(a) * d, c.y + rng.range(-0.5, 0.5) * h, c.z + Math.sin(a) * d);
    const rr = rng.range(r[0], r[1]);
    const col = clumpColor(p, rng.range(0.88, 1.08), rng.next() < 0.25 ? rng.range(0.15, 0.3) : 0, top, bottom);
    g.blob(pos, V(rr, rr * flat, rr), det, rng.range(0, 99), 0.28, col, wind, 1, nc, false, 0.3);
  }
}

interface Limb {
  a: THREE.Vector3;
  b: THREE.Vector3;
  twigs: Array<{ a: THREE.Vector3; b: THREE.Vector3 }>;
}

/** How a leafy tree grows. */
interface Form {
  trunkR: number;
  /** Where the trunk divides into limbs. */
  forkY: number;
  limbs: number;
  /** A leader limb carrying on straight up. */
  leader: boolean;
  /** Limb elevation above the horizontal (rad) and length (m). */
  elev: [number, number];
  len: [number, number];
  /** Sub-branches per limb and their length. */
  twigs: number;
  twigLen: [number, number];
  roots: number;
  /** Leaf clump radius, flattening (height / width) and filler clumps between the tips. */
  clump: [number, number];
  flat: number;
  fill: number;
  /** Weeping: clumps hang below the branch tips. */
  weep?: boolean;
}

const FORMS = {
  broadleaf: { trunkR: 0.36, forkY: 2.6, limbs: 4, leader: true, elev: [0.55, 0.95], len: [2.0, 2.7], twigs: 3, twigLen: [0.9, 1.4], roots: 5, clump: [0.85, 1.25], flat: 0.8, fill: 5 },
  maple: { trunkR: 0.32, forkY: 2.2, limbs: 4, leader: true, elev: [0.6, 1.0], len: [1.8, 2.4], twigs: 2, twigLen: [0.9, 1.3], roots: 4, clump: [0.95, 1.3], flat: 0.85, fill: 4 },
  jungle: { trunkR: 0.42, forkY: 3.4, limbs: 5, leader: true, elev: [0.45, 0.85], len: [2.4, 3.1], twigs: 3, twigLen: [1.1, 1.6], roots: 6, clump: [1.05, 1.5], flat: 0.72, fill: 6 },
  blossom: { trunkR: 0.27, forkY: 1.7, limbs: 3, leader: false, elev: [0.5, 0.95], len: [1.6, 2.2], twigs: 2, twigLen: [0.8, 1.2], roots: 4, clump: [0.85, 1.2], flat: 0.72, fill: 3 },
  acacia: { trunkR: 0.26, forkY: 1.7, limbs: 4, leader: false, elev: [0.55, 0.85], len: [2.6, 3.3], twigs: 1, twigLen: [1.0, 1.5], roots: 3, clump: [1.1, 1.6], flat: 0.3, fill: 3 },
  willow: { trunkR: 0.34, forkY: 2.4, limbs: 5, leader: true, elev: [0.35, 0.75], len: [2.2, 2.9], twigs: 2, twigLen: [1.0, 1.5], roots: 4, clump: [0.8, 1.15], flat: 0.85, fill: 3, weep: true },
} satisfies Record<string, Form>;

/** The branching (the same for every LOD, so the silhouettes match). */
function skeleton(f: Form, rng: Random): { fork: THREE.Vector3; limbs: Limb[] } {
  const fork = V(rng.range(-0.25, 0.25), f.forkY, rng.range(-0.25, 0.25));
  const limbs: Limb[] = [];
  const a0 = rng.range(0, TAU);
  const n = f.limbs + (f.leader ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const lead = f.leader && i === n - 1;
    const yaw = a0 + (i / f.limbs) * TAU + rng.range(-0.35, 0.35);
    const el = lead ? rng.range(1.25, 1.45) : rng.range(f.elev[0], f.elev[1]);
    const len = rng.range(f.len[0], f.len[1]) * (lead ? 0.85 : 1);
    const dir = V(Math.cos(el) * Math.cos(yaw), Math.sin(el), Math.cos(el) * Math.sin(yaw));
    const a = fork.clone().add(V(0, lead ? 0 : -rng.range(0, f.forkY * 0.15), 0));
    const b = a.clone().addScaledVector(dir, len);
    const twigs: Limb['twigs'] = [];
    for (let k = 0; k < f.twigs; k++) {
      const s = a.clone().lerp(b, rng.range(0.5, 0.85));
      const ty = yaw + (k % 2 ? 1 : -1) * rng.range(0.55, 1.0);
      const te = Math.min(1.4, (f.weep ? -0.15 : el) + rng.range(0.05, 0.4));
      const tl = rng.range(f.twigLen[0], f.twigLen[1]);
      twigs.push({ a: s, b: s.clone().addScaledVector(V(Math.cos(te) * Math.cos(ty), Math.sin(te), Math.cos(te) * Math.sin(ty)), tl) });
    }
    limbs.push({ a, b, twigs });
  }
  return { fork, limbs };
}

/** A leafy tree (broadleaf, maple, blossom, acacia, willow...): skeleton + clump crown, by LOD. */
function leafy(f: Form, p: Pal, seed: number, lod: number): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const rng = new Random(seed);
  const { fork, limbs } = skeleton(f, rng);
  const seg = lod === 0 ? 7 : lod === 1 ? 5 : 4;
  // Trunk (a little swell at the foot) and root flares.
  g.tube(V(0, -0.4, 0), fork, f.trunkR, f.trunkR * 0.7, seg, p.bark0, p.bark1, 0, 0.12, 0, lod === 0 ? 3 : 1);
  if (lod === 0) {
    for (let i = 0; i < f.roots; i++) {
      const a = (i / f.roots) * TAU + rng.range(-0.3, 0.3);
      g.tube(V(Math.cos(a) * f.trunkR * 0.3, 0.8, Math.sin(a) * f.trunkR * 0.3), V(Math.cos(a) * f.trunkR * 2.5, -0.3, Math.sin(a) * f.trunkR * 2.5), f.trunkR * 0.55, f.trunkR * 0.16, 4, p.bark0, p.bark0, 0, 0);
    }
  }
  // Limbs and twigs (by LOD); their ends carry the crown.
  const tips: THREE.Vector3[] = [];
  for (const l of limbs) {
    if (lod < 2) g.tube(l.a, l.b, f.trunkR * 0.5, f.trunkR * 0.22, lod === 0 ? 5 : 4, p.bark1, p.bark1, 0.12, 0.42);
    tips.push(l.b);
    for (const t of l.twigs) {
      if (lod === 0) g.tube(t.a, t.b, f.trunkR * 0.2, f.trunkR * 0.07, 4, p.bark1, p.bark1, 0.35, 0.6);
      tips.push(t.b);
    }
  }
  // The crown's envelope.
  const c = V(0, 0, 0);
  for (const t of tips) c.add(t);
  c.multiplyScalar(1 / tips.length);
  let top = -Infinity, bottom = Infinity, rad = 0;
  for (const t of tips) {
    top = Math.max(top, t.y);
    bottom = Math.min(bottom, t.y);
    rad = Math.max(rad, Math.hypot(t.x - c.x, t.z - c.z));
  }
  const rMax = f.clump[1];
  top += rMax * f.flat;
  bottom -= rMax * f.flat * (f.weep ? 2.2 : 1);
  const clumps: Array<[THREE.Vector3, number]> = [];
  if (lod === 0) {
    for (const t of tips) clumps.push([t.clone(), rng.range(f.clump[0], f.clump[1])]);
    for (let i = 0; i < f.fill; i++) {
      const a = rng.range(0, TAU), up = rng.range(-0.2, 0.8);
      clumps.push([V(c.x + Math.cos(a) * rad * 0.65, c.y + up * Math.max(0.5, top - c.y) * 0.6, c.z + Math.sin(a) * rad * 0.65), rng.range(f.clump[0], f.clump[1]) * 0.9]);
    }
  } else if (lod === 1) {
    for (const l of limbs) {
      const m = l.b.clone();
      for (const t of l.twigs) m.add(t.b);
      m.multiplyScalar(1 / (1 + l.twigs.length));
      clumps.push([m, rMax * (l.twigs.length ? 1.45 : 1.1)]);
    }
  } else {
    clumps.push([V(c.x, c.y + rMax * 0.2, c.z), rad + rMax * 0.9]);
  }
  const nc = V(c.x, c.y - rMax * 0.3, c.z);
  for (const [pos, r] of clumps) {
    const shade = rng.range(0.88, 1.08), acc = rng.next() < 0.25 ? rng.range(0.15, 0.35) : 0;
    const ry = r * f.flat * (f.weep ? 1.6 : 1);
    const centre = f.weep ? pos.clone().add(V(0, -ry * 0.55, 0)) : pos.clone().add(V(0, ry * 0.25, 0));
    g.blob(centre, V(r, ry, r), lod === 2 ? 0 : 1, rng.range(0, 99), 0.28, clumpColor(p, shade, acc, top, bottom), 0.7, 1, nc, false, 0.3);
  }
  return g.build();
}

const leafyLods = (f: Form, p: Pal, seed: number): LODs => [leafy(f, p, seed, 0), leafy(f, p, seed, 1), leafy(f, p, seed, 2)];

function broadleaf(): LODs {
  return leafyLods(FORMS.broadleaf, PALETTES.broadleaf, 11);
}

function blossom(): LODs {
  return leafyLods(FORMS.blossom, PALETTES.blossom, 51);
}

function acacia(): LODs {
  return leafyLods(FORMS.acacia, PALETTES.acacia, 71);
}

/** A fir: a tapering trunk through tiers of drooping, star-edged branch whorls (snow on their tops). */
function coniferLod(snow: boolean, lod: number, seed: number): THREE.BufferGeometry {
  const trunk0 = lin('#4f3b2c'), trunk1 = lin('#6b5140');
  const inner = snow ? lin('#22402e') : lin('#1e3f28'), tip = snow ? lin('#3c6b4a') : lin('#3d7a47');
  const snowC = snow ? lin('#eef4fb') : null;
  const g = new GeoBuilder();
  const rng = new Random(seed);
  g.tube(V(0, -0.4, 0), V(0, 10.4, 0), 0.3, 0.05, lod === 0 ? 7 : 5, trunk0, trunk1, 0, 0.3, 0, lod === 0 ? 2 : 1);
  const tiers = lod === 0 ? 8 : lod === 1 ? 5 : 3;
  const points = lod === 0 ? 9 : lod === 1 ? 7 : 6;
  const stretch = Math.pow(8 / tiers, 0.4);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y0 = 1.3 + t * 7.2;
    const shade = rng.range(0.92, 1.08);
    g.cone(y0, y0 + (3.0 - t * 1.5) * stretch, 2.7 - t * 2.15, points * 2, inner.clone().multiplyScalar(shade), tip.clone().multiplyScalar(shade), 0.25 + t * 0.3, 0.5 + t * 0.4, rng, lod === 0 ? 0.55 : 0.35, snowC, 0.55);
  }
  return g.build();
}

function conifer(snow: boolean): LODs {
  const seed = snow ? 23 : 21;
  return [coniferLod(snow, 0, seed), coniferLod(snow, 1, seed), coniferLod(snow, 2, seed)];
}

/** A palm: a ringed, curving trunk and arching fronds of leaflets combed out both sides. */
function palmLod(lod: number, seed: number): THREE.BufferGeometry {
  const ringA = lin('#8d7352'), ringB = lin('#a88d68');
  const f0 = lin('#3a6d26'), f1 = lin('#82b648'), ribC = lin('#8f8a45');
  const g = new GeoBuilder();
  const rng = new Random(seed);
  const n = lod === 0 ? 12 : lod === 1 ? 6 : 4;
  const bend = rng.range(1.0, 1.5);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(V(Math.sin(t * 1.4) * bend, -0.3 + t * 7.4, 0));
  }
  for (let i = 0; i < n; i++) {
    const c = lod === 0 && i % 2 ? ringB : ringA;
    const r0 = 0.27 - (i / n) * 0.08 + (lod === 0 && i === 0 ? 0.08 : 0), r1 = 0.27 - ((i + 1) / n) * 0.08;
    g.tube(pts[i], pts[i + 1], r0, r1, lod === 0 ? 7 : 5, c, lod === 0 ? c : ringB, (i / n) * 0.4, ((i + 1) / n) * 0.4, 0, 1);
  }
  const top = pts[n];
  g.blob(top.clone().add(V(0, 0.1, 0)), V(0.34, 0.42, 0.34), 0, seed, 0.1, () => tmpC.copy(f0).multiplyScalar(0.8), 0.45, 0.6);
  const fronds = lod === 0 ? 11 : lod === 1 ? 8 : 6;
  const col = new THREE.Color();
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * TAU + rng.range(-0.2, 0.2);
    const dir = V(Math.cos(a), 0, Math.sin(a));
    const side = V(-dir.z, 0, dir.x);
    const L = rng.range(3.2, 4.0), lift = rng.range(0.6, 1.1);
    const m = lod === 0 ? 10 : 5;
    const rib: THREE.Vector3[] = [];
    for (let i = 0; i <= m; i++) {
      const t = i / m;
      rib.push(top.clone().addScaledVector(dir, t * L).add(V(0, lift * Math.sin(t * Math.PI * 0.55) - t * t * 2.3, 0)));
    }
    if (lod === 2) {
      g.strip(rib, rib.map((_, i) => 0.1 + 0.5 * Math.sin((i / m) * Math.PI) * (1 - (i / m) * 0.3)), side, f0, f1, 0.5, 1.0, 1, -0.2);
      continue;
    }
    // The rib, then leaflets combed out both sides (longest mid-frond), drooping.
    g.strip(rib, rib.map(() => 0.035), side, ribC, ribC, 0.5, 1.0, 1, 0);
    for (let i = 1; i < m; i++) {
      const t = i / m;
      const q = rib[i];
      const along = rib[i + 1].clone().sub(q).normalize();
      const len = (0.25 + 0.85 * Math.sin(t * Math.PI)) * (1 - t * 0.25);
      col.copy(f0).lerp(f1, t * 0.8 + rng.range(0, 0.2));
      for (const sd of [-1, 1]) {
        const tipP = q.clone().addScaledVector(side, sd * len).addScaledVector(along, len * 0.45).add(V(0, -len * 0.35, 0));
        g.leaflet(q, q.clone().addScaledVector(along, 0.16), tipP, col, 0.5 + t * 0.5);
      }
    }
  }
  return g.build();
}

function palm(): LODs {
  return [palmLod(0, 31), palmLod(1, 31), palmLod(2, 31)];
}

function banyan(): LODs {
  const P = PALETTES.banyan;
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(31);
    g.tube(V(0, -0.5, 0), V(0.3, 6.5, 0.2), 1.3, 0.75, lod === 0 ? 10 : 6, P.bark0, P.bark1, 0, 0.1, 0, lod === 0 ? 3 : 1);
    // Buttress roots.
    const roots = lod === 0 ? 7 : lod === 1 ? 5 : 0;
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * TAU + rng.range(-0.2, 0.2);
      g.tube(V(Math.cos(a) * 0.6, 1.8, Math.sin(a) * 0.6), V(Math.cos(a) * 2.6, -0.4, Math.sin(a) * 2.6), 0.45, 0.15, 5, P.bark1, P.bark0, 0, 0);
    }
    // Spreading limbs and aerial roots dropping from the canopy.
    if (lod < 2) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + rng.range(-0.3, 0.3);
        g.tube(V(0.3, 5.8, 0.2), V(Math.cos(a) * 4, 7.6 + rng.range(-0.3, 0.5), Math.sin(a) * 4), 0.45, 0.2, lod === 0 ? 6 : 4, P.bark1, P.bark1, 0.1, 0.35);
      }
    }
    const aerial = lod === 0 ? 12 : lod === 1 ? 6 : 0;
    for (let i = 0; i < aerial; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(2.6, 5.2);
      g.tube(V(Math.cos(a) * r, 7.4, Math.sin(a) * r), V(Math.cos(a) * r * 1.05, -0.3, Math.sin(a) * r * 1.05), 0.08, 0.12, 4, P.bark1, P.bark0, 0.25, 0.05);
    }
    if (lod === 0) crownClumps(g, rng, P, V(0, 8.6, 0), 4.6, 1.6, 17, [1.6, 2.3], 0.55, 1, 0.55);
    else if (lod === 1) crownClumps(g, rng, P, V(0, 8.6, 0), 4.2, 1.4, 7, [2.4, 3.0], 0.55, 1, 0.55);
    else crownClumps(g, rng, P, V(0, 8.4, 0), 0, 0, 1, [5.6, 5.6], 0.5, 1, 0.55);
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

function mangrove(): LODs {
  const P = PALETTES.mangrove;
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(37);
    g.tube(V(0, 0.4, 0), V(0.1, 4.2, 0), 0.24, 0.13, lod === 0 ? 6 : 4, P.bark0, P.bark1, 0.0, 0.25);
    // Arching prop roots springing from the lower trunk and curving down into the mud.
    const roots = lod === 0 ? 11 : lod === 1 ? 6 : 4;
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * TAU + rng.range(-0.25, 0.25);
      const r = rng.range(0.95, 1.75);
      const y0 = rng.range(0.9, 2.1);
      const ca = Math.cos(a), sa = Math.sin(a);
      const p0 = V(ca * 0.14, y0, sa * 0.14);
      const p1 = V(ca * r * 0.5, y0 + 0.22, sa * r * 0.5);
      const p2 = V(ca * r * 0.88, y0 * 0.5, sa * r * 0.88);
      const p3 = V(ca * r * 1.02, -0.45, sa * r * 1.02);
      const seg = lod === 0 ? 4 : 3;
      g.tube(p0, p1, 0.075, 0.06, seg, P.bark1, P.bark1, 0.02, 0.02);
      if (lod < 2) {
        g.tube(p1, p2, 0.06, 0.055, seg, P.bark1, P.bark0, 0.02, 0);
        g.tube(p2, p3, 0.055, 0.05, seg, P.bark0, P.bark0, 0, 0);
      } else g.tube(p1, p3, 0.06, 0.05, seg, P.bark1, P.bark0, 0.02, 0);
    }
    if (lod === 0) crownClumps(g, rng, P, V(0, 4.9, 0), 1.7, 0.9, 9, [0.85, 1.25], 0.68, 1, 0.7);
    else if (lod === 1) crownClumps(g, rng, P, V(0, 4.9, 0), 1.4, 0.7, 4, [1.3, 1.6], 0.68, 1, 0.7);
    else crownClumps(g, rng, P, V(0, 4.9, 0), 0, 0, 1, [2.2, 2.2], 0.7, 0, 0.7);
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

/** A bush: a mound of small leaf clumps (snowy ones white on top, dry ones straw-coloured). */
function bush(kind: 'green' | 'snow' | 'dry'): LODs {
  const P = kind === 'snow' ? PALETTES.bush_snow : kind === 'dry' ? PALETTES.bush_dry : PALETTES.bush;
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const rng = new Random(kind === 'snow' ? 83 : kind === 'dry' ? 85 : 81);
    if (lod === 0) crownClumps(g, rng, P, V(0, 0.48, 0), 0.5, 0.22, 6, [0.36, 0.55], 0.8, 1, 0.6);
    else if (lod === 1) crownClumps(g, rng, P, V(0, 0.48, 0), 0.42, 0.2, 3, [0.55, 0.72], 0.8, 1, 0.6);
    else crownClumps(g, rng, P, V(0, 0.5, 0), 0, 0, 1, [0.95, 0.95], 0.78, 0, 0.6);
    return g.build();
  };
  return [build(0), build(1), build(2)];
}

/** An Italian-style cypress (region scenery): a short trunk and a tall, tapering column of clumps. */
function cypressLod(seed: number): THREE.BufferGeometry {
  const p = PALETTES.cypress;
  const g = new GeoBuilder();
  const rng = new Random(seed);
  g.tube(V(0, -0.3, 0), V(0, 2.0, 0), 0.22, 0.16, 6, p.bark0, p.bark1, 0, 0.1);
  const n = 11;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const y = 1.6 + t * 6.2;
    const r = 0.95 - t * 0.6;
    const a = rng.range(0, TAU), off = r * 0.25;
    g.blob(V(Math.cos(a) * off, y, Math.sin(a) * off), V(r, r * 1.35, r), 1, rng.range(0, 99), 0.22, clumpColor(p, rng.range(0.9, 1.06), 0, 8.4, 1.0), 0.5 + t * 0.4, 1, V(0, y, 0), false, 0.2);
  }
  return g.build();
}

/** Region tree looks (treeModel): the world's species plus city kinds. */
export type TreeLook = 'broadleaf' | 'broadleaf_light' | 'maple' | 'jungle' | 'blossom' | 'willow' | 'acacia' | 'cypress' | 'conifer' | 'pine_snow' | 'palm';

/**
 * A tree for region scenery (city gardens, the Meditation Isle): vertex coloured, base at the
 * origin, which the caller owns (and disposes). `variant` reseeds the branching for another shape.
 * `lod` 0 is the near model; 1 is the lighter mid-distance build of the same tree, for places with
 * hundreds of trees in view (region trees have no distance LOD). Returns it with its height at
 * scale 1 (m).
 */
export function treeModel(look: TreeLook, variant = 0, lod: 0 | 1 = 0): { geo: THREE.BufferGeometry; height: number } {
  const seed = 101 + variant * 977;
  let geo: THREE.BufferGeometry;
  switch (look) {
    case 'conifer':
    case 'pine_snow':
      geo = coniferLod(look === 'pine_snow', lod, seed);
      break;
    case 'palm':
      geo = palmLod(lod, seed);
      break;
    case 'cypress':
      geo = cypressLod(seed);
      break;
    case 'broadleaf':
    case 'broadleaf_light':
      geo = leafy(FORMS.broadleaf, PALETTES[look], seed, lod);
      break;
    default:
      geo = leafy(FORMS[look], PALETTES[look], seed, lod);
  }
  geo.computeBoundingBox();
  return { geo, height: geo.boundingBox!.max.y };
}

const treeHeights = new Map<string, number>();

/** A region tree's height at scale 1 (m), measured once per look and variant (to scale it to a wanted height). */
export function treeHeight(look: TreeLook, variant = 0): number {
  const k = `${look}:${variant}`;
  let h = treeHeights.get(k);
  if (h === undefined) {
    const m = treeModel(look, variant);
    h = m.height;
    m.geo.dispose();
    treeHeights.set(k, h);
  }
  return h;
}

let treeMat: THREE.MeshLambertMaterial | null = null;

/**
 * The shared material for region trees (vertex colours; leaves get a little sky fill like the
 * world's vegetation). Shared by every region: never disposed by one.
 */
export function treeMaterial(): THREE.MeshLambertMaterial {
  if (treeMat) return treeMat;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 veg;\nvarying float vLeaf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeaf = veg.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLeaf;')
      .replace('#include <opaque_fragment>', '  outgoingLight += diffuseColor.rgb * ( 0.06 + vLeaf * 0.14 );\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'region-tree-v2';
  treeMat = m;
  return m;
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

/** A boulder of old white ice: the rock's shape, faceted, pale blue in the hollows and snow-white on top. */
function iceRock(): LODs {
  const build = (lod: number): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    const deep = lin('#8fb9d6'), mid = lin('#cfe4f2'), light = lin('#f7fbff');
    const col = (p: THREE.Vector3, n: THREE.Vector3) => tmpC.copy(deep).lerp(mid, Math.min(1, (p.y + 0.4) / 0.9)).lerp(light, Math.max(0, n.y) * 0.8);
    g.blob(V(0, 0.25, 0), V(1, 0.66, 0.85), lod === 0 ? 1 : 0, 11, 0.26, col, 0, 1, null, true);
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
    ['ice_rock', iceRock()],
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
