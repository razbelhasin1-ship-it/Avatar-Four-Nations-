import { Random } from '../../../core/Random';
import { inCity, TUNE, type DistrictSpec, type Rect, type Side } from './nwtLayout';

/**
 * Seeded street-maze generator for the Agna Qel'a districts (pure data, no
 * three.js). A district rectangle is cut by forced lanes (through bridges,
 * stairs and gates), then recursively split by alleys — some stopping short
 * into dead ends — until blocks are small; blocks are filled with rows of
 * 2-4 storey buildings, back to back when deep, or become a small courtyard
 * ringed by houses. Some alleys pass under a building (an arched passage).
 *
 * Every block keeps track of which sides face a walkway, so alleys always
 * start from a walkable end and the maze stays connected (verified by
 * tests/unit/agna.test.ts with a flood fill).
 */

export type RoofKind = 'crenel' | 'dome' | 'tier' | 'vault' | 'flat';

export interface PlanBuilding {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  floors: number;
  /** Wall height above y (m). */
  h: number;
  roof: RoofKind;
  /** Facades with windows (facing an alley, court, quay or view). */
  open: Record<Side, boolean>;
  /** Door side (always on a walkable side), or null. */
  door: Side | null;
  /** Small tiered tower rising from a corner. */
  tower: boolean;
  balcony: Side | null;
  seed: number;
}

export interface PlanLane {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  kind: 'lane' | 'alley' | 'court';
  along: 'x' | 'z';
}

/** A building bridging an alley: the passage below is open (bottom above head height). */
export interface PlanSpan {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  bottom: number;
  top: number;
  along: 'x' | 'z';
}

export interface PlanLamp {
  x: number;
  z: number;
  y: number;
  /** 'wall' = lantern on a bracket at a facade (yaw faces out of the wall); 'hang' = lantern strung across an alley. */
  kind: 'wall' | 'hang';
  yaw: number;
  /** Width of the alley for hanging lanterns. */
  span?: number;
}

export interface DistrictPlan {
  id: string;
  spec: DistrictSpec;
  buildings: PlanBuilding[];
  lanes: PlanLane[];
  spans: PlanSpan[];
  lamps: PlanLamp[];
  /** Walk routes along lanes (citizens patrol them). */
  routes: Array<Array<[number, number]>>;
}

type Sides = Record<Side, boolean>;

interface Block {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Side faces open space (windows). */
  open: Sides;
  /** Side is walkable (doors, alley ends). */
  walk: Sides;
}

const ALL: Side[] = ['n', 's', 'w', 'e'];

