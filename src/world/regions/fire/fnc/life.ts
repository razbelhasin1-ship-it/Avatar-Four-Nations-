import * as THREE from 'three';
import type { LoopHandle } from '../../../../audio/AudioEngine';
import type { GameContext } from '../../../../core/GameContext';
import { heightAt } from '../../../Heightfield';
import { roadNear } from '../../../landforms/fireCapital';
import type { P2 } from '../../../WorldLayout';
import { Acc, FigureRenderer, Pose } from '../../earth/bssFigures';
import { NavGraph, NavTag } from '../../earth/bssNav';
import './audio';
import { foundryStacks, marketStalls, openRuns, shopFronts } from './city';
import type { Emitter } from '../../../../vfx/VFX';
import { CALDERA, CONFIG, DISTRICTS, FNC, HARBOR, PLAZA, atAxis, atPolar, cityBlocked, footR, harborHalf, polarOf, ringR, roadPath, spokeBearings } from './layout';
import { FAcc, PALETTE, SKIN, registerFireAccessories, type Klass } from './people';

/**
 * The capital's people. A walking graph is laid over the quays, the Royal Plaza, the tower
 * passage, the Royal Way and Harbor City's ring and spoke streets, Sozin's road, Hari Bulkan and
 * the palace courtyard; ~440 people (CONFIG.npcs) live on it, drawn by the shared instanced
 * figure renderer in Fire Nation dress by class.
 *
 *  - Daily routine: out at dawn, busiest by day, home at night (doors along the streets); the
 *    foundries work through the night; guards and patrols keep their posts at all hours.
 *  - Roles: walkers and shoppers (shop fronts, market stalls, squares, benches, temple), stall
 *    keepers who open at dawn and cover their stalls at night, mobile vendors with handcarts,
 *    food carts and shoulder poles calling their wares, porters with crates, dockers on the quays,
 *    foundry hands, Domestic Forces at gates and in marching squads (people step aside for them),
 *    firebending troops drilling on the plaza, academy students drilling with flame bursts, Fire
 *    Sages tending the High Temple's braziers, the Royal Procession at the palace.
 *  - Events: rallies at the Royal Plaza (CONFIG.rallyCrowd people gather facing the tower; a
 *    speaker on its balcony, drums, flame bursts and the crowd's roar) and proclamations in Hari
 *    Bulkan Square, on a schedule (LIFE) or forced from the debug API.
 * People far from the camera tick at a quarter rate; nothing allocates per frame.
 */

const T = NavTag;
const Z = { harbor: 1 << 20, plaza: 1 << 21, city: 1 << 22, market: 1 << 23, foundry: 1 << 24, park: 1 << 25, road: 1 << 26, caldera: 1 << 27, palace: 1 << 28 } as const;
type ZoneName = keyof typeof Z;
const ZONES = Object.keys(Z) as ZoneName[];
const ZALL = ZONES.reduce((m, z) => m | Z[z], 0);
const V = FNC.V;

type Role = 'walker' | 'shopper' | 'sitter' | 'seller' | 'vendor' | 'porter' | 'docker' | 'smith' | 'guard' | 'patrol' | 'drill' | 'student' | 'sage' | 'royal' | 'courtier';

/** Data-driven population and schedule (hours of the in-game day). */
export const LIFE = {
  seed: CONFIG.seed ^ 0x11fe,
  /** Who lives where: [role, class, count] per district (sums to CONFIG.npcs). */
  cast: {
    harbor: [['docker', 'worker', 20], ['porter', 'worker', 10], ['walker', 'civilian', 12], ['sitter', 'civilian', 4], ['seller', 'worker', 4], ['guard', 'guard', 6], ['vendor', 'civilian', 4]],
    plaza: [['walker', 'civilian', 26], ['walker', 'noble', 4], ['drill', 'trooper', 16], ['guard', 'guard', 8], ['vendor', 'civilian', 4], ['sitter', 'civilian', 4], ['patrol', 'trooper', 4]],
    city: [['walker', 'civilian', 66], ['shopper', 'civilian', 30], ['walker', 'worker', 6], ['vendor', 'civilian', 14], ['porter', 'worker', 14], ['sitter', 'civilian', 8], ['patrol', 'guard', 8], ['guard', 'guard', 4]],
    market: [['seller', 'civilian', 22], ['shopper', 'civilian', 22]],
    foundry: [['smith', 'worker', 20], ['porter', 'worker', 4]],
    park: [['walker', 'civilian', 8], ['sitter', 'civilian', 6], ['walker', 'noble', 2]],
    road: [['guard', 'guard', 6], ['walker', 'worker', 2], ['porter', 'worker', 2]],
    caldera: [['walker', 'noble', 24], ['student', 'student', 22], ['sage', 'sage', 4], ['guard', 'guard', 4]],
    palace: [['royal', 'royal', 10], ['courtier', 'noble', 6]],
  } as Record<ZoneName, Array<[Role, Klass, number]>>,
  rally: { gather: 10.6, speech: 11, end: 12.5, crowd: CONFIG.rallyCrowd },
  proclaim: { gather: 14.8, speech: 15, end: 16, crowd: 30 },
  drill: [[7, 10], [13, 16]] as Array<[number, number]>,
  academy: [8, 17] as [number, number],
  shops: [6.5, 21] as [number, number],
  draw: { near: 70, far: 300, farLow: 210 },
};

/**
 * Harbor City keeps people around the camera: within BUBBLE metres of it, each district wants this
 * many out and about (times the hour's activity). People far out of sight are moved over — they step
 * out of a door or come round a corner the camera is not watching.
 */
const BUBBLE = 120;
const BUBBLE_TARGET: Partial<Record<ZoneName, number>> = { harbor: 55, plaza: 70, city: 110, market: 70, park: 30, foundry: 34 };
const ZTOWN = Z.harbor | Z.plaza | Z.city | Z.market | Z.park | Z.foundry;
const MOVABLE = new Set<Role>(['walker', 'shopper', 'porter', 'vendor', 'sitter', 'docker', 'smith']);

/** Zones people of a district wander into. */
const ROAM: Record<ZoneName, number> = {
  harbor: Z.harbor | Z.plaza,
  plaza: Z.plaza | Z.harbor,
  city: Z.city | Z.market | Z.park,
  market: Z.market | Z.city,
  foundry: Z.foundry,
  park: Z.park | Z.city,
  road: Z.road,
  caldera: Z.caldera,
  palace: Z.palace,
};

function activity(z: ZoneName, h: number): number {
  const day = h >= 7 && h < 19, dusk = h >= 19 && h < 22, dawn = h >= 5 && h < 7;
  switch (z) {
    case 'foundry':
      return day ? 1 : 0.55;
    case 'caldera':
    case 'palace':
      return day ? 0.9 : dusk ? 0.55 : dawn ? 0.35 : 0.08;
    case 'market':
      return h >= LIFE.shops[0] && h < LIFE.shops[1] ? 1 : 0.1;
    default:
      return day ? 1 : dusk ? 0.75 : dawn ? 0.45 : 0.15;
  }
}

type St = 'walk' | 'act' | 'post' | 'home' | 'goal';

interface Agent {
  i: number;
  zone: ZoneName;
  roam: number;
  role: Role;
  klass: Klass;
  robe: number;
  pants: number;
  skin: number;
  acc: number;
  scale: number;
  speed: number;
  stay: number;
  node: number;
  path: number[];
  pi: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  lane: number;
  dodge: number;
  st: St;
  t: number;
  pose: number;
  phase: number;
  amt: number;
  /** Fixed post (guards, stall keepers, formations); NaN if none. */
  px: number;
  py: number;
  pz: number;
  pyaw: number;
  /** Event slot (rally / proclamation), −1 none. */
  goal: number;
  gx: number;
  gy: number;
  gz: number;
  gyaw: number;
  /** Walking to an event slot (path, then straight in). */
  toGoal: boolean;
  /** Reappear somewhere in the home district when next out (sent away by an event). */
  reloc: boolean;
  squad: number;
  callT: number;
  greet: number;
  delay: number;
  /** Seconds a stopped vendor still waits before calling. */
  visible: boolean;
}

interface Squad {
  members: number[];
  trail: Float32Array;
  head: number;
  n: number;
  dist: number;
  lastX: number;
  lastZ: number;
  stepT: number;
}

interface Formation {
  members: number[];
  kind: 'drill' | 'academy';
  hours: Array<[number, number]>;
  x: number;
  y: number;
  z: number;
  yaw: number;
  period: number;
  clock: number;
  /** Instructor in front (x, z, yaw), drawn while the formation drills. */
  ix: number;
  iy: number;
  iz: number;
  iyaw: number;
}

const TRAIL = 48;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export interface LifeMarks {
  [id: string]: { x: number; y: number; z: number } | undefined;
}

export class CapitalLife {
  readonly nav = new NavGraph();
  readonly group = new THREE.Group();
  readonly figures: FigureRenderer;
  readonly agents: Agent[] = [];
  private nodeY: Float32Array | null = null;
  private width = new Map<number, number>();
  private est = new Map<number, number>();
  private comp: Int32Array | null = null;
  /** The walking graph's main connected component (people live only there). */
  private main = 0;
  private prev: Int32Array<ArrayBuffer> = new Int32Array(0);
  /** POI node ids by tag bit (index = bit number). */
  private readonly pois = new Map<number, number[]>();
  private readonly zoneNodes = new Map<ZoneName, number[]>();
  private readonly squads: Squad[] = [];
  private readonly forms: Formation[] = [];
  private readonly rnd = rng(LIFE.seed);
  private ctx: GameContext | null = null;
  private frame = 0;
  private stalls: THREE.InstancedMesh | null = null;
  private closed = -1;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private loops: { crowd: LoopHandle | null; crackle: LoopHandle | null } = { crowd: null, crackle: null };
  private loopGen = -1;
  private audioT = 0;
  private sfx = { drum: 0, rumble: 40, clang: 2, vendor: 0 };
  private smoke: Emitter[] = [];
  private nearCount = 0;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpS = new THREE.Vector3();
  /** Rally at the Royal Plaza. */
  readonly rally = { on: false, forced: null as boolean | null, speech: false, slots: [] as Array<{ x: number; y: number; z: number; yaw: number; troop: boolean }>, cheerT: 4, cheer: -10, members: [] as number[], instant: false };
  /** Proclamation in Hari Bulkan Square. */
  readonly proclaim = { on: false, forced: null as boolean | null, speech: false, slots: [] as Array<{ x: number; y: number; z: number; yaw: number }>, cheerT: 6, cheer: -10, members: [] as number[] };
  readonly stats = { total: 0, out: 0, visible: 0, walking: 0, rally: 0, proclaim: 0, squads: 0, drilling: 0, ms: 0, nodes: 0, local: 0, moved: 0 };
  private bubbleT = 0;
  private relocI = 0;
  private local = 0;
  private around = 0;
  private doorKey = '';
  private doors: number[] = [];
  private elapsed = 0;

