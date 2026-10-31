import * as THREE from 'three';

/**
 * Instanced Air Nomad monks (a fork of the Ba Sing Se figure renderer, kept separate so that city
 * is untouched). Shaved heads; a saffron-yellow robe with an orange mantle and sash over brown or
 * orange trousers; elders get robes to the ankles and wooden bead necklaces; masters carry the
 * blue arrow on the scalp and hands; boys are scaled down. Poses run in the vertex shader per
 * instance: idle, walk, sit, airbending forms, talk, carry, sweep, pray, work, meditate (cross-
 * legged), air scooter, staff glider, bow and sleep. Two LODs (limbs and face near, a silhouette
 * far), blob shadows near, instanced accessories (brooms, baskets, staffs, open gliders, air
 * scooter balls, lanterns, bucket poles).
 *
 * Per frame: begin(cameraPos) → view(camera) → push(...) for every visible monk → end().
 */

export const MPose = { idle: 0, walk: 1, sit: 2, airbend: 3, talk: 4, carry: 5, sweep: 6, pray: 7, work: 8, meditate: 9, scooter: 10, glide: 11, bow: 12, sleep: 13 } as const;
export type MPoseId = (typeof MPose)[keyof typeof MPose];

export const MAcc = { none: 0, broom: 1, basket: 2, staff: 3, glider: 4, scooter: 5, lantern: 6, buckets: 7 } as const;
export type MAccId = (typeof MAcc)[keyof typeof MAcc];

/** Flags: bit 1 elder (long robe, beads), bit 2 master (blue arrows). */
export const MFlag = { elder: 1, master: 2 } as const;

const NEAR = 55;
const FAR = 190;

// Parts: 0 body, 1 head, 2/3 legs L/R, 4/5 arms L/R. Tints: 0 robe, 1 trousers, 2 skin, 3 mantle, 4 brows,
// 5 shoes, 6 pupils, 7 lips, 8 eye whites, 9 arrow (masters), 10 hands (arrow-blue on masters),
// 11 long robe (elders), 12 beads (elders).
interface PartBuild {
  pos: number[];
  nrm: number[];
  part: number[];
  tint: number[];
  idx: number[];
}

function pushGeo(b: PartBuild, g: THREE.BufferGeometry, part: number, tint: number): void {
  const base = b.pos.length / 3;
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    b.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    b.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    b.part.push(part);
    b.tint.push(tint);
  }
  const ix = g.getIndex();
  if (ix) for (let i = 0; i < ix.count; i++) b.idx.push(base + ix.getX(i));
  else for (let i = 0; i < p.count; i++) b.idx.push(base + i);
  g.dispose();
}

function box(b: PartBuild, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, part: number, tint: number, rx = 0): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx) g.rotateX(rx);
  g.translate(cx, cy, cz);
  pushGeo(b, g, part, tint);
}