export function planDistrict(spec: DistrictSpec): DistrictPlan {
  const rnd = new Random(spec.seed);
  const [x0, z0, x1, z1] = spec.rect;
  const sideState = (s: Side) => (spec.blind?.includes(s) ? 'blind' : spec.view?.includes(s) ? 'view' : 'walk');
  const root: Block = {
    x0,
    z0,
    x1,
    z1,
    open: Object.fromEntries(ALL.map((s) => [s, sideState(s) !== 'blind'])) as Sides,
    walk: Object.fromEntries(ALL.map((s) => [s, sideState(s) === 'walk'])) as Sides,
  };
  const lanes: PlanLane[] = [];
  let blocks: Block[] = [root];

  // 1. Forced lanes (full length): through bridges, stairs and gates.
  for (const z of spec.lanesX ?? []) blocks = blocks.flatMap((b) => cutX(b, z, TUNE.lane, lanes, 'lane'));
  for (const x of spec.lanesZ ?? []) blocks = blocks.flatMap((b) => cutZ(b, x, TUNE.lane, lanes, 'lane'));

  // 2. Recursive alleys.
  const leaves: Block[] = [];
  const stack = [...blocks];
  while (stack.length) {
    const b = stack.pop()!;
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    if (Math.max(w, d) <= TUNE.blockMax) {
      leaves.push(b);
      continue;
    }
    const aw = Math.max(w, d) > 2.4 * TUNE.blockMax ? TUNE.lane : rnd.range(TUNE.alley[0], TUNE.alley[1]);
    // An alley along x needs a walkable west or east end; along z a walkable north or south end.
    const canX = (b.walk.w || b.walk.e) && d >= 2 * 5 + aw;
    const canZ = (b.walk.n || b.walk.s) && w >= 2 * 5 + aw;
    let alongX = d > w ? canX : !canZ && canX;
    if (!canX && !canZ) {
      leaves.push(b);
      continue;
    }
    if (alongX && !canX) alongX = false;
    const span = alongX ? d : w;
    const c = (alongX ? b.z0 : b.x0) + span * rnd.range(0.38, 0.62);
    const a0 = c - aw / 2, a1 = c + aw / 2;
    const len = alongX ? w : d;
    const kind: PlanLane['kind'] = aw >= TUNE.lane ? 'lane' : 'alley';
    if (rnd.chance(TUNE.deadEnds) && len > 16) {
      // Dead end: the alley runs in from a walkable end and stops against the
      // far part of the block (a T split: two short blocks beside the alley, one
      // full block beyond its end).
      const stop = len * rnd.range(0.5, 0.78);
      if (alongX) {
        const fromW = b.walk.w && (!b.walk.e || rnd.chance(0.5));
        const sx = fromW ? b.x0 + stop : b.x1 - stop;
        const lx0 = fromW ? b.x0 : sx, lx1 = fromW ? sx : b.x1;
        const cut: Side = fromW ? 'e' : 'w';
        lanes.push({ x0: lx0, z0: a0, x1: lx1, z1: a1, kind, along: 'x' });
        stack.push(
          { x0: lx0, z0: b.z0, x1: lx1, z1: a0, open: { ...b.open, s: true, [cut]: false }, walk: { ...b.walk, s: true, [cut]: false } },
          { x0: lx0, z0: a1, x1: lx1, z1: b.z1, open: { ...b.open, n: true, [cut]: false }, walk: { ...b.walk, n: true, [cut]: false } },
          { x0: fromW ? sx : b.x0, z0: b.z0, x1: fromW ? b.x1 : sx, z1: b.z1, open: { ...b.open, [fromW ? 'w' : 'e']: false }, walk: { ...b.walk, [fromW ? 'w' : 'e']: false } },
        );
      } else {
        const fromN = b.walk.n && (!b.walk.s || rnd.chance(0.5));
        const sz = fromN ? b.z0 + stop : b.z1 - stop;
        const lz0 = fromN ? b.z0 : sz, lz1 = fromN ? sz : b.z1;
        const cut: Side = fromN ? 's' : 'n';
        lanes.push({ x0: a0, z0: lz0, x1: a1, z1: lz1, kind, along: 'z' });
        stack.push(
          { x0: b.x0, z0: lz0, x1: a0, z1: lz1, open: { ...b.open, e: true, [cut]: false }, walk: { ...b.walk, e: true, [cut]: false } },
          { x0: a1, z0: lz0, x1: b.x1, z1: lz1, open: { ...b.open, w: true, [cut]: false }, walk: { ...b.walk, w: true, [cut]: false } },
          { x0: b.x0, z0: fromN ? sz : b.z0, x1: b.x1, z1: fromN ? b.z1 : sz, open: { ...b.open, [fromN ? 'n' : 's']: false }, walk: { ...b.walk, [fromN ? 'n' : 's']: false } },
        );
      }
      continue;
    }
    if (alongX) {
      lanes.push({ x0: b.x0, z0: a0, x1: b.x1, z1: a1, kind, along: 'x' });
      stack.push({ ...b, z1: a0, open: { ...b.open, s: true }, walk: { ...b.walk, s: true } }, { ...b, z0: a1, open: { ...b.open, n: true }, walk: { ...b.walk, n: true } });
    } else {
      lanes.push({ x0: a0, z0: b.z0, x1: a1, z1: b.z1, kind, along: 'z' });
      stack.push({ ...b, x1: a0, open: { ...b.open, e: true }, walk: { ...b.walk, e: true } }, { ...b, x0: a1, open: { ...b.open, w: true }, walk: { ...b.walk, w: true } });
    }
  }

  // 3. Fill blocks with buildings (rows of lots, or a courtyard ring).
  const buildings: PlanBuilding[] = [];
  const keepOut = (bx0: number, bz0: number, bx1: number, bz1: number) =>
    (spec.keep ?? []).some((k) => bx0 < k[2] + 0.4 && bx1 > k[0] - 0.4 && bz0 < k[3] + 0.4 && bz1 > k[1] - 0.4);
  const insideCity = (bx0: number, bz0: number, bx1: number, bz1: number) =>
    inCity(bx0, bz0, 0.8) && inCity(bx1, bz0, 0.8) && inCity(bx0, bz1, 0.8) && inCity(bx1, bz1, 0.8) && inCity((bx0 + bx1) / 2, (bz0 + bz1) / 2, 0.8);
  const floorsR = spec.floors ?? TUNE.floors;
  const add = (bx0: number, bz0: number, bx1: number, bz1: number, open: Sides, walk: Sides, front: Side | null) => {
    if (bx1 - bx0 < 2.6 || bz1 - bz0 < 2.6) return;
    if (keepOut(bx0, bz0, bx1, bz1) || !insideCity(bx0, bz0, bx1, bz1)) return;
    const floors = rnd.int(floorsR[0], floorsR[1]);
    const r = rnd.next();
    const roof: RoofKind = r < 0.3 ? 'crenel' : r < 0.5 ? 'dome' : r < 0.74 ? 'tier' : r < 0.86 ? 'vault' : 'flat';
    const doorSides = ALL.filter((s) => walk[s]);
    const door = front && walk[front] ? front : doorSides.length ? doorSides[rnd.int(0, doorSides.length - 1)] : null;
    const openSides = ALL.filter((s) => open[s]);
    buildings.push({
      x0: bx0,
      z0: bz0,
      x1: bx1,
      z1: bz1,
      y: spec.y,
      floors,
      h: floors * TUNE.storey + 0.6,
      roof,
      open,
      door,
      tower: bx1 - bx0 >= 6 && bz1 - bz0 >= 6 && rnd.chance(0.09),
      balcony: openSides.length && rnd.chance(0.28) ? openSides[rnd.int(0, openSides.length - 1)] : null,
      seed: rnd.int(0, 1e6),
    });
  };
  /** Lots along x (frontage on n/s) or along z (frontage on w/e) between a and b. */
  const lots = (a: number, b: number, f: (u0: number, u1: number, first: boolean, last: boolean) => void) => {
    let u = a;
    while (b - u > 0.1) {
      let w = rnd.range(TUNE.lot[0], TUNE.lot[1]);
      if (b - (u + w) < TUNE.lot[0]) w = b - u;
      f(u, u + w, u === a, u + w >= b - 0.1);
      u += w;
    }
  };
  for (const b of leaves) fillBlock(b);

  function fillBlock(b: Block): void {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    if (w < 2.6 || d < 2.6) return;
    if (w >= 15 && d >= 15 && rnd.chance(TUNE.courts)) court(b);
    else fillRows(b);
  }

  function fillRows(b: Block): void {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    // Lots run along the longer side; deep blocks get two rows back to back.
    if (w >= d) {
      const rows = d > 15 ? 2 : 1;
      const mid = b.z0 + d * rnd.range(0.42, 0.58);
      for (let r = 0; r < rows; r++) {
        const rz0 = rows === 1 ? b.z0 : r === 0 ? b.z0 : mid, rz1 = rows === 1 ? b.z1 : r === 0 ? mid : b.z1;
        lots(b.x0, b.x1, (u0, u1, first, last) => {
          const open: Sides = { n: (rows === 1 || r === 0) && b.open.n, s: (rows === 1 || r === 1) && b.open.s, w: first && b.open.w, e: last && b.open.e };
          const walk: Sides = { n: (rows === 1 || r === 0) && b.walk.n, s: (rows === 1 || r === 1) && b.walk.s, w: first && b.walk.w, e: last && b.walk.e };
          add(u0, rz0, u1, rz1, open, walk, rows === 2 ? (r === 0 ? 'n' : 's') : b.walk.n ? 'n' : 's');
        });
      }
    } else {
      const rows = w > 15 ? 2 : 1;
      const mid = b.x0 + w * rnd.range(0.42, 0.58);
      for (let r = 0; r < rows; r++) {
        const rx0 = rows === 1 ? b.x0 : r === 0 ? b.x0 : mid, rx1 = rows === 1 ? b.x1 : r === 0 ? mid : b.x1;
        lots(b.z0, b.z1, (u0, u1, first, last) => {
          const open: Sides = { w: (rows === 1 || r === 0) && b.open.w, e: (rows === 1 || r === 1) && b.open.e, n: first && b.open.n, s: last && b.open.s };
          const walk: Sides = { w: (rows === 1 || r === 0) && b.walk.w, e: (rows === 1 || r === 1) && b.walk.e, n: first && b.walk.n, s: last && b.walk.s };
          add(rx0, u0, rx1, u1, open, walk, rows === 2 ? (r === 0 ? 'w' : 'e') : b.walk.w ? 'w' : 'e');
        });
      }
    }
  }

  /** A small courtyard ringed by houses (corner houses on their own), entered through a gap on a walkable side. */
  function court(b: Block): void {
    const gw = 3;
    const t = Math.min(rnd.range(5, 6.5), (Math.min(b.x1 - b.x0, b.z1 - b.z0) - 6) / 2);
    const inner = { x0: b.x0 + t, z0: b.z0 + t, x1: b.x1 - t, z1: b.z1 - t };
    const fits = (s: Side) => (s === 'n' || s === 's' ? inner.x1 - inner.x0 : inner.z1 - inner.z0) >= gw + 2 * 2.8;
    const entries = ALL.filter((s) => b.walk[s] && fits(s));
    if (!entries.length) {
      // No room for a gate: fill the block with ordinary rows instead.
      fillRows(b);
      return;
    }
    const gate = entries[rnd.int(0, entries.length - 1)];
    lanes.push({ ...inner, kind: 'court', along: 'x' });
    const none = (): Sides => ({ n: false, s: false, w: false, e: false });
    // Corner houses face only outward.
    for (const [cx0, cz0, sx, sz] of [[b.x0, b.z0, 'w', 'n'], [inner.x1, b.z0, 'e', 'n'], [b.x0, inner.z1, 'w', 's'], [inner.x1, inner.z1, 'e', 's']] as Array<[number, number, Side, Side]>) {
      const open = none(), walk = none();
      open[sx] = b.open[sx];
      open[sz] = b.open[sz];
      walk[sx] = b.walk[sx];
      walk[sz] = b.walk[sz];
      add(cx0, cz0, cx0 + t, cz0 + t, open, walk, null);
    }
    const strip = (s: Side, sx0: number, sz0: number, sx1: number, sz1: number) => {
      const horizontal = s === 'n' || s === 's';
      const inSide: Side = s === 'n' ? 's' : s === 's' ? 'n' : s === 'w' ? 'e' : 'w';
      const piece = (p0: number, p1: number) => {
        if (p1 - p0 < 2.6) return;
        lots(p0, p1, (u0, u1) => {
          const open = none(), walk = none();
          open[s] = b.open[s];
          walk[s] = b.walk[s];
          open[inSide] = true;
          walk[inSide] = true;
          if (horizontal) add(u0, sz0, u1, sz1, open, walk, inSide);
          else add(sx0, u0, sx1, u1, open, walk, inSide);
        });
      };
      const a = horizontal ? sx0 : sz0, c = horizontal ? sx1 : sz1;
      if (s === gate) {
        const m = (a + c) / 2;
        piece(a, m - gw / 2);
        piece(m + gw / 2, c);
        lanes.push(horizontal ? { x0: m - gw / 2, z0: sz0, x1: m + gw / 2, z1: sz1, kind: 'alley', along: 'z' } : { x0: sx0, z0: m - gw / 2, x1: sx1, z1: m + gw / 2, kind: 'alley', along: 'x' });
      } else piece(a, c);
    };
    strip('n', inner.x0, b.z0, inner.x1, inner.z0);
    strip('s', inner.x0, inner.z1, inner.x1, b.z1);
    strip('w', b.x0, inner.z0, inner.x0, inner.z1);
    strip('e', inner.x1, inner.z0, b.x1, inner.z1);
  }

  // 4. Passages under buildings: an upper storey bridging an alley between two houses.
  const at = (x: number, z: number) => buildings.find((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1);
  const spans: PlanSpan[] = [];
  for (const l of lanes) {
    if (l.kind !== 'alley') continue;
    const len = l.along === 'x' ? l.x1 - l.x0 : l.z1 - l.z0;
    if (len < 9 || !rnd.chance(TUNE.arches)) continue;
    const u = (l.along === 'x' ? l.x0 : l.z0) + len * rnd.range(0.3, 0.7);
    const cx = l.along === 'x' ? u : (l.x0 + l.x1) / 2, cz = l.along === 'x' ? (l.z0 + l.z1) / 2 : u;
    const half = (l.along === 'x' ? l.z1 - l.z0 : l.x1 - l.x0) / 2;
    const a = l.along === 'x' ? at(cx, cz - half - 1) : at(cx - half - 1, cz);
    const b = l.along === 'x' ? at(cx, cz + half + 1) : at(cx + half + 1, cz);
    if (!a || !b) continue;
    const bottom = spec.y + 3.9, top = spec.y + Math.min(a.h, b.h) - 0.2;
    if (top - bottom < 2.4) continue;
    spans.push(
      l.along === 'x'
        ? { x0: u - 1.8, z0: l.z0 - 0.3, x1: u + 1.8, z1: l.z1 + 0.3, bottom, top, along: 'x' }
        : { x0: l.x0 - 0.3, z0: u - 1.8, x1: l.x1 + 0.3, z1: u + 1.8, bottom, top, along: 'z' },
    );
  }

  // 5. Lamps: lanterns on facades along lanes, lanterns strung across alleys.
  const lamps: PlanLamp[] = [];
  for (const l of lanes) {
    if (l.kind === 'court') continue;
    const len = l.along === 'x' ? l.x1 - l.x0 : l.z1 - l.z0;
    const width = l.along === 'x' ? l.z1 - l.z0 : l.x1 - l.x0;
    if (l.kind === 'alley') {
      for (let u = 4 + rnd.range(0, 3); u < len - 2; u += rnd.range(8, 12)) {
        const x = l.along === 'x' ? l.x0 + u : (l.x0 + l.x1) / 2, z = l.along === 'x' ? (l.z0 + l.z1) / 2 : l.z0 + u;
        const a = l.along === 'x' ? at(x, z - width / 2 - 0.6) : at(x - width / 2 - 0.6, z);
        const b = l.along === 'x' ? at(x, z + width / 2 + 0.6) : at(x + width / 2 + 0.6, z);
        if (a && b) lamps.push({ x, z, y: spec.y + 4.4, kind: 'hang', yaw: l.along === 'x' ? Math.PI / 2 : 0, span: width });
      }
      continue;
    }
    let side = 1;
    for (let u = 3 + rnd.range(0, 4); u < len - 2; u += TUNE.lampSpacing) {
      side = -side;
      const cx = l.along === 'x' ? l.x0 + u : (l.x0 + l.x1) / 2, cz = l.along === 'x' ? (l.z0 + l.z1) / 2 : l.z0 + u;
      for (const s of [side, -side]) {
        const px = l.along === 'x' ? cx : cx + s * (width / 2), pz = l.along === 'x' ? cz + s * (width / 2) : cz;
        const q = l.along === 'x' ? at(px, pz + s * 0.6) : at(px + s * 0.6, pz);
        if (!q) continue;
        // Facade lantern: yaw faces away from the wall into the lane.
        const yaw = l.along === 'x' ? (s > 0 ? Math.PI : 0) : s > 0 ? -Math.PI / 2 : Math.PI / 2;
        lamps.push({ x: px - (l.along === 'x' ? 0 : s * 0.05), z: pz - (l.along === 'x' ? s * 0.05 : 0), y: spec.y + 3.1, kind: 'wall', yaw });
        break;
      }
    }
  }

  // 6. Citizen walk routes along the lanes.
  const routes: Array<Array<[number, number]>> = [];
  for (const l of lanes) {
    if (l.kind !== 'lane') continue;
    const len = l.along === 'x' ? l.x1 - l.x0 : l.z1 - l.z0;
    if (len < 18) continue;
    if (l.along === 'x') {
      const z = (l.z0 + l.z1) / 2;
      routes.push([[l.x0 + 1.5, z], [l.x1 - 1.5, z]]);
    } else {
      const x = (l.x0 + l.x1) / 2;
      const zs = spec.stairsN?.some((s) => Math.abs(s - x) < 0.5) ? l.z0 + TUNE.stairRun + 1.5 : l.z0 + 1.5;
      routes.push([[x, zs], [x, l.z1 - 1.5]]);
    }
  }

  return { id: spec.id, spec, buildings, lanes, spans, lamps, routes };
}

/** Cut a block with an east-west lane at z (width w); returns the pieces either side. */
function cutX(b: Block, z: number, w: number, lanes: PlanLane[], kind: PlanLane['kind']): Block[] {
  if (z - w / 2 <= b.z0 || z + w / 2 >= b.z1) return [b];
  lanes.push({ x0: b.x0, z0: z - w / 2, x1: b.x1, z1: z + w / 2, kind, along: 'x' });
  return [
    { ...b, z1: z - w / 2, open: { ...b.open, s: true }, walk: { ...b.walk, s: true } },
    { ...b, z0: z + w / 2, open: { ...b.open, n: true }, walk: { ...b.walk, n: true } },
  ];
}

/** Cut a block with a north-south lane at x (width w). */
function cutZ(b: Block, x: number, w: number, lanes: PlanLane[], kind: PlanLane['kind']): Block[] {
  if (x - w / 2 <= b.x0 || x + w / 2 >= b.x1) return [b];
  lanes.push({ x0: x - w / 2, z0: b.z0, x1: x + w / 2, z1: b.z1, kind, along: 'z' });
  return [
    { ...b, x1: x - w / 2, open: { ...b.open, e: true }, walk: { ...b.walk, e: true } },
    { ...b, x0: x + w / 2, open: { ...b.open, w: true }, walk: { ...b.walk, w: true } },
  ];
}

let planCache: DistrictPlan[] | null = null;

/** Plans for every district of the city (cached; deterministic). */
export function cityPlans(specs: DistrictSpec[]): DistrictPlan[] {
  if (!planCache) planCache = specs.map(planDistrict);
  return planCache;
}

export function rectOf(b: { x0: number; z0: number; x1: number; z1: number }): Rect {
  return [b.x0, b.z0, b.x1, b.z1];
}
