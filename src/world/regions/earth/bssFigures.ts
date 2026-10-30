import * as THREE from 'three';

/**
 * Instanced low-poly people for Ba Sing Se crowds, guards, vendors, train
 * earthbenders and passengers. One merged body (robe, sash, head, hair, legs,
 * arms) is animated in the vertex shader per instance (walk, idle, sit,
 * earthbending push/stomp, talk, carry, sweep, raise, work), so hundreds of
 * figures cost a handful of draw calls. Two LODs (limbs near, a simple
 * silhouette far), blob shadows near, and instanced accessories (hats,
 * helmets, carts, shoulder poles, crates) follow the figure transform.
 *
 * Per frame: begin(cameraPos) → push(...) for every visible figure → end().
 * No allocation in push(); colours are packed 0xRRGGBB numbers.
 */

export const Pose = { idle: 0, walk: 1, sit: 2, push: 3, talk: 4, carry: 5, sweep: 6, raise: 7, work: 8 } as const;
export type PoseId = (typeof Pose)[keyof typeof Pose];

export const Acc = { none: 0, daiLiHat: 1, guardHelm: 2, strawHat: 3, scholarCap: 4, bundle: 5, pole: 6, cart: 7, crate: 8, soldierHelm: 9, topknot: 10, parasol: 11 } as const;
export type AccId = (typeof Acc)[keyof typeof Acc];

const NEAR = 75;
const FAR = 230;

// Parts: 0 body, 1 head, 2/3 legs L/R, 4/5 arms L/R. Tints: 0 robe, 1 pants, 2 skin, 3 sash, 4 hair, 5 shoes,
// 6 pupils, 7 lips, 8 eye whites.
interface PartBuild {
  pos: number[];
  nrm: number[];
  part: number[];
  tint: number[];
  idx: number[];
}

function pushBox(b: PartBuild, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, part: number, tint: number): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  pushGeo(b, g, part, tint);
  g.dispose();
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
}

function finish(b: PartBuild): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 1));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(b.tint, 1));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

function bodyGeometry(lod: 0 | 1): THREE.BufferGeometry {
  const b: PartBuild = { pos: [], nrm: [], part: [], tint: [], idx: [] };
  const sides = lod === 0 ? 8 : 6;
  // Robe: skirt flaring to the knees, then the chest.
  const skirt = new THREE.CylinderGeometry(0.2, 0.29, 0.62, sides, 1, false);
  skirt.scale(1, 1, 0.78);
  skirt.translate(0, 0.42 + 0.31, 0);
  pushGeo(b, skirt, 0, 0);
  skirt.dispose();
  const chest = new THREE.CylinderGeometry(0.2, 0.2, 0.42, sides, 1, false);
  chest.scale(1, 1, 0.72);
  chest.translate(0, 1.04 + 0.21, 0);
  pushGeo(b, chest, 0, 0);
  chest.dispose();
  if (lod === 0) {
    const sash = new THREE.CylinderGeometry(0.215, 0.215, 0.09, sides, 1, false);
    sash.scale(1, 1, 0.76);
    sash.translate(0, 1.04, 0);
    pushGeo(b, sash, 0, 3);
    sash.dispose();
    pushBox(b, 0, 1.465, 0, 0.42, 0.06, 0.26, 0, 0);
  }
  const head = new THREE.IcosahedronGeometry(0.118, lod === 0 ? 1 : 0);
  head.scale(0.92, 1.05, 1);
  head.translate(0, 1.6, 0.01);
  pushGeo(b, head, 1, 2);
  head.dispose();
  if (lod === 0) {
    const hair = new THREE.SphereGeometry(0.124, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.52);
    hair.translate(0, 1.615, -0.018);
    pushGeo(b, hair, 1, 4);
    hair.dispose();
    pushBox(b, 0, 1.49, 0, 0.09, 0.08, 0.09, 1, 2);
    // Face (near LOD only): eye whites and pupils, brows in the hair colour, nose, mouth, ears.
    for (const s of [1, -1]) {
      pushBox(b, s * 0.041, 1.612, 0.114, 0.036, 0.026, 0.012, 1, 8);
      pushBox(b, s * 0.04, 1.61, 0.12, 0.019, 0.023, 0.008, 1, 6);
      pushBox(b, s * 0.043, 1.641, 0.114, 0.038, 0.009, 0.012, 1, 4);
      pushBox(b, s * 0.106, 1.6, 0.0, 0.02, 0.045, 0.032, 1, 2);
    }
    pushBox(b, 0, 1.594, 0.128, 0.016, 0.03, 0.024, 1, 2);
    pushBox(b, 0, 1.565, 0.12, 0.036, 0.008, 0.01, 1, 7);
    for (const s of [1, -1]) {
      const part = s > 0 ? 2 : 3;
      pushBox(b, s * 0.095, 0.47, 0, 0.12, 0.84, 0.14, part, 1);
      pushBox(b, s * 0.095, 0.045, 0.045, 0.13, 0.09, 0.24, part, 5);
      const arm = s > 0 ? 4 : 5;
      pushBox(b, s * 0.255, 1.13, 0, 0.11, 0.58, 0.12, arm, 0);
      pushBox(b, s * 0.255, 0.81, 0.01, 0.085, 0.1, 0.09, arm, 2);
    }
  }
  return finish(b);
}

