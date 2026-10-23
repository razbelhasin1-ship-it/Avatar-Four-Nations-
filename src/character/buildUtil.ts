import { cosmeticById, EMPTY_SLOT_IDS, type CosmeticDef } from '../data/cosmetics';
import { BONE_NAMES, type BoneName } from './Animator';
import type { Appearance, OutfitSlots } from './Appearance';
import { CharMesh, type P3, type SkinSpec } from './CharMesh';
import { faceParams, rigLayout, type FaceParams, type RigLayout, type V3 } from './CharShape';

/** Skeleton indices: BONE_NAMES first, then fixed extras, then secondary-motion chains. */
export const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;
export const XB = { fingersL: 19, thumbL: 20, fingersR: 21, thumbR: 22, lidL: 23, lidR: 24 } as const;
export const FIRST_CHAIN_BONE = 25;

export interface ExtraBone {
  /** Skeleton index. */
  index: number;
  name: string;
  parent: number;
  /** Model-space rest position. */
  pos: V3;
}

/** Secondary-motion chain (cape, hair tail, sash end...). */
export interface ChainSpec {
  name: string;
  /** Bone indices, one per link (link k spans joints[k] → joints[k+1]). */
  bones: number[];
  /** Model-space joints, length bones.length + 1. */
  joints: V3[];
  /** 0..1: how strongly links return to their animated rest direction. */
  stiffness: number;
  /** Velocity damping per second (0..1 kept per 1/60 s). */
  damping: number;
  /** Gravity pull (m/s²) applied to tips. */
  gravity: number;
  /** Air drag pushing tips opposite to the character's velocity. */
  drag: number;
  /** Keep tips on the given side of a plane in the parent bone's space (normal, offset). */
  plane?: { bone: number; n: V3; d: number };
  /** Max swing (rad) from the rest direction. */
  maxAngle: number;
}

export interface TattooLandmarks {
  head: { tNape: number; tCrown: number; tBrow: number; tTip: number; tSpineBase: number };
  arm: { tElbow: number; tWrist: number; tTip: number };
  leg: { tKnee: number; tAnkle: number; tTip: number };
}

export type OutfitItems = Partial<Record<keyof OutfitSlots, CosmeticDef>>;

export function resolveItem(id: string | undefined): CosmeticDef | undefined {
  if (!id || EMPTY_SLOT_IDS.has(id)) return undefined;
  return cosmeticById(id);
}

export function shapeStr(it: CosmeticDef | undefined, key: string, d: string): string {
  const v = it?.shape[key];
  return typeof v === 'string' ? v : d;
}
export function shapeNum(it: CosmeticDef | undefined, key: string, d: number): number {
  const v = it?.shape[key];
  return typeof v === 'number' ? v : d;
}
export function shapeBool(it: CosmeticDef | undefined, key: string): boolean {
  return it?.shape[key] === true;
}

/** Atlas regions in normalised canvas coordinates (x, y-down, w, h). */
export const ATLAS_RECT = {
  top: [0, 0, 1, 0.375] as const,
  sleeve: [0, 0.375, 0.5, 0.125] as const,
  layer: [0.5, 0.375, 0.5, 0.125] as const,
  outer: [0, 0.5, 1, 0.25] as const,
  misc: [0, 0.75, 1, 0.25] as const,
};
export type AtlasRegion = keyof typeof ATLAS_RECT;

/** What the cloth atlas painter must draw for this character (pure data, used as cache key). */
export interface AtlasSpec {
  top?: { pattern: string; collar: string; lengthM: number; circM: number; waistV: number; layered: boolean; fur: boolean; open: boolean };
  sleeve?: { pattern: string; wide: boolean; lengthM: number; circM: number };
  layer?: { pattern: string; lengthM: number; circM: number };
  outer?: { style: string; pattern: string; wM: number; hM: number };
  misc?: { kind: string };
}

