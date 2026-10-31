import * as THREE from 'three';
import { SimplexNoise } from '../../../../core/Noise';
import { heightAt } from '../../../Heightfield';
import type { Kit } from '../parts';
import { tunnelCeil } from './sanctuary';
import { BASE, C, DEG, FOOT_R, LEVEL_Y, RIM, SANCTUARY, SEED, SHELVES, SUMMIT_R, TERRACES, TRAIL_TOP, floorAt, floorY, inTrailTrench, polar, rOutAt, radiusOf, rockTop, sanctuaryFace, summitRAt, trailAlong, trailLateral, yawOut, type ShelfDef, type TerraceDef } from './layout';

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
  // The sanctuary tunnel passes through the summit cliff: its steep faces open there (the façade,
  // the cliff skirt above it and the tunnel lining close the hole).
  const doorCut = (j: number, i: number): boolean => {
    const t0 = (i / SEG) * 360, t1 = ((i + 1) / SEG) * 360;
    if (j < 18 || j > 33 || t0 < SANCTUARY.th - 4.5 || t1 > SANCTUARY.th + 4.5) return false;
    const ys = [v(j, i), v(j, i + 1), v(j + 1, i), v(j + 1, i + 1)].map((q) => pos[q * 3 + 1]);
    return Math.max(...ys) - Math.min(...ys) > 3;
  };
  for (let j = 1; j < RINGS; j++) {
    for (let i = 0; i < SEG; i++) {
      if (doorCut(j, i)) continue;
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
  // Strata wander up and down round the rock (folded beds), so they never read as courses of masonry.
  float strataY = p.y + (rn(p * vec3(0.05, 0.0, 0.05)) - 0.5) * 6.0 + (rn(p * vec3(0.012, 0.0, 0.012) + 4.0) - 0.5) * 14.0;
  float band = fract(strataY / 4.6);
  float layer = rh(vec3(floor(strataY / 4.6), 3.0, 7.0));
  vec3 rock = mix(vec3(0.45, 0.40, 0.34), vec3(0.63, 0.56, 0.47), layer * 0.6 + big * 0.4);
  rock = mix(rock, rock * vec3(1.1, 0.98, 0.86), smoothstep(0.5, 0.9, rn(p * 0.07)));
  rock = mix(rock, rock * vec3(0.9, 0.95, 1.04), smoothstep(0.6, 0.95, rn(p * 0.05 + 9.0)));
  float nearPin = 1.0 - smoothstep(96.0, 112.0, length(p.xz - vec2(${C.x.toFixed(1)}, ${C.z.toFixed(1)})));
  rock *= 1.0 - (0.16 * smoothstep(0.82, 0.97, band) + 0.06 * smoothstep(0.15, 0.0, band)) * (0.25 + 0.75 * nearPin);
  // Rain streaks and fissures: long vertical smudges, darker in the cracks.
  float streak = rn(vec3(p.x * 0.55, p.y * 0.018, p.z * 0.55));
  rock *= 1.0 - 0.22 * smoothstep(0.55, 0.85, streak) * (1.0 - abs(wn.y));
  float crack = smoothstep(0.06, 0.0, abs(rn(vec3(p.x * 0.3, p.y * 0.035, p.z * 0.3)) - 0.5)) * smoothstep(0.4, 0.7, rn(p * 0.11));
  rock *= 1.0 - 0.35 * crack * (1.0 - abs(wn.y));
  float up = smoothstep(0.42, 0.8, wn.y);
  float mossy = up * smoothstep(0.25, 0.65, rn(p * 0.21) * 0.6 + big * 0.6);
  vec3 moss = mix(vec3(0.27, 0.39, 0.17), vec3(0.42, 0.52, 0.24), rn(p * 0.6));
  vec3 col = mix(rock, moss, mossy);
  // Moss and creepers hanging down the cliffs just under each terrace's edge.
  float below = 1e3;
  ${LEVEL_Y.slice(1).map((y) => `below = min(below, abs(${(BASE + y).toFixed(1)} - p.y - 3.5));`).join('\n  ')}
  float drip = smoothstep(3.6, 0.6, below) * smoothstep(0.35, 0.72, rn(vec3(p.x * 0.45, p.y * 0.07, p.z * 0.45))) * (1.0 - up);
  drip *= nearPin;
  col = mix(col, moss * 0.8, drip * 0.75);
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
  for (const t of TERRACES) (t.level === 0 ? gateFloor : terraceFloor)(k, t);
  // Openings in the rock skin: the trail trench through the gate plaza's edge, the sanctuary door.
  const trench = (th: number, yy: number, r: number) => {
    const p = polar(th, r);
    return yy < BASE + 1 && inTrailTrench(p.x, p.z, TRAIL_TOP.wall + TRAIL_TOP.wallT);
  };
  const doorSpan = Math.asin((SANCTUARY.half + 0.8) / sanctuaryFace()) / DEG;
  const door = (th: number, yy: number) => Math.abs(th - SANCTUARY.th) < doorSpan && yy < BASE + SANCTUARY.top + 0.6;
  for (const t of TERRACES) cliffSkirts(k, rock, (th) => rOutAt(t, th), t.a0, t.a1, t.y, t.level === 0 ? 1.2 : 4.5, t.level, t.level === 0 ? trench : undefined);
  cliffSkirts(k, rock, (th) => summitRAt(th) + 0.4, 0, 360, LEVEL_Y[6], 4.5, 6, door);
  for (const s of SHELVES) shelfFloor(k, s);
  // Summit disc; the sanctuary chamber is hollowed out of the rock under it.
  const top = floorY(LEVEL_Y[6]);
  const disc = bandGeometry(() => 0.01, (th) => summitRAt(th) + 0.4, 0, 360, top - 0.5, top, 160);
  k.main.mesh('paving', disc, { x: C.x, y: 0, z: C.z });
  disc.dispose();
  summitCore(k, top);
  retainingWall(k, (th) => summitRAt(th) + 0.4, 0, 360, LEVEL_Y[6], 4.5);
  // Mesa ground (L0): a thin walkable disc just above the heightfield plateau, under the rock skin
  // (inside the trail's top; the ring beyond it in sectors, clear of the trench).
  k.main.collider({ shape: 'cylinder', x: C.x, y: BASE - 0.1, z: C.z, r: TRAIL_TOP.r0 - 0.3, hy: 0.3, walkable: true, solid: true, surface: 'stone' });
  const gate = TERRACES.find((t) => t.level === 0)!;
  for (let a = gate.a1; a < gate.a0 + 360; a += 6) {
    const th = Math.min(a + 3, gate.a0 + 357);
    sectorBox(k, th, 3, TRAIL_TOP.r0 - 0.5, RIM, BASE + 0.2, BASE - 0.4);
  }
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
 * Gate plaza (L0): the paved annular sector with the trail's stair trench notched out of its
 * outer edge, trench walls with parapets, and floor colliders that keep clear of the trench.
 */
function gateFloor(k: Kit, t: TerraceDef): void {
  const top = floorY(t.y);
  const T = TRAIL_TOP;
  const edge = T.wall + T.wallT;
  const dx = T.b.x - T.a.x, dz = T.b.z - T.a.z, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
  // Where a line parallel to the trail (lateral offset L) enters the circle of radius r.
  const enter = (L: number, r: number) => {
    const ox = T.a.x + nx * L - C.x, oz = T.a.z + nz * L - C.z;
    const b = ox * ux + oz * uz, c = ox * ox + oz * oz - r * r;
    const s = -b - Math.sqrt(Math.max(0, b * b - c));
    return { x: T.a.x + ux * s + nx * L, z: T.a.z + uz * s + nz * L, s };
  };
  const th = (p: { x: number; z: number }) => {
    const a = Math.atan2(p.z - C.z, p.x - C.x) / DEG;
    return a < 0 ? a + 360 : a;
  };
  const sides = [edge, -edge].map((L) => ({ out: enter(L, t.rOut), inn: enter(L, T.r0) })).sort((p, q) => th(q.out) - th(p.out));
  const [hi, lo] = sides;
  const pts: Array<{ x: number; z: number }> = [];
  for (let a = t.a0; a <= t.a1 + 1e-6; a += 1) pts.push(polar(a, t.rIn - 0.3));
  for (let a = t.a1; a > th(hi.out); a -= 1) pts.push(polar(a, t.rOut));
  pts.push(hi.out, hi.inn, lo.inn, lo.out);
  for (let a = Math.floor(th(lo.out)); a >= t.a0; a -= 1) pts.push(polar(a, t.rOut));
  pts.push(polar(t.a0, t.rOut));
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x - C.x, -(p.z - C.z))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
  k.main.mesh('paving', g, { x: C.x, y: top - 0.5, z: C.z });
  g.dispose();
  // Colliders: radial strips per 1.5°, split in 0.5 m cells so none reaches into the trench.
  const step = 1.5, dr = 0.5;
  for (let a = t.a0; a < t.a1 - 1e-6; a += step) {
    const c = a + step / 2;
    let start = -1;
    const flush = (r1: number) => {
      if (start >= 0 && r1 > start + 0.01) sectorBox(k, c, step / 2, start, r1, top, BASE - 30);
      start = -1;
    };
    for (let r = t.rIn; r < t.rOut - 1e-6; r += dr) {
      const hx = (r + dr) * Math.sin((step / 2) * DEG) + 0.08;
      const yaw = yawOut(c);
      const cx = Math.cos(yaw), cz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
      const m = polar(c, r + dr / 2);
      let clear = true;
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const qx = m.x + cx * su * hx + fx * sv * (dr / 2), qz = m.z + cz * su * hx + fz * sv * (dr / 2);
        if (radiusOf(qx, qz) > T.r0 - 0.4 && Math.abs(trailLateral(qx, qz)) < T.wall + 0.05 && trailAlong(qx, qz) > -2 && trailAlong(qx, qz) < len + 1) clear = false;
      }
      if (clear) {
        if (start < 0) start = r;
      } else flush(r);
    }
    flush(t.rOut);
  }
  // Trench walls with parapets (and walkable shoulders under the plaza paving).
  const s0 = enter(0, T.r0 - 0.6).s, s1 = enter(0, t.rOut + 1.6).s;
  let low = Infinity;
  for (let s = s1; s <= s0; s += 1) low = Math.min(low, heightAt(T.a.x + ux * s, T.a.z + uz * s));
  const bottom = low - 1.2, cap = top + 0.9;
  const yaw = Math.atan2(ux, uz);
  for (const side of [-1, 1]) {
    const L = side * (T.wall + T.wallT / 2);
    const sm = (s0 + s1) / 2, run = s0 - s1;
    const cx = T.a.x + ux * sm + nx * L, cz = T.a.z + uz * sm + nz * L;
    k.main.box('stone_white', { x: cx, y: (cap + bottom) / 2, z: cz, sx: T.wallT, sy: cap - bottom, sz: run, yaw });
    k.main.box('stone_light', { x: cx, y: cap + 0.05, z: cz, sx: T.wallT + 0.12, sy: 0.12, sz: run + 0.1, yaw });
    k.main.collider({ shape: 'box', x: cx, y: (cap + bottom) / 2, z: cz, hx: T.wallT / 2, hy: (cap - bottom) / 2, hz: run / 2, yaw, walkable: false, solid: true, surface: 'stone' });
    const Ls = side * (T.wall + T.shoulder) / 2;
    const sx = T.a.x + ux * sm + nx * Ls, sz = T.a.z + uz * sm + nz * Ls;
    k.main.collider({ shape: 'box', x: sx, y: (top + bottom) / 2, z: sz, hx: (T.shoulder - T.wall) / 2, hy: (top - bottom) / 2, hz: run / 2, yaw, walkable: true, solid: true, surface: 'stone' });
  }
}

