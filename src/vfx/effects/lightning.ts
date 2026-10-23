import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { effect } from './loop';
import { boltMaterial } from './materials';

/**
 * Lightning bolt renderer: jagged midpoint-displaced path with forks, drawn as
 * camera-facing quads (bright core + soft glow in one additive pass).
 *
 *   const bolt = new LightningBolt({ maxSegments: 160 });
 *   bolt.generate(from, to, { jag: 0.22, branches: 3 });
 *   bolt.update(camera.position);   // after generate() or when the camera moves
 *
 * Call generate() again every few frames for flicker. Dispose when done.
 */

export interface BoltOptions {
  /** Max lateral displacement relative to segment length (0.1 .. 0.4). */
  jag?: number;
  /** Subdivision depth (2^depth segments on the main path). */
  depth?: number;
  branches?: number;
  /** Width of the glow quad (m). */
  width?: number;
}

interface Seg {
  a: THREE.Vector3;
  b: THREE.Vector3;
  w: number;
  i: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

export class LightningBolt {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: THREE.BufferAttribute;
  private readonly uv: THREE.BufferAttribute;
  private readonly inten: THREE.BufferAttribute;
  private segs: Seg[] = [];
  private readonly maxSeg: number;
  /** Points along the main channel (for sparks / chain anchoring). */
  readonly path: THREE.Vector3[] = [];

