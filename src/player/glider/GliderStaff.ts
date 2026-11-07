import * as THREE from 'three';
import type { Humanoid } from '../../character/Humanoid';

/**
 * The airbender's glider staff (Aang's, from the show): a long, straight wooden staff that snaps
 * open into a glider made of two folding fans —
 *  - a big fan near the head: thin dark ribs radiating from a hinge on the shaft, spreading to
 *    both sides and back along the staff; the orange-red cloth covers only the outer band of the
 *    fan (bare ribs near the hinge), its rim a smooth arc;
 *  - a small fan of the same make near the foot (the tail).
 * Folded, every rib lies inside the line of the shaft and the cloth with it: a plain staff.
 *
 * It is a prop of its own (not baked into the character mesh) so it can move:
 *  - 'back'  : slung diagonally across the back, folded (exploring);
 *  - 'hand'  : held in the hands, folded — spanning both fists when they are a staff's width apart,
 *              in the right fist otherwise (airbending: the wind leaves from its tip);
 *  - 'glide' : open, the flier hanging beneath it from both fists (gliding).
 * Mode changes blend over a fraction of a second; the fans flick open (a little overshoot, as a
 * spring-loaded fan does) and fold with the mode.
 *
 * Prop space: the staff runs along +Z (the head forward), the fans spread ±X (left on +X, the
 * character's left), +Y is the top face of the open glider. Built at character scale 1 (a 1.75 m
 * flier) and parented under the humanoid root, so it scales with the character.
 */

export type StaffMode = 'back' | 'hand' | 'glide';

/** Staff extent along +Z (m): the head (front tip) and the foot. The big fan hinges at z = 0. */
export const STAFF = { front: 0.45, rear: -1.65, radius: 0.019 } as const;
const LENGTH = STAFF.front - STAFF.rear;

const deg = (d: number) => (d * Math.PI) / 180;

export interface FanDef {
  /** Hinge on the staff (z). */
  hub: number;
  /** Rib length (m). */
  radius: number;
  /** The cloth starts at this fraction of the radius (bare ribs inside). */
  inner: number;
  /** Ribs per side, leading edge to the one lying along the staff. */
  ribs: number;
  /** Open angles of the leading and the last rib, from +Z toward the side (π: straight back). */
  lead: number;
  trail: number;
  /** Upward tilt of the open fan (radians). */
  dihedral: number;
}

/** The show's proportions: the big fan's ribs half the staff long, hinged a fifth of the way down;
 *  the tail fan two fifths of that, hinged near the foot. */
export const MAIN_FAN: FanDef = { hub: 0, radius: 1.0, inner: 0.5, ribs: 11, lead: deg(98), trail: deg(180), dihedral: deg(5) };
export const TAIL_FAN: FanDef = { hub: -1.25, radius: 0.4, inner: 0.45, ribs: 7, lead: deg(100), trail: deg(180), dihedral: deg(3) };

/** Where the fists grip the shaft while flying (just behind the big fan's hinge, in its bare centre). */
export const GRIP_Z = -0.12;
/** The flier hangs this far (radians) below the line of the glider: the body slopes down toward the feet. */
export const HANG = 0.26;

const WOOD = '#8a5a32';
const WOOD_DARK = '#4a2c1b';
const RIB = '#6b4527';

/** Angular samples per gap between ribs (the cloth's rim is a smooth arc) and radial rows across the band. */
const SUB = 3;
const ROWS = [0, 0.05, 0.5, 0.95, 1];

