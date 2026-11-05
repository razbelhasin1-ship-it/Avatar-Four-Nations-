import { describe, expect, it } from 'vitest';
import { getLakeRuntime, getRiverRuntime, heightAt, MARSH } from '../../src/world/Heightfield';
import { WorldHeightTexture } from '../../src/world/env/WorldHeightTexture';
import { WORLD_HALF } from '../../src/world/WorldLayout';

/**
 * Shorelines: the ground has to cross the water level smoothly where lakes and rivers meet the land.
 * A step at the edge is rendered by the 2 m terrain grid as a strip of triangles, and the waterline
 * then runs through the middle of a staircase of grid cells (the jagged pond edge in the tutorial).
 */

describe('lake shores', () => {
  it('cross the water level without a step, right at the lake radius', () => {
    for (const l of getLakeRuntime()) {
      if (l.def.frozen) continue;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const at = (d: number) => heightAt(l.def.x + Math.cos(a) * d, l.def.z + Math.sin(a) * d);
        // Sampled 5 mm apart around the waterline: a slope moves a few millimetres between samples
        // (even a mountain tarn's steep cirque), a step jumps by its full height (the old edge: 70 cm).
        let prev = at(l.def.r - 0.7);
        let maxJump = 0;
        for (let u = -0.695; u <= 0.7; u += 0.005) {
          const h = at(l.def.r + u);
          maxJump = Math.max(maxJump, Math.abs(h - prev));
          prev = h;
        }
        expect(maxJump, `${l.def.id} @ ${k}`).toBeLessThan(0.1);
        // (A lake inside the swamp shares its shore with the marsh, which is carved after lakes; touching
        // basins share their water.)
        if (Math.hypot(l.def.x - MARSH.x, l.def.z - MARSH.z) < MARSH.r) continue;
        const ox = l.def.x + Math.cos(a) * (l.def.r + 1), oz = l.def.z + Math.sin(a) * (l.def.r + 1);
        if (getLakeRuntime().some((o) => o !== l && Math.hypot(ox - o.def.x, oz - o.def.z) < o.def.r + 1.5)) continue;
        expect(at(l.def.r - 1), `${l.def.id} @ ${k} under water inside`).toBeLessThan(l.level);
        expect(at(l.def.r + 1), `${l.def.id} @ ${k} dry outside`).toBeGreaterThan(l.level);
      }
    }
  });
});

describe('river banks', () => {
  it('cross the water level without a step at the channel edge', () => {
    let checked = 0;
    for (const r of getRiverRuntime()) {
      if (r.frozen) continue;
      for (let s = r.spacing * 3; s < r.line.length - r.spacing * 3; s += Math.max(40, r.line.length / 12)) {
        // A waterfall drops the river's surface: its banks step with it.
        if (r.falls.some((f) => Math.abs(f.s - s) < r.spacing * 4)) continue;
        const p = r.line.pointAt(s);
        const t = r.line.tangentAt(s);
        const nx = -t.z, nz = t.x;
        const half = r.width(s) * 0.5;
        for (const side of [-1, 1]) {
          const at = (d: number) => heightAt(p.x + nx * d * side, p.z + nz * d * side);
          // Inside a tight bend the nearest point of the river can jump to another reach: skip.
          const ss = new Float64Array(1);
          let bend = false;
          for (const d of [half - 0.6, half + 0.6]) {
            r.line.distance(p.x + nx * d * side, p.z + nz * d * side, ss);
            if (Math.abs(ss[0] - s) > 1.5) bend = true;
          }
          if (bend) continue;
          // A river mouth running out over the seabed: its channel edge drops steeply into deep water.
          if (at(half - 0.6) < r.surface(s) - 1.0) continue;
          let prev = at(half - 0.6);
          let maxJump = 0;
          for (let u = -0.595; u <= 0.6; u += 0.005) {
            const h = at(half + u);
            maxJump = Math.max(maxJump, Math.abs(h - prev));
            prev = h;
          }
          // Other features (roads, bridges, plateaus) can cut a bank; the river's own edge never steps
          // (5 mm apart: the old edge jumped 0.75 m between two samples; a river mouth running out over
          // the seabed drops steeply, but smoothly).
          if (maxJump < 0.6) {
            expect(maxJump, `${r.id} s=${s.toFixed(0)} side ${side}`).toBeLessThan(0.1);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('world height texture', () => {
  it('sends the whole map first, then only changed rows, in the units three.js reads', () => {
    const t = new WorldHeightTexture(64);
    const texel = t.texel;
    const heights = new Float32Array(35 * 35).fill(5);
    const x0 = -WORLD_HALF + 2 * texel, z0 = -WORLD_HALF + 3 * texel;
    t.writeChunk(x0, z0, 64, 2, heights, 35);
    t.flush();
    // Not uploaded yet: a whole upload (ranges would upload only themselves).
    expect(t.texture.updateRanges.length).toBe(0);
    t.texture.onUpdate?.(t.texture);
    t.writeChunk(x0, z0, 64, 2, heights, 35);
    t.flush();
    const r = t.texture.updateRanges;
    expect(r.length).toBe(1);
    // three.js counts update ranges in RGBA components: start / 4 is the first texel, count / 4 texels.
    expect(r[0].start / 4).toBe(3 * t.res + 2);
    expect(r[0].count / 4).toBe(1);
    // Moving the window means a whole upload again.
    t.setWindow(-100, -100);
    t.writeChunk(-100, -100, 64, 2, heights, 35);
    t.flush();
    expect(t.texture.updateRanges.length).toBe(0);
    t.dispose();
  });
});
