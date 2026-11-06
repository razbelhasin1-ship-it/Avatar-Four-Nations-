import * as THREE from 'three';
import type { Humanoid } from '../../character/Humanoid';

/**
 * The airbender's glider staff (Aang's, from the show): a long wooden staff with dark joint rings
 * that snaps open into a glider — two big red-orange bat wings stretched over wooden ribs near the
 * top and a small V tail at the foot — and folds back into a slim bundle along the shaft.
 *
 * It is a prop of its own (not baked into the character mesh) so it can move:
 *  - 'back'  : slung diagonally across the back, folded (exploring);
 *  - 'hand'  : held in the hands, folded — spanning both fists when they are a staff's width apart,
 *              in the right fist otherwise (airbending: the wind leaves from its tip);
 *  - 'glide' : open above the back with the flier hanging from it (gliding).
 * Mode changes blend over a fraction of a second; the wings fan open and fold with the mode.
 *
 * Prop space: the staff runs along +Z (the head with the wings forward), wings span ±X (left wing
 * on +X, the character's left), +Y is the top face of the open glider. Built at character scale 1
 * (a 1.75 m flier) and parented under the humanoid root, so it scales with the character.
 */

export type StaffMode = 'back' | 'hand' | 'glide';

/** Staff extent along +Z (m): the head (front tip) and the foot. The main wings hinge at z = 0. */
export const STAFF = { front: 0.52, rear: -1.3, radius: 0.018 } as const;
const LENGTH = STAFF.front - STAFF.rear;

interface WingDef {
  /** Hinge on the staff (z). */
  hub: number;
  /** Rib lengths (m), leading edge first. */
  len: number[];
  /** Rib angles from +Z toward the wing's side, open and folded (radians). */
  open: number[];
  fold: number[];
  /** Upward tilt of the open wing (radians). */
  dihedral: number;
  /** Where the fabric's root edge meets the staff (z), behind the last rib. */
  attach: number;
  /** +1 left (+X), -1 right. */
  side: 1 | -1;
}

const deg = (d: number) => (d * Math.PI) / 180;
const MAIN = { hub: 0, len: [1.3, 1.24, 1.1, 0.92], open: [62, 92, 122, 152].map(deg), fold: [176, 177, 178, 179].map(deg), dihedral: deg(7), attach: -0.95 };
// The tail folds forward along the shaft (its ribs would overhang the foot folded backward).
const TAIL = { hub: -1.18, len: [0.5, 0.42], open: [116, 150].map(deg), fold: [4, 2].map(deg), dihedral: deg(32), attach: -1.27 };

const WOOD = '#7b4b28';
const WOOD_DARK = '#46291a';
const RIB = '#5b3920';
const FABRIC_IN = '#d96d3a';
const FABRIC_OUT = '#b9472a';

const Z = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _up = new THREE.Vector3();
const _rootInv = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();

class Wing {
  readonly ribs: THREE.Mesh[] = [];
  readonly fabric: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  /** Rib tips (prop space), recomputed by pose(). */
  private readonly tips: THREE.Vector3[];

  constructor(
    readonly def: WingDef,
    parent: THREE.Object3D,
    ribGeo: THREE.BufferGeometry,
    ribMat: THREE.Material,
    fabricMat: THREE.Material,
  ) {
    const n = def.len.length;
    this.tips = def.len.map(() => new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const r = new THREE.Mesh(ribGeo, ribMat);
      r.castShadow = true;
      parent.add(r);
      this.ribs.push(r);
    }
    // Vertices: hub, tips, scallops between tips, the root attach point on the staff.
    const verts = 1 + n + (n - 1) + 1;
    this.pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const cin = new THREE.Color(FABRIC_IN), cout = new THREE.Color(FABRIC_OUT);
    for (let i = 0; i < verts; i++) {
      const c = i === 0 || i === verts - 1 ? cin : cout;
      col.set([c.r, c.g, c.b], i * 3);
    }
    const idx: number[] = [];
    const tip = (i: number) => 1 + i;
    const sc = (i: number) => 1 + n + i;
    const att = verts - 1;
    for (let i = 0; i < n - 1; i++) idx.push(0, tip(i), sc(i), 0, sc(i), tip(i + 1));
    idx.push(0, tip(n - 1), att);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setIndex(def.side > 0 ? idx : flipWinding(idx));
    this.fabric = new THREE.Mesh(this.geo, fabricMat);
    this.fabric.castShadow = true;
    this.fabric.frustumCulled = false;
    parent.add(this.fabric);
  }

