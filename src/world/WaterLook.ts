import * as THREE from 'three';
import { envUniforms, ENV_NOISE_GLSL, ENV_PARS_GLSL } from './env/EnvShared';
import { pfbm, worley } from './env/ProcTex';
import { attachRippleUniforms, WATER_LIGHT_GLSL, WATER_RIPPLE_GLSL, WATER_TONES, type WaterTone } from './env/WaterShared';
import { waterTexture } from './Water';

/**
 * Water held in basins and vessels — city fountains, ponds, pools, canals, wells, puddles, jars
 * and barrels — lit exactly like the world's sea and rivers (WaterShared): ripple normals that
 * drift (with the current in canals), sky reflection with fresnel, sharp sun glints, a body colour
 * that deepens away from the rim, moving caustic light seen through it on the basin floor, a thin
 * froth line at the stone, a stirred centre under a fountain's spout, and rings wherever the water
 * is disturbed (drawn from, waded through, rained on).
 *
 * Quality: `waterDetail` (0 low … 1 high) drops the second ripple layer, caustics, rain and
 * sparkles on low-end settings; the water stays animated and reflective everywhere.
 */

/** Shared quality knob for basin/vessel water and bent water (set from the graphics settings). */
export const waterDetail = { value: 1 };

let causticTex: THREE.DataTexture | null = null;

