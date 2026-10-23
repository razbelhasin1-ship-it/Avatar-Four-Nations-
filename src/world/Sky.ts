import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '../core/MathUtil';
import type { RenderPipeline } from '../render/Renderer';
import { envUniforms } from './env/EnvShared';
import { pfbm, worley } from './env/ProcTex';

/**
 * Sky dome with an atmospheric gradient, sun and moon discs with glow, two
 * drifting cloud layers (lit cumulus + high cirrus) from a tileable noise
 * texture, stars with a milky-way band, and time-of-day lighting that drives
 * the global sun/hemisphere lights, the fog colour and the shared environment
 * uniforms. Region "mood" (weather: cloud cover, tint, fog) blends smoothly.
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
uniform vec3 uMoonDir;
uniform float uTime;
uniform float uCloudCover;
uniform float uOvercast;
uniform float uNight;
uniform vec3 uCloudTint;
uniform vec2 uCloudOffset;
uniform float uHaze;
uniform sampler2D uNoiseTex;
varying vec3 vDir;
float sHash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float cloudField(vec2 uv) {
  float a = texture2D(uNoiseTex, uv * 0.11 + uCloudOffset).r;
  float b = texture2D(uNoiseTex, uv * 0.37 - uCloudOffset * 1.6 + 0.3).g;
  float c = texture2D(uNoiseTex, uv * 1.3 + uCloudOffset * 2.3).r;
  return a * 0.62 + b * 0.3 + c * 0.14;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hh = max(h, 0.0);
  // Atmospheric gradient with a bright hazy band at the horizon.
  vec3 col = mix(uHorizon, uZenith, pow(hh, 0.42));
  col = mix(col, uGround, exp(-hh * 22.0) * 0.75);
  float sd = max(dot(d, uSunDir), 0.0);
  float day = 1.0 - uNight;
  col += uSunColor * (pow(sd, 5.0) * 0.16 + pow(sd, 42.0) * 0.35) * day * (1.0 - uOvercast * 0.7);
  // Sun disc.
  float disc = smoothstep(0.99955, 0.99978, sd);
  col += uSunColor * disc * 7.0 * day * (1.0 - uOvercast * 0.95);
  // Moon disc with halo.
  float md = max(dot(d, uMoonDir), 0.0);
  float moon = smoothstep(0.99935, 0.9996, md);
  col += vec3(0.85, 0.9, 1.0) * (moon * 1.6 + pow(md, 300.0) * 0.25) * uNight * (1.0 - uOvercast * 0.8);
  // Stars & milky way.
  if (uNight > 0.01 && h > -0.02) {
    float th = atan(d.z, d.x);
    float ph = asin(clamp(d.y, -1.0, 1.0));
    vec2 g = vec2(th * 140.0, ph * 140.0);
    vec2 cell = floor(g);
    float r = sHash(cell);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 4.0) + r * 40.0);
    float star = step(0.9965, r) * smoothstep(0.42, 0.0, length(fract(g) - 0.5)) * tw;
    vec3 bandN = normalize(vec3(0.35, 0.55, -0.76));
    float band = exp(-pow(dot(d, bandN) * 5.0, 2.0));
    float mw = band * (0.5 + 0.5 * texture2D(uNoiseTex, vec2(th * 0.6, ph * 1.4)).r);
    col += (vec3(star) * 1.3 + vec3(0.32, 0.36, 0.5) * mw * 0.35) * uNight * smoothstep(0.0, 0.25, h) * (1.0 - uOvercast);
  }
  // Cloud layers projected on a dome-shaped plane.
  if (h > -0.02) {
    vec2 uv = d.xz / (h + 0.12);
    float f = cloudField(uv);
    float cover = clamp(uCloudCover, 0.0, 1.0);
    float dens = smoothstep(1.0 - cover * 0.9 - 0.08, 1.0 - cover * 0.9 + 0.28, f);
    // Fake volumetric light: density toward the sun shadows the cloud body.
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.16;
    float fl = cloudField(uv + toSun);
    float lit = clamp(1.0 - (fl - f) * 3.2, 0.0, 1.0);
    float rim = pow(sd, 8.0) * (1.0 - dens) * 2.0;
    vec3 shadowCol = mix(uZenith * 0.55 + uHorizon * 0.3, vec3(0.42, 0.44, 0.5), 0.5) * mix(1.0, 0.55, uOvercast);
    vec3 litCol = uCloudTint * (uSunColor * 0.5 + uHorizon * 0.55 + 0.12);
    vec3 cloudCol = mix(shadowCol, litCol, lit * (0.55 + 0.45 * (1.0 - uOvercast)));
    cloudCol += uSunColor * (rim * 0.6 + pow(sd, 12.0) * 0.25) * day;
    cloudCol = mix(cloudCol, uHorizon, smoothstep(0.35, 0.0, h) * 0.55);
    cloudCol *= mix(1.0, 0.16, uNight);
    float fade = smoothstep(-0.02, 0.2, h);
    col = mix(col, cloudCol, dens * fade * 0.94);
    // High cirrus streaks.
    vec2 cuv = d.xz / (h + 0.35) * vec2(0.18, 0.7) + uCloudOffset * 0.6;
    float ci = texture2D(uNoiseTex, cuv).g * texture2D(uNoiseTex, cuv * 3.1 + 0.5).r;
    float cirrus = smoothstep(0.25, 0.55, ci) * (0.35 + 0.4 * (1.0 - cover)) * fade * (1.0 - dens);
    col = mix(col, uCloudTint * (uSunColor * 0.4 + uHorizon * 0.7) * mix(1.0, 0.2, uNight), cirrus * 0.45);
  }
  // Weather haze (fog banks, sandstorms, blizzards): the sky melts toward the fog colour, most near the horizon.
  col = mix(col, uGround, uHaze * (1.0 - 0.4 * smoothstep(0.0, 0.9, hh)));
  // Below the horizon blend into the fog colour so distant terrain melts into the sky.
  col = mix(col, uGround, smoothstep(0.03, -0.035, h));
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
  { t: 0, zenith: '#050a1a', horizon: '#18233f', sun: '#8fa4d8', sunI: 0.32, hemiSky: '#2f4068', hemiGround: '#16161e', hemiI: 0.5 },
  { t: 4.6, zenith: '#0b1430', horizon: '#363a62', sun: '#8fa4d8', sunI: 0.28, hemiSky: '#3a4670', hemiGround: '#1c1a22', hemiI: 0.5 },
  { t: 5.6, zenith: '#26386c', horizon: '#ef9e78', sun: '#ffa268', sunI: 0.75, hemiSky: '#9a8fb5', hemiGround: '#4a3a33', hemiI: 0.72 },
  { t: 6.6, zenith: '#4b78c0', horizon: '#ffc797', sun: '#ffc288', sunI: 1.8, hemiSky: '#b9c4e0', hemiGround: '#6b5845', hemiI: 0.95 },
  { t: 8.2, zenith: '#4885d6', horizon: '#d2e2f1', sun: '#ffe6c4', sunI: 2.45, hemiSky: '#c8dcf5', hemiGround: '#6e5c46', hemiI: 1.05 },
  { t: 12, zenith: '#3f7fd6', horizon: '#c6dcf0', sun: '#fff3e0', sunI: 2.85, hemiSky: '#cfe2fa', hemiGround: '#6b5a45', hemiI: 1.15 },
  { t: 16, zenith: '#4580d0', horizon: '#d9e0e6', sun: '#ffe0b4', sunI: 2.55, hemiSky: '#c9d6ea', hemiGround: '#70593f', hemiI: 1.05 },
  { t: 18, zenith: '#4a6db2', horizon: '#ffc183', sun: '#ffb068', sunI: 2.0, hemiSky: '#c0b8c8', hemiGround: '#6e5038', hemiI: 0.92 },
  { t: 19.2, zenith: '#2b386e', horizon: '#ff8d58', sun: '#ff8648', sunI: 1.0, hemiSky: '#8d7898', hemiGround: '#42302a', hemiI: 0.72 },
  { t: 20.4, zenith: '#0f1838', horizon: '#47395f', sun: '#8a98c8', sunI: 0.32, hemiSky: '#34416b', hemiGround: '#1a1a22', hemiI: 0.52 },
  { t: 24, zenith: '#050a1a', horizon: '#18233f', sun: '#8fa4d8', sunI: 0.32, hemiSky: '#2f4068', hemiGround: '#16161e', hemiI: 0.5 },
];

export interface SkyMood {
  /** Multiplies horizon/fog colour. */
  tint: THREE.Color;
  /** 0..1 */
  cloudCover: number;
  /** Fog density multiplier (1 = settings draw distance). */
  fogScale: number;
  cloudTint: THREE.Color;
  /** 0..1 grey overcast (dims sun, flattens light). */
  overcast: number;
}

