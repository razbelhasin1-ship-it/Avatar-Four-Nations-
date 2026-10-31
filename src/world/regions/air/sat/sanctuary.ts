import * as THREE from 'three';
import type { GameContext } from '../../../../core/GameContext';
import { kitMaterial } from '../../../kit/Materials';
import * as G from '../geom';
import type { Kit } from '../parts';
import { am } from '../parts';
import { archWall, lp, swirl } from './kit';
import { BASE, C, DEG, LEVEL_Y, SANCTUARY as S, floorY, sanctuaryFace, yawOut } from './layout';

/**
 * The Avatar sanctuary. Outside: a white gatehouse at the foot of the summit cliff (behind the
 * labyrinth courtyard) with a thick wooden door held by three bronze swirl locks that only
 * airbending turns. Inside: a vestibule, a stair down through the rock, and the round chamber under
 * the central tower — 25 m across, 44 m tall — where the statues of past Avatars stand in niches on
 * one spiral ledge, in the order of the Avatar Cycle (air, water, earth, fire). The great statue of
 * the last Avatar before this one, a bearded elder with a flame crown, greets you at the entrance.
 * Their eyes light blue, from the floor to the top of the spiral, when the Avatar State wakes.
 *
 * The tunnel lining and the chamber use one custom material: dim, still light from four braziers
 * and two tunnel lamps, daylight from the open door, the blue wash of the glowing eyes. The chamber
 * itself is built only while the player is near the door (and disposed when they leave).
 */

const AX = Math.cos(S.th * DEG), AZ = Math.sin(S.th * DEG);
/** World point at axial distance v from C along the door bearing, lateral u (right of the outward axis). */
function at(u: number, v: number): { x: number; z: number } {
  return lp(C.x + AX * v, C.z + AZ * v, yawOut(S.th), u, 0);
}
const FLOOR = BASE + S.floor;
const CEIL = BASE + S.ceil;
const WALK = floorY(LEVEL_Y[4]);
/** Doorway into the chamber: 4 m tall at the bottom of the stair. */
const DOORWAY_H = 4.0;
/** Ceiling height over the tunnel at axial distance v (slopes down over the stair). */
export function tunnelCeil(v: number): number {
  if (v >= S.stairR) return BASE + S.top;
  const t = Math.max(0, (v - S.r) / (S.stairR - S.r));
  return FLOOR + DOORWAY_H + (BASE + S.top - FLOOR - DOORWAY_H) * t;
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
attribute vec3 aCol;
attribute float aKind;
attribute float aEye;
varying vec3 vW;
varying vec3 vN;
varying vec3 vCol;
varying float vKind;
varying float vEye;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 w = modelMatrix * p;
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vCol = aCol;
  vKind = aKind;
  vEye = aEye;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uLamp[6];
uniform vec3 uLampCol;
uniform float uGlow;
uniform float uGlowAmt;
uniform vec3 uDoor;
uniform float uDoorOpen;
uniform float uFloor;
uniform float uCeil;
uniform vec2 uCentre;
varying vec3 vW;
varying vec3 vN;
varying vec3 vCol;
varying float vKind;
varying float vEye;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 base = vCol;
  vec2 rel = vW.xz - uCentre;
  float rr = length(rel);
  if (vKind > 0.5 && vKind < 1.5) {
    // Masonry: courses and staggered joints.
    float row = floor((vW.y - uFloor) / 0.95);
    float u = atan(rel.y, rel.x) * 12.6 / 1.7 + mod(row, 2.0) * 0.5;
    float j = step(fract((vW.y - uFloor) / 0.95), 0.035) + step(fract(u), 0.03);
    base *= (0.86 + 0.22 * hash(vec2(row, floor(u)))) * (1.0 - 0.38 * min(j, 1.0));
  } else if (vKind > 1.5 && vKind < 2.5) {
    // Floor: concentric rings of slabs.
    float ring = floor(rr / 1.4);
    float seg = atan(rel.y, rel.x) * max(1.0, ring) * 1.1;
    float j = step(fract(rr / 1.4), 0.04) + step(fract(seg), 0.03);
    base *= (0.85 + 0.25 * hash(vec2(ring, floor(seg)))) * (1.0 - 0.35 * min(j, 1.0));
  }
  float h = clamp((vW.y - uFloor) / (uCeil - uFloor), 0.0, 1.0);
  // Cool, still ambient (a little from above), warm pools round the braziers and lamps.
  vec3 light = vec3(0.05, 0.056, 0.07) * (1.0 - 0.45 * h) + vec3(0.018, 0.022, 0.03) * max(n.y, 0.0);
  for (int i = 0; i < 6; i++) {
    vec3 d = uLamp[i] - vW;
    float dist = length(d);
    float att = 1.0 / (1.0 + dist * dist * 0.03);
    light += uLampCol * (1.0 - 0.7 * uGlowAmt) * att * (0.2 + 0.8 * max(dot(n, d / max(dist, 0.001)), 0.0));
  }
  vec3 dd = uDoor - vW;
  float ddist = length(dd);
  light += vec3(0.7, 0.74, 0.82) * uDoorOpen * exp(-ddist * 0.16) * (0.3 + 0.7 * max(dot(n, dd / max(ddist, 0.001)), 0.0));
  // The glow climbs the spiral: everything below its front takes a faint blue wash.
  float on = uGlowAmt * clamp((uGlow - h) / 0.05, 0.0, 1.0);
  light += vec3(0.12, 0.3, 0.8) * on * (0.75 + 0.5 * smoothstep(0.08, 0.0, abs(uGlow - h)));
  vec3 col = base * light;
  if (vKind > 2.5) col = vCol * 2.6;
  col = mix(col, vec3(0.62, 0.9, 1.0) * 4.2, vEye * on);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function sanctuaryMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uLamp: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, -1e4, 0)) },
      uLampCol: { value: new THREE.Color(1.0, 0.6, 0.32).multiplyScalar(0.95) },
      uGlow: { value: 0 },
      uGlowAmt: { value: 0 },
      uDoor: { value: new THREE.Vector3() },
      uDoorOpen: { value: 0 },
      uFloor: { value: FLOOR },
      uCeil: { value: CEIL },
      uCentre: { value: new THREE.Vector2(C.x, C.z) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  });
  m.name = 'sat_sanctuary';
  return m;
}

