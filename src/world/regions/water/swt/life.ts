import * as THREE from 'three';
import type { GameContext } from '../../../../core/GameContext';
import { Random } from '../../../../core/Random';
import { heightAt } from '../../../Heightfield';
import { WC, WC_GATE, WC_LANDING, WC_RAMP_FOOT, WC_SLED_RUN } from '../../../landforms/wolfCove';
import type { P2 } from '../../../WorldLayout';
import { FigureRenderer, Pose } from '../../earth/bssFigures';
import { NavGraph } from '../../earth/bssNav';
import { registerSwtAccessories, SAcc, SWT_LOOK } from './figures';
import { BOATYARD, C, CARVERS, CHIEF, DOG_PENS, type Dwelling, FLOOR, GREAT, HEARTH, PLAZA, POND, POND_HOLE, RACKS_N, RI, STORAGE, STORY_RING, SWT, TANNERY, TRADER, TRAINING } from './layout';
import { SHORE } from './shore';
import type { VillageInfo } from './village';
import type { WallInfo } from './wall';

/**
 * The people of Wolf Cove: about 180 simulated villagers in hooded, fur-trimmed parkas (figures.ts)
 * — hunters, fishers, warriors, waterbenders and healers, tanners, bone carvers, menders, cooks,
 * storytellers, elders, children and their neighbours — each with a home (an igloo or tent door),
 * a job and a routine on the shared clock:
 *
 *   dawn    hunters and fishers leave for the sea ice and the tundra; cooks relight the hearth;
 *           warriors drill in the training circle
 *   day     crafts (tannery, carvers, racks, boatyard), waterbenders' forms by the Frozen Pond,
 *           children on the pond ice and the sled run, sentries on the wall walk and at the gate
 *   dusk    the catch comes in to the racks and the storage igloo, the communal meal in the Great
 *           Igloo, stories in the storytelling ring
 *   night   fires, sentries in the towers and at the gate; everyone else indoors
 *
 * Walking uses a graph (bssNav): a free-space grid between the dwellings (links checked against
 * every footprint, paths straightened by line of sight), the Great Igloo's tunnel and hall, the stair
 * ramps and the wall walk, and the gate ramp down to the shore, the hunting ice, the sled run and
 * the tundra. Figures near the player turn to greet them; the nearest can be talked to.
 */

export type SwtRole = 'hunter' | 'fisher' | 'warrior' | 'bender' | 'tanner' | 'carver' | 'mender' | 'cook' | 'storyteller' | 'elder' | 'kid' | 'villager';

export const SWT_LIFE = {
  /** Population by role (≈ SWT.people; scaled by the graphics preset at build). */
  cast: { hunter: 16, fisher: 20, warrior: 14, bender: 10, tanner: 10, carver: 10, mender: 12, cook: 12, storyteller: 4, elder: 12, kid: 28, villager: 32 } as Record<SwtRole, number>,
  /** Draw ranges (m): full figures within `near`, a simple silhouette to `far`. */
  draw: { near: 62, far: 260 },
  walk: [1.05, 1.45] as [number, number],
  /** Free-space walking grid between the dwellings (m). */
  grid: 2.6,
  /** Sled ride down the run (m/s, top speed). */
  sled: 7,
} as const;

const T = {
  lane: 1 << 0,
  home: 1 << 1,
  hearth: 1 << 2,
  hall: 1 << 3,
  story: 1 << 4,
  plaza: 1 << 5,
  pond: 1 << 6,
  training: 1 << 7,
  racks: 1 << 8,
  tannery: 1 << 9,
  craft: 1 << 10,
  storage: 1 << 11,
  dogs: 1 << 12,
  healer: 1 << 13,
  wall: 1 << 14,
  tower: 1 << 15,
  gate: 1 << 16,
  shore: 1 << 17,
  ice: 1 << 18,
  tundra: 1 << 19,
  sled: 1 << 20,
  outside: 1 << 21,
  seat: 1 << 22,
  trader: 1 << 23,
  draw: 1 << 24,
  play: 1 << 25,
  chair: 1 << 26,
  penguins: 1 << 27,
  cook: 1 << 28,
} as const;

type Activity = 'walk' | 'idle' | 'work' | 'talk' | 'sit' | 'form' | 'carry' | 'home' | 'sled' | 'dance' | 'play';

interface Agent {
  role: SwtRole;
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
  /** What to do on arrival. */
  act: Activity;
  activity: Activity;
  timer: number;
  speed: number;
  phase: number;
  coat: number;
  pants: number;
  skin: number;
  acc: number;
  scale: number;
  greet: number;
  /** Reserved seat (node) or −1. */
  seat: number;
  /** Standing offset at open places (unit disc). */
  ox: number;
  oz: number;
  /** Distance down the sled run while riding; runs made today. */
  sled: number;
  runs: number;
  /** Index within the role (sentry posts, the storyteller's chair). */
  k: number;
}

/** A person in a boat or on a sled the wildlife module wants drawn with the crowd. */
export interface Rider {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: number;
  phase: number;
}

const LINES: Record<SwtRole, string[]> = {
  hunter: ['The tiger seals are fat this season. We go out before the light.', 'Read the ice before you trust it. Grey ice is thin ice.', 'A good hunter brings back enough for every igloo, not just his own.'],
  fisher: ['The fish run under the shore ice. Patience and a sharp spear.', 'Our canoes go out at dawn and come home before the wind turns.', 'Mind the ice edge, traveller. The sea takes the careless.'],
  warrior: ['We keep watch from the towers. Nothing crosses the ice unseen.', 'Our benders raised this wall block by block. It has never fallen.', 'Black snow means fire ships. Pray you never see it.'],
  bender: ['Water is patient. In time it shapes even the hardest ice.', 'The Frozen Pond keeps a hole open for us. Push and pull — that is the whole of it.', 'A healer listens to the water in the body. It always has something to say.'],
  tanner: ['Every seal gives us coats, oil and thread. Nothing is wasted.', 'Scraped, stretched and smoked — then it keeps you warm for twenty winters.'],
  carver: ['Whalebone and ivory. The knife finds the shape that is already inside.', 'This one will be a comb for a bride. I carve a wave on every piece.'],
  mender: ['Nets tear, hides split, sleds crack. My hands are never idle.', 'Pull the sinew tight or the cold walks right in.'],
  cook: ['Sea prunes stewed in seal broth. It is better than it sounds!', 'At dusk the whole village eats together in the Great Igloo. Come hungry.'],
  storyteller: ['Sit by the fire at dusk and I will tell you how the first wall was raised.', 'Every story here begins with the sea and ends with the ice.'],
  elder: ['When I was young the wall was half this height. The village grows, and so does the cold.', 'Respect the sea, respect the ice, respect your elders — in that order.'],
  kid: ['Have you been down the sled run? It goes right through the ice tunnel!', 'The penguins are faster than me on their bellies. Not for long!'],
  villager: ['Welcome to Wolf Cove, traveller. Warm yourself by the hearth.', 'The trader by the path has sea prunes. The best on the ice, he says.'],
};
const TITLES: Record<SwtRole, string> = {
  hunter: 'Hunter',
  fisher: 'Fisher',
  warrior: 'Warrior',
  bender: 'Waterbender',
  tanner: 'Tanner',
  carver: 'Bone Carver',
  mender: 'Mender',
  cook: 'Cook',
  storyteller: 'Storyteller',
  elder: 'Elder',
  kid: 'Young',
  villager: 'Villager',
};
const NAMES = ['Aklak', 'Tulok', 'Ukiak', 'Pana', 'Ataq', 'Kallik', 'Amaruq', 'Ila', 'Malik', 'Tapeesa', 'Qannik', 'Sura', 'Anik', 'Kiri', 'Nauja', 'Tikaani', 'Yura', 'Imaq', 'Uki', 'Saqa', 'Kunik', 'Nilak', 'Arnaq', 'Pilu'];

