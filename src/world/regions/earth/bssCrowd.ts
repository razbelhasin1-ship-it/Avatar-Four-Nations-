import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { kitMaterial } from '../../kit/Materials';
import type { Collider, CollisionWorld } from '../../Collision';
import type { P2 } from '../../WorldLayout';
import { BSS, C, CROWD, GATES, GATE_DEPTH, GROUND, R, hash01 } from './bssLayout';
import { Acc, Pose, type FigureRenderer } from './bssFigures';
import { insideLaogai } from './bssLaogai';
import { NavTag, type NavGraph } from './bssNav';

/**
 * Ba Sing Se crowds: a few hundred people simulated on the walking graph and
 * drawn by the instanced FigureRenderer. Each person belongs to a district
 * (clothing by class), has a role (walker, shopper, sitter, vendor with a cart
 * or shoulder pole, porter, sweeper, farmer, courtier, zoo keeper, Dai Li
 * agent, gate guard, wall soldier) and follows the day: out at dawn, busiest
 * by day, tea houses at dusk, home at night — except the Dai Li, who own the
 * night at Lake Laogai. People queue at counters, haggle at stalls, step aside
 * for the player and turn to greet them. Shops roll their shutters down and
 * stalls are covered at night. District ambience: crowd murmur, vendor calls,
 * train rumble, farm animals and birds, the hum of Lake Laogai.
 */

type Zone = 'lower' | 'middle' | 'upper' | 'palace' | 'farm' | 'laogai';
const ZONES: Zone[] = ['lower', 'middle', 'upper', 'palace', 'farm', 'laogai'];
type Role = 'walker' | 'shopper' | 'sitter' | 'vendor' | 'porter' | 'sweeper' | 'farmer' | 'courtier' | 'keeper' | 'daili' | 'guard' | 'soldier' | 'seller';

const ROLES: Record<Zone, Array<[Role, number]>> = {
  lower: [['walker', 40], ['shopper', 20], ['sitter', 10], ['vendor', 10], ['porter', 12], ['sweeper', 6]],
  middle: [['walker', 42], ['shopper', 26], ['sitter', 18], ['vendor', 5], ['porter', 5], ['sweeper', 4]],
  upper: [['walker', 50], ['sitter', 22], ['daili', 28]],
  palace: [['courtier', 1]],
  farm: [['farmer', 70], ['walker', 18], ['porter', 8], ['keeper', 4]],
  laogai: [['daili', 1]],
};

/**
 * People kept out and about within BUBBLE_R of the camera, by its district (times the hour's share):
 * the Lower Ring packed, the Middle busy, the Upper sparse, the farms scattered. People far out of
 * sight are moved into nearby streets the camera is not looking at.
 */
const BUBBLE_R = 80;
const BUBBLE_TARGET: Partial<Record<Zone, number>> = { lower: 200, middle: 90, upper: 16, farm: 18 };
const RND = (_j: number): number => Math.random();
const CELL = 32;
const DOOR = NavTag.home | NavTag.shop | NavTag.tea | NavTag.work | NavTag.station;
const cellKey = (x: number, z: number): number => (Math.floor(x / CELL) + 1024) * 4096 + Math.floor(z / CELL) + 1024;

const PAL: Record<string, { robes: number[]; pants: number[]; acc: number[] }> = {
  lower: { robes: [0x7a5a3a, 0x6b4f33, 0x8a7a5a, 0x5e6b3e, 0x4f5f38, 0xd8cdb4, 0xc9bb9a, 0x8c6d4a], pants: [0x4a3a2a, 0x3d3226, 0x5a4a36, 0x585040], acc: [Acc.none, Acc.none, Acc.strawHat, Acc.topknot] },
  middle: { robes: [0x3f7a4a, 0x6aa06a, 0xc8a24a, 0x8a3a3a, 0x3a5a8a, 0xd8cdb4, 0x9a6a3a, 0x5a8a7a, 0xb85a4a], pants: [0x3a3a3a, 0x4a3a2a, 0x2e4a3a], acc: [Acc.none, Acc.topknot, Acc.parasol, Acc.scholarCap] },
  upper: { robes: [0x2f5f8a, 0x3f8a8a, 0x2a7a7a, 0x6b4a2a, 0xc8a038, 0x1f4f6f], pants: [0x2a2a3a, 0x3a2a1a], acc: [Acc.parasol, Acc.topknot, Acc.scholarCap] },
  palace: { robes: [0x2a6a4a, 0xc8a038, 0x3a7a5a, 0x6a2a2a], pants: [0x2a2a2a], acc: [Acc.scholarCap, Acc.topknot] },
  farm: { robes: [0x8a7a5a, 0x6b5a3a, 0x7a8a5a, 0xc9bb9a, 0x5e6b3e], pants: [0x4a3a2a, 0x5a4a36], acc: [Acc.strawHat, Acc.strawHat, Acc.none] },
};
const SKIN = [0xf1c9a5, 0xe0b48e, 0xc99a72, 0xa87850, 0x8a5e3c];
const DAILI = { robe: 0x1f3a26, pants: 0x162a1c };
const GUARD = { robe: 0x24432c, pants: 0x1a2a1e };

interface Agent {
  zone: Zone;
  role: Role;
  robe: number;
  pants: number;
  skin: number;
  acc: number;
  scale: number;
  speed: number;
  /** Rank against the zone's share of people out at this hour (stays in when above it). */
  stay: number;
  node: number;
  path: number[];
  pi: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Facing at a post (shop keepers turn back to it). */
  baseYaw: number;
  lane: number;
  dodge: number;
  state: 'walk' | 'act' | 'home' | 'post';
  t: number;
  pose: number;
  phase: number;
  out: boolean;
  /** Node whose queue slot this agent holds (−1 none). */
  held: number;
  greet: number;
  callT: number;
}

function activity(zone: Zone, h: number): number {
  const day = h >= 7 && h < 18, dusk = h >= 18 && h < 22, dawn = h >= 5 && h < 7;
  switch (zone) {
    case 'laogai':
      return day ? 0.35 : 1;
    case 'farm':
      return day ? 1 : dawn ? 0.6 : dusk ? 0.35 : 0.05;
    case 'upper':
    case 'palace':
      return day ? 1 : dusk ? 0.6 : dawn ? 0.4 : 0.12;
    default:
      return day ? 1 : dusk ? 0.8 : dawn ? 0.5 : 0.2;
  }
}