// ---------------------------------------------------------------------------
// Geometry helpers (non-indexed geometries with the material's attributes)
// ---------------------------------------------------------------------------

const KIND = { plain: 0, masonry: 1, floor: 2, glow: 3 } as const;

function painted(g: THREE.BufferGeometry, col: THREE.ColorRepresentation, kind = 0, eye = 0): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  const c = new THREE.Color(col);
  const cnt = n.getAttribute('position').count;
  const a = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  n.setAttribute('aCol', new THREE.BufferAttribute(a, 3));
  n.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(cnt).fill(kind), 1));
  n.setAttribute('aEye', new THREE.BufferAttribute(new Float32Array(cnt).fill(eye), 1));
  return n;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'aCol', 'aKind', 'aEye'];
  let total = 0;
  for (const p of parts) total += p.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  for (const nm of names) {
    const size = parts[0].getAttribute(nm).itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const p of parts) {
      const a = p.getAttribute(nm).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, size));
  }
  for (const p of parts) p.dispose();
  out.computeBoundingSphere();
  return out;
}

/** Scale, turn about Y, move. */
function xf(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  g.scale(sx, sy, sz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** Box from a centre in the tunnel frame (u lateral, v axial, y world) — returned in world space. */
function tunnelBox(u: number, v: number, y: number, su: number, sv: number, sy: number, col: THREE.ColorRepresentation, kind = 0): THREE.BufferGeometry {
  const p = at(u, v);
  return painted(xf(new THREE.BoxGeometry(su, sy, sv), p.x, y, p.z, yawOut(S.th)), col, kind);
}

// ---------------------------------------------------------------------------
// Statues
// ---------------------------------------------------------------------------

type Nation = 'air' | 'water' | 'earth' | 'fire';
const NATIONS: Nation[] = ['air', 'water', 'earth', 'fire'];
const STONE = '#b9b0a2';

/** A standing Avatar statue (feet at 0, facing +Z, ~2.35 m), stylized per nation; eyes flagged. */
function statueGeometry(n: Nation, elder = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col = STONE, eye = 0) => parts.push(painted(g, col, KIND.plain, eye));
  const robe: Array<[number, number]> = n === 'earth'
    ? [[0.47, 0], [0.48, 0.1], [0.42, 0.6], [0.36, 1.1], [0.33, 1.4], [0.4, 1.62], [0.42, 1.72], [0.2, 1.86], [0.1, 1.9]]
    : [[0.44, 0], [0.46, 0.1], [0.4, 0.6], [0.34, 1.1], [0.3, 1.4], [0.33, 1.62], [0.36, 1.72], [0.2, 1.86], [0.1, 1.9]];
  add(new THREE.LatheGeometry(robe.map(([r, y]) => new THREE.Vector2(r, y)), 14).scale(1, 1, 0.82));
  for (const s of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.1, 0.15, 0.66, 8);
    arm.rotateX(0.55);
    arm.rotateZ(-s * 0.32);
    arm.translate(s * 0.25, 1.43, 0.12);
    add(arm);
  }
  add(new THREE.SphereGeometry(0.11, 8, 6).translate(0, 1.13, 0.3));
  add(new THREE.CylinderGeometry(0.075, 0.085, 0.14, 8).translate(0, 1.92, 0));
  add(new THREE.SphereGeometry(0.155, 14, 10).scale(0.92, 1.1, 0.98).translate(0, 2.08, 0.02));
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.03, 0.03).translate(s * 0.056, 2.1, 0.158), STONE, 1);
  add(new THREE.BoxGeometry(0.035, 0.07, 0.04).translate(0, 2.05, 0.165));
  if (n === 'air') {
    add(new THREE.ConeGeometry(0.52, 0.42, 14, 1, true).translate(0, 1.62, 0).scale(1, 1, 0.85));
    add(new THREE.TorusGeometry(0.2, 0.035, 6, 14).rotateX(Math.PI / 2).translate(0, 1.84, 0.02));
  } else if (n === 'water') {
    add(new THREE.SphereGeometry(0.2, 12, 8, Math.PI, Math.PI).translate(0, 2.1, -0.02));
    add(new THREE.TorusGeometry(0.24, 0.05, 6, 16).rotateX(Math.PI / 2).translate(0, 1.88, 0));
    add(new THREE.SphereGeometry(0.07, 8, 6).scale(1, 1.6, 1).translate(0, 2.0, -0.21));
    for (const s of [-1, 1]) add(new THREE.TorusGeometry(0.05, 0.018, 5, 10).rotateY(Math.PI / 2).translate(s * 0.15, 1.98, 0.06));
  } else if (n === 'earth') {
    add(new THREE.BoxGeometry(0.98, 0.12, 0.42).translate(0, 1.73, 0));
    add(new THREE.CylinderGeometry(0.12, 0.155, 0.24, 12).translate(0, 2.3, 0));
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 14).translate(0, 2.2, 0));
  } else {
    add(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 8).translate(0, 2.26, -0.02));
    add(new THREE.ConeGeometry(0.06, 0.2, 6).translate(0, 2.4, -0.02));
    for (const s of [-1, 1]) {
      add(new THREE.ConeGeometry(0.04, 0.14, 5).rotateZ(-s * 0.4).translate(s * 0.05, 2.37, -0.02));
      add(new THREE.ConeGeometry(0.12, 0.32, 6).rotateZ(s * (Math.PI / 2 - 0.25)).translate(s * 0.45, 1.72, 0));
    }
  }
  if (elder) {
    // Long beard and side whiskers.
    add(new THREE.ConeGeometry(0.11, 0.5, 8).rotateX(Math.PI).translate(0, 1.79, 0.13));
    for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.035, 0.22, 5).rotateX(Math.PI).rotateZ(s * 0.25).translate(s * 0.09, 1.92, 0.14));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Shell: gatehouse, door, tunnel lining (built with the temple)
