import { describe, expect, it } from 'vitest';
import { heightAt } from '../../src/world/Heightfield';
import { ROADS } from '../../src/world/WorldLayout';
import { CAUSEWAY, causewayDeckY, causewayPoint } from '../../src/world/regions/fire/causeway';
import { onCausewayLanding } from '../../src/world/regions/fire/fnc/city';
import { polarOf, ringR, spokeBearings } from '../../src/world/regions/fire/fnc/layout';

/**
 * The Western Causeway lands inside Harbor City's outer rings: the ground meets the deck's end, an
 * avenue leads on to the streets, and the rows of houses leave the bridge and the avenue open.
 */
describe('Western Causeway landing in Harbor City', () => {
  const avenue = ROADS.find((r) => r.id === 'fire_causeway_road')!;
  const start = avenue.points[0], end = avenue.points[avenue.points.length - 1];
  const along = (u: number) => ({ x: start.x + (end.x - start.x) * u, z: start.z + (end.z - start.z) * u });

  it('the avenue starts at the bridge end and meets a ring street where a spoke crosses it', () => {
    expect(Math.hypot(start.x - CAUSEWAY.b.x, start.z - CAUSEWAY.b.z)).toBeLessThan(0.01);
    const q = polarOf(end.x, end.z);
    expect(Math.abs(q.r - ringR(2, q.phi))).toBeLessThan(0.5);
    expect(spokeBearings().some((a) => Math.abs(a - q.phi) < 0.1)).toBe(true);
  });

  it('the ground meets the deck: an easy step at its end, never through it', () => {
    const top = causewayDeckY(CAUSEWAY.len);
    const step = top - heightAt(CAUSEWAY.b.x, CAUSEWAY.b.z);
    expect(step).toBeGreaterThan(0.03);
    expect(step).toBeLessThan(0.3);
    for (let s = CAUSEWAY.len - 90; s <= CAUSEWAY.len; s += 1) {
      for (const lat of [-4.5, 0, 4.5]) {
        const p = causewayPoint(s, lat);
        expect(heightAt(p.x, p.z), `ground under the deck at s ${s}, lat ${lat}`).toBeLessThan(p.y - 0.03);
      }
    }
  });

  it('the avenue is level (no climb to the streets)', () => {
    let prev = heightAt(start.x, start.z);
    const L = Math.hypot(end.x - start.x, end.z - start.z);
    for (let u = 0.05; u <= 1.0001; u += 0.05) {
      const p = along(u);
      const y = heightAt(p.x, p.z);
      expect(Math.abs(y - prev) / (L * 0.05), `grade at ${u.toFixed(2)}`).toBeLessThan(0.06);
      prev = y;
    }
  });

  it('houses keep off the bridge and the avenue, not off the rest of the city', () => {
    const yaw = Math.atan2(end.x - start.x, end.z - start.z);
    const mid = along(0.5);
    const deck = causewayPoint(CAUSEWAY.len - 40);
    // A 10 × 8 m house on the avenue, on the deck over the city, or beside the deck: refused.
    expect(onCausewayLanding(mid.x, mid.z, 10, 8, yaw)).toBe(true);
    expect(onCausewayLanding(deck.x, deck.z, 10, 8, yaw)).toBe(true);
    const beside = causewayPoint(CAUSEWAY.len - 20, 12);
    expect(onCausewayLanding(beside.x, beside.z, 10, 8, yaw)).toBe(true);
    // Well clear of both: allowed.
    const off = causewayPoint(CAUSEWAY.len - 20, 22);
    expect(onCausewayLanding(off.x, off.z, 10, 8, yaw)).toBe(false);
    const nx = -(end.z - start.z), nz = end.x - start.x;
    const n = Math.hypot(nx, nz);
    expect(onCausewayLanding(mid.x + (nx / n) * 20, mid.z + (nz / n) * 20, 10, 8, yaw)).toBe(false);
    expect(onCausewayLanding(-1100, 900, 10, 8, 0)).toBe(false);
  });
});
