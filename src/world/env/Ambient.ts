import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { biomeWeights, forestFactor, heightAt, type BiomeWeights } from '../Heightfield';
import type { WorldUpdatable } from '../World';
import { attachEnvUniforms, ENV_PARS_GLSL, envUniforms } from './EnvShared';
import { PrecipLayer } from './Weather';

/**
 * Ambient life around the camera: biome-driven drifting particles (sunlit dust
 * motes, meadow pollen, falling forest leaves, swamp spores, diamond-dust ice
 * crystals in the polar cold, rising volcanic embers, fireflies at night) and
 * flocks of birds wheeling overhead (gulls along coasts). Everything animates
 * in shaders; the CPU only blends per-biome amounts. Follows ambientEffects and
 * particleDensity.
 */

type MoteKind = 'dust' | 'pollen' | 'leaves' | 'spores' | 'crystals' | 'embers' | 'fireflies';

const BIRD_VERT = /* glsl */ `
${ENV_PARS_GLSL}
attribute vec4 aFlock; // centre x, centre z, height, radius
attribute vec4 aBird;  // phase, angular speed, lateral offset, size
attribute float aWing; // 0 body, +-1 wing tip, +-0.5 mid wing
uniform float uTime;
uniform float uVisible;
varying float vShade;
#include <common>
#include <fog_pars_vertex>
void main() {
  float ang = aBird.x + uTime * aBird.y;
  float r = aFlock.w + aBird.z;
  vec3 c = vec3( aFlock.x + cos( ang ) * r, aFlock.z + sin( uTime * 0.37 + aBird.x * 3.0 ) * 3.0 + aBird.z * 0.6, aFlock.y + sin( ang ) * r );
  // Heading along the circle (tangent), banking slightly inward.
  vec3 fwd = normalize( vec3( -sin( ang ), 0.0, cos( ang ) ) * sign( aBird.y ) );
  vec3 right = normalize( cross( fwd, vec3( 0.0, 1.0, 0.0 ) ) );
  // Flap, with glides.
  float glide = smoothstep( 0.2, 0.6, sin( uTime * 0.45 + aBird.x * 5.0 ) );
  float flap = sin( uTime * 9.0 + aBird.x * 11.0 ) * mix( 0.85, 0.08, glide );
  vec3 p = position * aBird.w;
  float lift = abs( aWing ) * flap * aBird.w * 0.55;
  vec3 wp = c + right * p.x + fwd * p.z + vec3( 0.0, p.y + lift, 0.0 );
  vShade = 0.6 + 0.4 * abs( aWing );
  vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
  if ( uVisible < 0.5 ) mvPosition = vec4( 0.0, 0.0, 10.0, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BIRD_FRAG = /* glsl */ `
