import type * as THREE from 'three';
import type { Appearance } from './Appearance';
import type { RigLayout, V3 } from './CharShape';
import { buildAccessory, buildHeadwear, buildNecklace, prepareHeadwear } from './buildAccessories';
import { buildArms, buildHands, buildHead, buildNeck, buildTorsoCore } from './buildBody';
import { buildBelt, buildFeet, buildLegs, buildOuter, buildTop } from './buildClothing';
import { buildFacialHair, buildHair, buildScars } from './buildHair';
import { BuildCtx, type AtlasSpec, type ChainSpec, type ExtraBone, type TattooLandmarks } from './buildUtil';

/**
 * Character build: appearance (shape part) → one skinned geometry + rig data.
 * Results are cached by shape key and shared between humanoids (read-only).
 */

export interface BuildResult {
  key: string;
  geometry: THREE.BufferGeometry;
  rig: RigLayout;
  /** Extra bones sorted by skeleton index (fingers, thumbs, lids, chains). */
  extra: ExtraBone[];
  chains: ChainSpec[];
  tat: TattooLandmarks;
  atlas: AtlasSpec;
  crownY: number;
  eyeL: V3;
  eyeR: V3;
  /** Lid rotation that fully closes the eye (rad). */
  lidClose: number;
  vertexCount: number;
  triangleCount: number;
}

const q = (v: number, step = 0.02) => Math.round(v / step) * step;

/** Key of everything that changes geometry (colours, height and tattoo style do not). */
export function shapeKey(a: Appearance, lod: 0 | 1): string {
  return JSON.stringify([
    lod,
    a.frame,
    q(a.build, 0.05),
    a.face.preset,
    q(a.face.jaw),
    q(a.face.cheeks),
    q(a.face.nose),
    q(a.face.eyeSpacing),
    a.eyes.shape,
    a.brows.style,
    q(a.brows.thickness, 0.05),
    a.hair.style,
    a.facialHair,
    [...a.scars].sort(),
    a.outfit,
  ]);
}

export function buildCharacter(a: Appearance, lod: 0 | 1): BuildResult {
  const ctx = new BuildCtx(a, lod);
  prepareHeadwear(ctx);
  buildHead(ctx);
  buildNeck(ctx);
  buildTorsoCore(ctx);
  buildArms(ctx);
  buildHands(ctx);
  buildLegs(ctx);
  buildFeet(ctx);
  buildTop(ctx);
  buildBelt(ctx);
  buildOuter(ctx);
  buildHair(ctx);
  buildFacialHair(ctx);
  buildScars(ctx);
  buildHeadwear(ctx);
  buildNecklace(ctx);
  buildAccessory(ctx);
  const geometry = ctx.b.toGeometry();
  const extra = [...ctx.extra].sort((x, y) => x.index - y.index);
  return {
    key: shapeKey(a, lod),
    geometry,
    rig: ctx.rig,
    extra,
    chains: ctx.chains,
    tat: ctx.tat,
    atlas: ctx.atlas,
    crownY: ctx.crownY,
    eyeL: ctx.eyeL,
    eyeR: ctx.eyeR,
    lidClose: ctx.face.eyeOpen * 1.6,
    vertexCount: ctx.b.vertexCount,
    triangleCount: ctx.b.indexCount / 3,
  };
}

// -----------------------------------------------------------------------------
// Refcounted cache with a small LRU of unreferenced entries
// -----------------------------------------------------------------------------

export class RefCache<T> {
  private map = new Map<string, { value: T; refs: number; idle: number }>();
  private clock = 0;

  constructor(
    private readonly make: (key: string) => T,
    private readonly destroy: (value: T) => void,
    private readonly keepIdle = 24,
  ) {}

  acquire(key: string, make?: () => T): T {
    let e = this.map.get(key);
    if (!e) {
      e = { value: make ? make() : this.make(key), refs: 0, idle: 0 };
      this.map.set(key, e);
    }
    e.refs++;
    return e.value;
  }

  release(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    e.refs = Math.max(0, e.refs - 1);
    if (e.refs === 0) {
      e.idle = ++this.clock;
      this.trim();
    }
  }

  private trim(): void {
    const idle = [...this.map.entries()].filter(([, e]) => e.refs === 0).sort((x, y) => x[1].idle - y[1].idle);
    while (idle.length > this.keepIdle) {
      const [k, e] = idle.shift()!;
      this.map.delete(k);
      this.destroy(e.value);
    }
  }

  get size(): number {
    return this.map.size;
  }

  get liveCount(): number {
    let n = 0;
    for (const e of this.map.values()) if (e.refs > 0) n++;
    return n;
  }

  clearIdle(): void {
    for (const [k, e] of [...this.map.entries()]) {
      if (e.refs === 0) {
        this.map.delete(k);
        this.destroy(e.value);
      }
    }
  }
}

/** Shared geometry cache (key = shapeKey). */
export const buildCache = new RefCache<BuildResult>(
  () => {
    throw new Error('buildCache requires a factory');
  },
  (r) => r.geometry.dispose(),
  32,
);