const VERT_HEAD = /* glsl */ `
attribute float aPart;
attribute float aTint;
attribute vec4 iAnim;
attribute vec3 iRobe;
attribute vec3 iPants;
attribute vec3 iSkin;
varying vec3 vFigColor;
mat3 figRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 figRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
// Limb rotation about its pivot, torso lean about the hips, and a body offset for the instance pose.
void figPose(out mat3 Rl, out vec3 piv, out mat3 Ll, out vec3 off) {
  float pose = iAnim.x, ph = iAnim.y, amt = iAnim.z;
  float side = (aPart == 2.0 || aPart == 4.0) ? 1.0 : -1.0;
  bool leg = aPart == 2.0 || aPart == 3.0;
  bool arm = aPart == 4.0 || aPart == 5.0;
  float ax = 0.0, az = 0.0, dy = 0.0, lean = iAnim.w;
  if (pose < 0.5) {            // idle
    if (arm) { ax = 0.05 * sin(ph * 0.5 + side); az = side * 0.06; }
    dy = 0.006 * sin(ph * 0.5);
  } else if (pose < 1.5) {     // walk
    float s = sin(ph);
    if (leg) ax = 0.55 * amt * s * side;
    if (arm) { ax = -0.42 * amt * s * side; az = side * 0.06; }
    dy = 0.035 * amt * abs(cos(ph));
  } else if (pose < 2.5) {     // sit
    if (leg) ax = -1.45;
    if (arm) ax = -0.55;
    dy = -0.4;
  } else if (pose < 3.5) {     // earthbending push / stomp
    float s = sin(ph);
    if (leg) { az = side * 0.3; ax = side > 0.0 ? -1.05 * max(0.0, s) : 0.25 * max(0.0, -s); }
    if (arm) { ax = -1.35 - 0.35 * s * amt; az = side * 0.12; }
    dy = -0.12 + 0.05 * max(0.0, s);
    lean += 0.12;
  } else if (pose < 4.5) {     // talk
    if (arm && side > 0.0) ax = -0.7 - 0.35 * sin(ph * 1.7);
    if (arm && side < 0.0) az = -0.05;
  } else if (pose < 5.5) {     // carry overhead / on the shoulder
    if (arm) ax = -2.7;
    if (leg) ax = 0.35 * amt * sin(ph) * side;
    dy = 0.02 * amt * abs(cos(ph));
  } else if (pose < 6.5) {     // sweep
    if (arm) { ax = -0.75; az = 0.45 * sin(ph); }
    lean += 0.2;
  } else if (pose < 7.5) {     // raise (earthbending a gate / lift)
    if (leg) az = side * 0.32;
    if (arm) ax = -0.35 - 1.3 * amt;
    dy = -0.1 * amt;
  } else {                     // work (bent over: farming, washing)
    if (arm) ax = -0.9 - 0.3 * sin(ph + side);
    if (leg) az = side * 0.16;
    lean += 0.65;
  }
  Rl = figRotX(ax) * figRotZ(az);
  piv = leg ? vec3(side * 0.095, 0.88, 0.0) : vec3(side * 0.255, 1.42, 0.0);
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
}
vFigColor = aTint < 0.5 ? iRobe : aTint < 1.5 ? iPants : aTint < 2.5 ? iSkin : aTint < 3.5 ? iPants * 0.75 + vec3(0.06) : aTint < 4.5 ? vec3(0.07, 0.055, 0.045) : aTint < 5.5 ? vec3(0.13, 0.1, 0.08) : aTint < 6.5 ? vec3(0.06, 0.045, 0.04) : aTint < 7.5 ? iSkin * vec3(0.66, 0.42, 0.4) : vec3(0.9, 0.88, 0.84);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFigColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFigColor;');
  };
  m.customProgramCacheKey = () => 'bss-figures';
  m.name = 'bss_figures';
  return m;
}

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------

function accGeometry(a: AccId): { geo: THREE.BufferGeometry; color: string } | null {
  switch (a) {
    case Acc.daiLiHat: {
      const g = new THREE.ConeGeometry(0.36, 0.2, 14, 1, true);
      g.translate(0, 1.78, 0);
      return { geo: g, color: '#24392a' };
    }
    case Acc.strawHat: {
      const g = new THREE.ConeGeometry(0.34, 0.2, 12, 1, false);
      g.translate(0, 1.78, 0);
      return { geo: g, color: '#c9b072' };
    }
    case Acc.guardHelm: {
      const g = new THREE.SphereGeometry(0.135, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
      g.translate(0, 1.63, 0);
      const plume = new THREE.CylinderGeometry(0.035, 0.07, 0.3, 6);
      plume.translate(0, 1.88, -0.04);
      const out = merge([g, plume]);
      return { geo: out, color: '#2f5a34' };
    }
    case Acc.soldierHelm: {
      const g = new THREE.CylinderGeometry(0.12, 0.15, 0.16, 10);
      g.translate(0, 1.7, 0);
      const brim = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 12);
      brim.translate(0, 1.64, 0);
      return { geo: merge([g, brim]), color: '#c8a23a' };
    }
    case Acc.scholarCap: {
      const g = new THREE.BoxGeometry(0.22, 0.12, 0.22);
      g.translate(0, 1.74, -0.01);
      return { geo: g, color: '#2a2a2a' };
    }
    case Acc.topknot: {
      const g = new THREE.SphereGeometry(0.06, 6, 4);
      g.translate(0, 1.76, -0.03);
      return { geo: g, color: '#1a1410' };
    }
    case Acc.bundle: {
      const g = new THREE.SphereGeometry(0.22, 7, 5);
      g.scale(1, 0.85, 0.8);
      g.translate(0, 1.2, -0.27);
      return { geo: g, color: '#a08a62' };
    }
    case Acc.crate: {
      const g = new THREE.BoxGeometry(0.5, 0.36, 0.42);
      g.translate(0, 1.98, 0.02);
      return { geo: g, color: '#8a6a42' };
    }
    case Acc.pole: {
      const pole = new THREE.CylinderGeometry(0.025, 0.025, 1.7, 5);
      pole.rotateZ(Math.PI / 2);
      pole.translate(0, 1.48, 0);
      const b1 = new THREE.CylinderGeometry(0.2, 0.16, 0.3, 8);
      b1.translate(0.78, 0.98, 0);
      const b2 = b1.clone();
      b2.translate(-1.56, 0, 0);
      const r1 = new THREE.CylinderGeometry(0.01, 0.01, 0.5, 3);
      r1.translate(0.78, 1.23, 0);
      const r2 = r1.clone();
      r2.translate(-1.56, 0, 0);
      return { geo: merge([pole, b1, b2, r1, r2]), color: '#8c6d40' };
    }
    case Acc.cart: {
      const bed = new THREE.BoxGeometry(0.9, 0.5, 1.2);
      bed.translate(0, 0.75, 1.0);
      const w1 = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 10);
      w1.rotateZ(Math.PI / 2);
      w1.translate(0.5, 0.32, 1.0);
      const w2 = w1.clone();
      w2.translate(-1.0, 0, 0);
      const h1 = new THREE.BoxGeometry(0.05, 0.05, 0.9);
      h1.translate(0.32, 0.82, 0.25);
      const h2 = h1.clone();
      h2.translate(-0.64, 0, 0);
      const goods = new THREE.SphereGeometry(0.3, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      goods.scale(1.2, 0.8, 1.6);
      goods.translate(0, 1.0, 1.0);
      return { geo: merge([bed, w1, w2, h1, h2, goods]), color: '#7a5a36' };
    }
    case Acc.parasol: {
      const g = new THREE.ConeGeometry(0.55, 0.22, 12, 1, true);
      g.translate(0.2, 2.15, 0.1);
      const st = new THREE.CylinderGeometry(0.015, 0.015, 1.1, 4);
      st.translate(0.2, 1.6, 0.1);
      return { geo: merge([g, st]), color: '#c85a4a' };
    }
    default:
      return null;
  }
}

function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const pa = p.getAttribute('position'), na = p.getAttribute('normal');
    for (let i = 0; i < pa.count; i++, o++) {
      pos[o * 3] = pa.getX(i);
      pos[o * 3 + 1] = pa.getY(i);
      pos[o * 3 + 2] = pa.getZ(i);
      nrm[o * 3] = na.getX(i);
      nrm[o * 3 + 1] = na.getY(i);
      nrm[o * 3 + 2] = na.getZ(i);
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

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface Layer {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  robe: THREE.InstancedBufferAttribute;
  pants: THREE.InstancedBufferAttribute;
  skin: THREE.InstancedBufferAttribute;
  n: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export class FigureRenderer {
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
  /** Figures pushed last frame (debug). */
  stats = { near: 0, far: 0, culled: 0 };

  constructor(parent: THREE.Object3D, readonly capacity: number) {
    this.group.name = 'bss_figures';
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
      const anim = mk(4), robe = mk(3), pants = mk(3), skin = mk(3);
      geo.setAttribute('iAnim', anim);
      geo.setAttribute('iRobe', robe);
      geo.setAttribute('iPants', pants);
      geo.setAttribute('iSkin', skin);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.name = `bss_figures_lod${lod}`;
      this.group.add(mesh);
      return { mesh, anim, robe, pants, skin, n: 0 };
    });
    const sg = new THREE.CircleGeometry(0.42, 12);
    sg.rotateX(-Math.PI / 2);
    this.geos.push(sg);
    const sm = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false });
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
    const def = accGeometry(id as AccId);
    if (!def) return null;
    const mat = new THREE.MeshLambertMaterial({ color: def.color, side: THREE.DoubleSide });
    this.geos.push(def.geo);
    this.mats.push(mat);
    const mesh = new THREE.InstancedMesh(def.geo, mat, this.capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    a = { mesh, n: 0 };
    this.accs.set(id, a);
    return a;
  }

  /** Scale the visible range (low presets draw fewer figures). */
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

  /** Optional (after begin): the view frustum, so figures off screen are skipped. */
  view(camera: THREE.Camera): void {
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    this.hasView = true;
  }

  /** True if a person standing at (x, y, z) is inside the view frustum (always true without a view). */
  inView(x: number, y: number, z: number): boolean {
    if (!this.hasView) return true;
    this.sphere.center.set(x, y + 0.9, z);
    return this.frustum.intersectsSphere(this.sphere);
  }

  /** True if a figure at (x, z) would be drawn (callers can skip work). */
  visible(x: number, y: number, z: number): boolean {
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z;
    return dx * dx + dy * dy + dz * dz < this.far2 && this.inView(x, y, z);
  }

  push(x: number, y: number, z: number, yaw: number, pose: number, phase: number, amount: number, lean: number, robe: number, pants: number, skin: number, acc = 0, scale = 1): void {
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
    tmpQ.setFromAxisAngle(UP, yaw);
    tmpP.set(x, y, z);
    tmpS.set(scale, scale, scale);
    tmpM.compose(tmpP, tmpQ, tmpS);
    L.mesh.setMatrixAt(i, tmpM);
    L.anim.setXYZW(i, pose, phase, amount, lean);
    L.robe.setXYZ(i, ((robe >> 16) & 255) / 255, ((robe >> 8) & 255) / 255, (robe & 255) / 255);
    L.pants.setXYZ(i, ((pants >> 16) & 255) / 255, ((pants >> 8) & 255) / 255, (pants & 255) / 255);
    L.skin.setXYZ(i, ((skin >> 16) & 255) / 255, ((skin >> 8) & 255) / 255, (skin & 255) / 255);
    if (acc) {
      const a = this.acc(acc);
      if (a && a.n < this.capacity) a.mesh.setMatrixAt(a.n++, tmpM);
    }
    if (lod === 0 && pose !== Pose.sit && this.shadowN < this.capacity) {
      tmpP.y += 0.04;
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.shadow.setMatrixAt(this.shadowN++, tmpM);
    }
  }

  end(): void {
    for (const l of this.layers) {
      l.mesh.count = l.n;
      if (l.n) {
        l.mesh.instanceMatrix.needsUpdate = true;
        l.anim.needsUpdate = l.robe.needsUpdate = l.pants.needsUpdate = l.skin.needsUpdate = true;
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
    this.group.removeFromParent();
    this.group.clear();
    this.accs.clear();
  }
}
