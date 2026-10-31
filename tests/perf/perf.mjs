#!/usr/bin/env node
/**
 * Performance probe: FPS / frame time / draw calls / triangles / entities at key
 * locations for a given preset. Software WebGL numbers are only comparative.
 *
 *   node tests/perf/perf.mjs [preset=low] [width=960] [height=540]
 */
import { launch } from '../../scripts/harness.mjs';

const preset = process.argv[2] ?? 'low';
const width = Number(process.argv[3] ?? 960);
const height = Number(process.argv[4] ?? 540);
const SPOTS = [
  ['Northern Water Tribe plaza', 'water', -250, -1560],
  ['Ba Sing Se lower ring', 'earth', 640, -30],
  ['Fire Nation plaza', 'fire', -1300, 1596],
  ['Air Temple summit', 'air', 1440, 1290],
  ['Earth Kingdom farmland', 'earth', 300, 150],
  ['Foggy Swamp', 'water', -1100, -120],
  ['Si Wong Desert', 'fire', 250, 950],
];

const h = await launch({ width, height, preset });
const rows = [];
try {
  await h.newGame('water');
  for (const [name, el, x, z] of SPOTS) {
    await h.eval((g, el, x, z) => {
      g.setElement(el);
      g.teleport(x, z);
      g.freezeTime(true);
      g.setTime(11);
    }, el, x, z);
    // Let streaming settle, then sample real frames.
    await h.step(30);
    await h.wait(2500);
    const s = await h.state();
    rows.push({ name, fps: +s.render.fps.toFixed(1), ms: +s.render.frameMs.toFixed(1), calls: s.render.drawCalls, tris: s.render.triangles, geos: s.render.geometries, tex: s.render.textures, ent: s.entities, particles: s.particles });
  }
} finally {
  console.log(`preset=${preset} ${width}x${height}`);
  console.table(rows);
  if (h.errors.length) console.log('ERRORS:\n' + h.errors.slice(0, 10).join('\n'));
  await h.close();
}