const Z = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _up = new THREE.Vector3();
const _rootInv = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** The cloth: orange-red with a darker hem at both edges and a thin dark line along each rib. */
function fabricTexture(): THREE.DataTexture {
  const w = 64, h = 32;
  const data = new Uint8Array(w * h * 4);
  const base = [228, 94, 44], hem = [150, 50, 24], rib = [70, 34, 18];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (y + 0.5) / h;
      const u = (x + 0.5) / w;
      let c = base;
      // A faint weave so large spans are not flat colour.
      const weave = ((x * 7 + y * 13) % 5) * 1.6 - 3;
      if (v < 0.07 || v > 0.93) c = hem;
      const ribDist = Math.min(u, 1 - u) * w;
      let k = 0;
      if (ribDist < 1.2) k = 1 - ribDist / 1.2;
      const i = (y * w + x) * 4;
      for (let j = 0; j < 3; j++) data[i + j] = Math.max(0, Math.min(255, Math.round(c[j] * (1 - k) + rib[j] * k + weave)));
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** One half of a fan (one side of the staff): its ribs and its band of cloth. */
interface Half {
  def: FanDef;
  side: 1 | -1;
  /** First rib's index in the instanced ribs. */
  rib0: number;
  /** First vertex of its cloth in the shared buffer. */
  v0: number;
}

/** Ease with a small overshoot (a fan flicked open springs a little past and settles). */
function backOut(t: number): number {
  const s = 1.6;
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

export class GliderStaff {
  /** The prop (child of the humanoid root; local transform set every update). */
  readonly root = new THREE.Group();
  mode: StaffMode = 'back';
  /** Fans opening 0 (folded) .. 1 (open). */
  open = 0;
  /** Wind on the cloth while flying (0..1, set by the flier): billow and flutter. */
  flutter = 0;
  /** Extra upward flex of the fans under load (0..1, set by the flier: lift, gusts, pulling out of a dive). */
  load = 0;
  private time = 0;
  /** Seconds into the current opening (the flick) — drives the overshoot. */
  private openT = 1;
  private lastPosed = -1;
  private blend = 1;
  private blendDur = 0.2;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private readonly holdPos = new THREE.Vector3();
  private readonly holdQuat = new THREE.Quaternion();
  private holdInit = false;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly tex: THREE.DataTexture;
  private readonly wings = new THREE.Group();
  private readonly ribs: THREE.InstancedMesh;
  private readonly cloth: THREE.Mesh;
  private readonly clothGeo: THREE.BufferGeometry;
  private readonly clothPos: Float32Array;
  private readonly halves: Half[] = [];
  /** Current rib angles per half (for the cloth between them). */
  private readonly angles: number[][] = [];
  /** World positions of the big fan's outermost rib tips (left, right), for wingtip trails. */
  private readonly tipL = new THREE.Vector3();
  private readonly tipR = new THREE.Vector3();

  constructor(private readonly humanoid: Humanoid) {
    this.root.name = 'glider_staff';
    const std = (color: string, rough: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
      this.mats.push(m);
      return m;
    };
    const wood = std(WOOD, 0.6);
    const dark = std(WOOD_DARK, 0.7);
    const ribMat = std(RIB, 0.75);
    this.tex = fabricTexture();
    const clothMat = std('#ffffff', 0.88, { map: this.tex, side: THREE.DoubleSide });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number, rx = Math.PI / 2) => {
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = rx;
      m.position.z = z;
      m.castShadow = true;
      this.root.add(m);
      return m;
    };
    // The shaft, slightly thicker toward the head, with rounded ends.
    add(new THREE.CylinderGeometry(STAFF.radius, STAFF.radius * 0.92, LENGTH, 10, 1), wood, (STAFF.front + STAFF.rear) / 2);
    const cap = new THREE.SphereGeometry(STAFF.radius * 1.12, 10, 6);
    this.geos.push(cap);
    for (const z of [STAFF.front, STAFF.rear]) {
      const m = new THREE.Mesh(cap, dark);
      m.position.z = z;
      m.castShadow = true;
      this.root.add(m);
    }
    // Dark collars: the two fan hinges, and bands near the ends.
    const collar = new THREE.CylinderGeometry(STAFF.radius * 1.45, STAFF.radius * 1.45, 0.05, 10, 1);
    const band = new THREE.CylinderGeometry(STAFF.radius * 1.2, STAFF.radius * 1.2, 0.025, 10, 1);
    this.geos.push(collar, band);
    for (const z of [MAIN_FAN.hub, TAIL_FAN.hub]) {
      const c = new THREE.Mesh(collar, dark);
      c.rotation.x = Math.PI / 2;
      c.position.z = z;
      this.root.add(c);
    }
    for (const z of [STAFF.front - 0.08, STAFF.rear + 0.08]) {
      const b = new THREE.Mesh(band, dark);
      b.rotation.x = Math.PI / 2;
      b.position.z = z;
      this.root.add(b);
    }
    // Leather grip where the fists hold it.
    add(new THREE.CylinderGeometry(STAFF.radius * 1.12, STAFF.radius * 1.12, 0.22, 10, 1), dark, GRIP_Z - 0.04);

    // Fans: all ribs in one instanced draw, all cloth in one buffer.
    this.root.add(this.wings);
    const ribGeo = new THREE.CylinderGeometry(0.0042, 0.0062, 1, 5, 1);
    ribGeo.rotateX(Math.PI / 2);
    ribGeo.translate(0, 0, 0.5);
    this.geos.push(ribGeo);
    let ribCount = 0, vertCount = 0;
    const idx: number[] = [];
    const uvs: number[] = [];
    for (const def of [MAIN_FAN, TAIL_FAN]) {
      for (const side of [1, -1] as const) {
        const half: Half = { def, side, rib0: ribCount, v0: vertCount };
        this.halves.push(half);
        this.angles.push(new Array(def.ribs).fill(def.trail));
        ribCount += def.ribs;
        const cols = (def.ribs - 1) * SUB + 1;
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < ROWS.length; r++) uvs.push(c / SUB, ROWS[r]);
        }
        for (let c = 0; c < cols - 1; c++) {
          for (let r = 0; r < ROWS.length - 1; r++) {
            const a = half.v0 + c * ROWS.length + r, b = a + ROWS.length;
            if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
            else idx.push(a, a + 1, b, a + 1, b + 1, b);
          }
        }
        vertCount += cols * ROWS.length;
      }
    }
    this.ribs = new THREE.InstancedMesh(ribGeo, ribMat, ribCount);
    this.ribs.castShadow = true;
    this.ribs.frustumCulled = false;
    this.wings.add(this.ribs);
    this.clothPos = new Float32Array(vertCount * 3);
    this.clothGeo = new THREE.BufferGeometry();
    this.clothGeo.setAttribute('position', new THREE.BufferAttribute(this.clothPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.clothGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.clothGeo.setIndex(idx);
    this.geos.push(this.clothGeo);
    this.cloth = new THREE.Mesh(this.clothGeo, clothMat);
    this.cloth.castShadow = true;
    this.cloth.frustumCulled = false;
    this.wings.add(this.cloth);
    humanoid.root.add(this.root);
    this.poseWings();
  }

  /** Change where the staff is; the move blends over `blend` seconds. */
  setMode(m: StaffMode, blend = 0.2): void {
    if (m === this.mode) return;
    this.fromPos.copy(this.root.position);
    this.fromQuat.copy(this.root.quaternion);
    this.blend = 0;
    this.blendDur = Math.max(0.01, blend);
    if (m === 'glide' && this.open < 0.05) this.openT = 0;
    this.mode = m;
    this.holdInit = false;
  }

  /** The tip the wind leaves from when airbending with the staff (world space). */
  tipWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return out.set(0, 0, STAFF.front + 0.05).applyMatrix4(this.root.matrixWorld);
  }

  /** The big fan's outermost rib tip on one side (world space): where the wingtip streams start. */
  wingTipWorld(side: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return out.copy(side > 0 ? this.tipL : this.tipR).applyMatrix4(this.root.matrixWorld);
  }

  /** True once the staff has reached its hold in the hands (not still flying off the back). */
  get inHands(): boolean {
    return this.mode === 'hand' && this.blend >= 1;
  }

  update(dt: number): void {
    this.time += dt;
    this.openT += dt;
    const h = this.humanoid;
    h.root.updateWorldMatrix(true, true);
    _rootInv.copy(h.root.matrixWorld).invert();
    // Target transform in humanoid-root space.
    this.target(dt, _pos, _quat);
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      this.root.position.lerpVectors(this.fromPos, _pos, k);
      this.root.quaternion.slerpQuaternions(this.fromQuat, _quat, k);
    } else {
      this.root.position.copy(_pos);
      this.root.quaternion.copy(_quat);
    }
    this.root.scale.setScalar(1);
    // Fans: flick open fast (spring-loaded), fold a little slower.
    const want = this.mode === 'glide' ? 1 : 0;
    if (this.open !== want) {
      const rate = want > this.open ? 3.6 : 3.2;
      this.open = want > this.open ? Math.min(want, this.open + dt * rate) : Math.max(want, this.open - dt * rate);
    }
    const settling = this.open >= 1 && this.openT < 0.6;
    if (this.open !== this.lastPosed || settling || (this.open > 0.5 && (this.flutter > 0.01 || this.load > 0.01))) this.poseWings();
  }

  private poseWings(): void {
    this.lastPosed = this.open;
    const f = this.open;
    this.wings.visible = f > 0.002;
    if (!this.wings.visible) return;
    // Opening: eased with a little overshoot that settles (a damped wobble after it locks open).
    let e: number;
    if (this.mode === 'glide') {
      e = backOut(Math.min(1, f));
      if (f >= 1) e = 1 + Math.sin(this.openT * 26) * Math.exp(-this.openT * 9) * 0.05;
    } else e = f * f * (3 - 2 * f);
    const flutter = this.flutter * Math.min(1, f);
    const load = this.load * Math.min(1, f);
    for (let hi = 0; hi < this.halves.length; hi++) this.poseHalf(hi, e, flutter, load);
    this.ribs.instanceMatrix.needsUpdate = true;
    this.clothGeo.attributes.position.needsUpdate = true;
    this.clothGeo.computeVertexNormals();
  }

  /** A point on a half-fan at rib parameter u (rib index + fraction) and radius fraction s (prop space). */
  private fanPoint(half: Half, ang: number[], u: number, s: number, e: number, flutter: number, load: number, out: THREE.Vector3): THREE.Vector3 {
    const d = half.def;
    const i = Math.min(d.ribs - 2, Math.floor(u));
    const fr = u - i;
    const a = ang[i] + (ang[i + 1] - ang[i]) * fr;
    const r = d.radius * s;
    // The fan flexes up toward the rim under load (dihedral grows outward), more toward the tips.
    const dih = (d.dihedral + load * deg(7) * s) * Math.min(1, Math.max(0, e));
    const across = Math.sin(a) * r;
    let y = across * Math.sin(dih);
    // Cloth billows up between the ribs and ripples toward the rim in the wind (held at each rib).
    if (s > d.inner) {
      const band = (s - d.inner) / (1 - d.inner);
      const between = Math.sin(Math.PI * fr);
      y += between * Math.sin(Math.PI * band) * d.radius * (0.012 + 0.03 * flutter);
      y += Math.sin(this.time * (17 + 9 * flutter) + u * 2.1 + half.side * 1.3) * flutter * between * band * band * d.radius * 0.03;
    }
    return out.set(across * Math.cos(dih) * half.side, y, d.hub + Math.cos(a) * r);
  }

  private poseHalf(hi: number, e: number, flutter: number, load: number): void {
    const half = this.halves[hi];
    const d = half.def;
    const ang = this.angles[hi];
    // Rib angles: folded, all lie along the staff (inside the shaft); open, spread evenly lead → trail.
    for (let k = 0; k < d.ribs; k++) {
      const open = d.lead + ((d.trail - d.lead) * k) / (d.ribs - 1);
      ang[k] = d.trail + (open - d.trail) * e;
    }
    // Ribs: from the hinge to the rim.
    const hub = _v.set(0, 0, d.hub);
    for (let k = 0; k < d.ribs; k++) {
      const tip = this.fanPoint(half, ang, Math.min(k, d.ribs - 1 - 1e-6), 1, e, 0, load, _v2);
      if (k === 0 && d === MAIN_FAN) (half.side > 0 ? this.tipL : this.tipR).copy(tip);
      _v3.subVectors(tip, hub);
      const len = _v3.length();
      _q.setFromUnitVectors(Z, _v3.multiplyScalar(1 / Math.max(len, 1e-4)));
      // Ribs ride on the cloth's top face.
      _m.compose(_v.set(0, 0.004, d.hub), _q, _scl.set(1, 1, len));
      this.ribs.setMatrixAt(half.rib0 + k, _m);
      hub.set(0, 0, d.hub);
    }
    // Cloth: the outer band, rows from the inner hem to the rim.
    const cols = (d.ribs - 1) * SUB + 1;
    const p = this.clothPos;
    for (let c = 0; c < cols; c++) {
      const u = Math.min(c / SUB, d.ribs - 1 - 1e-6);
      for (let r = 0; r < ROWS.length; r++) {
        const s = d.inner + (1 - d.inner) * ROWS[r];
        this.fanPoint(half, ang, u, s, e, flutter, load, _v3);
        const vi = (half.v0 + c * ROWS.length + r) * 3;
        p[vi] = _v3.x;
        p[vi + 1] = _v3.y;
        p[vi + 2] = _v3.z;
      }
    }
  }

  /** Where the staff wants to be this frame (root space). */
  private target(dt: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const h = this.humanoid;
    switch (this.mode) {
      case 'glide': {
        // Open above the flier, the shaft through both fists (between them, just behind the big
        // fan's hinge): the glider's line runs along the body's, tipped toward the belly by HANG,
        // so the body slopes down beneath it to the feet and the fans ride clear of the back.
        const chest = h.bones.chest;
        _m2.extractRotation(chest.matrixWorld);
        const c = Math.cos(HANG), s = Math.sin(HANG);
        _z.set(0, c, s).applyMatrix4(_m2).normalize();
        _y.set(0, s, -c).applyMatrix4(_m2).normalize();
        _x.crossVectors(_y, _z).normalize();
        _m.makeBasis(_x, _y, _z);
        const hl = h.anchors.handL.getWorldPosition(_v);
        const hr = h.anchors.handR.getWorldPosition(_v2);
        const mid = _mid.addVectors(hl, hr).multiplyScalar(0.5);
        // The shaft sits in the closed fists (a little above the palm anchors).
        mid.addScaledVector(_y, 0.02).addScaledVector(_z, -GRIP_Z);
        _m.setPosition(mid);
        _world.copy(_m);
        break;
      }
      case 'hand': {
        this.handTarget(dt);
        _world.compose(this.holdPos, this.holdQuat, _scl.set(1, 1, 1));
        break;
      }
      default: {
        // Slung across the back: head up over the left shoulder, foot down by the right hip.
        const back = h.anchors.back;
        const zAxis = _v.set(0.32, 1, -0.06).normalize();
        const yAxis = _y.set(0, 0, -1);
        const xAxis = _x.crossVectors(yAxis, zAxis).normalize();
        yAxis.crossVectors(zAxis, xAxis);
        _m.makeBasis(xAxis, yAxis, zAxis);
        // Centre of the shaft on the anchor (the prop origin is the big fan's hinge, near the head).
        const c = (STAFF.front + STAFF.rear) / 2;
        _v2.set(0, 0, -c).applyMatrix4(_m);
        _m.setPosition(-0.02 + _v2.x, -0.08 + _v2.y, -0.02 + _v2.z);
        _world.multiplyMatrices(back.matrixWorld, _m);
        break;
      }
    }
    _m.multiplyMatrices(_rootInv, _world);
    _m.decompose(pos, quat, _scl);
  }

  /**
   * Held in the hands: across both fists when they are a staff's grip apart (thrusts, sweeps,
   * spins — the shaft follows whatever the arms do), else in the right fist along the forearm.
   * Smoothed, so switching grips never snaps.
   */
  private handTarget(dt: number): void {
    const h = this.humanoid;
    const hr = h.anchors.handR.getWorldPosition(_v);
    const hl = h.anchors.handL.getWorldPosition(_v2);
    const axis = _v3.subVectors(hl, hr);
    const dist = axis.length();
    const fwd = _fwd.set(0, 0, 1).transformDirection(h.root.matrixWorld);
    const tgtPos = _pos;
    const tgtQuat = _quat;
    if (dist > 0.14 && dist < 1.0) {
      axis.multiplyScalar(1 / dist);
      // The head points forward (and up): whichever way the shaft lies, keep the head out front.
      if (axis.dot(fwd) + axis.y * 0.6 < 0) axis.negate();
      const mid = _mid.addVectors(hr, hl).multiplyScalar(0.5);
      // Grip a little behind the middle of the shaft, so more of the head reaches out.
      const c = (STAFF.front + STAFF.rear) / 2 - 0.12;
      tgtPos.copy(mid).addScaledVector(axis, -c);
      orient(tgtQuat, axis, fwd);
    } else {
      // One fist: along the forearm (elbow → fist), gripped two fifths up from the foot.
      const elbow = h.bones.foreArmR.getWorldPosition(_mid);
      axis.subVectors(hr, elbow);
      if (axis.lengthSq() < 1e-6) axis.copy(fwd);
      axis.normalize();
      // Along the forearm points the head down the arm's line: tilt it up out of the fist.
      axis.lerp(_up.set(0, 1, 0), 0.35).normalize();
      if (axis.dot(fwd) < -0.3) axis.negate();
      const grip = STAFF.rear + LENGTH * 0.4;
      tgtPos.copy(hr).addScaledVector(axis, -grip);
      orient(tgtQuat, axis, fwd);
    }
    if (!this.holdInit) {
      this.holdPos.copy(tgtPos);
      this.holdQuat.copy(tgtQuat);
      this.holdInit = true;
    } else {
      const k = 1 - Math.exp(-dt * 26);
      this.holdPos.lerp(tgtPos, k);
      this.holdQuat.slerp(tgtQuat, k);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.ribs.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }
}

/** Rotation taking prop +Z to `axis`, with the prop's top (+Y) as close to world up as it can be. */
function orient(out: THREE.Quaternion, axis: THREE.Vector3, fwd: THREE.Vector3): THREE.Quaternion {
  const up = Math.abs(axis.y) > 0.92 ? _y.copy(fwd) : _y.set(0, 1, 0);
  const x = _x.crossVectors(up, axis).normalize();
  const y = up.crossVectors(axis, x).normalize();
  _m.makeBasis(x, y, axis);
  return out.setFromRotationMatrix(_m);
}