// ---------------------------------------------------------------------------

export interface SanctuaryShell {
  leaves: [THREE.Object3D, THREE.Object3D];
  locks: THREE.Object3D[];
  veil: THREE.Mesh;
  /** Door plane centre (walking level) and the yaw of its outward normal. */
  door: { x: number; z: number; y: number; yaw: number };
}

export function buildSanctuaryShell(k: Kit, mat: THREE.Material): SanctuaryShell {
  const yaw = yawOut(S.th);
  const rf = sanctuaryFace();
  const fc = at(0, rf + 0.8);
  // Gatehouse façade: a thick white wall with an arched passage, a blue roof, a gold swirl.
  const W = 10.4, H = 10.4, D = 3.6, open = S.half * 2, spring = S.top - LEVEL_Y[4] - 0.2 - S.half;
  const g = archWall(W, H, D, open, spring);
  k.main.mesh('stone_white', g, { x: fc.x, y: WALK, z: fc.z, yaw });
  g.dispose();
  const fr = at(0, rf + 2.65);
  k.main.box(am('trimOrange'), { x: fr.x, y: WALK + H - 0.9, z: fr.z, sx: W + 0.1, sy: 0.24, sz: 0.12, yaw });
  k.main.box('stone_light', { x: fc.x, y: WALK + H + 0.1, z: fc.z, sx: W + 0.5, sy: 0.25, sz: D + 0.5, yaw });
  k.main.roof(am('roof'), { x: fc.x, y: WALK + H + 0.2, z: fc.z, w: W + 0.8, d: D + 1.6, height: 2.4, yaw, overhang: 1.2, curve: 0.95, style: 'hip', ridge: am('roofTrim') });
  const fin = G.finialGeometry(0.9);
  k.main.mesh('gold', fin, { x: fc.x, y: WALK + H + 2.5, z: fc.z });
  fin.dispose();
  const sw = at(0, rf + 2.66);
  swirl(k, sw.x, WALK + spring + S.half + 1.25, sw.z, 0.75, yaw, true);
  for (const s of [-1, 1]) {
    const c = at(s * (open / 2 + 0.55), rf + 2.7);
    k.main.box('stone_light', { x: c.x, y: WALK + spring / 2, z: c.z, sx: 0.5, sy: spring, sz: 0.2, yaw });
    // Façade piers (solid), clear of the passage.
    const pc = at(s * (open / 2 + (W - open) / 4), rf + 0.8);
    k.main.collider({ shape: 'box', x: pc.x, y: WALK + H / 2, z: pc.z, hx: (W - open) / 4, hy: H / 2, hz: D / 2, yaw, walkable: false, solid: true, surface: 'stone' });
  }
  // Steps up to the door sill and a pair of lanterns.
  const st = at(0, rf + 3.3);
  k.main.box('stone_light', { x: st.x, y: WALK + 0.06, z: st.z, sx: open + 2.4, sy: 0.12, sz: 1.3, yaw });
  for (const s of [-1, 1]) {
    const l = at(s * 4.2, rf + 4.6);
    k.props.lantern(new THREE.Vector3(l.x, WALK + 2.6, l.z), { color: 'warm', post: true });
  }
  // The door: two arched leaves (hinged at the jambs), bronze bands, three swirl locks on the seam.
  const dv = rf + 1.6;
  const wood = kitMaterial('wood_dark'), bronze = kitMaterial('bronze'), gold = kitMaterial('gold');
  const leafGeo = (side: number) => {
    const s = new THREE.Shape();
    if (side < 0) {
      s.moveTo(0, 0);
      s.lineTo(S.half, 0);
      s.lineTo(S.half, spring + S.half);
      s.absarc(S.half, spring, S.half, Math.PI / 2, Math.PI, false);
      s.lineTo(0, 0);
    } else {
      s.moveTo(0, 0);
      s.lineTo(0, spring);
      s.absarc(-S.half, spring, S.half, 0, Math.PI / 2, false);
      s.lineTo(-S.half, 0);
      s.lineTo(0, 0);
    }
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: false, curveSegments: 10 });
    e.translate(0, 0, -0.16);
    return e;
  };
  const leaves: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const hinge = at(side * S.half, dv);
    const leaf = new THREE.Group();
    leaf.position.set(hinge.x, WALK, hinge.z);
    leaf.rotation.y = yaw;
    const m = new THREE.Mesh(leafGeo(side), wood);
    leaf.add(m);
    for (const hy of [0.9, 2.8, 4.7]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(S.half - 0.12, 0.14, 0.38), bronze);
      band.position.set(-side * (S.half / 2), hy, 0);
      leaf.add(band);
    }
    leaf.userData.side = side;
    leaves.push(leaf);
  }
  const locks: THREE.Object3D[] = [];
  for (const ly of [2.2, 3.5, 4.8]) {
    const lock = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 20).rotateX(Math.PI / 2), bronze);
    lock.add(disc);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30, a = t * Math.PI * 3, r = 0.06 + 0.3 * t;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.07));
    }
    lock.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.03, 4, false), gold));
    // Mounted on the left leaf's free edge (local x = S.half), proud of its face.
    lock.position.set(S.half, ly, 0.24);
    leaves[0].add(lock);
    locks.push(lock);
  }
  for (const leaf of leaves) k.addMesh(leaf as unknown as THREE.Mesh, 'props');
  // Tunnel lining: walls, vestibule floor, stair, sloping ceiling, two lamps.
  const parts: THREE.BufferGeometry[] = [];
  const stone = '#a99f90', dark = '#6f675c';
  const vOut = rf + 0.6;
  for (const s of [-1, 1]) {
    // Wall panels in strips so the bottom follows the floor and the top the ceiling.
    const n = 12;
    for (let i = 0; i < n; i++) {
      const v0 = S.r - 0.5 + ((vOut - S.r + 0.5) * i) / n, v1 = S.r - 0.5 + ((vOut - S.r + 0.5) * (i + 1)) / n;
      const vm = (v0 + v1) / 2;
      const top = Math.max(tunnelCeil(v0), tunnelCeil(v1)) + 0.05;
      parts.push(tunnelBox(s * (S.half + 0.2), vm, (top + FLOOR - 0.2) / 2, 0.4, v1 - v0 + 0.02, top - FLOOR + 0.2, stone, KIND.masonry));
    }
  }
  const vestLen = 25.6 - S.stairR;
  parts.push(tunnelBox(0, S.stairR + vestLen / 2, WALK - 0.25, open + 0.4, vestLen, 0.5, '#9d9384', KIND.floor));
  const steps = 25, rise = (WALK - FLOOR) / steps, tread = (S.stairR - S.r) / steps;
  for (let i = 0; i < steps; i++) {
    const v = S.r + (i + 0.5) * tread;
    const top = FLOOR + (i + 1) * rise;
    parts.push(tunnelBox(0, v, (top + FLOOR - 0.6) / 2, open, tread + 0.01, top - FLOOR + 0.6, i % 2 ? stone : '#b3a998'));
  }
  const nc = 10;
  for (let i = 0; i < nc; i++) {
    const v0 = S.r + ((vOut - S.r) * i) / nc, v1 = S.r + ((vOut - S.r) * (i + 1)) / nc;
    const y = (tunnelCeil(v0) + tunnelCeil(v1)) / 2;
    const p0 = at(0, v0), p1 = at(0, v1);
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z, tunnelCeil(v1) - tunnelCeil(v0));
    const g2 = new THREE.BoxGeometry(open + 0.8, 0.4, len + 0.04);
    g2.rotateX(-Math.atan2(tunnelCeil(v1) - tunnelCeil(v0), v1 - v0));
    const pm = at(0, (v0 + v1) / 2);
    parts.push(painted(xf(g2, pm.x, y + 0.2, pm.z, yaw), dark, KIND.masonry));
  }
  for (const [v, s] of [[23.4, 1], [15.2, -1]] as const) {
    const l = at(s * (S.half - 0.12), v);
    const y = v > S.stairR ? WALK + 3.2 : FLOOR + 2.6 + (v - S.r) * (rise / tread);
    parts.push(painted(xf(new THREE.BoxGeometry(0.24, 0.4, 0.24), l.x, y, l.z, yaw), '#ffb35c', KIND.glow));
    parts.push(painted(xf(new THREE.BoxGeometry(0.34, 0.08, 0.34), l.x, y + 0.24, l.z, yaw), '#3b2a1a'));
  }
  const lining = new THREE.Mesh(merge(parts), mat);
  lining.name = 'sat_sanctuary_tunnel';
  lining.frustumCulled = false;
  k.addMesh(lining, 'main');
  // Black veil at the chamber doorway, shown while the chamber is not built.
  const vp = at(0, S.r + 0.05);
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(open, DOORWAY_H), am('shadow'));
  veil.position.set(vp.x, FLOOR + DOORWAY_H / 2, vp.z);
  veil.rotation.y = yaw;
  k.addMesh(veil, 'main');
  const dp = at(0, dv);
  return { leaves: [leaves[0], leaves[1]], locks, veil, door: { x: dp.x, z: dp.z, y: WALK, yaw } };
}

