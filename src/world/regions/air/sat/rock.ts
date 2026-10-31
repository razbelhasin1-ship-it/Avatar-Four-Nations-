import * as THREE from 'three';
import { SimplexNoise } from '../../../../core/Noise';
import { heightAt } from '../../../Heightfield';
import type { Kit } from '../parts';
import { BASE, C, DEG, FOOT_R, LEVEL_Y, RIM, SEED, SHELVES, SUMMIT_R, TERRACES, floorAt, floorY, polar, rOutAt, rockTop, summitRAt, yawOut, type ShelfDef, type TerraceDef } from './layout';

/**
 * The pinnacle: one polar height map (flat terrace tops, near-vertical cliffs
 * between them, a roughened rock cone elsewhere) shaded in world space —
 * layered strata, dark cracks and moss on the tops — plus the paved terrace
 * floors (0.45 m slabs over the rock, so no surface is coplanar with
 * another), white retaining walls along the terrace edges and the colliders:
 * a tall box per few degrees of each terrace (walkable top, cliff sides), a
 * walkable ramp box per patch of the cone, the summit core and the mesa
 * ground.
 */

export { FLOOR_LIFT, floorY } from './layout';

const SEG = 240;
const RINGS = 90;

/** Rock surface of the whole pinnacle (local to C, world y). */
export function pinnacleGeometry(): THREE.BufferGeometry {
  const pos = new Float32Array((1 + SEG * RINGS) * 3);
  pos[0] = 0;
  pos[1] = BASE + rockTop(0, 0);
  pos[2] = 0;
  let o = 3;
  for (let j = 1; j <= RINGS; j++) {
    for (let i = 0; i < SEG; i++) {
      const th = (i / SEG) * 360;
      pos[o++] = Math.cos(th * DEG) * j;
      pos[o++] = BASE + rockTop(th, j);
      pos[o++] = Math.sin(th * DEG) * j;
    }
  }
  const idx: number[] = [];
  const v = (j: number, i: number) => 1 + (j - 1) * SEG + (i % SEG);
  for (let i = 0; i < SEG; i++) idx.push(0, v(1, i + 1), v(1, i));
  for (let j = 1; j < RINGS; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = v(j, i), b = v(j, i + 1), c = v(j + 1, i), d = v(j + 1, i + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Weathered pinnacle rock: flat-shaded facets; colour from world position — strata bands every
 * few metres, darker cracks, warm and cool patches, moss on upward faces, grass on the mesa.
 */
export function rockMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, metalness: 0, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRockW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRockW;
float rh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float rn(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rh(i), rh(i + vec3(1,0,0)), f.x), mix(rh(i + vec3(0,1,0)), rh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rh(i + vec3(0,0,1)), rh(i + vec3(1,0,1)), f.x), mix(rh(i + vec3(0,1,1)), rh(i + vec3(1,1,1)), f.x), f.y), f.z);
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 p = vRockW;
  float big = rn(p * 0.035);
  float strataY = p.y + (rn(p * vec3(0.05, 0.0, 0.05)) - 0.5) * 3.0;
  float band = fract(strataY / 3.4);
  float layer = rh(vec3(floor(strataY / 3.4), 3.0, 7.0));
  vec3 rock = mix(vec3(0.40, 0.37, 0.33), vec3(0.56, 0.52, 0.46), layer * 0.65 + big * 0.35);
  rock = mix(rock, rock * vec3(1.1, 0.98, 0.86), smoothstep(0.5, 0.9, rn(p * 0.07)));
  rock = mix(rock, rock * vec3(0.9, 0.95, 1.04), smoothstep(0.6, 0.95, rn(p * 0.05 + 9.0)));
  rock *= 1.0 - 0.3 * smoothstep(0.8, 0.97, band) - 0.1 * smoothstep(0.15, 0.0, band);
  // Rain streaks and fissures: long vertical smudges, darker in the cracks.
  float streak = rn(vec3(p.x * 0.55, p.y * 0.018, p.z * 0.55));
  rock *= 1.0 - 0.22 * smoothstep(0.55, 0.85, streak) * (1.0 - abs(wn.y));
  float crack = smoothstep(0.06, 0.0, abs(rn(vec3(p.x * 0.3, p.y * 0.035, p.z * 0.3)) - 0.5)) * smoothstep(0.4, 0.7, rn(p * 0.11));
  rock *= 1.0 - 0.35 * crack * (1.0 - abs(wn.y));
  float up = smoothstep(0.42, 0.8, wn.y);
  float mossy = up * smoothstep(0.25, 0.65, rn(p * 0.21) * 0.6 + big * 0.6);
  vec3 moss = mix(vec3(0.27, 0.39, 0.17), vec3(0.42, 0.52, 0.24), rn(p * 0.6));
  vec3 col = mix(rock, moss, mossy);
  float mesa = smoothstep(${(BASE + 1.2).toFixed(1)}, ${(BASE + 0.4).toFixed(1)}, p.y) * up;
  col = mix(col, mix(vec3(0.38, 0.47, 0.25), vec3(0.55, 0.53, 0.42), rn(p * 0.3)), mesa);
  diffuseColor.rgb = col;
}`,
      );
  };
  m.name = 'sat_rock';
  return m;
}

/** Tall walkable box spanning an annular piece (θ, radial band) from `bottom` up to `top`. */
function sectorBox(k: Kit, th: number, half: number, rIn: number, rOut: number, top: number, bottom: number): void {
  const rm = (rIn + rOut) / 2;
  const p = polar(th, rm);
  k.main.collider({ shape: 'box', x: p.x, y: (top + bottom) / 2, z: p.z, hx: rOut * Math.sin(half * DEG) + 0.08, hz: (rOut - rIn) / 2, hy: (top - bottom) / 2, yaw: yawOut(th), walkable: true, solid: true, surface: 'stone' });
}

/** Paving slabs, retaining walls and floor colliders of every terrace and shelf. */
export function buildTerraces(k: Kit, rock: THREE.Material): void {
  for (const t of TERRACES) terraceFloor(k, t);
  for (const t of TERRACES) cliffSkirts(k, rock, (th) => rOutAt(t, th), t.a0, t.a1, t.y, t.level === 0 ? 1.2 : 4.5, t.level);
  cliffSkirts(k, rock, (th) => summitRAt(th) + 0.4, 0, 360, LEVEL_Y[6], 4.5, 6);
  for (const s of SHELVES) shelfFloor(k, s);
  // Summit disc (the sanctuary chamber is cut into it later; the floor stays walkable above it).
  const top = floorY(LEVEL_Y[6]);
  const disc = bandGeometry(() => 0.01, (th) => summitRAt(th) + 0.4, 0, 360, top - 0.5, top, 160);
  k.main.mesh('paving', disc, { x: C.x, y: 0, z: C.z });
  disc.dispose();
  k.main.collider({ shape: 'cylinder', x: C.x, y: (top + BASE - 30) / 2, z: C.z, r: SUMMIT_R - 0.5, hy: (top - BASE + 30) / 2, walkable: true, solid: true, surface: 'stone' });
  for (let a = 0; a < 360; a += 6) sectorBox(k, a + 3, 3, SUMMIT_R - 2, summitRAt(a + 3) + 0.3, top, BASE + LEVEL_Y[4]);
  retainingWall(k, (th) => summitRAt(th) + 0.4, 0, 360, LEVEL_Y[6], 4.5);
  // Mesa ground (L0): a thin walkable disc just above the heightfield plateau, under the rock skin.
  k.main.collider({ shape: 'cylinder', x: C.x, y: BASE - 0.1, z: C.z, r: 90, hy: 0.3, walkable: true, solid: true, surface: 'stone' });
  // The cone between terraces: walkable ramps that follow the rock (radial bands, rising inward).
  const step = 6;
  for (let a = 0; a < 360; a += step) {
    for (let r = SUMMIT_R; r < FOOT_R; r += 4) {
      const th = a + step / 2;
      const rA = r, rB = Math.min(FOOT_R, r + 4);
      if (floorAt(th, (rA + rB) / 2) !== null) continue;
      let yIn = 0, yOut = 0;
      for (const d of [-step / 3, 0, step / 3]) {
        yIn += rockTop(th + d, rA) / 3;
        yOut += rockTop(th + d, rB) / 3;
      }
      yIn = Math.max(yIn, yOut);
      const p = polar(th, (rA + rB) / 2);
      const topW = BASE + yIn, botW = BASE + yOut - 14;
      const yaw = Math.atan2(Math.sin(th * DEG), -Math.cos(th * DEG));
      k.main.collider({ shape: 'box', x: p.x, y: (topW + botW) / 2, z: p.z, hx: (rB - rA) / 2, hz: rB * Math.sin((step / 2) * DEG) + 0.1, hy: (topW - botW) / 2, yaw, slopeRise: yIn - yOut, walkable: true, solid: true, surface: 'rock' });
    }
  }
}

function terraceFloor(k: Kit, t: TerraceDef): void {
  const top = floorY(t.y);
  const slab = bandGeometry(() => t.rIn - 0.3, (th) => rOutAt(t, th), t.a0, t.a1, top - 0.5, top, Math.max(6, Math.round((t.a1 - t.a0) / 1.5)));
  k.main.mesh('paving', slab, { x: C.x, y: 0, z: C.z });
  slab.dispose();
  const n = Math.max(2, Math.ceil((t.a1 - t.a0) / 3));
  const half = (t.a1 - t.a0) / n / 2;
  for (let i = 0; i < n; i++) {
    const th = t.a0 + (2 * i + 1) * half;
    sectorBox(k, th, half, t.rIn, rOutAt(t, th), top, BASE - 30);
  }
  if (t.level > 0) retainingWall(k, (th) => rOutAt(t, th) + 0.35, t.a0, t.a1, t.y, Math.min(4.5, t.y - rockTop((t.a0 + t.a1) / 2, t.rOut + EDGE_PAD)));
}

const EDGE_PAD = 6.5;

/**
 * Annular-sector prism whose inner and outer radii vary with the bearing (θ in degrees):
 * top, bottom, outer and inner faces plus end caps (none for a full ring).
 */
export function bandGeometry(rIn: (th: number) => number, rOut: (th: number) => number, a0: number, a1: number, y0: number, y1: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [], uv: number[] = [];
  const full = a1 - a0 >= 359.9;
  const quad = (p: number[][], u0: number, u1: number, v0: number, v1: number) => {
    const b = pos.length / 3;
    for (const v of p) pos.push(v[0], v[1], v[2]);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const P = (r: number, th: number, y: number) => [Math.cos(th * DEG) * r, y, Math.sin(th * DEG) * r];
  for (let i = 0; i < segs; i++) {
    const s0 = a0 + ((a1 - a0) * i) / segs, s1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    const i0 = rIn(s0), i1 = rIn(s1), o0 = rOut(s0), o1 = rOut(s1);
    const u0 = (s0 * DEG * o0) / 3, u1 = (s1 * DEG * o1) / 3;
    quad([P(i0, s0, y1), P(i1, s1, y1), P(o1, s1, y1), P(o0, s0, y1)], u0, u1, i0 / 3, o0 / 3);
    quad([P(o0, s0, y0), P(o0, s0, y1), P(o1, s1, y1), P(o1, s1, y0)], u0, u1, y0 / 3, y1 / 3);
    quad([P(i1, s1, y0), P(i1, s1, y1), P(i0, s0, y1), P(i0, s0, y0)], u1, u0, y0 / 3, y1 / 3);
    quad([P(i1, s1, y0), P(i0, s0, y0), P(o0, s0, y0), P(o1, s1, y0)], u1, u0, i0 / 3, o0 / 3);
  }
  if (!full) {
    quad([P(rIn(a0), a0, y0), P(rIn(a0), a0, y1), P(rOut(a0), a0, y1), P(rOut(a0), a0, y0)], 0, 1, 0, 1);
    quad([P(rOut(a1), a1, y0), P(rOut(a1), a1, y1), P(rIn(a1), a1, y1), P(rIn(a1), a1, y0)], 0, 1, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** White masonry band down from a terrace edge (radius per bearing), with a light coping. */
export function retainingWall(k: Kit, r: (th: number) => number, a0: number, a1: number, y: number, depth: number): void {
  const top = floorY(y);
  const segs = Math.max(4, Math.round((a1 - a0) / 1.5));
  const wall = bandGeometry((th) => r(th) - 0.55, r, a0, a1, top - Math.max(1.2, depth), top - 0.05, segs);
  k.main.mesh('stone_white', wall, { x: C.x, y: 0, z: C.z });
  wall.dispose();
  const cope = bandGeometry((th) => r(th) - 0.6, (th) => r(th) + 0.1, a0, a1, top - 0.05, top + 0.12, segs);
  k.main.mesh('stone_light', cope, { x: C.x, y: 0, z: C.z });
  cope.dispose();
}

function shelfFloor(k: Kit, s: ShelfDef): void {
  const top = floorY(s.y);
  const rm = (s.r0 + s.r1) / 2, len = s.r1 - s.r0;
  const p = polar(s.a, rm);
  const yaw = yawOut(s.a);
  // Slab, a stone skirt and corbels under it (the shelf hangs out over the drop).
  k.main.box('paving', { x: p.x, y: top - 0.3, z: p.z, sx: s.w, sy: 0.6, sz: len, yaw }, { collide: true, walkable: true });
  k.main.box('stone_white', { x: p.x, y: top - 1.6, z: p.z, sx: s.w - 0.4, sy: 2.0, sz: len - 0.4, yaw });
  const steps = Math.max(2, Math.floor(s.w / 5));
  for (let i = 0; i <= steps; i++) {
    const u = -s.w / 2 + 0.8 + (i * (s.w - 1.6)) / steps;
    for (const v of [0.25, 0.6]) {
      const q = { x: p.x + Math.cos(yaw) * u + Math.sin(yaw) * (v - 0.5) * len, z: p.z - Math.sin(yaw) * u + Math.cos(yaw) * (v - 0.5) * len };
      k.main.box('stone_light', { x: q.x, y: top - 3.6 - v * 2, z: q.z, sx: 0.9, sy: 3 + v * 4, sz: 0.9, yaw });
    }
  }
}

const SK = new SimplexNoise(SEED + 3);

/**
 * Rock face under a terrace edge (behind its retaining wall) down to whatever lies below: rows
 * every 2 m, recessed in strata ledges and vertical flutes so the cliff reads as layered stone.
 * It only ever recedes behind the edge, never past the floor colliders. Radial ends of a
 * sector that drop away get the same treatment.
 */
function cliffSkirts(k: Kit, rock: THREE.Material, rEdgeAt: (th: number) => number, a0: number, a1: number, y: number, wall: number, level: number): void {
  const full = a1 - a0 >= 359.9;
  const cols = Math.max(2, Math.round((a1 - a0) / 1.5));
  const top = BASE + y - wall + 0.6;
  const bottomAt = (th: number, r: number) => {
    const p = polar(th, r);
    const ground = r > RIM - 2 ? heightAt(p.x, p.z) - 1.5 : BASE + rockTop(th, r) - 1.2;
    return Math.min(top - 0.5, ground);
  };
  const recess = (th: number, yy: number, r: number) => {
    const a = th * DEG;
    const strata = 0.55 + 0.45 * Math.sin((yy / 3.4) * Math.PI * 2 + SK.noise2(a * 3, yy * 0.05) * 2.2);
    const flute = SK.noise2(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32 + yy * 0.025);
    const blob = SK.noise2(Math.cos(a) * r * 0.06 + yy * 0.03, Math.sin(a) * r * 0.06);
    return Math.max(0, 0.25 + strata * 0.75 + flute * 0.9 + blob * 0.8 + 0.4);
  };
  const face = (pts: (i: number, yy: number) => [number, number], n: number, bottoms: number[]) => {
    const yMin = Math.min(...bottoms);
    const rows = Math.max(1, Math.ceil((top - yMin) / 2));
    const pos: number[] = [];
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= rows; j++) {
        const yy = Math.max(bottoms[i], top - (j * (top - yMin)) / rows);
        const [x, z] = pts(i, yy);
        pos.push(x, yy, z);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j, b = a + rows + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // Outer face along the edge.
  const ths = Array.from({ length: cols + 1 }, (_, i) => a0 + ((a1 - a0) * i) / cols);
  const bottoms = ths.map((th) => bottomAt(th, rEdgeAt(th) + EDGE_PAD));
  const outer = face(
    (i, yy) => {
      const th = ths[i];
      const rEdge = rEdgeAt(th);
      const r = rEdge + 0.05 - recess(th, yy, rEdge);
      return [Math.cos(th * DEG) * r, Math.sin(th * DEG) * r];
    },
    cols,
    bottoms,
  );
  // Winding: the face must look outward (normals computed from index order).
  flipIfInward(outer, true);
  k.main.mesh(rock, outer, { x: C.x, y: 0, z: C.z });
  outer.dispose();
  if (full || level === 0) return;
  // Radial ends that drop away to the neighbour.
  const t = TERRACES.find((q) => q.a0 === a0 && q.a1 === a1);
  if (!t) return;
  for (const [end, dir] of [[a0, -1], [a1, 1]] as const) {
    const mid = (t.rIn + t.rOut) / 2;
    if (BASE + rockTop(end + dir * 2, mid) > BASE + t.y - 2) continue;
    const ro = rOutAt(t, end);
    const m = Math.max(2, Math.round((ro - t.rIn) / 1.5));
    const rs = Array.from({ length: m + 1 }, (_, i) => t.rIn + ((ro - t.rIn) * i) / m);
    const bs = rs.map((r) => bottomAt(end + dir * 2.5, r));
    const g = face(
      (i, yy) => {
        const r = rs[i];
        const th = end - (dir * recess(end, yy, r) * 0.9) / Math.max(8, r) / DEG;
        return [Math.cos(th * DEG) * r, Math.sin(th * DEG) * r];
      },
      m,
      bs,
    );
    flipIfInward(g, false, end + dir * 5);
    k.main.mesh(rock, g, { x: C.x, y: 0, z: C.z });
    g.dispose();
  }
}

/** Make a face's normals point away from the pinnacle axis (or toward bearing `toward`). */
function flipIfInward(g: THREE.BufferGeometry, radial: boolean, toward = 0): void {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  let score = 0;
  for (let i = 0; i < pos.count; i += 7) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dx = radial ? x : Math.cos(toward * DEG), dz = radial ? z : Math.sin(toward * DEG);
    score += nor.getX(i) * dx + nor.getZ(i) * dz;
  }
  if (score >= 0) return;
  const idx = g.getIndex()!;
  const a = idx.array as Uint16Array | Uint32Array;
  for (let i = 0; i < a.length; i += 3) {
    const t = a[i + 1];
    a[i + 1] = a[i + 2];
    a[i + 2] = t;
  }
  idx.needsUpdate = true;
  g.computeVertexNormals();
}
