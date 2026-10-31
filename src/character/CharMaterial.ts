import * as THREE from 'three';
import { PAL, PALETTE_SIZE } from './CharMesh';
import { ARROW_CELL, FACE_SPACE, markingsAtlas } from './Markings';

/**
 * CharMaterial — the single material every character renders with.
 *
 * A MeshStandardMaterial with shader patches so one draw call can show skin,
 * cloth, hair, eyes, metal and leather:
 *  - colour = palette uniform indexed per vertex (aMat.x); PAL.ATLAS vertices mix the
 *    four cloth colours by a pattern-mask texture (R=trim, G=accent, B=secondary, rest=primary)
 *  - roughness / metalness per vertex (aMat.y / aMat.z)
 *  - procedural Air Nomad tattoos from per-vertex path coordinates (aTat) — crisp at any
 *    distance, style/colour change without rebuilding geometry; arrows can be drawn in a design
 *    from the markings atlas (Markings.ts) instead, along the same paths
 *  - face paint from the markings atlas, projected onto the face from the bind pose (skin and
 *    lips only), three colours layered
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
  /** Markings atlas (arrow designs, face paints). */
  uMarkTex: { value: THREE.Texture };
  /** 1 = arrows drawn from the atlas design cells below, 0 = the plain procedural arrow. */
  uArrowMode: { value: number };
  uArrowHead: { value: THREE.Vector4 };
  uArrowShaft: { value: THREE.Vector4 };
  uArrowInk: { value: THREE.Color };
  uArrowInk2: { value: THREE.Color };
  uFaceOn: { value: number };
  uFaceCell: { value: THREE.Vector4 };
  uFaceCol: { value: THREE.Color[] };
  /** Face projection: eye-line y, eye z, half distance between the eyes (bind pose, model space). */
  uFaceRef: { value: THREE.Vector4 };
  /** Glow of the face paint's first colour (a combustionbender's third eye while focusing). */
  uFaceGlow: { value: number };
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
uniform vec4 uFaceRef;
varying vec3 vPalColor;
varying vec4 vMat;
varying vec3 vTat;
varying vec4 vFace;
`;

const VERT_MAIN = /* glsl */ `
#include <begin_vertex>
int charIdx = int(aMat.x + 0.5);
vPalColor = uPal[charIdx];
vMat = vec4(charIdx == ${PAL.ATLAS} ? 1.0 : 0.0, aMat.y, aMat.z, aMat.w);
vTat = aTat;
// Face paint goes on skin, lips, scars and stubble only (not eyes, brows, hair or cloth).
float charPaintable = (charIdx <= ${PAL.LIP} || (charIdx >= ${PAL.SCAR} && charIdx <= ${PAL.STUBBLE})) ? 1.0 : 0.0;
vFace = vec4(position.x / uFaceRef.z, (position.y - uFaceRef.x) / uFaceRef.z, (position.z - uFaceRef.y) / uFaceRef.z, charPaintable);
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uCloth[4];
uniform vec3 uTatColor;
uniform vec4 uTatA[${TATTOO_PATHS}];
uniform vec4 uTatB[${TATTOO_PATHS}];
uniform vec4 uTatC[${TATTOO_PATHS}];
uniform sampler2D uMarkTex;
uniform float uArrowMode;
uniform vec4 uArrowHead;
uniform vec4 uArrowShaft;
uniform vec3 uArrowInk;
uniform vec3 uArrowInk2;
uniform float uFaceOn;
uniform vec4 uFaceCell;
uniform vec3 uFaceCol[3];
uniform float uFaceGlow;
uniform vec3 uGlowColor;
uniform float uEyeGlow;
uniform float uTatGlow;
uniform float uRim;
uniform vec3 uFlash;
varying vec3 vPalColor;
varying vec4 vMat;
varying vec3 vTat;
varying vec4 vFace;

// Arrow drawn from a design in the atlas: the head cell over the arrowhead (and the end of the
// shaft), the shaft cell repeating back along the path. Returns (main ink, second ink).
vec2 charArrowDesign(float s, float t, vec4 A, vec4 B) {
  float hl = B.x, hw = B.y, tip = A.y;
  float tTop = tip + ${ARROW_CELL.Y0.toFixed(2)} * hl;
  if (t > tip + ${ARROW_CELL.Y1.toFixed(2)} * hl || t < A.x) return vec2(0.0);
  if (t >= tTop) {
    vec2 uv = vec2(s / (${(2 * ARROW_CELL.HX).toFixed(2)} * hw) + 0.5, (t - tTop) / (${(ARROW_CELL.Y1 - ARROW_CELL.Y0).toFixed(2)} * hl));
    if (uv.x <= 0.0 || uv.x >= 1.0) return vec2(0.0);
    return texture2D(uMarkTex, uArrowHead.xy + uv * uArrowHead.zw).rg;
  }
  float period = ${(2 * ARROW_CELL.SX).toFixed(2)} * A.z;
  float u = s / period + 0.5;
  if (u <= 0.0 || u >= 1.0) return vec2(0.0);
  float v = 0.75 - 0.5 * fract((tTop - t) / period);
  vec2 uv = uArrowShaft.xy + vec2(u, v) * uArrowShaft.zw;
  vec2 gx = vec2(dFdx(s), -0.5 * dFdx(t)) / period * uArrowShaft.zw;
  vec2 gy = vec2(dFdy(s), -0.5 * dFdy(t)) / period * uArrowShaft.zw;
  return textureGrad(uMarkTex, uv, gx, gy).rg * smoothstep(A.x, A.x + 0.006, t);
}

