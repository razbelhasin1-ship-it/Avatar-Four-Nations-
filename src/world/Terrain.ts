import * as THREE from 'three';
import { createTerrainSample, heightAt, polarSeaFactor, sampleTerrain, seaIceField } from './Heightfield';
import { attachEnvUniforms, ENV_NOISE_GLSL, ENV_PARS_GLSL } from './env/EnvShared';
import { createTerrainTexture, TERRAIN_LAYER_SCALE, terrainLayerMeans } from './env/TerrainTextures';
import { WorldHeightTexture } from './env/WorldHeightTexture';
import { WORLD_HALF } from './WorldLayout';

/**
 * Streams terrain chunks around a focus point with distance-based LOD.
 *
 * Chunk geometry is built by resumable jobs (generators) that are advanced
 * within a per-frame time budget, so streaming never causes long frames.
 * LOD0 chunks keep a small "detail" record (heights, grass coverage, grass
 * tint) that grass and vegetation reuse instead of re-sampling the heightfield.
 *
 * Shading: 12 procedural material layers (texture array) blended per pixel by
 * per-vertex weights with height-based blending, triplanar rock strata on
 * cliffs, bump lighting from the blended height, painted roads from a signed
 * distance field, wet shorelines, underwater absorption with caustics, rain
 * wetness and snow sparkle.
 */

export const CHUNK_SIZE = 64;
export const LOD_SPACING = [2, 4, 8, 16];
const SKIRT_DEPTH = 6;
/** Height of the walkable sea-ice top above the water level. */
export const ICE_TOP = 0.1;

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh;
  ice: THREE.Mesh | null;
  lastUsed: number;
}

interface ChunkJob {
  key: string;
  cx: number;
  cz: number;
  lod: number;
  gen: Generator<void, ChunkBuild, void>;
}

interface ChunkBuild {
  geometry: THREE.BufferGeometry;
  ice: THREE.BufferGeometry | null;
  detail: ChunkDetail | null;
  heights: Float32Array;
  gw: number;
  spacing: number;
}

/** Per-vertex data of a LOD0 chunk kept for grass & vegetation. */
export interface ChunkDetail {
  cx: number;
  cz: number;
  /** (n × n) heights at 2 m spacing. */
  h: Float32Array;
  /** Grass coverage 0..1 (0 on roads, water, rock, snow, sand, steep slopes). */
  grass: Float32Array;
  /** Linear grass tint rgb. */
  tint: Float32Array;
  lastUsed: number;
}

function chunkKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

const TERRAIN_VERT_PARS = /* glsl */ `
attribute vec4 splatA;
attribute vec4 splatB;
attribute vec4 splatC;
attribute vec4 roadInfo;
attribute vec3 tint;
attribute vec3 soil;
attribute vec4 vcol;
attribute float mainLayer;
flat varying float vMainLayer;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec4 vSplatC;
varying vec4 vRoad;
varying vec3 vTint;
varying vec3 vSoil;
varying vec4 vVCol;
varying vec3 vTerrWorld;
`;

const LAYER_TINT = ['vTint * 2.35', 'vSoil', 'vSoil', 'mix(vec3(1.0), vSoil, 0.6)', 'vec3(1.0)', 'vec3(1.0)', 'vSoil', 'vSoil', 'mix(vec3(1.0), vSoil, 0.5)', 'mix(vec3(1.0), vSoil, 0.35)', 'vec3(1.0)', 'vec3(1.0)'];
/** Per-layer roughness (shared with the CPU vertex colour path). */
export const LAYER_ROUGHNESS = [0.92, 0.95, 0.82, 0.94, 0.55, 0.12, 0.96, 0.62, 0.85, 0.78, 0.45, 0.95];

/** Unrolled height-blended splat over the 12 material layers (no arrays/loops: fast on every GPU). */
function splatGLSL(): string {
  let a = '';
  let b = '';
  for (let i = 0; i < 12; i++) {
    const sampler = i === 2 ? `terrTri(2.0, wp, wn, uLayerScale[2], macro)` : `terrPlanar(${i}.0, wp.xz, uLayerScale[${i}], macro)`;
    a += `  vec4 s${i} = vec4(0.0); if (w${i} > 0.012) { s${i} = ${sampler}; mh = max(mh, s${i}.a * 0.4 + w${i}); }\n`;
    const extra = i === 4 ? ' snowW += bb;' : i === 10 ? ' snowW += bb * 0.7;' : i === 5 ? ' iceW += bb;' : '';
    b += `  if (w${i} > 0.012) { float bb = max(s${i}.a * 0.4 + w${i} - (mh - 0.2), 0.0); col += s${i}.rgb * (${LAYER_TINT[i]}) * bb; H += s${i}.a * bb; rough += ${LAYER_ROUGHNESS[i].toFixed(2)} * bb; wsum += bb;${extra} }\n`;
  }
  return a + b;
}

