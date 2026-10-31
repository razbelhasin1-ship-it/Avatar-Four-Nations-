import { heightAt } from '../../../Heightfield';
import { brazier, crest, roof } from '../parts';
import { crimsonMat } from '../materials';
import type { Cap } from './FireCapital';
import { FNC, PALACE, atAxis, atPolar } from './layout';
import { battlement } from './kit';

/**
 * The Royal Palace on its scorched hill inside a twelve-sided ring wall with guard towers.
 * (Phase 1: the ring wall, its towers and south gate, and the palace's central mass; the full
 * palace and its interiors come in phase 4.)
 */
export function* buildPalace(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const major = env.chunks.named('major', 'fnc_palace');
  const b = major.builder;
  const n = PALACE.sides;
  const R = PALACE.ringR;
  const gateHalf = 5;
  // Ring wall segments between the vertices (gap for the gate at the south, phi = 90).
  const vertex = (i: number) => atPolar(90 + (360 / n) * (i + 0.5), R);
  for (let i = 0; i < n; i++) {
    const a = vertex(i - 1), c = vertex(i);
    // The south segment (i = 0 spans phi 90 ± 15) holds the gate.
    const pieces = i === 0 ? [[a, atPolar(90 - 7.6, R)], [atPolar(90 + 7.6, R), c]] : [[a, c]];
    for (const [p, q] of pieces) {
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const yaw = Math.atan2(q.x - p.x, q.z - p.z);
      const base = Math.min(heightAt(p.x, p.z), heightAt(q.x, q.z)) - 1;
      b.box('stone_dark', { x: mx, y: base + (PALACE.wallH + 1) / 2, z: mz, sx: 2.2, sy: PALACE.wallH + 1, sz: len, yaw }, { collide: true, walkable: true });
      battlement(b, 'stone_dark', [p, q], { y: () => base + PALACE.wallH + 1, h: 0.9, thick: 0.6, cap: crimsonMat() as never });
    }
    // Guard tower at the vertex.
    const v = vertex(i);
    const vb = heightAt(v.x, v.z) - 1;
    b.block('stone_dark', { x: v.x, y: vb, z: v.z, sx: 5, sy: PALACE.wallH + 6, sz: 5 }, { collide: true, walkable: true });
    roof(b, { x: v.x, y: vb + PALACE.wallH + 8, z: v.z, w: 4.4, d: 4.4, h: 2.6, style: 'pyramid', mat: 'roof_red', trim: 'gold', tips: 0.4, finial: 1 });
    for (const [px, pz] of [[-1.9, -1.9], [1.9, -1.9], [1.9, 1.9], [-1.9, 1.9]] as const) b.box('wood_red', { x: v.x + px, y: vb + PALACE.wallH + 7, z: v.z + pz, sx: 0.3, sy: 2.2, sz: 0.3 });
    if (i % 3 === 0) yield;
  }
  // Main gate with the Fire Nation insignia.
  const g = atAxis(0, R);
  const gy = heightAt(g.x, g.z);
  for (const side of [-1, 1]) {
    const c = atAxis(side * (gateHalf + 2.5), R);
    b.block('stone_dark', { x: c.x, y: gy - 1, z: c.z, sx: 5, sy: 14, sz: 6 }, { collide: true, walkable: true });
    brazier(b, cap.flames, { x: c.x, y: gy, z: c.z + 4.6, size: 1.1 });
  }
  b.block(crimsonMat(), { x: g.x, y: gy + 8, z: g.z, sx: gateHalf * 2 + 0.2, sy: 5, sz: 6 }, { collide: true, walkable: true });
  roof(b, { x: g.x, y: gy + 14, z: g.z, w: 20, d: 8, h: 4, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 0.8, horns: 1.4, crest: 2 });
  crest(b, { x: g.x, y: gy + 10.5, z: g.z + 3.1, yaw: 0, size: 3.6 });
  cap.mark('palaceGate', g.x, gy, g.z);
  // Central mass (placeholder for phase 4).
  const top = FNC.hillY;
  b.block(crimsonMat(), { x: FNC.V.x, y: top, z: FNC.V.z, sx: 18, sy: 14, sz: 18 }, { collide: true, walkable: true });
  roof(b, { x: FNC.V.x, y: top + 14, z: FNC.V.z, w: 18, d: 18, h: 6, style: 'hip', mat: 'roof_red', trim: 'gold', tips: 1, horns: 1.8, crest: 2.4 });
  cap.mark('palace', FNC.V.x, top, FNC.V.z);
  yield;
}
