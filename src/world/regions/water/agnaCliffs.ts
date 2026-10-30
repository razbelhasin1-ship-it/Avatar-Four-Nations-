import * as THREE from 'three';
import { SimplexNoise } from '../../../core/Noise';
import type { ContentBuilder } from '../../kit/Builder';
import { boulder } from './geometry';
import { wtMat } from './materials';
import { Random } from '../../../core/Random';
import { heightAt } from '../../Heightfield';
import { COVE, GATE_Z, JAW_TIP, MOUTH, TUNE, inPoly, segDist } from './nwtLayout';
import { rasterRects } from './raster';

/**
 * The colossal ice cliffs enclosing Agna Qel'a: two massif pieces (west+back
 * up to the Glacier Pass, and east), each a vertical fluted face along the
 * cove outline, a flat snowy top and a glacier skirt sloping away outside.
 * The faces are displaced grids (vertical flutes, ledges, bulges) that taper
 * to the exact outline at the top so they meet the top polygon seamlessly.
 */

const noise = new SimplexNoise(7781);
const TOP = TUNE.cliffTop;
/** Skirt profile outside the massif: [distance out, drop below the top]. */
const SKIRT: Array<[number, number]> = [
  [0, 0],
  [8, -22],
  [16, -62],
  [23, -TOP - 14],
];

/** Skirt height at a distance out from the massif's outer edge. */
function skirtY(d: number): number {
  for (let i = 0; i < SKIRT.length - 1; i++) {
    const [a, ya] = SKIRT[i], [b, yb] = SKIRT[i + 1];
    if (d <= b) return TOP + ya + ((yb - ya) * (d - a)) / (b - a);
  }
  return TOP + SKIRT[SKIRT.length - 1][1];
}

/** Collider bands along the outer edge: [from, to] distance out and their top (rim at full height, then the skirt in steps). */
const BANDS: Array<[number, number, number]> = [
  [-7, 0.5, TOP],
  [0, 8, skirtY(8)],
  [7, 16, skirtY(16)],
  [15, 23, skirtY(19.5)],
];

type P = [number, number];

/**
 * Face paths (massif on the right-hand side). Both run on past the Glacier
 * Pass mouth so the canyon opens between two sheer faces, not under a skirt.
 */
const WEST_FACE: P[] = [[-330, JAW_TIP], [MOUTH.x0, JAW_TIP], ...COVE.slice(0, 15).map((p) => [p[0], p[1]] as P), [-150, -1326]];
const EAST_FACE: P[] = [[-80, -1326], ...COVE.slice(15).map((p) => [p[0], p[1]] as P), [MOUTH.x1, JAW_TIP], [-110, JAW_TIP]];

/** Outer outlines from the end of each face path back to its start. */
const WEST_OUTER: P[] = [[-200, -1314], [-262, -1306], [-330, -1310], [-400, -1338], [-432, -1390], [-436, -1600], [-430, -1760], [-410, -1832], [-372, -1900]];
const EAST_OUTER: P[] = [[-70, -1900], [-30, -1832], [-10, -1760], [-4, -1600], [-8, -1390], [-40, -1338]];

export const MASSIFS = [
  { face: WEST_FACE, outer: WEST_OUTER },
  { face: EAST_FACE, outer: EAST_OUTER },
];

/** Face displacement toward the open side (m): rounded vertical flutes, ledges and broad bulges, easing out at the top edge. */
function bulge(s: number, y: number, seed: number): number {
  const ph = 2.2 * noise.noise2(s * 0.03 + seed, 0.3);
  const flute = Math.pow(Math.abs(Math.sin((s / 11) * Math.PI + ph)), 0.6) * (1.1 + 0.5 * noise.noise2(s * 0.05, seed + 3));
  const big = 1.6 * noise.noise2(s * 0.018 + seed, y * 0.014) + 0.7 * noise.noise2(s * 0.06 + seed, y * 0.05);
  const ledge = Math.exp(-(((y - 34) / 2.2) ** 2)) * 0.7 + Math.exp(-(((y - 63) / 2.6) ** 2)) * 0.8 + Math.exp(-(((y - 86) / 2) ** 2)) * 0.5;
  const top = Math.min(1, Math.max(0, (TOP - y) / 6));
  return Math.max(0, flute + big + 0.6 + ledge * (0.6 + 0.4 * noise.noise2(s * 0.06, seed))) * top;
}

/** Resample a polyline every `step` metres, keeping its corners. */
function resample(path: P[], step: number): Array<{ x: number; z: number; s: number; tx: number; tz: number }> {
  const out: Array<{ x: number; z: number; s: number; tx: number; tz: number }> = [];
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: acc + len * t, tx: (bx - ax) / len, tz: (bz - az) / len });
    }
    acc += len;
  }
  const [lx, lz] = path[path.length - 1];
  const [px, pz] = path[path.length - 2];
  const ll = Math.hypot(lx - px, lz - pz);
  out.push({ x: lx, z: lz, s: acc, tx: (lx - px) / ll, tz: (lz - pz) / ll });
  // Smooth tangents at corners (average neighbours).
  for (let i = 1; i < out.length - 1; i++) {
    const a = out[i - 1], b = out[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    out[i].tx = dx / l;
    out[i].tz = dz / l;
  }
  return out;
}

