import type { BoneName } from './Animator';
import type { Appearance, BodyType, EyeShape, Frame } from './Appearance';

/**
 * Pure shape maths for procedural characters: skeleton layout per frame, body
 * radii profiles, face presets + sliders and the head surface function.
 * No three.js objects — safe for unit tests.
 */

export const BONE_PARENT: Record<BoneName, BoneName | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  shoulderL: 'chest',
  upperArmL: 'shoulderL',
  foreArmL: 'upperArmL',
  handL: 'foreArmL',
  shoulderR: 'chest',
  upperArmR: 'shoulderR',
  foreArmR: 'upperArmR',
  handR: 'foreArmR',
  thighL: 'hips',
  shinL: 'thighL',
  footL: 'shinL',
  thighR: 'hips',
  shinR: 'thighR',
  footR: 'shinR',
};

export type V3 = [number, number, number];

export interface FrameDims {
  /** Shoulder joint (upper arm origin) x. */
  shoulder: number;
  /** Hip joint (thigh origin) x. */
  hip: number;
  chestW: number;
  waistW: number;
  hipW: number;
  depth: number;
  limb: number;
  neck: number;
}

export const FRAME_DIMS: Record<Frame, FrameDims> = {
  slim: { shoulder: 0.19, hip: 0.088, chestW: 0.92, waistW: 0.9, hipW: 0.95, depth: 0.92, limb: 0.88, neck: 0.93 },
  average: { shoulder: 0.203, hip: 0.093, chestW: 1.0, waistW: 1.0, hipW: 1.0, depth: 1.0, limb: 1.0, neck: 1.0 },
  athletic: { shoulder: 0.216, hip: 0.095, chestW: 1.09, waistW: 0.96, hipW: 0.99, depth: 1.05, limb: 1.09, neck: 1.08 },
  broad: { shoulder: 0.226, hip: 0.102, chestW: 1.15, waistW: 1.17, hipW: 1.1, depth: 1.14, limb: 1.16, neck: 1.13 },
};

export interface RigLayout {
  /** Local offsets from the parent joint (bind pose; all rest rotations are zero). */
  offset: Record<BoneName, V3>;
  /** Model-space (root-local) joint positions. */
  pos: Record<BoneName, V3>;
  dims: FrameDims;
}

/**
 * Female proportions, applied on top of the frame: narrower shoulders and ribcage, a defined
 * waist, wider hips, slimmer limbs and neck. (The bust is shaped in buildBody's torsoAt.)
 */
export const FEMALE_DIMS: FrameDims = { shoulder: 0.9, hip: 1.08, chestW: 0.9, waistW: 0.84, hipW: 1.12, depth: 0.95, limb: 0.87, neck: 0.85 };

export function rigLayout(frame: Frame, body: BodyType = 'male'): RigLayout {
  const base = FRAME_DIMS[frame] ?? FRAME_DIMS.average;
  const d: FrameDims =
    body === 'female'
      ? {
          shoulder: base.shoulder * FEMALE_DIMS.shoulder,
          hip: base.hip * FEMALE_DIMS.hip,
          chestW: base.chestW * FEMALE_DIMS.chestW,
          waistW: base.waistW * FEMALE_DIMS.waistW,
          hipW: base.hipW * FEMALE_DIMS.hipW,
          depth: base.depth * FEMALE_DIMS.depth,
          limb: base.limb * FEMALE_DIMS.limb,
          neck: base.neck * FEMALE_DIMS.neck,
        }
      : base;
  const offset: Record<BoneName, V3> = {
    hips: [0, 0.95, 0],
    spine: [0, 0.1, 0],
    chest: [0, 0.2, 0],
    neck: [0, 0.235, 0],
    head: [0, 0.076, 0.01],
    shoulderL: [d.shoulder - 0.045, 0.165, -0.01],
    upperArmL: [0.045, 0, 0],
    foreArmL: [0, -0.275, 0],
    handL: [0, -0.245, 0],
    shoulderR: [-(d.shoulder - 0.045), 0.165, -0.01],
    upperArmR: [-0.045, 0, 0],
    foreArmR: [0, -0.275, 0],
    handR: [0, -0.245, 0],
    thighL: [d.hip, -0.045, 0],
    shinL: [0, -0.425, 0],
    footL: [0, -0.415, 0],
    thighR: [-d.hip, -0.045, 0],
    shinR: [0, -0.425, 0],
    footR: [0, -0.415, 0],
  };
  const pos = {} as Record<BoneName, V3>;
  const resolve = (b: BoneName): V3 => {
    if (pos[b]) return pos[b];
    const p = BONE_PARENT[b];
    const o = offset[b];
    const base: V3 = p ? resolve(p) : [0, 0, 0];
    pos[b] = [base[0] + o[0], base[1] + o[1], base[2] + o[2]];
    return pos[b];
  };
  (Object.keys(offset) as BoneName[]).forEach(resolve);
  return { offset, pos, dims: d };
}

