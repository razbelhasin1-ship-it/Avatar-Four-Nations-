import * as THREE from 'three';
import type { WaterSourceType } from '../../core/types';
import { envUniforms } from './EnvShared';

/**
 * What every water surface shares — the sea, rivers, lakes, city fountains and canals, jars and
 * barrels — and the water a bender pulls out of them:
 *
 *  - Tones: one palette per kind of water (clear city water, sea, river, pond, swamp, hot spring,
 *    snow melt…). Surfaces are tinted by their tone, and bent water takes the tone of the source it
 *    was drawn from, so a whip pulled from a fountain looks like the fountain.
 *  - Ripples: expanding rings where something disturbs the water (drawing it, wading, a splash),
 *    shared by every water shader through one uniform array, plus rain rings while it rains.
 *  - WATER_LIGHT_GLSL: the lighting (fresnel sky reflection, sun glints, sub-surface tint) used by
 *    the city/container water and by bent water, matching the world water shader.
 *
 * Leaf module: Water.ts, WaterLook.ts and the waterbending materials import it (never the reverse).
 */

export type WaterTone = 'sea' | 'polar' | 'river' | 'lake' | 'pond' | 'clear' | 'swamp' | 'hot' | 'melt' | 'mud';

export interface ToneDef {
  /** Colour of a thin / shallow layer. */
  shallow: string;
  /** Colour the body saturates to with depth. */
  deep: string;
  /** Light absorption per metre (higher = saturates to `deep` sooner). */
  absorb: number;
}

export const WATER_TONES: Record<WaterTone, ToneDef> = {
  // The world's water (Water.ts) is drawn in these colours too, so water bent out of the sea, a
  // river or a lake is the same water. (absorb is per metre for basins; the world shader keeps
  // its own depth scale.)
  // Open sea: turquoise over sand, navy in depth.
  sea: { shallow: '#3fb7c0', deep: '#0b3d63', absorb: 0.22 },
  // Polar seas (the world shader's cold band near the poles).
  polar: { shallow: '#7badb8', deep: '#26556f', absorb: 0.3 },
  // Rivers and streams: greener, a little silt.
  river: { shallow: '#4c9d92', deep: '#164c58', absorb: 0.5 },
  lake: { shallow: '#46aab4', deep: '#0f4f70', absorb: 0.35 },
  // Garden ponds: green, shaded, leaf-tinted.
  pond: { shallow: '#5ea692', deep: '#17483f', absorb: 0.95 },
  // Fountains, pools, canals, wells, jars: clean, glassy water over stone.
  clear: { shallow: '#5bb6c2', deep: '#0d4a62', absorb: 0.9 },
  swamp: { shallow: '#5d6a37', deep: '#1f2a17', absorb: 1.6 },
  hot: { shallow: '#7fd8cf', deep: '#2b8f96', absorb: 0.7 },
  // Melted snow and ice: nearly colourless, cold blue.
  melt: { shallow: '#c6eef6', deep: '#3d8fb3', absorb: 0.55 },
  // Rain puddles on dirt lanes: a thin film over mud.
  mud: { shallow: '#5a4c3a', deep: '#2b241b', absorb: 3 },
};

/** Whether open sea at (x, z) is the cold polar water (mirrors the world water shader's band). */
export function polarSeaAt(x: number, z: number): boolean {
  return z < -1170 || (z > 1515 && x > -280 && x < 730);
}

/** The tone a bending source carries (its label settles swamp / hot spring / city basins). */
export function toneForSource(type: WaterSourceType | string | null | undefined, label = ''): WaterTone {
  const l = label.toLowerCase();
  if (/swamp|marsh|bog|murky/.test(l)) return 'swamp';
  if (/hot spring|steam/.test(l)) return 'hot';
  if (/mud/.test(l)) return 'mud';
  if (/frozen|thawed|fishing hole|ice hole/.test(l)) return 'polar';
  switch (type) {
    case 'ocean':
      return 'sea';
    case 'river':
    case 'stream':
    case 'waterfall':
      return 'river';
    case 'lake':
      return 'lake';
    case 'pond':
      // Pools, wells and troughs are clean water over stone; garden, palace and paddy ponds are green.
      if (/bath|spa|pool|well|spring|trough|barrel|basin|cistern/.test(l)) return 'clear';
      return /lake|reservoir/.test(l) ? 'lake' : 'pond';
    case 'canal':
      return /irrigation|ditch/.test(l) ? 'river' : 'clear';
    case 'snow':
    case 'ice':
    case 'rain':
    case 'moisture':
      return 'melt';
    case 'fountain':
    case 'puddle':
    case 'flask':
    default:
      return 'clear';
  }
}

// -----------------------------------------------------------------------------
// Ripples
// -----------------------------------------------------------------------------

export const MAX_RIPPLES = 16;

/** Ripple rings: xy = centre (x, z), z = start time (env time), w = strength (0 = unused). */
export const waterRippleUniforms = {
  uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0)) },
};

let head = 0;

/**
 * Something disturbed the water at (x, z): rings spread from it on every water surface there.
 * `strength` ~0.3 for a step, 1 for drawing water, up to 2 for a big splash.
 */
