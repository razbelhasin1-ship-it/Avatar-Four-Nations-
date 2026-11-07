import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { Random } from '../../../core/Random';
import { getRoadRuntime, heightAt, waterAt } from '../../Heightfield';
import { A, KI } from '../../landforms/kyoshiIsland';
import type { P2 } from '../../WorldLayout';
import { FigureRenderer, Pose } from '../earth/bssFigures';
import { NavGraph } from '../earth/bssNav';
import { KAcc, KYOSHI_LOOK, registerKyoshiAccessories } from './figures';

/**
 * The people of Kyoshi Island (all women in the Kyoshi Warrior outfit — see figures.ts). About 180
 * are simulated: warriors, farmers, fishers, cooks, traders, elders, girls and villagers, each with
 * a home and a job and a daily routine on the shared clock — dawn: farmers to the paddies, fishers
 * to the piers, the warriors' early drill in the dojo yard; midday: market chatter, fish unloaded
 * at the harbor; dusk: lanterns lit, the communal kitchens busy; night: quiet, a few guards.
 *
 * Walking uses a graph over the island's roads, the harbor boardwalk and piers, the village plots
 * and the dojo yard (bssNav). Villagers standing near the player turn to look at them (walkers keep
 * their way); the nearest one can be talked to (one line per archetype).
 */

export type Role = 'warrior' | 'farmer' | 'fisher' | 'cook' | 'trader' | 'elder' | 'girl' | 'villager';

export const LIFE = {
  /** Population by role (scaled by the graphics "people" density at build). */
  cast: { warrior: 22, farmer: 30, fisher: 32, cook: 12, trader: 22, elder: 10, girl: 16, villager: 36 } as Record<Role, number>,
  /** Draw ranges (m): figures, simplified far LOD beyond `near`. */
  draw: { near: 70, far: 300 },
  walk: [1.15, 1.55] as [number, number],
} as const;

const T = {
  street: 1 << 0,
  home: 1 << 1,
  stall: 1 << 2,
  kitchen: 1 << 3,
  field: 1 << 4,
  pier: 1 << 5,
  yard: 1 << 6,
  post: 1 << 7,
  well: 1 << 8,
  hall: 1 << 9,
  shrine: 1 << 10,
  beach: 1 << 11,
  statue: 1 << 12,
  inn: 1 << 13,
  harbor: 1 << 14,
  village: 1 << 15,
  meadow: 1 << 16,
  patrol: 1 << 17,
};

/** Spots several people share (they spread round them; stalls, doors, posts and drills keep their place). */
const SHARED = T.beach | T.statue | T.well | T.meadow | T.shrine | T.hall | T.inn | T.kitchen;

export interface LifeInput {
  doors: Array<{ x: number; z: number; yaw: number; harbor?: boolean }>;
  stalls: Array<{ x: number; z: number; yaw: number; harbor?: boolean }>;
  kitchens: P2[];
  fields: Array<{ x: number; z: number; yaw: number; w: number; d: number }>;
  wells: P2[];
  piers: Array<{ root: P2; head: P2; yaw: number }>;
  yard: { x: number; y: number; z: number; yaw: number; w: number; d: number };
  posts: P2[];
  marks: Record<string, { x: number; y: number; z: number }>;
  /** Bench seats at the Meeting Hall: an elder sitting there takes a free one (feet at x/z, facing yaw). */
  seats?: Array<{ x: number; z: number; y: number; yaw: number }>;
  /** Ground (walkable decks included) under a point. */
  ground: (x: number, z: number) => number;
}

interface Agent {
  role: Role;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  home: number;
  job: number;
  node: number;
  path: number[];
  pi: number;
  goal: number;
  activity: 'walk' | 'idle' | 'work' | 'talk' | 'sit' | 'drill' | 'carry' | 'home';
  timer: number;
  speed: number;
  phase: number;
  robe: number;
  skirt: number;
  paint: number;
  acc: number;
  scale: number;
  greet: number;
  /** Drill slot (warriors) in the yard frame. */
  slot: P2 | null;
  /** The hall bench seat this elder sits on (index into input.seats), or -1. */
  seat: number;
}

