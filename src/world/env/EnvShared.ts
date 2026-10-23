import * as THREE from 'three';

/**
 * Shared environment state for every world shader (terrain, water, grass,
 * vegetation, clouds, weather, decals): one set of uniform objects referenced
 * by all materials, so the time-of-day, wind, rain wetness and interaction
 * impulses are updated once per frame.
 */

export const MAX_INTERACTORS = 8;
export const MAX_IMPULSES = 8;

export interface EnvUniforms {
  [k: string]: THREE.IUniform;
  uEnvTime: THREE.IUniform<number>;
  /** xy = wind direction (x, z), z = strength 0..1.5, w = gust amount 0..1. */
  uWind: THREE.IUniform<THREE.Vector4>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uSkyZenith: THREE.IUniform<THREE.Color>;
  uSkyHorizon: THREE.IUniform<THREE.Color>;
  /** Overall daylight 0 (night) .. 1 (noon). */
  uDaylight: THREE.IUniform<number>;
  /** Rain-driven surface wetness 0..1. */
  uRainWet: THREE.IUniform<number>;
  /** Grass/foliage interactors: xyz = feet position, w = radius (0 = unused). */
  uInteract: THREE.IUniform<THREE.Vector4[]>;
  /** Impulses: x, z, radius, strength (decays over time). */
  uImpulse: THREE.IUniform<THREE.Vector4[]>;
  /** Fog sun-scatter: rgb colour, a = strength. */
  envFogSun: THREE.IUniform<THREE.Vector4>;
  envFogSunDir: THREE.IUniform<THREE.Vector3>;
  /** World height texture (terrain heights, R channel) for water depth effects. */
  uHeightTex: THREE.IUniform<THREE.Texture | null>;
  /** x = origin x, y = origin z, z = 1 / world size covered, w = height of unfilled texels. */
  uHeightTexInfo: THREE.IUniform<THREE.Vector4>;
}

export const envUniforms: EnvUniforms = {
  uEnvTime: { value: 0 },
  uWind: { value: new THREE.Vector4(0.8, 0.6, 0.35, 0.3) },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uSunColor: { value: new THREE.Color('#fff2dc') },
  uSkyZenith: { value: new THREE.Color('#4f8fdc') },
  uSkyHorizon: { value: new THREE.Color('#c4dcf0') },
  uDaylight: { value: 1 },
  uRainWet: { value: 0 },
  uInteract: { value: Array.from({ length: MAX_INTERACTORS }, () => new THREE.Vector4(0, -9999, 0, 0)) },
  uImpulse: { value: Array.from({ length: MAX_IMPULSES }, () => new THREE.Vector4(0, 0, 0, 0)) },
  envFogSun: { value: new THREE.Vector4(1, 0.8, 0.6, 0) },
  envFogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uHeightTex: { value: null },
  uHeightTexInfo: { value: new THREE.Vector4(-2048, -2048, 1 / 4096, -60) },
};

/** Attach the shared uniforms to a compiled shader (onBeforeCompile helper). */
export function attachEnvUniforms(shader: { uniforms: Record<string, THREE.IUniform> }): void {
  for (const k of Object.keys(envUniforms)) shader.uniforms[k] = envUniforms[k];
}

/** GLSL declarations for the shared uniforms. */
export const ENV_PARS_GLSL = /* glsl */ `
uniform float uEnvTime;
uniform vec4 uWind;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform float uDaylight;
uniform float uRainWet;
uniform vec4 uInteract[${MAX_INTERACTORS}];
uniform vec4 uImpulse[${MAX_IMPULSES}];
uniform sampler2D uHeightTex;
uniform vec4 uHeightTexInfo;
`;

/** Small GLSL noise / helper library shared by environment shaders. */
export const ENV_NOISE_GLSL = /* glsl */ `
float envHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float envHash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float envNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(i), envHash(i + vec2(1.0, 0.0)), u.x), mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float envFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * envNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
/** Terrain height from the world height texture (approximate, 4 m texels). */
float envTerrainHeight(vec2 xz) {
  vec2 uv = (xz - uHeightTexInfo.xy) * uHeightTexInfo.z;
  return texture2D(uHeightTex, uv).r;
}
/** Sky colour in a direction (cheap gradient used for fake reflections). */
vec3 envSkyColor(vec3 dir) {
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyZenith, pow(h, 0.5));
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * (pow(s, 64.0) * 0.6 + pow(s, 6.0) * 0.15);
  return c;
}
/** Wind sway offset (world units) for a point with given height factor 0..1. */
vec3 envWindSway(vec3 wp, float flex, float phase) {
  float t = uEnvTime;
  vec2 dir = uWind.xy;
  float strength = uWind.z;
  float gust = envNoise(wp.xz * 0.02 - dir * t * 0.35) * uWind.w;
  float main = sin(t * 1.7 + phase + dot(wp.xz, dir) * 0.08) * 0.5 + 0.5;
  float flutter = sin(t * 5.3 + phase * 2.3 + wp.x * 0.7 + wp.z * 0.5) * 0.15;
  float amt = flex * strength * (0.35 + 0.65 * main + gust * 1.2) + flex * flutter * strength;
  return vec3(dir.x, 0.0, dir.y) * amt;
}
/** Push-away displacement from interactors and impulses (grass & small plants). */
vec2 envInteractPush(vec3 wp) {
  vec2 push = vec2(0.0);
  for (int i = 0; i < ${MAX_INTERACTORS}; i++) {
    vec4 it = uInteract[i];
    if (it.w <= 0.0) continue;
    vec3 d = wp - it.xyz;
    if (abs(d.y) > 2.5) continue;
    float dl = length(d.xz);
    float k = 1.0 - smoothstep(it.w * 0.25, it.w, dl);
    push += (dl > 1e-3 ? d.xz / dl : vec2(0.0)) * k;
  }
  for (int i = 0; i < ${MAX_IMPULSES}; i++) {
    vec4 im = uImpulse[i];
    if (im.w <= 0.0) continue;
    vec2 d = wp.xz - im.xy;
    float dl = length(d);
    float k = (1.0 - smoothstep(im.z * 0.4, im.z, dl)) * im.w;
    push += (dl > 1e-3 ? d / dl : vec2(0.0)) * k * 1.6;
  }
  return push;
}
`;

/** Screen-space dither in [0,1) (interleaved gradient noise) for sort-free distance fades. */
export const ENV_DITHER_GLSL = /* glsl */ `
float envDither(vec2 fc) {
  return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
}
`;
