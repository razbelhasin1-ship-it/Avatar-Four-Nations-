import * as THREE from 'three';
import type { PathSampler } from './Curve';
import { createWaterMaterial, setLook, type WaterLook } from './WaterMaterials';

/**
 * A tube of water swept along a PathSampler: fixed-size, pre-allocated
 * geometry rewritten in place every frame (no per-frame allocation), pooled by
 * resolution. Parallel-transport frames avoid twisting; uv.y is the absolute
 * arc length so the flow shader streams from the source toward the head.
 */

export type Quality = 'low' | 'medium' | 'high';

const RES: Record<Quality, { segs: number; radial: number }> = {
  low: { segs: 22, radial: 6 },
  medium: { segs: 34, radial: 8 },
  high: { segs: 46, radial: 10 },
};

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3();

export class FlowTube {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly segs: number;
  readonly radial: number;
  readonly key: string;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly uvs: Float32Array;
  private readonly cx: Float32Array;
  private readonly cy: Float32Array;
  private readonly cz: Float32Array;
  private readonly fr: Float32Array; // frames: n(3) b(3) per ring
  inUse = false;
  /** Current visible span (for debug/trace). */
  span = { s0: 0, s1: 0 };

  constructor(segs: number, radial: number) {
    this.segs = segs;
    this.radial = radial;
    this.key = `${segs}x${radial}`;
    const rings = segs + 1;
    const vpr = radial + 1;
    const nv = rings * vpr;
    this.pos = new Float32Array(nv * 3);
    this.nrm = new Float32Array(nv * 3);
    this.uvs = new Float32Array(nv * 2);
    this.cx = new Float32Array(rings);
    this.cy = new Float32Array(rings);
    this.cz = new Float32Array(rings);
    this.fr = new Float32Array(rings * 6);
    const idx: number[] = [];
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * vpr + j, b = a + 1, c = a + vpr, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.material = createWaterMaterial();
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
    this.mesh.name = 'water_tube';
  }

