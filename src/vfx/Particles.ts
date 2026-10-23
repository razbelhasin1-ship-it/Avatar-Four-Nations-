import * as THREE from 'three';

/**
 * CPU-simulated, GPU-instanced billboard particles. One draw call per blend
 * mode. Particles are struct-of-arrays for speed; capacity is fixed.
 */

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSizeRot;
attribute float iSoft;
varying vec4 vColor;
varying vec2 vUv;
varying float vSoft;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  vSoft = iSoft;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
  vec2 p = position.xy;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  mv.xy += p * iSizeRot.x;
  vec4 mvPosition = mv;
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
varying float vSoft;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float a = vSoft > 0.5 ? pow(clamp(1.0 - r, 0.0, 1.0), 1.6) : smoothstep(1.0, 0.75, r);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size0: number;
  size1: number;
  color0: THREE.Color;
  color1: THREE.Color;
  alpha0: number;
  alpha1: number;
  gravity: number;
  drag: number;
  spin: number;
  soft: boolean;
  /** Swirl around the vertical axis through (cx, cz). */
  swirl?: number;
  cx?: number;
  cz?: number;
}

export class ParticleLayer {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private count = 0;
  // SoA state
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array;
  private c0: Float32Array; private c1: Float32Array; // rgb*2
  private a0: Float32Array; private a1: Float32Array;
  private grav: Float32Array; private drag: Float32Array;
  private rot: Float32Array; private spin: Float32Array;
  private soft: Uint8Array;
  private swirl: Float32Array; private scx: Float32Array; private scz: Float32Array;
  // GPU attributes
  private aPos: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aSizeRot: THREE.InstancedBufferAttribute;
  private aSoft: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.s0 = f(); this.s1 = f();
    this.c0 = new Float32Array(capacity * 3); this.c1 = new Float32Array(capacity * 3);
    this.a0 = f(); this.a1 = f(); this.grav = f(); this.drag = f(); this.rot = f(); this.spin = f();
    this.soft = new Uint8Array(capacity);
    this.swirl = f(); this.scx = f(); this.scz = f();

    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSizeRot = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aSoft = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.setAttribute('iSizeRot', this.aSizeRot);
    this.geo.setAttribute('iSoft', this.aSoft);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
    this.mesh.name = additive ? 'particles_add' : 'particles_alpha';
  }

  get live(): number {
    return this.count;
  }

  get capacity(): number {
    return this.cap;
  }

  spawn(p: ParticleSpawn): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx; this.vy[i] = p.vy; this.vz[i] = p.vz;
    this.age[i] = 0; this.life[i] = Math.max(0.01, p.life);
    this.s0[i] = p.size0; this.s1[i] = p.size1;
    this.c0[i * 3] = p.color0.r; this.c0[i * 3 + 1] = p.color0.g; this.c0[i * 3 + 2] = p.color0.b;
    this.c1[i * 3] = p.color1.r; this.c1[i * 3 + 1] = p.color1.g; this.c1[i * 3 + 2] = p.color1.b;
    this.a0[i] = p.alpha0; this.a1[i] = p.alpha1;
    this.grav[i] = p.gravity; this.drag[i] = p.drag;
    this.rot[i] = Math.random() * Math.PI * 2; this.spin[i] = p.spin;
    this.soft[i] = p.soft ? 1 : 0;
    this.swirl[i] = p.swirl ?? 0; this.scx[i] = p.cx ?? p.x; this.scz[i] = p.cz ?? p.z;
  }

  private kill(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    for (let k = 0; k < 3; k++) { this.c0[i * 3 + k] = this.c0[j * 3 + k]; this.c1[i * 3 + k] = this.c1[j * 3 + k]; }
    this.a0[i] = this.a0[j]; this.a1[i] = this.a1[j];
    this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j];
    this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.soft[i] = this.soft[j];
    this.swirl[i] = this.swirl[j]; this.scx[i] = this.scx[j]; this.scz[i] = this.scz[j];
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;
      this.vy[i] -= this.grav[i] * dt;
      if (this.swirl[i] !== 0) {
        const rx = this.px[i] - this.scx[i], rz = this.pz[i] - this.scz[i];
        this.vx[i] += -rz * this.swirl[i] * dt;
        this.vz[i] += rx * this.swirl[i] * dt;
      }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    const pos = this.aPos.array as Float32Array;
    const col = this.aColor.array as Float32Array;
    const sr = this.aSizeRot.array as Float32Array;
    const so = this.aSoft.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const t = this.age[i] / this.life[i];
      pos[i * 3] = this.px[i]; pos[i * 3 + 1] = this.py[i]; pos[i * 3 + 2] = this.pz[i];
      col[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t;
      col[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t;
      col[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t;
      // Fade in quickly, then toward alpha1.
      const fin = Math.min(1, t * 10);
      col[i * 4 + 3] = (this.a0[i] + (this.a1[i] - this.a0[i]) * t) * fin;
      sr[i * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      sr[i * 2 + 1] = this.rot[i];
      so[i] = this.soft[i];
    }
    this.geo.instanceCount = this.count;
    this.aPos.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aSizeRot.needsUpdate = true;
    this.aSoft.needsUpdate = true;
    this.aPos.clearUpdateRanges();
    this.aPos.addUpdateRange(0, this.count * 3);
    this.aColor.clearUpdateRanges();
    this.aColor.addUpdateRange(0, this.count * 4);
    this.aSizeRot.clearUpdateRanges();
    this.aSizeRot.addUpdateRange(0, this.count * 2);
    this.aSoft.clearUpdateRanges();
    this.aSoft.addUpdateRange(0, this.count);
  }

  clear(): void {
    this.count = 0;
    this.geo.instanceCount = 0;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