type Tags = Array<[number, number]>;
const T = NavTag;
const SHOPPER: Tags[] = [false, true].map((dusk): Tags => [[T.shop, 4], [T.stall, 4], [T.tea, dusk ? 3 : 1], [T.square, 1]]);
const WALKER: Tags[] = [0, 1, 2, 3].map((k): Tags => [[T.shop, 2], [T.stall, 3], [T.square, 3], [T.tea, k & 2 ? 3 : 1], [T.bench, 1], [T.water, 1], [T.school, 1], [T.station, 1], [T.home, k & 1 ? 3 : 1]]);
const FARMER: Tags[] = [false, true].map((late): Tags => [[T.field, 6], [T.home, late ? 4 : 1], [T.work, 1]]);
const DEST: Partial<Record<Role, Tags>> = {
  sitter: [[T.tea, 3], [T.bench, 3], [T.water, 1]],
  vendor: [[T.square, 3], [T.stall, 2], [T.street, 3]],
  porter: [[T.work, 3], [T.shop, 2], [T.station, 2], [T.street, 1]],
  sweeper: [[T.shop, 5], [T.home, 1]],
  courtier: [[T.palace, 1]],
  keeper: [[T.work, 2], [T.bench, 1]],
  daili: [[T.patrol, 3], [T.street, 1]],
};
const HOME: Tags = [[T.home, 1]];
const STROLL: Tags = [[T.street, 2], [T.square, 1], [T.station, 1]];

/** Destination tags per role (weights), varied by hour where it matters (no allocation). */
function destTags(role: Role, h: number): Tags {
  const dusk = h >= 17 && h < 22;
  if (role === 'shopper') return SHOPPER[dusk ? 1 : 0];
  if (role === 'farmer') return FARMER[h > 16 ? 1 : 0];
  return DEST[role] ?? WALKER[(dusk ? 2 : 0) + (h > 19 ? 1 : 0)];
}

function person(x: number, y: number, z: number, yaw: number): Agent {
  return {
    zone: 'lower', role: 'walker', robe: 0, pants: 0, skin: SKIN[0], acc: Acc.none, scale: 1, speed: 1, stay: 0, node: -1, path: [], pi: 0,
    x, y, z, yaw, baseYaw: yaw, lane: 0, dodge: 0, state: 'act', t: 0, pose: Pose.idle, phase: 0, out: true, held: -1, greet: 0, callT: 0,
  };
}

/** Role, clothes and gait for a person of this district (u: a 0..1 value per channel). */
function dress(a: Agent, zone: Zone, u: (j: number) => number): void {
  const roles = ROLES[zone];
  let total = 0;
  for (const [, w] of roles) total += w;
  let x = u(1) * total;
  let role: Role = roles[0][0];
  for (const [r, w] of roles) {
    x -= w;
    if (x <= 0) {
      role = r;
      break;
    }
  }
  const pal = PAL[zone === 'laogai' ? 'farm' : zone];
  a.zone = zone;
  a.role = role;
  a.robe = pal.robes[Math.floor(u(2) * pal.robes.length)];
  a.pants = pal.pants[Math.floor(u(3) * pal.pants.length)];
  a.acc = pal.acc[Math.floor(u(4) * pal.acc.length)];
  if (role === 'daili') {
    a.robe = DAILI.robe;
    a.pants = DAILI.pants;
    a.acc = Acc.daiLiHat;
  } else if (role === 'vendor') a.acc = u(5) < 0.5 ? Acc.cart : Acc.pole;
  else if (role === 'porter') a.acc = u(5) < 0.6 ? Acc.crate : Acc.bundle;
  else if (role === 'farmer') a.acc = Acc.strawHat;
  a.skin = SKIN[Math.floor(u(7) * SKIN.length)];
  a.scale = 0.92 + u(8) * 0.16;
  a.speed = role === 'vendor' ? 0.85 : role === 'porter' ? 1.0 : role === 'daili' ? 1.25 : 1.05 + u(9) * 0.45;
}

/** Horizontal distance from (x, z) to a collider's footprint (0 inside it). */
function footDist(c: Collider, x: number, z: number): number {
  if (c.shape === 'box') {
    const dx = x - c.x, dz = z - c.z;
    const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
    return Math.hypot(Math.max(0, Math.abs(lx) - c.hx), Math.max(0, Math.abs(lz) - c.hz));
  }
  return Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
}

/** Architecture a body standing at height y would pass through: solid, static, broader than a post, between knee and head. */
function blocks(c: Collider, y: number): boolean {
  if (!c.solid || c.dynamic || c.br < 0.5) return false;
  const top = c.shape === 'sphere' ? c.y + c.r : c.y + c.hy;
  return top >= y + (c.walkable ? 0.6 : 0.3) && c.y - c.hy <= y + 1.7;
}