// -----------------------------------------------------------------------------
// Face
// -----------------------------------------------------------------------------

export interface FaceParams {
  rx: number;
  ry: number;
  rz: number;
  cranium: number;
  jawW: number;
  jawSq: number;
  chin: number;
  chinW: number;
  cheek: number;
  brow: number;
  faceLen: number;
  noseLen: number;
  noseW: number;
  noseProj: number;
  /** -1 upturned/concave .. +1 hooked/aquiline. */
  noseBridge: number;
  noseTip: number;
  mouthW: number;
  lipFull: number;
  /** Eyeball radius (m). */
  eyeR: number;
  /** Eye centre lateral offset (m). */
  eyeX: number;
  /** Vertical opening half-angle of the lids (rad). */
  eyeOpen: number;
  /** Outer-corner lift (rad). */
  eyeTilt: number;
  /** Horizontal half-angle of the opening (rad). */
  eyeU: number;
  /** Corner sharpness exponent (higher = rounder). */
  eyeRound: number;
  /** Iris angular radius (rad). */
  irisA: number;
  earSize: number;
}

export const FACE_PRESET_NAMES = ['Youthful', 'Gentle', 'Strong', 'Noble', 'Weathered', 'Bright'];

const PRESETS: FaceParams[] = [
  // 0 Youthful — round face, big eyes, small button nose, large cranium
  { rx: 0.1, ry: 0.119, rz: 0.112, cranium: 0.9, jawW: 0.7, jawSq: 0.15, chin: -0.2, chinW: 0.8, cheek: 0.3, brow: 0.05, faceLen: 0.92, noseLen: 0.82, noseW: 0.9, noseProj: 0.8, noseBridge: -0.25, noseTip: 1.1, mouthW: 0.9, lipFull: 0.5, eyeR: 0.0178, eyeX: 0.0385, eyeOpen: 0.62, eyeTilt: 0, eyeU: 1.0, eyeRound: 0.8, irisA: 0.56, earSize: 1.06 },
  // 1 Gentle — oval face, soft jaw, fuller lips
  { rx: 0.096, ry: 0.123, rz: 0.11, cranium: 0.6, jawW: 0.66, jawSq: 0.15, chin: 0.1, chinW: 0.74, cheek: 0.45, brow: 0.08, faceLen: 1.0, noseLen: 0.98, noseW: 0.92, noseProj: 0.92, noseBridge: -0.1, noseTip: 1.0, mouthW: 1.0, lipFull: 0.85, eyeR: 0.0172, eyeX: 0.037, eyeOpen: 0.56, eyeTilt: 0.06, eyeU: 1.02, eyeRound: 0.7, irisA: 0.54, earSize: 0.95 },
  // 2 Strong — square jaw, broad nose, heavy brow
  { rx: 0.104, ry: 0.121, rz: 0.114, cranium: 0.5, jawW: 0.9, jawSq: 0.85, chin: 0.25, chinW: 1.12, cheek: 0.35, brow: 0.75, faceLen: 1.05, noseLen: 1.05, noseW: 1.22, noseProj: 1.0, noseBridge: 0.12, noseTip: 1.15, mouthW: 1.08, lipFull: 0.45, eyeR: 0.0162, eyeX: 0.0375, eyeOpen: 0.46, eyeTilt: -0.03, eyeU: 0.98, eyeRound: 0.6, irisA: 0.52, earSize: 1.05 },
  // 3 Noble — angular, high cheekbones, pointed chin, straight narrow nose
  { rx: 0.097, ry: 0.124, rz: 0.112, cranium: 0.6, jawW: 0.7, jawSq: 0.55, chin: 0.4, chinW: 0.78, cheek: 0.85, brow: 0.4, faceLen: 1.04, noseLen: 1.08, noseW: 0.84, noseProj: 1.12, noseBridge: 0.0, noseTip: 0.9, mouthW: 0.95, lipFull: 0.42, eyeR: 0.0165, eyeX: 0.0372, eyeOpen: 0.5, eyeTilt: 0.1, eyeU: 1.04, eyeRound: 0.55, irisA: 0.53, earSize: 0.95 },
  // 4 Weathered — long face, aquiline nose, deep brow
  { rx: 0.098, ry: 0.127, rz: 0.116, cranium: 0.5, jawW: 0.77, jawSq: 0.5, chin: 0.25, chinW: 0.95, cheek: 0.5, brow: 0.85, faceLen: 1.12, noseLen: 1.24, noseW: 1.08, noseProj: 1.28, noseBridge: 0.65, noseTip: 1.05, mouthW: 1.05, lipFull: 0.35, eyeR: 0.0158, eyeX: 0.0372, eyeOpen: 0.44, eyeTilt: -0.05, eyeU: 0.98, eyeRound: 0.6, irisA: 0.52, earSize: 1.13 },
  // 5 Bright — heart-shaped: wide cheeks, narrow pointed chin, upturned nose
  { rx: 0.101, ry: 0.12, rz: 0.111, cranium: 0.7, jawW: 0.6, jawSq: 0.05, chin: 0.15, chinW: 0.6, cheek: 0.72, brow: 0.12, faceLen: 0.95, noseLen: 0.9, noseW: 0.85, noseProj: 0.9, noseBridge: -0.55, noseTip: 1.05, mouthW: 0.92, lipFull: 0.72, eyeR: 0.0176, eyeX: 0.0378, eyeOpen: 0.6, eyeTilt: 0.1, eyeU: 1.02, eyeRound: 0.7, irisA: 0.55, earSize: 0.95 },
];

