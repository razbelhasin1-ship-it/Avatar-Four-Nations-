import { describe, expect, it } from 'vitest';
import { RAIL, RAIL_LINES, TRAINS } from '../../src/world/regions/earth/bssLayout';
import { stationsOf, trackOffset } from '../../src/world/regions/earth/bssRail';
import { Schedule, type TrainPos } from '../../src/world/regions/earth/bssTrains';
import { railPath } from '../../src/world/regions/earth/bssWalls';

const pos = (): TrainPos => ({ s: 0, dir: 1, moving: false, station: null, kick: 0, dwellT: 0, td: 0 });

describe('Ba Sing Se monorail timetables', () => {
  const lines = RAIL_LINES.map((line) => {
    const path = railPath(line.id);
    const sts = stationsOf(line);
    return { line, path, sts, sched: new Schedule(line, path, sts) };
  });

  it('every line keeps a 60-90 s headway and 6-9 trains run in total', () => {
    let total = 0;
    for (const { line, sched } of lines) {
      const headway = line.kind === 'shuttle' ? sched.period / line.trains : sched.period / line.trains;
      expect(headway, `${line.id} headway`).toBeGreaterThanOrEqual(60);
      expect(headway, `${line.id} headway`).toBeLessThanOrEqual(90);
      total += line.trains;
    }
    expect(total).toBeGreaterThanOrEqual(6);
    expect(total).toBeLessThanOrEqual(9);
  });

  it('stops 15-20 s at every station and never exceeds a sane speed', () => {
    for (const { sched } of lines) {
      for (const l of sched.legs) {
        expect(l.td).toBeGreaterThanOrEqual(15);
        expect(l.td).toBeLessThanOrEqual(20);
      }
      const a = pos(), b = pos();
      for (let u = 0; u < sched.period; u += 0.1) {
        sched.at(u, a);
        sched.at(u + 0.1, b);
        let d = Math.abs(b.s - a.s);
        if (sched.path.closed && d > sched.path.total / 2) d = sched.path.total - d;
        expect(d / 0.1).toBeLessThan(TRAINS.cruise * 1.45);
      }
    }
  });

  it('trains of a line never share a stretch of track (5 minutes, 0.25 s steps)', () => {
    const maxLen = 5 * RAIL.carLen + 4 * 0.7;
    for (const { line, path, sched } of lines) {
      const a = pos(), b = pos();
      for (let i = 0; i < line.trains; i++) {
        for (let j = i + 1; j < line.trains; j++) {
          for (let t = 0; t < 300; t += 0.25) {
            sched.at(t + (sched.period * i) / line.trains, a);
            sched.at(t + (sched.period * j) / line.trains, b);
            let gap = Math.abs(a.s - b.s);
            if (path.closed) gap = Math.min(gap, path.total - gap);
            const sameTrack = Math.sign(trackOffset(line, path, a.s, a.dir)) === Math.sign(trackOffset(line, path, b.s, b.dir));
            if (sameTrack) expect(gap, `${line.id} trains ${i}/${j} at t=${t}`).toBeGreaterThan(maxLen + 2);
          }
        }
      }
    }
  });
});