const LINES: Record<Role, string[]> = {
  warrior: ['We train at dawn and at dusk. The fans are for show until they are not.', 'Avatar Kyoshi founded our order. We keep her island safe.', 'Mind the unagi if you go near the bay’s deep water.'],
  farmer: ['The paddies drink every drop of the falls. Good rice this year.', 'Up before the sun, home after it. That is a farmer’s day.'],
  fisher: ['Elephant koi run thick in the bay — so does the unagi.', 'The traders want fish oil by the barrel. My arms want a rest.'],
  cook: ['The kitchens feed the whole village at dusk. Come hungry.', 'Taro, daikon, a little fish. Simple food, made with care.'],
  trader: ['Fresh from the mainland! Well — fresh enough.', 'Koi fillets, smoked or salted. The best on the island.'],
  elder: ['The council sits in the Meeting Hall. We have kept the peace a long time.', 'Kyoshi raised this island from the mainland. Remember that, traveller.'],
  girl: ['When I grow up I will wear the fans too!', 'Have you ridden an elephant koi? Suki says I am too small.'],
  villager: ['Welcome to Kyoshi Island, traveller.', 'The shrine on the hill holds Avatar Kyoshi’s own fans and kimono.'],
};
const TITLES: Record<Role, string> = { warrior: 'Kyoshi Warrior', farmer: 'Farmer', fisher: 'Fisher', cook: 'Cook', trader: 'Trader', elder: 'Village Elder', girl: 'Girl', villager: 'Villager' };

export class KyoshiLife {
  readonly group = new THREE.Group();
  readonly nav = new NavGraph();
  readonly agents: Agent[] = [];
  private readonly figures: FigureRenderer;
  private nodeY = new Float32Array(0);
  private readonly rnd = new Random(KI.seed + 99);
  private readonly prev: Int32Array<ArrayBuffer>;
  private readonly tmpPath: number[] = [];
  private hour = 9;
  private lastHour = -1;
  /** Where the market and harbor counts are centred. */
  private readonly vC = A(KI.village.u, 320);
  private readonly hC = A(0.82, 240);
  private drillT = 0;
  private stepper = 0;
  private talkTarget: Agent | null = null;
  readonly talkPos = new THREE.Vector3();
  stats = { total: 0, drawn: 0, walking: 0, drilling: 0, home: 0, village: 0, harbor: 0, ms: 0 };

  constructor(parent: THREE.Group, private readonly input: LifeInput, density = 1) {
    registerKyoshiAccessories();
    this.group.name = 'kyoshi_life';
    parent.add(this.group);
    this.buildNav();
    this.prev = new Int32Array(this.nav.nodes.length);
    let n = 0;
    for (const r of Object.keys(LIFE.cast) as Role[]) n += Math.round(LIFE.cast[r] * density);
    this.figures = new FigureRenderer(this.group, n + 8);
    this.figures.setRange(LIFE.draw.near, LIFE.draw.far);
    this.spawn(density);
  }

  // ---------------------------------------------------------------------------
  // Walking graph
  // ---------------------------------------------------------------------------

  /** A walkable top well above the road's own surface, with no water under it: a building on the road (its roof). */
  private inBuilding(x: number, z: number, roadY: number): boolean {
    return this.input.ground(x, z) - roadY > 3.4 && !waterAt(x, z);
  }

  /** A straight way between two points on dry ground with no steps over 1.2 m (a lane can follow it). */
  private clearLine(a: P2, b: P2): boolean {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let prev = NaN;
    for (let d = 0; d <= len; d += 1) {
      const x = a.x + ((b.x - a.x) * d) / (len || 1), z = a.z + ((b.z - a.z) * d) / (len || 1);
      const g = this.input.ground(x, z);
      if (waterAt(x, z) || g - heightAt(x, z) > 3.4 || Math.abs(g - prev) > 1.2) return false;
      prev = g;
    }
    return true;
  }