function bodyGeometry(lod: 0 | 1): THREE.BufferGeometry {
  const b: PartBuild = { pos: [], nrm: [], part: [], tint: [], idx: [] };
  const sides = lod === 0 ? 10 : 6;
  // Robe skirt to the knees (elders: on down to the ankles), chest, mantle over the shoulders.
  pushGeo(b, new THREE.CylinderGeometry(0.2, 0.3, 0.62, sides).scale(1, 1, 0.8).translate(0, 0.73, 0), 0, 0);
  pushGeo(b, new THREE.CylinderGeometry(0.3, 0.33, 0.4, sides).scale(1, 1, 0.82).translate(0, 0.24, 0), 0, 11);
  pushGeo(b, new THREE.CylinderGeometry(0.2, 0.2, 0.42, sides).scale(1, 1, 0.74).translate(0, 1.25, 0), 0, 0);
  pushGeo(b, new THREE.CylinderGeometry(0.17, 0.31, 0.24, sides).scale(1, 1, 0.8).translate(0, 1.38, 0), 0, 3);
  if (lod === 0) {
    pushGeo(b, new THREE.CylinderGeometry(0.215, 0.215, 0.09, sides).scale(1, 1, 0.78).translate(0, 1.04, 0), 0, 3);
    // Mantle's fold hanging over one shoulder across the chest.
    box(b, 0.05, 1.2, 0.15, 0.1, 0.42, 0.04, 0, 3);
  }
  pushGeo(b, new THREE.IcosahedronGeometry(0.118, lod === 0 ? 1 : 0).scale(0.92, 1.05, 1).translate(0, 1.6, 0.01), 1, 2);
  if (lod === 0) {
    box(b, 0, 1.49, 0, 0.09, 0.08, 0.09, 1, 2);
    // Arrow over the shaved scalp (masters): head on the forehead, shaft over the crown to the nape.
    box(b, 0, 1.672, 0.088, 0.064, 0.016, 0.03, 1, 9, -0.9);
    box(b, 0, 1.712, 0.03, 0.03, 0.014, 0.1, 1, 9, -0.35);
    box(b, 0, 1.706, -0.06, 0.03, 0.014, 0.1, 1, 9, 0.45);
    box(b, 0, 1.655, -0.11, 0.03, 0.014, 0.06, 1, 9, 1.0);
    // Bead necklace (elders).
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      box(b, Math.sin(a) * 0.16, 1.43 - Math.max(0, Math.cos(a)) * 0.07, Math.cos(a) * 0.13, 0.035, 0.035, 0.035, 0, 12);
    }
    // Face: eye whites and pupils, brows, ears, nose, mouth.
    for (const s of [1, -1]) {
      box(b, s * 0.041, 1.612, 0.114, 0.036, 0.026, 0.012, 1, 8);
      box(b, s * 0.04, 1.61, 0.12, 0.019, 0.023, 0.008, 1, 6);
      box(b, s * 0.043, 1.641, 0.114, 0.038, 0.009, 0.012, 1, 4);
      box(b, s * 0.112, 1.6, 0.0, 0.02, 0.05, 0.034, 1, 2);
    }
    box(b, 0, 1.594, 0.128, 0.016, 0.03, 0.024, 1, 2);
    box(b, 0, 1.565, 0.12, 0.036, 0.008, 0.01, 1, 7);
    for (const s of [1, -1]) {
      const part = s > 0 ? 2 : 3;
      box(b, s * 0.095, 0.47, 0, 0.12, 0.84, 0.14, part, 1);
      box(b, s * 0.095, 0.045, 0.045, 0.13, 0.09, 0.24, part, 5);
      const arm = s > 0 ? 4 : 5;
      // Wide sleeves, bare hands (masters: the arrow runs onto the hands).
      pushGeo(b, new THREE.CylinderGeometry(0.06, 0.1, 0.58, 6).translate(s * 0.26, 1.13, 0), arm, 0);
      box(b, s * 0.26, 0.8, 0.01, 0.085, 0.11, 0.09, arm, 10);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 1));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(b.tint, 1));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

