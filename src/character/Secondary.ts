import * as THREE from 'three';
import type { ChainSpec } from './buildUtil';

/**
 * Secondary motion for capes, cloaks, sash tails, braids, ponytails and beards.
 * Each chain link is a verlet point (its tip) pulled by gravity, dragged by
 * the character's motion, softly sprung back toward the animated pose, kept at
 * link length, limited in swing and pushed out of a collision plane. The link
 * bone is then rotated to point at its tip.
 */

interface Link {
  bone: THREE.Object3D;
  /** Rest direction in the parent's local space (rest rotations are identity). */
  restDir: THREE.Vector3;
  len: number;
  tip: THREE.Vector3;
  prev: THREE.Vector3;
}

interface Chain {
  spec: ChainSpec;
  links: Link[];
  planeBone: THREE.Object3D | null;
}

const _J = new THREE.Vector3();
const _T = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _rest = new THREE.Vector3();

export class SecondaryMotion {
  private chains: Chain[] = [];
  private lastRoot = new THREE.Vector3();
  private rootVel = new THREE.Vector3();
  private initialised = false;

  constructor(specs: ChainSpec[], skeletonBones: THREE.Object3D[], private readonly root: THREE.Object3D) {
    for (const spec of specs) {
      const links: Link[] = [];
      spec.bones.forEach((bi, k) => {
        const a = spec.joints[k], b = spec.joints[k + 1];
        const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const len = dir.length() || 0.01;
        links.push({ bone: skeletonBones[bi], restDir: dir.normalize(), len, tip: new THREE.Vector3(), prev: new THREE.Vector3() });
      });
      this.chains.push({ spec, links, planeBone: spec.plane ? skeletonBones[spec.plane.bone] ?? null : null });
    }
  }

  get count(): number {
    return this.chains.length;
  }

  /** Snap every link to its animated rest pose. */
  reset(): void {
    this.initialised = false;
    for (const c of this.chains) for (const l of c.links) l.bone.quaternion.identity();
  }

  update(dt: number): void {
    if (!this.chains.length) return;
    dt = Math.min(dt, 1 / 20);
    this.root.updateWorldMatrix(true, true);
    const rootPos = _p.setFromMatrixPosition(this.root.matrixWorld);
    if (!this.initialised || rootPos.distanceToSquared(this.lastRoot) > 4) {
      this.initialised = false;
      this.rootVel.set(0, 0, 0);
    } else if (dt > 0) {
      _v.copy(rootPos).sub(this.lastRoot).divideScalar(dt);
      this.rootVel.lerp(_v, 1 - Math.exp(-dt * 12));
    }
    this.lastRoot.copy(rootPos);
    const scale = this.root.matrixWorld.getMaxScaleOnAxis() || 1;
    for (const c of this.chains) {
      const s = c.spec;
      const damp = Math.pow(s.damping, dt * 60);
      for (const l of c.links) {
        const bone = l.bone;
        const parent = bone.parent!;
        _J.setFromMatrixPosition(bone.matrixWorld);
        parent.getWorldQuaternion(_q);
        _rest.copy(l.restDir).applyQuaternion(_q);
        const len = l.len * scale;
        _T.copy(_J).addScaledVector(_rest, len);
        if (!this.initialised) {
          l.tip.copy(_T);
          l.prev.copy(_T);
        } else {
          _v.copy(l.tip).sub(l.prev).multiplyScalar(damp);
          l.prev.copy(l.tip);
          l.tip.add(_v);
          l.tip.y -= s.gravity * dt * dt * 0.5;
          l.tip.addScaledVector(this.rootVel, -s.drag * dt * dt * 4);
          l.tip.lerp(_T, 1 - Math.pow(1 - s.stiffness, dt * 60 * 0.5));
        }
        // Link length.
        _d.copy(l.tip).sub(_J);
        if (_d.lengthSq() < 1e-10) _d.copy(_rest);
        _d.normalize();
        // Swing limit.
        const ang = _d.angleTo(_rest);
        if (ang > s.maxAngle) {
          const axis = _v.crossVectors(_rest, _d);
          if (axis.lengthSq() > 1e-10) {
            axis.normalize();
            _d.copy(_rest).applyAxisAngle(axis, s.maxAngle);
          }
        }
        l.tip.copy(_J).addScaledVector(_d, len);
        // Collision plane (in the plane bone's space).
        if (s.plane && c.planeBone) {
          _m.copy(c.planeBone.matrixWorld).invert();
          const local = _v.copy(l.tip).applyMatrix4(_m);
          _n.set(s.plane.n[0], s.plane.n[1], s.plane.n[2]);
          const dist = local.dot(_n) - s.plane.d;
          if (dist < 0) {
            local.addScaledVector(_n, -dist);
            l.tip.copy(local.applyMatrix4(c.planeBone.matrixWorld));
            _d.copy(l.tip).sub(_J).normalize();
            l.tip.copy(_J).addScaledVector(_d, len);
          }
        }
        // Rotate the link bone to point at its tip.
        _qi.copy(_q).invert();
        const local = _v.copy(_d).applyQuaternion(_qi);
        bone.quaternion.setFromUnitVectors(l.restDir, local);
        bone.updateMatrixWorld(true);
      }
    }
    this.initialised = true;
  }
}
