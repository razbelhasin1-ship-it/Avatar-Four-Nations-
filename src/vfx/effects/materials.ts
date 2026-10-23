import * as THREE from 'three';
import { getNoiseTexture } from './noise';

/**
 * Shader materials for bending effects. Every factory returns a NEW material
 * (own uniforms) that shares the global time / noise uniforms — the caller owns
 * and must dispose it. Programs are cached by three.js per define set, so
 * creating materials per effect is cheap.
 *
 * UV convention for every bending geometry (see shapes.ts):
 *   uv.y = along the flow (0 = source / base / head, 1 = tip / tail)
 *   uv.x = across / around the flow
 */

/** Global effect clock (seconds) — advanced by the bending runtime each frame. */
export const FX_TIME = { value: 0 };
const FX_NOISE = { value: getNoiseTexture() as THREE.Texture };

export function fxTime(): number {
  return FX_TIME.value;
}

const COMMON_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFres;
uniform float uTime;
uniform float uDisplace;
void main() {
  vUv = uv;
  vec3 pos = position;
  #ifdef DISPLACE
    float d = sin(pos.x * 4.1 + uTime * 6.3) * sin(pos.y * 3.7 - uTime * 7.1) * sin(pos.z * 4.3 + uTime * 5.7);
    d += 0.5 * sin(pos.y * 9.0 + uTime * 11.0 + pos.x * 5.0);
    pos += normal * d * uDisplace;
  #endif
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFres = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

// ---------------------------------------------------------------------------
// Flame
// ---------------------------------------------------------------------------

const FLAME_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uOpacity;
uniform float uIntensity;
uniform float uHeat;
uniform float uSeed;
uniform vec2 uScale;
uniform vec2 uScroll;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
varying vec2 vUv;
varying float vFres;
void main() {
  vec2 uv = vUv * uScale + vec2(uSeed, uSeed * 0.37);
  vec2 s = uScroll * uTime;
  float n1 = texture2D(uNoise, uv + s).r;
  float n2 = texture2D(uNoise, uv * 2.13 + s * 1.7 + 0.5).g;
  float n = n1 * 0.62 + n2 * 0.38;
#ifdef VOLUME
  float base = pow(vFres, 1.2);
#else
  float base = 1.0 - vUv.y;
  #ifdef SHEET
    float across = sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265);
    base *= mix(1.0, across, 0.85);
  #endif
  #ifdef RIMFADE
    base *= 0.35 + 0.65 * vFres;
  #endif
#endif
  float f = base * (0.42 + n * 1.15) + uHeat * 0.3 - 0.06;
  float a = smoothstep(0.1, 0.4, f) * uOpacity;
  if (a < 0.003) discard;
  vec3 col = mix(uEdge, uMid, smoothstep(0.22, 0.6, f));
  col = mix(col, uCore, smoothstep(0.6, 1.05, f));
  gl_FragColor = vec4(col * uIntensity, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export type FlamePalette = 'fire' | 'hot' | 'blue' | 'ember' | 'spirit';

const PALETTES: Record<FlamePalette, [string, string, string]> = {
  fire: ['#fff3c4', '#ffb030', '#e5400c'],
  hot: ['#ffffff', '#ffd75e', '#ff6a12'],
  blue: ['#f2fbff', '#7fc6ff', '#2a5cff'],
  ember: ['#ffd27a', '#ff6a1a', '#a0200a'],
  spirit: ['#ffffff', '#bfe8ff', '#5aa8ff'],
};

export interface FlameOptions {
  /** 'tongue': flame flows along uv.y (streams, rings, trails). 'volume': fresnel-hot centre (balls, explosions). */
  mode?: 'tongue' | 'volume';
  /** Fade across uv.x edges (open sheets / ribbons). */
  sheet?: boolean;
  /** Dim silhouettes of tongue geometry (tubes seen edge-on). */
  rimFade?: boolean;
  palette?: FlamePalette;
  intensity?: number;
  opacity?: number;
  /** Shifts the colour ramp hotter (>0) or cooler (<0). */
  heat?: number;
  scale?: [number, number];
  scroll?: [number, number];
  /** Vertex displacement amount (volume meshes roil). */
  displace?: number;
  seed?: number;
  side?: THREE.Side;
  depthTest?: boolean;
  /** 'add' (glowing, default) or 'normal' (painterly flame that never saturates to white). */
  blend?: 'add' | 'normal';
}

export function flameMaterial(o: FlameOptions = {}): THREE.ShaderMaterial {
  const pal = PALETTES[o.palette ?? 'fire'];
  const defines: Record<string, string> = {};
  if ((o.mode ?? 'tongue') === 'volume') defines.VOLUME = '';
  if (o.sheet) defines.SHEET = '';
  if (o.rimFade) defines.RIMFADE = '';
  if (o.displace) defines.DISPLACE = '';
  return new THREE.ShaderMaterial({
    name: 'bending_flame',
    defines,
    uniforms: {
      uTime: FX_TIME,
      uNoise: FX_NOISE,
      uOpacity: { value: o.opacity ?? 1 },
      uIntensity: { value: o.intensity ?? 1.6 },
      uHeat: { value: o.heat ?? 0 },
      uSeed: { value: o.seed ?? Math.random() * 10 },
      uScale: { value: new THREE.Vector2(...(o.scale ?? [1, 1])) },
      uScroll: { value: new THREE.Vector2(...(o.scroll ?? [0, -1.6])) },
      uDisplace: { value: o.displace ?? 0 },
      uCore: { value: new THREE.Color(pal[0]) },
      uMid: { value: new THREE.Color(pal[1]) },
      uEdge: { value: new THREE.Color(pal[2]) },
    },
    vertexShader: COMMON_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: o.depthTest ?? true,
    blending: o.blend === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending,
    side: o.side ?? THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

const WIND_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uOpacity;
uniform float uSpeed;
uniform float uThreshold;
uniform float uSeed;
uniform float uBody;
uniform vec2 uRepeat;
uniform vec2 uFade;
uniform vec3 uColor;
uniform vec3 uTint;
varying vec2 vUv;
varying float vFres;
void main() {
#ifdef SWAP_UV
  vec2 st = vUv.yx;
#else
  vec2 st = vUv;
#endif
  vec2 p = vec2(st.x * uRepeat.x + uSeed, st.y * uRepeat.y - uTime * uSpeed);
  float n = texture2D(uNoise, vec2(p.x, p.y * 0.2)).b;
  float n2 = texture2D(uNoise, vec2(p.x * 1.9 + 0.31, p.y * 0.33 + 0.7)).r;
  float streak = smoothstep(uThreshold, 1.0, n * 0.75 + n2 * 0.45);
  float edge = 1.0;
#ifndef WRAP_ACROSS
  edge = sin(clamp(st.x, 0.0, 1.0) * 3.14159265);
#endif
#ifndef WRAP_FLOW
  edge *= smoothstep(0.0, uFade.x, st.y) * smoothstep(1.0, 1.0 - uFade.y, st.y);
#endif
#ifdef RIM
  edge *= 0.2 + pow(1.0 - vFres, 1.6) * 1.4;
#endif
  float a = (streak * 0.9 + uBody) * edge * uOpacity;
  if (a < 0.003) discard;
  vec3 col = mix(uTint, uColor, streak);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface WindOptions {
  color?: THREE.ColorRepresentation;
  tint?: THREE.ColorRepresentation;
  opacity?: number;
  /** Flow scroll speed (uv units / s). */
  speed?: number;
  /** Streak repeats [across, along]. */
  repeat?: [number, number];
  /** Higher = sparser, thinner streaks (0.3 .. 0.8). */
  threshold?: number;
  /** Base translucency of the whole shell (0 .. 0.3). */
  body?: number;
  /** Fade lengths at the flow start / end (uv). */
  fade?: [number, number];
  /** Sphere/torus uvs: flow runs along uv.x. */
  swapUV?: boolean;
  wrapAcross?: boolean;
  wrapFlow?: boolean;
  /** Emphasise silhouettes (shells). */
  rim?: boolean;
  additive?: boolean;
  seed?: number;
  depthTest?: boolean;
}

export function windMaterial(o: WindOptions = {}): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (o.swapUV) defines.SWAP_UV = '';
  if (o.wrapAcross) defines.WRAP_ACROSS = '';
  if (o.wrapFlow) defines.WRAP_FLOW = '';
  if (o.rim) defines.RIM = '';
  return new THREE.ShaderMaterial({
    name: 'bending_wind',
    defines,
    uniforms: {
      uTime: FX_TIME,
      uNoise: FX_NOISE,
      uOpacity: { value: o.opacity ?? 0.8 },
      uSpeed: { value: o.speed ?? 1.5 },
      uThreshold: { value: o.threshold ?? 0.5 },
      uSeed: { value: o.seed ?? Math.random() * 10 },
      uBody: { value: o.body ?? 0.08 },
      uRepeat: { value: new THREE.Vector2(...(o.repeat ?? [1, 1])) },
      uFade: { value: new THREE.Vector2(...(o.fade ?? [0.15, 0.3])) },
      uDisplace: { value: 0 },
      uColor: { value: new THREE.Color(o.color ?? '#ffffff') },
      uTint: { value: new THREE.Color(o.tint ?? '#cfe6f5') },
    },
    vertexShader: COMMON_VERT,
    fragmentShader: WIND_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: o.depthTest ?? true,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Lightning (camera-facing quads; uv.x across the bolt, per-vertex intensity)
// ---------------------------------------------------------------------------

const BOLT_VERT = /* glsl */ `
attribute float aI;
varying vec2 vUv;
varying float vI;
void main() {
  vUv = uv;
  vI = aI;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BOLT_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uOpacity;
varying vec2 vUv;
varying float vI;
void main() {
  float d = abs(vUv.x - 0.5) * 2.0;
  float core = smoothstep(0.26, 0.0, d);
  float glow = pow(max(0.0, 1.0 - d), 2.4);
  vec3 col = uGlow * glow * 1.2 + uCore * core * 2.2;
  float a = clamp(glow * 0.8 + core, 0.0, 1.0) * uOpacity * vI;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function boltMaterial(core: THREE.ColorRepresentation = '#ffffff', glow: THREE.ColorRepresentation = '#6fb4ff'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'bending_bolt',
    uniforms: {
      uCore: { value: new THREE.Color(core) },
      uGlow: { value: new THREE.Color(glow) },
      uOpacity: { value: 1 },
    },
    vertexShader: BOLT_VERT,
    fragmentShader: BOLT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Marker beam (seismic sense): vertical gradient, visible through walls
// ---------------------------------------------------------------------------

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
varying float vFres;
void main() {
  float h = vUv.y;
  float band = 0.55 + 0.45 * sin(h * 18.0 - uTime * 6.0);
  float a = (1.0 - h) * (0.35 + 0.65 * pow(1.0 - vFres, 1.5)) * band * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function beamMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'bending_beam',
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uTime: FX_TIME, uDisplace: { value: 0 } },
    vertexShader: COMMON_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Set the fade of any bending material (flame / wind / bolt / beam). */
export function setOpacity(m: THREE.Material, v: number): void {
  const u = (m as THREE.ShaderMaterial).uniforms;
  if (u && u.uOpacity) u.uOpacity.value = v;
  else m.opacity = v;
}