/** The tunnel lamps (world positions) — the first two of the material's six lights. */
export function tunnelLamps(): THREE.Vector3[] {
  const a = at(0.6, 23.4), b = at(-0.6, 15.2);
  return [new THREE.Vector3(a.x, WALK + 3.2, a.z), new THREE.Vector3(b.x, FLOOR + 2.6 + (15.2 - S.r) * ((WALK - FLOOR) / (S.stairR - S.r)), b.z)];
}

// ---------------------------------------------------------------------------
// Chamber (built on approach)
// ---------------------------------------------------------------------------

const STATUE_N = 168;

/** Placement of statue i on the spiral (0 = lowest; the last one is the Avatar before this one). */
export function statueSlot(i: number): { x: number; z: number; y: number; yaw: number; nation: Nation; t: number } {
  const t = (i + 0.5) / STATUE_N;
  const phi = (S.th + 22 + t * S.turns * 360) * DEG;
  const y = FLOOR + S.ledge0 + t * (S.ledge1 - S.ledge0);
  const r = S.r - 0.72;
  const x = C.x + Math.cos(phi) * r, z = C.z + Math.sin(phi) * r;
  return { x, z, y, yaw: Math.atan2(-Math.cos(phi), -Math.sin(phi)), nation: NATIONS[i % 4], t };
}

