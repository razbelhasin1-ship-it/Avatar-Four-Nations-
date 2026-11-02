import { Random } from '../../../../core/Random';
import { WC, WC_GATE } from '../../../landforms/wolfCove';

/**
 * Wolf Cove's master layout (pure data, seeded): the zones by distance from the centre (fractions of
 * the wall's inner radius), the landmarks, the lanes and the generated igloo / tent placements.
 * Tweak the constants at the top; the builders (wall.ts, village.ts, shore.ts, life.ts) read this.
 *
 *   0–12%   Hearth Plaza and the Great Igloo
 *   12–40%  inner neighbourhoods: homes, the healer's igloo, workshops, the storytelling ring
 *   40–70%  Frozen Pond and training circle (east), drying racks and tannery (north), storage, dog pens
 *   70–95%  outer neighbourhoods: dense igloo clusters, sealskin tents, kayak racks
 *   95–100% the ring wall, its stair ramps and towers
 */
export const SWT = {
  seed: 4040,
  /** Generated dwellings. */
  igloos: 120,
  tents: 25,
  /** Enterable family igloos (the family igloo kit), chosen among the generated ones. */
  familyHomes: 7,
  /** Small domed towers on the wall (evenly spaced, the gate between two of them). */
  towers: 6,
  /** Stair ramps from the village floor to the wall top. */
  stairs: 6,
  /** Clear gap between dwellings (m): the lanes. */
  laneGap: [1.9, 2.7] as const,
  /** Simulated people and animals (scaled by the graphics "people" density). */
  people: 180,
  penguins: 26,
  seals: 9,
  dogs: 14,
} as const;

/** Wall inner radius (the zone fractions are of this). */
export const RI = WC.R - WC.wallT;
export const C = { x: WC.x, z: WC.z } as const;
export const FLOOR = WC.floor;

const at = (ang: number, frac: number) => ({ x: C.x + Math.sin(ang) * RI * frac, z: C.z - Math.cos(ang) * RI * frac });
/** Compass angle (0 = north, π/2 = east) of a point from the centre. */
export const bearing = (x: number, z: number): number => Math.atan2(x - C.x, -(z - C.z));

/** The Great Igloo: the council hall at the centre (its tunnel entrance faces north, to the gate). */
export const GREAT = { x: C.x, z: C.z + 5, r: 7, h: 8, tunnel: 4.2 } as const;
/** Hearth Plaza in front of the Great Igloo's entrance. */
export const PLAZA = { x: C.x, z: C.z - 13, r: 8.5 } as const;
/** The communal fire pit at the plaza's heart. */
export const HEARTH = { x: PLAZA.x - 1.5, z: PLAZA.z + 0.5 } as const;
/** Frozen Pond (east) with its thawed hole, and the training circle beside it. */
export const POND = { ...at(Math.PI / 2 + 0.12, 0.52), r: 6 } as const;
export const POND_HOLE = { x: POND.x - 1.6, z: POND.z + 1.2, r: 1.5 } as const;
export const TRAINING = { ...at(Math.PI / 2 - 0.2, 0.5), r: 6.5 } as const;
/** The healer's igloo (enterable), workshops (one enterable), the long storage igloo, dog pens. */
export const HEALER = { ...at(Math.PI * 0.62, 0.26), r: 3.2 } as const;
export const WORKSHOP = { ...at(-Math.PI * 0.42, 0.27), r: 3.4 } as const;
export const CARVERS = { ...at(-Math.PI * 0.6, 0.3), r: 3 } as const;
export const STORAGE = { ...at(-Math.PI * 0.78, 0.55), len: 14, w: 5, yaw: -Math.PI * 0.78 + Math.PI / 2 } as const;
export const DOG_PENS = { ...at(Math.PI * 1.38, 0.55), r: 6 } as const;
export const STORY_RING = { ...at(Math.PI * 1.08, 0.27), r: 4.2 } as const;
/** Drying racks and the tannery, north (either side of the processional path). */
export const RACKS_N = [at(-0.32, 0.5), at(0.34, 0.52), at(-0.5, 0.6), at(0.52, 0.62)] as const;
export const TANNERY = { ...at(-0.62, 0.45), r: 4 } as const;
/** Boat and sled repair yard near the gate (inside, north-east). */
export const BOATYARD = { ...at(0.4, 0.8), r: 5 } as const;
/** Chief Hakoda's post west of the plaza (quest giver), and the trader by the processional path. */
export const CHIEF = { x: PLAZA.x - 8, z: PLAZA.z + 4.5 } as const;
export const TRADER = { x: C.x + 7.5, z: WC_GATE.z + 34 } as const;
/** Master Aput's opening post at the Great Igloo's tunnel mouth. */
export const APUT_DOOR = { x: GREAT.x + 2.3, z: GREAT.z - GREAT.r - GREAT.tunnel - 1 } as const;

