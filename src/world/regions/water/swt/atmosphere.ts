import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import { C, FLOOR, RI, SWT } from './layout';

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
  p.x += sin(uv.x * 9.0 + uTime * 0.07 + aCurtain * 2.1) * 26.0 * (0.4 + uv.y);
  p.z += cos(uv.x * 7.0 - uTime * 0.05 + aCurtain) * 18.0 * (0.4 + uv.y);
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
    // Three curtains arcing over the southern sky (south = +Z), high above the tundra.
    const curtains = [
      { cx: C.x - 120, cz: C.z + 760, r: 900, a0: -0.55, a1: 0.5, y: 330, h: 300 },
      { cx: C.x + 160, cz: C.z + 980, r: 1100, a0: -0.45, a1: 0.42, y: 420, h: 360 },
      { cx: C.x - 40, cz: C.z + 560, r: 700, a0: -0.35, a1: 0.65, y: 280, h: 240 },
    ];
    curtains.forEach((c, ci) => {
      const base = pos.length / 3;
      for (let i = 0; i <= seg; i++) {
        const u = i / seg;
        const a = c.a0 + (c.a1 - c.a0) * u;
        const x = c.cx + Math.sin(a) * c.r, z = c.cz - Math.cos(a) * c.r * 0.55;
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
 * What a raid leaves behind: soot fallen on the snow round the gate and through the northern
 * neighbourhoods, scorched patches, and the igloos still smoking (positions for smoke emitters).
 */
export class RaidMarks {
  readonly group = new THREE.Group();
  readonly smoke: THREE.Vector3[] = [];
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(parent: THREE.Object3D) {
    const rnd = new Random(SWT.seed + 919);
    this.geo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: '#1d1a18', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const n = 70;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      // Thickest at the gate (north), thinning south through the village.
      const a = rnd.gaussian() * 0.7;
      const r = RI * (0.35 + rnd.next() * 0.62);
      const x = C.x + Math.sin(a) * r, z = C.z - Math.cos(a) * r;
      const sz = 1.5 + rnd.next() * 4;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd.next() * 6);
      s.set(sz * (0.6 + rnd.next() * 0.8), 1, sz);
      v.set(x, FLOOR + 0.03 + i * 0.0004, z);
      mesh.setMatrixAt(i, m.compose(v, q, s));
      if (i % 9 === 0) this.smoke.push(new THREE.Vector3(x, FLOOR + 1.6, z));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = 'swt_raid_soot';
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.group.name = 'swt_raid';
    this.group.visible = false;
    parent.add(this.group);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