/** Footprints the walkers keep off (circles), bucketed for segment tests. */
class Obstacles {
  private readonly cells = new Map<number, number[]>();
  private readonly c: number[] = [];
  private stamp = new Int32Array(64);
  private tick = 0;

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  add(x: number, z: number, r: number): void {
    const id = this.c.length / 3;
    this.c.push(x, z, r);
    for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++) {
      for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++) {
        const k = this.key(i, j);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(id);
      }
    }
  }

  /** Visit the obstacles whose buckets overlap a box; stops (false) when `f` returns false. */
  private each(x0: number, z0: number, x1: number, z1: number, f: (id: number) => boolean): boolean {
    const n = this.c.length / 3;
    if (this.stamp.length < n) this.stamp = new Int32Array(n + 64);
    const t = ++this.tick;
    for (let i = Math.floor(x0 / 8); i <= Math.floor(x1 / 8); i++) {
      for (let j = Math.floor(z0 / 8); j <= Math.floor(z1 / 8); j++) {
        const l = this.cells.get(this.key(i, j));
        if (!l) continue;
        for (const id of l) {
          if (this.stamp[id] === t) continue;
          this.stamp[id] = t;
          if (!f(id)) return false;
        }
      }
    }
    return true;
  }

  /** Is (x, z) at least `pad` m outside every footprint? */
  clear(x: number, z: number, pad = 0): boolean {
    const c = this.c;
    return this.each(x - pad, z - pad, x + pad, z + pad, (id) => {
      const dx = x - c[id * 3], dz = z - c[id * 3 + 1], r = c[id * 3 + 2] + pad;
      return dx * dx + dz * dz >= r * r;
    });
  }

  /** Does the segment keep `pad` m clear of every footprint (footprints holding an end are ignored)? */
  segClear(ax: number, az: number, bx: number, bz: number, pad = 0.15): boolean {
    const c = this.c;
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1e-6;
    return this.each(Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad, (id) => {
      const ox = c[id * 3], oz = c[id * 3 + 1], r = c[id * 3 + 2];
      if ((ax - ox) ** 2 + (az - oz) ** 2 < r * r || (bx - ox) ** 2 + (bz - oz) ** 2 < r * r) return true;
      const t = Math.max(0, Math.min(1, ((ox - ax) * dx + (oz - az) * dz) / L2));
      const px = ax + dx * t - ox, pz = az + dz * t - oz;
      return px * px + pz * pz >= (r + pad) * (r + pad);
    });
  }
}

export interface LifeInput {
  dwellings: Dwelling[];
  village: VillageInfo;
  wall: WallInfo;
}

const outY = (x: number, z: number): number => Math.max(heightAt(x, z), SHORE.iceY);
const runY = (x: number, z: number): number => heightAt(x, z) + 0.1;

export class WolfCoveLife {
  readonly group = new THREE.Group();
  readonly nav = new NavGraph();
  readonly agents: Agent[] = [];
  private readonly figures: FigureRenderer;
  private readonly obstacles = new Obstacles();
  private nodeY = new Float32Array(0);
  /** Node is on the village floor (paths through it may be straightened). */
  private free = new Uint8Array(0);
  private outside = new Uint8Array(0);
  private jit = new Float32Array(0);
  private seatOwner = new Int32Array(0);
  private reach = new Uint8Array(0);
  private readonly rnd = new Random(SWT.seed + 77);
  private prev = new Int32Array(0);
  private readonly tmpPath: number[] = [];
  private hour = 9;
  private lastHour = -1;
  private stepper = 0;
  private t = 0;
  private talkTarget: Agent | null = null;
  readonly talkPos = new THREE.Vector3(0, -1000, 0);
  /** Mouths of the villagers nearest the player (breath in the cold); `breathN` are valid. */
  readonly breathers: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  breathN = 0;
  private readonly nearBuf: Agent[] = [];
  /** The sentry posts (towers and the gate) in order. */
  private posts: number[] = [];
  private chair = -1;
  private sledTop = -1;
  private sledBottom = -1;
  private readonly run: P2[] = WC_SLED_RUN.slice(0, 4).map((p) => ({ x: p.x, z: p.z }));
  private runLen = 0;
  private readonly sledMesh: THREE.InstancedMesh;
  private readonly sledGeo: THREE.BufferGeometry;
  private readonly sledMat: THREE.Material;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  /** Festival night (everyone at the plaza, dancing) and the raided state (people indoors, guards out). */
  festival = false;
  raided = false;
  stats = { total: 0, drawn: 0, walking: 0, home: 0, village: 0, shore: 0, hall: 0, wall: 0, sledding: 0, outside: 0, nodes: 0, unreachable: 0, lost: 0, ms: 0 };

  constructor(parent: THREE.Group, private readonly input: LifeInput, density = 1) {
    registerSwtAccessories();
    this.group.name = 'swt_life';
    parent.add(this.group);
    this.buildNav();
    let n = 0;
    for (const r of Object.keys(SWT_LIFE.cast) as SwtRole[]) n += Math.round(SWT_LIFE.cast[r] * density);
    this.figures = new FigureRenderer(this.group, n + 24);
    this.figures.setRange(SWT_LIFE.draw.near, SWT_LIFE.draw.far);
    for (let i = 1; i < this.run.length; i++) this.runLen += Math.hypot(this.run[i].x - this.run[i - 1].x, this.run[i].z - this.run[i - 1].z);
    // Little sleds under the children riding the run.
    this.sledGeo = sledGeometry();
    this.sledMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.sledMesh = new THREE.InstancedMesh(this.sledGeo, this.sledMat, 16);
    this.sledMesh.count = 0;
    this.sledMesh.frustumCulled = false;
    this.sledMesh.name = 'swt_kid_sleds';
    this.group.add(this.sledMesh);
    this.spawn(density);
  }

  // ---------------------------------------------------------------------------
  // Walking graph
  // ---------------------------------------------------------------------------