const TERRAIN_FRAG_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTerrainTex;
uniform float uLayerScale[14];
uniform vec3 uRoadCol[4];
uniform float uLayerLum[14];
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec4 vSplatC;
varying vec4 vRoad;
varying vec3 vTint;
varying vec3 vSoil;
varying vec4 vVCol;
flat varying float vMainLayer;
varying vec3 vTerrWorld;
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
float terrH = 0.5;
float terrRough = 0.9;
float terrWet = 0.0;
float terrGloss = 0.0;
float terrSparkle = 0.0;
const mat2 TERR_ROT = mat2(0.8, -0.6, 0.6, 0.8);
vec4 terrPlanar(float layer, vec2 p, float scale, float macro) {
  vec4 a = texture(uTerrainTex, vec3(p / scale, layer));
#if TERRAIN_DETAIL > 1
  float s2 = scale * 4.3;
  vec4 b = texture(uTerrainTex, vec3(TERR_ROT * p / s2 + vec2(0.37, 0.71), layer));
  return mix(a, b, 0.22 + 0.36 * macro);
#else
  return a;
#endif
}
/** Biplanar rock: top projection on gentle slopes, the dominant side projection on cliffs (strata stay horizontal). */
vec4 terrTri(float layer, vec3 p, vec3 n, float scale, float macro) {
  vec3 an = abs(n);
  float top = smoothstep(0.62, 0.86, an.y);
  vec4 c = vec4(0.0);
  if (top > 0.01) c += top * terrPlanar(layer, p.xz, scale, macro);
  if (top < 0.99) {
    float sx = smoothstep(-0.14, 0.14, an.x - an.z);
    vec4 side = vec4(0.0);
    if (sx > 0.01) side += sx * texture(uTerrainTex, vec3(vec2(p.z, -p.y) / scale, layer));
    if (sx < 0.99) side += (1.0 - sx) * texture(uTerrainTex, vec3(vec2(p.x, -p.y) / scale, layer));
    c += (1.0 - top) * side;
  }
  return c;
}
vec3 terrPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
float terrCaustic(vec2 p, float t) {
  float a = sin(p.x * 1.7 + t * 1.1 + sin(p.y * 1.3 - t * 0.8) * 1.4);
  float b = sin(p.y * 1.9 - t * 0.9 + sin(p.x * 1.1 + t * 0.6) * 1.4);
  return pow(clamp(a * b * 0.5 + 0.5, 0.0, 1.0), 6.0);
}
`;

const TERRAIN_COLOR = /* glsl */ `
{
  vec3 wp = vTerrWorld;
  float camDist = length(wp - cameraPosition);
  // vRoad.w < 1: the triangle mixes vertices with and without road data (only
  // happens well outside the road), where the interpolated signed distance is meaningless.
  float roadType = vRoad.w > 0.999 ? floor(vRoad.z + 0.5) : 0.0;
  float lat = abs(vRoad.x);
  float rhalf = vRoad.y;
  float roadW = 0.0;
  vec3 col;
  float H;
  float rough;
  float snowW = 0.0;
  float iceW = 0.0;
#if TERRAIN_DETAIL == 0
  // Low: CPU-blended vertex colour, modulated by the luminance detail of the
  // vertex's dominant material layer (one texture fetch).
  // Dominant material chosen per pixel from the interpolated weights (not a flat
  // per-vertex index), so material borders follow smooth curves instead of
  // triangle-shaped steps; one texture fetch for its luminance detail.
  float lw[9];
  lw[0] = vSplatA.x; lw[1] = vSplatA.y; lw[2] = vSplatA.z; lw[3] = vSplatA.w;
  lw[4] = vSplatB.x; lw[5] = vSplatB.y; lw[6] = vSplatB.z; lw[7] = vSplatB.w; lw[8] = vSplatC.x;
  int ml = 0;
  float best = lw[0];
  for (int i = 1; i < 9; i++) { if (lw[i] > best) { best = lw[i]; ml = i; } }
  if (roadType > 0.5 && abs(vRoad.x) < vRoad.y) ml = roadType < 1.5 ? 1 : roadType < 2.5 ? 9 : roadType < 3.5 ? 10 : 9;
  vec4 dtex = texture(uTerrainTex, vec3(wp.xz / uLayerScale[ml], float(ml)));
  float dl = dot(dtex.rgb, vec3(0.2126, 0.7152, 0.0722));
  float dt = clamp(dl / max(uLayerLum[ml], 0.02), 0.45, 1.7);
  float macroL = texture(uTerrainTex, vec3(wp.xz / uLayerScale[13], 13.0)).r;
  col = vVCol.rgb * mix(1.0, dt, 0.75) * (0.9 + 0.2 * macroL);
  H = dtex.a;
  rough = vVCol.a;
  snowW = clamp(vSplatB.x + vSplatB.y, 0.0, 1.0);
  iceW = vSplatB.y;
  if (roadType > 0.5) {
    float edgeN = (dtex.a - 0.5) * 0.9;
    roadW = 1.0 - smoothstep(rhalf - 0.25, rhalf + 0.25, lat + edgeN);
    vec3 rc = roadType < 1.5 ? uRoadCol[0] : roadType < 2.5 ? uRoadCol[1] : roadType < 3.5 ? uRoadCol[2] : uRoadCol[3];
    col = mix(col, rc * (0.75 + 0.5 * dt), roadW);
    rough = mix(rough, 0.85, roadW);
  }
#else
  vec3 wn = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  vec4 M = texture(uTerrainTex, vec3(wp.xz / uLayerScale[13], 13.0));
  float macro = M.r;
  float macro2 = M.g;
  float w0 = vSplatA.x, w1 = vSplatA.y, w2 = vSplatA.z, w3 = vSplatA.w;
  float w4 = vSplatB.x, w5 = vSplatB.y, w6 = vSplatB.z, w7 = vSplatB.w;
  float w8 = vSplatC.x, w9 = 0.0, w10 = 0.0, w11 = 0.0;
  // Forest floor litter replaces part of the grass/dirt under trees.
  float lit = clamp(vSplatC.y, 0.0, 1.0) * (0.55 + 0.45 * macro2);
  w11 = (w0 + w1 * 0.6) * lit;
  w0 *= 1.0 - lit;
  w1 *= 1.0 - lit * 0.6;
  // Roads from the interpolated signed distance field (crisp at every LOD).
  if (roadType > 0.5) {
    float edgeN = texture(uTerrainTex, vec3(wp.xz / 9.0, 13.0)).b - 0.5;
    bool paved = roadType > 1.5 && roadType < 2.5;
    float soft = paved ? 0.08 : 0.3;
    roadW = 1.0 - smoothstep(rhalf - soft, rhalf + soft, lat + edgeN * (paved ? 0.3 : 1.1));
    float k = 1.0 - roadW;
    w0 *= k; w1 *= k; w2 *= k; w3 *= k; w4 *= k; w5 *= k; w6 *= k; w7 *= k; w8 *= k; w11 *= k;
    if (roadType < 1.5) w1 += roadW;
    else if (roadType < 2.5) w9 += roadW;
    else if (roadType < 3.5) w10 += roadW;
    else w9 += roadW;
  }
  float mh = -1.0;
  col = vec3(0.0);
  H = 0.0;
  rough = 0.0;
  float wsum = 0.0;
${splatGLSL()}
  col /= max(wsum, 1e-4);
  H /= max(wsum, 1e-4);
  rough /= max(wsum, 1e-4);
  snowW /= max(wsum, 1e-4);
  iceW /= max(wsum, 1e-4);
  // Road detailing: ruts on dirt tracks, kerb stones on paved roads.
  if (roadW > 0.01) {
    if (roadType < 1.5 || (roadType > 2.5 && roadType < 3.5)) {
      float rut = exp(-pow((lat - rhalf * 0.42) / 0.32, 2.0));
      col *= 1.0 - 0.22 * rut * roadW;
      H -= 0.15 * rut * roadW;
      float crown = exp(-pow(lat / 0.45, 2.0)) * (roadType < 1.5 ? 1.0 : 0.0);
      col = mix(col, col * vec3(0.92, 1.08, 0.8), crown * 0.5 * roadW);
    } else {
      float kerb = smoothstep(rhalf - 0.75, rhalf - 0.55, lat) * (1.0 - smoothstep(rhalf - 0.05, rhalf + 0.1, lat));
      col *= 1.0 - 0.18 * kerb;
      H += 0.25 * kerb;
      if (roadType > 3.5) col *= 1.12;
    }
  }
  // Large-scale painterly variation so wide areas never look flat.
  col *= 0.88 + 0.24 * macro;
  col *= mix(vec3(1.0), vec3(1.06, 1.02, 0.9), smoothstep(0.55, 0.85, macro2) * 0.6 * w0);
#endif

  // Wet shorelines & rain wetness; underwater absorption.
  float waterRel = vSplatC.z;
  float kind = floor(vSplatC.w + 0.5);
  float shoreWet = waterRel > 0.0 ? smoothstep(0.9, 0.0, waterRel) : 1.0;
  if (kind > 4.5) shoreWet *= 0.3;
  float rainWet = uRainWet * (1.0 - snowW) * (0.55 + 0.45 * smoothstep(0.6, 0.2, H));
  terrWet = clamp(max(shoreWet * (1.0 - snowW * 0.8), rainWet), 0.0, 1.0);
  col *= mix(1.0, 0.6, terrWet);
  rough = mix(rough, 0.16, terrWet * 0.9);
  terrGloss = max(terrWet * 0.65, iceW * 0.9);
  if (waterRel < 0.0) {
    float depth = -waterRel;
    vec3 absorb = kind < 0.5 ? vec3(0.02, 0.16, 0.2) : kind < 1.5 ? vec3(0.05, 0.17, 0.15) : kind < 2.5 ? vec3(0.03, 0.15, 0.18) : kind < 3.5 ? vec3(0.08, 0.09, 0.04) : kind < 4.5 ? vec3(0.1, 0.32, 0.32) : vec3(0.03, 0.12, 0.18);
    col = mix(col, absorb, (1.0 - exp(-depth * 0.32)) * 0.85);
#if TERRAIN_DETAIL > 0
    if (depth < 6.0) {
      float caus = terrCaustic(wp.xz * 0.9, uEnvTime) * smoothstep(6.0, 0.4, depth) * smoothstep(0.0, 0.3, depth) * uDaylight;
      col += uSunColor * caus * 0.22 * (kind > 2.5 && kind < 3.5 ? 0.2 : 1.0);
    }
#endif
  }
#if TERRAIN_DETAIL > 0
  // Lapping foam line where the sea or a lake meets the shore.
  if (abs(waterRel) < 1.3 && (kind < 0.5 || (kind > 1.5 && kind < 2.5))) {
    float d = -waterRel;
    float lap = sin(uEnvTime * 1.15 + macro * 25.0) * 0.14;
    float line = smoothstep(0.22, 0.0, abs(d - 0.06 + lap)) * smoothstep(1.2, 0.0, abs(waterRel));
    float ft = smoothstep(0.3, 0.75, envNoise(wp.xz * 2.4 + vec2(uEnvTime * 0.21, -uEnvTime * 0.13)));
    col = mix(col, vec3(0.88, 0.93, 0.95), line * ft * 0.8);
  }
  // Snow & ice sparkle (view dependent glints).
  if (snowW + iceW > 0.05 && camDist < 60.0) {
    vec3 vd = normalize(wp - cameraPosition);
    float g = envHash(floor(wp.xz * 26.0) + floor(vd.xz * 9.0) * 17.0);
    terrSparkle = step(0.985, g) * (snowW + iceW * 0.6) * smoothstep(60.0, 5.0, camDist);
  }
#endif
  terrH = H;
  terrRough = rough;
  diffuseColor.rgb = col;
}
`;

const TERRAIN_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
#if TERRAIN_DETAIL > 0
{
  float camDistN = length(vTerrWorld - cameraPosition);
  float bump = 1.4 * smoothstep(140.0, 8.0, camDistN);
  if (bump > 0.001) {
    vec2 dHdxy = vec2(dFdx(terrH), dFdy(terrH)) * bump;
    normal = terrPerturb(-vViewPosition, normal, dHdxy, faceDirection);
  }
}
#endif
`;

