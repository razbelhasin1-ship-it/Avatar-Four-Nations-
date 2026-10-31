import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import { BASE, C, COUNTS, LEVEL_Y, SEED, TOWER, coneY, floorY, polar, yawOut } from './layout';
import { railTops } from './road';

/**
 * Winged lemurs: small grey-brown gliders with huge ears that flit round the pinnacle in loose
 * loops, flapping and gliding, and settle on the terrace balustrades and the tower balconies for a
 * while before taking off again. One instanced mesh; wings flap in the vertex shader.
 */

function lemurGeometry(): THREE.BufferGeometry {
  const parts: Array<[THREE.BufferGeometry, string, number]> = [];
  const ell = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => new THREE.SphereGeometry(1, 8, 6).scale(sx, sy, sz).translate(x, y, z);
  parts.push([ell(0.12, 0.1, 0.2, 0, 0.12, 0), '#8c8174', 0]);
  parts.push([ell(0.1, 0.06, 0.15, 0, 0.07, 0.02), '#d8cfc0', 0]);
  parts.push([ell(0.085, 0.08, 0.085, 0, 0.2, 0.2), '#8c8174', 0]);
  for (const s of [-1, 1]) {
    parts.push([ell(0.035, 0.11, 0.055, s * 0.1, 0.31, 0.17).rotateZ(-s * 0.35), '#d9a39a', 0]);
    parts.push([ell(0.018, 0.018, 0.014, s * 0.04, 0.22, 0.28), '#9bd36a', 0]);
  }
  const tail = new THREE.CylinderGeometry(0.012, 0.02, 0.5, 5);
  tail.rotateX(-1.1);
  tail.translate(0, 0.25, -0.38);
  parts.push([tail, '#5e554c', 0]);
  // Wing membranes: wrist to ankle, out to the tips (part 1 left, 2 right).
  for (const s of [-1, 1]) {
    const w = new THREE.BufferGeometry();
    const x0 = s * 0.08, x1 = s * 0.46;
    w.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0.14, 0.16, x1, 0.12, 0.06, x1, 0.12, -0.08, x0, 0.14, 0.16, x1, 0.12, -0.08, x0, 0.12, -0.14], 3));
    w.computeVertexNormals();
    parts.push([w, '#7a7066', s < 0 ? 1 : 2]);
  }
  const pos: number[] = [], nor: number[] = [], col: number[] = [], part: number[] = [];
  for (const [g0, c, p] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const cc = new THREE.Color(c);
    const a = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(cc.r, cc.g, cc.b);
      part.push(p);
    }
    g.dispose();
    if (g !== g0) g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  return out;
}

function lemurMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  m.name = 'sat_lemur';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nattribute vec3 aFlap;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
if (aPart > 0.5) {
  float s = aPart < 1.5 ? -1.0 : 1.0;
  // Flap about the body axis; folded along the flanks when perched.
  float ang = (sin(aFlap.x) * 0.95 * aFlap.y + 0.12) * (1.0 - aFlap.z) - 1.25 * aFlap.z;
  vec3 q = transformed - vec3(s * 0.08, 0.14, 0.0);
  float c = cos(ang), sn = sin(ang) * s;
  transformed = vec3(s * 0.08, 0.14, 0.0) + vec3(q.x * c - q.y * sn, q.x * sn + q.y * c, q.z);
}`,
      );
  };
  m.customProgramCacheKey = () => 'sat_lemur';
  return m;
}

interface Perch {
  x: number;
  y: number;
  z: number;
  yaw: number;
  taken: boolean;
}

interface Lemur {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  bank: number;
  state: 'fly' | 'approach' | 'perch';
  t: number;
  dur: number;
  zone: THREE.Vector3;
  f: THREE.Vector3;
  perch: Perch | null;
  flap: number;
  flapAmt: number;
  fold: number;
}

export class Lemurs {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly flapAttr: THREE.InstancedBufferAttribute;
  private readonly list: Lemur[] = [];
  private readonly perches: Perch[] = [];
  private readonly rnd = new Random(SEED + 515);
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshStandardMaterial;
  private time = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly s1 = new THREE.Vector3(1, 1, 1);
  private readonly v = new THREE.Vector3();

  constructor(quality: 'low' | 'medium' | 'high') {
    const n = quality === 'low' ? 18 : quality === 'medium' ? 28 : COUNTS.lemurs;
    this.geo = lemurGeometry();
    this.mat = lemurMaterial();
    this.flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.flapAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aFlap', this.flapAttr);
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sat_lemurs';
    this.group.add(this.mesh);
    for (const p of railTops(7)) this.perches.push({ x: p.x, y: p.y, z: p.z, yaw: yawOut(p.th), taken: false });
    // Tower balconies (the central tower and the two balconied towers).
    const balcony = (x: number, z: number, y: number, r: number) => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        this.perches.push({ x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r, yaw: Math.atan2(Math.cos(a), Math.sin(a)), taken: false });
      }
    };
    const drumTop = floorY(LEVEL_Y[6]) + 1.5;
    balcony(C.x, C.z, drumTop + TOWER.h * 0.78 + 1.12, TOWER.r + 0.95);
    const t4 = polar(266, 68);
    balcony(t4.x, t4.z, floorY(LEVEL_Y[1]) + 26 * 0.78 + 1.12, 3.3 + 0.95);
    const t1 = polar(347, 58);
    balcony(t1.x, t1.z, floorY(LEVEL_Y[2]) + 28 * 0.78 + 1.12, 3.0 + 0.95);
    for (let i = 0; i < n; i++) {
      const th = this.rnd.range(0, 360), r = this.rnd.range(38, 118);
      const p = polar(th, r);
      const y = Math.max(BASE + coneY(r) + 14, BASE + this.rnd.range(30, 120));
      const l: Lemur = {
        pos: new THREE.Vector3(p.x, y, p.z), vel: new THREE.Vector3(), yaw: 0, bank: 0, state: 'fly', t: 0, dur: this.rnd.range(6, 30),
        zone: new THREE.Vector3(p.x, y, p.z), f: new THREE.Vector3(this.rnd.range(0.05, 0.12), this.rnd.range(0.04, 0.1), this.rnd.range(0.05, 0.12)),
        perch: null, flap: this.rnd.range(0, 6), flapAmt: 1, fold: 0,
      };
      // About a third start perched.
      if (i % 3 === 0) {
        const pr = this.freePerch(l.pos);
        if (pr) {
          l.perch = pr;
          pr.taken = true;
          l.state = 'perch';
          l.pos.set(pr.x, pr.y, pr.z);
          l.yaw = pr.yaw;
          l.fold = 1;
          l.dur = this.rnd.range(5, 25);
        }
      }
      this.list.push(l);
    }
  }

  get count(): number {
    return this.list.length;
  }

  /** Positions and states (tests, screenshots). */
  positions(): Array<{ x: number; y: number; z: number; state: string; yaw: number }> {
    return this.list.map((l) => ({ x: +l.pos.x.toFixed(2), y: +l.pos.y.toFixed(2), z: +l.pos.z.toFixed(2), state: l.state, yaw: +l.yaw.toFixed(2) }));
  }

  get perched(): number {
    return this.list.filter((l) => l.state === 'perch').length;
  }

  private freePerch(near: THREE.Vector3): Perch | null {
    let best: Perch | null = null, bd = Infinity;
    for (let k = 0; k < 12; k++) {
      const p = this.perches[this.rnd.int(0, this.perches.length - 1)];
      if (!p || p.taken) continue;
      const d = Math.hypot(p.x - near.x, p.y - near.y, p.z - near.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.list.length; i++) {
      const l = this.list[i];
      l.t += dt;
      if (l.state === 'perch') {
        l.fold = Math.min(1, l.fold + dt * 3);
        l.flapAmt = 0;
        l.vel.set(0, 0, 0);
        if (l.t > l.dur) {
          l.state = 'fly';
          l.t = 0;
          l.dur = this.rnd.range(8, 30);
          if (l.perch) l.perch.taken = false;
          l.perch = null;
          l.vel.set(Math.sin(l.yaw) * 4, 3, Math.cos(l.yaw) * 4);
        }
      } else {
        l.fold = Math.max(0, l.fold - dt * 4);
        let target: THREE.Vector3;
        let speed = 7.5;
        if (l.state === 'approach' && l.perch) {
          target = this.v.set(l.perch.x, l.perch.y, l.perch.z);
          const d = target.distanceTo(l.pos);
          speed = Math.max(1.2, Math.min(7.5, d * 1.2));
          if (d < 0.35) {
            l.state = 'perch';
            l.t = 0;
            l.dur = this.rnd.range(6, 28);
            l.pos.copy(target);
            l.yaw = l.perch.yaw;
            l.bank = 0;
            this.write(i, l);
            continue;
          }
        } else {
          const t = this.time;
          target = this.v.set(
            l.zone.x + Math.sin(t * l.f.x + i) * 26,
            l.zone.y + Math.sin(t * l.f.y + i * 1.7) * 9,
            l.zone.z + Math.cos(t * l.f.z + i * 0.6) * 26,
          );
          const r = Math.hypot(target.x - C.x, target.z - C.z);
          target.y = Math.max(target.y, BASE + coneY(Math.max(26, r)) + 10);
          if (r < 30) target.y = Math.max(target.y, floorY(LEVEL_Y[6]) + TOWER.h + 20);
          if (l.t > l.dur) {
            const p = this.freePerch(l.pos);
            if (p) {
              p.taken = true;
              l.perch = p;
              l.state = 'approach';
              l.t = 0;
            } else l.t = 0;
          }
        }
        const dx = target.x - l.pos.x, dy = target.y - l.pos.y, dz = target.z - l.pos.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const k = Math.min(1, dt * 2.2);
        l.vel.x += ((dx / d) * speed - l.vel.x) * k;
        l.vel.y += ((dy / d) * speed - l.vel.y) * k;
        l.vel.z += ((dz / d) * speed - l.vel.z) * k;
        l.pos.addScaledVector(l.vel, dt);
        const hv = Math.hypot(l.vel.x, l.vel.z);
        const prev = l.yaw;
        if (hv > 0.2) l.yaw = Math.atan2(l.vel.x, l.vel.z);
        const turn = Math.atan2(Math.sin(l.yaw - prev), Math.cos(l.yaw - prev)) / Math.max(dt, 1e-3);
        l.bank += (Math.max(-0.6, Math.min(0.6, -turn * 0.25)) - l.bank) * Math.min(1, dt * 4);
        // Flap hard when climbing or slowing to land; glide on the way down.
        const want = l.vel.y > 0.4 || l.state === 'approach' ? 1 : Math.sin(this.time * 0.7 + i) > 0.2 ? 0.25 : 0.85;
        l.flapAmt += (want - l.flapAmt) * Math.min(1, dt * 3);
        l.flap += dt * (7 + 6 * l.flapAmt);
      }
      this.write(i, l);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flapAttr.needsUpdate = true;
  }

  private write(i: number, l: Lemur): void {
    this.e.set(l.state === 'perch' ? 0 : -Math.max(-0.5, Math.min(0.5, l.vel.y * 0.08)), l.yaw, l.bank, 'YXZ');
    this.q.setFromEuler(this.e);
    this.m4.compose(l.pos, this.q, this.s1);
    this.mesh.setMatrixAt(i, this.m4);
    this.flapAttr.setXYZ(i, l.flap, l.flapAmt, l.fold);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