/** Resolve (u,v) in a region to texture coordinates (CanvasTexture flipY). */
export function atlasUV(region: AtlasRegion, u: number, v: number, out: { u: number; v: number }): void {
  const r = ATLAS_RECT[region];
  const cu = Math.min(0.998, Math.max(0.002, u));
  const cv = Math.min(0.998, Math.max(0.002, v));
  out.u = r[0] + cu * r[2];
  out.v = 1 - (r[1] + cv * r[3]);
}

export class BuildCtx {
  readonly b = new CharMesh();
  readonly rig: RigLayout;
  readonly face: FaceParams;
  readonly items: OutfitItems;
  readonly extra: ExtraBone[] = [];
  readonly chains: ChainSpec[] = [];
  readonly tat: TattooLandmarks = {
    head: { tNape: 0.5, tCrown: 0.7, tBrow: 0.85, tTip: 0.86, tSpineBase: 0 },
    arm: { tElbow: 0.3, tWrist: 0.55, tTip: 0.62 },
    leg: { tKnee: 0.45, tAnkle: 0.85, tTip: 1.0 },
  };
  atlas: AtlasSpec = {};
  /** Anchors (bone-local offsets) adjusted to the built geometry. */
  readonly anchors: Record<string, { bone: BoneName; p: V3 }> = {};
  /** Crown height (model space, unscaled). */
  crownY = 1.8;
  /** Eye centres (model space) for anchors and glow. */
  eyeL: V3 = [0.037, 1.67, 0.1];
  eyeR: V3 = [-0.037, 1.67, 0.1];
  /** Hair has a hood/hat over it (hair builders shrink volume). */
  hooded = false;
  hatted = false;
  private nextChainBone = FIRST_CHAIN_BONE;

  constructor(readonly a: Appearance, readonly lod: 0 | 1) {
    this.rig = rigLayout(a.frame);
    this.face = faceParams(a.face, a.eyes.shape);
    const o = a.outfit;
    this.items = {
      top: resolveItem(o.top),
      bottom: resolveItem(o.bottom),
      footwear: resolveItem(o.footwear),
      outer: resolveItem(o.outer),
      gloves: resolveItem(o.gloves),
      belt: resolveItem(o.belt),
      headwear: resolveItem(o.headwear),
      necklace: resolveItem(o.necklace),
      accessory: resolveItem(o.accessory),
    };
  }

  /** Model-space joint position. */
  J(name: BoneName): V3 {
    return this.rig.pos[name];
  }

  /** LOD-scaled segment count. */
  seg(n: number, min = 3): number {
    return this.lod ? Math.max(min, Math.round(n * 0.5)) : n;
  }

  /** Muscle factor from build slider (0.9 .. 1.12). */
  get muscle(): number {
    return 0.9 + this.a.build * 0.22;
  }

  extraBone(index: number, name: string, parent: number, pos: V3): void {
    this.extra.push({ index, name, parent, pos });
  }

  /** Allocate a secondary-motion chain. Returns one bone index per link. */
  addChain(spec: Omit<ChainSpec, 'bones'>, parentBone: number): number[] {
    const bones: number[] = [];
    let parent = parentBone;
    for (let k = 0; k < spec.joints.length - 1; k++) {
      const idx = this.nextChainBone++;
      this.extra.push({ index: idx, name: `${spec.name}_${k}`, parent, pos: spec.joints[k] });
      bones.push(idx);
      parent = idx;
    }
    this.chains.push({ ...spec, bones });
    return bones;
  }

  /** Skin weights along a chain for a parameter 0..1 from first joint to tip. */
  chainSkin(bones: number[], parentBone: number, t: number): SkinSpec {
    const n = bones.length;
    const f = Math.min(n - 1e-4, Math.max(0, t * n));
    const k = Math.floor(f);
    const frac = f - k;
    if (k === 0 && frac < 0.15) return frac < 0.05 ? [parentBone, 0.35, bones[0], 0.65] : [bones[0], 1];
    if (frac > 0.75 && k + 1 < n) return [bones[k], 1 - (frac - 0.75) * 2, bones[k + 1], (frac - 0.75) * 2];
    return [bones[k], 1];
  }
}