/**
 * Collision for the summit rock: solid below the sanctuary floor, a ring of wall sectors round the
 * chamber up to the summit floor (open below the tunnel's ceiling where the tunnel passes), the
 * tunnel's side walls, vestibule floor and stair ramp, the summit floor over the chamber and the
 * rim sectors of the summit cliff.
 */
function summitCore(k: Kit, top: number): void {
  const S = SANCTUARY;
  const floor = BASE + S.floor, tunnelTop = BASE + S.top;
  const coreR = SUMMIT_R - 0.5;
  k.main.collider({ shape: 'cylinder', x: C.x, y: (floor + BASE - 30) / 2, z: C.z, r: coreR, hy: (floor - BASE + 30) / 2, walkable: true, solid: true, surface: 'stone' });
  for (let i = 0; i < 36; i++) {
    const c = S.th + i * 10;
    const near = i === 0 || i === 1 || i === 35;
    sectorBox(k, c, 5, S.r, coreR, top, near ? tunnelTop : floor);
  }
  k.main.collider({ shape: 'cylinder', x: C.x, y: BASE + (S.ceil + LEVEL_Y[6] + 0.2) / 2, z: C.z, r: S.r + 0.6, hy: (LEVEL_Y[6] + 0.2 - S.ceil) / 2, walkable: true, solid: true, surface: 'stone' });
  for (let a = 0; a < 360; a += 6) {
    const c = a + 3;
    const cut = Math.abs(c - S.th) < 4;
    sectorBox(k, c, 3, SUMMIT_R - 2, summitRAt(c) + 0.3, top, cut ? tunnelTop : BASE + LEVEL_Y[4]);
  }
  // Tunnel: side walls from inside the chamber's portal to the façade front, the vestibule floor
  // at the courtyard's level and the stair down into the chamber.
  const yaw = yawOut(S.th);
  const ax = Math.cos(S.th * DEG), az = Math.sin(S.th * DEG);
  const tx = -az, tz = ax;
  const rf = sanctuaryFace() + 2.6;
  const along = (r0: number, r1: number, lat: number) => ({ x: C.x + ax * (r0 + r1) / 2 + tx * lat, z: C.z + az * (r0 + r1) / 2 + tz * lat, h: (r1 - r0) / 2 });
  for (const side of [-1, 1]) {
    const w = along(S.r - 1.2, rf, side * (S.half + 1.7));
    k.main.collider({ shape: 'box', x: w.x, y: (floor + tunnelTop) / 2, z: w.z, hx: 1.7, hy: (tunnelTop - floor) / 2 + 0.05, hz: w.h, yaw, walkable: false, solid: true, surface: 'stone' });
  }
  const walk = floorY(LEVEL_Y[4]);
  const v = along(S.stairR, rf, 0);
  k.main.collider({ shape: 'box', x: v.x, y: (walk + floor) / 2, z: v.z, hx: S.half + 0.1, hy: (walk - floor) / 2, hz: v.h, yaw, walkable: true, solid: true, surface: 'stone' });
  const st = along(S.r, S.stairR, 0);
  const bottom = floor - 0.7;
  k.main.collider({ shape: 'box', x: st.x, y: (walk + bottom) / 2, z: st.z, hx: st.h + 0.05, hy: (walk - bottom) / 2, hz: S.half + 0.1, yaw: Math.atan2(-az, ax), slopeRise: walk - floor, walkable: true, solid: true, surface: 'stone' });
  // The ceiling over the stair slopes down to the chamber's doorway: stepped boxes up to the
  // tunnel's top keep the camera out of the rock.
  for (let i = 0; i < 4; i++) {
    const v0 = S.r - 0.3 + ((S.stairR - S.r + 0.3) * i) / 4, v1 = S.r - 0.3 + ((S.stairR - S.r + 0.3) * (i + 1)) / 4;
    const lo = tunnelCeil(v0);
    const c = along(v0, v1, 0);
    k.main.collider({ shape: 'box', x: c.x, y: (lo + tunnelTop) / 2, z: c.z, hx: S.half + 0.2, hy: (tunnelTop - lo) / 2, hz: c.h, yaw, walkable: false, solid: true, surface: 'stone' });
  }
}

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
function cliffSkirts(k: Kit, rock: THREE.Material, rEdgeAt: (th: number) => number, a0: number, a1: number, y: number, wall: number, level: number, hole?: (th: number, yy: number, r: number) => boolean): void {
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
    const strata = 0.55 + 0.3 * Math.sin((yy / 3.4) * Math.PI * 2 + SK.noise2(a * 3, yy * 0.05) * 2.2) + 0.15 * Math.sin((yy / 8.3) * Math.PI * 2 + SK.noise2(a * 1.3 + 7, yy * 0.02) * 3.1);
    const flute = SK.noise2(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32 + yy * 0.025);
    const blob = SK.noise2(Math.cos(a) * r * 0.06 + yy * 0.03, Math.sin(a) * r * 0.06);
    return Math.max(0, 0.25 + strata * 0.75 + flute * 1.15 + blob * 1.3 + 0.4);
  };
  const face = (pts: (i: number, yy: number) => [number, number], n: number, bottoms: number[], cut?: (i: number, yy: number, r: number) => boolean) => {
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
        if (cut) {
          const my = (pos[a * 3 + 1] + pos[(b + 1) * 3 + 1]) / 2;
          const mr = Math.hypot((pos[a * 3] + pos[(b + 1) * 3]) / 2, (pos[a * 3 + 2] + pos[(b + 1) * 3 + 2]) / 2);
          if (cut(i + 0.5, my, mr)) continue;
        }
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
      const foot = 1 - THREE.MathUtils.smoothstep(yy, bottoms[i] + 1.2, bottoms[i] + 3.8);
      const r = rEdge + 0.05 - recess(th, yy, rEdge) * (1 - 0.92 * foot);
      return [Math.cos(th * DEG) * r, Math.sin(th * DEG) * r];
    },
    cols,
    bottoms,
    hole ? (i, yy, r) => hole(a0 + ((a1 - a0) * i) / cols, yy, r) : undefined,
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
