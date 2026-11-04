import { heightAt } from '../world/Heightfield';
import { ROADS, WORLD_HALF } from '../world/WorldLayout';

/**
 * Road routes across the world map, for the tracked-quest path on the map and the compass's next
 * waypoint. Pure: a graph of the road polylines (WorldLayout.ROADS) plus a few links the road data
 * does not draw — walking through Ba Sing Se between its gates, the Western Causeway bridge, short
 * gaps between road ends — searched with Dijkstra. Leaving and joining the roads is a straight walk,
 * and cross-country walking costs more than road (more the longer the leg, far more over open
 * water), so long trips follow the roads and bridges while short ones go straight.
 */

export interface RoutePoint {
  x: number;
  z: number;
}

interface Node extends RoutePoint {
  edges: Array<{ to: number; cost: number }>;
}

/** Walking off-road counts this much longer than on a road — more the longer the leg (mountains, desert, water). */
const OFFROAD = 1.35;
const OFFROAD_GROWTH = 1500;
/** Each metre of open water on an off-road leg costs this much more (swim only when there is no bridge). */
const WATER = 6;

// Coarse land / sea mask (sea level y = 0), built once.
const CELL = 48;
const GRID = Math.ceil((WORLD_HALF * 2) / CELL);
let land: Uint8Array | null = null;

function isWater(x: number, z: number): boolean {
  if (!land) {
    land = new Uint8Array(GRID * GRID);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) land[j * GRID + i] = heightAt(-WORLD_HALF + (i + 0.5) * CELL, -WORLD_HALF + (j + 0.5) * CELL) > 0.2 ? 1 : 0;
  }
  const i = Math.floor((x + WORLD_HALF) / CELL), j = Math.floor((z + WORLD_HALF) / CELL);
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return true;
  return land[j * GRID + i] === 0;
}

/** Metres of open water along a straight walk. */
function waterAlong(a: RoutePoint, b: RoutePoint): number {
  const d = d2(a, b);
  const n = Math.max(1, Math.ceil(d / (CELL / 2)));
  let w = 0;
  for (let k = 1; k < n; k++) if (isWater(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n)) w++;
  return (w * d) / n;
}

/** The cost of walking straight from a to b off the roads. */
const offLeg = (a: RoutePoint, b: RoutePoint) => {
  const d = d2(a, b);
  return d * (OFFROAD + d / OFFROAD_GROWTH) + waterAlong(a, b) * WATER;
};
/** Road ends this close to another road are joined. */
const JOIN = 380;
/** Longest cross-country shortcut between two roads. */
const SHORTCUT = 900;

/** Connections the road polylines do not draw. */
const LINKS: Array<[RoutePoint, RoutePoint]> = [
  // Through Ba Sing Se: west gate, south gate and east gate meet in the city.
  [{ x: 447, z: -165 }, { x: 850, z: -50 }],
  [{ x: 850, z: 280 }, { x: 850, z: -50 }],
  [{ x: 1260, z: -50 }, { x: 850, z: -50 }],
  // The Western Causeway bridge over the Western Strait.
  [{ x: -780, z: 700 }, { x: -940, z: 960 }],
];

let graph: Node[] | null = null;