  constructor(parent: THREE.Object3D, private readonly marks: LifeMarks) {
    registerFireAccessories();
    this.group.name = 'fnc_life';
    parent.add(this.group);
    this.figures = new FigureRenderer(this.group, CONFIG.npcs + 24);
    this.buildNav();
    this.stats.nodes = this.nav.nodes.length;
    // Night covers over the market stalls (stall keepers pack up at dusk).
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const tarp = new THREE.MeshStandardMaterial({ color: '#7a3a2a', roughness: 1 });
    this.geos.push(box);
    this.mats.push(tarp);
    this.stalls = new THREE.InstancedMesh(box, tarp, Math.max(1, marketStalls.length));
    this.stalls.count = 0;
    this.stalls.castShadow = true;
    this.group.add(this.stalls);
  }

  // ---------------------------------------------------------------------------
  // Walking graph
  // ---------------------------------------------------------------------------

  private street(pts: P2[], tags: number, w: number, step = 9, snap = 3.5): number[] {
    const ids = this.nav.street(pts, tags, step, snap);
    for (const id of ids) this.width.set(id, Math.max(this.width.get(id) ?? 0, w));
    return ids;
  }

  private poi(x: number, z: number, tags: number, yaw: number, reach = 12, est?: number): number {
    const id = this.nav.poi(x, z, tags, yaw, reach);
    if (est !== undefined) this.est.set(id, est);
    return id;
  }