  /** Fan the ribs to open fraction f (0 folded .. 1 open); flutter ruffles the trailing edge. */
  pose(f: number, flutter: number, t: number): void {
    const d = this.def;
    const n = d.len.length;
    const e = f * f * (3 - 2 * f);
    const dih = d.dihedral * e;
    const hub = _v.set(0, 0, d.hub);
    for (let i = 0; i < n; i++) {
      const a = d.fold[i] + (d.open[i] - d.fold[i]) * e;
      // Folded, the ribs lie a little off the shaft (the fabric bundle); open, they fan out.
      const out = Math.sin(a) * d.len[i] + (1 - e) * 0.03;
      const tipV = this.tips[i].set(out * Math.cos(dih) * d.side, out * Math.sin(dih) + (1 - e) * 0.012, d.hub + Math.cos(a) * d.len[i]);
      const r = this.ribs[i];
      r.position.copy(hub);
      _v2.subVectors(tipV, hub);
      const len = _v2.length();
      r.quaternion.setFromUnitVectors(Z, _v2.multiplyScalar(1 / Math.max(len, 1e-4)));
      r.scale.set(1, 1, len);
    }
    const p = this.pos;
    p[0] = 0;
    p[1] = 0;
    p[2] = d.hub;
    for (let i = 0; i < n; i++) p.set([this.tips[i].x, this.tips[i].y, this.tips[i].z], (1 + i) * 3);
    // Scalloped trailing edge between the ribs (the bat-wing cut), drawn in toward the hinge.
    for (let i = 0; i < n - 1; i++) {
      const a = this.tips[i], b = this.tips[i + 1];
      const m = _v3.addVectors(a, b).multiplyScalar(0.5);
      const k = 0.2 * e;
      m.x -= m.x * k;
      m.y -= (m.y - 0) * k;
      m.z -= (m.z - d.hub) * k;
      m.y += Math.sin(t * 23 + i * 1.7 + d.side) * flutter * 0.025;
      p.set([m.x, m.y, m.z], (1 + n + i) * 3);
    }
    const at = (1 + n + n - 1) * 3;
    p[at] = 0;
    p[at + 1] = 0;
    p[at + 2] = d.attach;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }

  dispose(): void {
    this.geo.dispose();
  }
}

function flipWinding(idx: number[]): number[] {
  const out = idx.slice();
  for (let i = 0; i < out.length; i += 3) [out[i + 1], out[i + 2]] = [out[i + 2], out[i + 1]];
  return out;
}