const clampN = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Resolve the face preset + sliders + eye shape into concrete parameters. */
export function faceParams(face: Appearance['face'], eyeShape: EyeShape, body: BodyType = 'male'): FaceParams {
  const base = PRESETS[clampN(Math.round(face.preset), 0, PRESETS.length - 1)];
  const f: FaceParams = { ...base };
  if (body === 'female') {
    // Softer, finer features: narrower jaw and chin, lighter brow ridge, finer nose, fuller lips, larger eyes.
    f.jawW *= 0.9;
    f.jawSq *= 0.55;
    f.chin *= 0.85;
    f.chinW *= 0.86;
    f.brow *= 0.6;
    f.faceLen *= 0.96;
    f.noseLen *= 0.92;
    f.noseW *= 0.88;
    f.noseProj *= 0.88;
    f.lipFull = Math.min(1.3, f.lipFull + 0.18);
    f.cheek += 0.08;
    f.eyeR *= 1.05;
    f.eyeOpen *= 1.06;
  }
  // Stylised proportions: slightly larger heads than life.
  const HS = 1.06;
  f.rx *= HS;
  f.ry *= HS;
  f.rz *= HS;
  f.eyeR *= HS * 1.12;
  f.eyeX *= HS * 1.04;
  f.eyeOpen *= 1.12;
  const jaw = clampN(face.jaw, -1, 1);
  const cheeks = clampN(face.cheeks, -1, 1);
  const nose = clampN(face.nose, -1, 1);
  const sp = clampN(face.eyeSpacing, -1, 1);
  f.jawW = clampN(f.jawW + 0.11 * jaw, 0.5, 1.02);
  f.jawSq = clampN(f.jawSq + 0.35 * jaw, 0, 1);
  f.chinW = clampN(f.chinW + 0.18 * jaw, 0.5, 1.3);
  f.cheek = clampN(f.cheek + 0.4 * cheeks, -0.2, 1.3);
  f.noseLen *= 1 + 0.22 * nose;
  f.noseW *= 1 + 0.22 * nose;
  f.noseProj *= 1 + 0.3 * nose;
  f.eyeX += 0.0048 * sp;
  switch (eyeShape) {
    case 'round':
      f.eyeOpen *= 1.06;
      f.eyeRound = Math.max(f.eyeRound, 0.95);
      f.eyeTilt *= 0.3;
      f.eyeU *= 0.96;
      break;
    case 'almond':
      f.eyeOpen *= 0.84;
      f.eyeTilt += 0.16;
      f.eyeRound = Math.min(f.eyeRound, 0.5);
      f.eyeU *= 1.06;
      break;
    case 'narrow':
      f.eyeOpen *= 0.74;
      f.irisA *= 0.92;
      f.eyeTilt += 0.07;
      f.eyeRound = 0.4;
      f.eyeU *= 1.06;
      break;
    case 'wide':
      f.eyeOpen *= 1.2;
      f.eyeR *= 1.07;
      f.irisA *= 1.05;
      f.eyeTilt -= 0.03;
      f.eyeRound = Math.max(f.eyeRound, 0.85);
      break;
  }
  return f;
}