const VERT_HEAD = /* glsl */ `
attribute float aPart;
attribute float aTint;
attribute vec4 iAnim;
attribute vec3 iRobe;
attribute vec3 iPants;
attribute vec3 iSkin;
attribute vec2 iFlags;
varying vec3 vFigColor;
mat3 figRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 figRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void figPose(out mat3 Rl, out vec3 piv, out mat3 Ll, out vec3 off) {
  float pose = iAnim.x, ph = iAnim.y, amt = iAnim.z;
  float side = (aPart == 2.0 || aPart == 4.0) ? 1.0 : -1.0;
  bool leg = aPart == 2.0 || aPart == 3.0;
  bool arm = aPart == 4.0 || aPart == 5.0;
  float ax = 0.0, az = 0.0, dy = 0.0, lean = iAnim.w;
  if (pose < 0.5) {             // idle
    if (arm) { ax = 0.05 * sin(ph * 0.5 + side); az = side * 0.06; }
    dy = 0.006 * sin(ph * 0.5);
  } else if (pose < 1.5) {      // walk
    float s = sin(ph);
    if (leg) ax = 0.55 * amt * s * side;
    if (arm) { ax = -0.38 * amt * s * side; az = side * 0.06; }
    dy = 0.035 * amt * abs(cos(ph));
  } else if (pose < 2.5) {      // sit (bench, table)
    if (leg) ax = -1.45;
    if (arm) ax = -0.55;
    dy = -0.4;
  } else if (pose < 3.5) {      // airbending forms: sweeping arm circles over a wide stance
    if (arm) { ax = -1.05 + 0.6 * sin(ph + side * 0.7); az = side * (0.35 + 0.4 * cos(ph)); }
    if (leg) { az = side * 0.24; ax = side * 0.22 * sin(ph * 0.5); }
    dy = -0.07;
    lean += 0.08 * sin(ph);
  } else if (pose < 4.5) {      // talk
    if (arm && side > 0.0) ax = -0.7 - 0.35 * sin(ph * 1.7);
    if (arm && side < 0.0) az = -0.05;
  } else if (pose < 5.5) {      // carry on the shoulder / head
    if (arm && side > 0.0) ax = -2.7;
    if (arm && side < 0.0) az = -0.08;
    if (leg) ax = 0.35 * amt * sin(ph) * side;
    dy = 0.02 * amt * abs(cos(ph));
  } else if (pose < 6.5) {      // sweep
    if (arm) { ax = -0.75; az = 0.45 * sin(ph); }
    if (leg) ax = 0.25 * amt * sin(ph * 0.5) * side;
    lean += 0.2;
  } else if (pose < 7.5) {      // pray: palms together before the chest
    if (arm) { ax = -1.25; az = -side * 0.42; }
    lean += 0.06;
  } else if (pose < 8.5) {      // work (bent over: beds, kitchens, bison)
    if (arm) ax = -0.9 - 0.3 * sin(ph + side);
    if (leg) az = side * 0.16;
    lean += 0.65;
  } else if (pose < 9.5) {      // meditate: legs folded, hands on the knees
    if (leg) { ax = -1.5; az = side * 1.05; }
    if (arm) { ax = -0.5; az = side * 0.32; }
    dy = -0.8 + 0.006 * sin(ph * 0.4);
  } else if (pose < 10.5) {     // air scooter: balanced on the spinning ball
    if (arm) { az = side * (0.85 + 0.15 * sin(ph * 2.0)); ax = -0.15; }
    if (leg) ax = 0.12;
    dy = 0.62 + 0.04 * sin(ph * 6.0);
    lean += 0.12;
  } else if (pose < 11.5) {     // staff glider: arms up on the staff, legs trailing
    if (arm) ax = -2.95;
    if (leg) ax = 0.18 + 0.08 * side * sin(ph);
  } else if (pose < 12.5) {     // bow
    if (arm) { ax = -1.0; az = -side * 0.4; }
    lean += 0.55 * amt;
  } else {                      // sleep (the instance lies the body down)
    if (arm) { ax = -0.2; az = side * 0.1; }
    if (leg) ax = -0.25;
  }
  Rl = figRotX(ax) * figRotZ(az);
  piv = leg ? vec3(side * 0.095, 0.88, 0.0) : vec3(side * 0.26, 1.42, 0.0);
  Ll = figRotX(lean);
  off = vec3(0.0, dy, 0.0);
}
`;

function makeMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = vec3( normal );
mat3 figRl; vec3 figPiv; mat3 figLl; vec3 figOff;
figPose(figRl, figPiv, figLl, figOff);
bool figLeg = aPart == 2.0 || aPart == 3.0;
bool figArm = aPart == 4.0 || aPart == 5.0;
objectNormal = figLeg ? figRl * objectNormal : figArm ? figLl * (figRl * objectNormal) : figLl * objectNormal;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
{
  vec3 hip = vec3(0.0, 0.88, 0.0);
  if (figLeg) transformed = figPiv + figRl * (transformed - figPiv);
  else if (figArm) transformed = hip + figLl * (figPiv + figRl * (transformed - figPiv) - hip);
  else transformed = hip + figLl * (transformed - hip);
  transformed += figOff;
  // Parts only some monks have collapse to a point on the others.
  bool hide = (aTint > 8.5 && aTint < 9.5 && iFlags.y < 0.5) || (aTint > 10.5 && iFlags.x < 0.5);
  if (hide) transformed = vec3(0.0, 1.0, 0.0);
}
vec3 figBlue = vec3(0.1, 0.36, 0.86);
vFigColor = aTint < 0.5 ? iRobe : aTint < 1.5 ? iPants : aTint < 2.5 ? iSkin : aTint < 3.5 ? vec3(0.86, 0.36, 0.08) * (0.8 + 0.25 * iPants.r) : aTint < 4.5 ? vec3(0.1, 0.08, 0.06) : aTint < 5.5 ? vec3(0.35, 0.22, 0.12) : aTint < 6.5 ? vec3(0.06, 0.045, 0.04) : aTint < 7.5 ? iSkin * vec3(0.66, 0.42, 0.4) : aTint < 8.5 ? vec3(0.9, 0.88, 0.84) : aTint < 9.5 ? figBlue : aTint < 10.5 ? (iFlags.y > 0.5 ? mix(iSkin, figBlue, 0.75) : iSkin) : aTint < 11.5 ? iRobe : vec3(0.32, 0.19, 0.1);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFigColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFigColor;');
  };
  m.customProgramCacheKey = () => 'sat-monks';
  m.name = 'sat_monks';
  return m;
}

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------

function mergeGeos(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const pa = p.getAttribute('position'), na = p.getAttribute('normal');
    for (let i = 0; i < pa.count; i++, o++) {
      pos.set([pa.getX(i), pa.getY(i), pa.getZ(i)], o * 3);
      nrm.set([na.getX(i), na.getY(i), na.getZ(i)], o * 3);
    }
  }
  for (const g of gs) g.dispose();
  for (const p of parts) p.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

