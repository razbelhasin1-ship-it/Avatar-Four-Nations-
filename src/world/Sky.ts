import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '../core/MathUtil';
import type { RenderPipeline } from '../render/Renderer';

/**
 * Sky dome with gradient, sun disc, procedural drifting clouds and stars,
 * plus time-of-day lighting that drives the global sun/hemisphere lights and
 * fog colour. Region "mood" (polar haze, volcanic ash, desert glare) tints it.
 */

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uCloudCover;
uniform float uNight;
uniform vec3 uCloudTint;
varying vec3 vDir;
float sHash(vec2 p){ p = fract(p*vec2(443.897, 441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }
float sNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(sHash(i), sHash(i+vec2(1,0)), u.x), mix(sHash(i+vec2(0,1)), sHash(i+vec2(1,1)), u.x), u.y); }
float sFbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*sNoise(p); p=p*2.02+vec2(1.7,9.2); a*=0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 18.0) * 0.35 + pow(sd, 3.0) * 0.08);
  // Clouds projected on a virtual plane.
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.18) * 1.6 + vec2(uTime * 0.006, uTime * 0.003);
    float c = sFbm(uv * 1.4);
    float c2 = sFbm(uv * 3.1 + 7.0);
    float cover = smoothstep(1.0 - uCloudCover, 1.15 - uCloudCover * 0.6, c * 0.75 + c2 * 0.35);
    float light = 0.75 + 0.35 * dot(normalize(vec3(uv.x, 1.0, uv.y)), uSunDir);
    vec3 cloudCol = mix(uCloudTint * 0.72, uCloudTint * 1.08, clamp(light, 0.0, 1.0));
    cloudCol += uSunColor * pow(sd, 6.0) * 0.4;
    float fade = smoothstep(0.0, 0.25, h);
    col = mix(col, cloudCol, cover * fade * 0.92);
  }
  // Stars
  if (uNight > 0.01 && h > 0.0) {
    vec2 sp = d.xz / (h + 0.3) * 160.0;
    float st = step(0.9965, sHash(floor(sp)));
    col += vec3(st) * uNight * smoothstep(0.0, 0.3, h);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface SkyKey {
  t: number; // hour
  zenith: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
}

const KEYS: SkyKey[] = [
  { t: 0, zenith: '#060b1c', horizon: '#1a2442', sun: '#6a7cb0', sunI: 0.25, hemiSky: '#33456e', hemiGround: '#1a1a22', hemiI: 0.45 },
  { t: 5, zenith: '#1a2346', horizon: '#c98b6a', sun: '#ffb27a', sunI: 0.9, hemiSky: '#8f88a8', hemiGround: '#4a3a33', hemiI: 0.7 },
  { t: 7, zenith: '#5c8fd0', horizon: '#f2c9a0', sun: '#ffd9a8', sunI: 2.1, hemiSky: '#b9cde6', hemiGround: '#6b5a45', hemiI: 1.0 },
  { t: 12, zenith: '#4f8fdc', horizon: '#c4dcf0', sun: '#fff3df', sunI: 2.8, hemiSky: '#cfe4ff', hemiGround: '#6b5a45', hemiI: 1.15 },
  { t: 17, zenith: '#4f84c8', horizon: '#f0c896', sun: '#ffd3a0', sunI: 2.2, hemiSky: '#c4cde0', hemiGround: '#6b5a45', hemiI: 1.0 },
  { t: 19, zenith: '#283766', horizon: '#e88a5c', sun: '#ff9a5a', sunI: 1.0, hemiSky: '#8a7b98', hemiGround: '#40322c', hemiI: 0.7 },
  { t: 21, zenith: '#0b132b', horizon: '#2d2f55', sun: '#7083c0', sunI: 0.35, hemiSky: '#3a4a75', hemiGround: '#1c1c24', hemiI: 0.5 },
  { t: 24, zenith: '#060b1c', horizon: '#1a2442', sun: '#6a7cb0', sunI: 0.25, hemiSky: '#33456e', hemiGround: '#1a1a22', hemiI: 0.45 },
];

export interface SkyMood {
  /** Multiplies horizon/fog colour. */
  tint: THREE.Color;
  /** 0..1 */
  cloudCover: number;
  /** Fog density multiplier (1 = settings draw distance). */
  fogScale: number;
  cloudTint: THREE.Color;
}

export class SkySystem {
  readonly dome: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  /** Hours [0, 24). */
  timeOfDay = 9.5;
  /** Real seconds per in-game hour (0 = frozen). */
  secondsPerHour = 90;
  readonly sunColor = new THREE.Color();
  readonly horizonColor = new THREE.Color();
  readonly zenithColor = new THREE.Color();
  readonly mood: SkyMood = { tint: new THREE.Color(1, 1, 1), cloudCover: 0.45, fogScale: 1, cloudTint: new THREE.Color('#ffffff') };
  private readonly targetMood: SkyMood = { tint: new THREE.Color(1, 1, 1), cloudCover: 0.45, fogScale: 1, cloudTint: new THREE.Color('#ffffff') };
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();

  constructor(private readonly pipeline: RenderPipeline) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color('#5d6b78') },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uTime: { value: 0 },
        uCloudCover: { value: 0.45 },
        uNight: { value: 0 },
        uCloudTint: { value: new THREE.Color('#ffffff') },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), this.mat);
    this.dome.name = 'sky';
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    pipeline.scene.add(this.dome);
  }

  setMood(m: Partial<{ tint: THREE.ColorRepresentation; cloudCover: number; fogScale: number; cloudTint: THREE.ColorRepresentation }>): void {
    if (m.tint !== undefined) this.targetMood.tint.set(m.tint);
    if (m.cloudCover !== undefined) this.targetMood.cloudCover = m.cloudCover;
    if (m.fogScale !== undefined) this.targetMood.fogScale = m.fogScale;
    if (m.cloudTint !== undefined) this.targetMood.cloudTint.set(m.cloudTint);
  }

  private sample(hour: number, key: 'zenith' | 'horizon' | 'sun' | 'hemiSky' | 'hemiGround', out: THREE.Color): THREE.Color {
    for (let i = 0; i < KEYS.length - 1; i++) {
      const a = KEYS[i], b = KEYS[i + 1];
      if (hour >= a.t && hour <= b.t) {
        const t = (hour - a.t) / (b.t - a.t);
        return out.set(a[key]).lerp(this.c2.set(b[key]), t);
      }
    }
    return out.set(KEYS[0][key]);
  }

  private sampleNum(hour: number, key: 'sunI' | 'hemiI'): number {
    for (let i = 0; i < KEYS.length - 1; i++) {
      const a = KEYS[i], b = KEYS[i + 1];
      if (hour >= a.t && hour <= b.t) return lerp(a[key], b[key], (hour - a.t) / (b.t - a.t));
    }
    return KEYS[0][key];
  }

  /** Is it night (for NPC routines, ambience)? */
  get isNight(): boolean {
    return this.timeOfDay < 5.5 || this.timeOfDay > 20.5;
  }

  update(dt: number, camera: THREE.Camera, drawDistance: number): void {
    if (this.secondsPerHour > 0) {
      this.timeOfDay = (this.timeOfDay + dt / this.secondsPerHour) % 24;
    }
    const k = 1 - Math.exp(-dt * 0.6);
    this.mood.tint.lerp(this.targetMood.tint, k);
    this.mood.cloudTint.lerp(this.targetMood.cloudTint, k);
    this.mood.cloudCover = lerp(this.mood.cloudCover, this.targetMood.cloudCover, k);
    this.mood.fogScale = lerp(this.mood.fogScale, this.targetMood.fogScale, k);

    const hour = this.timeOfDay;
    // Sun path: rises in the east (+X), sets in the west, tilted south.
    const ang = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    const sunDir = this.pipeline.sunDir;
    if (elev > -0.05) {
      sunDir.set(Math.cos(ang), Math.max(0.06, elev), 0.35).normalize();
    } else {
      // Moonlight from a fixed high angle at night.
      sunDir.set(-0.3, 0.75, -0.4).normalize();
    }
    this.sample(hour, 'zenith', this.zenithColor);
    this.sample(hour, 'horizon', this.horizonColor).multiply(this.mood.tint);
    this.sample(hour, 'sun', this.sunColor);
    const night = clamp01(smoothstep(0.1, -0.15, elev));

    const u = this.mat.uniforms;
    u.uZenith.value.copy(this.zenithColor);
    u.uHorizon.value.copy(this.horizonColor);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(this.sunColor).multiplyScalar(elev > -0.05 ? 1 : 0.15);
    u.uTime.value += dt;
    u.uCloudCover.value = this.mood.cloudCover;
    u.uNight.value = night;
    u.uCloudTint.value.copy(this.mood.cloudTint).multiplyScalar(lerp(1, 0.25, night));

    const p = this.pipeline;
    p.sun.color.copy(this.sunColor);
    p.sun.intensity = this.sampleNum(hour, 'sunI') * (1 - this.mood.cloudCover * 0.35);
    this.sample(hour, 'hemiSky', p.hemi.color);
    this.sample(hour, 'hemiGround', p.hemi.groundColor);
    p.hemi.intensity = this.sampleNum(hour, 'hemiI');

    const fog = p.scene.fog as THREE.Fog;
    fog.color.copy(this.horizonColor).lerp(this.zenithColor, 0.15);
    fog.far = drawDistance / Math.max(0.3, this.mood.fogScale);
    fog.near = Math.min(fog.far * 0.3, 260 / this.mood.fogScale);

    this.dome.position.copy(camera.position);
  }

  dispose(): void {
    this.pipeline.scene.remove(this.dome);
    this.dome.geometry.dispose();
    this.mat.dispose();
  }
}
