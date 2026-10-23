import * as THREE from 'three';

/**
 * Allocation-free Catmull-Rom path through a handful of control points,
 * densified into a polyline with cumulative arc length so tubes and hitboxes
 * can be sampled evenly by distance. The SAME sampler drives a water body's
 * mesh and its hit tests, which keeps visuals and collision in sync.
 */

const MAX_CTRL = 24;
const SUB = 8;
const MAX_DENSE = MAX_CTRL * SUB + 2;

export class PathSampler {
  private readonly cx = new Float32Array(MAX_CTRL);
  private readonly cy = new Float32Array(MAX_CTRL);
  private readonly cz = new Float32Array(MAX_CTRL);
  private n = 0;
  closed = false;
  private readonly dx = new Float32Array(MAX_DENSE);
  private readonly dy = new Float32Array(MAX_DENSE);
  private readonly dz = new Float32Array(MAX_DENSE);
  private readonly cum = new Float32Array(MAX_DENSE);
  private m = 0;
  /** Total arc length (m). */
  length = 0;

  get count(): number {
    return this.n;
  }

  /** Set control points (copied). */
  set(points: ArrayLike<THREE.Vector3>, count = points.length, closed = false): this {
    const n = Math.min(MAX_CTRL, count);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      this.cx[i] = p.x;
      this.cy[i] = p.y;
      this.cz[i] = p.z;
    }
    this.n = n;
    this.closed = closed;
    this.rebuild();
    return this;
  }

  /** Control point i (for callers that tweak and rebuild). */
  ctrl(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.cx[i], this.cy[i], this.cz[i]);
  }

  private rebuild(): void {
    const n = this.n;
    this.m = 0;
    this.length = 0;
    if (n === 0) return;
    if (n === 1) {
      this.dx[0] = this.cx[0];
      this.dy[0] = this.cy[0];
      this.dz[0] = this.cz[0];
      this.cum[0] = 0;
      this.m = 1;
      return;
    }
    const spans = this.closed ? n : n - 1;
    let k = 0;
    const idx = (i: number) => (this.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)));
    for (let s = 0; s < spans; s++) {
      const i1 = idx(s), i2 = idx(s + 1);
      let i0 = idx(s - 1), i3 = idx(s + 2);
      // Open ends: reflect for a natural tangent.
      let p0x: number, p0y: number, p0z: number, p3x: number, p3y: number, p3z: number;
      if (!this.closed && s === 0) {
        p0x = 2 * this.cx[i1] - this.cx[i2];
        p0y = 2 * this.cy[i1] - this.cy[i2];
        p0z = 2 * this.cz[i1] - this.cz[i2];
      } else {
        p0x = this.cx[i0];
        p0y = this.cy[i0];
        p0z = this.cz[i0];
      }
      if (!this.closed && s === spans - 1) {
        p3x = 2 * this.cx[i2] - this.cx[i1];
        p3y = 2 * this.cy[i2] - this.cy[i1];
        p3z = 2 * this.cz[i2] - this.cz[i1];
      } else {
        p3x = this.cx[i3];
        p3y = this.cy[i3];
        p3z = this.cz[i3];
      }
      void i0;
      void i3;
      const p1x = this.cx[i1], p1y = this.cy[i1], p1z = this.cz[i1];
      const p2x = this.cx[i2], p2y = this.cy[i2], p2z = this.cz[i2];
      const last = s === spans - 1;
      const steps = last ? SUB + 1 : SUB;
      for (let j = 0; j < steps; j++) {
        const t = j / SUB;
        const t2 = t * t, t3 = t2 * t;
        const a = -0.5 * t3 + t2 - 0.5 * t;
        const b = 1.5 * t3 - 2.5 * t2 + 1;
        const c = -1.5 * t3 + 2 * t2 + 0.5 * t;
        const d = 0.5 * t3 - 0.5 * t2;
        this.dx[k] = a * p0x + b * p1x + c * p2x + d * p3x;
        this.dy[k] = a * p0y + b * p1y + c * p2y + d * p3y;
        this.dz[k] = a * p0z + b * p1z + c * p2z + d * p3z;
        if (k > 0) {
          const ex = this.dx[k] - this.dx[k - 1], ey = this.dy[k] - this.dy[k - 1], ez = this.dz[k] - this.dz[k - 1];
          this.cum[k] = this.cum[k - 1] + Math.sqrt(ex * ex + ey * ey + ez * ez);
        } else this.cum[k] = 0;
        k++;
      }
    }
    this.m = k;
    this.length = this.cum[k - 1];
  }

  /** Point at arc length s (clamped). */
  at(s: number, out: THREE.Vector3): THREE.Vector3 {
    const m = this.m;
    if (m === 0) return out.set(0, 0, 0);
    if (m === 1 || s <= 0) return out.set(this.dx[0], this.dy[0], this.dz[0]);
    if (s >= this.length) return out.set(this.dx[m - 1], this.dy[m - 1], this.dz[m - 1]);
    // Binary search the dense polyline.
    let lo = 0, hi = m - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = this.cum[hi] - this.cum[lo];
    const f = span > 1e-6 ? (s - this.cum[lo]) / span : 0;
    return out.set(this.dx[lo] + (this.dx[hi] - this.dx[lo]) * f, this.dy[lo] + (this.dy[hi] - this.dy[lo]) * f, this.dz[lo] + (this.dz[hi] - this.dz[lo]) * f);
  }

  /** Point at normalised position u ∈ [0,1]. */
  atU(u: number, out: THREE.Vector3): THREE.Vector3 {
    return this.at(u * this.length, out);
  }

  /** Unit tangent at arc length s. */
  tangent(s: number, out: THREE.Vector3): THREE.Vector3 {
    const e = Math.max(0.02, this.length * 0.004);
    const a = this.at(Math.max(0, s - e), _ta);
    const b = this.at(Math.min(this.length, s + e), _tb);
    out.subVectors(b, a);
    const l = out.length();
    return l > 1e-6 ? out.divideScalar(l) : out.set(0, 0, 1);
  }

  /**
   * Distance from point p to the path between arc lengths [s0, s1] (sampled
   * every `step` metres). Writes the closest arc length into res.s.
   */
  distanceTo(p: THREE.Vector3, s0: number, s1: number, step: number, res?: { s: number }): number {
    let best = Infinity;
    let bestS = s0;
    const n = Math.max(1, Math.ceil((s1 - s0) / Math.max(0.05, step)));
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const q = this.at(s, _ta);
      const d = q.distanceToSquared(p);
      if (d < best) {
        best = d;
        bestS = s;
      }
    }
    if (res) res.s = bestS;
    return Math.sqrt(best);
  }
}

const _ta = new THREE.Vector3();
const _tb = new THREE.Vector3();

/** Quadratic bezier helper (no allocation). */
export function bezier2(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  return out.set(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z);
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIn = (t: number): number => Math.pow(clamp01(t), 3);
export const easeInOut = (t: number): number => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