  setLook(look: WaterLook): this {
    setLook(this.material, look);
    return this;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  /**
   * Pose the tube along `path` between arc lengths [s0, s1].
   * radius(u, s): u = 0 at s0 (tail) .. 1 at s1 (head).
   * wobble: lateral undulation amplitude (m) — living water.
   */
  build(path: PathSampler, s0: number, s1: number, radius: (u: number, s: number) => number, wobble = 0, time = 0): void {
    s0 = Math.max(0, s0);
    s1 = Math.min(path.length, s1);
    this.span.s0 = s0;
    this.span.s1 = s1;
    if (s1 - s0 < 0.02 || path.length < 0.02) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const S = this.segs, R = this.radial;
    const rings = S + 1;
    for (let i = 0; i < rings; i++) {
      const s = s0 + ((s1 - s0) * i) / S;
      path.at(s, _p);
      this.cx[i] = _p.x;
      this.cy[i] = _p.y;
      this.cz[i] = _p.z;
    }
    // Parallel-transport frames.
    for (let i = 0; i < rings; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(rings - 1, i + 1);
      _t.set(this.cx[i1] - this.cx[i0], this.cy[i1] - this.cy[i0], this.cz[i1] - this.cz[i0]);
      if (_t.lengthSq() < 1e-10) _t.set(0, 0, 1);
      _t.normalize();
      if (i === 0) {
        _up.set(0, 1, 0);
        if (Math.abs(_t.y) > 0.92) _up.set(1, 0, 0);
        _n.crossVectors(_t, _up).normalize();
      } else {
        _n.set(this.fr[(i - 1) * 6], this.fr[(i - 1) * 6 + 1], this.fr[(i - 1) * 6 + 2]);
        _n.addScaledVector(_t, -_n.dot(_t));
        if (_n.lengthSq() < 1e-8) {
          _up.set(0, 1, 0);
          if (Math.abs(_t.y) > 0.92) _up.set(1, 0, 0);
          _n.crossVectors(_t, _up);
        }
        _n.normalize();
      }
      _b.crossVectors(_t, _n).normalize();
      const o = i * 6;
      this.fr[o] = _n.x;
      this.fr[o + 1] = _n.y;
      this.fr[o + 2] = _n.z;
      this.fr[o + 3] = _b.x;
      this.fr[o + 4] = _b.y;
      this.fr[o + 5] = _b.z;
    }
    const pos = this.pos, nrm = this.nrm, uv = this.uvs;
    let v = 0;
    for (let i = 0; i < rings; i++) {
      const u = i / S;
      const s = s0 + (s1 - s0) * u;
      const r = Math.max(0, radius(u, s));
      const o = i * 6;
      const nx = this.fr[o], ny = this.fr[o + 1], nz = this.fr[o + 2];
      const bx = this.fr[o + 3], by = this.fr[o + 4], bz = this.fr[o + 5];
      let ccx = this.cx[i], ccy = this.cy[i], ccz = this.cz[i];
      if (wobble > 0) {
        const env = Math.sin(Math.PI * u);
        const w1 = Math.sin(s * 1.7 - time * 7.0) * wobble * env;
        const w2 = Math.cos(s * 2.3 - time * 5.3) * wobble * 0.6 * env;
        ccx += nx * w1 + bx * w2;
        ccy += ny * w1 + by * w2;
        ccz += nz * w1 + bz * w2;
      }
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const dx = nx * ca + bx * sa, dy = ny * ca + by * sa, dz = nz * ca + bz * sa;
        pos[v * 3] = ccx + dx * r;
        pos[v * 3 + 1] = ccy + dy * r;
        pos[v * 3 + 2] = ccz + dz * r;
        nrm[v * 3] = dx;
        nrm[v * 3 + 1] = dy;
        nrm[v * 3 + 2] = dz;
        uv[v * 2] = j / R;
        uv[v * 2 + 1] = s;
        v++;
      }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

/** Pool of tubes keyed by resolution; tubes are parented to `parent` once. */
export class TubePool {
  private readonly free = new Map<string, FlowTube[]>();
  private readonly all = new Set<FlowTube>();

  constructor(private readonly parent: THREE.Object3D, private readonly quality: () => Quality) {}

  /** detail > 1 for long bodies (draw streams, whips from far sources). */
  acquire(look: WaterLook = {}, detail = 1): FlowTube {
    const q = RES[this.quality()] ?? RES.medium;
    const segs = Math.round(q.segs * detail);
    const key = `${segs}x${q.radial}`;
    const list = this.free.get(key);
    let t = list?.pop();
    if (!t) {
      t = new FlowTube(segs, q.radial);
      this.parent.add(t.mesh);
      this.all.add(t);
    }
    t.inUse = true;
    t.setLook({ opacity: 0.9, ice: 0, glow: 0, flow: 3, foam: 1, deep: '#1764a8', shallow: '#9fe0ff', ...look });
    t.mesh.renderOrder = 12;
    return t;
  }

  release(t: FlowTube | null | undefined): void {
    if (!t || !t.inUse) return;
    t.inUse = false;
    t.hide();
    let list = this.free.get(t.key);
    if (!list) {
      list = [];
      this.free.set(t.key, list);
    }
    // Keep the pool bounded.
    if (list.length >= 24) {
      this.parent.remove(t.mesh);
      this.all.delete(t);
      t.dispose();
      return;
    }
    list.push(t);
  }

  get activeCount(): number {
    let n = 0;
    for (const t of this.all) if (t.inUse) n++;
    return n;
  }

  get totalCount(): number {
    return this.all.size;
  }

  dispose(): void {
    for (const t of this.all) {
      this.parent.remove(t.mesh);
      t.dispose();
    }
    this.all.clear();
    this.free.clear();
  }
}

/** Rounded tube ends: 0 at both ends, 1 in the middle (ends span `a` and `b` of u). */
export function capTaper(u: number, a = 0.08, b = 0.08): number {
  const t0 = a > 0 ? Math.min(1, u / a) : 1;
  const t1 = b > 0 ? Math.min(1, (1 - u) / b) : 1;
  return Math.sqrt(Math.max(0, t0)) * Math.sqrt(Math.max(0, t1));
}