  /** Link a node to the nearest node carrying `mask` within r (open ground between them). */
  private linkNear(id: number, r: number, mask: number): void {
    const n = this.nav.nodes[id];
    let best = -1, bd = r * r;
    for (const k of this.nav.around(n.x, n.z, r, mask)) {
      if (k === id) continue;
      const m = this.nav.nodes[k];
      const d = (m.x - n.x) ** 2 + (m.z - n.z) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    if (best >= 0) this.nav.link(id, best);
  }

  private buildNav(): void {
    const nav = this.nav;
    const Q = FNC.harbor;
    const HEAD = Q.s0 + 8;
    const ax = (t: number, s: number) => atAxis(t, s);

    // --- Harbour: both quay aprons, the head apron, the finger piers.
    const quayT = (s: number) => harborHalf(s) + 7.5;
    for (const side of [-1, 1]) {
      const pts: P2[] = [];
      for (let s = Q.s0 + 2; s <= HARBOR.wallS - 7; s += 6) pts.push(ax(side * quayT(s), s));
      this.street(pts, T.street | T.patrol | Z.harbor, 3.4, 8);
    }
    const head = [-quayT(Q.s0 + 2), -30, -22, -18, -10, 0, 10, 18, 22, 30, quayT(Q.s0 + 2)].map((t) => ax(t, Q.s0 + 4));
    this.street(head, T.street | T.square | Z.harbor, 2.6, 8, 4);
    for (const t of HARBOR.piers) {
      const ids = this.street([ax(t, Q.s0 + 4), ax(t, HEAD + HARBOR.pierLen - 3)], T.street | Z.harbor, 1.4, 8, 2);
      const end = ids[ids.length - 1];
      this.nav.nodes[end].tags |= T.water | T.bench;
      this.nav.nodes[end].yaw = 0;
    }
    // Work spots on the quays beside the moored ships, and at the harbour walls (cargo).
    for (const side of [-1, 1]) {
      for (const s of [684, 700, 734, 750]) {
        const t = side * (harborHalf(s) + 2.4);
        this.poi(ax(t, s).x, ax(t, s).z, T.work | T.water | Z.harbor, side > 0 ? -Math.PI / 2 : Math.PI / 2, 9);
      }
      for (const s of [672, 712, 752]) {
        const t = side * (harborHalf(s) + 13.6);
        this.poi(ax(t, s).x, ax(t, s).z, T.work | Z.harbor, side > 0 ? Math.PI / 2 : -Math.PI / 2, 9);
      }
    }
    {
      const f = ax(harborHalf(668) + 9, 668);
      this.poi(f.x - 2, f.z + 1.5, T.stall | Z.harbor, Math.PI / 2, 10);
    }

    // --- Royal Plaza: an open grid between the side halls, round the pools and the gatehouse.
    const cols = [-19, -10, -5, 0, 5, 10, 19];
    const P = PLAZA;
    const inPool = (t: number, s: number) => Math.abs(t) > P.poolIn - 1.2 && Math.abs(t) < P.poolOut + 1.2 && s > P.poolS0 - 1.2 && s < P.poolS1 + 1.2;
    const inGatehouse = (t: number, s: number) => Math.abs(t) < P.gatehouse.w / 2 + 1.2 && s > P.gatehouse.s - P.gatehouse.d / 2 - 1.5;
    const grid = new Map<string, number>();
    const rows: number[] = [];
    for (let s = 560; s <= 652; s += 6) rows.push(s);
    for (const s of rows) {
      for (const t of cols) {
        if (inPool(t, s) || inGatehouse(t, s)) continue;
        const p = ax(t, s);
        const id = nav.addNode(p.x, p.z, T.street | T.square | T.patrol | Z.plaza, 0.4);
        this.width.set(id, 2.4);
        grid.set(`${t},${s}`, id);
      }
    }
    const crossesPool = (t0: number, t1: number, s: number) => s > P.poolS0 - 1.2 && s < P.poolS1 + 1.2 && Math.min(Math.abs(t0), Math.abs(t1)) < P.poolOut && Math.max(Math.abs(t0), Math.abs(t1)) > P.poolIn && Math.sign(t0 || t1) === Math.sign(t1 || t0);
    for (let ri = 0; ri < rows.length; ri++) {
      const s = rows[ri];
      let last = -1, lastT = 0;
      for (const t of cols) {
        const id = grid.get(`${t},${s}`);
        if (id === undefined) continue;
        if (last >= 0 && !crossesPool(lastT, t, s)) nav.link(last, id);
        last = id;
        lastT = t;
        if (ri > 0) {
          const up = grid.get(`${t},${rows[ri - 1]}`);
          if (up !== undefined) nav.link(up, id);
        }
      }
    }
    // Quay steps down to the head apron.
    const lastRow = rows[rows.length - 1];
    for (const t of [-19, -10, 10, 19]) {
      const a = grid.get(`${t},${lastRow}`);
      if (a !== undefined) this.linkNear(a, 12, Z.harbor);
    }
    // Tower passage up to the Royal Way.
    const topY = this.marks.passageTop?.y ?? heightAt(ax(0, P.tower.topS).x, ax(0, P.tower.topS).z);
    const passS = [560, 556, 548, 540, 532, 524, 516, P.tower.topS + 1, P.tower.topS - 3];
    const passIds = this.street(passS.map((s) => ax(0, s)), T.street | Z.plaza, 0.9, 9, 1);
    passIds.forEach((id) => {
      const s = this.nav.nodes[id].z - V.z;
      const k = Math.min(1, Math.max(0, (557 - s) / (557 - P.tower.topS)));
      this.est.set(id, s >= 557 ? P.y : P.y + (topY - P.y) * k);
    });

    // --- Harbor City: the Royal Way, ring streets and spokes (joined where they cross).
    const spokes = spokeBearings();
    const C = FNC.city;
    const way: P2[] = [];
    const wayS = new Set<number>([P.tower.topS - 3, FNC.road.s0 + 8]);
    for (let k = 0; k < CONFIG.ringOffsets.length; k++) wayS.add(ringR(k, 90));
    for (let s = P.tower.topS - 3; s >= FNC.road.s0 + 8; s -= 8) wayS.add(s);
    for (const s of [...wayS].sort((a, b) => b - a)) way.push(ax(0, s));
    this.street(way, T.street | T.patrol | Z.city, 4.2, 9, 3);
    for (let k = 0; k < CONFIG.ringOffsets.length; k++) {
      const phis = new Set<number>(spokes);
      const rMid = ringR(k, 90);
      for (let a = C.phi0; a <= C.phi1 + 0.01; a += (9 / rMid) * (180 / Math.PI)) phis.add(a);
      const pts = [...phis].sort((a, b) => a - b).map((a) => atPolar(a, ringR(k, a)));
      for (const run of openRuns(pts)) this.street(run, T.street | (k % 2 ? T.patrol : 0) | Z.city, 2.2, 10, 3);
    }
    for (const a of spokes) {
      if (Math.abs(a - 90) < 1) continue;
      const rs = new Set<number>();
      for (let k = 0; k < CONFIG.ringOffsets.length; k++) rs.add(ringR(k, a));
      for (let r = footR(a) + 6; r <= ringR(CONFIG.ringOffsets.length - 1, a) + 30; r += 9) rs.add(r);
      const pts = [...rs].sort((x, y) => x - y).map((r) => atPolar(a, r));
      for (const run of openRuns(pts)) this.street(run, T.street | Z.city, 1.6, 10, 3);
    }
    // Districts: foundries (east), Zoryu Park (west), the market on the Royal Way.
    for (const n of nav.nodes) {
      if (!(n.tags & Z.city)) continue;
      const q = polarOf(n.x, n.z);
      const s = n.z - V.z, t = Math.abs(n.x - V.x);
      const D = DISTRICTS;
      let zb: number = Z.city;
      if (q.phi > D.foundries.phi0 && q.phi < D.foundries.phi1 && q.r > footR(q.phi) + 10) zb = Z.foundry;
      else if (q.phi > D.park.phi0 && q.phi < D.park.phi1 && q.r > footR(q.phi) + D.park.rIn - 6 && q.r < footR(q.phi) + D.park.rOut + 6) zb = Z.park;
      else if (s > D.market.s0 - 4 && s < D.market.s1 + 4 && t < CONFIG.wayW / 2 + 1) zb = Z.market;
      n.tags = (n.tags & ~Z.city) | zb;
      if (zb === Z.foundry) n.tags |= T.work;
      if (zb === Z.park) n.tags |= T.square;
    }
    // Shop fronts, market stalls, doors along the ring streets, park benches.
    const zoneAt = (x: number, z: number): number => {
      const k = nav.near(x, z, 14, ZALL);
      return k >= 0 ? nav.nodes[k].tags & ZALL : Z.city;
    };
    for (const f of shopFronts) this.poi(f.x, f.z, T.shop | zoneAt(f.x, f.z), f.yaw, 9);
    for (const st of marketStalls) {
      const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
      this.poi(st.x + fx * 2.1, st.z + fz * 2.1, T.stall | Z.market, st.yaw + Math.PI, 8);
    }
    for (let k = 0; k < CONFIG.ringOffsets.length; k++) {
      const r0 = ringR(k, 90);
      for (let a = C.phi0 + 2; a < C.phi1 - 2; a += (36 / r0) * (180 / Math.PI)) {
        for (const side of [-1, 1]) {
          if (side < 0 && k === 0) continue;
          const r = ringR(k, a) + side * (CONFIG.ringW / 2 + 0.4);
          let nearSpoke = false;
          for (const b of spokes) if (Math.abs(a - b) * (Math.PI / 180) * r < 7) nearSpoke = true;
          if (nearSpoke) continue;
          const p = atPolar(a, r);
          if (cityBlocked(p.x, p.z)) continue;
          const yaw = side > 0 ? Math.atan2(p.x - V.x, p.z - V.z) : Math.atan2(V.x - p.x, V.z - p.z);
          const zb = zoneAt(p.x, p.z);
          this.poi(p.x, p.z, T.home | zb | (zb === Z.park ? T.bench : 0), yaw, 6);
        }
      }
    }

    // --- Sozin's road up the volcano to the crater gate.
    const road = roadPath().map((p) => ax(p.t, p.s));
    const roadIds = this.street(road, T.street | T.patrol | Z.road, 0.7, 8, 4);
    for (const id of roadIds) {
      const n = nav.nodes[id];
      this.est.set(id, roadNear(n.x - V.x, n.z - V.z).y);
    }

    // --- Hari Bulkan: gate stair, avenue, square, the ring street round the palace, spokes.
    const Y = CALDERA.y;
    const gateIds = this.street([ax(0, FNC.road.gateS), ax(0, FNC.road.gateS - 4.2), ax(0, FNC.floorR - 4), ax(0, 90), ax(0, CALDERA.square.s1)], T.street | Z.caldera, 1.6, 6, 4);
    for (const id of gateIds) {
      const s = nav.nodes[id].z - V.z;
      const k = Math.min(1, Math.max(0, (FNC.road.gateS - 4.2 - s) / (FNC.road.gateS - 4.2 - (FNC.floorR - 4))));
      this.est.set(id, s > FNC.road.gateS - 4.3 ? FNC.lipY : FNC.lipY + (Y - FNC.lipY) * k);
    }
    const Sq = CALDERA.square;
    const dais = { t: Sq.half - 8, s: Sq.s0 + 6 };
    const sq = new Map<string, number>();
    const sqCols = [-30, -20, -10, 0, 10, 20, 30], sqRows = [46, 54, 62, 70, 78];
    for (const s of sqRows) {
      for (const t of sqCols) {
        if (Math.abs(t - dais.t) < 7 && Math.abs(s - dais.s) < 6.5) continue;
        const p = ax(t, s);
        const id = nav.addNode(p.x, p.z, T.street | T.square | Z.caldera, 0.4);
        this.width.set(id, 3);
        sq.set(`${t},${s}`, id);
      }
    }
    for (let ri = 0; ri < sqRows.length; ri++) {
      for (let ci = 0; ci < sqCols.length; ci++) {
        const id = sq.get(`${sqCols[ci]},${sqRows[ri]}`);
        if (id === undefined) continue;
        const r = ci > 0 ? sq.get(`${sqCols[ci - 1]},${sqRows[ri]}`) : undefined;
        const u = ri > 0 ? sq.get(`${sqCols[ci]},${sqRows[ri - 1]}`) : undefined;
        if (r !== undefined) nav.link(r, id);
        if (u !== undefined) nav.link(u, id);
      }
    }
    const sqEnd = sq.get(`0,${sqRows[sqRows.length - 1]}`);
    if (sqEnd !== undefined) this.linkNear(sqEnd, 5, Z.caldera & ~0 /* avenue */);
    const ring: P2[] = [];
    for (let a = -180; a <= 180; a += 6) ring.push(atPolar(a, FNC.ringR + 9));
    const ringIds = this.street(ring, T.street | T.patrol | Z.caldera, 2.2, 6, 3);
    nav.link(ringIds[0], ringIds[ringIds.length - 1]);
    for (const id of sq.values()) {
      const n = nav.nodes[id];
      if (Math.hypot(n.x - V.x, n.z - V.z) < FNC.ringR + 16) this.linkNear(id, 7, Z.caldera & ~0);
    }
    const ACADEMY2 = { phi: 262, r: 88 };
    const features: Array<{ phi: number; r: number; tags: number }> = [
      { ...CALDERA.temple, tags: T.temple | T.square },
      { ...CALDERA.academy, tags: T.school },
      { ...ACADEMY2, tags: T.school },
      { ...CALDERA.octagon, tags: T.square | T.bench },
      { ...CALDERA.coronation, tags: T.square },
      { ...CALDERA.garden, tags: T.water | T.bench },
    ];
    for (const f of features) {
      const pts: P2[] = [];
      for (let r = FNC.ringR + 9; r <= f.r - 8; r += 6) pts.push(atPolar(f.phi, r));
      if (pts.length > 1) this.street(pts, T.street | Z.caldera, 1.4, 6, 4);
      const end = atPolar(f.phi, f.r - (f.tags & T.temple ? 18 : f.tags & T.school ? 2 : 6));
      this.poi(end.x, end.z, f.tags | Z.caldera, Math.atan2(end.x - V.x, end.z - V.z) + Math.PI, 10);
    }
    // --- Palace: gate, grand stair, courtyard, the entrance.
    const PF = FNC.hillY + 1.2, CY = FNC.hillY + 0.2;
    const gateY = heightAt(ax(0, FNC.ringR - 2).x, ax(0, FNC.ringR - 2).z);
    const pal = this.street([ax(0, Sq.s0 + 4), ax(0, FNC.ringR + 1.5), ax(0, FNC.ringR - 2), ax(0, 31.5), ax(0, 27), ax(0, 21), ax(0, 15), ax(0, 11.2)], T.street | Z.palace, 1.4, 5, 3);
    for (const id of pal) {
      const s = nav.nodes[id].z - V.z;
      const k = Math.min(1, Math.max(0, (FNC.ringR - 2 - s) / (FNC.ringR - 2 - 27)));
      this.est.set(id, s > FNC.ringR + 1 ? Y : s > FNC.ringR - 2 ? gateY : gateY + (CY - gateY) * k);
    }
    for (const side of [-1, 1]) this.poi(ax(side * 4.5, 18).x, ax(side * 4.5, 18).z, T.square | Z.palace, side > 0 ? -Math.PI / 2 : Math.PI / 2, 6, CY);
    void PF;

    // Zone node lists (street nodes only) for spawning.
    for (const z of ZONES) this.zoneNodes.set(z, []);
    nav.nodes.forEach((n, i) => {
      for (const z of ZONES) if (n.tags & Z[z] && n.tags & T.street) this.zoneNodes.get(z)!.push(i);
      for (let b = 0; b < 20; b++) {
        if (!(n.tags & (1 << b)) || b === 0) continue;
        let l = this.pois.get(b);
        if (!l) this.pois.set(b, (l = []));
        l.push(i);
      }
    });
    this.prev = new Int32Array(new ArrayBuffer(nav.nodes.length * 4));
  }

  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------

  /** Ground heights and the population (once the region's colliders exist). */
  prepare(ctx: GameContext): void {
    if (this.nodeY) return;
    this.ctx = ctx;
    const N = this.nav.nodes;
    this.nodeY = new Float32Array(N.length);
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      const zb = n.tags & ZALL;
      const e = this.est.get(i) ?? (zb === Z.harbor ? FNC.harbor.quayY : zb === Z.plaza ? PLAZA.y : zb === Z.caldera ? CALDERA.y : heightAt(n.x, n.z));
      const g = ctx.world.groundAt(n.x, n.z, e + 2.2);
      this.nodeY[i] = g.y + (g.colliderId ? 0.01 : 0.06);
    }
    // Connected components: spawn and walk only inside the biggest one.
    this.comp = new Int32Array(N.length).fill(-1);
    let c = 0;
    for (let i = 0; i < N.length; i++) {
      if (this.comp[i] >= 0) continue;
      const st = [i];
      this.comp[i] = c;
      while (st.length) {
        const k = st.pop()!;
        for (const e of N[k].edges) if (this.comp[e] < 0) {
          this.comp[e] = c;
          st.push(e);
        }
      }
      c++;
    }
    const size = new Map<number, number>();
    for (let i = 0; i < N.length; i++) size.set(this.comp[i], (size.get(this.comp[i]) ?? 0) + 1);
    let main = 0, best = -1;
    for (const [k, v] of size) if (v > best) {
      best = v;
      main = k;
    }
    this.main = main;
    for (const z of ZONES) this.zoneNodes.set(z, this.zoneNodes.get(z)!.filter((i) => this.comp![i] === main));
    for (const [b, l] of this.pois) this.pois.set(b, l.filter((i) => this.comp![i] === main));
    this.spawn(ctx);
    this.buildEvents(ctx);
    const g = ctx.settings.data.graphics;
    this.figures.setRange(LIFE.draw.near, g.preset === 'low' ? LIFE.draw.farLow : LIFE.draw.far);
  }

  private ground(x: number, z: number, est: number): number {
    const g = this.ctx!.world.groundAt(x, z, est + 2.2);
    return g.y + (g.colliderId ? 0.01 : 0.06);
  }

  private person(zone: ZoneName, role: Role, klass: Klass): Agent {
    const r = this.rnd;
    const pal = PALETTE[klass];
    let acc = pal.acc[Math.floor(r() * pal.acc.length)];
    if (role === 'vendor') acc = r() < 0.4 ? Acc.cart : r() < 0.6 ? FAcc.foodCart : Acc.pole;
    else if (role === 'porter') acc = r() < 0.6 ? Acc.crate : Acc.bundle;
    else if (role === 'patrol' && klass === 'trooper') acc = FAcc.skull;
    else if (role === 'drill') acc = FAcc.skullBare;
    const a: Agent = {
      i: this.agents.length, zone, roam: ROAM[zone], role, klass,
      robe: pal.robes[Math.floor(r() * pal.robes.length)], pants: pal.pants[Math.floor(r() * pal.pants.length)], skin: SKIN[Math.floor(r() * SKIN.length)], acc,
      scale: 0.92 + r() * 0.15, speed: role === 'vendor' ? 0.85 : role === 'porter' ? 1.0 : role === 'patrol' ? 1.25 : 1.0 + r() * 0.45,
      stay: r(), node: -1, path: [], pi: 0, x: 0, y: 0, z: 0, yaw: r() * 6.28, lane: r() * 2 - 1, dodge: 0, st: 'act', t: r() * 6, pose: Pose.idle, phase: r() * 10, amt: 1,
      px: NaN, py: 0, pz: 0, pyaw: 0, goal: -1, gx: 0, gy: 0, gz: 0, gyaw: 0, toGoal: false, reloc: false, squad: -1, callT: 3 + r() * 8, greet: 0, delay: r() * 0.6, visible: false,
    };
    if (klass === 'noble' && r() < 0.3) a.scale *= 1.03;
    return a;
  }