function d2(a: RoutePoint, b: RoutePoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function build(): Node[] {
  const nodes: Node[] = [];
  const roadOf: number[] = [];
  const find = (p: RoutePoint): number => {
    for (let i = 0; i < nodes.length; i++) if (d2(nodes[i], p) < 1) return i;
    nodes.push({ x: p.x, z: p.z, edges: [] });
    roadOf.push(-1);
    return nodes.length - 1;
  };
  const link = (a: number, b: number, offroad = false) => {
    if (a === b) return;
    const c = offroad ? offLeg(nodes[a], nodes[b]) : d2(nodes[a], nodes[b]);
    nodes[a].edges.push({ to: b, cost: c });
    nodes[b].edges.push({ to: a, cost: c });
  };
  const ends: Array<{ node: number; road: number }> = [];
  ROADS.forEach((r, ri) => {
    let prev = -1;
    r.points.forEach((p, k) => {
      const n = find(p);
      if (roadOf[n] === -1) roadOf[n] = ri;
      if (prev >= 0) link(prev, n);
      if (k === 0 || k === r.points.length - 1) ends.push({ node: n, road: ri });
      prev = n;
    });
  });
  for (const [a, b] of LINKS) link(find(a), find(b));
  // Join each road end to the nearest point of another road (short walks between roads).
  for (const e of ends) {
    let best = -1;
    let bestD = JOIN;
    nodes.forEach((n, i) => {
      if (i === e.node || roadOf[i] === e.road) return;
      const d = d2(n, nodes[e.node]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && !nodes[e.node].edges.some((x) => x.to === best)) link(e.node, best, true);
  }
  // Cross-country shortcuts between different roads (priced as off-road walking, so a road wins
  // where there is one).
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (roadOf[i] === roadOf[j] && roadOf[i] !== -1) continue;
      const d = d2(nodes[i], nodes[j]);
      if (d > SHORTCUT || nodes[i].edges.some((x) => x.to === j)) continue;
      link(i, j, true);
    }
  }
  return nodes;
}

function nodes(): Node[] {
  graph ??= build();
  return graph;
}

/**
 * The way from `from` to `to`: start, the road points to follow, end. A short or roadless trip is
 * just [from, to].
 */
export function planRoute(from: RoutePoint, to: RoutePoint): RoutePoint[] {
  const ns = nodes();
  const direct = offLeg(from, to);
  // Multi-source Dijkstra: every node starts at the off-road walk from `from`.
  const dist = ns.map((n) => offLeg(from, n));
  const prev = ns.map(() => -1);
  const done = ns.map(() => false);
  for (;;) {
    let u = -1;
    for (let i = 0; i < ns.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const e of ns[u].edges) {
      const nd = dist[u] + e.cost;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
      }
    }
  }
  // Leave the roads at the node that makes the whole trip shortest.
  let best = -1;
  let bestTotal = direct;
  for (let i = 0; i < ns.length; i++) {
    const total = dist[i] + offLeg(ns[i], to);
    if (total < bestTotal - 1) {
      bestTotal = total;
      best = i;
    }
  }
  if (best < 0) return [{ x: from.x, z: from.z }, { x: to.x, z: to.z }];
  const chain: RoutePoint[] = [];
  for (let i = best; i >= 0; i = prev[i]) chain.unshift({ x: ns[i].x, z: ns[i].z });
  const out: RoutePoint[] = [];
  for (const p of [{ x: from.x, z: from.z }, ...chain, { x: to.x, z: to.z }]) if (!out.length || d2(out[out.length - 1], p) > 1) out.push(p);
  return out;
}

/** Total length (m) of a route. */
export function routeLength(r: RoutePoint[]): number {
  let s = 0;
  for (let i = 1; i < r.length; i++) s += d2(r[i - 1], r[i]);
  return s;
}

/**
 * The next point to head for: the first route point more than `ahead` metres from `at` that is not
 * behind the walker (skipping road points already passed).
 */
export function nextWaypoint(r: RoutePoint[], at: RoutePoint, ahead = 60): RoutePoint | null {
  if (r.length < 3) return null;
  // Find the route segment closest to `at`, then look forward from there.
  let seg = 0;
  let segD = Infinity;
  for (let i = 0; i + 1 < r.length; i++) {
    const a = r[i], b = r[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.z - a.z) * dz) / L)) : 0;
    const d = Math.hypot(a.x + dx * t - at.x, a.z + dz * t - at.z);
    if (d < segD) {
      segD = d;
      seg = i;
    }
  }
  for (let i = seg + 1; i < r.length - 1; i++) if (d2(r[i], at) > ahead) return r[i];
  return null;
}
