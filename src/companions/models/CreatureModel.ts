import * as THREE from 'three';
import { attachSkinned, creatureMaterial, instantiate, type ModelInstance, type ModelTemplate } from './ModelKit';

/** What a creature is doing (drives pose layers on top of locomotion). */
export type CreatureAction =
  | 'none'
  | 'graze'
  | 'eat'
  | 'rest'
  | 'sleep'
  | 'alert'
  | 'roar'
  | 'breath'
  | 'dig'
  | 'curl'
  | 'slide'
  | 'perch'
  | 'injured'
  | 'trapped'
  | 'happy'
  | 'sniff'
  | 'sit'
  | 'bow'
  | 'kick';

/** Per-frame animation input written by the creature controller. */
export interface AnimInput {
  dt: number;
  time: number;
  /** Horizontal speed (m/s). */
  speed: number;
  grounded: boolean;
  flying: boolean;
  swimming: boolean;
  /** Turn rate (rad/s), + = turning left. */
  turn: number;
  /** Vertical speed (m/s). */
  vy: number;
  action: CreatureAction;
  /** Seconds since the action started. */
  actionT: number;
  /** World-space point to look at (head tracking). */
  look: THREE.Vector3 | null;
  /** 0..1 excitement (tail wags, ear flicks). */
  excite: number;
  /** Boosting / sprinting flourish. */
  boost: boolean;
}

export function defaultAnim(): AnimInput {
  return { dt: 0, time: 0, speed: 0, grounded: true, flying: false, swimming: false, turn: 0, vy: 0, action: 'none', actionT: 0, look: null, excite: 0, boost: false };
}

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

/**
 * A procedurally animated creature model. Subclasses build (or fetch cached)
 * templates and implement update() by posing bones.
 *
 * `root` is placed by the entity (position/yaw); the model applies its own
 * bank/pitch/bob to `tilt` (child of root) so physics stays upright.
 */
export abstract class CreatureModel {
  readonly root = new THREE.Group();
  /** Bank/pitch carrier (child of root). */
  readonly tilt = new THREE.Group();
  protected readonly inst: ModelInstance;
  protected saddleMesh: THREE.SkinnedMesh | null = null;
  /** Per-instance extra objects (owned geometry/materials, disposed with the model). */
  private readonly extras: THREE.Object3D[] = [];
  /** Smoothed head look angles. */
  protected lookYaw = 0;
  protected lookPitch = 0;
  /** Gait phase (radians), advanced by distance travelled. */
  protected phase = 0;
  protected blinkT = Math.random() * 4;
  readonly seed = Math.random() * 1000;

  constructor(template: ModelTemplate, private readonly saddleTemplate: ModelTemplate | null = null, scale = 1) {
    this.inst = instantiate(template, creatureMaterial());
    this.root.add(this.tilt);
    this.tilt.add(this.inst.mesh);
    this.root.scale.setScalar(scale);
    this.root.name = 'creature';
  }

  get mesh(): THREE.SkinnedMesh {
    return this.inst.mesh;
  }

  /** Rider anchor (rideable species) — the player's feet follow it. */
  get seat(): THREE.Object3D | null {
    return this.inst.anchors.seat ?? null;
  }

  /** Mouth / breath origin. */
  get mouth(): THREE.Object3D {
    return this.inst.anchors.mouth ?? this.inst.mesh;
  }

  /** Point used for discovery / interaction prompts. */
  get headAnchor(): THREE.Object3D {
    return this.inst.anchors.head ?? this.inst.anchors.mouth ?? this.inst.mesh;
  }

  /** Optional named anchor. */
  anchor(name: string): THREE.Object3D | null {
    return this.inst.anchors[name] ?? null;
  }

  setSaddle(on: boolean): void {
    if (on && !this.saddleMesh && this.saddleTemplate) {
      this.saddleMesh = attachSkinned(this.inst, this.saddleTemplate);
      this.saddleMesh.castShadow = this.inst.mesh.castShadow;
    }
    if (this.saddleMesh) this.saddleMesh.visible = on;
  }

  get hasSaddle(): boolean {
    return !!this.saddleMesh?.visible;
  }

