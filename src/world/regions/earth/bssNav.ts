import type { P2 } from '../../WorldLayout';

/**
 * Ba Sing Se walking graph. District builders add streets (polylines, nodes
 * every ≤ 10 m, intersections snap to existing nodes) and points of interest
 * (shop doors, stalls, homes, benches, station lifts, gates, fields). Crowd
 * agents path between POIs over it. Pure data, no three.js.
 */

export const NavTag = {
  street: 1 << 0,
  shop: 1 << 1,
  stall: 1 << 2,
  home: 1 << 3,
  square: 1 << 4,
  station: 1 << 5,
  gate: 1 << 6,
  field: 1 << 7,
  bench: 1 << 8,
  tea: 1 << 9,
  work: 1 << 10,
  temple: 1 << 11,
  lower: 1 << 12,
  middle: 1 << 13,
  upper: 1 << 14,
  farm: 1 << 15,
  palace: 1 << 16,
  water: 1 << 17,
  patrol: 1 << 18,
  school: 1 << 19,
} as const;

export interface NavNode {
  x: number;
  z: number;
  tags: number;
  edges: number[];
  /** Facing for POIs (stand facing this yaw). */
  yaw: number;
}

const CELL = 16;

export class NavGraph {
  readonly nodes: NavNode[] = [];
  private readonly grid = new Map<number, number[]>();

  private key(x: number, z: number): number {
    return (Math.floor(x / CELL) + 512) * 4096 + (Math.floor(z / CELL) + 512);
  }

  /** Nearest node within `r` metres (or −1). */
  near(x: number, z: number, r: number, mask = 0): number {
    let best = -1, bd = r * r;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
    for (let i = c0; i <= c1; i++) {
      for (let j = d0; j <= d1; j++) {
        const l = this.grid.get((i + 512) * 4096 + (j + 512));
        if (!l) continue;
        for (const k of l) {
          const n = this.nodes[k];
          if (mask && !(n.tags & mask)) continue;
          const d = (n.x - x) ** 2 + (n.z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
      }
    }
    return best;
  }

  addNode(x: number, z: number, tags = 0, snap = 1.2, yaw = 0): number {
    const e = snap > 0 ? this.near(x, z, snap) : -1;
    if (e >= 0) {
      this.nodes[e].tags |= tags;
      return e;
    }
    const id = this.nodes.length;
    this.nodes.push({ x, z, tags, edges: [], yaw });
    const k = this.key(x, z);
    let l = this.grid.get(k);
    if (!l) this.grid.set(k, (l = []));
    l.push(id);
    return id;
  }

  link(a: number, b: number): void {
    if (a === b || a < 0 || b < 0) return;
    if (!this.nodes[a].edges.includes(b)) this.nodes[a].edges.push(b);
    if (!this.nodes[b].edges.includes(a)) this.nodes[b].edges.push(a);
  }

  unlink(a: number, b: number): void {
    const ea = this.nodes[a].edges, eb = this.nodes[b].edges;
    const i = ea.indexOf(b), j = eb.indexOf(a);
    if (i >= 0) ea.splice(i, 1);
    if (j >= 0) eb.splice(j, 1);
  }

  /** Nodes within `r` metres (with any of `mask`), nearest first. */
  around(x: number, z: number, r: number, mask = 0): number[] {
    const found: Array<[number, number]> = [];
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
    for (let i = c0; i <= c1; i++) {
      for (let j = d0; j <= d1; j++) {
        const l = this.grid.get((i + 512) * 4096 + (j + 512));
        if (!l) continue;
        for (const k of l) {
          const n = this.nodes[k];
          if (mask && !(n.tags & mask)) continue;
          const d = (n.x - x) ** 2 + (n.z - z) ** 2;
          if (d < r * r) found.push([d, k]);
        }
      }
    }
    return found.sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  }

  /** Street along a polyline: nodes every ≤ `step` m; ends and joints snap to nodes within `snap` m. */
  street(points: P2[], tags = NavTag.street, step = 10, snap = 4): number[] {
    const ids: number[] = [];
    let prev = -1;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const t = k / n;
        const end = (i === 0 && k === 0) || (i === points.length - 2 && k === n);
        const id = this.addNode(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, tags | NavTag.street, end ? snap : 1.2);
        if (prev >= 0) this.link(prev, id);
        ids.push(id);
        prev = id;
      }
    }
    return ids;
  }

  /** A point of interest joined to the nearest street node. */
  poi(x: number, z: number, tags: number, yaw = 0, reach = 14): number {
    const s = this.near(x, z, reach, NavTag.street);
    const id = this.addNode(x, z, tags, 0.3, yaw);
    if (s >= 0) this.link(id, s);
    return id;
  }

  /** Insert a node where a street crosses near (x, z), joining the closest street nodes (intersections). */
  join(x: number, z: number, r = 6): void {
    const a = this.near(x, z, r, NavTag.street);
    if (a < 0) return;
    let b = -1, bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      if (i === a || !(this.nodes[i].tags & NavTag.street)) continue;
      const d = (this.nodes[i].x - x) ** 2 + (this.nodes[i].z - z) ** 2;
      if (d < bd && d < r * r && !this.nodes[a].edges.includes(i)) {
        bd = d;
        b = i;
      }
    }
    if (b >= 0) this.link(a, b);
  }

  /** Breadth-first path (node ids, inclusive), or null. Reuses `scratch` buffers. */
  path(from: number, to: number, out: number[] = [], prev = new Int32Array(this.nodes.length)): number[] | null {
    if (from < 0 || to < 0) return null;
    prev.fill(-2);
    const q: number[] = [from];
    prev[from] = -1;
    for (let h = 0; h < q.length; h++) {
      const n = q[h];
      if (n === to) break;
      for (const e of this.nodes[n].edges) {
        if (prev[e] !== -2) continue;
        prev[e] = n;
        q.push(e);
      }
    }
    if (prev[to] === -2) return null;
    out.length = 0;
    for (let n = to; n !== -1; n = prev[n]) out.push(n);
    out.reverse();
    return out;
  }

  /** Node ids with all of `mask` set (and none of `not`). */
  find(mask: number, not = 0): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const t = this.nodes[i].tags;
      if ((t & mask) === mask && !(t & not)) out.push(i);
    }
    return out;
  }

  /** Largest connected component size (debug / tests). */
  components(): number[] {
    const seen = new Int32Array(this.nodes.length).fill(-1);
    const sizes: number[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      if (seen[i] >= 0) continue;
      const c = sizes.length;
      let n = 0;
      const st = [i];
      seen[i] = c;
      while (st.length) {
        const k = st.pop()!;
        n++;
        for (const e of this.nodes[k].edges) if (seen[e] < 0) {
          seen[e] = c;
          st.push(e);
        }
      }
      sizes.push(n);
    }
    return sizes.sort((a, b) => b - a);
  }
}