  private place(a: Agent, node: number): void {
    const n = this.nav.nodes[node];
    a.node = node;
    a.x = n.x;
    a.z = n.z;
    a.y = this.nodeY![node];
  }

  private post(a: Agent, x: number, z: number, yaw: number, est: number): void {
    a.px = x;
    a.pz = z;
    a.pyaw = yaw;
    a.py = this.ground(x, z, est);
    a.x = x;
    a.z = z;
    a.y = a.py;
    a.yaw = yaw;
    a.st = 'post';
  }

  private spawn(ctx: GameContext): void {
    const ax = atAxis;
    const posts = this.postSpots();
    const sellers = marketStalls.map((s) => ({ x: s.x - Math.sin(s.yaw) * 0.25, z: s.z - Math.cos(s.yaw) * 0.25, yaw: s.yaw, est: s.y }));
    const fish = ax(harborHalf(668) + 9, 668);
    const fishSpots = [0, 1, 2, 3].map((k) => ({ x: fish.x + 1.5 + (k % 2) * 1.6, z: fish.z - 2 + k * 1.4, yaw: -Math.PI / 2, est: FNC.harbor.quayY }));
    for (const zone of ZONES) {
      const nodes = this.zoneNodes.get(zone)!;
      if (!nodes.length) continue;
      let guardK = 0;
      for (const [role0, klass, count] of LIFE.cast[zone]) {
        for (let k = 0; k < count; k++) {
          let role = role0;
          if (role === 'seller' && zone === 'market' && !sellers.length) role = 'shopper';
          const a = this.person(zone, role, klass);
          this.agents.push(a);
          this.place(a, nodes[Math.floor(this.rnd() * nodes.length)]);
          if (role === 'guard' || role === 'royal') {
            const spot = (posts[zone] ?? [])[guardK++];
            if (spot) this.post(a, spot.x, spot.z, spot.yaw, spot.est);
            else a.role = 'patrol';
          } else if (role === 'seller') {
            const spot = zone === 'market' ? sellers.shift() : fishSpots.shift();
            if (spot) this.post(a, spot.x, spot.z, spot.yaw, spot.est);
            else a.role = 'shopper';
          }
        }
      }
    }
    // Patrol squads of four (marching in step), formations (plaza drill, two academies), sages.
    for (const zone of ZONES) {
      const pat = this.agents.filter((a) => a.zone === zone && a.role === 'patrol');
      for (let k = 0; k + 3 < pat.length; k += 4) {
        const sq: Squad = { members: pat.slice(k, k + 4).map((a) => a.i), trail: new Float32Array(TRAIL * 4), head: 0, n: 0, dist: 0, lastX: pat[k].x, lastZ: pat[k].z, stepT: 0 };
        for (const a of pat.slice(k, k + 4)) a.squad = this.squads.length;
        this.squads.push(sq);
      }
      for (const a of pat.slice(Math.floor(pat.length / 4) * 4)) a.role = 'walker';
    }
    this.stats.squads = this.squads.length;
    this.formations(ctx);
    this.stats.total = this.agents.length;
  }

  /** Guard posts by district: gates, towers, the palace. */
  private postSpots(): Partial<Record<ZoneName, Array<{ x: number; z: number; yaw: number; est: number }>>> {
    const ax = atAxis;
    const W = HARBOR.wall;
    const P = PLAZA;
    const spot = (t: number, s: number, yaw: number, est: number) => ({ ...ax(t, s), yaw, est });
    const out: Partial<Record<ZoneName, Array<{ x: number; z: number; yaw: number; est: number }>>> = {};
    out.harbor = [
      spot(-(W.gateHalf + W.towerW / 2), HARBOR.wallS - 3, 0, W.towerH),
      spot(W.gateHalf + W.towerW / 2, HARBOR.wallS - 3, 0, W.towerH),
      spot(-(harborHalf(768) + 6), 768, 0, FNC.harbor.quayY),
      spot(harborHalf(768) + 6, 768, 0, FNC.harbor.quayY),
      spot(-24, FNC.harbor.s0 + 3, 0, FNC.harbor.quayY),
      spot(24, FNC.harbor.s0 + 3, 0, FNC.harbor.quayY),
    ];
    out.plaza = [
      spot(-3.6, 559.5, 0, P.y), spot(3.6, 559.5, 0, P.y),
      spot(-(P.gatehouse.w / 2 + 1.4), P.gatehouse.s + 3, 0, P.y), spot(P.gatehouse.w / 2 + 1.4, P.gatehouse.s + 3, 0, P.y),
      spot(-20.2, 597, Math.PI / 2, P.y), spot(20.2, 597, -Math.PI / 2, P.y),
      spot(-19.5, 655.5, Math.PI, P.y), spot(19.5, 655.5, Math.PI, P.y),
    ];
    const top = this.marks.passageTop?.y ?? heightAt(ax(0, 505).x, ax(0, 505).z);
    const eg = POINTS_EAST();
    out.city = [spot(-4.4, P.tower.topS - 4, Math.PI, top), spot(4.4, P.tower.topS - 4, Math.PI, top), { x: eg.x - 2.5, z: eg.z + 1, yaw: Math.PI / 2, est: heightAt(eg.x, eg.z) }, { x: eg.x - 2.5, z: eg.z - 3, yaw: Math.PI / 2, est: heightAt(eg.x, eg.z) }];
    out.road = [];
    for (let k = 1; k < 10; k++) {
      const m = this.marks[`roadTower${k}`];
      if (m) out.road.push({ x: m.x + 1.2, z: m.z + 1.2, yaw: 0, est: m.y });
    }
    const Y = CALDERA.y;
    const Sq = CALDERA.square;
    out.caldera = [spot(-4.6, FNC.floorR - 6, Math.PI, Y), spot(4.6, FNC.floorR - 6, Math.PI, Y), spot(Sq.half - 8 - 5.6, Sq.s0 + 6, 0, Y), spot(Sq.half - 8 + 5.6, Sq.s0 + 6, 0, Y)];
    const CY = FNC.hillY + 0.2;
    out.palace = [
      spot(-3.4, FNC.ringR + 2.4, 0, Y), spot(3.4, FNC.ringR + 2.4, 0, Y), spot(-6.8, FNC.ringR + 2.4, 0, Y), spot(6.8, FNC.ringR + 2.4, 0, Y),
      spot(-5.4, 16, Math.PI / 2, CY), spot(5.4, 16, -Math.PI / 2, CY), spot(-5.4, 22, Math.PI / 2, CY), spot(5.4, 22, -Math.PI / 2, CY),
      spot(-2.8, 12, 0, CY), spot(2.8, 12, 0, CY),
    ];
    return out;
  }