vec2 charTattoo(vec3 tc) {
  int p = int(tc.z + 0.5);
  if (p <= 0 || p > ${TATTOO_PATHS}) return vec2(0.0);
  vec4 A = uTatA[p - 1]; // shaft t0, tip t1, half width, enabled
  vec4 B = uTatB[p - 1]; // head length, head half width, band1 centre, band1 half width
  vec4 C = uTatC[p - 1]; // band2 centre, band2 half width, dots flag, dots t
  float s = tc.x;
  float t = tc.y;
  float aa = max(fwidth(s), fwidth(t)) * 0.7 + 0.0003;
  float m = 0.0;
  vec2 ink = vec2(0.0);
  if (A.w > 0.5 && uArrowMode > 0.5 && B.x > 0.0) ink = charArrowDesign(s, t, A, B);
  else if (A.w > 0.5) {
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
  return vec2(max(ink.x, m), ink.y);
}

// Face paint: front projection of the face (eyes at x = ±1, y = 0), fading round the sides.
vec3 charPaintK = vec3(0.0);
vec3 charFacePaint(vec3 col) {
  if (uFaceOn < 0.5 || vFace.w < 0.5) return col;
  vec2 f = vFace.xy;
  if (abs(f.x) > ${FACE_SPACE.X.toFixed(2)} || f.y < ${FACE_SPACE.Y0.toFixed(2)} || f.y > ${FACE_SPACE.Y1.toFixed(2)}) return col;
  float front = smoothstep(-1.75, -1.05, vFace.z);
  vec2 uv = vec2((f.x + ${FACE_SPACE.X.toFixed(2)}) / ${(2 * FACE_SPACE.X).toFixed(2)}, (${FACE_SPACE.Y1.toFixed(2)} - f.y) / ${(FACE_SPACE.Y1 - FACE_SPACE.Y0).toFixed(2)});
  vec3 k = texture2D(uMarkTex, uFaceCell.xy + uv * uFaceCell.zw).rgb * front;
  charPaintK = k;
  col = mix(col, uFaceCol[0], k.r);
  col = mix(col, uFaceCol[1], k.g);
  col = mix(col, uFaceCol[2], k.b);
  return col;
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
vec2 charInk = charTattoo(vTat);
float charTat = max(charInk.x, charInk.y);
diffuseColor.rgb = mix(diffuseColor.rgb, uArrowMode > 0.5 ? uArrowInk : uTatColor, charInk.x * 0.94);
diffuseColor.rgb = mix(diffuseColor.rgb, uArrowInk2, charInk.y * 0.94);
diffuseColor.rgb = charFacePaint(diffuseColor.rgb);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vMat.w * clamp(uEyeGlow * 1.6 - 0.25, 0.0, 1.0));
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
float charRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.4);
totalEmissiveRadiance += uGlowColor * (charTat * uTatGlow * 3.2 + vMat.w * uEyeGlow * 5.5 + charRim * uRim);
totalEmissiveRadiance += uFlash;
totalEmissiveRadiance += vec3(1.0, 0.42, 0.18) * charPaintK.r * uFaceGlow * 3.0;
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
      uMarkTex: { value: markingsAtlas() ?? blankAtlas() },
      uArrowMode: { value: 0 },
      uArrowHead: { value: new THREE.Vector4() },
      uArrowShaft: { value: new THREE.Vector4() },
      uArrowInk: { value: new THREE.Color('#2f7fd6') },
      uArrowInk2: { value: new THREE.Color('#2f7fd6') },
      uFaceOn: { value: 0 },
      uFaceCell: { value: new THREE.Vector4() },
      uFaceCol: { value: cols(3) },
      uFaceRef: { value: new THREE.Vector4(1.6, 0.1, 0.035, 0) },
      uFaceGlow: { value: 0 },
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
    return 'a4n-char-v2';
  }

  setPal(slot: number, color: THREE.ColorRepresentation): void {
    this.cu.uPal.value[slot].set(color);
  }
}