  constructor(o: { maxSegments?: number; core?: THREE.ColorRepresentation; glow?: THREE.ColorRepresentation } = {}) {
    this.maxSeg = o.maxSegments ?? 160;
    this.material = boltMaterial(o.core ?? '#ffffff', o.glow ?? '#6fb4ff');
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(this.maxSeg * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.uv = new THREE.BufferAttribute(new Float32Array(this.maxSeg * 4 * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.inten = new THREE.BufferAttribute(new Float32Array(this.maxSeg * 4), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('uv', this.uv);
    this.geo.setAttribute('aI', this.inten);
    const idx: number[] = [];
    for (let i = 0; i < this.maxSeg; i++) {
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
  }

  private subdivide(a: THREE.Vector3, b: THREE.Vector3, depth: number, jag: number): THREE.Vector3[] {
    let pts = [a.clone(), b.clone()];
    const dir = tmpA.subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    // Two perpendicular axes for displacement.
    const p1 = tmpB.set(-dir.z, 0, dir.x);
    if (p1.lengthSq() < 1e-6) p1.set(1, 0, 0);
    p1.normalize();
    const p2 = tmpC.crossVectors(dir, p1).normalize();
    let amp = len * jag;
    for (let d = 0; d < depth; d++) {
      const next: THREE.Vector3[] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const m = pts[i].clone().lerp(pts[i + 1], 0.5);
        m.addScaledVector(p1, (Math.random() * 2 - 1) * amp).addScaledVector(p2, (Math.random() * 2 - 1) * amp);
        next.push(m, pts[i + 1]);
      }
      pts = next;
      amp *= 0.55;
    }
    return pts;
  }

  /** Build a new bolt shape from `a` to `b`. */
  generate(a: THREE.Vector3, b: THREE.Vector3, o: BoltOptions = {}): void {
    const jag = o.jag ?? 0.22;
    const depth = o.depth ?? 5;
    const width = o.width ?? 0.5;
    this.segs = [];
    const main = this.subdivide(a, b, depth, jag);
    this.path.length = 0;
    for (const p of main) this.path.push(p);
    for (let i = 0; i < main.length - 1; i++) this.segs.push({ a: main[i], b: main[i + 1], w: width, i: 1 });
    const branches = o.branches ?? 3;
    const len = a.distanceTo(b);
    for (let k = 0; k < branches && this.segs.length < this.maxSeg - 8; k++) {
      const start = main[1 + Math.floor(Math.random() * Math.max(1, main.length - 3))];
      const fwd = tmpA.subVectors(b, a).normalize();
      const dev = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      const dir = fwd.clone().multiplyScalar(0.7).add(dev.multiplyScalar(0.8)).normalize();
      const end = start.clone().addScaledVector(dir, len * (0.12 + Math.random() * 0.22));
      const bp = this.subdivide(start, end, Math.max(2, depth - 2), jag * 1.2);
      for (let i = 0; i < bp.length - 1 && this.segs.length < this.maxSeg; i++) {
        const f = 1 - i / bp.length;
        this.segs.push({ a: bp[i], b: bp[i + 1], w: width * 0.55 * f, i: 0.65 * f });
      }
    }
    if (this.segs.length > this.maxSeg) this.segs.length = this.maxSeg;
  }

  /** Rebuild camera-facing quads. */
  update(camPos: THREE.Vector3): void {
    const pos = this.pos.array as Float32Array;
    const uv = this.uv.array as Float32Array;
    const it = this.inten.array as Float32Array;
    const n = this.segs.length;
    for (let s = 0; s < n; s++) {
      const { a, b, w, i } = this.segs[s];
      const t = tmpA.subVectors(b, a);
      const mid = tmpB.addVectors(a, b).multiplyScalar(0.5);
      const side = tmpC.crossVectors(t, mid.sub(camPos).negate());
      if (side.lengthSq() < 1e-9) side.set(0, 1, 0);
      side.normalize().multiplyScalar(w * 0.5);
      // Extend a little along the segment to hide joints.
      const ext = t.multiplyScalar(0.08);
      const o = s * 12;
      const ax = a.x - ext.x, ay = a.y - ext.y, az = a.z - ext.z;
      const bx = b.x + ext.x, by = b.y + ext.y, bz = b.z + ext.z;
      pos[o] = ax + side.x; pos[o + 1] = ay + side.y; pos[o + 2] = az + side.z;
      pos[o + 3] = ax - side.x; pos[o + 4] = ay - side.y; pos[o + 5] = az - side.z;
      pos[o + 6] = bx + side.x; pos[o + 7] = by + side.y; pos[o + 8] = bz + side.z;
      pos[o + 9] = bx - side.x; pos[o + 10] = by - side.y; pos[o + 11] = bz - side.z;
      const q = s * 8;
      uv[q] = 0; uv[q + 1] = 0; uv[q + 2] = 1; uv[q + 3] = 0;
      uv[q + 4] = 0; uv[q + 5] = 1; uv[q + 6] = 1; uv[q + 7] = 1;
      const k = s * 4;
      it[k] = it[k + 1] = it[k + 2] = it[k + 3] = i;
    }
    this.pos.needsUpdate = true;
    this.uv.needsUpdate = true;
    this.inten.needsUpdate = true;
    this.geo.setDrawRange(0, n * 6);
  }

  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

/**
 * Fire-and-forget lightning strike from `a` to `b`: re-forks a few times for
 * flicker, then fades. Returns the bolt (path points are valid on return).
 */
export function strikeBolt(
  ctx: GameContext,
  a: THREE.Vector3,
  b: THREE.Vector3,
  o: { width?: number; life?: number; branches?: number; jag?: number; core?: THREE.ColorRepresentation; glow?: THREE.ColorRepresentation; reforks?: number } = {},
): LightningBolt {
  const low = ctx.vfx.quality === 'low';
  const bolt = new LightningBolt({ maxSegments: low ? 90 : 160, core: o.core, glow: o.glow });
  const width = o.width ?? 0.5;
  const life = o.life ?? 0.32;
  const depth = low ? 4 : 5;
  const gen = () => bolt.generate(a, b, { width, branches: o.branches ?? (low ? 2 : 4), jag: o.jag ?? 0.2, depth });
  gen();
  bolt.update(ctx.camera.position);
  ctx.vfx.group.add(bolt.mesh);
  let t = 0;
  let next = life / Math.max(1, o.reforks ?? 3);
  effect(
    (dt) => {
      t += dt;
      if (t >= next && t < life * 0.8) {
        next += life / Math.max(1, o.reforks ?? 3);
        gen();
      }
      const k = t / life;
      bolt.opacity = (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4) * (0.75 + Math.random() * 0.25);
      bolt.update(ctx.camera.position);
      return t < life;
    },
    () => {
      bolt.mesh.removeFromParent();
      bolt.dispose();
    },
  );
  return bolt;
}
