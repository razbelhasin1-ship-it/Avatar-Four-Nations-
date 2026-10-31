import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import { heightAt } from '../../../Heightfield';
import { am, faceYaw, pine, waterfall, type Kit } from '../parts';
import { rockSpireGeometry } from '../towers';
import { C, SEED, polar } from './layout';

/**
 * The ring of tall misty spires round the temple pinnacle — taller than its
 * summit, so the temple sits inside a crown of stone: [bearing°, distance,
 * base radius, top height (world y), waterfall]. Bearings keep clear of the
 * switchback trail, the trailhead and the bison meadow (≈ 185–260°) and of
 * the Shrine of the Four Winds (≈ 25–60° at 160 m).
 */
export const SPIRES: Array<[number, number, number, number, boolean]> = [
  [4, 250, 24, 515, true],
  [30, 330, 20, 488, false],
  [66, 262, 26, 548, false],
  [92, 360, 22, 575, true],
  [118, 248, 21, 500, false],
  [146, 320, 27, 560, false],
  [170, 280, 19, 478, true],
  [266, 300, 24, 552, false],
  [290, 236, 20, 494, true],
  [314, 330, 26, 590, false],
  [338, 268, 22, 530, false],
  // Farther ones for depth.
  [16, 560, 30, 610, false],
  [78, 620, 34, 640, false],
  [132, 540, 28, 600, false],
  [300, 590, 32, 625, false],
  [352, 470, 25, 565, false],
];

/** Tall rock spires topped with moss and pines, some with a waterfall falling into the clouds. */
export function buildSpireRing(k: Kit): void {
  const rnd = new Random(SEED + 77);
  SPIRES.forEach(([deg, d, r, topY, falls], i) => {
    const { x, z } = polar(deg, d);
    const base = Math.min(heightAt(x, z), 120) - 14;
    const h = topY - base;
    const g = rockSpireGeometry(i * 9.13 + 41, r, h);
    const yaw = rnd.range(0, 6.28);
    k.main.mesh(am('rockSpire'), g, { x, y: base, z, yaw });
    g.dispose();
    // Lean of the spire geometry (local +X).
    const lean = h * 0.07 * Math.sin(i * 9.13 + 41) * 0.5;
    const tx = x + Math.cos(yaw) * lean, tz = z - Math.sin(yaw) * lean;
    const rt = r * 0.5;
    const cap = new THREE.SphereGeometry(rt * 1.08, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.3, 1);
    k.main.mesh(am('foliage'), cap, { x: tx, y: topY - 0.6, z: tz });
    cap.dispose();
    const pines = d < 400 ? 5 : 3;
    for (let p = 0; p < pines; p++) {
      const a = rnd.range(0, 6.28), dd = rnd.range(0, rt * 0.7);
      pine(k, tx + Math.cos(a) * dd, topY + rt * 0.16, tz + Math.sin(a) * dd, p % 3, rnd.range(2.2, 3.4), rnd.range(0, 6), false);
    }
    // Moss streaks hanging off the rim.
    for (let m = 0; m < 6; m++) {
      const a = (m / 6) * Math.PI * 2 + rnd.range(-0.3, 0.3);
      const len = rnd.range(8, 22);
      k.main.box(am('foliage'), { x: tx + Math.cos(a) * rt * 0.98, y: topY - len / 2, z: tz + Math.sin(a) * rt * 0.98, sx: rnd.range(2, 4), sy: len, sz: 0.6, yaw: faceYaw(Math.cos(a), Math.sin(a)) });
    }
    for (let s = 0; s < 3; s++) {
      const t = (s + 0.5) / 3;
      k.main.collider({ shape: 'cylinder', x: x + (tx - x) * t, y: base + h * t, z: z + (tz - z) * t, r: r * 0.85 * (1 - 0.45 * t), hy: h / 6, walkable: true, solid: true, surface: 'rock' });
    }
    if (falls) {
      const a = Math.atan2(C.z - tz, C.x - tx) + rnd.range(-0.6, 0.6);
      const fx = Math.cos(a), fz = Math.sin(a);
      waterfall(k, { id: `air:sat_spire_falls_${i}`, label: 'Spire falls', x: tx + fx * rt * 0.85, y: topY - 1.6, z: tz + fz * rt * 0.85, yaw: faceYaw(fx, fz), width: 4 + r * 0.1, drop: Math.min(260, topY - 300), out: 3, register: false });
    }
  });
}
