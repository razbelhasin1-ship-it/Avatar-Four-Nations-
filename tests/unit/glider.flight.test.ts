import { describe, expect, it } from 'vitest';
import { GLIDER, gust, newGliderState, stepGlider, type GliderState } from '../../src/player/glider/flight';
import { columnFromSpot, UPDRAFT, updraftLift } from '../../src/player/glider/Updrafts';

const DT = 1 / 60;

/** Fly for `seconds`, returning the height gained (m, negative = lost) and the last velocity. */
function fly(s: GliderState, seconds: number, input = { dive: false, updraft: 0 }) {
  let dy = 0;
  let dx = 0;
  let v = { vy: 0, vh: 0 };
  for (let t = 0; t < seconds; t += DT) {
    v = stepGlider(s, input, DT);
    dy += v.vy * DT;
    dx += v.vh * DT;
  }
  return { dy, dx, v };
}

describe('glider flight model', () => {
  it('settles into a slow, flat glide from any speed (about 8 m forward per metre lost)', () => {
    for (const start of [9, 15, 30]) {
      const s = newGliderState(start);
      fly(s, 30);
      expect(s.speed).toBeGreaterThan(GLIDER.cruiseSpeed - 1.5);
      expect(s.speed).toBeLessThan(GLIDER.cruiseSpeed + 1.5);
      const { dy, dx, v } = fly(s, 10);
      expect(v.vy).toBeLessThan(0);
      expect(v.vy).toBeGreaterThan(-2.5);
      expect(dx / -dy).toBeGreaterThan(7);
      expect(dx / -dy).toBeLessThan(11);
    }
  });

  it('dives fast, then swoops back up when the dive is released', () => {
    const s = newGliderState(15);
    const dive = fly(s, 6, { dive: true, updraft: 0 });
    expect(s.speed).toBeGreaterThan(28);
    expect(dive.v.vy).toBeLessThan(-15);
    // Let go: the excess speed pitches the nose up into a climb that trades speed for height.
    let y = 0;
    let peak = 0;
    for (let t = 0; t < 5; t += DT) {
      y += stepGlider(s, { dive: false, updraft: 0 }, DT).vy * DT;
      peak = Math.max(peak, y);
    }
    expect(peak).toBeGreaterThan(12);
    expect(s.speed).toBeLessThan(20);
  });

  it('recovers from a stall by dropping the nose', () => {
    const s = newGliderState(10);
    s.speed = 5;
    s.pitch = 0.3;
    fly(s, 3);
    expect(s.speed).toBeGreaterThan(GLIDER.stallSpeed);
  });

  it('a gust of wind lifts the glider a few metres, once per cooldown', () => {
    const a = newGliderState(15);
    const b = newGliderState(15);
    fly(a, 20);
    fly(b, 20);
    expect(gust(b)).toBe(true);
    expect(gust(b)).toBe(false);
    const without = fly(a, 3).dy;
    const withGust = fly(b, 3).dy;
    expect(withGust - without).toBeGreaterThan(3);
    expect(gust(b)).toBe(true);
  });

  it('rises in an updraft column', () => {
    const s = newGliderState(15);
    fly(s, 10);
    const r = fly(s, 5, { dive: false, updraft: GLIDER.updraftLift });
    expect(r.dy).toBeGreaterThan(20);
  });
});

describe('updraft columns', () => {
  const col = columnFromSpot({ x: 100, z: -50, y: 300, r: 9 }, () => 0);

  it('are wide enough to circle in at full stick', () => {
    // At full stick the glider turns on a radius of speed / turn rate.
    const turnRadius = GLIDER.cruiseSpeed / GLIDER.turnRate;
    expect(col.radius).toBeGreaterThanOrEqual(UPDRAFT.minRadius);
    expect(col.radius).toBeGreaterThan(turnRadius * 1.4);
    expect(columnFromSpot({ x: 0, z: 0 }, () => 42).base).toBe(42);
  });

  it('lift hardest in the core, fading out at the rim, below the foot and near the top', () => {
    const at = (dx: number, y: number) => updraftLift([col], col.x + dx, y, col.z);
    expect(at(0, 340)).toBeCloseTo(GLIDER.updraftLift);
    expect(at(col.radius * 0.5, 340)).toBeCloseTo(GLIDER.updraftLift);
    expect(at(col.radius * 0.8, 340)).toBeGreaterThan(0);
    expect(at(col.radius * 0.8, 340)).toBeLessThan(GLIDER.updraftLift);
    expect(at(col.radius * 1.01, 340)).toBe(0);
    expect(at(0, col.base - UPDRAFT.below - 1)).toBe(0);
    expect(at(0, col.base - UPDRAFT.below / 2)).toBeLessThan(GLIDER.updraftLift);
    expect(at(0, col.top - 5)).toBeLessThan(GLIDER.updraftLift * 0.2);
    expect(at(0, col.top + 1)).toBe(0);
    // Lift never grows toward the rim.
    let last = Infinity;
    for (let d = 0; d <= col.radius; d += 0.5) {
      const l = at(d, 340);
      expect(l).toBeLessThanOrEqual(last + 1e-9);
      last = l;
    }
  });

  it('carry a glider circling at full stick well up, and give a straight pass a boost', () => {
    const lift = (x: number, y: number, z: number) => updraftLift([col], x, y, z);
    // Circle round the core on the full-stick radius.
    const s = newGliderState(GLIDER.cruiseSpeed);
    fly(s, 20);
    const R = GLIDER.cruiseSpeed / GLIDER.turnRate;
    let y = 340;
    let a = 0;
    for (let t = 0; t < 10; t += DT) {
      const v = stepGlider(s, { dive: false, updraft: lift(col.x + Math.cos(a) * R, y, col.z + Math.sin(a) * R) }, DT);
      y += v.vy * DT;
      a += (v.vh / R) * DT;
    }
    expect(y - 340).toBeGreaterThan(40);
    // Fly straight through the middle.
    const p = newGliderState(GLIDER.cruiseSpeed);
    fly(p, 20);
    let x = col.x - col.radius - 5;
    let yy = 340;
    while (x < col.x + col.radius + 5) {
      const v = stepGlider(p, { dive: false, updraft: lift(x, yy, col.z) }, DT);
      x += v.vh * DT;
      yy += v.vy * DT;
    }
    expect(yy - 340).toBeGreaterThan(6);
  });
});
