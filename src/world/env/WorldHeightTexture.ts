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
  /** The next upload must send the whole map (first use, window moved): partial ranges would leave the rest unset. */
  private wholePending = true;
  static readonly UNFILLED = -60;
  /** World position of the window's corner (−WORLD_HALF on the mainland; re-centred on a far zone's map). */
  ox = -WORLD_HALF;
  oz = -WORLD_HALF;

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
    // three.js calls this once it has uploaded the texture.
    this.texture.onUpdate = () => {
      this.wholePending = false;
    };
  }

  /**
   * Write heights for a chunk. `heights` is a (gw × gw) grid with a one-sample
   * border, spacing `spacing`, whose interior origin is world (x0, z0).
   */
  writeChunk(x0: number, z0: number, size: number, spacing: number, heights: Float32Array, gw: number): void {
    const t = this.texel;
    const i0 = Math.max(0, Math.floor((x0 - this.ox) / t));
    const j0 = Math.max(0, Math.floor((z0 - this.oz) / t));
    const i1 = Math.min(this.res - 1, Math.floor((x0 + size - this.ox) / t - 1e-6));
    const j1 = Math.min(this.res - 1, Math.floor((z0 + size - this.oz) / t - 1e-6));
    for (let j = j0; j <= j1; j++) {
      const wz = this.oz + (j + 0.5) * t;
      const gz = (wz - z0) / spacing + 1;
      const gzi = Math.min(gw - 2, Math.max(0, Math.floor(gz)));
      const fz = Math.min(1, Math.max(0, gz - gzi));
      for (let i = i0; i <= i1; i++) {
        const wx = this.ox + (i + 0.5) * t;
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

  /**
   * Move the window (same size) so its corner is at (ox, oz): everything reads "unfilled" again and
   * the chunks built afterwards fill it. Used when the focus jumps to a far zone's own map and back.
   */
  setWindow(ox: number, oz: number): void {
    if (ox === this.ox && oz === this.oz) return;
    this.ox = ox;
    this.oz = oz;
    this.data.fill(THREE.DataUtils.toHalfFloat(WorldHeightTexture.UNFILLED));
    this.dirtyRows.clear();
    this.texture.clearUpdateRanges();
    this.wholePending = true;
    this.texture.needsUpdate = true;
  }

  /** Upload dirty rows (call once per frame). */
  flush(): void {
    if (!this.dirtyRows.size) return;
    if (this.wholePending) {
      // Not uploaded yet (or the window moved): send it whole; ranges would upload only themselves.
      this.texture.clearUpdateRanges();
    } else {
      // three.js counts texture update ranges in RGBA components (start / 4 = first texel, count / 4
      // = texels), whatever the format. This map has one channel, so its texel indices go in times
      // four; passed as plain texel indices they landed a quarter of the way in, a quarter as long,
      // and the water shaders read stale heights (deep water right up to every shore).
      for (const [j, [a, b]] of this.dirtyRows) this.texture.addUpdateRange((j * this.res + a) * 4, (b - a + 1) * 4);
    }
    this.dirtyRows.clear();
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