/** Wall towers (compass angles) and the stair ramps beside them. */
export const TOWER_ANGLES: number[] = Array.from({ length: SWT.towers }, (_, i) => (Math.PI * 2 * (i + 0.5)) / SWT.towers);
/** Gate towers either side of the north opening. */
export const GATE_TOWERS = [
  { x: WC_GATE.x - (WC.gateHalf + 3.2), z: WC_GATE.z + 1.2 },
  { x: WC_GATE.x + (WC.gateHalf + 3.2), z: WC_GATE.z + 1.2 },
] as const;

export interface Dwelling {
  kind: 'igloo' | 'tent';
  x: number;
  z: number;
  /** Footprint radius (m). */
  r: number;
  /** Entrance facing (yaw: local +Z points this way). */
  yaw: number;
  /** A smaller dome joined to the side (igloos). */
  annex: { x: number; z: number; r: number } | null;
  /** Enterable home (family igloo kit). */
  home: boolean;
  /** Ring the dwelling belongs to (lights, life). */
  ring: 'inner' | 'outer';
}

/** Clear zones the dwellings keep off: [x, z, r]. */
function reserved(): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [
    [GREAT.x, GREAT.z, GREAT.r + 3.2],
    [GREAT.x, GREAT.z - GREAT.r - GREAT.tunnel, 3.5],
    [PLAZA.x, PLAZA.z, PLAZA.r + 2],
    [POND.x, POND.z, POND.r + 3],
    [TRAINING.x, TRAINING.z, TRAINING.r + 2.5],
    [HEALER.x, HEALER.z, HEALER.r + 2.4],
    [WORKSHOP.x, WORKSHOP.z, WORKSHOP.r + 3.2],
    [CARVERS.x, CARVERS.z, CARVERS.r + 2.6],
    [DOG_PENS.x, DOG_PENS.z, DOG_PENS.r + 2.5],
    [STORY_RING.x, STORY_RING.z, STORY_RING.r + 2.4],
    [TANNERY.x, TANNERY.z, TANNERY.r + 2.4],
    [BOATYARD.x, BOATYARD.z, BOATYARD.r + 2],
    [CHIEF.x, CHIEF.z, 7],
    [TRADER.x, TRADER.z, 5.5],
  ];
  // The long storage igloo (a capsule) and the drying racks.
  for (let k = -2; k <= 2; k++) out.push([STORAGE.x + Math.cos(STORAGE.yaw) * k * 3, STORAGE.z - Math.sin(STORAGE.yaw) * k * 3, 4.2]);
  for (const r of RACKS_N) out.push([r.x, r.z, 4.6]);
  // Stair ramps along the inner face of the wall beside each tower.
  for (const a of TOWER_ANGLES) {
    const s = stairFoot(a);
    out.push([s.x, s.z, 4.5]);
  }
  return out;
}

/** Stair ramp from the floor up to the wall top beside a tower: its foot (floor) and head (wall top). */
export function stairFoot(towerAngle: number): { x: number; z: number; headX: number; headZ: number; yaw: number } {
  const a = towerAngle + 0.075;
  const rr = RI - 1.2;
  // Along the inner face (tangential), rising toward the tower.
  const hx = C.x + Math.sin(a) * rr, hz = C.z - Math.cos(a) * rr;
  const tx = Math.cos(a), tz = Math.sin(a); // tangent (clockwise seen from above)
  const len = 6.5;
  return { x: hx + tx * len, z: hz + tz * len, headX: hx, headZ: hz, yaw: Math.atan2(-tx, -tz) };
}

/** Is the point on the processional path (gate → plaza) or a radial lane? */
function onLane(x: number, z: number): boolean {
  if (Math.abs(x - C.x) < 4 && z < PLAZA.z + 2) return true; // processional path, 5 m wide + margins
  // The curving lane between the middle ring and the outer neighbourhoods; the other lanes are the
  // gaps the clusters leave (2–3 m).
  const d = Math.hypot(x - C.x, z - C.z);
  return Math.abs(d / RI - 0.7) * RI < 1.6;
}