/** Tileable cloud noise (R = fbm, G = billowy cells), shared by sky, cloud billboards and the cloud sea. */
export function createCloudNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const w = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const f = 0.5 + 0.5 * pfbm(u, v, 4, 5, 501);
      worley(u, v, 6, 777, 0.9, w);
      const cell = 1 - Math.min(1, w.f1 / 0.75);
      worley(u, v, 13, 778, 0.9, w);
      const cell2 = 1 - Math.min(1, w.f1 / 0.75);
      const billow = Math.min(1, Math.max(0, cell * 0.6 + cell2 * 0.3 + 0.25 * pfbm(u, v, 8, 3, 502)));
      const o = (y * size + x) * 4;
      data[o] = Math.round(Math.min(1, Math.max(0, f)) * 255);
      data[o + 1] = Math.round(billow * 255);
      data[o + 2] = Math.round((0.5 + 0.5 * pfbm(u, v, 16, 3, 503)) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export class SkySystem {
  readonly dome: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  readonly noiseTexture: THREE.DataTexture;
  /** Hours [0, 24). */
  timeOfDay = 9.5;
  /** Real seconds per in-game hour (0 = frozen). */
  secondsPerHour = 90;
  readonly sunColor = new THREE.Color();
  readonly horizonColor = new THREE.Color();
  readonly zenithColor = new THREE.Color();
  readonly moonDir = new THREE.Vector3(-0.3, 0.75, -0.4).normalize();
  /** 0 night .. 1 full day. */
  daylight = 1;
  /** Elevation of the sun (sin of angle above horizon, may be negative). */
  sunElevation = 0.5;
  readonly mood: SkyMood = { tint: new THREE.Color(1, 1, 1), cloudCover: 0.45, fogScale: 1, cloudTint: new THREE.Color('#ffffff'), overcast: 0 };
  private readonly targetMood: SkyMood = { tint: new THREE.Color(1, 1, 1), cloudCover: 0.45, fogScale: 1, cloudTint: new THREE.Color('#ffffff'), overcast: 0 };
  /** Cloud drift (UV offset), advanced by wind. */
  readonly cloudOffset = new THREE.Vector2();
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();
  private readonly camDir = new THREE.Vector3();

  constructor(private readonly pipeline: RenderPipeline) {
    this.noiseTexture = createCloudNoiseTexture();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color('#5d6b78') },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uMoonDir: { value: this.moonDir },
        uTime: { value: 0 },
        uCloudCover: { value: 0.45 },
        uOvercast: { value: 0 },
        uNight: { value: 0 },
        uCloudTint: { value: new THREE.Color('#ffffff') },
        uCloudOffset: { value: this.cloudOffset },
        uNoiseTex: { value: this.noiseTexture },
        uHaze: { value: 0 },
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

  setMood(m: Partial<{ tint: THREE.ColorRepresentation; cloudCover: number; fogScale: number; cloudTint: THREE.ColorRepresentation; overcast: number }>): void {
    if (m.tint !== undefined) this.targetMood.tint.set(m.tint);
    if (m.cloudCover !== undefined) this.targetMood.cloudCover = m.cloudCover;
    if (m.fogScale !== undefined) this.targetMood.fogScale = m.fogScale;
    if (m.cloudTint !== undefined) this.targetMood.cloudTint.set(m.cloudTint);
    if (m.overcast !== undefined) this.targetMood.overcast = m.overcast;
  }

  /** Jump the current mood to the target (teleports, loading screens). */
  snapMood(): void {
    this.mood.tint.copy(this.targetMood.tint);
    this.mood.cloudTint.copy(this.targetMood.cloudTint);
    this.mood.cloudCover = this.targetMood.cloudCover;
    this.mood.fogScale = this.targetMood.fogScale;
    this.mood.overcast = this.targetMood.overcast;
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
    const k = 1 - Math.exp(-dt * 0.5);
    this.mood.tint.lerp(this.targetMood.tint, k);
    this.mood.cloudTint.lerp(this.targetMood.cloudTint, k);
    this.mood.cloudCover = lerp(this.mood.cloudCover, this.targetMood.cloudCover, k);
    this.mood.fogScale = lerp(this.mood.fogScale, this.targetMood.fogScale, k);
    this.mood.overcast = lerp(this.mood.overcast, this.targetMood.overcast, k);

    const hour = this.timeOfDay;
    // Sun path: rises in the east (+X), sets in the west, tilted south.
    const ang = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    this.sunElevation = elev;
    const sunDir = this.pipeline.sunDir;
    const trueSun = new THREE.Vector3(Math.cos(ang), elev, 0.35).normalize();
    this.moonDir.set(-trueSun.x * 0.8 + 0.1, Math.max(0.25, -elev * 0.8 + 0.2), -0.45).normalize();
    if (elev > -0.05) {
      sunDir.set(Math.cos(ang), Math.max(0.06, elev), 0.35).normalize();
    } else {
      // Moonlight at night.
      sunDir.copy(this.moonDir);
    }
    const overcast = this.mood.overcast;
    this.sample(hour, 'zenith', this.zenithColor);
    this.sample(hour, 'horizon', this.horizonColor).multiply(this.mood.tint);
    this.sample(hour, 'sun', this.sunColor);
    // Overcast skies turn grey and flat.
    const grey = this.c1.set('#9aa3ad').multiplyScalar(lerp(1, 0.18, clamp01(smoothstep(0.1, -0.15, elev))));
    this.zenithColor.lerp(grey, overcast * 0.75);
    this.horizonColor.lerp(grey.multiply(this.mood.tint), overcast * 0.6);
    const night = clamp01(smoothstep(0.1, -0.15, elev));
    this.daylight = clamp01(smoothstep(-0.12, 0.35, elev));

    const u = this.mat.uniforms;
    u.uZenith.value.copy(this.zenithColor);
    u.uHorizon.value.copy(this.horizonColor);
    u.uSunDir.value.copy(trueSun);
    u.uSunColor.value.copy(this.sunColor).multiplyScalar(elev > -0.08 ? 1 : 0.0);
    u.uTime.value += dt;
    u.uCloudCover.value = this.mood.cloudCover;
    u.uOvercast.value = overcast;
    u.uNight.value = night;
    u.uCloudTint.value.copy(this.mood.cloudTint);

    const p = this.pipeline;
    p.sun.color.copy(this.sunColor);
    p.sun.intensity = this.sampleNum(hour, 'sunI') * (1 - this.mood.cloudCover * 0.25) * (1 - overcast * 0.72);
    this.sample(hour, 'hemiSky', p.hemi.color);
    this.sample(hour, 'hemiGround', p.hemi.groundColor);
    p.hemi.color.lerp(this.c1.set('#b4bcc6').multiplyScalar(lerp(1, 0.3, night)), overcast * 0.5);
    p.hemi.intensity = this.sampleNum(hour, 'hemiI') * (1 + overcast * 0.25);

    // Fog: the horizon colour, warmed toward the sun when looking that way.
    const fog = p.scene.fog as THREE.Fog;
    camera.getWorldDirection(this.camDir);
    const towardSun = Math.max(0, this.camDir.x * trueSun.x + this.camDir.z * trueSun.z) * (1 - night);
    fog.color.copy(this.horizonColor).lerp(this.zenithColor, 0.06).lerp(this.c2.copy(this.sunColor).multiply(this.horizonColor).multiplyScalar(1.4), towardSun * 0.18 * (1 - overcast));
    u.uGround.value.copy(fog.color);
    u.uHaze.value = clamp01((this.mood.fogScale - 1.2) / 4.5) * 0.92;
    fog.far = drawDistance / Math.max(0.3, this.mood.fogScale);
    fog.near = Math.min(fog.far * 0.25, 220 / this.mood.fogScale);

    // Shared environment uniforms.
    const e = envUniforms;
    e.uSunDir.value.copy(sunDir);
    e.uSunColor.value.copy(this.sunColor).multiplyScalar((elev > -0.05 ? 1 : 0.35) * (1 - overcast * 0.6));
    e.uSkyZenith.value.copy(this.zenithColor);
    e.uSkyHorizon.value.copy(this.horizonColor);
    e.uDaylight.value = this.daylight;
    const golden = clamp01(1 - Math.abs(elev - 0.12) / 0.3);
    e.envFogSun.value.set(this.sunColor.r * 1.1, this.sunColor.g * 0.95, this.sunColor.b * 0.8, (0.22 + 0.45 * golden) * (1 - night) * (1 - overcast * 0.8));
    e.envFogSunDir.value.copy(trueSun);

    this.dome.position.copy(camera.position);
  }

  /** Advance cloud drift (called by the weather/wind system). */
  drift(dx: number, dz: number): void {
    this.cloudOffset.x = (this.cloudOffset.x + dx) % 1000;
    this.cloudOffset.y = (this.cloudOffset.y + dz) % 1000;
  }

  dispose(): void {
    this.pipeline.scene.remove(this.dome);
    this.dome.geometry.dispose();
    this.mat.dispose();
    this.noiseTexture.dispose();
  }
}
