import * as THREE from 'three';
import { PAL, PALETTE_SIZE } from './CharMesh';

/**
 * CharMaterial — the single material every character renders with.
 *
 * A MeshStandardMaterial with shader patches so one draw call can show skin,
 * cloth, hair, eyes, metal and leather:
 *  - colour = palette uniform indexed per vertex (aMat.x); PAL.ATLAS vertices mix the
 *    four cloth colours by a pattern-mask texture (R=trim, G=accent, B=secondary, rest=primary)
 *  - roughness / metalness per vertex (aMat.y / aMat.z)
 *  - procedural Air Nomad tattoos from per-vertex path coordinates (aTat) — crisp at any
 *    distance, style/colour change without rebuilding geometry
 *  - Avatar State glow: eye mask (aMat.w) and tattoo mask emit `uGlowColor`, plus a Fresnel
 *    rim so characters without tattoos still transform
 *  - additive hit flash
 *
 * All instances share one compiled program (constant customProgramCacheKey).
 */

export const TATTOO_PATHS = 5;

export interface CharUniforms {
  uPal: { value: THREE.Color[] };
  uCloth: { value: THREE.Color[] };
  uTatColor: { value: THREE.Color };
  uTatA: { value: THREE.Vector4[] };
  uTatB: { value: THREE.Vector4[] };
  uTatC: { value: THREE.Vector4[] };
  uGlowColor: { value: THREE.Color };
  uEyeGlow: { value: number };
  uTatGlow: { value: number };
  uRim: { value: number };
  uFlash: { value: THREE.Color };
}

const VERT_PARS = /* glsl */ `
attribute vec4 aMat;
attribute vec3 aTat;
uniform vec3 uPal[${PALETTE_SIZE}];
varying vec3 vPalColor;
varying vec4 vMat;
varying vec3 vTat;
`;

const VERT_MAIN = /* glsl */ `
#include <begin_vertex>
int charIdx = int(aMat.x + 0.5);
vPalColor = uPal[charIdx];
vMat = vec4(charIdx == ${PAL.ATLAS} ? 1.0 : 0.0, aMat.y, aMat.z, aMat.w);
vTat = aTat;
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uCloth[4];
uniform vec3 uTatColor;
uniform vec4 uTatA[${TATTOO_PATHS}];
uniform vec4 uTatB[${TATTOO_PATHS}];
uniform vec4 uTatC[${TATTOO_PATHS}];
uniform vec3 uGlowColor;
uniform float uEyeGlow;
uniform float uTatGlow;
uniform float uRim;
uniform vec3 uFlash;
varying vec3 vPalColor;
varying vec4 vMat;
varying vec3 vTat;

float charTattoo(vec3 tc) {
  int p = int(tc.z + 0.5);
  if (p <= 0 || p > ${TATTOO_PATHS}) return 0.0;
  vec4 A = uTatA[p - 1]; // shaft t0, tip t1, half width, enabled
  vec4 B = uTatB[p - 1]; // head length, head half width, band1 centre, band1 half width
  vec4 C = uTatC[p - 1]; // band2 centre, band2 half width, dots flag, dots t
  float s = tc.x;
  float t = tc.y;
  float aa = max(fwidth(s), fwidth(t)) * 0.7 + 0.0003;
  float m = 0.0;
  if (A.w > 0.5) {
    float tHead = A.y - B.x;
    float shaftEnd = B.x > 0.0 ? tHead + 0.002 : A.y;
    m = smoothstep(-aa, aa, A.z - abs(s)) * smoothstep(-aa, aa, t - A.x) * smoothstep(-aa, aa, shaftEnd - t);
    if (B.x > 0.0) {
      float k = clamp((A.y - t) / B.x, 0.0, 1.0);
      float hw = B.y * k;
      m = max(m, smoothstep(-aa, aa, hw - abs(s)) * smoothstep(-aa, aa, t - tHead) * smoothstep(-aa, aa, A.y - t));
    }
  }
  if (B.w > 0.0) m = max(m, smoothstep(-aa, aa, B.w - abs(t - B.z)));
  if (C.y > 0.0) m = max(m, smoothstep(-aa, aa, C.y - abs(t - C.x)));
  if (C.z > 0.5) {
    for (int k = -2; k <= 2; k++) {
      float fk = float(k);
      vec2 c = vec2(fk * 0.0165, C.w - 0.0032 * fk * fk);
      float r = 0.0043 - 0.0005 * abs(fk);
      m = max(m, smoothstep(-aa, aa, r - length(vec2(s, t) - c)));
    }
  }
  return m;
}
`;

const FRAG_MAP = /* glsl */ `
vec3 charBase = vPalColor;
#ifdef USE_MAP
if (vMat.x > 0.5) {
  vec3 mk = texture2D(map, vMapUv).rgb;
  float wP = clamp(1.0 - mk.r - mk.g - mk.b, 0.0, 1.0);
  charBase = uCloth[0] * wP + uCloth[3] * mk.r + uCloth[2] * mk.g + uCloth[1] * mk.b;
}
#endif
diffuseColor.rgb *= charBase;
float charTat = charTattoo(vTat);
diffuseColor.rgb = mix(diffuseColor.rgb, uTatColor, charTat * 0.94);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vMat.w * clamp(uEyeGlow * 1.6 - 0.25, 0.0, 1.0));
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
float charRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.4);
totalEmissiveRadiance += uGlowColor * (charTat * uTatGlow * 3.2 + vMat.w * uEyeGlow * 5.5 + charRim * uRim);
totalEmissiveRadiance += uFlash;
`;

function patch(this: CharMaterial, shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, this.cu);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', VERT_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
    .replace('#include <map_fragment>', FRAG_MAP)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMat.y;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMat.z;')
    .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
}

let blankMap: THREE.DataTexture | null = null;
/** 1×1 mask texture (all primary) used when a character has no patterned cloth. */
export function blankAtlas(): THREE.Texture {
  if (!blankMap) {
    blankMap = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blankMap.needsUpdate = true;
    blankMap.colorSpace = THREE.NoColorSpace;
  }
  return blankMap;
}

export class CharMaterial extends THREE.MeshStandardMaterial {
  readonly cu: CharUniforms;

  constructor() {
    super({ color: 0xffffff, roughness: 0.8, metalness: 0 });
    const cols = (n: number) => Array.from({ length: n }, () => new THREE.Color(1, 1, 1));
    const vecs = () => Array.from({ length: TATTOO_PATHS }, () => new THREE.Vector4());
    this.cu = {
      uPal: { value: cols(PALETTE_SIZE) },
      uCloth: { value: cols(4) },
      uTatColor: { value: new THREE.Color('#2f7fd6') },
      uTatA: { value: vecs() },
      uTatB: { value: vecs() },
      uTatC: { value: vecs() },
      uGlowColor: { value: new THREE.Color('#bfe8ff') },
      uEyeGlow: { value: 0 },
      uTatGlow: { value: 0 },
      uRim: { value: 0 },
      uFlash: { value: new THREE.Color(0, 0, 0) },
    };
    this.map = blankAtlas();
    this.onBeforeCompile = patch;
  }

  override customProgramCacheKey(): string {
    return 'a4n-char-v1';
  }

  setPal(slot: number, color: THREE.ColorRepresentation): void {
    this.cu.uPal.value[slot].set(color);
  }
}
