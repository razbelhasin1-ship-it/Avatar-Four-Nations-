import * as THREE from 'three';
import { FX_TIME } from './effects/materials';
import { getNoiseTexture } from './effects/noise';

/**
 * CPU-simulated, GPU-instanced billboard particles. One draw call per blend
 * mode. Particles are struct-of-arrays for speed; capacity is fixed.
 * Shapes (per particle): hard dot, soft blob, flame tongue (a blob eaten away by
 * rising noise, more ragged as it burns out) and smoke puff (billowing noise edge).
 */

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec3 iSizeRot;
attribute float iKind;
varying vec4 vColor;
varying vec2 vUv;
varying float vKind;
varying float vT;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  vKind = iKind;
  vT = iSizeRot.z;
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
uniform sampler2D uNoise;
uniform float uTime;
varying vec4 vColor;
varying vec2 vUv;
varying float vKind;
varying float vT;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  // Kind in the integer part (0 dot, 1 soft, 2 flame, 3 smoke), a per-particle seed in the fraction.
  float kind = floor(vKind + 0.001);
  float seed = vKind - kind;
  vec3 col = vColor.rgb;
  float a;
  if (kind < 0.5) {
    a = smoothstep(1.0, 0.75, r);
  } else if (kind < 1.5) {
    a = pow(clamp(1.0 - r, 0.0, 1.0), 1.6);
  } else if (kind < 2.5) {
    // Flame tongue: a teardrop (round base, pointed top) frayed by rising, swaying noise.
    // Yellow where it is dense, cooling through orange to red at the ragged tips and as it
    // burns out (fire colours from the ramp; the preset colour only sets the fade).
    vec2 p = d * 2.0;
    float yb = p.y + 0.3;
    vec2 q = vec2(vUv.x * 0.7, vUv.y * 0.45) + vec2(seed * 9.7, seed * 4.3) - vec2(0.0, uTime * 1.3);
    vec2 w = texture2D(uNoise, q * 0.6 + 0.3).rg - 0.5;
    // The upper part sways: the tip wanders like a real tongue of fire.
    p.x += w.x * 0.55 * max(yb + 0.2, 0.0);
    float halfW = 0.6 * (1.0 - smoothstep(-0.4, 1.1, yb) * 0.8);
    float body = 1.0 - length(vec2(p.x / max(halfW, 0.1) * 0.6, yb < 0.0 ? yb / 0.6 : yb / 1.2));
    float n = texture2D(uNoise, q + w * 0.3).r * 0.6 + texture2D(uNoise, q * 2.2 + w * 0.5 + 0.37).g * 0.4;
    float f = body * 1.3 - (1.0 - n) * (0.3 + 0.55 * vT + 0.7 * max(yb, 0.0));
    // Soft edge, and an orange-red (not dark) rim, so tongues never read as outlined stickers.
    a = smoothstep(0.0, 0.32, f);
    float heat = clamp(f * 0.95 - vT * 0.45, 0.0, 1.0);
    col = mix(vec3(0.8, 0.1, 0.0), vec3(1.0, 0.27, 0.02), smoothstep(0.0, 0.25, heat));
    col = mix(col, vec3(1.0, 0.55, 0.06), smoothstep(0.25, 0.6, heat));
    col = mix(col, vec3(1.0, 0.85, 0.4), smoothstep(0.68, 0.95, heat));
  } else {
    // Smoke: a soft puff with a slowly billowing edge.
    vec2 q = vUv * 0.45 + vec2(seed * 7.1, seed * 3.9) - vec2(0.0, uTime * 0.18);
    float n = texture2D(uNoise, q).g * 0.7 + texture2D(uNoise, q * 2.0 + 0.6).r * 0.3;
    float f = (1.0 - r) * 1.3 - (1.0 - n) * 0.65;
    a = smoothstep(0.0, 0.5, f);
    col *= 0.8 + 0.35 * n;
  }
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col, vColor.a * a);
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
  /** Flame tongue / smoke puff sprite instead of a plain dot or blob. */
  shape?: 'flame' | 'smoke';
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
  /** Shape kind (0 dot, 1 soft, 2 flame, 3 smoke) + per-particle seed in the fraction. */
  private kind: Float32Array;
  private swirl: Float32Array; private scx: Float32Array; private scz: Float32Array;
  // GPU attributes
  private aPos: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aSizeRot: THREE.InstancedBufferAttribute;
  private aKind: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.s0 = f(); this.s1 = f();
    this.c0 = new Float32Array(capacity * 3); this.c1 = new Float32Array(capacity * 3);
    this.a0 = f(); this.a1 = f(); this.grav = f(); this.drag = f(); this.rot = f(); this.spin = f();
    this.kind = f();
    this.swirl = f(); this.scx = f(); this.scz = f();

    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSizeRot = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aKind = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.setAttribute('iSizeRot', this.aSizeRot);
    this.geo.setAttribute('iKind', this.aKind);
    this.geo.instanceCount = 0;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uniforms.uNoise = { value: getNoiseTexture() };
    uniforms.uTime = FX_TIME;
    const mat = new THREE.ShaderMaterial({
      uniforms,
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
    // Flames stand upright (they rise); everything else starts at a random angle.
    this.rot[i] = p.shape === 'flame' ? (Math.random() - 0.5) * 0.5 : Math.random() * Math.PI * 2;
    this.spin[i] = p.spin;
    this.kind[i] = p.shape === 'flame' ? 2 + Math.random() * 0.98 : p.shape === 'smoke' ? 3 + Math.random() * 0.98 : p.soft ? 1 : 0;
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
    this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.kind[i] = this.kind[j];
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
    const so = this.aKind.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const t = this.age[i] / this.life[i];
      pos[i * 3] = this.px[i]; pos[i * 3 + 1] = this.py[i]; pos[i * 3 + 2] = this.pz[i];
      col[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t;
      col[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t;
      col[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t;
      // Fade in quickly, then toward alpha1.
      const fin = Math.min(1, t * 10);
      col[i * 4 + 3] = (this.a0[i] + (this.a1[i] - this.a0[i]) * t) * fin;
      sr[i * 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      sr[i * 3 + 1] = this.rot[i];
      sr[i * 3 + 2] = t;
      so[i] = this.kind[i];
    }
    this.geo.instanceCount = this.count;
    this.aPos.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aSizeRot.needsUpdate = true;
    this.aKind.needsUpdate = true;
    this.aPos.clearUpdateRanges();
    this.aPos.addUpdateRange(0, this.count * 3);
    this.aColor.clearUpdateRanges();
    this.aColor.addUpdateRange(0, this.count * 4);
    this.aSizeRot.clearUpdateRanges();
    this.aSizeRot.addUpdateRange(0, this.count * 3);
    this.aKind.clearUpdateRanges();
    this.aKind.addUpdateRange(0, this.count);
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