  /** Drill formations: troops on the plaza, students in both academies' yards; sages' circuit. */
  private formations(_ctx: GameContext): void {
    const drill = this.agents.filter((a) => a.role === 'drill');
    {
      const f: Formation = { members: [], kind: 'drill', hours: LIFE.drill, x: 0, y: 0, z: 0, yaw: Math.PI, period: 2.4, clock: 0, ix: 0, iy: 0, iz: 0, iyaw: 0 };
      drill.forEach((a, k) => {
        const p = atAxis(-7.5 + (k % 4) * 5, 565 + Math.floor(k / 4) * 4);
        this.post(a, p.x, p.z, Math.PI, PLAZA.y);
        f.members.push(a.i);
      });
      const c = atAxis(0, 571);
      const ins = atAxis(0, 560.6);
      Object.assign(f, { x: c.x, y: PLAZA.y, z: c.z, ix: ins.x, iy: this.ground(ins.x, ins.z, PLAZA.y), iz: ins.z, iyaw: 0 });
      this.forms.push(f);
    }
    const students = this.agents.filter((a) => a.role === 'student');
    const acads: Array<{ at: { phi: number; r: number }; W: number; cols: number; rows: number[] }> = [
      { at: CALDERA.academy, W: 22, cols: 4, rows: [4, 6.5, 9] },
      { at: { phi: 262, r: 88 }, W: 26, cols: 5, rows: [4, 7] },
    ];
    let si = 0;
    for (const A of acads) {
      const p = atPolar(A.at.phi, A.at.r);
      const yaw = Math.atan2(V.x - p.x, V.z - p.z);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const L = (lx: number, lz: number) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c });
      const f: Formation = { members: [], kind: 'academy', hours: [LIFE.academy], x: L(0, 6).x, y: CALDERA.y, z: L(0, 6).z, yaw: yaw + Math.PI, period: A.cols === 4 ? 2.0 : 2.2, clock: A.cols * 0.37, ix: 0, iy: 0, iz: 0, iyaw: yaw };
      for (const lz of A.rows) {
        for (let k = 0; k < A.cols && si < students.length; k++) {
          const lx = (k - (A.cols - 1) / 2) * 3;
          const q = L(lx, lz);
          const a = students[si++];
          this.post(a, q.x, q.z, yaw + Math.PI, CALDERA.y);
          f.members.push(a.i);
        }
      }
      const ins = L(0, 1.2);
      Object.assign(f, { ix: ins.x, iz: ins.z, iy: this.ground(ins.x, ins.z, CALDERA.y) });
      this.forms.push(f);
    }
    // Fire Sages: a circuit round the High Temple's braziers.
    const tp = atPolar(CALDERA.temple.phi, CALDERA.temple.r);
    const ty = Math.atan2(V.x - tp.x, V.z - tp.z);
    const tc = Math.cos(ty), ts = Math.sin(ty);
    const TL = (lx: number, lz: number) => ({ x: tp.x + lx * tc + lz * ts, z: tp.z - lx * ts + lz * tc });
    this.sageRoute = [TL(-12, 14.8), TL(-4, 17), TL(4, 17), TL(12, 14.8), TL(0, 24)].map((q) => ({ ...q, y: this.ground(q.x, q.z, CALDERA.y) }));
    this.sageFlames = [TL(-12, 13), TL(12, 13)];
    this.agents.filter((a) => a.role === 'sage').forEach((a, k) => {
      a.st = 'act';
      a.t = k * 3;
      a.node = -1;
      const q = this.sageRoute[(k * 2) % this.sageRoute.length];
      a.x = q.x;
      a.z = q.z;
      a.y = q.y;
      a.gx = (k * 2) % this.sageRoute.length;
    });
  }
  private sageRoute: Array<{ x: number; y: number; z: number }> = [];
  private sageFlames: P2[] = [];

  /** Rally and proclamation slots. */
  private buildEvents(_ctx: GameContext): void {
    const r = rng(LIFE.seed ^ 0x7a11);
    const slots = this.rally.slots;
    for (const s of [576.5, 580]) for (let t = -13.5; t <= 13.51; t += 3) slots.push({ ...atAxis(t, s), y: PLAZA.y, yaw: Math.PI, troop: true });
    const civ: Array<{ t: number; s: number }> = [];
    for (let s = 585; civ.length < LIFE.rally.crowd + 60 && s < 640; s += 1.7) {
      for (let t = -6.25; t <= 6.26; t += 1.25) civ.push({ t, s });
      if (s < 632) for (const side of [-1, 1]) for (let k = 0; k < 6; k++) civ.push({ t: side * (13.2 + k * 1.2), s });
    }
    civ.sort((a, b) => a.s - b.s);
    for (const c of civ) {
      const t = c.t + (r() - 0.5) * 0.3, s = c.s + (r() - 0.5) * 0.4;
      slots.push({ ...atAxis(t, s), y: PLAZA.y, yaw: Math.PI + (r() - 0.5) * 0.3, troop: false });
    }
    const Sq = CALDERA.square;
    const dais = atAxis(Sq.half - 8, Sq.s0 + 6);
    for (let s = 58; s <= 70; s += 2) {
      for (let t = 14; t <= 32; t += 2.1) {
        const p = atAxis(t + (r() - 0.5) * 0.5, s + (r() - 0.5) * 0.5);
        this.proclaim.slots.push({ ...p, y: CALDERA.y, yaw: Math.atan2(dais.x - p.x, dais.z - p.z) });
      }
    }
    for (const sl of slots) sl.y = this.ground(sl.x, sl.z, PLAZA.y);
    for (const sl of this.proclaim.slots) sl.y = this.ground(sl.x, sl.z, CALDERA.y);
  }

  // ---------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------

  private pick(a: Agent, bits: number[], maxD = 260): number {
    for (let tries = 0; tries < 10; tries++) {
      const b = bits[Math.floor(Math.random() * bits.length)];
      const l = this.pois.get(b);
      if (!l || !l.length) continue;
      const k = l[Math.floor(Math.random() * l.length)];
      const n = this.nav.nodes[k];
      if (!(n.tags & a.roam)) continue;
      if (Math.abs(n.x - a.x) + Math.abs(n.z - a.z) > maxD) continue;
      return k;
    }
    // Any street node of the home district nearby.
    const nodes = this.zoneNodes.get(a.zone)!;
    if (!nodes.length) return -1;
    for (let tries = 0; tries < 8; tries++) {
      const k = nodes[Math.floor(Math.random() * nodes.length)];
      const n = this.nav.nodes[k];
      if (Math.abs(n.x - a.x) + Math.abs(n.z - a.z) < 160) return k;
    }
    return nodes[Math.floor(Math.random() * nodes.length)];
  }

  private go(a: Agent, to: number): boolean {
    const from = a.node >= 0 ? a.node : this.nav.near(a.x, a.z, 30);
    if (from < 0 || to < 0 || from === to) return false;
    const p = this.nav.path(from, to, a.path, this.prev);
    if (!p || p.length < 2) return false;
    a.pi = 1;
    a.st = 'walk';
    return true;
  }

  private decide(a: Agent, h: number): void {
    if (a.role === 'sage' || a.squad >= 0 && this.squads[a.squad].members[0] !== a.i) return;
    if (!this.isOut(a, h)) {
      const home = this.pick(a, [b(T.home)], 140);
      if (home >= 0 && this.nav.nodes[home].tags & T.home && this.go(a, home)) {
        a.t = -1;
        return;
      }
      a.st = 'home';
      a.t = 20 + Math.random() * 40;
      return;
    }
    let bits: number[];
    switch (a.role) {
      case 'sitter':
        bits = [b(T.bench), b(T.water), b(T.square)];
        break;
      case 'docker':
        bits = [b(T.work)];
        break;
      case 'smith':
        bits = [b(T.work)];
        break;
      case 'porter':
        bits = [b(T.work), b(T.shop), b(T.stall)];
        break;
      case 'vendor':
        bits = [b(T.square), b(T.square), b(T.shop)];
        break;
      case 'shopper':
        bits = h >= LIFE.shops[0] && h < LIFE.shops[1] ? [b(T.stall), b(T.shop), b(T.shop)] : [b(T.square), b(T.home)];
        break;
      case 'patrol':
        bits = [b(T.patrol)];
        break;
      case 'courtier':
        bits = [b(T.square), b(T.street)];
        break;
      default:
        bits = a.klass === 'noble' ? [b(T.square), b(T.temple), b(T.water), b(T.bench), b(T.school)] : [b(T.shop), b(T.stall), b(T.square), b(T.square), b(T.bench), b(T.water), b(T.temple), b(T.home)];
    }
    const to = this.pick(a, bits, a.role === 'patrol' ? 320 : 240);
    if (!this.go(a, to)) {
      a.st = 'act';
      a.t = 2 + Math.random() * 4;
      a.pose = Pose.idle;
    }
  }

  private isOut(a: Agent, h: number): boolean {
    if (a.role === 'patrol' || a.role === 'guard' || a.role === 'royal') return true;
    return a.stay < activity(a.zone, h);
  }

  /** Arrived at the end of a path: act there for a while (pose by what the spot is). */
  private arrive(a: Agent, h: number): void {
    const n = this.nav.nodes[a.node];
    a.st = 'act';
    a.pose = Pose.idle;
    if (a.toGoal) {
      a.st = 'goal';
      return;
    }
    if (n.tags & T.home && !this.isOut(a, h)) {
      a.st = 'home';
      a.t = 30 + Math.random() * 50;
      return;
    }
    const face = n.tags & (T.shop | T.stall | T.home | T.work | T.water | T.bench | T.school | T.temple);
    if (face) a.yaw = n.yaw;
    if (a.role === 'sitter' && n.tags & (T.bench | T.water)) {
      a.pose = Pose.sit;
      a.t = 30 + Math.random() * 60;
    } else if (a.role === 'docker' || a.role === 'smith') {
      a.pose = Math.random() < 0.6 ? Pose.work : Pose.carry;
      a.t = 8 + Math.random() * 16;
    } else if (n.tags & (T.shop | T.stall)) {
      a.pose = Pose.talk;
      a.t = 5 + Math.random() * 10;
    } else if (a.role === 'vendor') {
      a.pose = Pose.idle;
      a.t = 12 + Math.random() * 16;
      a.callT = 1 + Math.random() * 3;
    } else if (a.role === 'patrol') {
      a.t = 2 + Math.random() * 3;
    } else {
      a.pose = Math.random() < 0.3 ? Pose.talk : Pose.idle;
      a.t = 3 + Math.random() * 9;
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /** Force the rally on/off (null: back to the schedule). `instant` places the crowd at once. */
  setRally(on: boolean | null, instant = false): void {
    this.rally.forced = on;
    this.rally.instant = instant;
  }

  setProclamation(on: boolean | null): void {
    this.proclaim.forced = on;
  }

  private inView(x: number, y: number, z: number): boolean {
    return this.figures.inView(x, y, z) && Math.abs(x - this.cam.x) + Math.abs(z - this.cam.z) < 420;
  }
  private readonly cam = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();

  private startEvent(kind: 'rally' | 'proclaim', instant: boolean): void {
    const ev = kind === 'rally' ? this.rally : this.proclaim;
    ev.on = true;
    ev.members.length = 0;
    const slots = ev.slots as Array<{ x: number; y: number; z: number; yaw: number; troop?: boolean }>;
    const plaza = kind === 'rally';
    const cx = plaza ? atAxis(0, 600) : atAxis(20, 62);
    const want = plaza ? LIFE.rally.crowd : LIFE.proclaim.crowd;
    // Troops first (rally only), then the nearest civilians.
    const troops = plaza ? this.agents.filter((a) => a.role === 'drill' || (a.role === 'patrol' && a.zone === 'plaza')) : [];
    const civ = this.agents
      .filter((a) => a.goal < 0 && a.role !== 'guard' && a.role !== 'royal' && a.role !== 'drill' && a.role !== 'student' && a.role !== 'sage' && a.role !== 'seller' && a.role !== 'patrol' && (plaza ? a.zone !== 'road' && a.zone !== 'palace' : a.zone === 'caldera' && a.klass === 'noble'))
      .sort((p, q) => Math.hypot(p.x - cx.x, p.z - cx.z) - Math.hypot(q.x - cx.x, q.z - cx.z));
    let si = 0;
    const troopSlots = plaza ? slots.filter((s) => s.troop) : [];
    const civSlots = plaza ? slots.filter((s) => !s.troop) : slots;
    troops.forEach((a, k) => {
      const s = troopSlots[k];
      if (s) this.send(a, s, instant, ev.members);
    });
    for (const a of civ) {
      if (si >= civSlots.length || ev.members.length >= want) break;
      this.send(a, civSlots[si++], instant, ev.members);
    }
    ev.cheerT = 5;
    ev.cheer = -10;
  }

  private send(a: Agent, s: { x: number; y: number; z: number; yaw: number }, instant: boolean, list: number[]): void {
    a.goal = list.length;
    list.push(a.i);
    a.gx = s.x;
    a.gy = s.y;
    a.gz = s.z;
    a.gyaw = s.yaw;
    a.squad = a.squad >= 0 && a.role === 'patrol' ? -1 : a.squad;
    a.node = this.nav.near(a.x, a.z, 24, ZALL);
    a.visible = true;
    const unseen = !this.inView(a.x, a.y, a.z) && !this.inView(s.x, s.y, s.z);
    if (instant || a.st === 'home' || unseen) {
      a.x = s.x;
      a.y = s.y;
      a.z = s.z;
      a.yaw = s.yaw;
      a.st = 'goal';
      a.toGoal = false;
      a.node = this.nav.near(s.x, s.z, 14);
      return;
    }
    const target = this.nav.near(s.x, s.z, 14, ZALL);
    a.toGoal = true;
    if (!this.go(a, target)) {
      a.st = 'goal';
    }
  }

  private endEvent(kind: 'rally' | 'proclaim'): void {
    const ev = kind === 'rally' ? this.rally : this.proclaim;
    ev.on = false;
    ev.speech = false;
    for (const i of ev.members) {
      const a = this.agents[i];
      a.goal = -1;
      a.toGoal = false;
      if (a.role === 'drill') {
        // Back to the drill yard in file.
        a.goal = -2;
        a.gx = a.px;
        a.gy = a.py;
        a.gz = a.pz;
        a.gyaw = a.pyaw;
        a.st = 'goal';
        continue;
      }
      if (a.role === 'patrol') {
        a.squad = this.squads.findIndex((q) => q.members.includes(a.i));
      }
      a.node = this.nav.near(a.x, a.z, 16, ZALL);
      const far = kind === 'rally' && (a.zone === 'caldera' || a.zone === 'foundry' || a.zone === 'park');
      if (far) {
        a.reloc = true;
        a.st = 'home';
        a.t = 4 + Math.random() * 20;
      } else {
        a.st = 'act';
        a.t = Math.random() * 8;
        a.pose = Pose.idle;
      }
    }
    ev.members.length = 0;
  }

  private updateEvents(dt: number, ctx: GameContext, h: number): void {
    const R = LIFE.rally, P = LIFE.proclaim;
    const rallyNow = this.rally.forced ?? (h >= R.gather && h < R.end);
    if (rallyNow && !this.rally.on) this.startEvent('rally', this.rally.instant);
    else if (!rallyNow && this.rally.on) this.endEvent('rally');
    this.rally.speech = this.rally.on && (this.rally.forced === true || h >= R.speech);
    const procNow = this.proclaim.forced ?? (h >= P.gather && h < P.end);
    if (procNow && !this.proclaim.on) this.startEvent('proclaim', false);
    else if (!procNow && this.proclaim.on) this.endEvent('proclaim');
    this.proclaim.speech = this.proclaim.on && (this.proclaim.forced === true || h >= P.speech);
    // Cheers: the crowd roars, flames leap from the tower.
    const lis = ctx.player?.position ?? this.cam;
    if (this.rally.speech) {
      this.rally.cheerT -= dt;
      if (this.rally.cheerT <= 0) {
        this.rally.cheerT = 7 + Math.random() * 4;
        this.rally.cheer = this.elapsed;
        const c = atAxis(0, 596);
        const d = Math.hypot(lis.x - c.x, lis.z - c.z);
        if (d < 420) {
          ctx.audio.play('voice.crowd.cheer', { position: this.tmpV.set(c.x, PLAZA.y + 2, c.z), volume: 1.3 });
          const bal = this.marks.balcony;
          if (bal) {
            for (const side of [-1, 1]) {
              this.tmpV.set(bal.x + side * 9, bal.y + 0.5, bal.z + 1.5);
              ctx.vfx.burst('fire', this.tmpV, { count: 36, dir: this.tmpD.set(0, 1, 0.15), speed: 9, spread: 0.25, size: 1.6, life: 0.9 });
            }
            ctx.audio.play('fire.roar', { position: this.tmpV.set(bal.x, bal.y, bal.z), volume: 0.9 });
          }
          for (const t of [-19.5, 19.5]) {
            for (const s of [566, 640]) {
              const p = atAxis(t, s);
              ctx.vfx.burst('fire', this.tmpV.set(p.x, PLAZA.y + 1.2, p.z), { count: 26, dir: CapitalLife.UP, speed: 8, spread: 0.2, size: 1.3, life: 0.8 });
            }
          }
        }
      }
    }
    if (this.rally.on) {
      // Drums while the crowd gathers and between cheers.
      this.sfx.drum -= dt;
      if (this.sfx.drum <= 0) {
        this.sfx.drum = this.rally.speech ? 1.5 : 0.75;
        const c = atAxis(0, 562);
        if (Math.hypot(lis.x - c.x, lis.z - c.z) < 320) ctx.audio.play('fnc_drum', { position: this.tmpV.set(c.x, PLAZA.y + 1, c.z), volume: 0.9, pitch: this.frame % 2 ? 1 : 0.85 });
      }
    }
    if (this.proclaim.speech) {
      this.proclaim.cheerT -= dt;
      if (this.proclaim.cheerT <= 0) {
        this.proclaim.cheerT = 9 + Math.random() * 5;
        this.proclaim.cheer = this.elapsed;
        const c = atAxis(22, 62);
        if (Math.hypot(lis.x - c.x, lis.z - c.z) < 200) ctx.audio.play('voice.crowd.cheer', { position: this.tmpV.set(c.x, CALDERA.y + 2, c.z), volume: 0.55, pitch: 1.1 });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext, full: boolean): void {
    if (!this.nodeY) this.prepare(ctx);
    const t0 = performance.now();
    this.ctx = ctx;
    this.elapsed += dt;
    this.frame++;
    const h = ctx.world.sky.timeOfDay;
    this.cam.copy(ctx.camera.position);
    // Where the camera looks: a spot on the ground ahead of it (the bubble's centre).
    ctx.camera.getWorldDirection(this.tmpD);
    const fl = Math.hypot(this.tmpD.x, this.tmpD.z) || 1;
    this.focus.set(this.cam.x + (this.tmpD.x / fl) * 45, 0, this.cam.z + (this.tmpD.z / fl) * 45);
    const pl = ctx.player?.position ?? null;
    this.figures.begin(this.cam);
    this.figures.view(ctx.camera);
    this.updateEvents(dt, ctx, h);
    this.updateForms(dt, ctx, h);
    let out = 0, vis = 0, walking = 0, near = 0, inRally = 0, inProc = 0;
    const N = this.nav.nodes;
    const nodeY = this.nodeY!;
    for (let ai = 0; ai < this.agents.length; ai++) {
      const a = this.agents[ai];
      const man = Math.abs(a.x - this.cam.x) + Math.abs(a.z - this.cam.z);
      const rate = man > 600 ? 12 : man > 320 ? 4 : 1;
      if (rate > 1 && (this.frame + ai) % rate !== 0) {
        if (a.visible) this.draw(a);
        continue;
      }
      const step = dt * rate;
      if (a.squad >= 0 && this.squads[a.squad].members[0] !== a.i && a.goal < 0) {
        // Squad member: in step behind the leader.
        this.follow(a, step);
      } else if (a.role === 'sage') {
        this.sage(a, step, ctx);
      } else if (a.st === 'post') {
        a.phase += step;
        if (a.role === 'seller') {
          const open = h >= LIFE.shops[0] && h < LIFE.shops[1];
          a.visible = open;
          a.pose = open && pl && Math.hypot(pl.x - a.x, pl.z - a.z) < 4 ? Pose.talk : Pose.idle;
        } else if (a.role === 'drill' || a.role === 'student') {
          // Posed (and shown or sent in for the night) by the formation update.
        } else {
          a.visible = true;
          if (pl && (pl.x - a.x) ** 2 + (pl.z - a.z) ** 2 < 9) a.yaw += wrap(Math.atan2(pl.x - a.x, pl.z - a.z) - a.yaw) * Math.min(1, step * 4);
          else a.yaw += wrap(a.pyaw - a.yaw) * Math.min(1, step * 2);
        }
      } else if (a.st === 'home') {
        a.visible = false;
        a.t -= step;
        if (a.t <= 0) {
          if (this.isOut(a, h)) {
            if (a.reloc) {
              const nodes = this.zoneNodes.get(a.zone)!;
              const k = nodes[Math.floor(Math.random() * nodes.length)];
              if (!this.inView(N[k].x, nodeY[k], N[k].z)) {
                this.place(a, k);
                a.reloc = false;
              }
            }
            if (!a.reloc) {
              a.st = 'act';
              a.t = 0;
            } else a.t = 3;
          } else a.t = 20 + Math.random() * 30;
        }
        continue;
      } else if (a.st === 'goal') {
        a.visible = true;
        this.atGoal(a, step);
      } else if (a.st === 'act') {
        a.visible = true;
        a.t -= step;
        a.phase += step;
        if (a.greet > 0) a.greet -= step;
        if (pl && a.pose !== Pose.sit && a.pose !== Pose.work && a.greet <= 0) {
          const dx = pl.x - a.x, dz = pl.z - a.z;
          if (dx * dx + dz * dz < 9) {
            a.yaw = Math.atan2(dx, dz);
            a.pose = Pose.talk;
            a.greet = 2.5;
          }
        }
        if (a.role === 'vendor' && full && pl) {
          a.callT -= step;
          if (a.callT <= 0) {
            a.callT = 9 + Math.random() * 10;
            if (Math.hypot(pl.x - a.x, pl.z - a.z) < 26) ctx.audio.play('amb.vendor', { position: this.tmpV.set(a.x, a.y + 1.6, a.z), volume: 0.8, pitch: 0.9 + Math.random() * 0.25 });
          }
        }
        if (a.t <= 0) this.decide(a, h);
      } else {
        a.visible = true;
        this.walk(a, step, pl, h, N, nodeY);
        walking++;
      }
      if (a.st === 'home') a.visible = false;
      if (a.visible) this.draw(a);
      if (a.squad >= 0 && this.squads[a.squad].members[0] === a.i) this.record(a);
    }
    let local = 0, around = 0;
    const fx = this.focus.x, fz = this.focus.z;
    for (const a of this.agents) {
      if (!a.visible) continue;
      out++;
      if (Math.abs(a.x - fx) < BUBBLE && Math.abs(a.z - fz) < BUBBLE && (a.x - fx) ** 2 + (a.z - fz) ** 2 < BUBBLE * BUBBLE) {
        around++;
        if (this.figures.inView(a.x, a.y, a.z)) local++;
      }
      if (a.goal >= 0) {
        if (this.rally.members[a.goal] === a.i) inRally++;
        else inProc++;
      }
      if (pl && Math.abs(pl.x - a.x) < 25 && Math.abs(pl.z - a.z) < 25) near++;
    }
    this.drawSpecials(h);
    this.figures.end();
    vis = this.figures.stats.near + this.figures.stats.far;
    this.nearCount = near;
    this.local = local;
    this.around = around;
    Object.assign(this.stats, { out, visible: vis, walking, rally: inRally, proclaim: inProc, local });
    this.bubble(dt, h);
    this.updateStalls(h);
    this.updateAudio(dt, ctx, h);
    this.updateSmoke(ctx);
    this.stats.ms = this.stats.ms * 0.9 + (performance.now() - t0) * 0.1;
  }

  /**
   * Keep Harbor City's streets busy where the camera looks (see BUBBLE): people far out of sight
   * step out of a door in view, or come round a corner just out of view near it.
   */
  private bubble(dt: number, h: number): void {
    this.bubbleT -= dt;
    if (this.bubbleT > 0) return;
    this.bubbleT = 0.3;
    const F = this.focus;
    const at = this.nav.near(F.x, F.z, 70, ZTOWN);
    if (at < 0) return;
    const zt = this.nav.nodes[at].tags & ZTOWN;
    const zone = ZONES.find((z) => Z[z] === zt);
    if (!zone) return;
    const want = Math.round((BUBBLE_TARGET[zone] ?? 0) * activity(zone, h));
    let deficit = Math.min(want - this.local, Math.round(want * 3) - this.around);
    if (deficit <= 0) return;
    // Candidate spots round the focus (refreshed as it moves).
    const key = `${Math.floor(F.x / 24)},${Math.floor(F.z / 24)}`;
    if (key !== this.doorKey) {
      this.doorKey = key;
      this.doors = this.nav.around(F.x, F.z, BUBBLE, ZTOWN).filter((k) => this.comp![k] === this.main);
    }
    if (!this.doors.length) return;
    const N = this.nav.nodes;
    let moved = 0;
    for (let tries = 0; tries < 80 && deficit > 0 && moved < 6; tries++) {
      const a = this.agents[this.relocI];
      this.relocI = (this.relocI + 1) % this.agents.length;
      if (!MOVABLE.has(a.role) || a.goal !== -1 || a.squad >= 0 || a.toGoal || !(Z[a.zone] & ZTOWN)) continue;
      if (a.st === 'home' ? !this.isOut(a, h) : a.st !== 'act' && a.st !== 'walk') continue;
      const man = Math.abs(a.x - F.x) + Math.abs(a.z - F.z);
      if (man < BUBBLE * 1.2) continue;
      if (a.visible && this.inView(a.x, a.y, a.z)) continue;
      // A door in view (stepping out of it), or a street spot out of sight close to the focus.
      let k = -1;
      for (let j = 0; j < 10; j++) {
        // Nearest first (the list is sorted by distance to the focus): the street being looked at fills up.
        const c = this.doors[Math.floor(Math.random() * Math.random() * this.doors.length)];
        const n = N[c];
        if ((n.x - this.cam.x) ** 2 + (n.z - this.cam.z) ** 2 < 16 * 16) continue;
        const seen = this.inView(n.x, this.nodeY![c], n.z);
        const door = (n.tags & (T.home | T.shop)) !== 0;
        if ((door && seen) || (!seen && (n.x - F.x) ** 2 + (n.z - F.z) ** 2 < 70 * 70)) {
          k = c;
          break;
        }
      }
      if (k < 0) continue;
      this.place(a, k);
      const nz = ZONES.find((z) => Z[z] === (N[k].tags & ZTOWN));
      if (nz) {
        a.zone = nz;
        a.roam = ROAM[nz];
      }
      a.yaw = N[k].yaw + Math.PI;
      a.path.length = 0;
      a.st = 'act';
      a.t = 0.3 + Math.random() * 1.5;
      a.pose = Pose.idle;
      a.visible = true;
      moved++;
      deficit--;
    }
    this.stats.moved += moved;
  }

  private draw(a: Agent): void {
    if (!this.figures.visible(a.x, a.y, a.z)) return;
    this.figures.push(a.x, a.y, a.z, a.yaw, a.pose, a.phase, a.amt, a.st === 'walk' ? 0.05 : 0, a.robe, a.pants, a.skin, a.acc, a.scale);
  }

  private walk(a: Agent, step: number, pl: THREE.Vector3 | null, h: number, N: NavGraph['nodes'], nodeY: Float32Array): void {
    const next = a.path[a.pi];
    const n = N[next];
    const last = a.pi === a.path.length - 1;
    const prevId = a.path[a.pi - 1];
    const pn = N[prevId];
    let sx = n.x - pn.x, sz = n.z - pn.z;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    const w = Math.min(this.width.get(prevId) ?? 0, this.width.get(next) ?? 0);
    const room = last ? 0 : Math.max(0, w - 0.4);
    const lane = Math.max(-room, Math.min(room, a.lane * room + a.dodge));
    const tx = n.x - sz * lane, tz = n.z + sx * lane;
    let dx = tx - a.x, dz = tz - a.z;
    const d = Math.hypot(dx, dz);
    let speed = a.speed;
    // Step aside for the player and for marching squads.
    let push = 0;
    if (pl) {
      const px = pl.x - a.x, pz = pl.z - a.z;
      const pd = Math.hypot(px, pz);
      if (pd < 2.4 && (px * dx + pz * dz) / (d || 1) > -0.2) {
        push = px * dz - pz * dx > 0 ? 1 : -1;
        speed *= 0.55;
      }
    }
    if (a.squad < 0) {
      for (const q of this.squads) {
        const L = this.agents[q.members[0]];
        if (L.goal >= 0) continue;
        const qx = L.x - a.x, qz = L.z - a.z;
        if (qx * qx + qz * qz > 30) continue;
        // The squad comes this way: give it the street.
        if (Math.sin(L.yaw) * -qx + Math.cos(L.yaw) * -qz > 0) {
          push = qx * dz - qz * dx > 0 ? 1.4 : -1.4;
          speed *= 0.4;
        }
      }
    }
    if (push) a.dodge = Math.max(-2.4, Math.min(2.4, a.dodge + push * step * 2.5));
    else a.dodge *= Math.max(0, 1 - step * 0.8);
    if (d < (last ? 0.4 : 0.15)) {
      a.node = next;
      a.pi++;
      if (a.pi >= a.path.length) this.arrive(a, h);
      return;
    }
    dx /= d;
    dz /= d;
    const mv = Math.min(d, speed * step);
    a.x += dx * mv;
    a.z += dz * mv;
    const k = Math.max(0, Math.min(1, 1 - d / Math.max(0.1, sl)));
    a.y = nodeY[prevId] + (nodeY[next] - nodeY[prevId]) * k;
    a.yaw += wrap(Math.atan2(dx, dz) - a.yaw) * Math.min(1, step * 8);
    a.phase += mv * 1.55;
    a.pose = a.acc === Acc.cart || a.acc === FAcc.foodCart ? Pose.push : a.acc === Acc.pole || a.acc === Acc.crate ? Pose.carry : Pose.walk;
    a.amt = 1;
  }

  /** At (or walking straight into) an event slot; cheering on cue. */
  private atGoal(a: Agent, step: number): void {
    const dx = a.gx - a.x, dz = a.gz - a.z;
    const d = Math.hypot(dx, dz);
    if (a.goal === -2 && d <= 0.08) {
      a.goal = -1;
      a.st = 'post';
      a.yaw = a.pyaw;
      return;
    }
    if (d > 0.08) {
      const mv = Math.min(d, 1.3 * step);
      a.x += (dx / d) * mv;
      a.z += (dz / d) * mv;
      a.y += (a.gy - a.y) * Math.min(1, step * 3);
      a.yaw += wrap(Math.atan2(dx, dz) - a.yaw) * Math.min(1, step * 8);
      a.phase += mv * 1.55;
      a.pose = Pose.walk;
      return;
    }
    a.y = a.gy;
    a.yaw += wrap(a.gyaw - a.yaw) * Math.min(1, step * 3);
    a.phase += step;
    const rally = this.rally.members[a.goal] === a.i;
    const ev = rally ? this.rally : this.proclaim;
    const since = this.elapsed - ev.cheer - a.delay;
    if (ev.speech && since >= 0 && since < 2.4) {
      a.pose = Pose.raise;
      a.amt = Math.min(1, since * 3, (2.4 - since) * 2.5) * (rally ? 1 : 0.55);
    } else {
      a.pose = a.role === 'drill' || a.role === 'patrol' ? Pose.idle : (a.i + Math.floor(this.elapsed / 5)) % 7 === 0 ? Pose.talk : Pose.idle;
      a.amt = 1;
    }
  }

  /** Squad leader's trail (positions every ~0.3 m) for the others to march along. */
  private record(a: Agent): void {
    const q = this.squads[a.squad];
    const dd = Math.hypot(a.x - q.lastX, a.z - q.lastZ);
    if (dd < 0.3 && q.n > 0) return;
    q.dist += dd;
    q.lastX = a.x;
    q.lastZ = a.z;
    const o = q.head * 4;
    q.trail[o] = a.x;
    q.trail[o + 1] = a.y;
    q.trail[o + 2] = a.z;
    q.trail[o + 3] = q.dist;
    q.head = (q.head + 1) % TRAIL;
    q.n = Math.min(TRAIL, q.n + 1);
  }

  private follow(a: Agent, step: number): void {
    const q = this.squads[a.squad];
    const L = this.agents[q.members[0]];
    const k = q.members.indexOf(a.i);
    const back = k >= 2 ? 1.6 : 0;
    const lat = k % 2 ? -1.1 : 0;
    // Sample the leader's trail `back` metres behind.
    let x = L.x, y = L.y, z = L.z, yaw = L.yaw;
    if (back > 0 && q.n > 1) {
      const want = q.dist - back;
      for (let j = 1; j < q.n; j++) {
        const o = ((q.head - j + TRAIL) % TRAIL) * 4;
        if (q.trail[o + 3] <= want) {
          x = q.trail[o];
          y = q.trail[o + 1];
          z = q.trail[o + 2];
          const o2 = ((q.head - j + 1 + TRAIL) % TRAIL) * 4;
          yaw = Math.atan2(q.trail[o2] - x, q.trail[o2 + 2] - z);
          break;
        }
      }
    }
    const tx = x + Math.cos(yaw) * lat, tz = z - Math.sin(yaw) * lat;
    const dx = tx - a.x, dz = tz - a.z;
    const d = Math.hypot(dx, dz);
    const mv = Math.min(d, (L.speed + 0.6) * step);
    if (d > 0.02) {
      a.x += (dx / d) * mv;
      a.z += (dz / d) * mv;
    }
    a.y += (y - a.y) * Math.min(1, step * 6);
    a.yaw += wrap((L.st === 'walk' ? L.yaw : yaw) - a.yaw) * Math.min(1, step * 6);
    a.phase = L.phase;
    a.pose = L.st === 'walk' ? Pose.walk : Pose.idle;
    a.visible = L.visible && L.st !== 'home';
    a.st = L.st === 'home' ? 'home' : 'act';
  }

  /** Fire Sages: walk the brazier circuit, tend each flame. */
  private sage(a: Agent, step: number, ctx: GameContext): void {
    const route = this.sageRoute;
    if (!route.length) return;
    const tgt = route[a.gx % route.length];
    const dx = tgt.x - a.x, dz = tgt.z - a.z;
    const d = Math.hypot(dx, dz);
    a.visible = true;
    if (a.t > 0) {
      a.t -= step;
      a.phase += step;
      if (a.t <= 0) a.gx = (a.gx + 1) % route.length;
    } else if (d > 0.15) {
      const mv = Math.min(d, 0.8 * step);
      a.x += (dx / d) * mv;
      a.z += (dz / d) * mv;
      a.y += (tgt.y - a.y) * Math.min(1, step * 4);
      a.yaw += wrap(Math.atan2(dx, dz) - a.yaw) * Math.min(1, step * 5);
      a.phase += mv * 1.3;
      a.pose = Pose.walk;
    } else {
      // At a brazier: raise the flame; elsewhere: a moment's stillness.
      const k = a.gx % route.length;
      const brazier = k === 0 || k === 3 ? this.sageFlames[k === 0 ? 0 : 1] : null;
      a.t = brazier ? 6 : 4;
      a.pose = brazier ? Pose.raise : Pose.idle;
      a.amt = 0.7;
      if (brazier) {
        a.yaw = Math.atan2(brazier.x - a.x, brazier.z - a.z);
        if (Math.abs(a.x - this.cam.x) + Math.abs(a.z - this.cam.z) < 160) {
          ctx.vfx.burst('fire', this.tmpV.set(brazier.x, CALDERA.y + 1.6, brazier.z), { count: 22, dir: CapitalLife.UP, speed: 4.5, spread: 0.3, size: 1.1, life: 0.9 });
        }
      }
    }
  }

  private updateForms(dt: number, ctx: GameContext, h: number): void {
    let drilling = 0;
    const night = h < 6 || h >= 21.5;
    for (const f of this.forms) {
      const on = f.hours.some(([a, b]) => h >= a && h < b) && !(f.kind === 'drill' && this.rally.on);
      const prevClock = f.clock;
      f.clock += dt;
      const near = Math.abs(f.x - this.cam.x) + Math.abs(f.z - this.cam.z) < 150;
      // Punch on the beat: every member at once, a flame from every fist.
      const beat = Math.floor(f.clock / f.period) !== Math.floor(prevClock / f.period);
      for (const i of f.members) {
        const a = this.agents[i];
        if (a.st !== 'post') continue;
        const hidden = night || (f.kind === 'academy' && !on && h >= LIFE.academy[1]);
        a.visible = !hidden;
        if (hidden) continue;
        if (on) {
          drilling++;
          const u = (f.clock % f.period) / f.period;
          a.pose = Pose.push;
          a.phase = Math.PI / 2 + (u - 0.12) * Math.PI * 2;
          a.amt = 1;
          if (beat && near && ctx.vfx) {
            const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
            ctx.vfx.burst('fire', this.tmpV.set(a.x + fx * 0.75, a.y + 1.3, a.z + fz * 0.75), { count: 7, dir: this.tmpD.set(fx, 0.08, fz), speed: 8, spread: 0.12, size: 0.55, life: 0.32 });
          }
        } else {
          a.pose = Pose.idle;
          a.amt = 1;
        }
      }
      if (on && beat && near) {
        ctx.audio.play('bend_fire_puff', { position: this.tmpV.set(f.x, f.y + 1.2, f.z), volume: 0.75 });
        if (f.kind === 'drill') ctx.audio.play('fnc_march', { position: this.tmpV.set(f.x, f.y, f.z), volume: 0.6 });
      }
    }
    this.stats.drilling = drilling;
  }

  /** Instructors, the rally's speaker and balcony guards, the herald on the dais. */
  private drawSpecials(h: number): void {
    const fig = this.figures;
    for (const f of this.forms) {
      const on = f.hours.some(([a, b]) => h >= a && h < b) && !(f.kind === 'drill' && this.rally.on);
      if (!on) continue;
      const pose = Math.floor(f.clock / f.period) % 4 === 0 ? Pose.talk : Pose.idle;
      if (f.kind === 'drill') fig.push(f.ix, f.iy, f.iz, f.iyaw, pose, f.clock, 1, 0, 0x3a1a16, 0x1a1616, SKIN[2], FAcc.skullBare, 1.03);
      else fig.push(f.ix, f.iy, f.iz, f.iyaw, pose, f.clock, 1, 0, 0x6a0f0f, 0x1a1414, SKIN[1], FAcc.topknot, 1.02);
    }
    const bal = this.marks.balcony;
    if (this.rally.speech && bal) {
      const since = this.elapsed - this.rally.cheer;
      const raise = since >= 0 && since < 2.2;
      fig.push(bal.x, bal.y, bal.z, 0, raise ? Pose.raise : Pose.talk, this.elapsed, raise ? 1 : 1, 0, 0x8a1a14, 0x1a1414, SKIN[1], FAcc.speaker, 1.08);
      for (const side of [-1, 1]) fig.push(bal.x + side * 2.6, bal.y, bal.z - 0.6, 0, Pose.idle, 0, 1, 0, 0x9a1a14, 0x2a1a14, SKIN[2], FAcc.bell, 1.04);
    }
    const dais = this.marks.proclamationDais;
    if (this.proclaim.speech && dais) {
      fig.push(dais.x, dais.y, dais.z + 0.8, 0, Pose.talk, this.elapsed, 1, 0, 0xb8892a, 0x2a1a14, SKIN[0], FAcc.flameCrown, 1.02);
    }
  }

  // ---------------------------------------------------------------------------
  // Shops, smoke, sound
  // ---------------------------------------------------------------------------

  private updateStalls(h: number): void {
    const closed = h >= LIFE.shops[1] || h < LIFE.shops[0] ? 1 : 0;
    if (closed === this.closed || !this.stalls) return;
    this.closed = closed;
    this.stalls.count = closed ? marketStalls.length : 0;
    if (!closed) return;
    marketStalls.forEach((st, i) => {
      this.tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, st.yaw);
      this.tmpV.set(st.x, st.y, st.z);
      this.tmpS.set(st.w + 0.3, 1.3, st.d * 0.85);
      this.stalls!.setMatrixAt(i, this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS));
    });
    this.stalls.instanceMatrix.needsUpdate = true;
  }

  /** Foundry stacks smoke (emitters only while the camera is within reach). */
  private updateSmoke(ctx: GameContext): void {
    if (this.frame % 15 !== 0) return;
    const want = foundryStacks.length > 0 && Math.hypot(this.cam.x - foundryStacks[0].x, this.cam.z - foundryStacks[0].z) < 700;
    if (want && !this.smoke.length) {
      for (let k = 0; k < foundryStacks.length; k += Math.max(1, Math.floor(foundryStacks.length / 8))) {
        const s = foundryStacks[k];
        const e = ctx.vfx.emitter('smoke', 2.2, { size: 3.2, speed: 1.6, color: '#3a3532', color2: '#77706a', life: 6, dir: this.tmpD.set(0.15, 1, 0.05).clone(), spread: 0.25 });
        e.position.set(s.x, s.y + 1, s.z);
        this.smoke.push(e);
      }
    } else if (!want && this.smoke.length) {
      for (const e of this.smoke) e.stop();
      this.smoke.length = 0;
    }
  }

  private startLoops(ctx: GameContext): void {
    for (const l of Object.values(this.loops)) l?.stop(0.2);
    this.loops.crowd = ctx.audio.loop('bss_crowd', { volume: 0 });
    const th = this.marks.throne;
    this.loops.crackle = th ? ctx.audio.loop('loop.fire.crackle', { volume: 0, position: new THREE.Vector3(th.x, th.y + 2, th.z - 3), range: 40 }) : null;
    this.loopGen = ctx.audio.ready ? ctx.audio.generation : -1;
  }

  private updateAudio(dt: number, ctx: GameContext, h: number): void {
    this.audioT -= dt;
    if (this.audioT > 0) return;
    this.audioT = 0.25;
    if (!ctx.session.active) return;
    if (ctx.audio.ready && this.loopGen !== ctx.audio.generation) this.startLoops(ctx);
    const pl = ctx.player?.position ?? this.cam;
    const rallyNear = this.rally.on && Math.hypot(pl.x - atAxis(0, 600).x, pl.z - atAxis(0, 600).z) < 120;
    this.loops.crowd?.setVolume(Math.min(1, this.nearCount / 22 + (rallyNear ? 0.6 : 0)) * 0.85);
    const th = this.marks.throne;
    this.loops.crackle?.setVolume(th && Math.hypot(pl.x - th.x, pl.z - th.z) < 45 && Math.abs(pl.y - th.y) < 10 ? 0.7 : 0);
    // The foundries' hammers, the volcano's rumble, marching squads.
    this.sfx.clang -= 0.25;
    if (this.sfx.clang <= 0 && foundryStacks.length) {
      this.sfx.clang = 0.8 + Math.random() * 2.2;
      const s = foundryStacks[Math.floor(Math.random() * foundryStacks.length)];
      if (Math.hypot(pl.x - s.x, pl.z - s.z) < 110) ctx.audio.play('fnc_clang', { position: this.tmpV.set(s.x + (Math.random() - 0.5) * 12, heightAt(s.x, s.z) + 2, s.z + (Math.random() - 0.5) * 12), volume: 0.8, pitch: 0.85 + Math.random() * 0.3 });
    }
    this.sfx.rumble -= 0.25;
    if (this.sfx.rumble <= 0) {
      this.sfx.rumble = 70 + Math.random() * 80;
      const r = Math.hypot(pl.x - V.x, pl.z - V.z);
      if (r < 700) ctx.audio.play('fnc_rumble', { volume: r < FNC.lipR ? 0.9 : 0.55 });
    }
    for (const q of this.squads) {
      const L = this.agents[q.members[0]];
      q.stepT -= 0.25;
      if (L.st === 'walk' && L.goal < 0 && q.stepT <= 0 && Math.hypot(pl.x - L.x, pl.z - L.z) < 45) {
        q.stepT = 0.5;
        ctx.audio.play('fnc_march', { position: this.tmpV.set(L.x, L.y, L.z), volume: 0.7 });
      }
    }
    void h;
  }

  /** Per-frame cost and counts for the debug overlay and tests. */
  counts(): Record<string, number> {
    return { ...this.stats };
  }

  onSessionEnd(): void {
    for (const l of Object.values(this.loops)) l?.stop(0.4);
    this.loops = { crowd: null, crackle: null };
    this.loopGen = -1;
  }

  dispose(): void {
    this.onSessionEnd();
    for (const e of this.smoke) e.stop();
    this.smoke.length = 0;
    this.figures.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.stalls?.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

/** NavTag bit number (pois index). */
function b(tag: number): number {
  return Math.round(Math.log2(tag));
}


function POINTS_EAST(): P2 {
  return atPolar(-4.6, 340);
}
