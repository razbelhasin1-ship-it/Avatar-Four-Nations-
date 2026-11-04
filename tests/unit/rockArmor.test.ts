import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Appearance } from '../../src/character/Appearance';
import { buildArmorGeometries } from '../../src/vfx/effects/rockArmor';

/** Rock Armor plates are generated from the body's proportions: every shape must build cleanly. */

const look = (frame: Appearance['frame'], body: 'male' | 'female', build: number) => ({ frame, body, build, height: 1 }) as unknown as Appearance;

function check(g: THREE.BufferGeometry, part: string): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  expect(pos.count, part).toBeGreaterThan(20);
  expect(col.count, part).toBe(pos.count);
  let finite = true;
  for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) finite = false;
  expect(finite, `${part} positions finite`).toBe(true);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < col.array.length; i++) {
    lo = Math.min(lo, col.array[i]);
    hi = Math.max(hi, col.array[i]);
  }
  expect(lo, `${part} colour`).toBeGreaterThanOrEqual(0);
  expect(hi, `${part} colour`).toBeLessThanOrEqual(1.3);
  const tris = g.index ? g.index.count / 3 : pos.count / 3;
  expect(tris, part).toBeGreaterThan(10);
  g.computeBoundingSphere();
  const bs = g.boundingSphere!;
  // Plates sit on their bone: nothing wanders off or balloons.
  expect(bs.radius, part).toBeLessThan(0.45);
  expect(bs.center.length(), part).toBeLessThan(0.45);
}

describe('rock armor plates', () => {
  it('builds all 22 plates, intact and cracked, for every frame, body and build', () => {
    for (const frame of ['slim', 'average', 'athletic', 'broad'] as const) {
      for (const body of ['male', 'female'] as const) {
        for (const build of [0, 1]) {
          const plates = buildArmorGeometries(look(frame, body, build));
          expect(plates.length).toBe(22);
          expect(new Set(plates.map((p) => p.part)).size).toBe(22);
          for (const p of plates) {
            check(p.intact, `${frame}/${body}/${build}/${p.part}`);
            check(p.cracked, `${frame}/${body}/${build}/${p.part} (cracked)`);
            p.intact.dispose();
            p.cracked.dispose();
          }
        }
      }
    }
  }, 60000);

  it('fits the body: a broad frame gets a bigger chest plate than a slim one', () => {
    const size = (frame: Appearance['frame']) => {
      const chest = buildArmorGeometries(look(frame, 'male', 0.5)).find((p) => p.part === 'chest')!.intact;
      chest.computeBoundingBox();
      return chest.boundingBox!.max.x - chest.boundingBox!.min.x;
    };
    expect(size('broad')).toBeGreaterThan(size('slim') + 0.02);
  });

  it('the helmet leaves the face open: nothing in front of the eyes', () => {
    const helmet = buildArmorGeometries(look('average', 'male', 0.5)).find((p) => p.part === 'helmet')!.intact;
    const pos = helmet.getAttribute('position') as THREE.BufferAttribute;
    // Head bone space: eyes ~0.1 above the bone, the face in front (+z); the visor stays above them.
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (z > 0.08 && Math.abs(x) < 0.05) expect(y, 'helmet over the face').toBeGreaterThan(0.13);
    }
  });
});
