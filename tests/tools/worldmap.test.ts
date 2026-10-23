/**
 * Dev tool: renders the procedural world to a PNG for layout review.
 * Runs only when MAP_OUT is set:  MAP_OUT=/path/map.png npx vitest run tests/tools/worldmap.test.ts
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { heightAt, materialAt, normalAt, waterAt, initHeightfield } from '../../src/world/Heightfield';
import { LANDMARKS, WORLD_HALF } from '../../src/world/WorldLayout';
import { encodePNG } from './pngEncode';

const OUT = process.env.MAP_OUT;
const SIZE = Number(process.env.MAP_SIZE ?? 768);

describe.skipIf(!OUT)('world map render', () => {
  it('renders', () => {
    initHeightfield();
    const t0 = performance.now();
    const rgb = new Uint8Array(SIZE * SIZE * 3);
    const mat = { w: new Float32Array(8), tint: [0, 0, 0] as [number, number, number] };
    const pal = [
      [0, 0, 0],
      [120, 96, 70],
      [128, 122, 115],
      [222, 204, 150],
      [240, 245, 250],
      [190, 220, 240],
      [70, 62, 60],
      [92, 84, 58],
    ];
    let maxH = -1e9;
    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const x = -WORLD_HALF + ((px + 0.5) / SIZE) * WORLD_HALF * 2;
        const z = -WORLD_HALF + ((py + 0.5) / SIZE) * WORLD_HALF * 2;
        const h = heightAt(x, z);
        if (h > maxH) maxH = h;
        const n = normalAt(x, z, 3);
        const w = waterAt(x, z, h);
        let r: number, g: number, b: number;
        if (w) {
          const depth = w.level - h;
          if (w.frozen) { r = 200; g = 225; b = 240; }
          else if (w.kind === 'ocean') { const d = Math.min(1, depth / 30); r = 40 - 25 * d; g = 110 - 60 * d; b = 170 - 50 * d; }
          else { r = 50; g = 130; b = 200; }
        } else {
          materialAt(x, z, h, 1 - n.y, mat);
          r = 0; g = 0; b = 0;
          for (let i = 0; i < 8; i++) {
            const c = i === 0 ? [mat.tint[0] * 255, mat.tint[1] * 255, mat.tint[2] * 255] : pal[i];
            r += c[0] * mat.w[i]; g += c[1] * mat.w[i]; b += c[2] * mat.w[i];
          }
          const shade = Math.max(0.35, Math.min(1.25, 0.65 + 0.9 * (n.x * -0.5 + n.y * 0.6 + n.z * -0.5)));
          const hl = 1 + Math.min(0.25, Math.max(0, h) / 1200);
          r *= shade * hl; g *= shade * hl; b *= shade * hl;
        }
        const o = (py * SIZE + px) * 3;
        rgb[o] = Math.max(0, Math.min(255, r));
        rgb[o + 1] = Math.max(0, Math.min(255, g));
        rgb[o + 2] = Math.max(0, Math.min(255, b));
      }
    }
    // Landmark dots
    for (const l of LANDMARKS) {
      const px = Math.round(((l.x + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE);
      const py = Math.round(((l.z + WORLD_HALF) / (WORLD_HALF * 2)) * SIZE);
      const col = l.kind === 'capital' || l.kind === 'temple' ? [255, 40, 40] : [255, 220, 0];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        const o = (y * SIZE + x) * 3;
        rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
      }
    }
    writeFileSync(OUT!, encodePNG(SIZE, SIZE, rgb));
    const ms = performance.now() - t0;
    console.log(`map ${SIZE}x${SIZE} in ${ms.toFixed(0)}ms; maxH=${maxH.toFixed(1)}; per-sample ~${((ms * 1000) / (SIZE * SIZE * 6)).toFixed(2)}us`);
  }, 300000);
});