/** Tileable caustic net: bright thin lines along warped Worley cell borders (R channel). */
export function causticTexture(): THREE.DataTexture {
  if (causticTex) return causticTex;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const w = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      // A periodic warp keeps the net organic (and the texture tileable).
      const wu = u + 0.03 * pfbm(u, v, 3, 3, 811), wv = v + 0.03 * pfbm(u, v, 3, 3, 812);
      worley(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1, 6, 9090, 0.95, w);
      const line = Math.exp(-(w.f2 - w.f1) * 17);
      const val = Math.round(Math.min(1, Math.pow(line, 1.2)) * 255);
      const o = (y * S + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = val;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  causticTex = tex;
  return tex;
}

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 lp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  #endif
  vec4 wp = modelMatrix * lp;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

/** Surface wetness (envUniforms.uRainWet) above which rain puddles start to fill: rain, not fog. */
export const RAIN_PUDDLE_WET = 0.45;
const rainPuddles = new Set<THREE.ShaderMaterial>();

/** Rain puddles are not drawn at all while the ground is dry (water life, every frame). */
export function updateRainPuddles(): void {
  const show = envUniforms.uRainWet.value > RAIN_PUDDLE_WET + 0.005;
  for (const m of rainPuddles) m.visible = show;
}

const FRAG = /* glsl */ `
#define RAIN_PUDDLE_WET ${RAIN_PUDDLE_WET.toFixed(3)}
#include <common>
#include <fog_pars_fragment>
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
${WATER_RIPPLE_GLSL}
${WATER_LIGHT_GLSL}
uniform sampler2D uWaterTex;
uniform sampler2D uCaustic;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uAbsorb;
uniform float uDepth;
uniform float uCircle;
uniform vec2 uSize;
uniform float uFountain;
uniform vec2 uFlow;
uniform float uRim;
uniform float uOpacity;
uniform float uReflect;
uniform float uFeather;
uniform float uRainOnly;
uniform float uDetail;
uniform float uScale;
varying vec3 vWorld;
varying vec2 vUv;
float causticAt(vec2 p, float t) {
  vec2 w = vec2(t * 0.045, -t * 0.031);
  float a = texture2D(uCaustic, p * 0.5 + w).r;
  float b = texture2D(uCaustic, p * 0.63 - w * 1.4 + vec2(0.37, 0.11)).r;
  return min(1.5, a * b * 3.0 + max(a, b) * 0.08);
}
void main() {
  vec2 p = vWorld.xz;
  float t = uEnvTime;
  // Distance (m) to the basin's edge: shallow at the stone, full depth further in.
  vec2 c = vUv - 0.5;
  float edge = uCircle > 0.5 ? (0.5 - length(c)) * uSize.x : min((0.5 - abs(c.x)) * uSize.x, (0.5 - abs(c.y)) * uSize.y);
  edge = max(edge, 0.0);
  float depth = uDepth * smoothstep(0.0, 0.5 * uScale, edge) + 0.04;
  // Fine ripples: two layers drifting across each other (and down a canal's current).
  vec2 drift = uFlow * t;
  vec4 n1 = texture2D(uWaterTex, (p - drift) * 0.36 / uScale + vec2(0.013, 0.007) * t);
  vec4 n2 = texture2D(uWaterTex, (p - drift * 1.25) * 1.05 / uScale - vec2(0.021, -0.017) * t);
  // Small, sheltered water (puddles, jars) lies calmer than a basin open to the wind.
  vec2 g = ((n1.rg - 0.5) * 0.4 + (n2.rg - 0.5) * 0.3 * uDetail) * (0.35 + 0.65 * min(uScale, 1.0));
  // A fountain's spout keeps the middle stirred: rings run out from it.
  float centre = length(c) * uSize.x;
  if (uFountain > 0.0) {
    float fall = exp(-centre / max(0.5, uSize.x * 0.2));
    g += (c / max(length(c), 1e-3)) * sin(centre * 7.5 - t * 6.5) * 0.06 * fall * uFountain;
  }
  vec3 rp = waterRipples(p);
  vec3 rn = waterRain(p, uRainWet * uDetail);
  g += rp.xy + rn.xy;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float dk = 1.0 - exp(-depth * uAbsorb * 2.2);
  vec3 body = mix(uShallow, uDeep, dk);
  // Caustics: sunlight focused by the ripples into a dancing net on the floor, seen through the water.
  if (uDetail > 0.05) {
    float cs = causticAt((p + g * 0.8) / uScale, t);
    body += uSunColor * cs * (1.0 - dk) * 0.28 * min(1.0, uScale) * smoothstep(0.0, 0.25, uSunDir.y) * uDetail;
  }
  body *= 0.3 + 0.7 * uDaylight;
  // Sparkle facets that flicker as the ripples move (a hashed cell grid, re-rolled ~6 times a second).
  vec2 sc = floor(p * 9.0 / uScale);
  float sh = fract(sin(dot(sc, vec2(12.9898, 78.233)) + floor(t * 6.0 + fract(sc.x * 0.137) * 6.0)) * 43758.5453);
  float sparkle = step(0.93, sh) * step(0.55, n2.b) * (0.4 + 0.6 * uDetail);
  float fres;
  vec3 col = waterLight(n, V, body, uReflect, sparkle, fres);
  // Froth: a thin lip where water meets stone, ring crests, the churn under a spout.
  float lip = smoothstep(0.06 * uScale, 0.0, edge) * smoothstep(0.35, 0.8, n1.b + 0.25 * sin(t * 1.3 + edge * 30.0)) * uRim;
  float churn = uFountain * exp(-centre / max(0.3, uSize.x * 0.09)) * smoothstep(0.3, 0.75, n2.b + 0.2 * sin(t * 9.0 + centre * 12.0));
  float foam = clamp(lip * 0.45 + churn * 0.85 + rp.z * 0.22 + rn.z * 0.22, 0.0, 1.0);
  vec3 foamCol = vec3(0.93, 0.97, 1.0) * (0.35 + 0.65 * max(uDaylight, 0.12));
  col = mix(col, foamCol, foam);
  // Clear water: shallow water mostly shows its floor, deep water its own colour; the sky at a slant.
  float alpha = mix(0.2, 0.93, dk) + min(1.0, fres * uReflect) * 0.47;
  alpha = clamp(max(alpha, foam) * uOpacity, 0.0, 1.0);
  // Rimless water (puddles) thins out to nothing at its edge.
  if (uFeather > 0.0) alpha *= smoothstep(0.0, uFeather, edge);
  // A rain puddle holds water only while the ground is soaked: it fills from its deepest middle as
  // the rain wets the street and shrinks away as it dries (a damp, foggy day never fills it).
  if (uRainOnly > 0.5) {
    float fill = smoothstep(RAIN_PUDDLE_WET, 0.95, uRainWet);
    float dry = (1.0 - fill) * 0.5 * uSize.x;
    alpha *= smoothstep(dry, dry + max(uFeather, 0.05), edge) * step(0.001, fill);
  }
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface BasinWaterOptions {
  tone?: WaterTone;
  /** Basin depth in metres (deep vessels read dark and opaque). */
  depth?: number;
  circle?: boolean;
  /** Surface size in metres [width, depth] (circle: [diameter, diameter]). */
  size: [number, number];
  /** Spout agitation in the middle (fountains) 0..1. */
  fountain?: number;
  /** Current (m/s, world x/z) for canals. */
  flow?: [number, number];
  /** Froth at the stone lip 0..1. */
  rim?: number;
  opacity?: number;
  /**
   * Sky reflection strength (fresnel multiplier; 0.95 = plain water). Thin puddles over dark mud
   * read as mirrors, so they go higher.
   */
  reflect?: number;
  /** Rimless water: the surface fades out over this many metres from its edge (0 = hard edge). */
  feather?: number;
  /**
   * A rain puddle: no water in dry weather; it fills from the middle while it rains and dries up
   * after (circle surfaces).
   */
  rainOnly?: boolean;
  /** Ripple / caustic scale (1 = city basins; smaller for jars and barrels). */
  scale?: number;
}

/** Basin / vessel water. Every call returns its own material (shared program); callers dispose it. */
export function createBasinWaterMaterial(o: BasinWaterOptions): THREE.ShaderMaterial {
  const tone = WATER_TONES[o.tone ?? 'clear'];
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uShallow: { value: new THREE.Color(tone.shallow) },
        uDeep: { value: new THREE.Color(tone.deep) },
        uAbsorb: { value: tone.absorb },
        uDepth: { value: o.depth ?? 0.6 },
        uCircle: { value: o.circle ? 1 : 0 },
        uSize: { value: new THREE.Vector2(o.size[0], o.size[1]) },
        uFountain: { value: o.fountain ?? 0 },
        uFlow: { value: new THREE.Vector2(o.flow?.[0] ?? 0, o.flow?.[1] ?? 0) },
        uRim: { value: o.rim ?? 1 },
        uOpacity: { value: o.opacity ?? 1 },
        uReflect: { value: o.reflect ?? 0.95 },
        uFeather: { value: o.feather ?? 0 },
        uRainOnly: { value: o.rainOnly ? 1 : 0 },
        uScale: { value: o.scale ?? 1 },
      },
    ]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  // Shared by reference (not cloned): the environment, the ripple field, textures, quality.
  for (const k of Object.keys(envUniforms)) m.uniforms[k] = envUniforms[k];
  attachRippleUniforms(m);
  m.uniforms.uWaterTex = { value: waterTexture() };
  m.uniforms.uCaustic = { value: causticTexture() };
  m.uniforms.uDetail = waterDetail;
  m.name = 'basin_water';
  if (o.rainOnly) {
    rainPuddles.add(m);
    m.addEventListener('dispose', () => rainPuddles.delete(m));
    m.visible = envUniforms.uRainWet.value > RAIN_PUDDLE_WET + 0.005;
  }
  return m;
}