  private buildNav(): void {
    const nav = this.nav, inp = this.input;
    /** The road's own surface under road nodes (a node's walkable top may not stand far above it). */
    const roadY = new Map<number, number>();
    for (const r of getRoadRuntime()) {
      if (!r.id.startsWith('ki_')) continue;
      const ss: number[] = [];
      for (let s = 0; s <= r.line.length; s += 8) ss.push(s);
      ss.push(r.line.length);
      // A road running into a building ends at it (the village street stops at the Meeting Hall's door).
      const inside = (s: number) => {
        const p = r.line.pointAt(s);
        return this.inBuilding(p.x, p.z, r.height(s));
      };
      while (ss.length > 2 && inside(ss[ss.length - 1])) ss.pop();
      while (ss.length > 2 && inside(ss[0])) ss.shift();
      const pts = ss.map((s) => r.line.pointAt(s));
      const tag = T.street | (r.id === 'ki_village_street' ? T.village : 0) | (r.id === 'ki_coast_road' || r.id === 'ki_village_street' ? T.patrol : 0);
      const at = new Float64Array(1);
      for (const id of nav.street(pts, tag, 8, 3.5)) {
        if (roadY.has(id)) continue;
        r.line.distance(nav.nodes[id].x, nav.nodes[id].z, at);
        roadY.set(id, r.height(at[0]));
      }
    }
    // A footpath from the coast road down to the bay beach (the beach lies ~100 m from any road).
    const beach = inp.marks.bay_beach;
    const coast = getRoadRuntime().find((r) => r.id === 'ki_coast_road');
    const nearCoast = (p: P2): P2 => {
      const s = new Float64Array(1);
      coast!.line.distance(p.x, p.z, s);
      return coast!.line.pointAt(s[0]);
    };
    if (beach && coast) nav.street([nearCoast(beach), { x: beach.x, z: beach.z }], T.street, 8, 6);
    // Harbor boardwalk along the quay and the piers.
    const board: P2[] = [];
    for (let u = KI.harbor.u0 + 0.01; u <= KI.harbor.u1 - 0.01; u += 0.008) board.push(A(u, 218.5));
    nav.street(board, T.street | T.harbor, 7, 4);
    for (const p of inp.piers) {
      const mid = { x: (p.root.x + p.head.x) / 2, z: (p.root.z + p.head.z) / 2 };
      const ids = nav.street([p.root, mid, p.head], T.street | T.harbor, 12, 3);
      nav.join(p.root.x, p.root.z, 6);
      const head = ids[ids.length - 1];
      nav.nodes[head].tags |= T.pier;
    }
    // Lanes from the boardwalk up to the coast road through gaps between the harbor buildings (the
    // harbor was a network of its own: walkers crossed to it in a straight line over everything).
    if (coast) {
      const lanes: Array<{ u: number; a: P2; b: P2; len: number }> = [];
      for (let u = KI.harbor.u0 + 0.01; u <= KI.harbor.u1 - 0.01; u += 0.003) {
        const a = A(u, 218.5), b = nearCoast(a);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len > 60) continue;
        // Clear: on the ground (no raised floor, stall or building), dry, no steps, from 3 m off the deck.
        let clear = true, prevY = NaN;
        for (let d = 3; d <= len && clear; d += 1) {
          const x = a.x + ((b.x - a.x) * d) / len, z = a.z + ((b.z - a.z) * d) / len;
          const g = inp.ground(x, z);
          if (g - heightAt(x, z) > 0.4 || waterAt(x, z) || Math.abs(g - prevY) > 0.6) clear = false;
          prevY = g;
        }
        if (clear) lanes.push({ u, a, b, len });
      }
      const chosen: typeof lanes = [];
      for (const l of lanes.sort((p, q) => p.len - q.len)) {
        if (chosen.length < 3 && chosen.every((c) => Math.abs(c.u - l.u) > 0.025)) chosen.push(l);
      }
      for (const l of chosen) nav.street([l.a, l.b], T.street | T.harbor, 6, 4);
    }
    // Dojo yard: a grid of drill slots joined to the gate.
    const y = inp.yard;
    const fwd = { x: Math.sin(y.yaw), z: Math.cos(y.yaw) }, right = { x: -Math.cos(y.yaw), z: Math.sin(y.yaw) };
    const grid: number[][] = [];
    for (let i = 0; i < 5; i++) {
      grid.push([]);
      for (let j = 0; j < 4; j++) {
        const lr = (i - 2) * 5, fb = (j - 1.5) * 4.5;
        const id = nav.addNode(y.x + right.x * lr + fwd.x * fb, y.z + right.z * lr + fwd.z * fb, T.yard, 0.5, y.yaw + Math.PI);
        grid[i].push(id);
        if (i > 0) nav.link(id, grid[i - 1][j]);
        if (j > 0) nav.link(id, grid[i][j - 1]);
      }
    }
    const gate = inp.marks.dojo_gate;
    if (gate) {
      const g = nav.addNode(gate.x, gate.z, T.street, 1, 0);
      nav.link(g, grid[2][3]);
      nav.join(gate.x, gate.z, 14);
      const out = nav.addNode(gate.x + fwd.x * 6, gate.z + fwd.z * 6, T.street, 1, 0);
      nav.link(out, g);
      nav.join(out ? nav.nodes[out].x : gate.x, nav.nodes[out].z, 20);
    }
    // Points of interest (a spot that falls on a building moves to the nearest clear ground beside it).
    const poi = (x: number, z: number, tags: number, yaw: number, reach: number): number => {
      const on = (px: number, pz: number) => inp.ground(px, pz) - heightAt(px, pz) > 2.5 && !waterAt(px, pz);
      if (on(x, z)) {
        search: for (const r of [1.5, 2.5, 3.5, 5]) {
          for (let k = 0; k < 8; k++) {
            const px = x + Math.cos((k * Math.PI) / 4) * r, pz = z + Math.sin((k * Math.PI) / 4) * r;
            if (!on(px, pz)) {
              x = px;
              z = pz;
              break search;
            }
          }
        }
      }
      return nav.poi(x, z, tags, yaw, reach);
    };
    for (const d of inp.doors) poi(d.x, d.z, T.home | (d.harbor ? T.harbor : T.village), d.yaw, 18);
    for (const s of inp.stalls) poi(s.x, s.z, T.stall | (s.harbor ? T.harbor : T.village), s.yaw, 16);
    for (const k of inp.kitchens) poi(k.x + 1.4, k.z + 1.4, T.kitchen | T.village, 0, 18);
    for (const w of inp.wells) poi(w.x + 1.5, w.z, T.well | T.village, 0, 16);
    for (const f of inp.fields) poi(f.x, f.z, T.field | T.village, f.yaw, 26);
    for (const p of inp.posts) {
      // In front of the practice post, facing it (the post itself is a solid pillar).
      const dx = y.x - p.x, dz = y.z - p.z, l = Math.hypot(dx, dz) || 1;
      const sx = p.x + (dx / l) * 0.9, sz = p.z + (dz / l) * 0.9;
      nav.poi(sx, sz, T.post, Math.atan2(p.x - sx, p.z - sz), 16);
    }
    const mark = (id: string, tags: number, reach = 20) => {
      const m = inp.marks[id];
      if (m) poi(m.x, m.z, tags, 0, reach);
    };
    mark('statue', T.statue | T.village, 18);
    mark('meeting_hall', T.hall | T.village, 18);
    mark('shrine', T.shrine, 26);
    mark('bay_beach', T.beach, 40);
    mark('meadow', T.meadow, 30);
    mark('traders_inn', T.inn | T.harbor, 18);
    mark('fish_market', T.stall | T.harbor, 16);
    // Points of interest no street reaches (fields off the lanes, a few harbor doors): a lane to the
    // nearest street node along a clear line, so nobody heads for them in a line over everything.
    for (let i = 0; i < nav.nodes.length; i++) {
      const n = nav.nodes[i];
      if (n.edges.length) continue;
      for (const c of nav.around(n.x, n.z, 90, T.street)) {
        if (c !== i && this.clearLine(n, nav.nodes[c])) {
          nav.link(i, c);
          break;
        }
      }
    }
    // Heights: walkable decks (piers, boardwalk, the bridge) included; a road node never stands on
    // something well above its road (a post, a stall, a roof) unless there is water under it (a bridge).
    const n0 = nav.nodes.length;
    const Y: number[] = [];
    for (let i = 0; i < n0; i++) {
      const { x, z } = nav.nodes[i];
      const g = inp.ground(x, z), ry = roadY.get(i);
      Y.push(ry !== undefined && g - ry > 2.5 && !waterAt(x, z) ? ry : g);
    }
    // Links longer than 3 m (points of interest join streets up to ~40 m away) get nodes in between on
    // the ground, so walkers follow it instead of a straight line over dips and through rises (a roof
    // over the way, more than 1 m above both ends, is not the ground).
    const keep = T.street | T.patrol | T.village | T.harbor;
    for (let a = 0; a < n0; a++) {
      for (const b of [...nav.nodes[a].edges]) {
        if (b < a) continue;
        const A0 = nav.nodes[a], B0 = nav.nodes[b];
        const k = Math.ceil(Math.hypot(B0.x - A0.x, B0.z - A0.z) / 3);
        if (k < 2) continue;
        nav.unlink(a, b);
        const top = Math.max(Y[a], Y[b]) + 1;
        let prev = a;
        for (let i = 1; i < k; i++) {
          const x = A0.x + ((B0.x - A0.x) * i) / k, z = A0.z + ((B0.z - A0.z) * i) / k;
          const id = nav.addNode(x, z, A0.tags & B0.tags & keep, 0);
          const g = inp.ground(x, z);
          Y[id] = g > top ? heightAt(x, z) : g;
          nav.link(prev, id);
          prev = id;
        }
        nav.link(prev, b);
      }
    }
    this.nodeY = Float32Array.from(Y);
  }

  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------

  private pick(mask: number, near?: P2, r = 90): number {
    const list = this.nav.find(mask);
    if (!list.length) return this.nav.near(KI.B.x, KI.B.z - 300, 2000);
    if (near) {
      const close = list.filter((i) => Math.hypot(this.nav.nodes[i].x - near.x, this.nav.nodes[i].z - near.z) < r);
      if (close.length) return this.rnd.pick(close);
    }
    return this.rnd.pick(list);
  }

  private spawn(density: number): void {
    const rnd = this.rnd;
    const villageC = A(KI.village.u, 320), harborC = A(0.82, 240);
    const names = ['Suki', 'Ayame', 'Hana', 'Mei', 'Rin', 'Kaya', 'Yuki', 'Emi', 'Nori', 'Aiko', 'Saya', 'Tomoe', 'Kiko', 'Miyu', 'Oki', 'Chiyo'];
    let warriorIndex = 0;
    for (const role of Object.keys(LIFE.cast) as Role[]) {
      const count = Math.round(LIFE.cast[role] * density);
      for (let i = 0; i < count; i++) {
        const harborSide = role === 'fisher' || (role === 'trader' && i % 3 !== 0) || (role === 'villager' && i % 4 === 0);
        const home = this.pick(T.home | (harborSide ? T.harbor : T.village), harborSide ? harborC : villageC, 140);
        const job =
          role === 'farmer' ? this.pick(T.field)
          : role === 'fisher' ? this.pick(T.pier)
          : role === 'cook' ? this.pick(T.kitchen)
          : role === 'trader' ? this.pick(T.stall | (harborSide ? T.harbor : T.village))
          : role === 'warrior' ? this.pick(T.yard)
          : role === 'elder' ? this.pick(T.hall)
          : role === 'girl' ? this.pick(rnd.chance(0.5) ? T.well : T.statue)
          : this.pick(rnd.chance(0.5) ? T.stall : T.well);
        const n = this.nav.nodes[home];
        const acc = role === 'girl' ? KAcc.girl : role === 'warrior' && warriorIndex++ === 0 ? KAcc.captain : rnd.chance(0.5) ? KAcc.crown : KAcc.wings;
        const a: Agent = {
          role,
          name: role === 'warrior' && acc === KAcc.captain ? 'Captain Suki' : `${TITLES[role]} ${rnd.pick(names)}`,
          x: n.x + rnd.range(-1, 1),
          y: this.nodeY[home],
          z: n.z + rnd.range(-1, 1),
          yaw: rnd.range(-Math.PI, Math.PI),
          home,
          job,
          node: home,
          path: [],
          pi: 0,
          goal: home,
          activity: 'idle',
          timer: rnd.range(0, 6),
          speed: rnd.range(LIFE.walk[0], LIFE.walk[1]) * (role === 'girl' ? 1.15 : role === 'elder' ? 0.75 : 1),
          phase: rnd.range(0, 10),
          robe: rnd.pick(KYOSHI_LOOK.robes),
          skirt: rnd.pick(KYOSHI_LOOK.skirts),
          paint: rnd.pick(KYOSHI_LOOK.paint),
          acc,
          scale: role === 'girl' ? rnd.range(0.66, 0.78) : rnd.range(0.94, 1.03),
          greet: 0,
          slot: null,
          seat: -1,
        };
        if (role === 'warrior') {
          const k = this.agents.filter((x) => x.role === 'warrior').length;
          a.slot = { x: ((k % 5) - 2) * 3.2, z: (Math.floor(k / 5) - 1.5) * 3.4 };
        }
        // Start somewhere sensible for the hour (spread along the way).
        const start = rnd.chance(0.5) ? home : job;
        a.node = start;
        a.x = this.nav.nodes[start].x + rnd.range(-1.5, 1.5);
        a.z = this.nav.nodes[start].z + rnd.range(-1.5, 1.5);
        a.y = this.nodeY[start];
        this.agents.push(a);
      }
    }
    this.stats.total = this.agents.length;
  }

  /** Where an agent wants to be now, and what to do there. */
  private plan(a: Agent): { goal: number; act: Agent['activity'] } {
    const h = this.hour;
    const night = h >= 21.5 || h < 5;
    const dawn = h >= 5 && h < 8.5;
    const dusk = h >= 17.5 && h < 21.5;
    const r = this.rnd;
    switch (a.role) {
      case 'warrior':
        if (night) return a.acc === KAcc.captain || a.slot!.x > 4 ? { goal: this.pick(T.patrol), act: 'walk' } : { goal: a.home, act: 'home' };
        if (dawn || (h >= 15 && h < 17.5)) return { goal: a.job, act: 'drill' };
        if (dusk) return r.chance(0.5) ? { goal: this.pick(T.kitchen), act: 'talk' } : { goal: this.pick(T.patrol), act: 'walk' };
        return r.chance(0.55) ? { goal: this.pick(T.patrol), act: 'walk' } : { goal: this.pick(r.chance(0.5) ? T.pier : T.statue), act: 'idle' };
      case 'farmer':
        if (night) return { goal: a.home, act: 'home' };
        if (dusk) return { goal: this.pick(T.kitchen), act: 'talk' };
        if (h >= 11.5 && h < 13) return { goal: this.pick(T.well), act: 'idle' };
        return { goal: a.job, act: 'work' };
      case 'fisher':
        if (night) return { goal: a.home, act: 'home' };
        if (dawn || (h >= 15 && h < 17.5)) return { goal: a.job, act: 'work' };
        if (dusk) return { goal: this.pick(T.inn), act: 'talk' };
        return { goal: this.pick(r.chance(0.5) ? T.pier : T.stall | T.harbor), act: r.chance(0.5) ? 'carry' : 'work' };
      case 'cook':
        if (night) return { goal: a.home, act: 'home' };
        return { goal: h < 9 || dusk || (h >= 11 && h < 13.5) ? a.job : this.pick(T.stall), act: h < 9 || dusk || (h >= 11 && h < 13.5) ? 'work' : 'talk' };
      case 'trader':
        if (night) return { goal: a.home, act: 'home' };
        if (dusk) return { goal: this.pick(T.inn), act: 'talk' };
        return { goal: a.job, act: 'talk' };
      case 'elder':
        if (night || h < 7) return { goal: a.home, act: 'home' };
        return r.chance(0.6) ? { goal: a.job, act: 'sit' } : { goal: this.pick(r.chance(0.5) ? T.shrine : T.statue), act: 'idle' };
      case 'girl':
        if (night || h < 7 || h >= 20) return { goal: a.home, act: 'home' };
        return { goal: this.pick(r.chance(0.3) ? T.beach : r.chance(0.5) ? T.well : T.statue), act: r.chance(0.5) ? 'walk' : 'idle' };
      default:
        if (night) return { goal: a.home, act: 'home' };
        if (dusk) return { goal: this.pick(T.kitchen), act: 'talk' };
        return { goal: this.pick(r.chance(0.4) ? T.stall : r.chance(0.5) ? T.well : r.chance(0.5) ? T.shrine : T.beach), act: r.chance(0.5) ? 'talk' : 'idle' };
    }
  }

  /** Put everyone where the routine wants them at this hour (drill slots, stalls, homes...). */
  settle(): void {
    const yard = this.input.yard;
    for (const a of this.agents) a.seat = -1;
    for (const a of this.agents) {
      const plan = this.plan(a);
      const n = this.nav.nodes[plan.goal];
      let x = n.x, z = n.z;
      if (a.slot && n.tags & T.yard) {
        x = yard.x - Math.cos(yard.yaw) * a.slot.x + Math.sin(yard.yaw) * a.slot.z;
        z = yard.z + Math.sin(yard.yaw) * a.slot.x + Math.cos(yard.yaw) * a.slot.z;
      }
      a.x = x;
      a.z = z;
      a.y = this.nodeY[plan.goal];
      a.node = plan.goal;
      a.goal = plan.goal;
      a.path.length = 0;
      a.pi = 0;
      a.activity = plan.act === 'walk' ? 'idle' : plan.act;
      a.timer = this.rnd.range(4, 40);
      if (a.activity === 'drill') a.yaw = yard.yaw + Math.PI;
      else if (n.yaw !== undefined) a.yaw = n.yaw;
      this.spread(a);
    }
  }

  /**
   * Someone staying at a shared spot (the beach, the statue, a well...) takes a place of their own
   * around it instead of standing inside the others: a fixed spot per person on rings 0.9-2.3 m out,
   * never on the water or a roof.
   */
  private spread(a: Agent): void {
    const n = this.nav.nodes[a.node];
    // Sitting at the Meeting Hall: on a free council bench, never on thin air (all taken: stand by).
    const seats = this.input.seats;
    if (a.activity === 'sit' && n.tags & T.hall && seats?.length) {
      let free = -1;
      for (let i = 0; i < seats.length && free < 0; i++) if (!this.agents.some((o) => o !== a && o.seat === i)) free = i;
      if (free >= 0) {
        const st = seats[free];
        a.seat = free;
        a.x = st.x;
        a.z = st.z;
        a.y = st.y;
        a.yaw = st.yaw;
        return;
      }
      a.activity = 'idle';
    }
    if (!(n.tags & SHARED)) return;
    const k = this.agents.indexOf(a);
    const ang = k * 2.399963, r = 0.9 + (k % 3) * 0.7;
    const x = n.x + Math.cos(ang) * r, z = n.z + Math.sin(ang) * r;
    const g = this.input.ground(x, z);
    if (waterAt(x, z) || g - heightAt(x, z) > 2.5 || Math.abs(g - this.nodeY[a.node]) > 0.6) return;
    a.x = x;
    a.z = z;
    a.y = g;
  }

  private route(a: Agent, goal: number): void {
    const p = this.nav.path(a.node, goal, this.tmpPath, this.prev);
    if (!p) {
      // No way there on the walking graph: wait and plan again, never a straight line across the
      // bay or through the air.
      a.activity = 'idle';
      a.timer = 8 + this.rnd.range(0, 12);
      return;
    }
    a.goal = goal;
    a.path = p.slice();
    a.pi = 0;
    a.activity = 'walk';
    a.seat = -1;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  /** Drill pose of the moment (the whole yard moves in unison). */
  drillPose(): { pose: number; amt: number } {
    const k = (this.drillT * 0.55) % 4;
    return k < 1 ? { pose: Pose.raise, amt: 1 } : k < 2 ? { pose: Pose.push, amt: 1 } : k < 3 ? { pose: Pose.work, amt: 1 } : { pose: Pose.idle, amt: 0.4 };
  }

  update(dt: number, ctx: GameContext, cam: THREE.Camera): void {
    const t0 = performance.now();
    const hour = ctx.world.sky.timeOfDay;
    // First frame, or a jump in time (waiting, a journey, a loaded save): everyone is already where
    // the day wants them, instead of the whole island walking across at once.
    const first = this.lastHour < 0;
    let jump = first ? 0 : Math.abs(hour - this.lastHour);
    if (jump > 12) jump = 24 - jump;
    this.lastHour = hour;
    this.hour = hour;
    if (first || jump > 0.5) this.settle();
    this.drillT += dt;
    const player = ctx.player?.position;
    const camPos = cam.position;
    // Simulate everyone every few frames when far from the player, every frame when near.
    this.stepper = (this.stepper + 1) % 4;
    let walking = 0, drilling = 0, home = 0, village = 0, harbor = 0;
    const vC = this.vC, hC = this.hC;
    let best: Agent | null = null, bestD = 3.2;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const near = !!player && Math.abs(a.x - player.x) < 120 && Math.abs(a.z - player.z) < 120;
      if (!near && (i & 3) !== this.stepper) continue;
      const step = near ? dt : dt * 4;
      this.tick(a, step);
      if (a.activity === 'walk') walking++;
      if (a.activity === 'drill') drilling++;
      if (a.activity === 'home') home++;
      if (Math.hypot(a.x - vC.x, a.z - vC.z) < 110) village++;
      if (Math.hypot(a.x - hC.x, a.z - hC.z) < 90) harbor++;
      if (player && a.activity !== 'home') {
        const d = Math.hypot(a.x - player.x, a.z - player.z);
        if (d < 4.5 && a.activity !== 'walk') a.greet = Math.min(1, a.greet + step * 2);
        else a.greet = Math.max(0, a.greet - step);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
    }
    this.talkTarget = best;
    if (best) this.talkPos.set(best.x, best.y + 1, best.z);
    else this.talkPos.set(0, -1000, 0);
    // Draw.
    const f = this.figures;
    f.begin(camPos);
    f.view(cam);
    let drawn = 0;
    const dp = this.drillPose();
    for (const a of this.agents) {
      if (a.activity === 'home') continue;
      if (!f.visible(a.x, a.y, a.z)) continue;
      let pose: number = Pose.idle, amt = 0.6, lean = 0, yaw = a.yaw;
      switch (a.activity) {
        case 'walk':
          pose = Pose.walk;
          amt = 1;
          break;
        case 'work':
          pose = a.role === 'farmer' ? Pose.work : a.role === 'cook' ? Pose.sweep : Pose.work;
          break;
        case 'carry':
          // Landing the catch: bent over the baskets (nothing held overhead).
          pose = Pose.work;
          break;
        case 'talk':
          pose = Pose.talk;
          break;
        case 'sit':
          pose = Pose.sit;
          break;
        case 'drill':
          pose = dp.pose;
          amt = dp.amt;
          break;
      }
      if (a.greet > 0.05 && player && (a.activity === 'idle' || a.activity === 'talk')) {
        // Standing villagers turn part-way to look at the traveller, and carry on.
        const want = Math.atan2(player.x - a.x, player.z - a.z);
        let d = want - yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        yaw += d * a.greet * 0.6;
      }
      f.push(a.x, a.y, a.z, yaw, pose, a.phase, amt, lean, a.robe, a.skirt, a.paint, a.acc, a.scale);
      drawn++;
    }
    f.end();
    this.stats = { total: this.agents.length, drawn, walking, drilling, home, village, harbor, ms: performance.now() - t0 };
  }

  private tick(a: Agent, dt: number): void {
    a.phase += dt * (a.activity === 'walk' ? a.speed * 1.9 : 1);
    if (a.activity === 'walk') {
      const target = a.path[a.pi];
      if (target === undefined) {
        a.activity = 'idle';
        return;
      }
      const n = this.nav.nodes[target];
      let tx = n.x, tz = n.z;
      if (target === a.goal && a.slot && this.nav.nodes[target].tags & T.yard) {
        // Drill slot in the yard frame.
        const y = this.input.yard;
        tx = y.x - Math.cos(y.yaw) * a.slot.x + Math.sin(y.yaw) * a.slot.z;
        tz = y.z + Math.sin(y.yaw) * a.slot.x + Math.cos(y.yaw) * a.slot.z;
      }
      const dx = tx - a.x, dz = tz - a.z;
      const d = Math.hypot(dx, dz);
      const s = a.speed * dt;
      if (d <= s + 0.05) {
        a.x = tx;
        a.z = tz;
        a.node = target;
        a.y = this.nodeY[target];
        a.pi++;
        if (a.pi >= a.path.length) {
          a.activity = 'idle';
          a.timer = 0;
          const plan = this.plan(a);
          if (plan.goal === a.node || plan.act !== 'walk') {
            a.activity = plan.act === 'walk' ? 'idle' : plan.act;
            a.timer = 20 + this.rnd.range(0, 40);
            if (a.activity === 'drill') a.yaw = this.input.yard.yaw + Math.PI;
            else if (this.nav.nodes[a.node].yaw) a.yaw = this.nav.nodes[a.node].yaw;
            this.spread(a);
          }
        }
        return;
      }
      a.x += (dx / d) * s;
      a.z += (dz / d) * s;
      a.yaw = Math.atan2(dx, dz);
      // Height between graph nodes (decks included).
      const prevY = this.nodeY[a.node], nextY = this.nodeY[target];
      const segL = Math.hypot(n.x - this.nav.nodes[a.node].x, n.z - this.nav.nodes[a.node].z) || 1;
      a.y = nextY + (prevY - nextY) * Math.min(1, d / segL);
      return;
    }
    a.timer -= dt;
    if (a.timer > 0) return;
    const plan = this.plan(a);
    if (plan.goal === a.node) {
      a.activity = plan.act === 'walk' ? 'idle' : plan.act;
      a.timer = 15 + this.rnd.range(0, 30);
      return;
    }
    this.route(a, plan.goal);
  }

  /** The nearest islander in talking range (null when none). */
  get nearest(): { name: string; role: Role } | null {
    return this.talkTarget ? { name: this.talkTarget.name, role: this.talkTarget.role } : null;
  }

  /** One line from the nearest islander, by archetype and hour. */
  talk(ctx: GameContext): void {
    const a = this.talkTarget;
    if (!a) return;
    const lines = LINES[a.role];
    const h = this.hour;
    const extra = h >= 17.5 && h < 21.5 ? ' The lanterns will be lit soon — the kitchens are busy.' : '';
    const text = lines[Math.floor(this.rnd.next() * lines.length)] + extra;
    ctx.ui.showDialogue({ speaker: a.name, text, choices: [{ text: 'Farewell', onSelect: () => ctx.ui.hideDialogue() }] });
  }

  counts(): Record<string, number> {
    return { ...this.stats };
  }

  dispose(): void {
    this.figures.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