/** Does segment ab cross segment cd? */
function crosses(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export interface CrowdShop {
  x: number;
  z: number;
  yaw: number;
  w: number;
  off: number;
}

export interface CrowdStall {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
}

export class CrowdSystem {
  readonly agents: Agent[] = [];
  readonly group = new THREE.Group();
  private nodeY: Float32Array | null = null;
  /** Free width along each link (m, capped; key min·n + max): a walker's lane offset stays inside it. */
  private readonly free = new Map<number, number>();
  private col: CollisionWorld | null = null;
  private comp: Int32Array | null = null;
  private pools = new Map<Zone, Map<number, number[]>>();
  private zoneNodes = new Map<Zone, number[]>();
  /** Per zone: its nodes bucketed in CELL-metre squares (for picking spots around the camera). */
  private grids = new Map<Zone, Map<number, number[]>>();
  /** Grid cells around the camera (reused; rebuilt when the camera changes cell). */
  private readonly near: number[][] = [];
  /** Nodes around the camera by tag bit (reused). */
  private readonly localTag = new Map<number, number[]>();
  private nearKey = -1;
  private readonly prev: Int32Array<ArrayBuffer>;
  private readonly tmpPath: number[] = [];
  private readonly occ = new Map<number, number>();
  private ctx: GameContext | null = null;
  private loops: { crowd: LoopHandle | null; hum: LoopHandle | null; rumble: LoopHandle | null } = { crowd: null, hum: null, rumble: null };
  private audioT = 0;
  /** Audio graph generation the loops were made on (-1: made while audio was locked). */
  private loopGen = -1;
  private nearCount = 0;
  private sfxT = 3;
  private frame = 0;
  private shutters: THREE.InstancedMesh | null = null;
  private tarps: THREE.InstancedMesh | null = null;
  private closed = -1;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private density = 1;
  private offSettings: (() => void) | null = null;
  /** People the camera's district still wants around it (from last frame's count). */
  private deficit = 0;
  /** District around the camera this frame (null: none keeps a crowd there). */
  private bz: Zone | null = null;
  private callCool = 0;
  /** Recent relocation spots (x, z pairs), so newcomers do not arrive in clumps. */
  private readonly recent = new Float32Array(48);
  private recentI = 0;
  readonly stats = { total: 0, out: 0, near: 0, local: 0, sellers: 0, moved: 0, ms: 0, paths: 0, cut: 0, relinked: 0 };
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();

  constructor(
    parent: THREE.Group,
    private readonly nav: NavGraph,
    private readonly figures: FigureRenderer,
    private readonly shops: CrowdShop[],
    private readonly stalls: CrowdStall[],
    private readonly trains: () => Array<{ moving: boolean; x: number; z: number }>,
    /** Lines nobody in the crowd walks across (gate slabs, the concealed door of Lake Laogai). */
    private readonly barriers: () => Array<[P2, P2]>,
  ) {
    this.group.name = 'bss_crowd_props';
    parent.add(this.group);
    this.prev = new Int32Array(new ArrayBuffer(nav.nodes.length * 4));
    // Rolling shutters over shop fronts and tarps over stalls, shown at night.
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    this.geos.push(box);
    const sh = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 0.9, map: (kitMaterial('wood_dark') as THREE.MeshStandardMaterial).map ?? null });
    const tp = new THREE.MeshStandardMaterial({ color: '#8d7d63', roughness: 1 });
    this.mats.push(sh, tp);
    this.shutters = new THREE.InstancedMesh(box, sh, Math.max(1, shops.length));
    this.tarps = new THREE.InstancedMesh(box, tp, Math.max(1, stalls.length));
    for (const m of [this.shutters, this.tarps]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      this.group.add(m);
    }
  }

  // ---------------------------------------------------------------------------
  // Set-up
  // ---------------------------------------------------------------------------

  private zoneOf(i: number): Zone | null {
    const n = this.nav.nodes[i];
    if (n.tags & NavTag.palace) return 'palace';
    if (n.tags & NavTag.upper) return 'upper';
    if (n.tags & NavTag.middle) return 'middle';
    if (n.tags & NavTag.lower) return 'lower';
    if (n.tags & NavTag.patrol && n.tags & NavTag.farm) return 'laogai';
    if (n.tags & NavTag.farm) return 'farm';
    return null;
  }

  private prepare(ctx: GameContext): void {
    if (this.nodeY) return;
    const N = this.nav.nodes;
    this.nodeY = new Float32Array(N.length);
    for (let i = 0; i < N.length; i++) this.nodeY[i] = ctx.world.groundAt(N[i].x, N[i].z, GROUND + 8).y;
    this.col = ctx.world.collision;
    this.sanitize();
    // Connected components; each zone walks in the component holding most of its nodes.
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
    const byZone = new Map<Zone, number[]>();
    for (let i = 0; i < N.length; i++) {
      const z = this.zoneOf(i);
      if (!z) continue;
      let l = byZone.get(z);
      if (!l) byZone.set(z, (l = []));
      l.push(i);
    }
    for (const [z, list] of byZone) {
      const count = new Map<number, number>();
      for (const i of list) count.set(this.comp[i], (count.get(this.comp[i]) ?? 0) + 1);
      let best = -1, bc = -1;
      for (const [k, v] of count) if (v > bc) {
        bc = v;
        best = k;
      }
      const keep = list.filter((i) => this.comp![i] === best);
      this.zoneNodes.set(z, keep);
      // Spots around the camera may lie on any sizeable piece of the graph (the farm is cut up by
      // canals and tracks); people placed there keep to that piece.
      const grid = new Map<number, number[]>();
      for (const i of list) {
        if ((size.get(this.comp![i]) ?? 0) < 8) continue;
        const key = cellKey(N[i].x, N[i].z);
        let l = grid.get(key);
        if (!l) grid.set(key, (l = []));
        l.push(i);
      }
      this.grids.set(z, grid);
      const tags = new Map<number, number[]>();
      for (let b = 0; b < 20; b++) {
        const bit = 1 << b;
        const l = keep.filter((i) => N[i].tags & bit);
        if (l.length) tags.set(bit, l);
      }
      this.pools.set(z, tags);
    }
  }

  /**
   * Keep the walking graph out of the architecture: links across a gate slab or through solid
   * buildings, stalls and counters are dropped, a spot left stranded joins the nearest street it can
   * reach in a straight line, and each link's free width is measured for the lane offsets.
   */
  private sanitize(): void {
    const N = this.nav.nodes;
    const bars = this.barriers();
    for (let i = 0; i < N.length; i++) {
      for (let k = N[i].edges.length - 1; k >= 0; k--) {
        const j = N[i].edges[k];
        if (j < i) continue;
        if (bars.some(([c, d]) => crosses(N[i], N[j], c, d)) || !this.clearLine(i, j)) {
          this.nav.unlink(i, j);
          this.stats.cut++;
        }
      }
    }
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      if (n.edges.length || n.tags & NavTag.street) continue;
      for (const s of this.nav.around(n.x, n.z, 16, NavTag.street)) {
        if (!bars.some(([c, d]) => crosses(n, N[s], c, d)) && this.clearLine(i, s)) {
          this.nav.link(i, s);
          this.stats.relinked++;
          break;
        }
      }
    }
    const Y = this.nodeY!;
    this.free.clear();
    for (let i = 0; i < N.length; i++) {
      for (const j of N[i].edges) {
        if (j < i) continue;
        const a = N[i], b = N[j];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.5));
        let c = 3.5;
        for (let k = 0; k <= n; k++) c = Math.min(c, this.freeAt(a.x + ((b.x - a.x) * k) / n, Y[i] + ((Y[j] - Y[i]) * k) / n, a.z + ((b.z - a.z) * k) / n));
        this.free.set(i * N.length + j, c);
      }
    }
  }

  /** Free width along the link between two nodes (0 if unknown). */
  private freeOf(i: number, j: number): number {
    const n = this.nav.nodes.length;
    return this.free.get(i < j ? i * n + j : j * n + i) ?? 0;
  }

  /** The nearest spot to (x, z) where a person stands clear of the architecture (on whatever floor is there). */
  private standAt(x: number, z: number): { x: number; y: number; z: number } {
    const floor = (px: number, pz: number) => this.ctx?.world.groundAt(px, pz, GROUND + 8).y ?? GROUND;
    for (let r = 0; r <= 4; r += 0.5) {
      for (let k = 0; k < (r ? 8 : 1); k++) {
        const px = x + Math.cos((k * Math.PI) / 4) * r, pz = z + Math.sin((k * Math.PI) / 4) * r;
        const py = floor(px, pz);
        if (!this.solidAt(px, py, pz, 0.35)) return { x: px, y: py, z: pz };
      }
    }
    return { x, y: floor(x, z), z };
  }

  /** A straight walk between two nodes stays out of the architecture (spots may stand against a counter or door). */
  private clearLine(i: number, j: number): boolean {
    const N = this.nav.nodes, Y = this.nodeY!;
    const a = N[i], b = N[j];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(L / 0.5));
    const ea = a.tags & NavTag.street ? 0 : 0.7, eb = b.tags & NavTag.street ? 0 : 0.7;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (t * L < ea || (1 - t) * L < eb) continue;
      if (this.solidAt(a.x + (b.x - a.x) * t, Y[i] + (Y[j] - Y[i]) * t, a.z + (b.z - a.z) * t, 0.2)) return false;
    }
    return true;
  }

  /** Is there architecture within `pad` of a body standing at (x, y, z)? */
  private solidAt(x: number, y: number, z: number, pad: number): boolean {
    let hit = false;
    this.col?.query(x, z, pad, (c) => {
      if (!hit && blocks(c, y) && footDist(c, x, z) < pad) hit = true;
    });
    return hit;
  }

  /** Distance from (x, y, z) to the nearest architecture, capped at 3.5 m. */
  private freeAt(x: number, y: number, z: number): number {
    let d = 3.5;
    this.col?.query(x, z, 3.5, (c) => {
      if (blocks(c, y)) d = Math.min(d, footDist(c, x, z));
    });
    return d;
  }

  private spawn(): void {
    this.agents.length = 0;
    const d = this.density;
    let k = 0;
    const add = (zone: Zone, n: number) => {
      const nodes = this.zoneNodes.get(zone);
      if (!nodes?.length) return;
      for (let i = 0; i < Math.round(n * d); i++) {
        k++;
        const u = (j: number) => hash01(k, 1700 + j);
        const node = nodes[Math.floor(u(6) * nodes.length)];
        const nn = this.nav.nodes[node];
        const a = person(nn.x, this.nodeY![node], nn.z, u(11) * Math.PI * 2);
        dress(a, zone, u);
        a.stay = u(10);
        a.node = node;
        a.lane = (u(12) - 0.5) * 2.6;
        a.t = u(13) * 8;
        a.phase = u(14) * 10;
        a.callT = 4 + u(15) * 8;
        this.agents.push(a);
      }
    };
    add('lower', CROWD.lower);
    add('middle', CROWD.middle);
    add('upper', CROWD.upper);
    add('palace', 10);
    add('farm', CROWD.farm);
    add('laogai', CROWD.laogai);
    this.posts();
    const before = this.agents.length;
    this.sellers();
    this.stats.sellers = this.agents.length - before;
    this.stats.total = this.agents.length;
  }

  /** Stall keepers behind every counter and shopkeepers at every other shop front, out while the shops are open. */
  private sellers(): void {
    let k = 0;
    const put = (x: number, z: number, yaw: number) => {
      k++;
      const u = (j: number) => hash01(k, 1900 + j);
      const zone: Zone = Math.hypot(x - C.x, z - C.z) < R.middle ? 'middle' : 'lower';
      const pal = PAL[zone];
      const a = person(x, this.ctx?.world.groundAt(x, z, GROUND + 1).y ?? GROUND, z, yaw);
      a.zone = zone;
      a.role = 'seller';
      a.state = 'post';
      a.robe = pal.robes[Math.floor(u(1) * pal.robes.length)];
      a.pants = pal.pants[Math.floor(u(2) * pal.pants.length)];
      a.skin = SKIN[Math.floor(u(3) * SKIN.length)];
      a.acc = u(4) < 0.35 ? Acc.topknot : Acc.none;
      a.scale = 0.93 + u(5) * 0.12;
      a.speed = 0;
      a.t = u(6) * 5;
      a.phase = u(7) * 10;
      this.agents.push(a);
    };
    for (const s of this.stalls) {
      const back = s.d * 0.25 - 0.8;
      put(s.x + Math.sin(s.yaw) * back, s.z + Math.cos(s.yaw) * back, s.yaw);
    }
    this.shops.forEach((s, i) => {
      if (i % 2) return;
      const o = s.off - 0.55;
      put(s.x - Math.sin(s.yaw) * o, s.z - Math.cos(s.yaw) * o, s.yaw);
    });
  }

  /** Royal Earthbender Guards at the ring and palace gates, wall soldiers at the Outer and Inner Walls. */
  private posts(): void {
    let k = 0;
    const put = (x: number, z: number, yaw: number, soldier: boolean) => {
      k++;
      // On the floor that is there (the palace stair guards stand on the top tier), clear of piers.
      const p = this.standAt(x, z);
      const a = person(p.x, p.y, p.z, yaw);
      a.role = soldier ? 'soldier' : 'guard';
      a.robe = soldier ? (k % 2 ? 0x1e1e1e : 0xc9a227) : GUARD.robe;
      a.pants = soldier ? 0x1a1a1a : GUARD.pants;
      a.skin = SKIN[k % SKIN.length];
      a.acc = soldier ? Acc.soldierHelm : Acc.guardHelm;
      a.scale = 1.04;
      a.speed = 0;
      a.state = 'post';
      a.t = hash01(k, 1801) * 6;
      a.phase = hash01(k, 1802) * 10;
      this.agents.push(a);
    };
    for (const g of GATES) {
      const soldier = g.wall === 'outer' || g.wall === 'inner';
      // In front of the gate block's faces (its trim stands 0.4 m proud), not inside the masonry.
      const off = GATE_DEPTH[g.wall] / 2 + 1.2;
      const ox = Math.cos(g.theta), oz = Math.sin(g.theta), tx = -Math.sin(g.theta), tz = Math.cos(g.theta);
      const yaw = Math.atan2(ox, oz);
      for (const side of [-1, 1]) {
        const lat = side * (g.width / 2 + 0.9);
        put(C.x + ox * (g.r - off) + tx * lat, C.z + oz * (g.r - off) + tz * lat, yaw, soldier);
        if (g.main) put(C.x + ox * (g.r + off) + tx * lat, C.z + oz * (g.r + off) + tz * lat, yaw + Math.PI, soldier);
      }
    }
    // Guards at the top of the throne hall stairs.
    const top = BSS.palace.tiers[2];
    for (const lx of [-6.2, 6.2, -9.5, 9.5]) put(C.x + lx, C.z + top.z1 - 1.2, 0, false);
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  onSessionStart(ctx: GameContext): void {
    this.ctx = ctx;
    this.prepare(ctx);
    const g = ctx.settings.data.graphics;
    this.density = Math.max(0.8, Math.min(1.05, 0.75 + 0.25 * g.foliageDensity));
    this.spawn();
    this.occ.clear();
    this.deficit = 0;
    this.recent.fill(1e9);
    this.nearKey = -1;
    this.closed = -1;
    this.offSettings = ctx.events.on('settings:changed', () => {
      const d = Math.max(0.8, Math.min(1.05, 0.75 + 0.25 * ctx.settings.data.graphics.foliageDensity));
      if (Math.abs(d - this.density) > 0.01) {
        this.density = d;
        this.spawn();
      }
    });
    this.startLoops(ctx);
  }

  /** District loops; re-made when audio unlocks after the session started or the audio graph is rebuilt. */
  private startLoops(ctx: GameContext): void {
    for (const l of Object.values(this.loops)) l?.stop(0.2);
    this.loops.crowd = ctx.audio.loop('bss_crowd', { volume: 0 });
    this.loops.hum = ctx.audio.loop('bss_laogai_hum', { volume: 0 });
    this.loops.rumble = ctx.audio.loop('bss_train_rumble', { volume: 0, position: new THREE.Vector3(C.x, GROUND, C.z), range: 90 });
    this.loopGen = ctx.audio.ready ? ctx.audio.generation : -1;
  }

  onSessionEnd(): void {
    for (const l of Object.values(this.loops)) l?.stop(0.5);
    this.loops = { crowd: null, hum: null, rumble: null };
    this.offSettings?.();
    this.offSettings = null;
    this.ctx = null;
  }

  // ---------------------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------------------

  private pickDest(a: Agent, h: number, opts: Tags = destTags(a.role, h)): number {
    // Around the camera people mostly keep to the neighbourhood, so busy streets stay busy.
    if (a.zone === this.bz && this.near.length && Math.random() < 0.65) {
      let total = 0;
      for (const [bit, w] of opts) if (this.localTag.get(bit)?.length) total += w;
      for (let attempt = 0; total > 0 && attempt < 4; attempt++) {
        let x = Math.random() * total;
        for (const [bit, w] of opts) {
          const l = this.localTag.get(bit);
          if (!l?.length) continue;
          x -= w;
          if (x > 0) continue;
          const i = l[Math.floor(Math.random() * l.length)];
          const n = this.nav.nodes[i];
          if (i !== a.node && this.comp![i] === this.comp![a.node] && Math.hypot(n.x - a.x, n.z - a.z) > 10) return i;
          break;
        }
      }
    }
    const pool = this.pools.get(a.zone);
    if (!pool) return -1;
    let total = 0;
    for (const [bit, w] of opts) if (pool.get(bit)) total += w;
    if (total <= 0) return -1;
    for (let attempt = 0; attempt < 8; attempt++) {
      let x = Math.random() * total;
      let list: number[] | undefined;
      for (const [bit, w] of opts) {
        const l = pool.get(bit);
        if (!l) continue;
        x -= w;
        if (x <= 0) {
          list = l;
          break;
        }
      }
      if (!list) continue;
      const i = list[Math.floor(Math.random() * list.length)];
      const n = this.nav.nodes[i];
      const d = Math.hypot(n.x - a.x, n.z - a.z);
      if (i !== a.node && d > 10 && d < 190 && (a.node < 0 || this.comp![i] === this.comp![a.node])) return i;
    }
    return -1;
  }

  private release(a: Agent): void {
    if (a.held >= 0) {
      this.occ.set(a.held, Math.max(0, (this.occ.get(a.held) ?? 1) - 1));
      a.held = -1;
    }
  }

  private decide(a: Agent, h: number): void {
    this.release(a);
    if (a.stay > activity(a.zone, h)) {
      // Time to go in: walk to a door if anyone can see, otherwise just be gone.
      const dest = a.node >= 0 && this.figures.visible(a.x, a.y, a.z) ? this.pickDest(a, h, HOME) : -1;
      if (dest >= 0 && this.walkTo(a, dest)) return;
      a.state = 'home';
      a.out = false;
      a.t = 25 + Math.random() * 50;
      return;
    }
    let dest = this.pickDest(a, h);
    // Nothing of the role's kind within reach (a cut-off corner of the farmland): just stroll.
    if (dest < 0 && a.node >= 0) dest = this.pickDest(a, h, STROLL);
    if (dest < 0 || a.node < 0) {
      a.state = 'act';
      a.t = 4 + Math.random() * 6;
      a.pose = Pose.idle;
      return;
    }
    if (!this.walkTo(a, dest)) {
      a.state = 'act';
      a.t = 3;
    }
  }

  private walkTo(a: Agent, dest: number): boolean {
    this.stats.paths++;
    const p = this.nav.path(a.node, dest, this.tmpPath, this.prev);
    if (!p || p.length < 2) return false;
    a.path.length = 0;
    for (const i of p) a.path.push(i);
    a.pi = 1;
    a.state = 'walk';
    return true;
  }

  /** Which district's crowd surrounds the camera (none at the palace or by Lake Laogai, whose people stay put). */
  private zoneAt(x: number, z: number): Zone | null {
    const r = Math.hypot(x - C.x, z - C.z);
    if (r < R.palace) return null;
    if (r < R.upper) return 'upper';
    if (r < R.middle) return 'middle';
    if (r < R.inner) return 'lower';
    if (r < R.outer && Math.hypot(x - BSS.lake.x, z - BSS.lake.z) > 130) return 'farm';
    return null;
  }

  /** The zone's grid cells within the bubble around the camera. */
  private gatherCells(zone: Zone, cam: THREE.Vector3): void {
    const key = cellKey(cam.x, cam.z) * 8 + ZONES.indexOf(zone);
    if (key === this.nearKey) return;
    this.nearKey = key;
    this.near.length = 0;
    for (const l of this.localTag.values()) l.length = 0;
    const grid = this.grids.get(zone);
    if (!grid) return;
    const r = Math.ceil(BUBBLE_R / CELL);
    const cx = Math.floor(cam.x / CELL), cz = Math.floor(cam.z / CELL);
    const N = this.nav.nodes;
    for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
      const l = grid.get(cellKey(i * CELL, j * CELL));
      if (!l) continue;
      this.near.push(l);
      for (const k of l) for (let b = 0; b < 20; b++) {
        const bit = 1 << b;
        if (!(N[k].tags & bit)) continue;
        let t = this.localTag.get(bit);
        if (!t) this.localTag.set(bit, (t = []));
        t.push(k);
      }
    }
  }

  /** Far enough away, or off screen beyond the bubble: free to be moved without anyone noticing. */
  private unseen(a: Agent, cam: THREE.Vector3): boolean {
    const d2 = (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2;
    return d2 > 250 * 250 || (d2 > 130 * 130 && !this.figures.inView(a.x, a.y, a.z));
  }

  /** Move a far-off person into nearby streets the camera is not looking at, dressed for that district. */
  private relocate(a: Agent, zone: Zone, cam: THREE.Vector3, h: number): boolean {
    if (!this.near.length || !this.nodeY) return false;
    for (let k = 0; k < 12; k++) {
      const nodes = this.near[Math.floor(Math.random() * this.near.length)];
      const i = nodes[Math.floor(Math.random() * nodes.length)];
      const n = this.nav.nodes[i];
      const d2 = (n.x - cam.x) ** 2 + (n.z - cam.z) ** 2;
      if (d2 > BUBBLE_R * BUBBLE_R || d2 < 18 * 18) continue;
      const y = this.nodeY[i];
      // In sight only from a doorway, as if stepping out of a house, shop or station.
      if (d2 < 74 * 74 && this.figures.inView(n.x, y, n.z) && !(n.tags & DOOR)) continue;
      let crowded = false;
      for (let r = 0; r < this.recent.length && !crowded; r += 2) crowded = (this.recent[r] - n.x) ** 2 + (this.recent[r + 1] - n.z) ** 2 < 49;
      if (crowded) continue;
      this.recent[this.recentI] = n.x;
      this.recent[this.recentI + 1] = n.z;
      this.recentI = (this.recentI + 2) % this.recent.length;
      this.release(a);
      dress(a, zone, RND);
      const act = activity(zone, h);
      if (a.stay > act) a.stay = Math.random() * act;
      a.node = i;
      a.x = n.x;
      a.y = y;
      a.z = n.z;
      a.path.length = 0;
      a.pi = 0;
      a.state = 'act';
      a.pose = Pose.idle;
      a.t = 0.3 + Math.random() * 2;
      a.out = true;
      a.dodge = 0;
      a.greet = 0;
      a.lane = (Math.random() - 0.5) * 2.6;
      this.stats.moved++;
      return true;
    }
    return false;
  }

  /** Shop and stall keepers: out while open, sweep the front at dawn, haggle, arrange goods, greet the player. */
  private tendShop(a: Agent, step: number, ctx: GameContext, pl: THREE.Vector3 | undefined, h: number, full: boolean): void {
    a.out = h >= 6 && h < 21;
    if (!a.out) return;
    a.t -= step;
    if (a.greet > 0) a.greet -= step;
    if (pl && a.greet <= 0 && (pl.x - a.x) ** 2 + (pl.z - a.z) ** 2 < 12) {
      a.yaw = Math.atan2(pl.x - a.x, pl.z - a.z);
      a.pose = Pose.talk;
      a.greet = 5;
      a.t = 4;
      return;
    }
    if (a.t > 0) return;
    a.t = 3 + Math.random() * 7;
    a.yaw = a.baseYaw + (Math.random() - 0.5) * 0.6;
    const r = Math.random();
    a.pose = h < 7.5 && r < 0.7 ? Pose.sweep : r < 0.45 ? Pose.talk : r < 0.75 ? Pose.idle : Pose.work;
    if (a.pose === Pose.talk && full && pl && Math.random() < 0.35) this.call(a, ctx, pl);
  }

  /** A hawking call, rate-limited so a market never turns into a din. */
  private call(a: Agent, ctx: GameContext, pl: THREE.Vector3): void {
    if (this.callCool > 0 || Math.hypot(pl.x - a.x, pl.z - a.z) > 24) return;
    this.callCool = 2.2 + Math.random() * 3;
    ctx.audio.play('amb.vendor', { position: this.tmpP.set(a.x, a.y + 1.6, a.z), volume: 0.8, pitch: 0.9 + Math.random() * 0.25 });
  }

  /** Arrived at the end of a path: choose what to do there by the place's tags. */
  private arrive(a: Agent, h: number): void {
    const n = this.nav.nodes[a.node];
    const T = n.tags;
    a.state = 'act';
    a.yaw = n.yaw;
    // Queue behind whoever already holds this spot.
    const q = this.occ.get(a.node) ?? 0;
    if (T & (NavTag.shop | NavTag.stall | NavTag.station | NavTag.tea | NavTag.bench | NavTag.work | NavTag.field)) {
      this.occ.set(a.node, q + 1);
      a.held = a.node;
      if (q > 0 && T & (NavTag.shop | NavTag.stall | NavTag.station)) {
        // Behind whoever holds the spot or, with a wall or counter there, beside them.
        const sx = Math.sin(n.yaw), sz = Math.cos(n.yaw), d = 1.05 * q;
        for (let o = 0; o < 3; o++) {
          const ox = (o === 0 ? -sx : o === 1 ? sz : -sz) * d, oz = (o === 0 ? -sz : o === 1 ? -sx : sx) * d;
          if (this.solidAt(n.x + ox, a.y, n.z + oz, 0.25)) continue;
          a.x = n.x + ox;
          a.z = n.z + oz;
          break;
        }
      }
    }
    if (a.role === 'sweeper' && T & NavTag.shop) {
      a.pose = Pose.sweep;
      a.t = 10 + Math.random() * 12;
    } else if (T & (NavTag.tea | NavTag.bench) && q === 0) {
      a.pose = Pose.sit;
      a.t = 14 + Math.random() * (h >= 17 && h < 22 ? 40 : 22);
    } else if (T & NavTag.field) {
      a.pose = Pose.work;
      a.t = 18 + Math.random() * 30;
    } else if (T & NavTag.work) {
      a.pose = a.role === 'porter' ? Pose.carry : Pose.work;
      a.t = 8 + Math.random() * 14;
    } else if (T & (NavTag.shop | NavTag.stall)) {
      a.pose = q > 0 ? Pose.idle : Pose.talk;
      a.t = 6 + Math.random() * 10 + q * 4;
    } else if (T & NavTag.home && a.stay > activity(a.zone, h) * 0.9) {
      a.state = 'home';
      a.out = false;
      a.t = 20 + Math.random() * 40;
    } else if (a.role === 'vendor') {
      a.pose = Pose.talk;
      a.t = 7 + Math.random() * 8;
    } else {
      a.pose = Math.random() < 0.45 ? Pose.talk : Pose.idle;
      a.t = 3 + Math.random() * 8;
    }
  }

  update(dt: number, ctx: GameContext, cam: THREE.Vector3, full: boolean): void {
    if (!this.nodeY) return;
    const t0 = performance.now();
    const h = ctx.world.sky.timeOfDay;
    const pl = ctx.player?.position;
    const N = this.nav.nodes;
    this.frame++;
    this.callCool -= dt;
    const bz = this.zoneAt(cam.x, cam.z);
    this.bz = bz;
    let budget = this.deficit > 0 && bz ? 3 : 0;
    let misses = 0;
    if (bz) this.gatherCells(bz, cam);
    else if (this.nearKey !== -1) {
      this.nearKey = -1;
      this.near.length = 0;
      for (const l of this.localTag.values()) l.length = 0;
    }
    let near = 0, out = 0, local = 0;
    for (let ai = 0; ai < this.agents.length; ai++) {
      const a = this.agents[ai];
      // Far away people tick at a quarter rate.
      const far = Math.abs(a.x - cam.x) + Math.abs(a.z - cam.z) > 340;
      if (far && (this.frame + ai) % 4 !== 0) continue;
      const step = far ? dt * 4 : dt;
      if (a.state === 'post') {
        a.phase += step * (a.pose === Pose.sweep ? 2.2 : 1);
        if (a.role === 'seller') this.tendShop(a, step, ctx, pl, h, full);
        else if (pl && Math.hypot(pl.x - a.x, pl.z - a.z) < 3) a.pose = Pose.idle;
      } else if (budget > 0 && a.out && a.zone !== 'laogai' && a.zone !== 'palace' && a.role !== 'keeper' && this.unseen(a, cam)) {
        if (this.relocate(a, bz!, cam, h)) budget--;
        else if (++misses > 2) budget = 0;
      } else if (a.state === 'home') {
        a.t -= step;
        if (a.t <= 0) {
          if (a.stay <= activity(a.zone, h)) {
            a.out = true;
            this.decide(a, h);
          } else a.t = 30 + Math.random() * 40;
        }
      } else if (a.state === 'act') {
        a.t -= step;
        a.phase += step * (a.pose === Pose.sweep ? 2.2 : 1);
        if (a.greet > 0) a.greet -= step;
        if (pl && a.pose !== Pose.sit && a.pose !== Pose.work) {
          const dx = pl.x - a.x, dz = pl.z - a.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < 9 && a.greet <= 0) {
            a.yaw = Math.atan2(dx, dz);
            a.pose = Pose.talk;
            a.greet = 2.5;
          }
        }
        if (a.role === 'vendor' && full && pl && a.pose === Pose.talk) {
          a.callT -= step;
          if (a.callT <= 0) {
            a.callT = 8 + Math.random() * 10;
            this.call(a, ctx, pl);
          }
        }
        if (a.t <= 0) this.decide(a, h);
      } else {
        // Walking: steer to the next node (offset into a lane), step aside for the player.
        const next = a.path[a.pi];
        const n = N[next];
        const last = a.pi === a.path.length - 1;
        const pn = N[a.path[a.pi - 1]];
        let sx = n.x - pn.x, sz = n.z - pn.z;
        const sl = Math.hypot(sx, sz) || 1;
        sx /= sl;
        sz /= sl;
        // The lane stays inside the street (a body's width clear of the buildings either side),
        // narrowing ahead of a pinch on the next link.
        const room = Math.max(0, Math.min(this.freeOf(a.path[a.pi - 1], next), last ? 3.5 : this.freeOf(next, a.path[a.pi + 1])) - 0.45);
        const lane = last ? 0 : Math.max(-room, Math.min(room, a.lane + a.dodge));
        const tx = n.x - sz * lane, tz = n.z + sx * lane;
        let dx = tx - a.x, dz = tz - a.z;
        const d = Math.hypot(dx, dz);
        let speed = a.speed;
        if (pl) {
          const px = pl.x - a.x, pz = pl.z - a.z;
          const pd = Math.hypot(px, pz);
          if (pd < 2.4 && (px * dx + pz * dz) / (d || 1) > -0.2) {
            const side = px * dz - pz * dx > 0 ? 1 : -1;
            a.dodge = Math.max(-2.2, Math.min(2.2, a.dodge + side * step * 2.5));
            speed *= 0.55;
          } else a.dodge *= Math.max(0, 1 - step * 0.8);
        }
        if (d < 0.45) {
          a.node = next;
          a.pi++;
          if (a.pi >= a.path.length) this.arrive(a, h);
        } else {
          dx /= d;
          dz /= d;
          const mv = Math.min(d, speed * step);
          a.x += dx * mv;
          a.z += dz * mv;
          const t = Math.max(0, Math.min(1, 1 - d / Math.max(0.1, sl)));
          a.y = this.nodeY[a.path[a.pi - 1]] + (this.nodeY[next] - this.nodeY[a.path[a.pi - 1]]) * t;
          const want = Math.atan2(dx, dz);
          let dy = want - a.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          a.yaw += dy * Math.min(1, step * 8);
          a.phase += mv * 1.55;
          a.pose = a.acc === Acc.cart ? Pose.push : a.acc === Acc.pole || a.role === 'porter' ? Pose.carry : Pose.walk;
        }
      }
      if (!a.out) continue;
      out++;
      if (pl && Math.abs(pl.x - a.x) < 22 && Math.abs(pl.z - a.z) < 22) near++;
      if (a.zone === bz && a.state !== 'post' && (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2 < BUBBLE_R * BUBBLE_R) local++;
      if (!this.figures.visible(a.x, a.y, a.z)) continue;
      this.figures.push(a.x, a.y, a.z, a.yaw, a.pose, a.phase, 1, a.state === 'walk' ? 0.05 : 0, a.robe, a.pants, a.skin, a.acc, a.scale);
    }
    this.deficit = bz ? Math.round((BUBBLE_TARGET[bz] ?? 0) * this.density * activity(bz, h)) - local : 0;
    this.stats.out = out;
    this.stats.near = near;
    this.stats.local = local;
    this.nearCount = near;
    this.updateShops(h);
    this.updateAudio(dt, ctx, cam, h);
    this.stats.ms = this.stats.ms * 0.9 + (performance.now() - t0) * 0.1;
  }

  // ---------------------------------------------------------------------------
  // Shops by the clock
  // ---------------------------------------------------------------------------

  private updateShops(h: number): void {
    const closed = h >= 21 || h < 6 ? 1 : 0;
    if (closed === this.closed) return;
    this.closed = closed;
    const m = this.tmpM, q = this.tmpQ, p = this.tmpP, s = this.tmpS;
    if (this.shutters) {
      this.shutters.count = closed ? this.shops.length : 0;
      if (closed) {
        this.shops.forEach((sh, i) => {
          const fx = Math.sin(sh.yaw), fz = Math.cos(sh.yaw);
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, sh.yaw);
          p.set(sh.x - fx * (sh.off - 0.07), GROUND + 0.05, sh.z - fz * (sh.off - 0.07));
          s.set(sh.w * 0.74, 2.5, 0.08);
          this.shutters!.setMatrixAt(i, m.compose(p, q, s));
        });
        this.shutters.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.tarps) {
      this.tarps.count = closed ? this.stalls.length : 0;
      if (closed) {
        this.stalls.forEach((st, i) => {
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, st.yaw);
          p.set(st.x, GROUND, st.z);
          s.set(st.w + 0.2, 1.25, st.d * 0.8);
          this.tarps!.setMatrixAt(i, m.compose(p, q, s));
        });
        this.tarps.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // District audio
  // ---------------------------------------------------------------------------

  private updateAudio(dt: number, ctx: GameContext, cam: THREE.Vector3, h: number): void {
    this.audioT -= dt;
    if (this.audioT > 0) return;
    this.audioT = 0.25;
    if (ctx.audio.ready && this.loopGen !== ctx.audio.generation) this.startLoops(ctx);
    const pl = ctx.player?.position ?? cam;
    const r = Math.hypot(pl.x - C.x, pl.z - C.z);
    const night = h < 5.5 || h > 20.5 ? 1 : 0;
    this.loops.crowd?.setVolume(Math.min(1, this.nearCount / 22) * 0.85);
    // Lake Laogai: still water by night, a low hum inside the base.
    const lake = Math.hypot(pl.x - BSS.lake.x, pl.z - BSS.lake.z);
    const inBase = insideLaogai(pl.x, pl.z, pl.y);
    this.loops.hum?.setVolume(inBase ? 0.9 : lake < 90 ? (1 - lake / 90) * (0.25 + 0.45 * night) : 0);
    // The nearest moving train rumbles along its viaduct.
    const trains = this.trains();
    let best: { x: number; z: number } | null = null, bd = 95;
    for (const t of trains) {
      if (!t.moving) continue;
      const d = Math.hypot(t.x - pl.x, t.z - pl.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (best) {
      this.loops.rumble?.setPosition(this.tmpP.set(best.x, GROUND + 22, best.z));
      this.loops.rumble?.setVolume(0.9);
    } else this.loops.rumble?.setVolume(0);
    // Farm animals and birds over the fields by day.
    this.sfxT -= 0.25;
    if (this.sfxT <= 0) {
      this.sfxT = 6 + Math.random() * 9;
      const day = h > 6 && h < 19;
      if (r > 255 && r < 395 && !inBase && day) {
        const a = Math.random() * Math.PI * 2;
        const p = this.tmpP.set(pl.x + Math.cos(a) * 25, GROUND + 1, pl.z + Math.sin(a) * 25);
        if (Math.random() < 0.45) ctx.audio.play('bss_moo', { position: p, volume: 0.7, pitch: 0.85 + Math.random() * 0.3 });
        else ctx.audio.play(Math.random() < 0.5 ? 'amb.bird.song' : 'amb.bird.chirp', { position: p.setY(GROUND + 6), volume: 0.8 });
      } else if (r < 166 && day && Math.random() < 0.5) {
        ctx.audio.play('amb.bird.warble', { position: this.tmpP.set(pl.x + 12, GROUND + 8, pl.z - 9), volume: 0.6 });
      }
    }
  }

  dispose(): void {
    this.onSessionEnd();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.shutters?.dispose();
    this.tarps?.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
