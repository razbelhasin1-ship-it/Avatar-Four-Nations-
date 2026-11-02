import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import { heightAt } from '../../../Heightfield';
import { WC_GATE, WC_RAMP_FOOT } from '../../../landforms/wolfCove';
import { C, FLOOR, PLAZA, RI, SWT } from './layout';

/**
 * Wolf Cove's sky and air: the aurora — curtains of green, teal and violet light over the southern
 * sky on clear nights, brighter on festival nights (the Glacier Spirits festival) — and the marks a
 * raid leaves (soot on the snow, smoking igloos). Breath puffs and blowing snow are particle bursts
 * driven from WolfCove.update.
 */

const AURORA_VERT = /* glsl */ `
attribute float aCurtain;
varying vec2 vUv;
varying float vC;
uniform float uTime;
void main() {
  vUv = uv;
  vC = aCurtain;
  vec3 p = position;
  // Slow folds travelling along the curtain.
  p.x += sin(uv.x * 9.0 + uTime * 0.07 + aCurtain * 2.1) * 60.0 * (0.4 + uv.y);
  p.z += cos(uv.x * 7.0 - uTime * 0.05 + aCurtain) * 45.0 * (0.4 + uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const AURORA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAmt;
varying vec2 vUv;
varying float vC;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
void main() {
  float u = vUv.x, v = vUv.y;
  // Vertical rays drifting along the curtain, gathered into brighter folds.
  float rays = 0.6 * n1(u * 140.0 + uTime * 0.5 + vC * 13.0) + 0.4 * n1(u * 47.0 - uTime * 0.22 + vC * 7.0);
  rays = pow(rays, 1.8);
  float fold = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(u * 15.0 + uTime * 0.1 + vC * 2.3), 2.0);
  float pulse = 0.75 + 0.25 * sin(uTime * 0.31 + vC * 4.0 + u * 3.0);
  float base = smoothstep(0.0, 0.07, v) * (1.0 - smoothstep(0.25, 1.0, v));
  float ends = smoothstep(0.0, 0.15, u) * (1.0 - smoothstep(0.85, 1.0, u));
  vec3 green = vec3(0.22, 1.0, 0.52);
  vec3 teal = vec3(0.16, 0.72, 0.86);
  vec3 violet = vec3(0.62, 0.28, 0.92);
  vec3 col = mix(green, teal, smoothstep(0.15, 0.55, v));
  col = mix(col, violet, smoothstep(0.5, 0.95, v));
  float a = rays * fold * pulse * base * ends * uAmt;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

export class Aurora {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.BufferGeometry;
  private amt = 0;

  constructor(parent: THREE.Object3D) {
    const pos: number[] = [], uv: number[] = [], cur: number[] = [], idx: number[] = [];
    const seg = 96;
    // Three curtains over the southern horizon (south = +Z), 1–2 km out over the tundra: from the
    // village they stand roughly 8°–38° above the horizon, bowing toward the viewer in the middle.
    const curtains = [
      { w: 2600, d: 1250, off: 0, bend: -250, y: 220, h: 560 },
      { w: 3000, d: 1750, off: 260, bend: -300, y: 300, h: 700 },
      { w: 1600, d: 1000, off: -300, bend: -150, y: 240, h: 380 },
    ];
    curtains.forEach((c, ci) => {
      const base = pos.length / 3;
      for (let i = 0; i <= seg; i++) {
        const u = i / seg;
        const x = C.x + c.off + (u - 0.5) * c.w;
        const z = C.z + c.d + c.bend * Math.sin(Math.PI * u) + 70 * Math.sin(u * Math.PI * 3 + ci * 1.7);
        for (const v of [0, 1]) {
          pos.push(x, c.y + v * c.h, z);
          uv.push(u, v);
          cur.push(ci);
        }
        if (i < seg) {
          const k = base + i * 2;
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    });
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.geo.setAttribute('aCurtain', new THREE.Float32BufferAttribute(cur, 1));
    this.geo.setIndex(idx);
    this.geo.computeBoundingSphere();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      uniforms: { uTime: { value: 0 }, uAmt: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'swt_aurora';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** `target` 0..1 (night × clear sky × festival boost); eases toward it. */
  update(dt: number, time: number, target: number): void {
    this.amt += (target - this.amt) * Math.min(1, dt * 0.5);
    this.mesh.visible = this.amt > 0.01;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uAmt.value = this.amt;
  }

  get intensity(): number {
    return this.amt;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Aurora strength for the hour: dark between dusk and dawn. */
export function nightFactor(hour: number): number {
  const ss = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return Math.max(ss(19.6, 20.8, hour), 1 - ss(4.3, 5.5, hour));
}

/**
 * What a raid leaves behind (the optional raided state; the default is peaceful): soot fallen on the
 * snow at the gate, down the ramp and along the processional path, scorched patches through the
 * northern neighbourhoods, the igloos nearest the gate burnt and broken with rubble round them, and
 * smoke rising from them (positions for smoke emitters).
 */
export class RaidMarks {
  readonly group = new THREE.Group();
  readonly smoke: THREE.Vector3[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(parent: THREE.Object3D, damaged: ReadonlyArray<{ x: number; z: number; r: number }>) {
    const rnd = new Random(SWT.seed + 919);
    const disc = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
    const soot = new THREE.MeshBasicMaterial({ color: '#1d1a18', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const burnt = new THREE.MeshLambertMaterial({ color: '#2d2724' });
    this.geos.push(disc);
    this.mats.push(soot, burnt);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const marks: Array<[number, number, number, number]> = [];
    // The gate and the ramp below it.
    for (let i = 0; i < 12; i++) marks.push([WC_GATE.x + rnd.gaussian() * 4, WC_GATE.z + rnd.gaussian() * 3, 1.6 + rnd.next() * 2.4, 0]);
    for (let z = WC_GATE.z - 4; z > WC_RAMP_FOOT.z; z -= 5) marks.push([WC_GATE.x + rnd.gaussian() * 2, z + rnd.gaussian(), 1.4 + rnd.next() * 2, 0]);
    // The processional path to the plaza.
    for (let z = WC_GATE.z + 4; z < PLAZA.z - PLAZA.r; z += 3) marks.push([C.x + rnd.gaussian() * 1.6, z + rnd.gaussian(), 1.2 + rnd.next() * 1.8, 0]);
    // Scattered through the northern neighbourhoods.
    for (let i = 0; i < 26; i++) {
      const a = rnd.gaussian() * 0.75, r = RI * (0.45 + rnd.next() * 0.5);
      marks.push([C.x + Math.sin(a) * r, C.z - Math.cos(a) * r, 1.4 + rnd.next() * 3, 0]);
    }
    const sootMesh = new THREE.InstancedMesh(disc, soot, marks.length);
    marks.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(UP, rnd.next() * 6);
      sc.set(s * (0.6 + rnd.next() * 0.8), 1, s);
      const inside = Math.hypot(x - C.x, z - C.z) < RI;
      v.set(x, (inside ? FLOOR : heightAt(x, z)) + 0.03 + i * 0.0004, z);
      sootMesh.setMatrixAt(i, m.compose(v, q, sc));
    });
    sootMesh.instanceMatrix.needsUpdate = true;
    sootMesh.name = 'swt_raid_soot';
    sootMesh.renderOrder = 1;
    this.group.add(sootMesh);
    // Burnt, broken igloos by the gate: a scorched, caved-in shell over each and rubble round it.
    const cap = new THREE.SphereGeometry(1, 12, 6, 0.4, Math.PI * 1.25, 0, Math.PI * 0.5);
    const block = new THREE.BoxGeometry(1, 1, 1);
    this.geos.push(cap, block);
    const caps = new THREE.InstancedMesh(cap, burnt, Math.max(1, damaged.length));
    const rubble = new THREE.InstancedMesh(block, burnt, Math.max(1, damaged.length * 5));
    let nr = 0;
    damaged.forEach((d, i) => {
      q.setFromAxisAngle(UP, rnd.next() * 6);
      sc.set(d.r * 1.04, d.r * 0.82, d.r * 1.04);
      v.set(d.x, FLOOR - 0.05, d.z);
      caps.setMatrixAt(i, m.compose(v, q, sc));
      for (let k = 0; k < 5; k++) {
        const a = rnd.next() * Math.PI * 2, rr = d.r + 0.4 + rnd.next() * 1.2, s = 0.35 + rnd.next() * 0.45;
        q.setFromEuler(new THREE.Euler(rnd.next() * 0.6, rnd.next() * 6, rnd.next() * 0.6));
        sc.set(s * 1.4, s, s);
        v.set(d.x + Math.sin(a) * rr, FLOOR + s * 0.4, d.z + Math.cos(a) * rr);
        rubble.setMatrixAt(nr++, m.compose(v, q, sc));
      }
      this.smoke.push(new THREE.Vector3(d.x, FLOOR + d.r * 0.9, d.z));
    });
    caps.count = damaged.length;
    rubble.count = nr;
    caps.instanceMatrix.needsUpdate = true;
    rubble.instanceMatrix.needsUpdate = true;
    caps.name = 'swt_raid_burnt_igloos';
    rubble.name = 'swt_raid_rubble';
    this.group.add(caps, rubble);
    this.group.name = 'swt_raid';
    this.group.visible = false;
    parent.add(this.group);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const mt of this.mats) mt.dispose();
    for (const o of this.group.children) (o as THREE.InstancedMesh).dispose?.();
  }
}