const TERRAIN_OUTPUT = /* glsl */ `
#if TERRAIN_DETAIL > 0
if (terrGloss > 0.02 || terrSparkle > 0.0) {
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 vdir = normalize(vTerrWorld - cameraPosition);
  vec3 rdir = reflect(vdir, wN);
  float fres = pow(1.0 - max(dot(-vdir, wN), 0.0), 4.0);
  outgoingLight += envSkyColor(rdir) * terrGloss * (0.06 + 0.6 * fres) * uDaylight;
  outgoingLight += uSunColor * terrSparkle * 1.6 * max(uDaylight, 0.15);
}
#endif
#include <opaque_fragment>
`;

export interface TerrainMaterialOptions {
  detail: number;
  anisotropy: number;
}

/** Shared terrain material with the splat shader injected into MeshStandardMaterial. */
export function createTerrainMaterial(opts: TerrainMaterialOptions = { detail: 1, anisotropy: 4 }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: false });
  const tex = createTerrainTexture(opts.anisotropy);
  const m = terrainLayerMeans();
  const mc = (l: number, k = 1) => new THREE.Vector3(m[l * 3] * k, m[l * 3 + 1] * k, m[l * 3 + 2] * k);
  const uniforms = {
    uTerrainTex: { value: tex },
    uLayerScale: { value: TERRAIN_LAYER_SCALE.slice() },
    uRoadCol: { value: [mc(1, 0.85), mc(9), mc(10), mc(9, 1.12)] },
    uLayerLum: { value: Array.from({ length: 14 }, (_, l) => 0.2126 * m[l * 3] + 0.7152 * m[l * 3 + 1] + 0.0722 * m[l * 3 + 2]) },
  };
  mat.userData.uniforms = uniforms;
  mat.userData.texture = tex;
  mat.defines = { TERRAIN_DETAIL: opts.detail };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    attachEnvUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_VERT_PARS}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSplatA = splatA;
