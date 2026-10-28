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
  // A slow, coarse field warps the fast detail, so tongues curl and lick instead of sliding.
  vec2 w = texture2D(uNoise, uv * 0.5 + s * 0.35 + vec2(0.17, 0.53)).rg - 0.5;
  vec2 q = uv + w * 0.6;
  float n = texture2D(uNoise, q + s).r * 0.62 + texture2D(uNoise, q * 2.11 + s * 1.85 + 0.5).g * 0.38;
#ifdef VOLUME
  float base = pow(vFres, 1.1);
  float tip = 1.0 - vFres;
#else
  float base = 1.0 - clamp(vUv.y, 0.0, 1.0);
  float tip = 1.0 - base;
  #ifdef SHEET
    float across = sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265);
    base *= mix(1.0, across, 0.85);
    tip = max(tip, 1.0 - across);
  #endif
  #ifdef RIMFADE
    base *= 0.35 + 0.65 * vFres;
  #endif
#endif
  // Fuel minus noise erosion that grows toward the tips: ragged tongues, not a smooth gradient.
  float f = base * 1.35 - (1.0 - n) * (0.22 + tip * 0.7) + uHeat * 0.3;
  float a = smoothstep(0.02, 0.28, f) * uOpacity;
  if (a < 0.003) discard;
  float flick = 0.93 + 0.07 * sin(uTime * 21.0 + uSeed * 4.0 + n * 6.0);
  // Temperature ramp: dim red edges, orange body, yellow, a white-hot core only where it is dense.
  float temp = f * 1.1;
  vec3 col = mix(uEdge * 0.6, uEdge, smoothstep(0.02, 0.2, temp));
  col = mix(col, uMid, smoothstep(0.2, 0.55, temp));
  col = mix(col, uCore, smoothstep(0.7, 1.15, temp));
  gl_FragColor = vec4(col * uIntensity * flick, a);
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
// Flame billboards: a swirling ball of fire, and a comet streak along a direction
// ---------------------------------------------------------------------------

const BALL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Camera-facing quad; the object's scale is the ball's diameter.
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
}`;

const BALL_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uOpacity;
uniform float uIntensity;
uniform float uHeat;
uniform float uSeed;
uniform float uSwirl;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  if (r >= 1.0) discard;
  float ang = atan(d.y, d.x) * 0.15915494;
  // Polar noise: swirls around the centre and streams outward (3 tiles around: no seam).
  vec2 pp = vec2(ang * 3.0 + uTime * uSwirl + uSeed, r * 0.85 - uTime * 1.25 + uSeed * 0.31);
  vec2 w = texture2D(uNoise, pp * 0.5 + 0.21).rg - 0.5;
  float n = texture2D(uNoise, pp + w * 0.45).r * 0.62 + texture2D(uNoise, pp * vec2(2.0, 1.7) + 0.5 + w * 0.6).g * 0.38;
  // Fire rises: the upper half licks further out.
  float lift = max(0.0, d.y) * 1.2 * n;
  float f = (1.0 - r) * 1.55 + lift - (1.0 - n) * (0.18 + r * 0.85) + uHeat * 0.3;
  float a = smoothstep(0.02, 0.26, f) * uOpacity;
  if (a < 0.003) discard;
  float temp = f * 1.05;
  vec3 col = mix(uEdge * 0.6, uEdge, smoothstep(0.02, 0.2, temp));
  col = mix(col, uMid, smoothstep(0.22, 0.55, temp));
  col = mix(col, uCore, smoothstep(0.72, 1.15, temp));
  gl_FragColor = vec4(col * uIntensity, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STREAK_VERT = /* glsl */ `
uniform vec3 uDir;
uniform float uLength;
uniform float uWidth;
varying vec2 vUv;
varying float vFres;
void main() {
  vUv = uv;
  vFres = 1.0;
  // The object's position is the head; the quad turns about uDir to face the camera and
  // trails behind it: a round head and a long tapering tail.
  vec3 head = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 side = cross(uDir, cameraPosition - head);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float along = uv.y;
  float prof = along < 0.12 ? sqrt(along / 0.12) : 1.0 - (along - 0.12) * 0.72;
  vec3 wp = head - uDir * (along * uLength - uWidth * 0.3) + side * (uv.x - 0.5) * uWidth * prof;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

export interface FlameBallOptions {
  palette?: FlamePalette;
  intensity?: number;
  opacity?: number;
  heat?: number;
  /** Swirl speed around the centre (rad-ish / s, signed). */
  swirl?: number;
  seed?: number;
  blend?: 'add' | 'normal';
}

/** Camera-facing swirling ball of fire: use with billboardGeometry(); object scale = diameter. */
export function flameBallMaterial(o: FlameBallOptions = {}): THREE.ShaderMaterial {
  const pal = PALETTES[o.palette ?? 'fire'];
  return new THREE.ShaderMaterial({
    name: 'bending_flame_ball',
    uniforms: {
      uTime: FX_TIME,
      uNoise: FX_NOISE,
      uOpacity: { value: o.opacity ?? 1 },
      uIntensity: { value: o.intensity ?? 1.35 },
      uHeat: { value: o.heat ?? 0 },
      uSeed: { value: o.seed ?? Math.random() * 10 },
      uSwirl: { value: o.swirl ?? 0.35 },
      uCore: { value: new THREE.Color(pal[0]) },
      uMid: { value: new THREE.Color(pal[1]) },
      uEdge: { value: new THREE.Color(pal[2]) },
    },
    vertexShader: BALL_VERT,
    fragmentShader: BALL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: o.blend === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
}

/**
 * Camera-facing comet of flame along `uDir` (set every frame): the head (object position) is
 * hot, the tail breaks into tongues. Use with streakGeometry(); length / width in metres.
 */
export function flameStreakMaterial(o: FlameOptions & { length?: number; width?: number } = {}): THREE.ShaderMaterial {
  const m = flameMaterial({ sheet: true, scroll: [0.15, 2.6], scale: [1, 2.2], ...o });
  m.name = 'bending_flame_streak';
  m.vertexShader = STREAK_VERT;
  m.uniforms.uDir = { value: new THREE.Vector3(0, 0, 1) };
  m.uniforms.uLength = { value: o.length ?? 1 };
  m.uniforms.uWidth = { value: o.width ?? 0.3 };
  return m;
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