  private buildNav(): void {
    const nav = this.nav, ob = this.obstacles, inp = this.input;
    // Footprints: dwellings and their entrance tunnels, the landmarks, the stair ramps.
    for (const d of inp.dwellings) {
      ob.add(d.x, d.z, d.r + (d.kind === 'tent' ? 0.25 : 0.35));
      if (d.kind === 'igloo') ob.add(d.x + Math.sin(d.yaw) * (d.r + 0.4), d.z + Math.cos(d.yaw) * (d.r + 0.4), 0.75);
      if (d.annex) ob.add(d.annex.x, d.annex.z, d.annex.r + 0.3);
    }
    ob.add(GREAT.x, GREAT.z, GREAT.r + 0.4);
    for (let s = 0.5; s < GREAT.tunnel - 0.5; s += 1) ob.add(GREAT.x, GREAT.z - GREAT.r - s, 1.45);
    for (const it of inp.village.interiors) if (it.kind === 'healer' || it.kind === 'workshop') ob.add(it.x, it.z, it.r + 0.3);
    ob.add(CARVERS.x, CARVERS.z, CARVERS.r + 0.3);
    for (let k = -2; k <= 2; k++) ob.add(STORAGE.x + Math.cos(STORAGE.yaw) * k * 2.6, STORAGE.z - Math.sin(STORAGE.yaw) * k * 2.6, STORAGE.w / 2 + 0.35);
    ob.add(DOG_PENS.x, DOG_PENS.z, DOG_PENS.r + 0.3);
    ob.add(STORY_RING.x, STORY_RING.z, 1.0);
    ob.add(HEARTH.x, HEARTH.z, 1.5);
    ob.add(POND_HOLE.x, POND_HOLE.z, POND_HOLE.r + 0.6);
    for (const r of RACKS_N) ob.add(r.x, r.z, 2.6);
    ob.add(TANNERY.x, TANNERY.z, TANNERY.r - 0.8);
    ob.add(BOATYARD.x, BOATYARD.z, BOATYARD.r - 1.5);
    ob.add(CHIEF.x, CHIEF.z, 1.4);
    ob.add(TRADER.x, TRADER.z, 1.8);
    for (const s of inp.wall.stairs) {
      for (let t = 0.25; t <= 1.001; t += 0.25) ob.add(s.foot.x + (s.head.x - s.foot.x) * t, s.foot.z + (s.head.z - s.foot.z) * t, 1.15);
    }

    // The free-space grid between the dwellings (village floor).
    const g = SWT_LIFE.grid;
    const span = Math.ceil(RI / g);
    const ids = new Map<number, number>();
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        const x = C.x + i * g, z = C.z + j * g;
        if (Math.hypot(x - C.x, z - C.z) > RI - 1.3) continue;
        if (!ob.clear(x, z, 0.3)) continue;
        ids.set(i * 1000 + j, nav.addNode(x, z, T.lane, 0));
      }
    }
    for (const [key, id] of ids) {
      const i = Math.round(key / 1000), j = key - i * 1000;
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
        const o = ids.get((i + di) * 1000 + (j + dj));
        if (o === undefined) continue;
        const a = nav.nodes[id], b = nav.nodes[o];
        if (ob.segClear(a.x, a.z, b.x, b.z)) nav.link(id, o);
      }
    }
    // Keep the grid's main component (pockets walled in by igloos are dropped from linking).
    const gridN = nav.nodes.length;
    const main = new Uint8Array(gridN);
    {
      const start = nav.near(PLAZA.x, PLAZA.z - 7, 10, T.lane);
      const q = [start];
      if (start >= 0) main[start] = 1;
      for (let h = 0; h < q.length; h++) for (const e of nav.nodes[q[h]].edges) if (!main[e]) (main[e] = 1), q.push(e);
    }
    const yAt: number[] = [];
    const free: number[] = [];
    const out: number[] = [];
    const jit: number[] = [];
    const meta = (id: number, y: number, isFree: boolean, isOut: boolean, j: number) => {
      yAt[id] = y;
      free[id] = isFree ? 1 : 0;
      out[id] = isOut ? 1 : 0;
      jit[id] = j;
    };
    for (let i = 0; i < gridN; i++) meta(i, FLOOR, true, false, 0);
    let unreachable = 0;
    /** A point of interest on the village floor, linked to the nearest grid nodes it can see. */
    const poi = (x: number, z: number, tags: number, yaw = 0, j = 0, links = 2): number => {
      const id = nav.addNode(x, z, tags, 0, yaw);
      meta(id, FLOOR, true, false, j);
      let n = 0;
      for (const o of nav.around(x, z, 7, T.lane)) {
        if (o >= gridN || !main[o]) continue;
        const b = nav.nodes[o];
        if (!ob.segClear(x, z, b.x, b.z)) continue;
        nav.link(id, o);
        if (++n >= links) break;
      }
      if (!n) unreachable++;
      return id;
    };
    const ring = (x: number, z: number, r: number, n: number, tags: number, j: number, a0 = 0, face = true): number[] => {
      const outIds: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2;
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (!ob.clear(px, pz, 0.2)) continue;
        outIds.push(poi(px, pz, tags, face ? Math.atan2(x - px, z - pz) : 0, j));
      }
      return outIds;
    };

    // Doors (homes).
    for (const d of inp.village.doors) poi(d.x, d.z, T.home, d.yaw, 0.25);
    // Hearth Plaza: standing room, the cooks' places at the fire, the seats.
    ring(PLAZA.x, PLAZA.z, 6.3, 9, T.plaza, 1.3, 0.2);
    ring(HEARTH.x, HEARTH.z, 2.15, 3, T.cook, 0.2, 0.9);
    // The Great Igloo: tunnel, hall floor round the fire, the seats.
    const mouth = poi(GREAT.x, GREAT.z - GREAT.r - GREAT.tunnel - 1.2, T.plaza, 0, 0.6, 3);
    const tunnel = nav.addNode(GREAT.x, GREAT.z - GREAT.r - GREAT.tunnel / 2, 0, 0);
    meta(tunnel, FLOOR, false, false, 0);
    const inner = nav.addNode(GREAT.x, GREAT.z - GREAT.r + 1.4, T.hall, 0, 0);
    meta(inner, FLOOR, false, false, 0.4);
    nav.link(mouth, tunnel);
    nav.link(tunnel, inner);
    const hallRing: number[] = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.31;
      const px = GREAT.x + Math.sin(a) * 3.1, pz = GREAT.z + Math.cos(a) * 3.1;
      const id = nav.addNode(px, pz, T.hall, 0, Math.atan2(GREAT.x - px, GREAT.z - pz));
      meta(id, FLOOR, false, false, 0.7);
      if (hallRing.length) nav.link(id, hallRing[hallRing.length - 1]);
      hallRing.push(id);
    }
    nav.link(hallRing[0], hallRing[hallRing.length - 1]);
    const nearest = (list: number[], x: number, z: number) => list.reduce((b, o) => (Math.hypot(nav.nodes[o].x - x, nav.nodes[o].z - z) < Math.hypot(nav.nodes[b].x - x, nav.nodes[b].z - z) ? o : b), list[0]);
    nav.link(inner, nearest(hallRing, GREAT.x, GREAT.z - GREAT.r));
    // Seats: the Great Igloo's benches, the hearth's logs (and the storyteller's chair), the story ring.
    const chairPos = { x: HEARTH.x + 0.4, z: HEARTH.z + 4.6 };
    for (const s of inp.village.seats) {
      const inHall = Math.hypot(s.x - GREAT.x, s.z - GREAT.z) < GREAT.r;
      if (inHall) {
        const id = nav.addNode(s.x, s.z, T.hall | T.seat, 0, s.yaw);
        meta(id, FLOOR, false, false, 0);
        nav.link(id, nearest(hallRing, s.x, s.z));
        continue;
      }
      const story = Math.hypot(s.x - STORY_RING.x, s.z - STORY_RING.z) < STORY_RING.r + 1.5;
      const chair = Math.hypot(s.x - chairPos.x, s.z - chairPos.z) < 0.6;
      const id = poi(s.x, s.z, (story ? T.story : T.hearth) | T.seat | (chair ? T.chair : 0), s.yaw, 0, 2);
      if (chair) this.chair = id;
    }
    ring(STORY_RING.x, STORY_RING.z, STORY_RING.r + 1.3, 5, T.story, 0.5, 0.4);
    // The Frozen Pond: the edge, the thawed hole (drawing water), the ice the children slide on.
    ring(POND.x, POND.z, POND.r + 1.1, 9, T.pond, 0.9, 0.3);
    {
      const dx = POND_HOLE.x - POND.x, dz = POND_HOLE.z - POND.z, l = Math.hypot(dx, dz) || 1;
      for (const s of [-0.7, 0.7]) {
        const a = Math.atan2(dx, dz) + s;
        const px = POND_HOLE.x + Math.sin(a) * (POND_HOLE.r + 0.75), pz = POND_HOLE.z + Math.cos(a) * (POND_HOLE.r + 0.75);
        poi(px, pz, T.pond | T.draw, Math.atan2(POND_HOLE.x - px, POND_HOLE.z - pz), 0, 3);
      }
      for (let k = 0; k < 4; k++) {
        const a = Math.atan2(-dx / l, -dz / l) + (k - 1.5) * 0.55;
        poi(POND.x + Math.sin(a) * 3.4, POND.z + Math.cos(a) * 3.4, T.pond | T.play, 0, 1.2, 3);
      }
    }
    // The training circle: two rings of places facing the centre.
    ring(TRAINING.x, TRAINING.z, 2.2, 4, T.training, 0, Math.PI / 4);
    ring(TRAINING.x, TRAINING.z, 4.4, 6, T.training, 0, 0);
    // Work: drying racks, tannery, workshops and the carvers' corner, the boatyard, storage, dogs.
    for (const r of RACKS_N) for (const [dx, dz] of [[3.2, 0], [-3.2, 0], [0, 3.2], [0, -3.2]]) if (ob.clear(r.x + dx, r.z + dz, 0.2)) poi(r.x + dx, r.z + dz, T.racks, Math.atan2(-dx, -dz), 0.4);
    ring(TANNERY.x, TANNERY.z, TANNERY.r, 5, T.tannery, 0.5, 0.2);
    for (const it of inp.village.interiors) {
      const door = { x: it.x + Math.sin(it.yaw) * (it.r + 1.4), z: it.z + Math.cos(it.yaw) * (it.r + 1.4) };
      if (it.kind === 'workshop') poi(door.x, door.z, T.craft, it.yaw, 0.6);
      if (it.kind === 'healer') poi(door.x, door.z, T.healer, it.yaw, 0.5);
    }
    ring(CARVERS.x, CARVERS.z, CARVERS.r + 1.2, 5, T.craft, 0.4, 0.5);
    ring(BOATYARD.x, BOATYARD.z, BOATYARD.r - 0.7, 5, T.craft, 0.5, 0.1);
    for (const s of [-1, 1]) {
      const px = STORAGE.x + Math.cos(STORAGE.yaw) * s * (STORAGE.len / 2 + 1.6), pz = STORAGE.z - Math.sin(STORAGE.yaw) * s * (STORAGE.len / 2 + 1.6);
      if (ob.clear(px, pz, 0.2)) poi(px, pz, T.storage, Math.atan2(STORAGE.x - px, STORAGE.z - pz), 0.6);
    }
    ring(DOG_PENS.x, DOG_PENS.z, DOG_PENS.r + 1.3, 6, T.dogs, 0.5, 0.25);
    poi(TRADER.x - 2.3, TRADER.z, T.trader, Math.PI / 2, 0.6);
    poi(TRADER.x - 2.2, TRADER.z + 1.6, T.trader, Math.PI / 2, 0.4);

    // Gate posts (inside) and the gate passage out to the ramp.
    const gateIn = poi(WC_GATE.x, WC_GATE.z + 5, T.gate, Math.PI, 0.8, 3);
    for (const s of [-1, 1]) {
      const id = poi(WC_GATE.x + s * 3.4, WC_GATE.z + 2.6, T.gate | T.tower, Math.PI, 0);
      this.posts.push(id);
    }
    // Outside: the gate ramp, the shore and the hunting ice, the sled run, the tundra.
    const outNode = (p: P2, tags = 0, yaw = 0, j = 0): number => {
      const id = nav.addNode(p.x, p.z, tags | T.outside, 0, yaw);
      meta(id, outY(p.x, p.z), false, true, j);
      return id;
    };
    const chain = (ids2: number[]) => {
      for (let i = 1; i < ids2.length; i++) nav.link(ids2[i - 1], ids2[i]);
      return ids2;
    };
    const gateOut = outNode({ x: WC_GATE.x, z: WC_GATE.z - 3 }, T.gate);
    nav.link(gateIn, gateOut);
    const ramp: number[] = [gateOut];
    for (let z = WC_GATE.z - 12; z > WC_RAMP_FOOT.z + 4; z -= 10) ramp.push(outNode({ x: WC_GATE.x, z }));
    const foot = outNode(WC_RAMP_FOOT);
    ramp.push(foot);
    chain(ramp);
    for (const s of [-1, 1]) {
      const id = outNode({ x: WC_GATE.x + s * 3.6, z: WC_GATE.z - 5 }, T.gate | T.tower, Math.PI);
      nav.link(id, ramp[1]);
      this.posts.push(id);
    }
    const L = WC_LANDING;
    const landing = outNode(L, T.shore, Math.PI, 2.2);
    chain([foot, outNode({ x: 226, z: 1510 }), landing]);
    for (const [dx, dz] of [[-7, 3], [7, 2], [0, 6]]) nav.link(landing, outNode({ x: L.x + dx, z: L.z + dz }, T.shore, Math.PI, 1.6));
    const ice = outNode(SHORE.akka, T.ice, 0, 3.5);
    chain([landing, outNode({ x: 249, z: 1469 }), ice]);
    for (const h of SHORE.holes) {
      const a = Math.atan2(SHORE.akka.x - h.x, SHORE.akka.z - h.z);
      const id = outNode({ x: h.x + Math.sin(a) * (h.r + 0.8), z: h.z + Math.cos(a) * (h.r + 0.8) }, T.ice, a + Math.PI, 0.2);
      nav.link(id, ice);
    }
    // West along the plain to the penguins and the sled run (walk up beside it, ride down it).
    const run = WC_SLED_RUN;
    const westA = outNode({ x: 196, z: 1530 }), westB = outNode({ x: 166, z: 1521 }), westC = outNode({ x: 138, z: 1506 });
    chain([foot, westA, westB, westC]);
    const watch = outNode({ x: 125, z: 1490 }, T.penguins, -Math.PI / 2, 1.5);
    nav.link(westC, watch);
    const b0 = outNode({ x: run[3].x + 4.5, z: run[3].z });
    const b1 = outNode({ x: run[2].x + 5, z: run[2].z });
    const b2 = outNode({ x: run[1].x + 5, z: run[1].z });
    const top = outNode({ x: run[0].x + 4, z: run[0].z + 1 }, T.sled, -Math.PI / 2, 0.8);
    chain([b0, b1, b2, top]);
    nav.link(westC, b1);
    nav.link(watch, b1);
    this.sledTop = top;
    this.sledBottom = b0;
    // East round the wall to the tundra.
    const east = chain([foot, outNode({ x: 252, z: 1532 }), outNode({ x: 288, z: 1544 }), outNode({ x: 312, z: 1574 }), outNode({ x: 320, z: 1620 }), outNode({ x: 316, z: 1672 })]);
    const t1 = outNode({ x: 300, z: 1722 }, T.tundra, 0.4, 4);
    const t2 = outNode({ x: 262, z: 1764 }, T.tundra, 0.1, 4);
    chain([east[east.length - 1], t1, t2]);

    // The stair ramps and the wall walk (towers are sentry posts).
    const RW = WC.R - WC.wallT / 2;
    const angles: number[] = [];
    const towers = inp.wall.towers;
    for (let a = 0.16; a < Math.PI * 2 - 0.16; a += 4 / RW) angles.push(a);
    for (const tw of towers) angles.push(tw.a);
    angles.sort((p, q) => p - q);
    const walk: number[] = [];
    let lastA = -1;
    for (const a of angles) {
      const tower = towers.find((tw) => Math.abs(tw.a - a) < 1e-6);
      if (!tower && a - lastA < 0.02) continue;
      if (!tower && towers.some((tw) => Math.abs(tw.a - a) < 0.025)) continue;
      lastA = a;
      const x = C.x + Math.sin(a) * RW, z = C.z - Math.cos(a) * RW;
      const out2 = Math.atan2(Math.sin(a), -Math.cos(a));
      const id = nav.addNode(x, z, T.wall | (tower ? T.tower : 0), 0, out2);
      meta(id, WC.wallTop, false, false, tower ? 0.4 : 0.15);
      if (walk.length) nav.link(id, walk[walk.length - 1]);
      walk.push(id);
      if (tower) this.posts.unshift(id);
    }
    for (const s of inp.wall.stairs) {
      const footId = poi(s.foot.x, s.foot.z, 0, 0, 0, 3);
      const head = nav.addNode(s.head.x, s.head.z, 0, 0, 0);
      meta(head, WC.wallTop, false, false, 0);
      nav.link(footId, head);
      nav.link(head, nearest(walk, s.head.x, s.head.z));
    }

    // Tables.
    const N = nav.nodes.length;
    this.nodeY = new Float32Array(N);
    this.free = new Uint8Array(N);
    this.outside = new Uint8Array(N);
    this.jit = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.nodeY[i] = yAt[i] ?? FLOOR;
      this.free[i] = free[i] ?? 0;
      this.outside[i] = out[i] ?? 0;
      this.jit[i] = jit[i] ?? 0;
    }
    this.seatOwner = new Int32Array(N).fill(-1);
    this.prev = new Int32Array(N);
    // Reachable from the plaza: only these are chosen as goals.
    this.reach = new Uint8Array(N);
    const start = nav.near(PLAZA.x, PLAZA.z - 7, 10, T.lane);
    const q = [start];
    this.reach[start] = 1;
    for (let h = 0; h < q.length; h++) for (const e of nav.nodes[q[h]].edges) if (!this.reach[e]) (this.reach[e] = 1), q.push(e);
    let lost = 0;
    for (let i = gridN; i < N; i++) if (!this.reach[i]) lost++;
    this.stats.nodes = N;
    this.stats.unreachable = unreachable;
    this.stats.lost = lost;
  }

  private list = new Map<number, number[]>();
  /** Reachable nodes with all of `mask` (cached). */
  private find(mask: number): number[] {
    let l = this.list.get(mask);
    if (!l) {
      // Standing places exclude seats unless seats are asked for.
      l = this.nav.find(mask, mask & T.seat ? 0 : T.seat).filter((i) => this.reach[i]);
      this.list.set(mask, l);
    }
    return l;
  }

  private pick(mask: number, fallback = T.plaza): number {
    const l = this.find(mask);
    if (l.length) return this.rnd.pick(l);
    const f = this.find(fallback);
    return f.length ? this.rnd.pick(f) : 0;
  }

  /** A free seat with `mask` (reserved for the agent), or −1. */
  private seat(a: Agent, mask: number): number {
    const l = this.find(mask | T.seat);
    if (!l.length) return -1;
    const i0 = Math.floor(this.rnd.next() * l.length);
    for (let k = 0; k < l.length; k++) {
      const s = l[(i0 + k) % l.length];
      if (this.seatOwner[s] < 0 && s !== this.chair) {
        this.seatOwner[s] = this.agents.indexOf(a);
        a.seat = s;
        return s;
      }
    }
    return -1;
  }

  private release(a: Agent): void {
    if (a.seat >= 0 && this.seatOwner[a.seat] >= 0 && this.agents[this.seatOwner[a.seat]] === a) this.seatOwner[a.seat] = -1;
    a.seat = -1;
  }

  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------

  private spawn(density: number): void {
    const rnd = this.rnd;
    const doors = rnd.shuffle(this.find(T.home).slice());
    let door = 0;
    const kIndex: Partial<Record<SwtRole, number>> = {};
    for (const role of Object.keys(SWT_LIFE.cast) as SwtRole[]) {
      const count = Math.round(SWT_LIFE.cast[role] * density);
      for (let i = 0; i < count; i++) {
        const home = doors.length ? doors[door++ % doors.length] : this.pick(T.plaza);
        const job =
          role === 'hunter' ? this.pick(i % 2 ? T.tundra : T.ice)
          : role === 'fisher' ? this.pick(i % 3 === 0 ? T.shore : T.ice)
          : role === 'tanner' ? this.pick(T.tannery)
          : role === 'carver' ? this.pick(T.craft)
          : role === 'mender' ? this.pick(i % 2 ? T.racks : T.craft)
          : role === 'cook' ? this.pick(T.cook)
          : role === 'bender' ? this.pick(T.training)
          : role === 'warrior' ? this.pick(T.training)
          : this.pick(T.plaza);
        const female = role === 'bender' || (role !== 'warrior' && role !== 'hunter' && rnd.chance(0.5));
        const acc =
          role === 'kid' ? SAcc.kid
          : role === 'elder' || role === 'storyteller' ? SAcc.elder
          : role === 'warrior' ? SAcc.warrior
          : role === 'bender' ? SAcc.bender
          : role === 'hunter' || (role === 'fisher' && rnd.chance(0.6)) ? SAcc.hunter
          : female ? (rnd.chance(0.65) ? SAcc.woman : SAcc.womanViolet)
          : rnd.chance(0.6) ? SAcc.man : SAcc.manNavy;
        const coat = SWT_LOOK.coats[acc];
        const n = this.nav.nodes[home];
        const k = kIndex[role] ?? 0;
        kIndex[role] = k + 1;
        const ang = rnd.next() * Math.PI * 2, rad = Math.sqrt(rnd.next());
        const title = role === 'bender' && k % 3 === 2 ? 'Healer' : TITLES[role];
        const a: Agent = {
          role,
          name: `${title} ${rnd.pick(NAMES)}`,
          x: n.x,
          y: this.nodeY[home],
          z: n.z,
          yaw: rnd.range(-Math.PI, Math.PI),
          home,
          job,
          node: home,
          path: [],
          pi: 0,
          goal: home,
          act: 'idle',
          activity: 'idle',
          timer: rnd.range(0, 6),
          speed: rnd.range(SWT_LIFE.walk[0], SWT_LIFE.walk[1]) * (role === 'kid' ? 1.25 : role === 'elder' ? 0.72 : 1),
          phase: rnd.range(0, 10),
          coat: shade(coat, rnd.range(-0.06, 0.06)),
          pants: rnd.pick(SWT_LOOK.pants),
          skin: rnd.pick(SWT_LOOK.skin),
          acc,
          scale: role === 'kid' ? rnd.range(0.62, 0.76) : role === 'elder' ? rnd.range(0.9, 0.97) : rnd.range(0.95, 1.05),
          greet: 0,
          seat: -1,
          ox: Math.sin(ang) * rad,
          oz: Math.cos(ang) * rad,
          sled: -1,
          runs: 0,
          k,
        };
        this.agents.push(a);
      }
    }
    this.stats.total = this.agents.length;
  }

  /** Where an agent wants to be now, and what to do there. */
  private plan(a: Agent): { goal: number; act: Activity } {
    const h = this.hour;
    const r = this.rnd;
    const night = h >= 21.5 || h < 5;
    const dawn = h >= 5 && h < 8.5;
    const catchIn = h >= 15.5 && h < 17.75;
    const meal = h >= 17.75 && h < 20.25;
    const evening = h >= 20.25 && h < 21.5;
    const home = { goal: a.home, act: 'home' as Activity };
    const mealPlan = (): { goal: number; act: Activity } => {
      const s = r.chance(0.55) ? this.seat(a, T.hall) : -1;
      if (s >= 0) return { goal: s, act: 'sit' };
      const hs = r.chance(0.4) ? this.seat(a, T.hearth) : -1;
      if (hs >= 0) return { goal: hs, act: 'sit' };
      return r.chance(0.5) ? { goal: this.pick(T.hall), act: 'talk' } : { goal: this.pick(T.plaza), act: 'talk' };
    };
    // Sentries keep their posts at night and through a raid.
    if (a.role === 'warrior' && (night || this.raided) && a.k < this.posts.length) return { goal: this.posts[a.k], act: 'idle' };
    if (this.raided && a.role !== 'warrior' && a.role !== 'bender' && a.role !== 'cook') {
      return h >= 9 && h < 17 && r.chance(0.25) ? { goal: this.pick(r.chance(0.5) ? T.storage : T.cook), act: 'carry' } : home;
    }
    // Festival nights: the plaza fills, people dance round the hearth, children too.
    if (this.festival && (h >= 19 || h < 1) && a.role !== 'warrior') {
      if (a.role === 'elder') {
        const s = this.seat(a, T.hearth);
        if (s >= 0) return { goal: s, act: 'sit' };
      }
      return { goal: this.pick(T.plaza), act: r.chance(0.65) ? 'dance' : 'talk' };
    }
    switch (a.role) {
      case 'hunter':
        if (night) return home;
        if (catchIn) return { goal: this.pick(r.chance(0.5) ? T.racks : T.storage), act: 'carry' };
        if (meal) return mealPlan();
        if (evening) return { goal: this.pick(T.plaza), act: 'talk' };
        return r.chance(0.75) ? { goal: a.job, act: 'work' } : { goal: this.pick(a.k % 2 ? T.tundra : T.ice), act: 'idle' };
      case 'fisher':
        if (night) return home;
        if (catchIn) return { goal: this.pick(T.racks), act: 'carry' };
        if (meal) return mealPlan();
        if (evening) return { goal: this.pick(T.plaza), act: 'talk' };
        if (dawn) return { goal: this.pick(T.shore), act: 'work' };
        if (h >= 11.5 && h < 13.5) return { goal: this.pick(r.chance(0.5) ? T.shore : T.racks), act: r.chance(0.5) ? 'sit' : 'work' };
        return { goal: this.pick(T.ice), act: 'work' };
      case 'warrior':
        if (night) return home;
        if (dawn) return { goal: this.pick(T.training), act: 'form' };
        if (meal) return mealPlan();
        if (evening) return { goal: this.pick(T.plaza), act: 'talk' };
        if (a.k % 3 === 0) return { goal: this.posts[(a.k / 3) % this.posts.length] ?? this.pick(T.gate), act: 'idle' };
        return r.chance(0.7) ? { goal: this.pick(T.wall), act: 'walk' } : { goal: this.pick(r.chance(0.5) ? T.gate : T.plaza), act: 'talk' };
      case 'bender':
        if (night) return home;
        if (meal) return mealPlan();
        if (evening) return { goal: this.pick(T.plaza), act: 'talk' };
        if (h >= 11.5 && h < 14) return a.k % 3 === 2 ? { goal: this.pick(T.healer), act: 'talk' } : { goal: this.pick(T.draw), act: 'work' };
        return a.k % 3 === 2 && r.chance(0.6) ? { goal: this.pick(T.healer), act: 'talk' } : { goal: this.pick(T.training), act: 'form' };
      case 'tanner':
      case 'carver':
      case 'mender': {
        if (night || h < 6.5) return home;
        if (meal) return mealPlan();
        if (evening || h >= 17.25) return { goal: this.pick(T.plaza), act: 'talk' };
        const mask = a.role === 'tanner' ? (r.chance(0.75) ? T.tannery : T.racks) : a.role === 'carver' ? T.craft : r.chance(0.5) ? T.racks : T.craft;
        if (a.role === 'mender' && h >= 11.5 && h < 13.5 && r.chance(0.4)) return { goal: this.pick(T.shore), act: 'work' };
        return { goal: r.chance(0.7) ? a.job : this.pick(mask), act: a.role === 'carver' && r.chance(0.4) ? 'sit' : 'work' };
      }
      case 'cook':
        if (night) return home;
        if (h >= 17 && h < 20.25) return { goal: this.pick(T.hall), act: 'work' };
        if (dawn || (h >= 11 && h < 13)) return { goal: this.pick(T.cook), act: 'work' };
        return r.chance(0.5) ? { goal: this.pick(T.storage), act: 'carry' } : { goal: this.pick(T.cook), act: 'work' };
      case 'storyteller': {
        if (night || h < 7) return home;
        if (h >= 18.5 && h < 21.5) {
          if (a.k === 0 && this.chair >= 0 && this.seatOwner[this.chair] < 0) {
            this.seatOwner[this.chair] = this.agents.indexOf(a);
            a.seat = this.chair;
            return { goal: this.chair, act: 'sit' };
          }
          const s = this.seat(a, T.story);
          if (s >= 0) return { goal: s, act: 'sit' };
        }
        if (meal) return mealPlan();
        const s = r.chance(0.6) ? this.seat(a, T.story) : -1;
        return s >= 0 ? { goal: s, act: 'sit' } : { goal: this.pick(T.plaza), act: 'talk' };
      }
      case 'elder': {
        if (night || h < 7) return home;
        if (meal) return mealPlan();
        const s = r.chance(0.6) ? this.seat(a, r.chance(0.5) ? T.hall : T.hearth) : -1;
        if (s >= 0) return { goal: s, act: 'sit' };
        return { goal: this.pick(r.chance(0.5) ? T.plaza : T.story), act: 'talk' };
      }
      case 'kid': {
        if (night || h >= 20.75 || h < 7) return home;
        if (h >= 18.5) {
          const s = this.seat(a, T.story);
          return s >= 0 ? { goal: s, act: 'sit' } : { goal: this.pick(T.story), act: 'idle' };
        }
        if (meal) return mealPlan();
        if (h >= 11 && h < 15.5 && a.k % 3 !== 0 && a.runs < 5) return { goal: this.sledTop, act: 'sled' };
        if (h >= 11 && h < 15.5 && r.chance(0.3)) return { goal: this.pick(T.penguins), act: 'idle' };
        return { goal: this.pick(r.chance(0.55) ? T.play : r.chance(0.5) ? T.dogs : T.pond), act: 'play' };
      }
      default:
        if (night) return home;
        if (meal) return mealPlan();
        if (evening) return { goal: this.pick(T.plaza), act: 'talk' };
        if (dawn && r.chance(0.5)) return { goal: a.home, act: 'talk' };
        return {
          goal: this.pick(r.weighted([T.plaza, T.trader, T.storage, T.pond, T.racks, T.dogs, T.home], [3, 1.5, 1, 1, 1, 0.8, 1.2])),
          act: r.chance(0.6) ? 'talk' : r.chance(0.5) ? 'idle' : 'carry',
        };
    }
  }

  /** Where to stand at a node (open places spread a crowd out; seats and posts are exact). */
  private spot(a: Agent, node: number): P2 {
    const n = this.nav.nodes[node], j = this.jit[node];
    return { x: n.x + a.ox * j, z: n.z + a.oz * j };
  }

  /** Face what the agent is doing: seats and posts their way, groups their centre. */
  private faceAt(a: Agent, node: number): void {
    const n = this.nav.nodes[node];
    if (this.jit[node] > 0.3 && (a.activity === 'talk' || a.activity === 'dance' || a.activity === 'idle')) a.yaw = Math.atan2(-a.ox, -a.oz);
    else if (n.yaw) a.yaw = n.yaw;
  }

  private begin(a: Agent, act: Activity): void {
    // Arriving with a load means unloading it; a sled ride starts only at the top of the run.
    a.activity = act === 'walk' || (act === 'sled' && a.node !== this.sledTop) ? 'idle' : act === 'carry' ? 'work' : act;
    a.timer = act === 'walk' ? 0.5 + this.rnd.next() * 3 : act === 'play' ? 3 + this.rnd.next() * 8 : act === 'home' ? 30 + this.rnd.next() * 60 : 18 + this.rnd.next() * 40;
    this.faceAt(a, a.node);
    if (act === 'sled' && a.node === this.sledTop) {
      // Onto the sled at the top of the run.
      a.activity = 'sled';
      a.sled = 0;
      a.runs++;
    }
  }

  /** Put everyone where the routine wants them at this hour (seats, posts, homes...). */
  settle(): void {
    for (const a of this.agents) this.release(a);
    for (const a of this.agents) {
      const plan = this.plan(a);
      const goal = plan.act === 'sled' ? this.sledTop : plan.goal;
      const s = this.spot(a, goal);
      a.x = s.x;
      a.z = s.z;
      a.y = this.nodeY[goal];
      a.node = a.goal = goal;
      a.path.length = 0;
      a.pi = 0;
      a.act = plan.act;
      a.sled = -1;
      this.begin(a, plan.act === 'sled' ? 'idle' : plan.act);
      a.timer = this.rnd.range(2, 30);
      if (plan.act === 'sled') {
        // Sledding children are spread over the run: some riding down, some climbing back up.
        if (this.rnd.chance(0.45)) {
          a.activity = 'sled';
          a.sled = this.rnd.next() * this.runLen * 0.9;
          this.ride(a, 0);
        } else {
          const b = this.nav.nodes[this.sledBottom];
          a.node = this.sledBottom;
          a.x = b.x;
          a.z = b.z;
          a.y = outY(b.x, b.z);
          this.route(a, this.sledTop, 'sled');
          if (a.path.length > 2) {
            // Part-way up already.
            const k = 1 + Math.floor(this.rnd.next() * (a.path.length - 2));
            const n = this.nav.nodes[a.path[k]];
            a.x = n.x;
            a.z = n.z;
            a.y = outY(n.x, n.z);
            a.node = a.path[k];
            a.pi = k + 1;
          }
        }
      }
    }
  }

  private route(a: Agent, goal: number, act: Activity): void {
    a.goal = goal;
    a.act = act;
    const p = this.nav.path(a.node, goal, this.tmpPath, this.prev);
    if (!p) {
      // No way there (should not happen): stay put and think again later.
      a.activity = 'idle';
      a.timer = 5;
      return;
    }
    a.path = this.straighten(p);
    a.pi = a.path.length > 1 ? 1 : 0;
    a.activity = 'walk';
  }

  /** Skip grid nodes while the straight line stays clear (looks ahead a dozen nodes). */
  private straighten(p: number[]): number[] {
    const out: number[] = [p[0]];
    const nodes = this.nav.nodes;
    let i = 0;
    while (i < p.length - 1) {
      let j = i + 1;
      if (this.free[p[i]]) {
        for (let k = Math.min(p.length - 1, i + 12); k > i + 1; k--) {
          let ok = this.free[p[k]] === 1;
          for (let m = i + 1; ok && m < k; m++) if (!this.free[p[m]]) ok = false;
          if (ok && this.obstacles.segClear(nodes[p[i]].x, nodes[p[i]].z, nodes[p[k]].x, nodes[p[k]].z, 0.25)) {
            j = k;
            break;
          }
        }
      }
      out.push(p[j]);
      i = j;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext, cam: THREE.Camera, riders: readonly Rider[] = []): void {
    const t0 = performance.now();
    this.t += dt;
    const hour = ctx.world.sky.timeOfDay;
    const first = this.lastHour < 0;
    let jump = first ? 0 : Math.abs(hour - this.lastHour);
    if (jump > 12) jump = 24 - jump;
    this.lastHour = hour;
    this.hour = hour;
    if (first || jump > 0.5) this.settle();
    const player = ctx.player?.position;
    this.stepper = (this.stepper + 1) % 4;
    let best: Agent | null = null, bestD = 3.2;
    this.nearBuf.length = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const near = !!player && Math.abs(a.x - player.x) < 110 && Math.abs(a.z - player.z) < 110;
      if (!near && (i & 3) !== this.stepper) continue;
      const step = near ? dt : dt * 4;
      this.tick(a, step);
      if (player && a.activity !== 'home' && a.activity !== 'sled') {
        const d = Math.hypot(a.x - player.x, a.z - player.z);
        if (d < 4.5 && Math.abs(a.y - player.y) < 2.5) a.greet = Math.min(1, a.greet + step * 2);
        else a.greet = Math.max(0, a.greet - step);
        if (d < bestD && Math.abs(a.y - player.y) < 2) {
          bestD = d;
          best = a;
        }
        if (d < 12) this.nearBuf.push(a);
      }
    }
    if (player) {
      this.nearBuf.sort((p, q) => Math.hypot(p.x - player.x, p.z - player.z) - Math.hypot(q.x - player.x, q.z - player.z));
      this.breathN = Math.min(this.breathers.length, this.nearBuf.length);
      for (let i = 0; i < this.breathN; i++) {
        const a = this.nearBuf[i];
        const sit = a.activity === 'sit';
        this.breathers[i].set(a.x + Math.sin(a.yaw) * 0.2 * a.scale, a.y + (sit ? 1.18 : 1.58) * a.scale, a.z + Math.cos(a.yaw) * 0.2 * a.scale);
      }
    } else this.breathN = 0;
    this.talkTarget = best;
    if (best) this.talkPos.set(best.x, best.y + 1, best.z);
    else this.talkPos.set(0, -1000, 0);
    this.draw(cam, player ?? null, riders);
    this.stats.ms = performance.now() - t0;
  }

  private draw(cam: THREE.Camera, player: THREE.Vector3 | null, riders: readonly Rider[]): void {
    const f = this.figures;
    f.begin(cam.position);
    f.view(cam);
    let drawn = 0, walking = 0, home = 0, village = 0, shore = 0, hall = 0, wall = 0, sledding = 0, outside = 0, sleds = 0;
    for (const a of this.agents) {
      if (a.activity === 'home') {
        home++;
        continue;
      }
      if (a.activity === 'walk') walking++;
      const dC = Math.hypot(a.x - C.x, a.z - C.z);
      if (dC < RI) village++;
      else outside++;
      if (Math.hypot(a.x - GREAT.x, a.z - GREAT.z) < GREAT.r) hall++;
      if (a.y > WC.wallTop - 0.5 && Math.abs(dC - (WC.R - WC.wallT / 2)) < 3) wall++;
      if (Math.hypot(a.x - WC_LANDING.x, a.z - WC_LANDING.z) < 60 || Math.hypot(a.x - SHORE.akka.x, a.z - SHORE.akka.z) < 30) shore++;
      if (a.activity === 'sled') sledding++;
      if (!f.visible(a.x, a.y, a.z)) continue;
      let pose: number = Pose.idle, amt = 0.6, lean = 0, yaw = a.yaw, y = a.y;
      switch (a.activity) {
        case 'walk':
          pose = a.act === 'carry' ? Pose.carry : Pose.walk;
          amt = 1;
          break;
        case 'work':
          pose = a.role === 'carver' || a.role === 'mender' ? Pose.sweep : Pose.work;
          break;
        case 'carry':
          pose = Pose.carry;
          amt = 0;
          break;
        case 'talk':
          pose = Pose.talk;
          break;
        case 'sit':
          pose = Pose.sit;
          break;
        case 'form': {
          // Waterbending forms (or the warriors' drill): a slow raise, push and sweep, each at their own pace.
          const k = (this.t * 0.42 + a.phase) % 3;
          pose = k < 1 ? Pose.raise : k < 2 ? Pose.push : Pose.sweep;
          amt = 0.8;
          break;
        }
        case 'dance': {
          const k = (this.t * 0.9 + a.phase) % 2;
          pose = k < 1 ? Pose.raise : Pose.walk;
          amt = k < 1 ? 0.7 : 0.6;
          yaw += Math.sin(this.t * 1.3 + a.phase) * 0.8;
          break;
        }
        case 'play':
          pose = Pose.talk;
          break;
        case 'sled':
          pose = Pose.sit;
          y -= 0.33;
          if (sleds < 16) {
            this.tmpQ.setFromAxisAngle(UP, yaw);
            this.tmpV.set(a.x, a.y + 0.02, a.z);
            this.one.set(a.scale, a.scale, a.scale);
            this.tmpM.compose(this.tmpV, this.tmpQ, this.one);
            this.sledMesh.setMatrixAt(sleds++, this.tmpM);
          }
          break;
      }
      if (a.greet > 0.05 && player && a.activity !== 'form' && a.activity !== 'sit') {
        const want = Math.atan2(player.x - a.x, player.z - a.z);
        let d = want - yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        yaw += d * a.greet;
        if (a.activity !== 'walk') pose = a.greet > 0.6 ? Pose.raise : Pose.talk;
        amt = a.activity === 'walk' ? 1 : 0.35;
        lean = 0.05;
      }
      f.push(a.x, y, a.z, yaw, pose, a.phase, amt, lean, a.coat, a.pants, a.skin, a.acc, a.scale);
      drawn++;
    }
    // Paddlers in the canoes and kayaks (wildlife.ts).
    for (let i = 0; i < riders.length; i++) {
      const r = riders[i];
      if (!f.visible(r.x, r.y, r.z)) continue;
      f.push(r.x, r.y, r.z, r.yaw, r.pose, r.phase, 1, 0.1, SWT_LOOK.coats[SAcc.hunter], 0x1e2a3a, SWT_LOOK.skin[i % SWT_LOOK.skin.length], SAcc.hunter, 1);
      drawn++;
    }
    f.end();
    this.sledMesh.count = sleds;
    if (sleds) this.sledMesh.instanceMatrix.needsUpdate = true;
    Object.assign(this.stats, { drawn, walking, home, village, shore, hall, wall, sledding, outside });
  }

  private tick(a: Agent, dt: number): void {
    a.phase += dt * (a.activity === 'walk' ? a.speed * 1.9 : 1);
    if (a.activity === 'sled') {
      this.ride(a, dt);
      return;
    }
    if (a.activity === 'walk') {
      const target = a.path[a.pi];
      if (target === undefined) {
        a.activity = 'idle';
        return;
      }
      const last = a.pi >= a.path.length - 1;
      const tp = last ? this.spot(a, target) : this.nav.nodes[target];
      const dx = tp.x - a.x, dz = tp.z - a.z;
      const d = Math.hypot(dx, dz);
      const s = a.speed * dt;
      const fromNode = a.node;
      if (d <= s + 0.05) {
        a.x = tp.x;
        a.z = tp.z;
        a.node = target;
        a.y = this.outside[target] ? outY(a.x, a.z) : this.nodeY[target];
        a.pi++;
        if (a.pi >= a.path.length) this.begin(a, a.act);
        return;
      }
      a.x += (dx / d) * s;
      a.z += (dz / d) * s;
      a.yaw = Math.atan2(dx, dz);
      if (this.outside[target] || this.outside[fromNode]) a.y = outY(a.x, a.z);
      else {
        // Height between nodes (the stair ramps to the wall walk).
        const prevY = this.nodeY[fromNode], nextY = this.nodeY[target];
        if (prevY === nextY) a.y = nextY;
        else {
          const n0 = this.nav.nodes[fromNode];
          const segL = Math.hypot(tp.x - n0.x, tp.z - n0.z) || 1;
          a.y = nextY + (prevY - nextY) * Math.min(1, d / segL);
        }
      }
      return;
    }
    a.timer -= dt;
    if (a.timer > 0) return;
    this.release(a);
    const plan = this.plan(a);
    if (plan.goal === a.node) {
      this.begin(a, plan.act);
      return;
    }
    this.route(a, plan.goal, plan.act);
  }

  /** Down the run on a sled (through the ice tunnel), then off at the bottom. */
  private ride(a: Agent, dt: number): void {
    const v = Math.min(SWT_LIFE.sled, 1.5 + a.sled * 0.25);
    a.sled += v * dt;
    if (a.sled >= this.runLen) {
      const b = this.nav.nodes[this.sledBottom];
      a.x = b.x;
      a.z = b.z;
      a.y = outY(b.x, b.z);
      a.node = this.sledBottom;
      a.sled = -1;
      a.activity = 'idle';
      a.timer = 1 + this.rnd.next() * 2;
      return;
    }
    let s = a.sled;
    for (let i = 1; i < this.run.length; i++) {
      const p = this.run[i - 1], q = this.run[i];
      const l = Math.hypot(q.x - p.x, q.z - p.z);
      if (s <= l) {
        const t = s / l;
        a.x = p.x + (q.x - p.x) * t;
        a.z = p.z + (q.z - p.z) * t;
        a.yaw = Math.atan2(q.x - p.x, q.z - p.z);
        break;
      }
      s -= l;
    }
    a.y = runY(a.x, a.z);
  }

  /** The nearest villager in talking range (null when none). */
  get nearest(): { name: string; role: SwtRole } | null {
    return this.talkTarget ? { name: this.talkTarget.name, role: this.talkTarget.role } : null;
  }

  /** One line from the nearest villager, by role and hour. */
  talk(ctx: GameContext): void {
    const a = this.talkTarget;
    if (!a) return;
    const lines = LINES[a.role];
    const h = this.hour;
    const extra = this.raided
      ? ' Stay near the walls. The fire ships may still be watching.'
      : this.festival && (h >= 18 || h < 1)
        ? ' Tonight the lights dance over the ice — it is the festival!'
        : h >= 17.5 && h < 21.5
          ? ' The meal in the Great Igloo is starting.'
          : h >= 21.5 || h < 5
            ? ' It is late. Keep close to the fires.'
            : '';
    const text = lines[Math.floor(this.rnd.next() * lines.length)] + extra;
    ctx.ui.showDialogue({ speaker: a.name, text, choices: [{ text: 'Farewell', onSelect: () => ctx.ui.hideDialogue() }] });
  }

  counts(): Record<string, number> {
    return { ...this.stats };
  }

  /** Where the stair ramps meet the wall walk (tests: foot, head and the walk point beyond). */
  stairs(): Array<{ foot: P2; head: P2; walk: P2 }> {
    const RW = WC.R - WC.wallT / 2;
    return this.input.wall.stairs.map((s) => {
      const a = Math.atan2(s.head.x - C.x, -(s.head.z - C.z));
      return { foot: { x: s.foot.x, z: s.foot.z }, head: { x: s.head.x, z: s.head.z }, walk: { x: C.x + Math.sin(a) * RW, z: C.z - Math.cos(a) * RW } };
    });
  }

  /** Centres of the densest tent clusters (screenshots). */
  tentClusters(n = 3): P2[] {
    const tents = this.input.dwellings.filter((d) => d.kind === 'tent');
    const scored = tents.map((t) => ({ t, k: tents.filter((o) => Math.hypot(o.x - t.x, o.z - t.z) < 12).length }));
    scored.sort((p, q) => q.k - p.k);
    const out: P2[] = [];
    for (const s of scored) if (out.length < n && out.every((o) => Math.hypot(o.x - s.t.x, o.z - s.t.z) > 20)) out.push({ x: s.t.x, z: s.t.z });
    return out;
  }

  dispose(): void {
    this.figures.dispose();
    this.sledGeo.dispose();
    this.sledMat.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Lighten / darken a packed colour. */
function shade(c: number, k: number): number {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + k))));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}