${ENV_PARS_GLSL}
uniform vec3 uColor;
varying float vShade;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec3 light = uSunColor * 0.35 + uSkyHorizon * 0.45;
  gl_FragColor = vec4( uColor * light * vShade, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Simple bird: a slim body and two swept wings (local +Z forward, +X right). */
function birdGeometry(): { pos: number[]; wing: number[]; idx: number[] } {
  const pos: number[] = [];
  const wing: number[] = [];
  const idx: number[] = [];
  const v = (x: number, y: number, z: number, w: number) => {
    pos.push(x, y, z);
    wing.push(w);
    return pos.length / 3 - 1;
  };
  // Body diamond.
  const nose = v(0, 0, 0.45, 0), tail = v(0, 0, -0.5, 0), top = v(0, 0.06, 0, 0), bl = v(-0.07, 0, 0, 0), br = v(0.07, 0, 0, 0);
  idx.push(nose, bl, top, nose, top, br, tail, top, bl, tail, br, top);
  // Wings (two segments each, swept back).
  for (const s of [-1, 1]) {
    const root0 = v(0.06 * s, 0.02, 0.12, 0);
    const root1 = v(0.06 * s, 0.02, -0.12, 0);
    const mid0 = v(0.42 * s, 0.03, 0.06, 0.5 * s);
    const mid1 = v(0.42 * s, 0.03, -0.18, 0.5 * s);
    const tip = v(0.85 * s, 0.02, -0.26, s);
    idx.push(root0, mid0, root1, root1, mid0, mid1, mid0, tip, mid1);
    // Back faces.
    idx.push(root1, mid0, root0, mid1, mid0, root1, mid1, tip, mid0);
  }
  return { pos, wing, idx };
}

class BirdFlocks {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly flock: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly anchors: THREE.Vector3[] = [];
  readonly flocks = 4;
  readonly perFlock = 7;

  constructor(time: { value: number }) {
    const b = birdGeometry();
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    this.geo.setAttribute('aWing', new THREE.Float32BufferAttribute(b.wing, 1));
    this.geo.setIndex(b.idx);
    const n = this.flocks * this.perFlock;
    this.flock = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.flock.setUsage(THREE.DynamicDrawUsage);
    const bird = new Float32Array(n * 4);
    for (let f = 0; f < this.flocks; f++) {
      const dir = f % 2 === 0 ? 1 : -1;
      for (let i = 0; i < this.perFlock; i++) {
        const k = (f * this.perFlock + i) * 4;
        bird[k] = Math.random() * 0.5 + i * 0.09;
        bird[k + 1] = dir * (0.16 + Math.random() * 0.04);
        bird[k + 2] = (Math.random() - 0.5) * 9;
        bird[k + 3] = 0.8 + Math.random() * 0.5;
      }
      this.anchors.push(new THREE.Vector3(Infinity, 0, 0));
    }
    this.geo.setAttribute('aFlock', this.flock);
    this.geo.setAttribute('aBird', new THREE.InstancedBufferAttribute(bird, 4));
    this.geo.instanceCount = n;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: time, uVisible: { value: 1 }, uColor: { value: new THREE.Color('#3a3634') }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: BIRD_VERT,
      fragmentShader: BIRD_FRAG,
      side: THREE.DoubleSide,
      fog: true,
    });
    attachEnvUniforms(this.material);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'birds';
  }

  /** Keep flocks circling within ~250 m of the camera; gulls (white) along coasts. */
  update(cam: THREE.Vector3, visible: boolean, coastal: boolean): void {
    this.material.uniforms.uVisible.value = visible ? 1 : 0;
    this.mesh.visible = visible;
    if (!visible) return;
    this.material.uniforms.uColor.value.set(coastal ? '#e9eef2' : '#3a3634');
    const arr = this.flock.array as Float32Array;
    let dirty = false;
    for (let f = 0; f < this.flocks; f++) {
      const a = this.anchors[f];
      if (Number.isFinite(a.x) && Math.hypot(a.x - cam.x, a.z - cam.z) < 320) continue;
      const ang = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * 190;
      const x = cam.x + Math.cos(ang) * d, z = cam.z + Math.sin(ang) * d;
      const h = Math.max(heightAt(x, z), 0) + 35 + Math.random() * 45;
      a.set(x, h, z);
      const radius = 14 + Math.random() * 22;
      for (let i = 0; i < this.perFlock; i++) {
        const k = (f * this.perFlock + i) * 4;
        arr[k] = x;
        arr[k + 1] = z;
        arr[k + 2] = h;
        arr[k + 3] = radius;
      }
      dirty = true;
    }
    if (dirty) this.flock.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

export class AmbientSystem implements WorldUpdatable {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly motes: Record<MoteKind, PrecipLayer>;
  private readonly amount: Record<MoteKind, number> = { dust: 0, pollen: 0, leaves: 0, spores: 0, crystals: 0, embers: 0, fireflies: 0 };
  private readonly birds: BirdFlocks;
  private readonly b: BiomeWeights = { cold: 0, desert: 0, volcanic: 0, swamp: 0, tropical: 0, boreal: 0, dry: 0 };
  private sampleTimer = 0;
  private forest = 0;
  private coastal = false;
  private on = true;
  private density = 1;
  enabled = true;

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'ambient';
    const t = this.time;
    this.motes = {
      dust: new PrecipLayer({ name: 'dust', count: 420, box: [30, 12, 30], fall: -0.05, windFactor: 0.25, size: [0.035, 0.035], shape: 1, color: '#fff2d6', opacity: 0.55, sway: 0.8 }, t),
      pollen: new PrecipLayer({ name: 'pollen', count: 360, box: [28, 8, 28], fall: 0.04, windFactor: 0.3, size: [0.03, 0.03], shape: 1, color: '#f6efb0', opacity: 0.7, sway: 0.9 }, t),
      leaves: new PrecipLayer({ name: 'leaffall', count: 160, box: [34, 18, 34], fall: -0.9, windFactor: 0.6, size: [0.11, 0.11], shape: 5, color: '#ffffff', opacity: 1, sway: 1.3 }, t),
      spores: new PrecipLayer({ name: 'spores', count: 380, box: [30, 10, 30], fall: 0.08, windFactor: 0.15, size: [0.04, 0.04], shape: 1, color: '#d8f0c0', opacity: 0.6, sway: 0.7 }, t),
      crystals: new PrecipLayer({ name: 'crystals', count: 600, box: [30, 14, 30], fall: -0.25, windFactor: 0.4, size: [0.03, 0.03], shape: 3, color: '#cfe6ff', opacity: 0.55, additive: true, sway: 0.6 }, t),
      embers: new PrecipLayer({ name: 'v_embers', count: 260, box: [32, 18, 32], fall: 0.9, windFactor: 0.4, size: [0.05, 0.05], shape: 3, color: '#ff8a3a', opacity: 0.9, additive: true, sway: 0.8 }, t),
      fireflies: new PrecipLayer({ name: 'fireflies', count: 160, box: [36, 6, 36], fall: 0.0, windFactor: 0.05, size: [0.12, 0.12], shape: 3, color: '#e2ff8a', opacity: 1, additive: true, sway: 1.6 }, t),
    };
    for (const m of Object.values(this.motes)) this.group.add(m.mesh);
    this.birds = new BirdFlocks(t);
    this.group.add(this.birds.mesh);
    ctx.scene.add(this.group);
    this.applySettings();
    ctx.events.on('settings:changed', () => this.applySettings());
  }

  private applySettings(): void {
    const g = this.ctx.settings.data.graphics;
    this.on = g.ambientEffects;
    this.density = Math.max(0, Math.min(1.5, g.particleDensity));
  }

  update(dt: number, ctx: GameContext): void {
    this.time.value += dt;
    const cam = ctx.camera.position;
    const active = this.enabled && this.on && this.density > 0;
    this.group.visible = active;
    if (!active) return;
    // Biome sampling a few times per second (cheap, smooth blending below).
    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = 0.5;
      biomeWeights(cam.x, cam.z, this.b);
      this.forest = forestFactor(cam.x, cam.z, this.b);
      const h = heightAt(cam.x, cam.z);
      this.coastal = h < 12 && this.b.cold < 0.5;
    }
    const b = this.b;
    const sky = ctx.world.sky;
    const day = sky.daylight;
    const night = 1 - Math.min(1, day * 1.6);
    const rain = envUniforms.uRainWet.value;
    const windy = envUniforms.uWind.value.z;
    const calm = 1 - Math.min(1, Math.max(0, (windy - 0.6) / 0.6));
    const dry = 1 - Math.min(1, rain * 1.5);
    const temperate = (1 - b.cold) * (1 - b.desert) * (1 - b.volcanic);
    const high = cam.y > 260 ? 0.3 : 1;
    const target: Record<MoteKind, number> = {
      dust: day * dry * Math.min(1, b.desert + b.dry * 0.7 + 0.15) * (1 - b.cold),
      pollen: day * dry * calm * temperate * (1 - this.forest) * (1 - b.swamp) * 0.9,
      leaves: dry * this.forest * temperate * (1 - b.boreal * 0.7) * (0.6 + windy * 0.5),
      spores: b.swamp * (0.5 + 0.5 * night),
      crystals: b.cold * day * dry * calm * 0.9,
      embers: b.volcanic * 0.9,
      fireflies: night * dry * calm * temperate * Math.min(1, this.forest + b.swamp + b.tropical * 0.6) * high,
    };
    const k = 1 - Math.exp(-dt / 2.5);
    const d = this.density;
    const w = envUniforms.uWind.value;
    const ws = 1 + w.z * 5;
    for (const kind of Object.keys(this.motes) as MoteKind[]) {
      this.amount[kind] += (target[kind] - this.amount[kind]) * k;
      this.motes[kind].update(this.amount[kind], d, w.x * ws, w.y * ws);
    }
    const weatherOk = rain < 0.4 && sky.mood.fogScale < 2.5 && windy < 1.0;
    this.birds.update(cam, day > 0.35 && weatherOk && b.cold < 0.7 && b.volcanic < 0.6 && cam.y < 400, this.coastal);
  }

  state(): Record<MoteKind, number> & { birds: boolean } {
    const out = {} as Record<MoteKind, number> & { birds: boolean };
    for (const k of Object.keys(this.amount) as MoteKind[]) out[k] = +this.amount[k].toFixed(2);
    out.birds = this.birds.mesh.visible;
    return out;
  }

  dispose(): void {
    for (const m of Object.values(this.motes)) m.dispose();
    this.birds.dispose();
    this.group.removeFromParent();
  }
}