// -----------------------------------------------------------------------------
// Ring lofts
// -----------------------------------------------------------------------------

export interface Ring {
  /** Centre (model space). */
  c: V3;
  rx: number;
  rz: number;
  /** Skin binding for this ring (or per-angle). */
  skin: SkinSpec | ((th: number) => SkinSpec);
  /** Palette slot override for vertices of this ring. */
  pal?: number;
  /** Atlas v (0..1) for this ring. */
  v?: number;
  /** Per-angle radius multiplier. */
  rmul?: (th: number) => number;
  /** Horizontal ring tilt: y offset as a function of angle (e.g. V necklines). */
  dy?: (th: number) => number;
}

export interface LoftOpts {
  /** Superellipse exponent (2 = ellipse, higher = boxier). */
  pow?: number;
  /** Atlas region for PAL.ATLAS vertices. */
  region?: AtlasRegion;
  double?: boolean | { pal?: number };
  /** Angle range (default full circle -π..π, 0 = front +Z, π/2 = +X). */
  th0?: number;
  th1?: number;
  /** Per-vertex hook after position is computed (tattoo coords etc.). */
  each?: (ringIdx: number, th: number, p: P3) => void;
  smooth?: boolean;
}

/** Vertical loft of horizontal rings (θ=0 front, θ=π/2 toward +X). */
export function loftY(ctx: BuildCtx, rings: Ring[], segs: number, opts: LoftOpts = {}): void {
  const b = ctx.b;
  const th0 = opts.th0 ?? -Math.PI;
  const th1 = opts.th1 ?? Math.PI;
  const full = Math.abs(th1 - th0 - Math.PI * 2) < 1e-6;
  const pw = opts.pow ?? 2;
  const e = 2 / pw;
  const down = rings.length > 1 && rings[1].c[1] < rings[0].c[1];
  const uvo = { u: 0, v: 0 };
  const savedPal = b.pal;
  b.grid(
    segs,
    rings.length - 1,
    (_i, j, u, _v, out) => {
      const r = rings[j];
      const th = th0 + (th1 - th0) * u;
      const s = Math.sin(th), c = Math.cos(th);
      const m = r.rmul ? r.rmul(th) : 1;
      const sx = Math.sign(s) * Math.pow(Math.abs(s), e);
      const cz = Math.sign(c) * Math.pow(Math.abs(c), e);
      out.x = r.c[0] + sx * r.rx * m;
      out.y = r.c[1] + (r.dy ? r.dy(th) : 0);
      out.z = r.c[2] + cz * r.rz * m;
      b.skin = typeof r.skin === 'function' ? r.skin(th) : r.skin;
      b.pal = r.pal ?? savedPal;
      if (opts.region) {
        atlasUV(opts.region, (th + Math.PI) / (Math.PI * 2), r.v ?? j / (rings.length - 1), uvo);
        b.u = uvo.u;
        b.v = uvo.v;
      }
      opts.each?.(j, th, out);
    },
    { closedU: full, flip: down, double: opts.double, smooth: opts.smooth },
  );
  b.pal = savedPal;
}

/** Catmull-Rom style smooth interpolation through table rows [key, ...values]. */
export function sampleTable(rows: number[][], key: number, col: number): number {
  if (key <= rows[0][0]) return rows[0][col];
  const n = rows.length;
  if (key >= rows[n - 1][0]) return rows[n - 1][col];
  let i = 0;
  while (i < n - 2 && rows[i + 1][0] < key) i++;
  const a = rows[i], b2 = rows[i + 1];
  const t = (key - a[0]) / (b2[0] - a[0]);
  const p0 = rows[Math.max(0, i - 1)][col], p1 = a[col], p2 = b2[col], p3 = rows[Math.min(n - 1, i + 2)][col];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Wrap angle to (-π, π]. */
export function wrapA(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}

/** Deterministic hash noise in [-1, 1]. */
export function hashNoise(a: number, b = 0, c = 0): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