function accDef(a: MAccId): { geo: THREE.BufferGeometry; mat: THREE.Material } | null {
  const lam = (c: string) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
  switch (a) {
    case MAcc.broom: {
      const stick = new THREE.CylinderGeometry(0.02, 0.02, 1.4, 5);
      stick.rotateX(0.75);
      stick.translate(0.2, 0.75, 0.42);
      const brush = new THREE.ConeGeometry(0.16, 0.35, 7);
      brush.rotateX(0.75 + Math.PI);
      brush.translate(0.2, 0.12, 0.92);
      return { geo: mergeGeos([stick, brush]), mat: lam('#a3824a') };
    }
    case MAcc.basket: {
      const g = new THREE.CylinderGeometry(0.26, 0.2, 0.28, 10, 1, true);
      g.translate(0.18, 1.62, 0);
      const fruit = new THREE.SphereGeometry(0.22, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      fruit.translate(0.18, 1.72, 0);
      return { geo: mergeGeos([g, fruit]), mat: lam('#b08a4c') };
    }
    case MAcc.staff: {
      const g = new THREE.CylinderGeometry(0.028, 0.028, 1.95, 6);
      g.translate(-0.3, 1.0, 0.12);
      const top = new THREE.CylinderGeometry(0.05, 0.03, 0.18, 6);
      top.translate(-0.3, 2.02, 0.12);
      return { geo: mergeGeos([g, top]), mat: lam('#8a5a2c') };
    }
    case MAcc.glider: {
      const staff = new THREE.CylinderGeometry(0.028, 0.028, 1.9, 6);
      staff.rotateX(Math.PI / 2);
      staff.translate(0, 2.25, 0.1);
      const wings = new THREE.BufferGeometry();
      wings.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.3, 0.75, -1.45, 2.32, -0.2, 0, 2.3, -0.55, 0, 2.3, 0.75, 0, 2.3, -0.55, 1.45, 2.32, -0.2], 3));
      wings.computeVertexNormals();
      return { geo: mergeGeos([staff, wings]), mat: lam('#d8642a') };
    }
    case MAcc.scooter: {
      const g = new THREE.SphereGeometry(0.42, 14, 10);
      g.translate(0, 0.28, 0);
      const m = new THREE.MeshBasicMaterial({ color: '#eef6ff', transparent: true, opacity: 0.32, depthWrite: false });
      return { geo: g, mat: m };
    }
    case MAcc.lantern: {
      const stick = new THREE.CylinderGeometry(0.015, 0.015, 0.7, 4);
      stick.rotateX(1.1);
      stick.translate(0.26, 1.2, 0.3);
      const lamp = new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8);
      lamp.translate(0.26, 1.02, 0.6);
      return { geo: mergeGeos([stick, lamp]), mat: new THREE.MeshBasicMaterial({ color: '#ffcf7a' }) };
    }
    case MAcc.buckets: {
      const pole = new THREE.CylinderGeometry(0.025, 0.025, 1.6, 5);
      pole.rotateZ(Math.PI / 2);
      pole.translate(0, 1.47, 0);
      const b1 = new THREE.CylinderGeometry(0.17, 0.14, 0.28, 8);
      b1.translate(0.72, 1.0, 0);
      const b2 = b1.clone();
      b2.translate(-1.44, 0, 0);
      return { geo: mergeGeos([pole, b1, b2]), mat: lam('#7d5a34') };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface Layer {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  robe: THREE.InstancedBufferAttribute;
  pants: THREE.InstancedBufferAttribute;
  skin: THREE.InstancedBufferAttribute;
  flags: THREE.InstancedBufferAttribute;
  n: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);

export class MonkRenderer {
  readonly group = new THREE.Group();
  private readonly layers: Layer[];
  private readonly shadow: THREE.InstancedMesh;
  private shadowN = 0;
  private readonly accs = new Map<number, { mesh: THREE.InstancedMesh; n: number }>();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private cam = new THREE.Vector3();
  private far2 = FAR * FAR;
  private near2 = NEAR * NEAR;
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 2);
  private hasView = false;
  stats = { near: 0, far: 0, culled: 0 };

  constructor(parent: THREE.Object3D, readonly capacity: number) {
    this.group.name = 'sat_monks';
    parent.add(this.group);
    const mat = makeMaterial();
    this.mats.push(mat);
    this.layers = ([0, 1] as const).map((lod) => {
      const geo = bodyGeometry(lod);
      this.geos.push(geo);
      const mesh = new THREE.InstancedMesh(geo, mat, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const mk = (k: number) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * k), k);
        a.setUsage(THREE.DynamicDrawUsage);
        return a;
      };
      const anim = mk(4), robe = mk(3), pants = mk(3), skin = mk(3), flags = mk(2);
      geo.setAttribute('iAnim', anim);
      geo.setAttribute('iRobe', robe);
      geo.setAttribute('iPants', pants);
      geo.setAttribute('iSkin', skin);
      geo.setAttribute('iFlags', flags);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.name = `sat_monks_lod${lod}`;
      this.group.add(mesh);
      return { mesh, anim, robe, pants, skin, flags, n: 0 };
    });
    const sg = new THREE.CircleGeometry(0.42, 12);
    sg.rotateX(-Math.PI / 2);
    this.geos.push(sg);
    const sm = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.26, depthWrite: false });
    sm.polygonOffset = true;
    sm.polygonOffsetFactor = -2;
    this.mats.push(sm);
    this.shadow = new THREE.InstancedMesh(sg, sm, capacity);
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadow.frustumCulled = false;
    this.shadow.count = 0;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
  }

  private acc(id: number): { mesh: THREE.InstancedMesh; n: number } | null {
    let a = this.accs.get(id);
    if (a) return a;
    const def = accDef(id as MAccId);
    if (!def) return null;
    this.geos.push(def.geo);
    this.mats.push(def.mat);
    const mesh = new THREE.InstancedMesh(def.geo, def.mat, this.capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    a = { mesh, n: 0 };
    this.accs.set(id, a);
    return a;
  }

  setRange(near: number, far: number): void {
    this.near2 = near * near;
    this.far2 = far * far;
  }

  begin(cam: THREE.Vector3): void {
    this.cam.copy(cam);
    for (const l of this.layers) l.n = 0;
    for (const a of this.accs.values()) a.n = 0;
    this.shadowN = 0;
    this.hasView = false;
    this.stats.near = this.stats.far = this.stats.culled = 0;
  }

  view(camera: THREE.Camera): void {
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    this.hasView = true;
  }

  visible(x: number, y: number, z: number): boolean {
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z;
    if (dx * dx + dy * dy + dz * dz >= this.far2) return false;
    if (!this.hasView) return true;
    this.sphere.center.set(x, y + 0.9, z);
    return this.frustum.intersectsSphere(this.sphere);
  }

  /** Colours are packed 0xRRGGBB; flags: MFlag bits; pitch tips the body (gliders, sleepers). */
  push(x: number, y: number, z: number, yaw: number, pose: number, phase: number, amount: number, lean: number, robe: number, pants: number, skin: number, acc = 0, scale = 1, flags = 0, pitch = 0): void {
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > this.far2) {
      this.stats.culled++;
      return;
    }
    const lod = d2 < this.near2 ? 0 : 1;
    const L = this.layers[lod];
    if (L.n >= this.capacity) return;
    const i = L.n++;
    if (lod === 0) this.stats.near++;
    else this.stats.far++;
    tmpE.set(pitch, yaw, 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpP.set(x, y, z);
    tmpS.set(scale, scale, scale);
    tmpM.compose(tmpP, tmpQ, tmpS);
    L.mesh.setMatrixAt(i, tmpM);
    L.anim.setXYZW(i, pose, phase, amount, lean);
    L.robe.setXYZ(i, ((robe >> 16) & 255) / 255, ((robe >> 8) & 255) / 255, (robe & 255) / 255);
    L.pants.setXYZ(i, ((pants >> 16) & 255) / 255, ((pants >> 8) & 255) / 255, (pants & 255) / 255);
    L.skin.setXYZ(i, ((skin >> 16) & 255) / 255, ((skin >> 8) & 255) / 255, (skin & 255) / 255);
    L.flags.setXY(i, flags & MFlag.elder ? 1 : 0, flags & MFlag.master ? 1 : 0);
    if (acc) {
      const a = this.acc(acc);
      if (a && a.n < this.capacity) a.mesh.setMatrixAt(a.n++, tmpM);
    }
    if (lod === 0 && pose !== MPose.sit && pose !== MPose.meditate && pose !== MPose.sleep && pose !== MPose.glide && this.shadowN < this.capacity) {
      tmpP.y += 0.04 - (pose === MPose.scooter ? 0 : 0);
      tmpE.set(0, yaw, 0, 'YXZ');
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.shadow.setMatrixAt(this.shadowN++, tmpM);
    }
  }

  end(): void {
    for (const l of this.layers) {
      l.mesh.count = l.n;
      if (l.n) {
        l.mesh.instanceMatrix.needsUpdate = true;
        l.anim.needsUpdate = l.robe.needsUpdate = l.pants.needsUpdate = l.skin.needsUpdate = l.flags.needsUpdate = true;
      }
    }
    for (const a of this.accs.values()) {
      a.mesh.count = a.n;
      if (a.n) a.mesh.instanceMatrix.needsUpdate = true;
    }
    this.shadow.count = this.shadowN;
    if (this.shadowN) this.shadow.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const l of this.layers) l.mesh.dispose();
    for (const a of this.accs.values()) a.mesh.dispose();
    this.shadow.dispose();
    this.group.removeFromParent();
    this.group.clear();
    this.accs.clear();
  }
}