export function addWaterRipple(x: number, z: number, strength = 1): void {
  const r = waterRippleUniforms.uRipples.value[head];
  r.set(x, z, envUniforms.uEnvTime.value, Math.max(0, Math.min(2.5, strength)));
  head = (head + 1) % MAX_RIPPLES;
}

/** Live ripples (tests / debug). */
export function activeWaterRipples(): Array<{ x: number; z: number; age: number; strength: number }> {
  const t = envUniforms.uEnvTime.value;
  return waterRippleUniforms.uRipples.value.filter((r) => r.w > 0 && t - r.z < 3.5).map((r) => ({ x: r.x, z: r.y, age: t - r.z, strength: r.w }));
}

export function clearWaterRipples(): void {
  for (const r of waterRippleUniforms.uRipples.value) r.set(0, 0, -99, 0);
}

/** Attach the ripple uniforms to a material / compiled shader. */
export function attachRippleUniforms(target: { uniforms: Record<string, THREE.IUniform> }): void {
  target.uniforms.uRipples = waterRippleUniforms.uRipples;
}

/**
 * GLSL (needs uEnvTime and uRainWet from ENV_PARS_GLSL). waterRipples(p) / waterRain(p, amount)
 * return xy = surface slope to add to the normal's (x, z) and z = crest brightness.
 */
export const WATER_RIPPLE_GLSL = /* glsl */ `
uniform vec4 uRipples[${MAX_RIPPLES}];
vec3 waterRipples(vec2 p) {
  vec2 g = vec2(0.0);
  float crest = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    float age = uEnvTime - r.z;
    if (age < 0.0 || age > 3.5) continue;
    vec2 d = p - r.xy;
    float dist = length(d);
    // The front spreads at ~1.7 m/s; a short train of rings trails it and fades with age.
    float x = dist - age * 1.7;
    if (x > 0.6 || x < -2.4) continue;
    float env = exp(-x * x * 2.2) * exp(-age * 1.05) * r.w * smoothstep(0.0, 0.12, age);
    float k = 10.0 - min(age, 3.0) * 1.6;
    vec2 dir = d / max(dist, 1e-3);
    g += dir * (-sin(x * k)) * k * 0.014 * env;
    crest += max(0.0, cos(x * k)) * env;
  }
  return vec3(g, crest);
}
vec3 waterRain(vec2 p, float amount) {
  if (amount < 0.02) return vec3(0.0);
  vec2 g = vec2(0.0);
  float c = 0.0;
  vec2 q = p * 1.7;
  vec2 cell = floor(q);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = cell + vec2(float(i), float(j));
      float h = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
      float h2 = fract(h * 17.31 + 0.13);
      if (h2 > amount) continue;
      float period = 0.9 + h * 1.1;
      float age = mod(uEnvTime + h * 9.7, period);
      vec2 d = q - (id + vec2(h, h2));
      float dist = length(d);
      float x = dist - age * 1.1;
      float env = exp(-x * x * 90.0) * (1.0 - age / period);
      g += d / max(dist, 1e-3) * (-sin(x * 38.0)) * 0.05 * env;
      c += env * 0.6;
    }
  }
  return vec3(g, c);
}
`;

/** GLSL (needs ENV_PARS_GLSL): the sky colour a water surface mirrors in direction R. */
export const WATER_SKY_GLSL = /* glsl */ `
vec3 waterSky(vec3 R) {
  // The sky as water mirrors it. The sun itself comes from the glints: mirroring the sky's wide sun
  // halo as well would smear a milky blob across the waves, so only a trace of it is kept.
  float h = clamp(R.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyZenith, pow(h, 0.5));
  float s = max(dot(R, uSunDir), 0.0);
  return c + uSunColor * (pow(s, 64.0) * 0.15 + pow(s, 6.0) * 0.03);
}
`;

/**
 * GLSL (needs ENV_PARS_GLSL + ENV_NOISE_GLSL): the water lighting every surface shares.
 * body = the water's own colour (depth-tinted, daylight applied by the caller); returns the lit
 * colour and writes the fresnel term.
 */
export const WATER_LIGHT_GLSL = /* glsl */ `
${WATER_SKY_GLSL}
vec3 waterLight(vec3 n, vec3 V, vec3 body, float reflK, float glint, out float fres) {
  float ndv = clamp(dot(n, V), 0.0, 1.0);
  fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, n);
  // Sky in the reflection, darker toward the horizon where walls, banks and trees would be.
  vec3 refl = waterSky(R) * mix(0.5, 1.0, smoothstep(0.0, 0.35, R.y));
  vec3 col = mix(body, refl, clamp(fres * reflK, 0.0, 1.0));
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(n, H), 0.0);
  float sunUp = smoothstep(-0.05, 0.1, uSunDir.y);
  col += uSunColor * sunUp * (pow(nh, 900.0) * (1.6 + glint * 2.5) + pow(nh, 90.0) * 0.12);
  // Twinkle: ripple facets catching the sun over a wide area, as real water does in daylight.
  col += uSunColor * sunUp * glint * pow(nh, 22.0) * 0.55;
  return col;
}
`;