function faceMesh(path: P[], seed: number): THREE.BufferGeometry {
  const pts = resample(path, 1.5);
  const P: number[] = [], I: number[] = [];
  const rows = 24;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const fx = p.tz, fz = -p.tx; // left normal = toward the open side
    const base = p.z < GATE_Z - 1 ? -9 : 1.5;
    for (let j = 0; j <= rows; j++) {
      const y = base + ((TOP - base) * j) / rows;
      const d = bulge(p.s, y, seed);
      P.push(p.x + fx * d, y, p.z + fz * d);
    }
    if (i > 0) {
      const a0 = (i - 1) * (rows + 1), b0 = i * (rows + 1);
      for (let j = 0; j < rows; j++) I.push(a0 + j, a0 + j + 1, b0 + j, b0 + j, a0 + j + 1, b0 + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/** Snow cornice along the rim: lumpy drifts overhanging the edge break the straight skyline. */
function corniceMesh(path: P[], seed: number): THREE.BufferGeometry {
  const pts = resample(path, 2);
  const P: number[] = [], I: number[] = [];
  const prof = 5;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const ox = p.tz, oz = -p.tx; // over the edge, toward the open side
    const h = 1.2 + 3.2 * Math.max(0, noise.noise2(p.s * 0.035 + seed, 1.7) * 0.5 + 0.5) ** 1.5;
    const o = 0.6 + 1.8 * Math.max(0, noise.noise2(p.s * 0.05 + seed, 4.1) * 0.5 + 0.5);
    const ring: Array<[number, number]> = [
      [-0.2, -1.2],
      [o, h * 0.25],
      [o * 0.55, h * 0.85],
      [-1.5, h],
      [-7, 0.15],
    ];
    for (const [d, dy] of ring) P.push(p.x + ox * d, TOP + dy, p.z + oz * d);
    if (i > 0) {
      const a0 = (i - 1) * prof, b0 = i * prof;
      // Winding gives outward normals with the open side on the path's left (as for the faces).
      for (let j = 0; j < prof - 1; j++) I.push(a0 + j, a0 + j + 1, b0 + j, b0 + j, a0 + j + 1, b0 + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/** Flat top of a massif piece: the face path followed by the outer outline, triangulated at y = TOP. */
function topMesh(face: P[], outer: P[]): THREE.BufferGeometry {
  const shape = new THREE.Shape(face.concat(outer).map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, TOP, 0);
  return g;
}

/** Glacier skirt down the outside of a massif piece. */
function skirtMesh(face: P[], outer: P[]): THREE.BufferGeometry {
  const path: P[] = [face[face.length - 1], ...outer, face[0]];
  const pts = resample(path, 8);
  const P: number[] = [], I: number[] = [];
  const prof = SKIRT;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const ox = p.tz, oz = -p.tx; // left of the outer path = away from the massif
    const wob = 2 * noise.noise2(p.s * 0.02, 7.7);
    for (const [d, dy] of prof) P.push(p.x + ox * (d + wob * (d > 0 ? 1 : 0)), TOP + dy + (d > 0 && d < 20 ? 2 * noise.noise2(p.s * 0.05, d) : 0), p.z + oz * (d + wob * (d > 0 ? 1 : 0)));
    if (i > 0) {
      const a0 = (i - 1) * prof.length, b0 = i * prof.length;
      for (let j = 0; j < prof.length - 1; j++) I.push(a0 + j, b0 + j, a0 + j + 1, b0 + j, b0 + j + 1, a0 + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/** Make sure a strip's triangles face `want` (dot of the first triangle's normal). */
function faceToward(g: THREE.BufferGeometry, want: THREE.Vector3): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.getIndex()!.array as Uint16Array | Uint32Array;
  const a = new THREE.Vector3().fromBufferAttribute(pos, idx[0]);
  const b = new THREE.Vector3().fromBufferAttribute(pos, idx[1]).sub(a);
  const c = new THREE.Vector3().fromBufferAttribute(pos, idx[2]).sub(a);
  if (b.cross(c).dot(want) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.getIndex()!.needsUpdate = true;
    g.computeVertexNormals();
  }
}

/** Wind-carved snow dunes scattered over a massif top (kept back from the rims). */
function dunes(cb: ContentBuilder, m: { face: P[]; outer: P[] }, seed: number): void {
  const poly = m.face.concat(m.outer);
  const edge = (x: number, z: number) => {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
      d = Math.min(d, segDist(x, z, ax, az, bx, bz));
    }
    return d;
  };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  const rnd = new Random(seed);
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 34; tries++) {
    const x = rnd.range(x0, x1), z = rnd.range(z0, z1);
    if (!inPoly(poly, x, z)) continue;
    const e = edge(x, z);
    if (e < 16) continue;
    const rx = Math.min(e - 6, rnd.range(9, 22)), rz = Math.min(e - 6, rnd.range(7, 16)), ry = rnd.range(1.4, 3.6);
    const g = boulder(seed + tries, rx, ry, rz, 1);
    cb.mesh(wtMat('snow'), g, { x, y: TOP - ry * 0.35, z, yaw: rnd.range(0, Math.PI) }, { castShadow: false });
    g.dispose();
    placed++;
  }
}

/** Build the cliffs (meshes merged into `cb`) and their colliders. */
export function buildCliffs(cb: ContentBuilder): void {
  MASSIFS.forEach((m, k) => {
    const face = faceMesh(m.face, 13 + k * 31);
    // The first face segment's open side: left normal of its first segment.
    const [ax, az] = m.face[0], [bx, bz] = m.face[1];
    const l = Math.hypot(bx - ax, bz - az);
    faceToward(face, new THREE.Vector3((bz - az) / l, 0, -(bx - ax) / l));
    cb.mesh(wtMat('ice_cliff'), face, { x: 0, y: 0, z: 0 });
    face.dispose();
    const rim = corniceMesh(m.face, 5 + k * 17);
    cb.mesh(wtMat('snow'), rim, { x: 0, y: 0, z: 0 });
    rim.dispose();
    const top = topMesh(m.face, m.outer);
    cb.mesh(wtMat('snow'), top, { x: 0, y: 0, z: 0 }, { castShadow: false });
    top.dispose();
    dunes(cb, m, 400 + k * 97);
    const skirt = skirtMesh(m.face, m.outer);
    // The outer path runs on, so the open side of its first segment is to its left as well.
    const p0 = m.face[m.face.length - 1], p1 = m.outer[0];
    const sl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    faceToward(skirt, new THREE.Vector3((p1[1] - p0[1]) / sl, 0.6, -(p1[0] - p0[0]) / sl));
    cb.mesh(wtMat('ice_cliff'), skirt, { x: 0, y: 0, z: 0 });
    skirt.dispose();
    // Colliders: a thick slab behind every face segment (front 0.8 m proud of the face line to cover the bulges).
    for (let i = 0; i < m.face.length - 1; i++) {
      const [x0, z0] = m.face[i], [x1, z1] = m.face[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.5) continue;
      const tx = (x1 - x0) / len, tz = (z1 - z0) / len;
      const rx = -tz, rz = tx; // right = into the massif
      const T = 12;
      const off = T / 2 - 0.8;
      const base = Math.min(z0, z1) < GATE_Z - 1 ? -10 : 0;
      cb.collider({ shape: 'box', x: (x0 + x1) / 2 + rx * off, y: (TOP + base) / 2, z: (z0 + z1) / 2 + rz * off, hx: len / 2 + 0.6, hy: (TOP - base) / 2, hz: T / 2, yaw: Math.atan2(-tz, tx), walkable: true, solid: true, surface: 'ice' });
    }
  });
  // The massif interior is solid all the way up (walkable tops for fliers):
  // a raster of boxes kept a few metres behind the face line, and stepped
  // bands under the skirt so nothing can walk into the glacier from outside.
  for (const m of MASSIFS) {
    const poly = m.face.concat(m.outer);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of poly) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    const C = 6;
    const faceDist = (x: number, z: number) => {
      let d = Infinity;
      for (let i = 0; i < m.face.length - 1; i++) d = Math.min(d, segDist(x, z, m.face[i][0], m.face[i][1], m.face[i + 1][0], m.face[i + 1][1]));
      return d;
    };
    const solid = (x: number, z: number) => {
      for (const [dx, dz] of [[-C / 2, -C / 2], [C / 2, -C / 2], [-C / 2, C / 2], [C / 2, C / 2]]) if (!inPoly(poly, x + dx, z + dz)) return false;
      return faceDist(x, z) > C * 0.75 + 2;
    };
    for (const r of rasterRects(Math.floor(x0 / C) * C, Math.floor(z0 / C) * C, Math.ceil(x1 / C) * C, Math.ceil(z1 / C) * C, C, solid)) {
      const base = Math.min(0, heightAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2) - 2);
      cb.collider({ shape: 'box', x: (r.x0 + r.x1) / 2, y: (TOP + base) / 2, z: (r.z0 + r.z1) / 2, hx: (r.x1 - r.x0) / 2, hy: (TOP - base) / 2, hz: (r.z1 - r.z0) / 2, walkable: true, solid: true, surface: 'snow' });
    }
    // Skirt bands: one box per outer segment and band, top at the skirt's lower edge of that band.
    const path: P[] = [m.face[m.face.length - 1], ...m.outer, m.face[0]];
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len;
      const ox = tz, oz = -tx; // away from the massif
      for (const [d0, d1, top] of BANDS) {
        const dm = (d0 + d1) / 2;
        const cx = (ax + bx) / 2 + ox * dm, cz = (az + bz) / 2 + oz * dm;
        const base = Math.min(0, heightAt(cx, cz) - 2);
        if (top <= base + 0.5) continue;
        cb.collider({ shape: 'box', x: cx, y: (top + base) / 2, z: cz, hx: len / 2 + 1, hy: (top - base) / 2, hz: (d1 - d0) / 2, yaw: Math.atan2(-tz, tx), walkable: true, solid: true, surface: 'snow' });
      }
    }
  }
}
