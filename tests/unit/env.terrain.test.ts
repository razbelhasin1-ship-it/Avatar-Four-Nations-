import { describe, expect, it } from 'vitest';
import { AIR_SPIRES } from '../../src/world/Heightfield';
import { CHUNK_SIZE, chunkMinLod } from '../../src/world/Terrain';

describe('terrain LOD around the Air Temple spires', () => {
  it('keeps every chunk under a needle spire at LOD 1 or finer', () => {
    for (const sp of AIR_SPIRES) {
      // Centre, the steep wall and the flared foot.
      for (const k of [0, 1, 1.6, 2.3]) {
        for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
          const x = sp.x + Math.cos(a) * sp.r * k;
          const z = sp.z + Math.sin(a) * sp.r * k;
          expect(chunkMinLod(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))).toBe(1);
        }
      }
    }
  });

  it('leaves the rest of the world to distance-based LOD', () => {
    for (const [x, z] of [[0, 0], [640, -30], [-1310, 1230], [-250, -1560], [1450, 1250]]) {
      expect(chunkMinLod(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))).toBeUndefined();
    }
  });
});