function buildChamber(mat: THREE.ShaderMaterial): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sat_sanctuary_chamber';
  const parts: THREE.BufferGeometry[] = [];
  const H = CEIL - FLOOR;
  // Wall (open where the doorway is), floor, ceiling.
  const halfOpen = Math.asin(S.half / S.r);
  const t3 = Math.PI / 2 - S.th * DEG;
  const wallA = new THREE.CylinderGeometry(S.r, S.r, H, 96, 24, true, t3 + halfOpen, Math.PI * 2 - 2 * halfOpen);
  parts.push(painted(xf(wallA, C.x, FLOOR + H / 2, C.z), '#a79c8c', KIND.masonry));
  const hb = H - DOORWAY_H;
  const wallB = new THREE.CylinderGeometry(S.r, S.r, hb, 8, 12, true, t3 - halfOpen, 2 * halfOpen);
  parts.push(painted(xf(wallB, C.x, FLOOR + DOORWAY_H + hb / 2, C.z), '#a79c8c', KIND.masonry));
  parts.push(painted(xf(new THREE.CircleGeometry(S.r + 0.05, 96).rotateX(-Math.PI / 2), C.x, FLOOR + 0.01, C.z), '#9a9083', KIND.floor));
  parts.push(painted(xf(new THREE.CircleGeometry(S.r + 0.05, 96).rotateX(Math.PI / 2), C.x, CEIL, C.z), '#4a4540', KIND.floor));
  // Floor inlay: a ring and a swirl round the centre.
  parts.push(painted(xf(new THREE.RingGeometry(3.2, 3.5, 64).rotateX(-Math.PI / 2), C.x, FLOOR + 0.03, C.z), '#3e7f86'));
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60, a = t * Math.PI * 3.4, r = 0.3 + 2.5 * t;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    parts.push(painted(xf(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.07, 4, false), C.x, FLOOR + 0.02, C.z), '#3e7f86'));
  }
  // The spiral ledge (top, front and underside of a 1.4 m deep band) with a lip.
  {
    const N = S.turns * 72;
    const r0 = S.r - 1.45, r1 = S.r + 0.02;
    const pos: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const P = (phi: number, r: number, y: number) => [C.x + Math.cos(phi) * r, y, C.z + Math.sin(phi) * r];
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const p0 = (S.th + 22 + t0 * S.turns * 360) * DEG, p1 = (S.th + 22 + t1 * S.turns * 360) * DEG;
      const y0 = FLOOR + S.ledge0 + t0 * (S.ledge1 - S.ledge0), y1 = FLOOR + S.ledge0 + t1 * (S.ledge1 - S.ledge0);
      quad(P(p0, r0, y0), P(p0, r1, y0), P(p1, r1, y1), P(p1, r0, y1));
      quad(P(p0, r0, y0 - 0.42), P(p0, r0, y0), P(p1, r0, y1), P(p1, r0, y1 - 0.42));
      quad(P(p0, r1, y0 - 0.42), P(p0, r0, y0 - 0.42), P(p1, r0, y1 - 0.42), P(p1, r1, y1 - 0.42));
      quad(P(p0, r0 - 0.1, y0 + 0.16), P(p0, r0 + 0.02, y0 + 0.16), P(p1, r0 + 0.02, y1 + 0.16), P(p1, r0 - 0.1, y1 + 0.16));
      quad(P(p0, r0 - 0.1, y0 - 0.02), P(p0, r0 - 0.1, y0 + 0.16), P(p1, r0 - 0.1, y1 + 0.16), P(p1, r0 - 0.1, y1 - 0.02));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    parts.push(painted(g, '#b4aa9a'));
  }
  // Inner portal round the doorway.
  {
    const pw = archWall(6.6, DOORWAY_H + 1.8, 0.9, S.half * 2, DOORWAY_H - S.half);
    const p = at(0, S.r - 0.4);
    parts.push(painted(xf(pw, p.x, FLOOR, p.z, yawOut(S.th)), '#c9c0b0'));
  }
  // Four braziers on tripods.
  for (const d of [-130, -50, 50, 130]) {
    const phi = (S.th + d) * DEG;
    const x = C.x + Math.cos(phi) * 8.4, z = C.z + Math.sin(phi) * 8.4;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.CylinderGeometry(0.04, 0.05, 1.25, 5);
      leg.rotateZ(0.22);
      leg.rotateY(-a);
      parts.push(painted(xf(leg, x + Math.cos(a) * 0.2, FLOOR + 0.6, z + Math.sin(a) * 0.2), '#5a4632'));
    }
    parts.push(painted(xf(G.lathe([[0.05, 0], [0.42, 0.1], [0.55, 0.3], [0.5, 0.34]], 16, 1), x, FLOOR + 1.2, z), '#6d5434'));
    parts.push(painted(xf(new THREE.ConeGeometry(0.34, 0.75, 8), x, FLOOR + 1.85, z), '#ff9a3c', KIND.glow));
    parts.push(painted(xf(new THREE.ConeGeometry(0.2, 0.5, 6), x + 0.12, FLOOR + 1.75, z - 0.05), '#ffd27a', KIND.glow));
  }
  // The great statue of the last Avatar, on a plinth facing the doorway.
  {
    const p = at(0, 6.2);
    parts.push(painted(xf(new THREE.BoxGeometry(2.6, 1.0, 2.6), p.x, FLOOR + 0.5, p.z, yawOut(S.th)), '#b3a998'));
    parts.push(painted(xf(new THREE.BoxGeometry(2.8, 0.14, 2.8), p.x, FLOOR + 1.04, p.z, yawOut(S.th)), '#c9c0b0'));
    parts.push(xf(statueGeometry('fire', true), p.x, FLOOR + 1.1, p.z, yawOut(S.th), 1.62, 1.62, 1.62));
  }
  const chamber = new THREE.Mesh(merge(parts), mat);
  chamber.frustumCulled = false;
  group.add(chamber);
  // Niches (dark arched recesses) and the statues on the ledge, one instanced mesh per nation.
  const niche = painted(archNiche(), '#2a2621');
  const nicheMesh = new THREE.InstancedMesh(niche, mat, STATUE_N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  const per: Record<Nation, number[]> = { air: [], water: [], earth: [], fire: [] };
  for (let i = 0; i < STATUE_N; i++) {
    const s = statueSlot(i);
    per[s.nation].push(i);
    const phi = Math.atan2(s.z - C.z, s.x - C.x);
    pv.set(C.x + Math.cos(phi) * (S.r - 0.09), s.y - 0.05, C.z + Math.sin(phi) * (S.r - 0.09));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
    nicheMesh.setMatrixAt(i, m4.compose(pv, q, sc));
  }
  nicheMesh.frustumCulled = false;
  group.add(nicheMesh);
  for (const n of NATIONS) {
    const g = statueGeometry(n);
    const im = new THREE.InstancedMesh(g, mat, per[n].length);
    per[n].forEach((i, j) => {
      const s = statueSlot(i);
      pv.set(s.x, s.y, s.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      im.setMatrixAt(j, m4.compose(pv, q, sc));
    });
    im.frustumCulled = false;
    im.name = `sat_statues_${n}`;
    group.add(im);
  }
  group.add(dust());
  group.add(eyeGlow());
  return group;
}

/** Soft blue halos on every statue's eyes, lit from the floor up as the glow climbs. */
function eyeGlow(): THREE.Points {
  const n = STATUE_N + 1;
  const pos = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < STATUE_N; i++) {
    const s = statueSlot(i);
    pos.set([s.x + Math.sin(s.yaw) * 0.2, s.y + 2.1, s.z + Math.cos(s.yaw) * 0.2], i * 3);
    size[i] = 0.62;
  }
  const p = at(0, 6.2), yr = yawOut(S.th);
  pos.set([p.x + Math.sin(yr) * 0.34, FLOOR + 1.1 + 2.1 * 1.62, p.z + Math.cos(yr) * 0.34], STATUE_N * 3);
  size[STATUE_N] = 1.0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uGlow: { value: 0 }, uGlowAmt: { value: 0 }, uFloor: { value: FLOOR }, uCeil: { value: CEIL }, uScale: { value: 500 } },
    vertexShader: /* glsl */ `
      uniform float uGlow;
      uniform float uGlowAmt;
      uniform float uFloor;
      uniform float uCeil;
      uniform float uScale;
      attribute float aSize;
      varying float vOn;
      void main() {
        float h = clamp((position.y - uFloor) / (uCeil - uFloor), 0.0, 1.0);
        vOn = uGlowAmt * clamp((uGlow - h) / 0.05, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = vOn > 0.001 ? max(2.0, aSize * uScale / max(0.5, -mv.z)) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vOn;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.45, 0.82, 1.0) * (0.6 + 1.6 * a * a), a * vOn);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.name = 'sat_sanctuary_eyes';
  pts.frustumCulled = false;
  return pts;
}

/** Arched recess panel (2 m wide, 3.1 m tall), facing +Z, standing on y = 0. */
function archNiche(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-1.0, 0);
  s.lineTo(1.0, 0);
  s.lineTo(1.0, 2.1);
  s.absarc(0, 2.1, 1.0, 0, Math.PI, false);
  s.lineTo(-1.0, 0);
  const g = new THREE.ShapeGeometry(s, 10);
  return g;
}

/** Slow drifting dust motes in the chamber's air. */
function dust(): THREE.Points {
  const n = 320;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (S.r - 1.6);
    pos[i * 3] = C.x + Math.cos(a) * r;
    pos[i * 3 + 1] = FLOOR + 0.5 + Math.random() * (CEIL - FLOOR - 4);
    pos[i * 3 + 2] = C.z + Math.sin(a) * r;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.47, 0.36) } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aSeed;
      varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.07 + aSeed * 6.3) * 0.7;
        p.z += cos(uTime * 0.05 + aSeed * 4.1) * 0.7;
        p.y += sin(uTime * 0.03 + aSeed * 9.7) * 1.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 60.0 / max(1.0, -mv.z);
        vA = 0.3 + 0.7 * fract(aSeed * 7.31);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        gl_FragColor = vec4(uColor, (0.25 - d) * 4.0 * vA * 0.32);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.name = 'sat_sanctuary_dust';
  p.frustumCulled = false;
  return p;
}

// ---------------------------------------------------------------------------
// Runtime: door, glow, building the chamber on approach
// ---------------------------------------------------------------------------

export class Sanctuary {
  private chamber: THREE.Group | null = null;
  /** 0 closed → 1 open (locks turn over the first third, the leaves swing after). */
  private openT = 0;
  private opening = false;
  private glow = 0;
  private glowTarget = 0;
  private time = 0;
  private col: number | null = null;
  private offs: Array<() => void> = [];
  private ctx: GameContext | null = null;
  private forced: number | null = null;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly mat: THREE.ShaderMaterial,
    private readonly shell: SanctuaryShell,
  ) {
    const u = mat.uniforms;
    const lamps = tunnelLamps();
    (u.uLamp.value as THREE.Vector3[])[0].copy(lamps[0]);
    (u.uLamp.value as THREE.Vector3[])[1].copy(lamps[1]);
    [-130, -50, 50, 130].forEach((d, i) => {
      const phi = (S.th + d) * DEG;
      (u.uLamp.value as THREE.Vector3[])[2 + i].set(C.x + Math.cos(phi) * 8.4, FLOOR + 2.1, C.z + Math.sin(phi) * 8.4);
    });
    const d = at(0, sanctuaryFace() + 3.5);
    (u.uDoor.value as THREE.Vector3).set(d.x, WALK + 3.5, d.z);
  }

  get state(): { open: number; built: boolean; glow: number; statues: number } {
    return { open: +this.openT.toFixed(2), built: !!this.chamber, glow: +this.glow.toFixed(2), statues: this.chamber ? STATUE_N : 0 };
  }

  /** Door point (for interactions and tests). */
  get door(): { x: number; z: number; y: number } {
    return { x: this.shell.door.x, z: this.shell.door.z, y: this.shell.door.y };
  }

  sessionStart(ctx: GameContext): void {
    this.sessionEnd();
    this.ctx = ctx;
    if (ctx.quests.hasFlag('air_sanctuary_open')) {
      this.openT = 1;
      this.opening = false;
    }
    this.syncDoor();
    if (this.openT < 1) {
      const d = this.shell.door;
      this.col = ctx.world.collision.add({ shape: 'box', x: d.x, y: d.y + 3.6, z: d.z, hx: S.half + 0.1, hy: 3.6, hz: 0.35, yaw: d.yaw, solid: true, walkable: false, tag: 'air_temple_summit' }, true);
    }
    this.offs.push(
      ctx.events.on('technique:cast', (e) => {
        if (!e.isPlayer || this.openT >= 1 || this.opening) return;
        if (e.element !== 'air' && e.element !== 'avatar') return;
        const d = this.shell.door;
        if (Math.hypot(e.position.x - d.x, e.position.z - d.z) < 11 && Math.abs(e.position.y - d.y) < 4) this.open();
      }),
      ctx.events.on('avatarState:changed', (e) => this.onAvatar(e.active || e.sphere)),
    );
    this.offs.push(
      ctx.interactions.register({
        id: 'air_sanctuary_door',
        position: new THREE.Vector3(this.shell.door.x, this.shell.door.y + 1.4, this.shell.door.z),
        radius: 3.6,
        label: 'Examine the sealed door',
        enabled: () => this.openT < 1 && !this.opening,
        interact: () =>
          ctx.events.emit('ui:notify', { text: 'No handle, no keyhole — three bronze swirls hold the door. Only a current of air could turn them.', kind: 'info', duration: 4.5 }),
      }),
    );
    if (ctx.avatar.active) this.onAvatar(true);
  }

  sessionEnd(): void {
    for (const o of this.offs) o();
    this.offs = [];
    if (this.col !== null && this.ctx) this.ctx.world.collision.remove(this.col);
    this.col = null;
    this.opening = false;
    this.glow = this.glowTarget = 0;
    this.forced = null;
  }

  /** Turn the locks and swing the door open (airbending, or a story flag). */
  open(): void {
    if (this.openT >= 1 || this.opening) return;
    this.opening = true;
    const ctx = this.ctx;
    if (!ctx) return;
    const d = this.shell.door;
    ctx.audio.play('amb.chime', { position: { x: d.x, y: d.y + 3, z: d.z }, volume: 0.9 });
    ctx.events.emit('ui:notify', { text: 'The swirls turn in the wind you sent. The sanctuary door swings open.', kind: 'discovery', duration: 4 });
  }

  /** Debug/tests: force the eye glow (0..1) or null to follow the Avatar State. */
  forceGlow(v: number | null): void {
    this.forced = v;
  }

  private onAvatar(active: boolean): void {
    const pl = this.ctx?.player;
    const near = !!pl && Math.hypot(pl.root.position.x - C.x, pl.root.position.z - C.z) < 170;
    this.glowTarget = active && near ? 1 : 0;
  }

  update(dt: number, ctx: GameContext): void {
    this.time += dt;
    const pl = ctx.player;
    // Build the chamber while the player is near the door or inside; drop it when far.
    if (pl) {
      const p = pl.root.position;
      const d = this.shell.door;
      const dist = Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z);
      const inside = Math.hypot(p.x - C.x, p.z - C.z) < S.stairR + 2 && p.y < WALK + 4 && p.y > FLOOR - 2;
      if (!this.chamber && (dist < 70 || inside)) {
        this.chamber = buildChamber(this.mat);
        this.parent.add(this.chamber);
      } else if (this.chamber && dist > 130 && !inside) this.dropChamber();
    }
    this.shell.veil.visible = !this.chamber;
    // Door: locks spin, then the leaves swing inward.
    if (this.opening) {
      this.openT = Math.min(1, this.openT + dt / 3.2);
      if (this.openT > 0.3 && this.col !== null) {
        ctx.world.collision.remove(this.col);
        this.col = null;
      }
      if (this.openT >= 1) {
        this.opening = false;
        ctx.quests.setFlag('air_sanctuary_open');
      }
      this.syncDoor();
    }
    // Eyes: the glow front climbs the spiral (~4 s) and falls back when the Avatar State ends.
    const target = this.forced ?? this.glowTarget;
    const rate = target > this.glow ? 0.3 : 0.6;
    this.glow += Math.sign(target - this.glow) * Math.min(Math.abs(target - this.glow), dt * rate);
    const u = this.mat.uniforms;
    u.uGlow.value = this.glow * 1.08;
    u.uGlowAmt.value = Math.min(1, this.glow * 3);
    u.uDoorOpen.value = Math.max(0, (this.openT - 0.3) / 0.7);
    if (this.chamber) {
      const dm = this.chamber.getObjectByName('sat_sanctuary_dust') as THREE.Points | undefined;
      if (dm) (dm.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
      const em = this.chamber.getObjectByName('sat_sanctuary_eyes') as THREE.Points | undefined;
      if (em) {
        const eu = (em.material as THREE.ShaderMaterial).uniforms;
        eu.uGlow.value = u.uGlow.value;
        eu.uGlowAmt.value = u.uGlowAmt.value;
        const cam = ctx.camera;
        eu.uScale.value = ctx.render.renderer.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
      }
    }
  }

  private syncDoor(): void {
    const t = this.openT;
    const spin = Math.min(1, t / 0.3);
    for (const [i, l] of this.shell.locks.entries()) l.rotation.z = spin * Math.PI * 2 * (i % 2 ? -1.5 : 1.5);
    const swing = Math.max(0, (t - 0.3) / 0.7);
    const e = swing * swing * (3 - 2 * swing);
    for (const leaf of this.shell.leaves) leaf.rotation.y = this.shell.door.yaw - (leaf.userData.side as number) * e * 1.62;
  }

  private dropChamber(): void {
    if (!this.chamber) return;
    this.chamber.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
      if (o instanceof THREE.Points) (o.material as THREE.Material).dispose();
    });
    this.parent.remove(this.chamber);
    this.chamber = null;
  }

  dispose(): void {
    this.sessionEnd();
    this.dropChamber();
  }
}