vSplatB = splatB;
vSplatC = splatC;
vRoad = roadInfo;
vTint = tint;
vSoil = soil;
vVCol = vcol;
vMainLayer = mainLayer;
vTerrWorld = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${TERRAIN_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = terrRough;`)
      .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL)
      .replace('#include <opaque_fragment>', TERRAIN_OUTPUT);
  };
  mat.customProgramCacheKey = () => 'terrain-v2-' + opts.detail;
  return mat;
}

/** Sea-ice slab material: snow-dusted pack ice on top, translucent blue edges. */
export function createSeaIceMaterial(terrainTex: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrainTex = { value: terrainTex };
    attachEnvUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIceWorld;\nvarying vec3 vIceNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIceWorld = (modelMatrix * vec4(position, 1.0)).xyz;\nvIceNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uTerrainTex;
varying vec3 vIceWorld;
varying vec3 vIceNormal;
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
float iceRough = 0.4;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 wp = vIceWorld;
  float top = step(0.5, vIceNormal.y);
  vec4 ice = texture(uTerrainTex, vec3(wp.xz / 9.0, 5.0));
  vec4 snow = texture(uTerrainTex, vec3(wp.xz / 7.0, 10.0));
  float dust = smoothstep(0.35, 0.7, envFbm(wp.xz * 0.08)) * 0.85 + 0.1;
  vec3 c = mix(ice.rgb, snow.rgb, dust);
  iceRough = mix(0.14, 0.5, dust);
  // Edges: luminous turquoise fading to deep blue below the waterline.
  vec3 side = mix(vec3(0.16, 0.42, 0.55), vec3(0.62, 0.86, 0.94), smoothstep(-0.45, 0.08, wp.y));
  diffuseColor.rgb = mix(side, c, top);
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = iceRough;');
  };
  mat.customProgramCacheKey = () => 'sea-ice-v1';
  return mat;
}

// ---------------------------------------------------------------------------
// Chunk building (resumable)
// ---------------------------------------------------------------------------

const indexTemplates = new Map<number, Uint16Array>();

function indicesFor(n: number): Uint16Array {
  let t = indexTemplates.get(n);
  if (t) return t;
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // Alternate diagonal for less directional artefacts.
      if ((i + j) & 1) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  // Skirt quads (border order matches the skirt vertex ring).
  const skirtBase = n * n;
  const sides = [
    Array.from({ length: n }, (_, i) => i),
    Array.from({ length: n }, (_, j) => j * n + (n - 1)),
    Array.from({ length: n }, (_, i) => (n - 1) * n + (n - 1 - i)),
    Array.from({ length: n }, (_, j) => (n - 1 - j) * n),
  ];
  let k = 0;
  for (const side of sides) {
    for (let s = 0; s < n - 1; s++) {
      const top0 = side[s], top1 = side[s + 1];
      const bot0 = skirtBase + k + s, bot1 = skirtBase + k + s + 1;
      idx.push(top0, top1, bot0, top1, bot1, bot0);
    }
    k += n;
  }
  t = new Uint16Array(idx);
  indexTemplates.set(n, t);
  return t;
}

const sample = createTerrainSample();
let layerMeans: Float32Array | null = null;

/** Build a chunk; yields periodically so the caller can spread work across frames. */
export function* buildChunkJob(cx: number, cz: number, lod: number, cachedHeights?: { h: Float32Array; gw: number } | null): Generator<void, ChunkBuild, void> {
  const spacing = LOD_SPACING[lod];
  const n = CHUNK_SIZE / spacing + 1;
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const gw = n + 2;
  const hs = new Float32Array(gw * gw);
  // Heights with a 1-sample border (reuse LOD0 cache where grid points coincide).
  const step = spacing / 2;
  for (let j = 0; j < gw; j++) {
    for (let i = 0; i < gw; i++) {
      let h: number | null = null;
      if (cachedHeights) {
        // LOD0 cache covers [-2, 66] at 2 m with gw0 = 35; map our sample.
        const ci = (i - 1) * step + 1, cj = (j - 1) * step + 1;
        if (ci >= 0 && cj >= 0 && ci < cachedHeights.gw && cj < cachedHeights.gw) h = cachedHeights.h[cj * cachedHeights.gw + ci];
      }
      hs[j * gw + i] = h ?? heightAt(x0 + (i - 1) * spacing, z0 + (j - 1) * spacing);
    }
    if ((j & 7) === 7) yield;
  }

  const vCount = n * n + 4 * n;
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const spA = new Float32Array(vCount * 4);
  const spB = new Float32Array(vCount * 4);
  const spC = new Float32Array(vCount * 4);
  const road = new Float32Array(vCount * 4);
  const tint = new Float32Array(vCount * 3);
  const soil = new Float32Array(vCount * 3);
  const vcol = new Float32Array(vCount * 4);
  const mainL = new Float32Array(vCount);
  const lm = layerMeans ?? (layerMeans = terrainLayerMeans());
  const iceF = new Float32Array(n * n);
  const polar = polarSeaFactor(x0 + CHUNK_SIZE / 2, z0 + CHUNK_SIZE / 2) > 0 || polarSeaFactor(x0, z0) > 0 || polarSeaFactor(x0 + CHUNK_SIZE, z0 + CHUNK_SIZE) > 0;
  let anyIce = false;
  const detail: ChunkDetail | null = lod === 0 ? { cx, cz, h: new Float32Array(n * n), grass: new Float32Array(n * n), tint: new Float32Array(n * n * 3), lastUsed: 0 } : null;

  const writeVertex = (vi: number, i: number, j: number) => {
    const h = hs[(j + 1) * gw + (i + 1)];
    const x = i * spacing;
    const z = j * spacing;
    pos[vi * 3] = x;
    pos[vi * 3 + 1] = h;
    pos[vi * 3 + 2] = z;
    const hl = hs[(j + 1) * gw + i];
    const hr = hs[(j + 1) * gw + i + 2];
    const hd = hs[j * gw + i + 1];
    const hu = hs[(j + 2) * gw + i + 1];
    let nx = hl - hr, ny = 2 * spacing, nz = hd - hu;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= l; ny /= l; nz /= l;
    nor[vi * 3] = nx;
    nor[vi * 3 + 1] = ny;
    nor[vi * 3 + 2] = nz;
    // Road info reaches 1.5 grid cells past the margin so that triangles mixing
    // road / no-road vertices always lie outside the road surface (see vRoad.w).
    const s = sampleTerrain(x0 + x, z0 + z, h, 1 - ny, sample, 8 + spacing * 1.5);
    const w = s.w;
    spA[vi * 4] = w[0]; spA[vi * 4 + 1] = w[1]; spA[vi * 4 + 2] = w[2]; spA[vi * 4 + 3] = w[3];
    spB[vi * 4] = w[4]; spB[vi * 4 + 1] = w[5]; spB[vi * 4 + 2] = w[6]; spB[vi * 4 + 3] = w[7];
    spC[vi * 4] = w[8]; spC[vi * 4 + 1] = s.litter; spC[vi * 4 + 2] = s.waterRel; spC[vi * 4 + 3] = s.waterKind;
    road[vi * 4] = s.roadType ? s.roadLat : 99; road[vi * 4 + 1] = s.roadHalf; road[vi * 4 + 2] = s.roadType; road[vi * 4 + 3] = s.roadType ? 1 : 0;
    const tr = srgbToLinear(s.tint[0]), tg = srgbToLinear(s.tint[1]), tb = srgbToLinear(s.tint[2]);
    tint[vi * 3] = tr; tint[vi * 3 + 1] = tg; tint[vi * 3 + 2] = tb;
    soil[vi * 3] = s.soil[0]; soil[vi * 3 + 1] = s.soil[1]; soil[vi * 3 + 2] = s.soil[2];
    {
      // Low-quality path: CPU-blended albedo + roughness from layer means.
      const lit = Math.min(1, Math.max(0, s.litter)) * 0.75;
      const wg = w[0] * (1 - lit), wd = w[1] * (1 - lit * 0.6), wl = (w[0] + w[1] * 0.6) * lit;
      const sr = s.soil[0], sg = s.soil[1], sb = s.soil[2];
      const ws = [wg, wd, w[2], w[3], w[4], w[5], w[6], w[7], w[8], 0, 0, wl];
      let r = 0, g = 0, bl = 0, ro = 0, sum = 0;
      for (let li = 0; li < 12; li++) {
        const k = ws[li];
        if (k <= 0) continue;
        let tr2 = 1, tg2 = 1, tb2 = 1;
        if (li === 0) { tr2 = tr * 2.35; tg2 = tg * 2.35; tb2 = tb * 2.35; }
        else if (li === 1 || li === 2 || li === 6 || li === 7) { tr2 = sr; tg2 = sg; tb2 = sb; }
        else if (li === 3) { tr2 = 1 + (sr - 1) * 0.6; tg2 = 1 + (sg - 1) * 0.6; tb2 = 1 + (sb - 1) * 0.6; }
        else if (li === 8) { tr2 = 1 + (sr - 1) * 0.5; tg2 = 1 + (sg - 1) * 0.5; tb2 = 1 + (sb - 1) * 0.5; }
        r += lm[li * 3] * tr2 * k;
        g += lm[li * 3 + 1] * tg2 * k;
        bl += lm[li * 3 + 2] * tb2 * k;
        ro += LAYER_ROUGHNESS[li] * k;
        sum += k;
      }
      sum = sum || 1;
      let best = 0;
      for (let li = 1; li < 12; li++) if (ws[li] > ws[best]) best = li;
      if (s.roadType && Math.abs(s.roadLat) < s.roadHalf) best = s.roadType === 1 ? 1 : s.roadType === 3 ? 10 : 9;
      mainL[vi] = best;
      vcol[vi * 4] = r / sum; vcol[vi * 4 + 1] = g / sum; vcol[vi * 4 + 2] = bl / sum; vcol[vi * 4 + 3] = ro / sum;
    }
    {
      const gi = j * n + i;
      if (polar && h < 0) {
        const f = seaIceField(x0 + x, z0 + z, h);
        iceF[gi] = f;
        if (f > 0) anyIce = true;
      } else iceF[gi] = -1;
      if (detail) {
        detail.h[gi] = h;
        const onRoad = s.roadType ? 1 - Math.min(1, Math.max(0, (Math.abs(s.roadLat) - s.roadHalf + 0.6) / 1.2)) : 0;
        const steep = Math.min(1, Math.max(0, (ny - 0.78) / 0.12));
        const dry = Math.min(1, Math.max(0, (s.waterRel - 0.05) / 0.3));
        detail.grass[gi] = Math.max(0, Math.min(1, (w[0] - 0.25) / 0.5)) * (1 - onRoad) * steep * dry;
        detail.tint[gi * 3] = tr; detail.tint[gi * 3 + 1] = tg; detail.tint[gi * 3 + 2] = tb;
      }
    }
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) writeVertex(j * n + i, i, j);
    if ((j & 3) === 3) yield;
  }

  // Skirt ring: copies of the border vertices pushed down (same shading data).
  const skirtBase = n * n;
  const skirtDrop = SKIRT_DEPTH * (1 + lod);
  let k = 0;
  const copyVertex = (src: number) => {
    const dst = skirtBase + k++;
    for (let c = 0; c < 3; c++) {
      pos[dst * 3 + c] = pos[src * 3 + c];
      nor[dst * 3 + c] = nor[src * 3 + c];
      tint[dst * 3 + c] = tint[src * 3 + c];
      soil[dst * 3 + c] = soil[src * 3 + c];
    }
    mainL[dst] = mainL[src];
    for (let c = 0; c < 4; c++) {
      vcol[dst * 4 + c] = vcol[src * 4 + c];
      spA[dst * 4 + c] = spA[src * 4 + c];
      spB[dst * 4 + c] = spB[src * 4 + c];
      spC[dst * 4 + c] = spC[src * 4 + c];
      road[dst * 4 + c] = road[src * 4 + c];
    }
    pos[dst * 3 + 1] -= skirtDrop;
  };
  for (let i = 0; i < n; i++) copyVertex(i);
  for (let j = 0; j < n; j++) copyVertex(j * n + n - 1);
  for (let i = n - 1; i >= 0; i--) copyVertex((n - 1) * n + i);
  for (let j = n - 1; j >= 0; j--) copyVertex(j * n);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('splatA', new THREE.BufferAttribute(spA, 4));
  geo.setAttribute('splatB', new THREE.BufferAttribute(spB, 4));
  geo.setAttribute('splatC', new THREE.BufferAttribute(spC, 4));
  geo.setAttribute('roadInfo', new THREE.BufferAttribute(road, 4));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('soil', new THREE.BufferAttribute(soil, 3));
  geo.setAttribute('vcol', new THREE.BufferAttribute(vcol, 4));
  geo.setAttribute('mainLayer', new THREE.BufferAttribute(mainL, 1));
  geo.setIndex(new THREE.BufferAttribute(indicesFor(n).slice(), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const ice = anyIce ? buildIceGeometry(iceF, n, spacing) : null;
  return { geometry: geo, ice, detail, heights: hs, gw, spacing };
}

/**
 * Marching-squares extraction of sea-ice floes from the per-vertex ice field:
 * flat tops at ICE_TOP with short walls so floe edges read as thick slabs.
 */
function buildIceGeometry(f: Float32Array, n: number, s: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const nor: number[] = [];
  const top = ICE_TOP, bottom = -0.55;
  const poly: number[] = [];
  const cross: number[] = [];
  const lerpEdge = (ax: number, az: number, fa: number, bx: number, bz: number, fb: number, out: number[]) => {
    const t = fa / (fa - fb);
    out.push(ax + (bx - ax) * t, az + (bz - az) * t);
  };
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const fa = f[j * n + i], fb = f[j * n + i + 1], fc = f[(j + 1) * n + i + 1], fd = f[(j + 1) * n + i];
      if (fa <= 0 && fb <= 0 && fc <= 0 && fd <= 0) continue;
      const x0 = i * s, z0 = j * s, x1 = x0 + s, z1 = z0 + s;
      const cs: Array<[number, number, number]> = [[x0, z0, fa], [x1, z0, fb], [x1, z1, fc], [x0, z1, fd]];
      poly.length = 0;
      cross.length = 0;
      for (let k = 0; k < 4; k++) {
        const [ax, az, va] = cs[k];
        const [bx, bz, vb] = cs[(k + 1) & 3];
        if (va > 0) poly.push(ax, az);
        if ((va > 0) !== (vb > 0)) {
          lerpEdge(ax, az, va, bx, bz, vb, poly);
          cross.push(poly[poly.length - 2], poly[poly.length - 1]);
        }
      }
      // Top: fan triangulation, reversed so faces point up.
      const m = poly.length / 2;
      for (let k = 1; k < m - 1; k++) {
        pos.push(poly[0], top, poly[1], poly[(k + 1) * 2], top, poly[(k + 1) * 2 + 1], poly[k * 2], top, poly[k * 2 + 1]);
        nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      }
      // Walls along the contour segment(s).
      for (let k = 0; k + 3 < cross.length; k += 4) {
        const ax = cross[k], az = cross[k + 1], bx = cross[k + 2], bz = cross[k + 3];
        let wx = bz - az, wz = -(bx - ax);
        const wl = Math.sqrt(wx * wx + wz * wz) || 1;
        wx /= wl; wz /= wl;
        // Orient outward (towards open water): sample the field gradient direction.
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const gx = ((fb + fc) - (fa + fd)) / 2, gz = ((fc + fd) - (fa + fb)) / 2;
        if (wx * gx + wz * gz > 0) { wx = -wx; wz = -wz; }
        void mx; void mz;
        pos.push(ax, top, az, ax, bottom, az, bx, top, bz, bx, top, bz, ax, bottom, az, bx, bottom, bz);
        for (let q = 0; q < 6; q++) nor.push(wx, 0, wz);
      }
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** Synchronous convenience wrapper (tests, tools). */
export function buildChunkGeometry(cx: number, cz: number, lod: number): THREE.BufferGeometry {
  const job = buildChunkJob(cx, cz, lod);
  let r = job.next();
  while (!r.done) r = job.next();
  r.value.ice?.dispose();
  return r.value.geometry;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class TerrainManager {
  readonly group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  readonly iceMaterial: THREE.MeshStandardMaterial;
  readonly heightTex = new WorldHeightTexture();
  private chunks = new Map<string, Chunk>();
  private jobs = new Map<string, ChunkJob>();
  private details = new Map<string, ChunkDetail & { hb: Float32Array; gw: number }>();
  private frame = 0;
  /** Chunks wanted this frame, sorted by priority. */
  private wanted: Array<{ cx: number; cz: number; lod: number; d: number }> = [];
  drawDistance = 800;
  lodBias = 0;
  castShadows = true;
  /** Monotonic counter bumped whenever a LOD0 detail record is added (grass listens). */
  detailVersion = 0;
  private quality = { detail: 1, anisotropy: 4 };

  constructor() {
    this.group.name = 'terrain';
    this.material = createTerrainMaterial(this.quality);
    this.iceMaterial = createSeaIceMaterial(this.material.userData.texture as THREE.Texture);
  }

  /** Switch shader quality (low preset: single-sample layers, no anisotropy). */
  setQuality(detail: number, anisotropy: number): void {
    if (detail === this.quality.detail && anisotropy === this.quality.anisotropy) return;
    this.quality = { detail, anisotropy };
    this.material.defines = { TERRAIN_DETAIL: detail };
    this.material.customProgramCacheKey = () => 'terrain-v2-' + detail;
    this.material.needsUpdate = true;
    const tex = this.material.userData.texture as THREE.Texture;
    if (tex.anisotropy !== anisotropy) {
      tex.anisotropy = anisotropy;
      tex.needsUpdate = true;
    }
  }

  private lodFor(dist: number): number {
    const b = 1 + this.lodBias * 1.5;
    if (dist < 150 / b) return 0;
    if (dist < 340 / b) return 1;
    if (dist < 700 / b) return 2;
    return 3;
  }

  /**
   * Update streaming around `focus`. Advances chunk jobs within `budgetMs`.
   * Returns number of chunks still pending.
   */
  update(focus: THREE.Vector3, budgetMs = 4): number {
    this.frame++;
    const range = this.drawDistance + CHUNK_SIZE;
    const c0x = Math.floor((focus.x - range) / CHUNK_SIZE);
    const c1x = Math.floor((focus.x + range) / CHUNK_SIZE);
    const c0z = Math.floor((focus.z - range) / CHUNK_SIZE);
    const c1z = Math.floor((focus.z + range) / CHUNK_SIZE);
    const maxC = Math.floor(WORLD_HALF / CHUNK_SIZE);
    this.wanted.length = 0;
    for (let cz = Math.max(-maxC, c0z); cz <= Math.min(maxC - 1, c1z); cz++) {
      for (let cx = Math.max(-maxC, c0x); cx <= Math.min(maxC - 1, c1x); cx++) {
        const mx = (cx + 0.5) * CHUNK_SIZE, mz = (cz + 0.5) * CHUNK_SIZE;
        const d = Math.max(0, Math.hypot(mx - focus.x, mz - focus.z) - CHUNK_SIZE * 0.7);
        if (d > range) continue;
        const lod = this.lodFor(d);
        const key = chunkKey(cx, cz);
        const ch = this.chunks.get(key);
        if (ch) {
          ch.lastUsed = this.frame;
          if (ch.lod !== lod) this.wanted.push({ cx, cz, lod, d });
        } else {
          this.wanted.push({ cx, cz, lod, d });
        }
      }
    }
    this.wanted.sort((a, b) => a.d - b.d);
    // Drop jobs that are no longer wanted (or wanted at a different LOD).
    const wantedKeys = new Map<string, number>();
    for (const w of this.wanted) wantedKeys.set(chunkKey(w.cx, w.cz), w.lod);
    for (const [key, job] of this.jobs) {
      const lod = wantedKeys.get(key);
      if (lod === undefined || lod !== job.lod) this.jobs.delete(key);
    }
    const t0 = performance.now();
    let completed = 0;
    for (const w of this.wanted) {
      if (performance.now() - t0 > budgetMs && completed > 0) break;
      const key = chunkKey(w.cx, w.cz);
      let job = this.jobs.get(key);
      if (!job) {
        const cached = this.details.get(key);
        job = { key, cx: w.cx, cz: w.cz, lod: w.lod, gen: buildChunkJob(w.cx, w.cz, w.lod, cached ? { h: cached.hb, gw: cached.gw } : null) };
        this.jobs.set(key, job);
      }
      let res = job.gen.next();
      while (!res.done && performance.now() - t0 <= budgetMs) res = job.gen.next();
      if (res.done) {
        this.jobs.delete(key);
        this.apply(job, res.value);
        completed++;
      } else break;
    }
    // Evict chunks not used this frame.
    for (const [key, ch] of this.chunks) {
      if (ch.lastUsed !== this.frame) {
        this.group.remove(ch.mesh);
        ch.mesh.geometry.dispose();
        if (ch.ice) {
          this.group.remove(ch.ice);
          ch.ice.geometry.dispose();
        }
        this.chunks.delete(key);
      }
    }
    this.heightTex.flush();
    return Math.max(0, this.wanted.length - completed);
  }

  private apply(job: ChunkJob, b: ChunkBuild): void {
    const key = job.key;
    const x0 = job.cx * CHUNK_SIZE, z0 = job.cz * CHUNK_SIZE;
    this.heightTex.writeChunk(x0, z0, CHUNK_SIZE, b.spacing, b.heights, b.gw);
    if (b.detail) {
      b.detail.lastUsed = this.frame;
      this.details.set(key, Object.assign(b.detail, { hb: b.heights, gw: b.gw }));
      this.detailVersion++;
      if (this.details.size > 220) {
        // Evict least recently used.
        let oldestKey = '';
        let oldest = Infinity;
        for (const [k, d] of this.details) if (d.lastUsed < oldest) { oldest = d.lastUsed; oldestKey = k; }
        this.details.delete(oldestKey);
      }
    }
    const existing = this.chunks.get(key);
    let ch = existing;
    if (existing) {
      existing.mesh.geometry.dispose();
      existing.mesh.geometry = b.geometry;
      existing.lod = job.lod;
      existing.lastUsed = this.frame;
      existing.mesh.castShadow = this.castShadows && job.lod <= 1;
    } else {
      const mesh = new THREE.Mesh(b.geometry, this.material);
      mesh.position.set(x0, 0, z0);
      mesh.receiveShadow = true;
      mesh.castShadow = this.castShadows && job.lod <= 1;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = `terrain_${key}`;
      this.group.add(mesh);
      ch = { cx: job.cx, cz: job.cz, lod: job.lod, mesh, ice: null, lastUsed: this.frame };
      this.chunks.set(key, ch);
    }
    if (ch!.ice) {
      this.group.remove(ch!.ice);
      ch!.ice.geometry.dispose();
      ch!.ice = null;
    }
    if (b.ice) {
      const ice = new THREE.Mesh(b.ice, this.iceMaterial);
      ice.position.set(x0, 0, z0);
      ice.receiveShadow = true;
      ice.castShadow = false;
      ice.matrixAutoUpdate = false;
      ice.updateMatrix();
      ice.name = `seaice_${key}`;
      this.group.add(ice);
      ch!.ice = ice;
    }
  }

  /** LOD0 detail record for the chunk containing (x,z), if built. */
  detailAt(x: number, z: number): ChunkDetail | null {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const d = this.details.get(chunkKey(cx, cz));
    if (d) d.lastUsed = this.frame;
    return d ?? null;
  }

  /** Bilinear height from cached LOD0 data (matches the rendered mesh closely), or the heightfield. */
  heightAt(x: number, z: number): number {
    const d = this.detailAt(x, z);
    if (!d) return heightAt(x, z);
    const n = CHUNK_SIZE / LOD_SPACING[0] + 1;
    const lx = (x - d.cx * CHUNK_SIZE) / LOD_SPACING[0], lz = (z - d.cz * CHUNK_SIZE) / LOD_SPACING[0];
    const i = Math.min(n - 2, Math.max(0, Math.floor(lx))), j = Math.min(n - 2, Math.max(0, Math.floor(lz)));
    const fx = lx - i, fz = lz - j;
    const h = d.h;
    return (h[j * n + i] * (1 - fx) + h[j * n + i + 1] * fx) * (1 - fz) + (h[(j + 1) * n + i] * (1 - fx) + h[(j + 1) * n + i + 1] * fx) * fz;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  get pendingJobs(): number {
    return this.jobs.size;
  }

  dispose(): void {
    for (const ch of this.chunks.values()) {
      this.group.remove(ch.mesh);
      ch.mesh.geometry.dispose();
      if (ch.ice) {
        this.group.remove(ch.ice);
        ch.ice.geometry.dispose();
      }
    }
    this.chunks.clear();
    this.jobs.clear();
    this.details.clear();
    (this.material.userData.texture as THREE.Texture | undefined)?.dispose();
    this.material.dispose();
    this.iceMaterial.dispose();
    this.heightTex.dispose();
  }
}
