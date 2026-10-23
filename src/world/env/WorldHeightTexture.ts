import * as THREE from 'three';
import { WORLD_HALF, WORLD_SIZE } from '../WorldLayout';

/**
 * A world-aligned terrain height map (4 m texels, half-float) filled as a side
 * effect of terrain chunk building. Water shaders sample it to know the water
 * depth under each fragment (depth colour, soft shorelines, foam). Texels never
 * built hold a "deep" sentinel so unexplored ocean reads as open sea.
 */
export class WorldHeightTexture {
  readonly res: number;
  readonly texel: number;
  readonly data: Uint16Array;
  readonly texture: THREE.DataTexture;
  private dirtyRows = new Map<number, [number, number]>();
  static readonly UNFILLED = -60;

  constructor(res = 1024) {
    this.res = res;
    this.texel = WORLD_SIZE / res;
    this.data = new Uint16Array(res * res);
    this.data.fill(THREE.DataUtils.toHalfFloat(WorldHeightTexture.UNFILLED));
    this.texture = new THREE.DataTexture(this.data, res, res, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /**
   * Write heights for a chunk. `heights` is a (gw × gw) grid with a one-sample
   * border, spacing `spacing`, whose interior origin is world (x0, z0).
   */
  writeChunk(x0: number, z0: number, size: number, spacing: number, heights: Float32Array, gw: number): void {
    const t = this.texel;
    const i0 = Math.max(0, Math.floor((x0 + WORLD_HALF) / t));
    const j0 = Math.max(0, Math.floor((z0 + WORLD_HALF) / t));
    const i1 = Math.min(this.res - 1, Math.floor((x0 + size + WORLD_HALF) / t - 1e-6));
    const j1 = Math.min(this.res - 1, Math.floor((z0 + size + WORLD_HALF) / t - 1e-6));
    for (let j = j0; j <= j1; j++) {
      const wz = -WORLD_HALF + (j + 0.5) * t;
      const gz = (wz - z0) / spacing + 1;
      const gzi = Math.min(gw - 2, Math.max(0, Math.floor(gz)));
      const fz = Math.min(1, Math.max(0, gz - gzi));
      for (let i = i0; i <= i1; i++) {
        const wx = -WORLD_HALF + (i + 0.5) * t;
        const gx = (wx - x0) / spacing + 1;
        const gxi = Math.min(gw - 2, Math.max(0, Math.floor(gx)));
        const fx = Math.min(1, Math.max(0, gx - gxi));
        const h00 = heights[gzi * gw + gxi], h10 = heights[gzi * gw + gxi + 1];
        const h01 = heights[(gzi + 1) * gw + gxi], h11 = heights[(gzi + 1) * gw + gxi + 1];
        const h = (h00 + (h10 - h00) * fx) * (1 - fz) + (h01 + (h11 - h01) * fx) * fz;
        this.data[j * this.res + i] = THREE.DataUtils.toHalfFloat(h);
      }
      const r = this.dirtyRows.get(j);
      if (r) {
        r[0] = Math.min(r[0], i0);
        r[1] = Math.max(r[1], i1);
      } else this.dirtyRows.set(j, [i0, i1]);
    }
  }

  /** Upload dirty rows (call once per frame). */
  flush(): void {
    if (!this.dirtyRows.size) return;
    for (const [j, [a, b]] of this.dirtyRows) this.texture.addUpdateRange(j * this.res + a, b - a + 1);
    this.dirtyRows.clear();
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
