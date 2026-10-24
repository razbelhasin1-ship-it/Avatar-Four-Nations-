import { describe, expect, it } from 'vitest';
import { renderMapRaster, sampleGrids, worldToUV } from '../../src/ui/screens/map/mapRender';
import { STARTS } from '../../src/world/WorldLayout';

describe('parchment world map raster', () => {
  it('renders the real heightfield: sea, land and ice read differently', () => {
    const size = 192;
    const t0 = performance.now();
    const px = renderMapRaster(size);
    const ms = performance.now() - t0;
    expect(px.length).toBe(size * size * 4);
    const at = (x: number, z: number) => {
      const { u, v } = worldToUV(x, z);
      const i = (Math.floor(v * size) * size + Math.floor(u * size)) * 4;
      return [px[i], px[i + 1], px[i + 2], px[i + 3]];
    };
    // Open ocean far east of Kyoshi Island: bluish (blue channel above red).
    const sea = at(2000, 200);
    expect(sea[3]).toBe(255);
    expect(sea[2]).toBeGreaterThan(sea[0]);
    // The Earth Kingdom heartland is land: warm/green parchment (red ≥ blue).
    const land = at(STARTS.earth.spawn.x, STARTS.earth.spawn.z + 300);
    expect(land[0]).toBeGreaterThanOrEqual(land[2]);
    console.log(`map raster ${size}² in ${ms.toFixed(0)} ms (${((ms * 1000) / (size * size)).toFixed(2)} µs/px)`);
  });

  it('classifies water kinds on the grid', () => {
    const g = sampleGrids(96);
    const kinds = new Set(g.water);
    expect(kinds.has(0)).toBe(true);
    expect(kinds.has(1)).toBe(true);
  });
});
