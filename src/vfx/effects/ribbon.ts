import * as THREE from 'three';

/**
 * Trail / ribbon helper: a strip mesh that follows a moving point (fists, feet,
 * projectiles, dashing bodies). Points age out after `life` seconds. Billboard
 * mode faces the camera (fire/wind streaks); flat mode uses a fixed up axis
 * (ground trails, sweeping arcs).
 *
 * uv.y runs along the trail (0 = newest/head, 1 = oldest/tail), uv.x across —
 * the bending flame/wind shaders fade the tail automatically.
 *
 *   const t = new Trail(flameMaterial({ sheet: true }), { width: 0.4, life: 0.25 });
 *   scene.add(t.mesh);  each frame: t.push(handPos, now); t.update(now, camera.position);
 */

export interface TrailOptions {
  maxPoints?: number;
  width?: number;
  /** Seconds a point lives. */
  life?: number;
  /** Minimum distance between recorded points. */
  minDist?: number;
  /** Width multiplier along the trail (u: 0 head .. 1 tail). */
  widthCurve?: (u: number) => number;
  /** 'billboard' faces the camera; 'flat' spans along `up` × tangent. */
  mode?: 'billboard' | 'flat';
  up?: THREE.Vector3;
}

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();

export class Trail {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  private readonly pts: THREE.Vector3[] = [];
  private readonly times: number[] = [];
  private readonly max: number;
  readonly opts: Required<Omit<TrailOptions, 'up'>> & { up: THREE.Vector3 };
  /** Global width multiplier (fade-outs). */
  widthScale = 1;

  constructor(material: THREE.Material, o: TrailOptions = {}) {
    this.max = Math.max(4, o.maxPoints ?? 24);
    this.opts = {
      maxPoints: this.max,
      width: o.width ?? 0.4,
      life: o.life ?? 0.3,
      minDist: o.minDist ?? 0.08,
      widthCurve: o.widthCurve ?? ((u) => 1 - u * 0.85),
      mode: o.mode ?? 'billboard',
      up: (o.up ?? new THREE.Vector3(0, 1, 0)).clone(),
    };
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(this.max * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(new Float32Array(this.max * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage);
    const nrm = new Float32Array(this.max * 2 * 3);
    for (let i = 0; i < this.max * 2; i++) nrm[i * 3 + 1] = 1;
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('uv', this.uvAttr);
    this.geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
  }

  get length(): number {
    return this.pts.length;
  }

  /** Record a new head position. */
  push(p: THREE.Vector3, now: number): void {
    if (this.pts.length && this.pts[0].distanceToSquared(p) < this.opts.minDist * this.opts.minDist) {
      this.pts[0].copy(p);
      this.times[0] = now;
      return;
    }
    let v: THREE.Vector3;
    if (this.pts.length >= this.max) {
      v = this.pts.pop()!;
      this.times.pop();
      v.copy(p);
    } else v = p.clone();
    this.pts.unshift(v);
    this.times.unshift(now);
  }

  clear(): void {
    this.pts.length = 0;
    this.times.length = 0;
    this.geo.setDrawRange(0, 0);
  }

  /** Drop expired points and rebuild the strip. */
  update(now: number, camPos: THREE.Vector3): void {
    const life = this.opts.life;
    while (this.times.length && now - this.times[this.times.length - 1] > life) {
      this.times.pop();
      this.pts.pop();
    }
    const n = this.pts.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    const pos = this.posAttr.array as Float32Array;
    const uv = this.uvAttr.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      const prev = this.pts[Math.max(0, i - 1)];
      const next = this.pts[Math.min(n - 1, i + 1)];
      const tangent = tA.subVectors(prev, next);
      if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
      tangent.normalize();
      let side: THREE.Vector3;
      if (this.opts.mode === 'flat') side = tB.crossVectors(tangent, this.opts.up);
      else side = tB.crossVectors(tangent, tC.subVectors(camPos, p));
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      side.normalize();
      const age = Math.min(1, (now - this.times[i]) / life);
      const u = Math.max(i / (n - 1), age);
      const w = this.opts.width * this.opts.widthCurve(u) * this.widthScale * 0.5;
      const o = i * 6;
      pos[o] = p.x + side.x * w;
      pos[o + 1] = p.y + side.y * w;
      pos[o + 2] = p.z + side.z * w;
      pos[o + 3] = p.x - side.x * w;
      pos[o + 4] = p.y - side.y * w;
      pos[o + 5] = p.z - side.z * w;
      const q = i * 4;
      uv[q] = 0;
      uv[q + 1] = u;
      uv[q + 2] = 1;
      uv[q + 3] = u;
    }
    this.posAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }

  dispose(): void {
    this.geo.dispose();
  }
}
