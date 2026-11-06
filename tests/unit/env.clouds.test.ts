import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { RenderPipeline } from '../../src/render/Renderer';
import { CLOUD_FIELD } from '../../src/world/env/EnvShared';
import { createCloudNoiseTexture, SkySystem } from '../../src/world/Sky';

describe('cumulus clouds and their shadows', () => {
  const sky = new SkySystem({ scene: new THREE.Scene() } as unknown as RenderPipeline);
  const sun = new THREE.Vector3(0.3, 0.9, 0.2).normalize();

  it('normalises the cumulus field (texture alpha) over the full range', () => {
    const tex = createCloudNoiseTexture(64);
    const d = tex.image.data as Uint8Array;
    let lo = 255;
    let hi = 0;
    for (let i = 3; i < d.length; i += 4) {
      lo = Math.min(lo, d[i]);
      hi = Math.max(hi, d[i]);
    }
    expect(lo).toBe(0);
    expect(hi).toBe(255);
    tex.dispose();
  });

  it('shades the ground under clouds only, down to 1 - strength, and not at all with strength 0', () => {
    let min = 1;
    let max = 0;
    let shaded = 0;
    let n = 0;
    for (let x = -3000; x <= 3000; x += 125) {
      for (let z = -3000; z <= 3000; z += 125) {
        const v = sky.cloudSunAt(x, 20, z, sun, 0.7, 0.55);
        expect(v).toBeGreaterThanOrEqual(0.45 - 1e-9);
        expect(v).toBeLessThanOrEqual(1);
        expect(sky.cloudSunAt(x, 20, z, sun, 0.7, 0)).toBe(1);
        min = Math.min(min, v);
        max = Math.max(max, v);
        if (v < 0.75) shaded++;
        n++;
      }
    }
    // Patches of full shade and gaps of open sun, neither covering everything.
    expect(max).toBe(1);
    expect(min).toBeLessThan(0.5);
    expect(shaded / n).toBeGreaterThan(0.1);
    expect(shaded / n).toBeLessThan(0.9);
  });

  it('more cover shades more ground, and the shadows drift with the clouds', () => {
    const cover = (c: number) => {
      let s = 0;
      for (let x = -3000; x <= 3000; x += 150) for (let z = -3000; z <= 3000; z += 150) s += 1 - sky.cloudSunAt(x, 0, z, sun, c, 1);
      return s;
    };
    expect(cover(0.9)).toBeGreaterThan(cover(0.5));
    expect(cover(0.5)).toBeGreaterThan(cover(0.15));
    // Drifting the sky moves the shadow pattern with the clouds (the cumulus follows CLOUD_FIELD.drift
    // of the offset): the same shade, that far downwind.
    sky.cloudOffset.set(0, 0);
    const a = sky.cloudSunAt(400, 0, -250, sun, 0.6, 1);
    sky.cloudOffset.set(0.05, 0);
    const b = sky.cloudSunAt(400 - 0.05 * CLOUD_FIELD.drift * CLOUD_FIELD.scale, 0, -250, sun, 0.6, 1);
    expect(b).toBeCloseTo(a, 6);
    sky.cloudOffset.set(0, 0);
  });
});
