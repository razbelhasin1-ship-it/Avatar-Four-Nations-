import type { P2 } from '../../../WorldLayout';
import type { Cap } from './FireCapital';
import { CONFIG, FNC, PLAZA, atAxis, atPolar, cityBlocked, footR, ringR, spokeBearings } from './layout';
import { drapedStrip } from './kit';

/**
 * Harbor City: radial around the volcano — ring streets and spokes, the Royal Way up the axis
 * from the plaza's passage to the start of Sozin's road. (Phase 1: the street network; houses,
 * markets, foundries, Zoryu Park and the hill districts are phase 2.)
 */

/** Split a polyline into runs that avoid blocked ground. */
export function openRuns(pts: P2[]): P2[][] {
  const out: P2[][] = [];
  let cur: P2[] = [];
  for (const p of pts) {
    if (cityBlocked(p.x, p.z)) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Ring street k as a polyline across the city's sector. */
export function ringPolyline(k: number, step = 2): P2[] {
  const C = FNC.city;
  const pts: P2[] = [];
  for (let a = C.phi0; a <= C.phi1 + 0.01; a += step) pts.push(atPolar(a, ringR(k, a)));
  return pts;
}

/** Spoke street at bearing a (from the volcano's foot outward). */
export function spokePolyline(a: number): P2[] {
  const pts: P2[] = [];
  const r0 = footR(a) + 4, r1 = footR(a) + CONFIG.ringOffsets[CONFIG.ringOffsets.length - 1] + 26;
  for (let r = r0; r <= r1; r += 4) pts.push(atPolar(a, r));
  return pts;
}

export function* buildCity(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const pave = 'paving' as const;
  // Ring streets.
  for (let k = 0; k < CONFIG.ringOffsets.length; k++) {
    const b = env.chunks.named('major', `fnc_ring${k}`).builder;
    for (const run of openRuns(ringPolyline(k))) drapedStrip(b, pave, run, CONFIG.ringW, { tile: 4 });
    yield;
  }
  // Spokes (the Royal Way is wider and built separately).
  {
    const b = env.chunks.named('major', 'fnc_spokes').builder;
    for (const a of spokeBearings()) {
      if (Math.abs(a - 90) < 1) continue;
      for (const run of openRuns(spokePolyline(a))) drapedStrip(b, pave, run, CONFIG.spokeW, { tile: 4 });
    }
    yield;
  }
  // The Royal Way: from the top of the plaza passage up the axis to the start of Sozin's road.
  {
    const b = env.chunks.named('major', 'fnc_royal_way').builder;
    const pts: P2[] = [];
    for (let s = PLAZA.tower.topS + 1; s >= FNC.road.s0 + 8; s -= 4) pts.push(atAxis(0, s));
    drapedStrip(b, 'stone_tan', pts, CONFIG.wayW, { tile: 5, across: 6 });
    const top = atAxis(0, FNC.road.s0 + 8);
    cap.mark('royalWayTop', top.x, 0, top.z);
  }
  // East gate road (from the Western Causeway's island end into the ring streets).
  {
    const b = env.chunks.named('major', 'fnc_east_road').builder;
    const pts: P2[] = [{ x: -940, z: 960 }, { x: -968, z: 968 }, { x: -996, z: 978 }];
    drapedStrip(b, pave, pts, 8, { tile: 4 });
    cap.mark('eastGate', -968, 0, 968);
  }
}