/** Head centre above the head bone pivot (head-local). */
export const HEAD_CY = 0.105;

const sstep = (e0: number, e1: number, x: number) => {
  const t = clampN((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Head surface point for a unit direction (dx,dy,dz) from the head centre, in
 * head-local coordinates (origin at the head bone pivot). Faces +Z.
 */
export function headPoint(f: FaceParams, dx: number, dy: number, dz: number, out: { x: number; y: number; z: number }): void {
  let x = dx * f.rx;
  let y = dy * f.ry;
  let z = dz * f.rz;
  const low = clampN(-dy, 0, 1);
  const ax = Math.abs(dx);
  // Cranium: fuller back of the skull.
  const crn = sstep(0.05, -0.85, dz) * sstep(-0.55, 0.45, dy);
  z *= 1 + 0.13 * f.cranium * crn;
  y *= 1 + 0.03 * f.cranium * crn;
  x *= 1 + 0.025 * f.cranium * crn;
  // Lower face length.
  if (dy < 0) y *= 1 + (f.faceLen - 1) * sstep(0.0, 0.7, low) * sstep(-0.35, 0.5, dz);
  // Jaw: narrow toward the chin; square jaws keep width lower down.
  const jawCurve = (1 - f.jawSq) * sstep(0.12, 0.98, low) + f.jawSq * sstep(0.5, 1.02, low);
  const frontish = 0.45 + 0.55 * sstep(-0.4, 0.6, dz);
  x *= 1 + (f.jawW - 1) * jawCurve * frontish;
  // Chin: width and protrusion.
  const chinZone = sstep(0.6, 0.98, low) * sstep(0.25, 0.85, dz);
  x *= 1 + (f.chinW - 1) * chinZone * 0.6;
  z += chinZone * 0.011 * (0.3 + f.chin);
  y -= chinZone * 0.006 * f.faceLen;
  // Under-jaw / nape tuck so the neck merges cleanly.
  const tuck = sstep(0.55, 0.95, low) * sstep(0.35, -0.6, dz);
  x *= 1 - 0.18 * tuck;
  z *= 1 - 0.1 * tuck;
  // Flatten the face plane.
  const facePlane = sstep(0.35, 0.92, dz) * sstep(-0.9, 0.3, dy) * (1 - sstep(0.55, 0.95, dy));
  z = z * (1 - 0.07 * facePlane) + 0.004 * facePlane;
  // Cheekbones.
  const cbx = (ax - 0.6) / 0.22, cby = (dy + 0.1) / 0.2, cbz = (dz - 0.66) / 0.3;
  const cb = Math.exp(-(cbx * cbx + cby * cby + cbz * cbz));
  x += Math.sign(dx) * cb * 0.0065 * f.cheek;
  z += cb * 0.0035 * f.cheek;
  // Brow ridge.
  const bry = (dy - 0.17) / 0.085;
  const br = Math.exp(-bry * bry) * sstep(0.72, 0.97, dz) * Math.exp(-(dx * dx) / 0.22);
  z += br * 0.0055 * (0.25 + f.brow);
  // Temples: slight flattening at the sides above the eyes.
  const tmp = Math.exp(-(((ax - 0.85) / 0.2) ** 2) - (((dy - 0.25) / 0.25) ** 2)) * sstep(-0.2, 0.5, dz);
  x *= 1 - 0.035 * tmp;
  // Eye sockets: the skin recedes around the eyes so eyeballs and lids sit in the face.
  if (dz > 0.4) {
    const yawE = Math.asin(Math.min(0.9, f.eyeX / f.rx));
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
    const pe = -0.05;
    const dyw = (Math.abs(yaw) - yawE) / 0.24;
    const dp = (pitch - pe) / (pitch > pe ? 0.2 : 0.15);
    const dent = Math.exp(-(dyw * dyw + dp * dp)) * f.eyeR * 0.45;
    const r = Math.hypot(x, y, z) || 1;
    const k = (r - dent) / r;
    x *= k;
    y *= k;
    z *= k;
  }
  out.x = x;
  out.y = HEAD_CY + y;
  out.z = z;
}

/** Surface point in a direction given by yaw (around Y, 0 = +Z) and pitch (up). */
export function headPointAngles(f: FaceParams, yaw: number, pitch: number, out: { x: number; y: number; z: number }): void {
  const cp = Math.cos(pitch);
  headPoint(f, Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp, out);
}

/** Numerical surface normal at yaw/pitch. */
export function headNormalAngles(f: FaceParams, yaw: number, pitch: number, out: { x: number; y: number; z: number }): void {
  const e = 0.004;
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 }, c = { x: 0, y: 0, z: 0 }, d = { x: 0, y: 0, z: 0 };
  headPointAngles(f, yaw + e, pitch, a);
  headPointAngles(f, yaw - e, pitch, b);
  headPointAngles(f, yaw, pitch + e, c);
  headPointAngles(f, yaw, pitch - e, d);
  const ux = a.x - b.x, uy = a.y - b.y, uz = a.z - b.z;
  const vx = c.x - d.x, vy = c.y - d.y, vz = c.z - d.z;
  // u × v points outward for yaw increasing toward +X and pitch upward.
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  out.x = nx;
  out.y = ny;
  out.z = nz;
}

// -----------------------------------------------------------------------------
// Skin-derived palette helpers (hex in, hex out)
// -----------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [200, 160, 130];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => clampN(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix two hex colours (t=0 → a). */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

export function scaleHex(a: string, k: number): string {
  const x = hexToRgb(a);
  return rgbToHex(x[0] * k, x[1] * k, x[2] * k);
}

/** Perceived lightness 0..1 of a hex colour. */
export function lightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
}

export interface SkinPalette {
  skin: string;
  shade: string;
  lip: string;
  mouth: string;
  scar: string;
  burn: string;
}

export function skinPalette(skin: string): SkinPalette {
  const L = lightness(skin);
  return {
    skin,
    shade: mixHex(scaleHex(skin, 0.78), '#7a3020', 0.12),
    lip: mixHex(skin, L > 0.55 ? '#b8564e' : '#7a3a34', 0.34),
    mouth: mixHex(scaleHex(skin, 0.42), '#4a1a16', 0.4),
    scar: mixHex(skin, '#c47268', 0.42),
    burn: mixHex(skin, L > 0.5 ? '#a8463c' : '#6a2a24', 0.58),
  };
}
