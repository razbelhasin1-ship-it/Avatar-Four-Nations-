import * as THREE from 'three';
import { rockGeometry, stoneMaterial } from './rocks';

/**
 * Pooled rock debris: one InstancedMesh of chunky stones simulated on the CPU
 * (gravity, ground bounce, tumbling, shrink-out). Used for rock impacts,
 * eruptions, crumbling constructs and explosions. Capacity scales with effects
 * quality; when full, new bursts recycle the oldest chunks.
 */

export interface DebrisBurst {
  /** Main direction (default up). */
  dir?: THREE.Vector3;
  /** 0 = tight cone .. 1 = hemisphere .. 2 = everywhere. */
  spread?: number;
  speed?: number;
  /** Chunk size (m, radius). */
  size?: number;
  life?: number;
  /** Position jitter radius. */
  radius?: number;
  color?: THREE.ColorRepresentation;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const s = new THREE.Vector3();
const p = new THREE.Vector3();
const c = new THREE.Color();

export class DebrisField {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private n = 0;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private rx: Float32Array; private ry: Float32Array; private rz: Float32Array;
  private wx: Float32Array; private wy: Float32Array; private wz: Float32Array;
  private size: Float32Array; private age: Float32Array; private life: Float32Array;
  private cr: Float32Array; private cg: Float32Array; private cb: Float32Array;
  private cursor = 0;

  constructor(capacity = 160) {
    this.cap = capacity;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.rx = f(); this.ry = f(); this.rz = f();
    this.wx = f(); this.wy = f(); this.wz = f();
    this.size = f(); this.age = f(); this.life = f();
    this.cr = f(); this.cg = f(); this.cb = f();
    this.mesh = new THREE.InstancedMesh(rockGeometry(3, 0), stoneMaterial('#8a7860'), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'bending_debris';
    // Instance colours (tint per chunk).
    this.mesh.setColorAt(0, c.set('#ffffff'));
  }

  get live(): number {
    return this.n;
  }

  burst(pos: THREE.Vector3, count: number, o: DebrisBurst = {}): void {
    const dir = o.dir ? p.copy(o.dir).normalize() : p.set(0, 1, 0);
    const spread = o.spread ?? 0.8;
    const speed = o.speed ?? 6;
    const size = o.size ?? 0.14;
    c.set(o.color ?? '#9a8a74');
    for (let k = 0; k < count; k++) {
      let i: number;
      if (this.n < this.cap) i = this.n++;
      else {
        i = this.cursor;
        this.cursor = (this.cursor + 1) % this.cap;
      }
      const jr = o.radius ?? 0.2;
      this.px[i] = pos.x + (Math.random() - 0.5) * 2 * jr;
      this.py[i] = pos.y + Math.random() * jr * 0.5;
      this.pz[i] = pos.z + (Math.random() - 0.5) * 2 * jr;
      let dx = dir.x + (Math.random() * 2 - 1) * spread;
      let dy = dir.y + (Math.random() * 2 - 1) * spread * 0.6;
      let dz = dir.z + (Math.random() * 2 - 1) * spread;
      const l = Math.hypot(dx, dy, dz) || 1;
      const sp = speed * (0.45 + Math.random() * 0.75);
      this.vx[i] = (dx / l) * sp;
      this.vy[i] = (dy / l) * sp;
      this.vz[i] = (dz / l) * sp;
      this.rx[i] = Math.random() * 6; this.ry[i] = Math.random() * 6; this.rz[i] = Math.random() * 6;
      this.wx[i] = (Math.random() - 0.5) * 14; this.wy[i] = (Math.random() - 0.5) * 14; this.wz[i] = (Math.random() - 0.5) * 14;
      this.size[i] = size * (0.5 + Math.random() * 0.9);
      this.age[i] = 0;
      this.life[i] = (o.life ?? 1.6) * (0.7 + Math.random() * 0.6);
      const shade = 0.82 + Math.random() * 0.3;
      this.cr[i] = c.r * shade; this.cg[i] = c.g * shade; this.cb[i] = c.b * shade;
    }
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.rx[i] = this.rx[j]; this.ry[i] = this.ry[j]; this.rz[i] = this.rz[j];
    this.wx[i] = this.wx[j]; this.wy[i] = this.wy[j]; this.wz[i] = this.wz[j];
    this.size[i] = this.size[j]; this.age[i] = this.age[j]; this.life[i] = this.life[j];
    this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j];
    if (this.cursor >= this.n) this.cursor = 0;
  }

  update(dt: number, groundAt: (x: number, z: number) => number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      this.vy[i] -= 22 * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      const g = groundAt(this.px[i], this.pz[i]) + this.size[i] * 0.6;
      if (this.py[i] < g) {
        this.py[i] = g;
        if (this.vy[i] < 0) this.vy[i] *= -0.32;
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
        this.wx[i] *= 0.6; this.wy[i] *= 0.6; this.wz[i] *= 0.6;
      }
      this.rx[i] += this.wx[i] * dt; this.ry[i] += this.wy[i] * dt; this.rz[i] += this.wz[i] * dt;
    }
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      const k = this.size[i] * (t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1);
      q.setFromEuler(e.set(this.rx[i], this.ry[i], this.rz[i]));
      m4.compose(p.set(this.px[i], this.py[i], this.pz[i]), q, s.set(k, k, k));
      this.mesh.setMatrixAt(i, m4);
      this.mesh.setColorAt(i, c.setRGB(this.cr[i], this.cg[i], this.cb[i]));
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.cursor = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