export class GliderStaff {
  /** The prop (child of the humanoid root; local transform set every update). */
  readonly root = new THREE.Group();
  mode: StaffMode = 'back';
  /** Wing opening 0 (folded) .. 1 (open). */
  open = 0;
  /** Wind on the fabric while flying (0..1, set by the flier). */
  flutter = 0;
  private time = 0;
  private lastPosed = -1;
  private blend = 1;
  private blendDur = 0.2;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private readonly holdPos = new THREE.Vector3();
  private readonly holdQuat = new THREE.Quaternion();
  private holdInit = false;
  private readonly wings: Wing[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(private readonly humanoid: Humanoid) {
    this.root.name = 'glider_staff';
    const std = (color: string, rough: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
      this.mats.push(m);
      return m;
    };
    const wood = std(WOOD, 0.62);
    const dark = std(WOOD_DARK, 0.7);
    const ribMat = std(RIB, 0.7);
    const fabric = std('#ffffff', 0.86, { vertexColors: true, side: THREE.DoubleSide });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number, rx = Math.PI / 2) => {
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = rx;
      m.position.z = z;
      m.castShadow = true;
      this.root.add(m);
      return m;
    };
    // Shaft, with rounded ends.
    add(new THREE.CylinderGeometry(STAFF.radius, STAFF.radius * 1.06, LENGTH, 8, 1), wood, (STAFF.front + STAFF.rear) / 2);
    const cap = new THREE.SphereGeometry(STAFF.radius * 1.15, 8, 6);
    this.geos.push(cap);
    for (const z of [STAFF.front, STAFF.rear]) {
      const m = new THREE.Mesh(cap, dark);
      m.position.z = z;
      m.castShadow = true;
      this.root.add(m);
    }
    // Dark joint rings where the shaft's sections meet, each with a small peg.
    const ring = new THREE.CylinderGeometry(STAFF.radius * 1.32, STAFF.radius * 1.32, 0.035, 8, 1);
    const peg = new THREE.SphereGeometry(STAFF.radius * 0.75, 6, 4);
    this.geos.push(ring, peg);
    for (const z of [STAFF.front - 0.13, 0.04, -0.46, STAFF.rear + 0.15]) {
      const r = new THREE.Mesh(ring, dark);
      r.rotation.x = Math.PI / 2;
      r.position.z = z;
      this.root.add(r);
      const p = new THREE.Mesh(peg, dark);
      p.position.set(0, STAFF.radius * 1.3, z + 0.03);
      this.root.add(p);
    }
    // Leather grip wrap below the head.
    add(new THREE.CylinderGeometry(STAFF.radius * 1.15, STAFF.radius * 1.15, 0.2, 8, 1), dark, -0.22);
    // Ribs: a unit-length rod along +Z from its base, scaled per rib.
    const ribGeo = new THREE.CylinderGeometry(0.0065, 0.0085, 1, 5, 1);
    ribGeo.rotateX(Math.PI / 2);
    ribGeo.translate(0, 0, 0.5);
    this.geos.push(ribGeo);
    for (const side of [1, -1] as const) {
      this.wings.push(new Wing({ ...MAIN, side }, this.root, ribGeo, ribMat, fabric));
      this.wings.push(new Wing({ ...TAIL, side }, this.root, ribGeo, ribMat, fabric));
    }
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
    this.mode = m;
    this.holdInit = false;
  }

  /** The tip the wind leaves from when airbending with the staff (world space). */
  tipWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return out.set(0, 0, STAFF.front + 0.05).applyMatrix4(this.root.matrixWorld);
  }

  /** True once the staff has reached its hold in the hands (not still flying off the back). */
  get inHands(): boolean {
    return this.mode === 'hand' && this.blend >= 1;
  }

  update(dt: number): void {
    this.time += dt;
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
    // Wings: snap open quickly (it is a spring-loaded glider), fold a little slower.
    const want = this.mode === 'glide' ? 1 : 0;
    if (this.open !== want) {
      const rate = want > this.open ? 4.2 : 3.4;
      this.open = want > this.open ? Math.min(want, this.open + dt * rate) : Math.max(want, this.open - dt * rate);
    }
    if (this.open !== this.lastPosed || (this.open > 0.5 && this.flutter > 0.01)) this.poseWings();
  }

  private poseWings(): void {
    this.lastPosed = this.open;
    for (const w of this.wings) w.pose(this.open, this.flutter * this.open, this.time);
  }

  /** Where the staff wants to be this frame (root space). */
  private target(dt: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const h = this.humanoid;
    switch (this.mode) {
      case 'glide': {
        // Above the back, along the spine: the head (wings) toward the flier's head, top face up
        // away from the back. Hands reach up to the shaft just behind the hinge.
        const chest = h.bones.chest;
        _m.makeRotationX(-Math.PI / 2).setPosition(0, 0.36, -0.2);
        _world.multiplyMatrices(chest.matrixWorld, _m);
        break;
      }
      case 'hand': {
        this.handTarget(dt);
        _world.compose(this.holdPos, this.holdQuat, _scl.set(1, 1, 1));
        break;
      }
      default: {
        // Slung across the back: head up over the left shoulder, foot down by the right hip, the
        // fabric bundle lying flat against the back.
        const back = h.anchors.back;
        const zAxis = _v.set(0.32, 1, -0.06).normalize();
        const yAxis = _y.set(0, 0, -1);
        const xAxis = _x.crossVectors(yAxis, zAxis).normalize();
        yAxis.crossVectors(zAxis, xAxis);
        _m.makeBasis(xAxis, yAxis, zAxis);
        // Centre of the shaft on the anchor (the prop origin is the wing hinge, near the head).
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
    for (const w of this.wings) w.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
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