/** A child's sled: two bone runners and a slatted wooden bed (vertex-coloured). */
function sledGeometry(): THREE.BufferGeometry {
  const parts: Array<[THREE.BufferGeometry, string]> = [
    [new THREE.BoxGeometry(0.5, 0.06, 1.05).translate(0, 0.13, 0), '#7a5634'],
    [new THREE.BoxGeometry(0.05, 0.09, 1.15).translate(0.2, 0.05, 0.02), '#e2d8c0'],
    [new THREE.BoxGeometry(0.05, 0.09, 1.15).translate(-0.2, 0.05, 0.02), '#e2d8c0'],
    [new THREE.BoxGeometry(0.46, 0.16, 0.05).translate(0, 0.2, 0.5), '#6a4a2c'],
  ];
  const list = parts.map(([g]) => g.toNonIndexed());
  let n = 0;
  for (const g of list) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  list.forEach((g, i) => {
    const c = new THREE.Color(parts[i][1]);
    const pa = g.getAttribute('position'), na = g.getAttribute('normal');
    for (let v = 0; v < pa.count; v++, o++) {
      pos.set([pa.getX(v), pa.getY(v), pa.getZ(v)], o * 3);
      nrm.set([na.getX(v), na.getY(v), na.getZ(v)], o * 3);
      col.set([c.r, c.g, c.b], o * 3);
    }
  });
  for (const [g] of parts) g.dispose();
  for (const g of list) g.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}