/** The generated dwellings (seeded, deterministic). */
export function dwellings(): Dwelling[] {
  const rnd = new Random(SWT.seed);
  const res = reserved();
  const out: Dwelling[] = [];
  const free = (x: number, z: number, r: number, gap: number): boolean => {
    const d = Math.hypot(x - C.x, z - C.z);
    if (d + r > RI - 2.6 || d - r < GREAT.r + 4) return false;
    for (const [rx, rz, rr] of res) if (Math.hypot(x - rx, z - rz) < rr + r) return false;
    for (const o of out) {
      const need = o.r + r + gap;
      if (Math.abs(o.x - x) < need && Math.abs(o.z - z) < need && Math.hypot(o.x - x, o.z - z) < need) return false;
      if (o.annex && Math.hypot(o.annex.x - x, o.annex.z - z) < o.annex.r + r + gap * 0.8) return false;
    }
    // Keep the lanes clear (sample the footprint's rim).
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (onLane(x + Math.cos(a) * r * 0.9, z + Math.sin(a) * r * 0.9)) return false;
    }
    return !onLane(x, z);
  };
  // Cluster seeds in the inner (12–40%) and outer (70–95%) neighbourhoods, plus scattered fill in the
  // middle ring's north and south (40–70%) where the features leave room.
  const clusters: Array<{ x: number; z: number; ring: 'inner' | 'outer' }> = [];
  for (let i = 0; i < 26; i++) {
    const outer = i >= 8;
    const fr = outer ? 0.76 + rnd.next() * 0.14 : 0.18 + rnd.next() * 0.18;
    const a = rnd.next() * Math.PI * 2;
    clusters.push({ x: C.x + Math.sin(a) * RI * fr, z: C.z - Math.cos(a) * RI * fr, ring: outer ? 'outer' : 'inner' });
  }
  let tries = 0;
  const wantIgloos = SWT.igloos;
  let igloos = 0;
  while (igloos < wantIgloos && tries < 60000) {
    tries++;
    // Mostly round the cluster seeds (so the homes gather in clusters with lanes between), then any
    // free ground in the neighbourhoods once the seeds fill up.
    let x: number, z: number;
    if (tries < 30000) {
      const cl = clusters[tries % clusters.length];
      const spread = cl.ring === 'outer' ? 10 : 7;
      x = cl.x + (rnd.next() * 2 - 1) * spread;
      z = cl.z + (rnd.next() * 2 - 1) * spread;
    } else {
      const a = rnd.next() * Math.PI * 2, fr = Math.sqrt(0.03 + rnd.next() * 0.97);
      x = C.x + Math.sin(a) * RI * fr;
      z = C.z - Math.cos(a) * RI * fr;
    }
    const d = Math.hypot(x - C.x, z - C.z) / RI;
    // Mid ring (40–70%): lighter fill round the pond, racks, storage and pens.
    if (d > 0.41 && d < 0.69 && rnd.next() < 0.5) continue;
    const big = rnd.next();
    const r = big < 0.15 ? 2.6 + rnd.next() * 0.4 : big < 0.55 ? 2.05 + rnd.next() * 0.5 : 1.65 + rnd.next() * 0.45;
    const gap = SWT.laneGap[0] + rnd.next() * (SWT.laneGap[1] - SWT.laneGap[0]);
    if (!free(x, z, r, gap)) continue;
    // Entrance toward the village centre (and the inner lanes), with some variety.
    const toC = Math.atan2(C.x - x, C.z - z);
    const yaw = toC + (rnd.next() - 0.5) * 1.3;
    // Some igloos are joined to a smaller dome on one side.
    let annex: Dwelling['annex'] = null;
    if (r > 1.9 && rnd.next() < 0.3) {
      const side = (rnd.next() < 0.5 ? 1 : -1) * (Math.PI / 2 + (rnd.next() - 0.5) * 0.6);
      const ar = r * (0.5 + rnd.next() * 0.12);
      const ax = x + Math.sin(yaw + side) * (r + ar * 0.55), az = z + Math.cos(yaw + side) * (r + ar * 0.55);
      if (free(ax, az, ar, gap * 0.6)) annex = { x: ax, z: az, r: ar };
    }
    out.push({ kind: 'igloo', x, z, r, yaw, annex, home: false, ring: d < 0.5 ? 'inner' : 'outer' });
    igloos++;
  }
  // Sealskin tents: mostly in the outer neighbourhoods, a few inner.
  tries = 0;
  while (out.filter((d) => d.kind === 'tent').length < SWT.tents && tries < 30000) {
    tries++;
    const a = rnd.next() * Math.PI * 2;
    const fr = rnd.next() < 0.8 ? 0.74 + rnd.next() * 0.18 : 0.2 + rnd.next() * 0.18;
    const x = C.x + Math.sin(a) * RI * fr, z = C.z - Math.cos(a) * RI * fr;
    const r = 1.5 + rnd.next() * 0.55;
    const gap = SWT.laneGap[0] + rnd.next() * 0.6;
    if (!free(x, z, r, gap)) continue;
    out.push({ kind: 'tent', x, z, r, yaw: Math.atan2(C.x - x, C.z - z) + (rnd.next() - 0.5) * 1.6, annex: null, home: false, ring: fr < 0.5 ? 'inner' : 'outer' });
  }
  // Enterable family homes: roomy igloos without an annex, spread round the village.
  const roomy = out.filter((d) => d.kind === 'igloo' && d.r >= 2.4 && !d.annex);
  roomy.sort((a, b) => bearing(a.x, a.z) - bearing(b.x, b.z));
  const step = Math.max(1, Math.floor(roomy.length / SWT.familyHomes));
  for (let i = 0; i < roomy.length && roomy.filter((d) => d.home).length < SWT.familyHomes; i += step) roomy[i].home = true;
  return out;
}

/** Points on the ring lanes and radial lanes (for paths, lamps and the crowd's walking graph). */
export function laneRings(): number[] {
  return [RI * 0.405, RI * 0.7];
}