  setShadows(on: boolean): void {
    this.inst.mesh.castShadow = on;
    if (this.saddleMesh) this.saddleMesh.castShadow = on;
  }

  /** Attach an extra object (wound, ice, glow) that is disposed with the model. */
  attachExtra(obj: THREE.Object3D, bone?: string): void {
    const parent = bone ? this.inst.bones.get(bone) ?? this.tilt : this.tilt;
    parent.add(obj);
    this.extras.push(obj);
  }

  removeExtra(obj: THREE.Object3D): void {
    const i = this.extras.indexOf(obj);
    if (i < 0) return;
    this.extras.splice(i, 1);
    obj.removeFromParent();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mt of mats) if (mt !== creatureMaterial() && !mt.userData.shared) mt.dispose();
      }
    });
  }

  protected b(name: string): THREE.Bone {
    const b = this.inst.bones.get(name);
    if (!b) throw new Error(`[CreatureModel] missing bone ${name}`);
    return b;
  }

  protected hasBone(name: string): boolean {
    return this.inst.bones.has(name);
  }

  protected rot(name: string, x: number, y: number, z: number): void {
    const b = this.inst.bones.get(name);
    if (b) b.rotation.set(x, y, z);
  }

  /** Offset a bone from its rest position. */
  protected off(name: string, x: number, y: number, z: number): void {
    const b = this.inst.bones.get(name);
    const r = this.inst.rest.get(name);
    if (b && r) b.position.set(r.x + x, r.y + y, r.z + z);
  }

  protected scaleBone(name: string, s: number, sy = s, sz = s): void {
    const b = this.inst.bones.get(name);
    if (b) b.scale.set(s, sy, sz);
  }

  /**
   * Smoothly track a world-space target with the head: returns [yaw, pitch]
   * in the model's local frame, clamped and damped.
   */
  protected track(a: AnimInput, maxYaw: number, maxPitch: number, from: THREE.Vector3): [number, number] {
    let ty = 0, tp = 0;
    if (a.look) {
      this.root.updateWorldMatrix(true, false);
      tmpM.copy(this.root.matrixWorld).invert();
      tmpV.copy(a.look).applyMatrix4(tmpM).sub(from);
      const s = this.root.scale.x || 1;
      tmpV.multiplyScalar(1 / s);
      const h = Math.hypot(tmpV.x, tmpV.z);
      if (h > 0.2) {
        ty = Math.max(-maxYaw, Math.min(maxYaw, Math.atan2(tmpV.x, tmpV.z)));
        tp = Math.max(-maxPitch, Math.min(maxPitch, -Math.atan2(tmpV.y, h)));
        if (Math.abs(Math.atan2(tmpV.x, tmpV.z)) > 2.2) ty = 0;
      }
    }
    const k = 1 - Math.exp(-5 * a.dt);
    this.lookYaw += (ty - this.lookYaw) * k;
    this.lookPitch += (tp - this.lookPitch) * k;
    return [this.lookYaw, this.lookPitch];
  }

  /** Advance the gait phase by distance travelled for a given stride (m per cycle). */
  protected advance(a: AnimInput, stride: number): number {
    this.phase += (a.speed / Math.max(0.1, stride)) * Math.PI * 2 * a.dt;
    if (this.phase > 1e5) this.phase -= 1e5;
    return this.phase;
  }

  abstract update(a: AnimInput): void;

  /** Footfall callback hook: subclasses call this when a foot plants (tracks, sounds). */
  onFootfall: ((side: 'L' | 'R', heavy: boolean) => void) | null = null;
  private lastStep = 0;
  /** Helper: emit footfalls at phase zero-crossings. */
  protected footfalls(ph: number, heavy: boolean): void {
    const s = Math.sign(Math.sin(ph));
    if (s !== 0 && s !== this.lastStep) {
      this.lastStep = s;
      this.onFootfall?.(s > 0 ? 'L' : 'R', heavy);
    }
  }

  dispose(): void {
    for (const o of [...this.extras]) this.removeExtra(o);
    this.saddleMesh?.skeleton.dispose();
    this.inst.mesh.skeleton.dispose();
    this.root.removeFromParent();
    // Geometry and material are shared through the template cache.
  }
}

export const clampN = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;
export function dampN(cur: number, target: number, lambda: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}
