import * as THREE from 'three';

/**
 * Geometry builders for bending effects. All follow the uv convention used by
 * the bending shaders: uv.y runs ALONG the flow (0 = source/base/head), uv.x
 * runs ACROSS / AROUND it.
 *
 * shared(key, build) caches a geometry forever — never dispose a geometry that
 * came from shared() (they are flagged userData.shared = true). Effects should
 * prefer shared unit geometries scaled by their mesh.
 */

const cache = new Map<string, THREE.BufferGeometry>();

export function shared(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = build();
    g.userData.shared = true;
    cache.set(key, g);
  }
  return g;
}

/** Dispose a geometry unless it is a shared/cached one. */
export function disposeGeometry(g: THREE.BufferGeometry | null | undefined): void {
  if (g && !g.userData.shared) g.dispose();
}

function finish(pos: number[], uv: number[], idx: number[], normals?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function gridIndex(cols: number, rows: number): number[] {
  // (cols+1) x (rows+1) vertices, row-major by i (cols) then j (rows)
  const idx: number[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = (i + 1) * (rows + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return idx;
}

/**
 * Tube along +Z from z=0 (uv.y = 0) to z=length (uv.y = 1) with radius profile r(v).
 * uv.x runs around. Used for streams, cones, teardrop bolts.
 */
export function tube(profile: (v: number) => number, length: number, radial = 12, lenSeg = 12): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
  for (let i = 0; i <= radial; i++) {
    const a = (i / radial) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    for (let j = 0; j <= lenSeg; j++) {
      const v = j / lenSeg;
      const r = profile(v);
      pos.push(c * r, s * r, v * length);
      uv.push(i / radial, v);
      // approximate normal (slope ignored except via profile derivative)
      const dv = 1 / lenSeg;
      const dr = (profile(Math.min(1, v + dv)) - profile(Math.max(0, v - dv))) / (2 * dv * length);
      const nl = Math.hypot(1, dr);
      nrm.push(c / nl, s / nl, -dr / nl);
    }
  }
  return finish(pos, uv, gridIndex(radial, lenSeg), nrm);
}

/** Unit cone/stream along +Z: radius r0 at the source, r1 at the end (length 1). */
export function coneTube(r0: number, r1: number, radial = 12, lenSeg = 8): THREE.BufferGeometry {
  return tube((v) => r0 + (r1 - r0) * v, 1, radial, lenSeg);
}

/** Unit teardrop along +Z: round head (radius 1) at z≈0.25, sharp tail at z=1. Head at uv.y=0. */
export function teardrop(radial = 12, lenSeg = 12): THREE.BufferGeometry {
  return tube(
    (v) => {
      if (v < 0.22) {
        const k = (0.22 - v) / 0.22;
        return Math.sqrt(Math.max(0, 1 - k * k));
      }
      return Math.pow(1 - (v - 0.22) / 0.78, 1.4);
    },
    1,
    radial,
    lenSeg,
  );
}

export interface ArcSheetOptions {
  radius: number;
  /** Total arc angle (radians), centred on +Z. */
  arc: number;
  height: number;
  segA?: number;
  segH?: number;
  /** 0 = rectangular band, 1 = crescent (height → 0 at the tips). */
  taper?: number;
  /** Vertical placement: 'center' (y ∈ ±h/2) or 'base' (y ∈ [0, h]). */
  anchor?: 'center' | 'base';
  /** Which way the flow runs: along the arc, or upward (flame tongues). */
  flow?: 'arc' | 'up';
  /** Lean the top of the sheet outward (m). */
  flare?: number;
}

/** Vertical band following an arc in the XZ plane (wind blades, flame walls, wave fronts). */
export function arcSheet(o: ArcSheetOptions): THREE.BufferGeometry {
  const segA = o.segA ?? 24, segH = o.segH ?? 4;
  const taper = o.taper ?? 0;
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i <= segA; i++) {
    const u = i / segA;
    const th = (u - 0.5) * o.arc;
    const tipK = Math.abs(u - 0.5) * 2;
    const hScale = 1 - taper * Math.pow(tipK, 1.6);
    for (let j = 0; j <= segH; j++) {
      const v = j / segH;
      const hy = o.anchor === 'base' ? v * o.height * hScale : (v - 0.5) * o.height * hScale;
      const r = o.radius + (o.flare ?? 0) * v;
      pos.push(Math.sin(th) * r, hy, Math.cos(th) * r);
      if (o.flow === 'up') uv.push(u, v);
      else uv.push(v, u);
    }
  }
  return finish(pos, uv, gridIndex(segA, segH));
}

/** Horizontal ring band (or crescent if arc < 2π) in the XZ plane. Flow 'out' = inner→outer, 'around' = along the ring. */
export function flatRing(inner: number, outer: number, arc = Math.PI * 2, seg = 48, flow: 'out' | 'around' = 'around'): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
  const rings = 2;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const th = (u - 0.5) * arc;
    for (let j = 0; j <= rings; j++) {
      const v = j / rings;
      const r = inner + (outer - inner) * v;
      pos.push(Math.sin(th) * r, 0, Math.cos(th) * r);
      nrm.push(0, 1, 0);
      if (flow === 'out') uv.push(u, v);
      else uv.push(v, u);
    }
  }
  return finish(pos, uv, gridIndex(seg, rings), nrm);
}

/** Vertical cylindrical band (full ring wall), base at y=0. Flow 'up' or 'around'. */
export function ringWall(radius: number, height: number, seg = 40, flow: 'up' | 'around' = 'up', flare = 0): THREE.BufferGeometry {
  return arcSheet({ radius, arc: Math.PI * 2, height, segA: seg, segH: 3, anchor: 'base', flow: flow === 'up' ? 'up' : 'arc', flare });
}

export interface SpiralOptions {
  turns: number;
  height: number;
  r0: number;
  r1: number;
  /** Strip width (vertical extent of the ribbon). */
  width: number;
  seg?: number;
  /** Phase offset (radians). */
  phase?: number;
}

/** Helical ribbon winding up the Y axis (tornado bands, spin trails). uv.y along the helix. */
export function spiral(o: SpiralOptions): THREE.BufferGeometry {
  const seg = o.seg ?? 64;
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const s = i / seg;
    const a = (o.phase ?? 0) + s * o.turns * Math.PI * 2;
    const r = o.r0 + (o.r1 - o.r0) * s;
    const y = s * o.height;
    for (let j = 0; j <= 1; j++) {
      const w = (j - 0.5) * o.width * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, s * 1.2)));
      pos.push(Math.cos(a) * r, y + w, Math.sin(a) * r);
      uv.push(j, s);
    }
  }
  return finish(pos, uv, gridIndex(seg, 1));
}

/** Sphere whose uv.y = longitude (flow around the equator), uv.x = latitude. */
export function shellSphere(radius = 1, w = 24, h = 16): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, v, u);
  }
  return g;
}

/** Torus (major radius 1) whose uv.y runs around the major circle. */
export function shellTorus(tube = 0.2, radial = 8, tubular = 48, arc = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(1, tube, radial, tubular, arc);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, v, u);
  }
  return g;
}

/** Camera-independent "cross" of two planes along +Z (cheap volumetric streak), uv.y along Z. */
export function crossPlanes(width = 1, length = 1): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const quads: Array<[number, number]> = [
    [1, 0],
    [0, 1],
  ];
  quads.forEach(([ax, ay], q) => {
    const base = q * 4;
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 1; i++) {
        const s = (i - 0.5) * width;
        pos.push(ax * s, ay * s, j * length);
        uv.push(i, j);
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  });
  return finish(pos, uv, idx);
}
