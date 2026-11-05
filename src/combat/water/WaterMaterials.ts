import * as THREE from 'three';
import { envUniforms, ENV_NOISE_GLSL, ENV_PARS_GLSL } from '../../world/env/EnvShared';
import { attachRippleUniforms, WATER_RIPPLE_GLSL, WATER_SKY_GLSL, WATER_TONES, type WaterTone } from '../../world/env/WaterShared';

/**
 * Shader materials for bent water: a flowing, fresnel-lit liquid that can
 * crossfade into faceted ice (uIce) or a healing glow (uGlow). Every factory
 * returns a NEW material with its own uniforms; the global clock/sun are shared
 * uniform objects advanced by the water FX runtime. Programs are cached by
 * three.js, so per-effect materials are cheap. Callers dispose what they create.
 *
 * Tube UVs: uv.x = around (0..1), uv.y = metres along the flow from the source,
 * so streaks scroll from the source toward the head of the water body.
 */

export const WATER_TIME = { value: 0 };
export const WATER_SUN = { value: new THREE.Vector3(0.35, 0.85, 0.25).normalize() };

const NOISE = /* glsl */ `
float wh21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh21(i), wh21(i + vec2(1.0, 0.0)), u.x), mix(wh21(i + vec2(0.0, 1.0)), wh21(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

const STREAM_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWP;
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 lp = vec4(position, 1.0);
  vec3 ln = normal;
  #ifdef USE_INSTANCING
  // Droplets are one InstancedMesh: each bead has its own matrix.
  lp = instanceMatrix * lp;
  ln = mat3(instanceMatrix) * ln;
  #endif
  vec4 wp = modelMatrix * lp;
  vWP = wp.xyz;
  // Normalised in the fragment shader (safely: a zero normal must never become NaN).
  vN = mat3(modelMatrix) * ln;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const STREAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uIce;
uniform float uGlow;
uniform float uFlow;
uniform float uFoam;
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec3 vN;
varying vec3 vWP;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
${WATER_SKY_GLSL}
${NOISE}
void main() {
  // NaN guards: one NaN pixel is smeared over the whole frame by the bloom blur (black flashes on
  // phones), so never normalise a vector that can be zero.
  vec3 V = normalize(cameraPosition - vWP + vec3(0.0, 1e-4, 0.0));
  vec3 N = vN / max(length(vN), 1e-6);
  if (uIce > 0.001) {
    // Faceted ice: the flat triangle normal from screen-space derivatives (uniform branch).
    vec3 cr = cross(dFdx(vWP), dFdy(vWP));
    float cl = length(cr);
    if (cl > 1e-12) {
      vec3 Nf = cr / cl;
      if (dot(Nf, V) < 0.0) Nf = -Nf;
      vec3 Nm = mix(N, Nf, uIce * 0.8);
      N = Nm / max(length(Nm), 1e-6);
    }
  }
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.5);
  float along = vUv.y;
  // Flow streaks scroll from the source toward the head; two octaves.
  float f1 = wnoise(vec2(vUv.x * 7.0, along * 1.5 - uTime * uFlow));
  float f2 = wnoise(vec2(vUv.x * 14.0 + 3.1, along * 3.6 - uTime * uFlow * 1.6));
  float streak = f1 * 0.62 + f2 * 0.38;
  float foam = smoothstep(0.6, 0.8, streak) * uFoam * (0.45 + 0.55 * fres);
  // Light refracted inside the body: bright wavy bands that travel with the flow.
  float cw = wnoise(vec2(vUv.x * 5.0 + along * 0.7, along * 2.2 - uTime * uFlow * 0.8));
  float caust = pow(abs(sin(cw * 6.2832 + along * 3.0 - uTime * uFlow * 1.3)), 10.0) * (1.0 - fres);
  // The body: the source's deep colour in the core, its shallow colour toward the thin silhouette.
  vec3 col = mix(uDeep, uShallow, 0.3 + 0.7 * fres);
  col += (uShallow - uDeep) * 0.35 * (streak - 0.5) * 2.0;
  col += mix(uShallow, vec3(1.0), 0.55) * caust * 0.42;
  col = mix(col, vec3(0.92, 0.98, 1.0), foam * 0.85);
  // Lit like every water surface in the world: the same sun, sky and time of day.
  vec3 L = normalize(uSunDir + vec3(0.0, 1e-4, 0.0));
  float lam = max(dot(N, L), 0.0);
  float day = 0.3 + 0.7 * uDaylight;
  col *= (0.72 + 0.42 * lam) * day;
  // Never muddy in shade: water carries a little of the sky's light.
  col += uShallow * 0.07 * day;
  // Sky reflection with fresnel, darker toward the horizon (walls, banks, trees).
  vec3 R = reflect(-V, N);
  vec3 refl = waterSky(R) * mix(0.55, 1.0, smoothstep(0.0, 0.35, R.y));
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  col = mix(col, refl, clamp(F * 0.85, 0.0, 1.0));
  vec3 LV = L + V;
  vec3 H = LV / max(length(LV), 1e-6);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, mix(260.0, 120.0, uIce));
  float sheen = pow(nh, 12.0);
  // Sun glints flicking along the surface.
  float glint = step(0.93, wnoise(vec2(vUv.x * 40.0, along * 11.0 - uTime * uFlow * 2.0))) * pow(lam, 2.0);
  float sunUp = smoothstep(-0.05, 0.1, uSunDir.y);
  col += uSunColor * sunUp * (spec * 1.4 + sheen * 0.1 + glint * 0.9);
  // Bright rim where the body thins out against the background.
  col += mix(uShallow, vec3(1.0), 0.6) * pow(fres, 3.0) * 0.45 * day;
  vec3 ice = mix(vec3(0.55, 0.76, 0.9), vec3(0.93, 0.98, 1.0), clamp(fres * 1.2 + 0.3 * wnoise(vWP.xz * 2.5 + vWP.y * 1.7), 0.0, 1.0));
  ice *= 0.78 + 0.32 * lam;
  ice *= day;
  ice += uSunColor * sunUp * spec * 0.9;
  col = mix(col, ice, uIce);
  col += uGlow * vec3(0.4, 0.9, 1.0) * (0.45 + 1.2 * fres + foam);
  float a = uOpacity * clamp(0.8 + 0.2 * fres + foam * 0.2 + caust * 0.1 + uIce * 0.2 + uGlow * 0.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface WaterLook {
  opacity?: number;
  ice?: number;
  glow?: number;
  /** Streak scroll speed (m/s-ish). */
  flow?: number;
  foam?: number;
  deep?: THREE.ColorRepresentation;
  shallow?: THREE.ColorRepresentation;
}

export const DEEP = '#0b55a6';
export const SHALLOW = '#5fd2ff';

// ---------------------------------------------------------------------------
// Bent water carries the look of the water it came from: one palette shared by every bent-water
// material (unless a technique sets its own), easing toward the tone of the source the player last
// drew from (WaterLife → setBendTone). Thin, moving water reads a little lighter than the pool it
// left: the core is the source's deep colour lifted toward its shallow colour.
// ---------------------------------------------------------------------------

export const BEND_DEEP = { value: new THREE.Color() };
export const BEND_SHALLOW = { value: new THREE.Color() };
const bendTarget = { deep: new THREE.Color(), shallow: new THREE.Color() };
const _tc = new THREE.Color();
let bendToneNow: WaterTone = 'clear';

function bendColors(tone: WaterTone, deep: THREE.Color, shallow: THREE.Color): void {
  const t = WATER_TONES[tone];
  deep.set(t.deep).lerp(_tc.set(t.shallow), 0.25).multiplyScalar(1.3);
  shallow.set(t.shallow).multiplyScalar(1.1);
}
bendColors('clear', BEND_DEEP.value, BEND_SHALLOW.value);
bendColors('clear', bendTarget.deep, bendTarget.shallow);

/** Bent water takes this tone (eased in over ~1 s by tickBendTone). */
export function setBendTone(tone: WaterTone): void {
  bendToneNow = tone;
  bendColors(tone, bendTarget.deep, bendTarget.shallow);
}

export function bendTone(): WaterTone {
  return bendToneNow;
}

/** Ease the shared bent-water palette toward its tone (water FX runtime, every frame). */
export function tickBendTone(dt: number): void {
  const k = 1 - Math.exp(-dt * 3);
  BEND_DEEP.value.lerp(bendTarget.deep, k);
  BEND_SHALLOW.value.lerp(bendTarget.shallow, k);
}

/** Bind a bent-water material back to the shared (source-tinted) palette. */
export function useBendPalette(m: THREE.ShaderMaterial): void {
  m.uniforms.uDeep = BEND_DEEP;
  m.uniforms.uShallow = BEND_SHALLOW;
}

export function createWaterMaterial(look: WaterLook = {}): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uOpacity: { value: look.opacity ?? 0.9 },
        uIce: { value: look.ice ?? 0 },
        uGlow: { value: look.glow ?? 0 },
        uFlow: { value: look.flow ?? 3 },
        uFoam: { value: look.foam ?? 1 },
        uDeep: { value: new THREE.Color(look.deep ?? DEEP) },
        uShallow: { value: new THREE.Color(look.shallow ?? SHALLOW) },
      },
    ]),
    vertexShader: STREAM_VERT,
    fragmentShader: STREAM_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  // Shared clock / sun (not cloned by UniformsUtils.merge).
  m.uniforms.uTime = WATER_TIME;
  m.uniforms.uSun = WATER_SUN;
  // The world's sun, sky and time of day, shared by reference like every water surface.
  for (const k of Object.keys(envUniforms)) m.uniforms[k] = envUniforms[k];
  // Without its own colours, bent water wears the tone of the source it was drawn from.
  if (look.deep === undefined && look.shallow === undefined) useBendPalette(m);
  return m;
}

export function setLook(m: THREE.ShaderMaterial, look: WaterLook): void {
  const u = m.uniforms;
  if (look.opacity !== undefined) u.uOpacity.value = look.opacity;
  if (look.ice !== undefined) u.uIce.value = look.ice;
  if (look.glow !== undefined) u.uGlow.value = look.glow;
  if (look.flow !== undefined) u.uFlow.value = look.flow;
  if (look.foam !== undefined) u.uFoam.value = look.foam;
  // Own colours never write into the shared palette: give the material its own uniforms first.
  if (look.deep !== undefined) {
    if (u.uDeep === BEND_DEEP) u.uDeep = { value: new THREE.Color() };
    (u.uDeep.value as THREE.Color).set(look.deep);
  }
  if (look.shallow !== undefined) {
    if (u.uShallow === BEND_SHALLOW) u.uShallow = { value: new THREE.Color() };
    (u.uShallow.value as THREE.Color).set(look.shallow);
  }
}

// ---------------------------------------------------------------------------
// Puddles: flat disc with concentric ripples and a soft rim.
// ---------------------------------------------------------------------------

const PUDDLE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWP;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const PUDDLE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uRipple;
uniform float uIce;
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec2 vUv;
varying vec3 vWP;
#include <common>
#include <fog_pars_fragment>
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
${WATER_SKY_GLSL}
${WATER_RIPPLE_GLSL}
${NOISE}
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float edge = wnoise(normalize(d + 1e-4) * 2.3 + vWP.xz * 0.15) * 0.22;
  float mask = smoothstep(1.0, 0.72 - edge, r + edge * 0.5);
  if (mask <= 0.01) discard;
  // The puddle's own settling rings, plus any disturbance and raindrops.
  vec2 g = (d / max(length(d), 1e-3)) * cos(r * 26.0 - uTime * 5.0) * 0.08 * (1.0 - r) * uRipple;
  vec3 rp = waterRipples(vWP.xz);
  vec3 rn = waterRain(vWP.xz, uRainWet);
  g += rp.xy + rn.xy;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWP);
  float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 5.0);
  // A thin film over the ground, tinted by the water it came from, mirroring the sky.
  vec3 body = mix(uShallow, uDeep, 0.4) * (0.3 + 0.7 * uDaylight);
  vec3 R = reflect(-V, n);
  vec3 refl = waterSky(R) * mix(0.5, 1.0, smoothstep(0.0, 0.35, R.y));
  vec3 col = mix(body, refl, clamp(F * 1.1 + 0.25, 0.0, 1.0));
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(n, H), 0.0), 400.0) * 1.4 * smoothstep(-0.05, 0.1, uSunDir.y);
  col = mix(col, vec3(0.85, 0.94, 1.0), uIce);
  gl_FragColor = vec4(col, uOpacity * mask * (0.5 + 0.4 * F));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createPuddleMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 0.8 }, uRipple: { value: 0.3 }, uIce: { value: 0 } }]),
    vertexShader: PUDDLE_VERT,
    fragmentShader: PUDDLE_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.uniforms.uTime = WATER_TIME;
  m.uniforms.uSun = WATER_SUN;
  for (const k of Object.keys(envUniforms)) m.uniforms[k] = envUniforms[k];
  attachRippleUniforms(m);
  useBendPalette(m);
  return m;
}

// ---------------------------------------------------------------------------
// Ice (solid constructs: walls, spikes, shards, encasements).
// ---------------------------------------------------------------------------

let iceMat: THREE.MeshStandardMaterial | null = null;
let iceMatClear: THREE.MeshStandardMaterial | null = null;

/** Shared opaque-ish ice material for constructs (never disposed per construct). */
export function sharedIceMaterial(clear = false): THREE.MeshStandardMaterial {
  if (clear) {
    iceMatClear ??= new THREE.MeshStandardMaterial({ color: '#cdeeff', roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.72, emissive: '#2a6f9a', emissiveIntensity: 0.22, flatShading: true, depthWrite: false });
    return iceMatClear;
  }
  iceMat ??= new THREE.MeshStandardMaterial({ color: '#d8f2ff', roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.9, emissive: '#3b86b8', emissiveIntensity: 0.2, flatShading: true });
  return iceMat;
}
