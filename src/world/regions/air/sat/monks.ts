import * as THREE from 'three';
import type { GameContext } from '../../../../core/GameContext';
import { Random } from '../../../../core/Random';
import { COUNTS, LEVEL_Y, SEED, floorY, place, polar, rOutAt, roadSamples, shelf, summitRAt, terrace, yawOut, type PlaceId } from './layout';
import { SITES as LSITES, airballPoles, meditationSpots, refectoryTables } from './levels';
import { MAcc, MFlag, MPose, MonkRenderer, type MAccId, type MPoseId } from './monkFigures';
import { WalkGrid, type Area } from './walkgrid';

/**
 * The monks of the Southern Air Temple: ~170 men and boys living a day. They walk with purpose
 * along the one switchback road (and short spurs from it to every activity site, each checked
 * against the colliders actually built), and spend the day at activities that change with the
 * hour: dawn meditation and bison feeding, morning airbending classes and chores (sweeping with
 * gusts of air, carrying baskets and buckets, cooking, the orchards and vegetable beds), meals at
 * the refectory, midday airball and air-scooter races for the boys and staff gliding from the
 * summit, prayers at the shrines and wheels, dusk meditation, and at night the quiet of lanterns
 * carried along the road while the rest sleep indoors (a few herders sleep by the bison).
 *
 * Far monks update a quarter as often; hidden ones only count down. They step aside for the
 * player and bow in greeting. Named masters and quest givers are separate NPCs (unchanged).
 */

type Who = 'boy' | 'adult' | 'elder' | 'master' | 'any';
type Kind = 'slot' | 'sweep' | 'carry' | 'scooter' | 'airball' | 'glide' | 'patrol' | 'inside' | 'sleep';

interface Slot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  taken: number;
  /** Walk from the site's door to this slot (planned). */
  via: THREE.Vector3[];
}

interface Site {
  id: string;
  kind: Kind;
  door: THREE.Vector3;
  attach: number;
  level: number;
  /** Walk from the door to the road node `attach` (planned round whatever stands between). */
  via: THREE.Vector3[];
  slots: Slot[];
  pose: MPoseId;
  acc: MAccId;
  /** Open hours [from, to) (24 h; may wrap past midnight). */
  hours: Array<[number, number]>;
  who: Who[];
  weight: number;
  /** Second endpoint for carriers; loop path for sweepers, scooters and the night watch. */
  path?: THREE.Vector3[];
  /** Speed round a loop (scooters, chasing games). */
  speed?: number;
  unlinked?: boolean;
}

type AState = 'walk' | 'act' | 'inside' | 'glide' | 'greet';

interface Monk {
  i: number;
  who: Exclude<Who, 'any'>;
  pos: THREE.Vector3;
  yaw: number;
  scale: number;
  robe: number;
  pants: number;
  skin: number;
  flags: number;
  lane: number;
  state: AState;
  t: number;
  dur: number;
  site: number;
  slot: number;
  path: THREE.Vector3[];
  pi: number;
  phase: number;
  speed: number;
  pose: MPoseId;
  acc: MAccId;
  pitch: number;
  greetT: number;
  aside: number;
  /** Generic per-activity state (path progress, hop arc...). */
  u: number;
  from: THREE.Vector3;
}

const ROBES = [0xe0a43a, 0xd99a2b, 0xe8b24a, 0xd48d22, 0xe3ab45];
const PANTS = [0xc0611f, 0xb5541a, 0x8a4a22, 0x9c5a28, 0xc86a26];
const SKINS = [0xc68c5f, 0xb98057, 0xd29a6a, 0xa87048, 0xbe8a60];

function inHours(h: number, hours: Array<[number, number]>): boolean {
  return hours.some(([a, b]) => (a <= b ? h >= a && h < b : h >= a || h < b));
}

export class Monks {
  private readonly renderer: MonkRenderer;
  private readonly road: THREE.Vector3[] = [];
  private readonly sites: Site[] = [];
  private readonly grids = new Map<number, WalkGrid>();
  private readonly monks: Monk[] = [];
  private readonly rnd = new Random(SEED + 616);
  private ctx: GameContext | null = null;
  private frame = 0;
  private time = 0;
  private lastHour = -1;
  private readonly ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshLambertMaterial({ color: '#d8c49a' }));
  private ballFrom = new THREE.Vector3();
  private ballTo = new THREE.Vector3();
  private ballT = 1;
  private readonly tv = new THREE.Vector3();
  private fx = 0;
  stats = { total: 0, visible: 0, inside: 0, walking: 0, acting: 0, gliding: 0 };

  constructor(parent: THREE.Object3D, ctx: GameContext, quality: 'low' | 'medium' | 'high', grounds: Array<{ p: THREE.Vector3; yaw: number }>) {
    const n = quality === 'low' ? 110 : quality === 'medium' ? 145 : COUNTS.monks;
    this.renderer = new MonkRenderer(parent, n + 8);
    if (quality === 'low') this.renderer.setRange(38, 140);
    this.ball.name = 'sat_airball';
    this.ball.visible = false;
    parent.add(this.ball);
    // Road nodes every ~5 m from the gate plaza to the summit (y on the stairs follows the flights).
    for (const s of roadSamples(5)) this.road.push(new THREE.Vector3(s.x, floorY(s.y), s.z));
    this.buildSites(ctx, grounds);
    const areas: Record<number, Area[]> = {
      1: [{ a0: 258, a1: 342, r0: 56, r1: 101 }],
      2: [{ a0: 338, a1: 456, r0: 44, r1: 80 }],
      3: [{ a0: 86, a1: 180, r0: 40, r1: 86 }],
      4: [{ a0: 170, a1: 348, r0: 22, r1: 66 }],
      5: [{ a0: 336, a1: 458, r0: 22, r1: 56 }],
      6: [{ a0: 0, a1: 360, r0: 0, r1: 37 }],
    };
    for (const l of new Set(this.sites.map((s) => s.level))) this.grids.set(l, new WalkGrid(ctx, floorY(LEVEL_Y[l]), areas[l] ?? []));
    for (const s of this.sites) this.plan(s);
    for (let i = 0; i < n; i++) {
      const r = this.rnd.next();
      const who: Monk['who'] = r < 0.3 ? 'boy' : r < 0.8 ? 'adult' : r < 0.92 ? 'elder' : 'master';
      const m: Monk = {
        i, who, pos: new THREE.Vector3(), yaw: 0, scale: who === 'boy' ? this.rnd.range(0.66, 0.8) : this.rnd.range(0.96, 1.06),
        robe: ROBES[this.rnd.int(0, ROBES.length - 1)], pants: PANTS[this.rnd.int(0, PANTS.length - 1)], skin: SKINS[this.rnd.int(0, SKINS.length - 1)],
        flags: (who === 'elder' ? MFlag.elder : 0) | (who === 'master' || (who === 'elder' && this.rnd.chance(0.6)) ? MFlag.master : 0),
        lane: this.rnd.range(-0.9, 0.9), state: 'inside', t: 0, dur: 0, site: -1, slot: -1, path: [], pi: 0, phase: this.rnd.range(0, 10),
        speed: who === 'boy' ? this.rnd.range(1.45, 1.8) : who === 'elder' ? this.rnd.range(0.9, 1.1) : this.rnd.range(1.15, 1.4),
        pose: MPose.idle, acc: MAcc.none, pitch: 0, greetT: 0, aside: 0, u: 0, from: new THREE.Vector3(),
      };
      this.monks.push(m);
    }
    this.stats.total = n;
  }

  // ---------------------------------------------------------------- sites

  private site(o: Omit<Site, 'attach' | 'slots' | 'level' | 'via'> & { slots: Array<{ x: number; z: number; y?: number; yaw: number }> }): void {
    let level = 1, best = Infinity;
    for (let l = 1; l <= 6; l++) {
      const d = Math.abs(floorY(LEVEL_Y[l]) - o.door.y);
      if (d < best) {
        best = d;
        level = l;
      }
    }
    this.sites.push({ ...o, attach: 0, level, via: [], slots: o.slots.map((s) => ({ x: s.x, z: s.z, y: s.y ?? o.door.y, yaw: s.yaw, taken: -1, via: [] })) });
  }

  private buildSites(ctx: GameContext, grounds: Array<{ p: THREE.Vector3; yaw: number }>): void {
    const F = (l: number) => floorY(LEVEL_Y[l]);
    const at = (id: PlaceId, dth = 0, dr = 0) => {
      const p = place(id, dth, dr);
      return new THREE.Vector3(p.x, p.y, p.z);
    };
    const v = (th: number, r: number, y: number) => {
      const p = polar(th, r);
      return new THREE.Vector3(p.x, y, p.z);
    };
    const face = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(to.x - from.x, to.z - from.z);
    // Meditation circles on L5 (cushion rings, facing in).
    for (const [i, m] of meditationSpots().entries()) {
      const slots = Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2;
        const p = { x: m.x + Math.cos(a) * 2.3, z: m.z + Math.sin(a) * 2.3 };
        return { ...p, y: m.y, yaw: face(p, m) };
      });
      this.site({ id: `meditate_${i}`, kind: 'slot', door: v(m.th, m.r - 4.6, F(5)), slots, pose: MPose.meditate, acc: MAcc.none, hours: [[5, 7.5], [11, 13], [17.5, 20.8]], who: ['adult', 'elder', 'master', 'boy'], weight: 3 });
    }
    // Airbending classes: rows facing a master.
    const klass = (id: string, c: THREE.Vector3, facing: number, rows: number, cols: number, hours: Array<[number, number]>, who: Who[]) => {
      const fx = Math.sin(facing), fz = Math.cos(facing), rx = Math.cos(facing), rz = -Math.sin(facing);
      const slots: Array<{ x: number; z: number; yaw: number }> = [];
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        const u = (k - (cols - 1) / 2) * 1.9, w = -r * 1.9;
        slots.push({ x: c.x + rx * u + fx * w, z: c.z + rz * u + fz * w, yaw: facing });
      }
      this.site({ id, kind: 'slot', door: c.clone().addScaledVector(new THREE.Vector3(fx, 0, fz), -(rows * 1.9 + 1.5)), slots, pose: MPose.airbend, acc: MAcc.none, hours, who, weight: 4 });
      const mp = { x: c.x + fx * 3.2, z: c.z + fz * 3.2 };
      this.site({ id: `${id}_master`, kind: 'slot', door: c.clone().addScaledVector(new THREE.Vector3(fx, 0, fz), -(rows * 1.9 + 1.5)), slots: [{ ...mp, yaw: facing + Math.PI }], pose: MPose.airbend, acc: MAcc.none, hours, who: ['master', 'elder'], weight: 6 });
    };
    const yard = polar(145, 53);
    klass('class_yard', new THREE.Vector3(yard.x, F(3) + 0.06, yard.z), yawOut(145) + Math.PI, 3, 4, [[7, 11], [14, 17]], ['boy', 'adult']);
    klass('class_entrance', v(193, 47.4, F(4) + 0.05), yawOut(193) + Math.PI, 2, 5, [[7.5, 11], [15, 17.5]], ['boy', 'adult']);
    klass('class_moon', v(229, 47.5, F(4)), yawOut(229) + Math.PI, 2, 4, [[8, 12], [14, 17]], ['adult', 'boy']);
    // Prayer: wheels, shrines, the statue of Gyatso, the bell pavilion.
    const wheels = Array.from({ length: 6 }, (_, k) => {
      const p = polar(LSITES.wheels.th - 5 + k * 2, LSITES.wheels.r + 1.2);
      return { ...p, yaw: yawOut(LSITES.wheels.th - 5 + k * 2) + Math.PI };
    });
    this.site({ id: 'wheels', kind: 'slot', door: v(LSITES.wheels.th, 37, F(4)), slots: wheels, pose: MPose.pray, acc: MAcc.none, hours: [[6, 20]], who: ['adult', 'elder', 'master', 'boy'], weight: 2 });
    for (const [i, a] of [304, 334].entries()) {
      const p = polar(a, summitRAt(a) + 4.2);
      this.site({ id: `shrine_${i}`, kind: 'slot', door: v(a, 38, F(4)), slots: [{ ...p, yaw: yawOut(a) + Math.PI }, { ...polar(a + 2.2, summitRAt(a) + 4.6), yaw: yawOut(a) + Math.PI }], pose: MPose.pray, acc: MAcc.none, hours: [[5.5, 21]], who: ['elder', 'adult', 'master'], weight: 1.5 });
    }
    this.site({ id: 'gyatso', kind: 'slot', door: v(186, 40, F(4)), slots: [{ ...polar(191, 36.6), yaw: yawOut(191) + Math.PI }, { ...polar(195, 36.6), yaw: yawOut(195) + Math.PI }], pose: MPose.pray, acc: MAcc.none, hours: [[6, 19]], who: ['any'], weight: 1 });
    const bell = place('bellPavilion');
    this.site({ id: 'bell', kind: 'slot', door: v(270, 13, F(6)), slots: [{ x: bell.x - 2, z: bell.z + 4.6, yaw: Math.PI }, { x: bell.x + 2, z: bell.z + 4.6, yaw: Math.PI }], pose: MPose.pray, acc: MAcc.none, hours: [[6, 19]], who: ['elder', 'master', 'adult'], weight: 1 });
    // Sweeping (loops along the courts and the summit plaza).
    const loop = (th0: number, th1: number, r: number, y: number) => {
      const pts: THREE.Vector3[] = [];
      for (let a = th0; a <= th1; a += 3) pts.push(v(a, r, y));
      for (let a = th1; a >= th0; a -= 3) pts.push(v(a, r - 2.2, y));
      return pts;
    };
    this.site({ id: 'sweep_courts', kind: 'sweep', door: v(200, 50, F(4)), slots: [0, 1, 2].map(() => ({ ...polar(200, 50), yaw: 0 })), pose: MPose.sweep, acc: MAcc.broom, hours: [[6.5, 10.5], [15, 17]], who: ['boy', 'adult'], weight: 2, path: loop(182, 272, 50.5, F(4)) });
    this.site({ id: 'sweep_summit', kind: 'sweep', door: v(110, 18, F(6)), slots: [0, 1].map(() => ({ ...polar(110, 18), yaw: 0 })), pose: MPose.sweep, acc: MAcc.broom, hours: [[6.5, 10]], who: ['boy', 'adult'], weight: 1.5, path: loop(60, 240, 19.5, F(6)) });
    this.site({ id: 'sweep_bison', kind: 'sweep', door: v(296, 77, F(1)), slots: [0, 1].map(() => ({ ...polar(296, 77), yaw: 0 })), pose: MPose.sweep, acc: MAcc.broom, hours: [[7, 11]], who: ['boy', 'adult'], weight: 1.5, path: loop(268, 320, 78.5, F(1)) });
    // Carrying between the kitchens and the refectory, and hay to the bison.
    const kit = v(36, edgeOf('halls', 36) + 0.4 + 3.5 + 0.8 + 3.5 + 3.6, F(2));
    const ref = v(14, edgeOf('halls', 14) + 0.4 + 4.5 + 0.8 + 4.5 + 3.8, F(2));
    this.site({ id: 'carry_kitchen', kind: 'carry', door: kit.clone(), slots: [0, 1, 2].map(() => ({ x: kit.x, z: kit.z, yaw: 0 })), pose: MPose.carry, acc: MAcc.basket, hours: [[6, 12.5], [16, 19]], who: ['boy', 'adult'], weight: 2, path: [kit.clone(), ref.clone()] });
    const hay = v(287, 76.5, F(1)), herd = v(318, 76.5, F(1));
    this.site({ id: 'carry_hay', kind: 'carry', door: hay.clone(), slots: [0, 1].map(() => ({ x: hay.x, z: hay.z, yaw: 0 })), pose: MPose.carry, acc: MAcc.buckets, hours: [[5.5, 9], [16.5, 19.5]], who: ['adult', 'boy'], weight: 2, path: [hay.clone(), herd.clone()] });
    // Cooking at the kitchens, the orchards and the vegetable beds.
    this.site({ id: 'cook', kind: 'slot', door: kit.clone(), slots: [-2.4, 0, 2.4].map((u) => ({ ...polar(36 + u * 0.95, edgeOf('halls', 36) + 0.4 + 3.5 + 0.8 + 3.5 + 1.6), yaw: yawOut(36) + Math.PI })), pose: MPose.work, acc: MAcc.none, hours: [[5, 8], [10.5, 12.5], [16.5, 18.5]], who: ['adult', 'elder'], weight: 2 });
    const orchard: Array<{ x: number; z: number; yaw: number }> = [];
    for (const [a, r] of [[349, 60.7], [355, 64.9], [0.5, 68.9], [352, 69], [358, 60.7], [3, 64.9]] as const) orchard.push({ ...polar(a, r), yaw: this.rnd.range(0, 6.28) });
    this.site({ id: 'orchard', kind: 'slot', door: v(6, 72, F(2)), slots: orchard, pose: MPose.carry, acc: MAcc.basket, hours: [[7, 12], [14, 18]], who: ['adult', 'boy', 'elder'], weight: 2 });
    const beds: Array<{ x: number; z: number; yaw: number }> = [];
    for (let i = 0; i < 5; i++) {
      const a = 46.35 + i * 2.7;
      beds.push({ ...polar(a, edgeOf('halls', a) + 6.4 + (i % 2 ? 1.2 : -1.2)), yaw: yawOut(a + 90) + (i % 2 ? Math.PI : 0) });
    }
    this.site({ id: 'beds', kind: 'slot', door: v(52, 61.8, F(2)), slots: beds, pose: MPose.work, acc: MAcc.none, hours: [[6.5, 11], [15, 18]], who: ['adult', 'elder', 'boy'], weight: 2 });
    // Meals at the refectory tables.
    const seats: Array<{ x: number; z: number; y: number; yaw: number }> = [];
    for (const t of refectoryTables()) {
      const rx = Math.cos(t.yaw), rz = -Math.sin(t.yaw), fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
      for (const side of [-1, 1]) for (const w of [-1.8, -0.6, 0.6, 1.8]) seats.push({ x: t.x + rx * side * 0.98 + fx * w, z: t.z + rz * side * 0.98 + fz * w, y: t.y, yaw: t.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
    }
    this.site({ id: 'meal', kind: 'slot', door: ref.clone(), slots: seats, pose: MPose.sit, acc: MAcc.none, hours: [[6.5, 7.5], [11.5, 13.2], [18, 19.2]], who: ['any'], weight: 6 });
    // Tending the bison resting on the terrace (beside each resting place).
    const tend = grounds.slice(0, 10).map((g) => {
      const sx = Math.cos(g.yaw), sz = -Math.sin(g.yaw);
      const p = { x: g.p.x + sx * 2.6, z: g.p.z + sz * 2.6 };
      return { ...p, y: g.p.y, yaw: Math.atan2(-sx, -sz) };
    });
    this.site({ id: 'tend', kind: 'slot', door: v(296, 77, F(1)), slots: tend, pose: MPose.work, acc: MAcc.none, hours: [[5.2, 9], [16.5, 20.5]], who: ['adult', 'boy', 'elder'], weight: 3 });
    // Whistling bison in at the ledges.
    for (const [i, id] of (['landing_main', 'landing_ne'] as const).entries()) {
      const s = shelf(id);
      this.site({ id: `whistle_${i}`, kind: 'slot', door: v(s.a, s.r0 - 1.5, F(1)), slots: [{ ...polar(s.a + 4, s.r0 + 2.5), yaw: yawOut(s.a) }], pose: MPose.talk, acc: MAcc.none, hours: [[5.5, 9], [17, 20]], who: ['adult', 'master'], weight: 1.5 });
    }
    // Airball (boys hopping between pole tops) — midday.
    const poles = airballPoles();
    const ab = shelf('airball');
    this.site({ id: 'airball', kind: 'airball', door: v(ab.a, ab.r0 + 2.2, F(3)), slots: poles.map((p) => ({ x: p.x, z: p.z, y: p.y + p.h + 0.06, yaw: yawOut(ab.a + 90) })), pose: MPose.airbend, acc: MAcc.none, hours: [[10.5, 16.5]], who: ['boy'], weight: 8 });
    // Air-scooter races round the summit tower.
    const ring: THREE.Vector3[] = [];
    for (let a = 0; a < 360; a += 10) ring.push(v(a, 13 + 1.5 * Math.sin((a * Math.PI) / 45), F(6)));
    this.site({ id: 'scooter', kind: 'scooter', door: v(96, 16, F(6)), slots: [0, 1, 2, 3].map(() => ({ ...polar(96, 16), yaw: 0 })), pose: MPose.scooter, acc: MAcc.scooter, hours: [[10, 17]], who: ['boy'], weight: 6, path: ring });
    // Staff gliders off the summit launch.
    const ls = shelf('launch');
    this.site({ id: 'glide', kind: 'glide', door: v(ls.a, ls.r0 + 1, F(6)), slots: [{ ...polar(ls.a, ls.r1 - 1.5), yaw: yawOut(ls.a) }], pose: MPose.glide, acc: MAcc.glider, hours: [[9.5, 17.5]], who: ['adult', 'master', 'boy'], weight: 3 });
    // Boys' chasing game round the labyrinth.
    const lab = polar(254, 44);
    const chase: THREE.Vector3[] = [];
    for (let a = 0; a < 360; a += 20) chase.push(new THREE.Vector3(lab.x + Math.cos((a * Math.PI) / 180) * 8.6, F(4), lab.z + Math.sin((a * Math.PI) / 180) * 8.6));
    this.site({ id: 'chase', kind: 'scooter', door: v(250, 52.8, F(4)), slots: [0, 1, 2].map(() => ({ ...polar(250, 52.8), yaw: 0 })), pose: MPose.walk, acc: MAcc.none, hours: [[9, 18]], who: ['boy'], weight: 3, path: chase, speed: 3.6 });
    // Night watch with lanterns along the road; herders asleep by the bison.
    this.site({ id: 'watch', kind: 'patrol', door: this.road[Math.floor(this.road.length * 0.3)].clone(), slots: [0, 1, 2, 3, 4].map(() => ({ x: 0, z: 0, yaw: 0 })), pose: MPose.walk, acc: MAcc.lantern, hours: [[19.5, 24], [0, 5.5]], who: ['adult', 'master'], weight: 5 });
    const sleepers = grounds.slice(0, 4).map((g) => {
      const sx = Math.cos(g.yaw), sz = -Math.sin(g.yaw);
      return { x: g.p.x - sx * 2.5, z: g.p.z - sz * 2.5, y: g.p.y, yaw: g.yaw };
    });
    this.site({ id: 'sleep_herders', kind: 'sleep', door: v(296, 77, F(1)), slots: sleepers, pose: MPose.sleep, acc: MAcc.none, hours: [[21, 24], [0, 5]], who: ['adult'], weight: 4 });
    // Indoors: the quarters, the halls, the kitchens (monks go in and come out again).
    for (const [th, back, d, lvl] of [[101.5, 46.4, 9, 3], [122, 46.4, 9, 3], [164, 46.2, 7.5, 3], [2, summitRAt(2) + 0.3, 9, 5], [14, edgeOf('halls', 14) + 0.4, 9, 2], [36, edgeOf('halls', 36) + 0.4, 7, 2], [96, 5.6, 1.5, 6]] as const) {
      const door = v(th, back + d + 1.6 + 2.6, F(lvl));
      this.site({ id: `in_${th}`, kind: 'inside', door, slots: Array.from({ length: 40 }, () => ({ x: door.x, z: door.z, yaw: 0 })), pose: MPose.idle, acc: MAcc.none, hours: [[0, 24]], who: ['any'], weight: 1.2 });
    }
    void ctx;
  }

  /**
   * Plan a site's ways on its level's grid: door → nearest reachable road node, door → each slot,
   * and the loops or runs of moving activities.
   */
  private plan(s: Site): void {
    const g = this.grids.get(s.level);
    const floor = floorY(LEVEL_Y[s.level]);
    const v3 = (p: { x: number; z: number }, y = floor) => new THREE.Vector3(p.x, y, p.z);
    if (!g) return;
    s.unlinked = true;
    const cands = this.road.map((p, i) => ({ i, d: Math.hypot(p.x - s.door.x, p.z - s.door.z) })).filter((c) => Math.abs(this.road[c.i].y - floor) < 0.3).sort((a, b) => a.d - b.d);
    for (const c of cands.slice(0, 6)) {
      const r = this.road[c.i];
      const p = g.path(s.door.x, s.door.z, r.x, r.z);
      if (!p) continue;
      s.attach = c.i;
      s.via = p.slice(0, -1).filter((q, k) => k > 0 || Math.hypot(q.x - s.door.x, q.z - s.door.z) > 0.3).map((q) => v3(q));
      s.unlinked = false;
      break;
    }
    if (s.unlinked) s.attach = cands[0]?.i ?? 0;
    for (const sl of s.slots) {
      const p = g.path(s.door.x, s.door.z, sl.x, sl.z);
      sl.via = p ? p.slice(1, -1).map((q) => v3(q)) : [];
    }
    if (s.path && s.path.length > 1) {
      const out: THREE.Vector3[] = [s.path[0].clone()];
      for (let k = 1; k < s.path.length; k++) {
        const a = s.path[k - 1], b = s.path[k];
        if (g.los(a.x, a.z, b.x, b.z)) {
          out.push(b.clone());
          continue;
        }
        const p = g.path(a.x, a.z, b.x, b.z);
        if (p) for (const q of p.slice(1)) out.push(v3(q, a.y));
      }
      s.path = out.filter((q) => g.isFree(q.x, q.z) || s.kind === 'scooter');
    }
  }

  get siteCount(): number {
    return this.sites.length;
  }

  /** Sites whose door could not be joined to the road (tests). */
  unlinked(): string[] {
    return this.sites.filter((s) => s.unlinked).map((s) => s.id);
  }

  // ---------------------------------------------------------------- life

  sessionStart(ctx: GameContext): void {
    this.ctx = ctx;
    this.place(ctx.world.sky.timeOfDay);
  }

  sessionEnd(): void {
    this.ctx = null;
  }

  /** Put everyone straight into an activity for the hour (no walk), so the temple starts alive. */
  private place(h: number): void {
    for (const s of this.sites) for (const sl of s.slots) sl.taken = -1;
    for (const m of this.monks) {
      m.site = -1;
      m.slot = -1;
      const si = this.choose(m, h, null);
      if (si < 0) continue;
      const s = this.sites[si];
      const slot = this.freeSlot(s);
      if (slot < 0) continue;
      this.begin(m, si, slot, h);
      if (m.state !== 'inside' && s.kind !== 'patrol' && s.kind !== 'sweep' && s.kind !== 'carry' && s.kind !== 'scooter') {
        const sl = s.slots[slot];
        m.pos.set(sl.x, sl.y, sl.z);
        m.yaw = sl.yaw;
      }
      m.t = this.rnd.range(0, m.dur * 0.8);
    }
  }

  private freeSlot(s: Site): number {
    const start = this.rnd.int(0, s.slots.length - 1);
    for (let k = 0; k < s.slots.length; k++) {
      const i = (start + k) % s.slots.length;
      if (s.slots[i].taken < 0) return i;
    }
    return -1;
  }

  /** Pick the next activity for a monk at hour h (weighted, near ones preferred). */
  private choose(m: Monk, h: number, from: THREE.Vector3 | null): number {
    let total = 0;
    const w: number[] = [];
    const night = h >= 21 || h < 5;
    for (const [i, s] of this.sites.entries()) {
      let wt = 0;
      if (inHours(h, s.hours) && (s.who.includes('any') || s.who.includes(m.who)) && s.slots.some((sl) => sl.taken < 0)) {
        wt = s.weight;
        if (s.kind === 'inside') wt = night ? 40 : 0.22;
        if (from) wt /= 1 + (from.distanceTo(s.door) / 45) ** 2;
        if (i === m.site) wt *= 0.2;
      }
      w.push(wt);
      total += wt;
    }
    if (total <= 0) return -1;
    let r = this.rnd.next() * total;
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return i;
    }
    return w.length - 1;
  }

  private begin(m: Monk, si: number, slot: number, h: number): void {
    const s = this.sites[si];
    s.slots[slot].taken = m.i;
    m.site = si;
    m.slot = slot;
    m.pose = s.pose;
    m.acc = s.acc;
    m.pitch = 0;
    m.t = 0;
    m.u = this.rnd.next();
    const night = h >= 21 || h < 5;
    m.dur = s.kind === 'inside' ? (night ? this.rnd.range(400, 1200) : this.rnd.range(60, 200)) : s.kind === 'glide' ? 1e9 : this.rnd.range(140, 420);
    if (s.kind === 'inside') {
      m.state = 'inside';
      m.pos.copy(s.door);
    } else if (s.kind === 'glide') {
      m.state = 'act';
      m.pose = MPose.idle;
      m.acc = MAcc.staff;
    } else m.state = 'act';
  }

  /** Leave the current site and walk to the next one. */
  private next(m: Monk, h: number): void {
    const prev = m.site >= 0 ? this.sites[m.site] : null;
    if (prev && m.slot >= 0) prev.slots[m.slot].taken = -1;
    const si = this.choose(m, h, m.pos);
    if (si < 0) {
      m.state = 'inside';
      m.dur = 60;
      m.t = 0;
      return;
    }
    const s = this.sites[si];
    const slot = this.freeSlot(s);
    if (slot < 0) {
      m.state = 'inside';
      m.dur = 30;
      m.t = 0;
      return;
    }
    // Route: here → (back out to this site's door) → its spur to the road → along the road → the
    // next site's spur → its door → the slot.
    const path: THREE.Vector3[] = [];
    if (prev) {
      const ps = m.slot >= 0 ? prev.slots[m.slot] : null;
      const fixed = prev.kind === 'slot' || prev.kind === 'airball' || prev.kind === 'sleep' || prev.kind === 'glide' || prev.kind === 'inside';
      if (ps && fixed) for (let k = ps.via.length - 1; k >= 0; k--) path.push(ps.via[k].clone());
      else if (!fixed) {
        const g = this.grids.get(prev.level);
        const p = g?.path(m.pos.x, m.pos.z, prev.door.x, prev.door.z);
        if (p) for (const q of p.slice(1, -1)) path.push(new THREE.Vector3(q.x, prev.door.y, q.z));
      }
      path.push(prev.door.clone());
      for (const q of prev.via) path.push(q.clone());
    }
    const a = prev ? prev.attach : this.nearestRoad(m.pos);
    const b = s.attach;
    const step = a <= b ? 1 : -1;
    for (let i = a; i !== b + step; i += step) path.push(this.road[i].clone());
    for (let k = s.via.length - 1; k >= 0; k--) path.push(s.via[k].clone());
    path.push(s.door.clone());
    const sl = s.slots[slot];
    if (s.kind === 'slot' || s.kind === 'airball' || s.kind === 'glide' || s.kind === 'sleep') {
      for (const q of sl.via) path.push(q.clone());
      path.push(new THREE.Vector3(sl.x, sl.y, sl.z));
    }
    s.slots[slot].taken = m.i;
    m.site = si;
    m.slot = slot;
    m.path = path;
    m.pi = 0;
    m.from.copy(m.pos);
    m.state = 'walk';
    m.pose = MPose.walk;
    m.acc = s.kind === 'carry' ? s.acc : s.kind === 'glide' ? MAcc.staff : s.kind === 'patrol' ? MAcc.lantern : MAcc.none;
    m.pitch = 0;
    m.t = 0;
  }

  private nearestRoad(p: THREE.Vector3): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.road.length; i++) {
      const d = this.road[i].distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  update(dt: number, ctx: GameContext): void {
    this.time += dt;
    this.frame++;
    const h = ctx.world.sky.timeOfDay;
    // Dawn gong.
    if (this.lastHour >= 0 && this.lastHour < 5.5 && h >= 5.5 && h < 6) {
      const g = polar(LSITES.gong.th, LSITES.gong.r);
      ctx.audio.play('amb.bell', { position: { x: g.x, y: floorY(LEVEL_Y[4]) + 1.8, z: g.z }, volume: 1, range: 320 });
    }
    // A jump in the clock (a rest, a time skip): everyone takes up the new hour's activities at once.
    if (this.lastHour >= 0) {
      const dh = Math.abs(h - this.lastHour);
      if (dh > 0.25 && dh < 23.75) this.place(h);
    }
    this.lastHour = h;
    const player = ctx.player?.root.position ?? null;
    const cam = ctx.camera.position;
    this.renderer.begin(cam);
    this.renderer.view(ctx.camera);
    let vis = 0, inside = 0, walking = 0, acting = 0, gliding = 0;
    this.fx = Math.max(0, this.fx - dt * 8);
    for (const m of this.monks) {
      const far = m.pos.distanceToSquared(cam) > 130 * 130;
      if (far && (this.frame + m.i) % 4 !== 0 && m.state !== 'glide') {
        // Far: tick a quarter as often (walkers keep moving).
        if (m.state === 'walk') this.walk(m, dt, ctx, null);
      } else this.tick(m, far ? dt * 4 : dt, ctx, h, player);
      if (m.state === 'inside') {
        inside++;
        continue;
      }
      if (m.state === 'walk') walking++;
      else if (m.state === 'glide') gliding++;
      else acting++;
      if (!this.renderer.visible(m.pos.x, m.pos.y, m.pos.z)) continue;
      vis++;
      const moving = m.state === 'walk' || m.pose === MPose.sweep || m.pose === MPose.carry;
      this.renderer.push(m.pos.x, m.pos.y + (m.pose === MPose.sleep ? 0.16 : 0), m.pos.z, m.yaw, m.pose, m.phase, moving ? 1 : 0.6, 0, m.robe, m.pants, m.skin, m.acc, m.scale, m.flags, m.pitch);
    }
    this.renderer.end();
    this.updateBall(dt, ctx);
    this.stats.visible = vis;
    this.stats.inside = inside;
    this.stats.walking = walking;
    this.stats.acting = acting;
    this.stats.gliding = gliding;
  }

  private tick(m: Monk, dt: number, ctx: GameContext, h: number, player: THREE.Vector3 | null): void {
    m.t += dt;
    m.greetT = Math.max(0, m.greetT - dt);
    switch (m.state) {
      case 'inside':
        if (m.t > m.dur) {
          if (m.site >= 0) m.pos.copy(this.sites[m.site].door);
          this.next(m, h);
        }
        return;
      case 'greet':
        m.pose = MPose.bow;
        m.phase += dt;
        if (m.t > 1.4) {
          m.state = 'walk';
          m.pose = MPose.walk;
        }
        return;
      case 'walk':
        this.walk(m, dt, ctx, player);
        return;
      case 'glide':
        this.glide(m, dt, ctx);
        return;
      case 'act':
        this.act(m, dt, ctx, h);
        return;
    }
  }

  private walk(m: Monk, dt: number, ctx: GameContext, player: THREE.Vector3 | null): void {
    // m.from is the walker's point on the path's centre line; the body walks in its own lane beside it.
    const target = m.path[m.pi];
    if (!target) {
      this.arrive(m);
      return;
    }
    const dx = target.x - m.from.x, dz = target.z - m.from.z;
    const d = Math.hypot(dx, dz);
    const ux = dx / (d || 1), uz = dz / (d || 1);
    if (player) {
      const px = player.x - m.pos.x, pz = player.z - m.pos.z, pd = Math.hypot(px, pz);
      if (pd < 3.2 && Math.abs(player.y - m.pos.y) < 2 && (px * ux + pz * uz) / (pd || 1) > 0.3) {
        // Someone in the way: step aside, and bow once in a while.
        m.aside = Math.min(1, m.aside + dt * 3);
        if (m.greetT <= 0 && pd < 2.6) {
          m.greetT = 25;
          m.state = 'greet';
          m.t = 0;
          m.yaw = Math.atan2(px, pz);
          return;
        }
      } else m.aside = Math.max(0, m.aside - dt);
    }
    const sp = m.speed * (m.acc === MAcc.buckets ? 0.8 : 1);
    if (d < sp * dt + 0.05) {
      m.from.set(target.x, target.y, target.z);
      m.pi++;
      if (m.pi >= m.path.length) {
        m.pos.copy(m.from);
        this.arrive(m);
      }
      return;
    }
    const prev = m.pi > 0 ? m.path[m.pi - 1] : null;
    m.from.x += ux * sp * dt;
    m.from.z += uz * sp * dt;
    if (prev) {
      const segL = Math.hypot(target.x - prev.x, target.z - prev.z) || 1;
      const t = 1 - Math.min(1, Math.hypot(target.x - m.from.x, target.z - m.from.z) / segL);
      m.from.y = prev.y + (target.y - prev.y) * t;
    }
    // Lane: none at the two ends of the walk, full along the road.
    const ends = Math.min(1, m.pi / 2, (m.path.length - 1 - m.pi) / 2);
    const lane = (m.lane + m.aside * 1.3 * (m.lane >= 0 ? 1 : -1)) * Math.max(0, ends);
    m.pos.set(m.from.x - uz * lane, m.from.y, m.from.z + ux * lane);
    // Feet on the real ground near the camera (stairs, steps).
    if (m.pos.distanceToSquared(ctx.camera.position) < 60 * 60) {
      const g = ctx.world.collision.groundAt(m.pos.x, m.pos.z, m.pos.y + 0.5);
      if (g && Math.abs(g.y - m.pos.y) < 0.6) m.pos.y = g.y;
    }
    m.yaw = turn(m.yaw, Math.atan2(ux, uz), dt * 6);
    m.phase += (sp / 0.62) * Math.PI * dt;
  }

  private arrive(m: Monk): void {
    const s = this.sites[m.site];
    m.path = [];
    m.pi = 0;
    if (!s) {
      m.state = 'inside';
      m.dur = 30;
      m.t = 0;
      return;
    }
    const h = this.ctx?.world.sky.timeOfDay ?? 12;
    this.begin(m, m.site, m.slot, h);
    if (s.kind === 'slot' || s.kind === 'airball' || s.kind === 'sleep') m.yaw = s.slots[m.slot].yaw;
    m.u = 0;
  }

  private act(m: Monk, dt: number, ctx: GameContext, h: number): void {
    const s = this.sites[m.site];
    m.phase += dt * (m.pose === MPose.airbend ? 1.6 : m.pose === MPose.scooter ? 2.2 : m.pose === MPose.walk && s.kind === 'scooter' ? ((s.speed ?? 3) / 0.62) * Math.PI : 1.2);
    const near = m.pos.distanceToSquared(ctx.camera.position) < 45 * 45;
    switch (s.kind) {
      case 'sweep':
      case 'patrol': {
        // Walk slowly round the loop (the night watch walks the road).
        const path = s.kind === 'patrol' ? this.road : s.path!;
        const sp = s.kind === 'patrol' ? 0.9 : 0.55;
        m.u += (sp * dt) / 5;
        const n = path.length;
        const f = s.kind === 'patrol' ? Math.abs(((m.u + m.slot * 7) % (2 * n)) - n) : (m.u + m.slot * 5) % n;
        const k = Math.min(n - 2, Math.floor(f)), t = f - k;
        const a = path[k], b = path[k + 1];
        m.pos.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        const dir = s.kind === 'patrol' && Math.floor((m.u + m.slot * 7) / n) % 2 === 1 ? -1 : 1;
        m.yaw = Math.atan2((b.x - a.x) * dir, (b.z - a.z) * dir);
        if (s.kind === 'patrol') m.phase += (0.9 / 0.62) * Math.PI * dt;
        if (s.kind === 'sweep' && near && this.fx < 6 && Math.sin(m.phase) > 0.97) {
          this.fx += 1;
          this.tv.set(m.pos.x + Math.sin(m.yaw) * 0.9, m.pos.y + 0.15, m.pos.z + Math.cos(m.yaw) * 0.9);
          ctx.vfx.burst('dust', this.tv, { count: 2, radius: 0.4, size: 0.7 });
          ctx.vfx.burst('air', this.tv, { count: 1, radius: 0.3, size: 0.6 });
        }
        break;
      }
      case 'carry': {
        // Back and forth along the planned run with a load.
        const path = s.path!;
        const n = path.length;
        m.u += (m.speed * 0.8 * dt) / Math.max(1, segLen(path) / Math.max(1, n - 1));
        const f = Math.abs(((m.u + m.slot * 1.7) % (2 * (n - 1))) - (n - 1));
        const k = Math.min(n - 2, Math.floor(f)), t = f - k;
        const a = path[k], b = path[k + 1];
        m.pos.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        const back = Math.floor((m.u + m.slot * 1.7) / (n - 1)) % 2 === 1;
        m.yaw = Math.atan2((b.x - a.x) * (back ? -1 : 1), (b.z - a.z) * (back ? -1 : 1));
        m.phase += (m.speed / 0.62) * Math.PI * dt;
        m.pose = MPose.carry;
        break;
      }
      case 'scooter': {
        // Race round the tower on air scooters.
        const path = s.path!;
        m.u += ((s.speed ?? 7.5) * dt) / 6;
        const n = path.length;
        const f = (m.u + m.slot * (n / 4)) % n;
        const k = Math.floor(f), t = f - k;
        const a = path[k], b = path[(k + 1) % n];
        m.pos.set(a.x + (b.x - a.x) * t, a.y, a.z + (b.z - a.z) * t);
        m.yaw = Math.atan2(b.x - a.x, b.z - a.z);
        if (near && this.fx < 6 && (this.frame + m.i) % 20 === 0) {
          this.fx += 1;
          this.tv.set(m.pos.x, m.pos.y + 0.2, m.pos.z);
          ctx.vfx.burst('air', this.tv, { count: 2, radius: 0.5, size: 0.8 });
        }
        break;
      }
      case 'airball': {
        // Hop from pole top to pole top; the ball flies between the players.
        m.u += dt;
        if (m.u > 2.5 + (m.i % 5) * 0.4) {
          const to = this.freeSlot(s);
          if (to >= 0 && Math.hypot(s.slots[to].x - m.pos.x, s.slots[to].z - m.pos.z) < 6) {
            s.slots[m.slot].taken = -1;
            s.slots[to].taken = m.i;
            m.from.copy(m.pos);
            m.slot = to;
            m.u = -0.9;
          } else m.u = 0;
        }
        const sl = s.slots[m.slot];
        if (m.u < 0) {
          const t = 1 + m.u / 0.9;
          m.pos.set(m.from.x + (sl.x - m.from.x) * t, m.from.y + (sl.y - m.from.y) * t + Math.sin(t * Math.PI) * 1.6, m.from.z + (sl.z - m.from.z) * t);
          m.pose = MPose.airbend;
        } else {
          m.pos.set(sl.x, sl.y, sl.z);
          m.pose = MPose.airbend;
        }
        if (this.ballT >= 1 && near && this.rnd.chance(dt * 0.8)) {
          this.ballFrom.set(m.pos.x, m.pos.y + 1.2, m.pos.z);
          const other = this.monks.find((o) => o !== m && o.site === m.site && o.state === 'act');
          if (other) {
            this.ballTo.set(other.pos.x, other.pos.y + 1.2, other.pos.z);
            this.ballT = 0;
            ctx.vfx.burst('air', this.ballFrom, { count: 3, radius: 0.4, size: 0.8 });
          }
        }
        break;
      }
      case 'glide': {
        // At the launch: wait for a clear sky, then run off the edge on the open glider.
        if (m.t > 4) {
          m.state = 'glide';
          m.t = 0;
          m.u = 0;
          m.acc = MAcc.glider;
          m.pose = MPose.glide;
          m.pitch = 1.42;
          m.from.copy(m.pos);
          if (near) ctx.vfx.burst('air', m.pos, { count: 6, radius: 1, size: 1.2 });
        }
        break;
      }
      case 'slot':
      case 'sleep':
      default: {
        const sl = s.slots[m.slot];
        if (sl) {
          m.pos.set(sl.x, sl.y, sl.z);
          m.yaw = sl.yaw;
        }
        if (m.pose === MPose.sleep) m.pitch = -Math.PI / 2;
        if (m.pose === MPose.airbend && near && this.fx < 6 && Math.sin(m.phase * 1.0) > 0.995) {
          this.fx += 1;
          this.tv.set(m.pos.x + Math.sin(m.yaw) * 0.6, m.pos.y + 1.1, m.pos.z + Math.cos(m.yaw) * 0.6);
          ctx.vfx.burst('air', this.tv, { count: 2, radius: 0.5, size: 0.9 });
        }
      }
    }
    // Done (or the hours closed): move on.
    const open = inHours(h, s.hours);
    if ((m.t > m.dur || !open) && s.kind !== 'airball') this.next(m, h);
    else if (s.kind === 'airball' && (m.t > m.dur || !open) && m.u >= 0) this.next(m, h);
  }

  /** Staff glider: a slow spiral down round the pinnacle to the main landing ledge. */
  private glide(m: Monk, dt: number, ctx: GameContext): void {
    const T = 70;
    m.u += dt / T;
    const s0 = shelf('launch');
    const land = shelf('landing_main');
    const t = Math.min(1, m.u);
    const th = s0.a + (land.a + 360 - s0.a) * t * 1.0 + 360 * 0;
    const r = 40 + 75 * Math.sin(t * Math.PI * 0.5) - 6 * t;
    const y = m.from.y + (floorY(land.y) + 2 - m.from.y) * t + Math.sin(t * Math.PI) * 10;
    const p = polar(th, t < 0.92 ? r : land.r1 - ((t - 0.92) / 0.08) * (land.r1 - land.r0 - 6));
    const nx = p.x, nz = p.z;
    m.yaw = Math.atan2(nx - m.pos.x, nz - m.pos.z) || m.yaw;
    m.pos.set(nx, y, nz);
    m.phase += dt * 2;
    if ((this.frame + m.i) % 30 === 0 && m.pos.distanceToSquared(ctx.camera.position) < 80 * 80) ctx.vfx.burst('air', m.pos, { count: 1, radius: 0.6, size: 0.9 });
    if (t >= 1) {
      // Landed on the ledge: fold the glider and walk on.
      m.pitch = 0;
      m.pos.y = floorY(land.y);
      m.acc = MAcc.staff;
      const s = this.sites[m.site];
      s.slots[m.slot].taken = -1;
      m.site = -1;
      m.slot = -1;
      m.state = 'act';
      const h = ctx.world.sky.timeOfDay;
      // Re-join the road from the ledge.
      const si = this.choose(m, h, m.pos);
      if (si >= 0) {
        const ns = this.sites[si];
        const slot = this.freeSlot(ns);
        if (slot >= 0) {
          const a = this.nearestRoad(m.pos), b = ns.attach, step = a <= b ? 1 : -1;
          const path: THREE.Vector3[] = [];
          for (let i = a; i !== b + step; i += step) path.push(this.road[i].clone());
          for (let k = ns.via.length - 1; k >= 0; k--) path.push(ns.via[k].clone());
          path.push(ns.door.clone());
          const sl = ns.slots[slot];
          if (ns.kind === 'slot' || ns.kind === 'airball' || ns.kind === 'glide' || ns.kind === 'sleep') {
            for (const q of sl.via) path.push(q.clone());
            path.push(new THREE.Vector3(sl.x, sl.y, sl.z));
          }
          ns.slots[slot].taken = m.i;
          m.site = si;
          m.slot = slot;
          m.path = path;
          m.pi = 0;
          m.from.copy(m.pos);
          m.state = 'walk';
          m.pose = MPose.walk;
          return;
        }
      }
      m.state = 'inside';
      m.dur = 20;
      m.t = 0;
    }
  }

  private updateBall(dt: number, ctx: GameContext): void {
    if (this.ballT >= 1) {
      this.ball.visible = false;
      return;
    }
    this.ballT = Math.min(1, this.ballT + dt / 1.1);
    const t = this.ballT;
    this.ball.visible = true;
    this.ball.position.lerpVectors(this.ballFrom, this.ballTo, t);
    this.ball.position.y += Math.sin(t * Math.PI) * 2.2;
    if (t >= 1) ctx.vfx.burst('air', this.ballTo, { count: 3, radius: 0.4, size: 0.8 });
  }

  /** Monk positions (tests). */
  positions(): Array<{ x: number; y: number; z: number; state: string; site: string; who: string }> {
    return this.monks.map((m) => ({ x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2), state: m.state, site: this.sites[m.site]?.id ?? '-', who: m.who }));
  }

  dispose(): void {
    this.renderer.dispose();
    this.ball.removeFromParent();
    this.ball.geometry.dispose();
    (this.ball.material as THREE.Material).dispose();
  }
}

function segLen(p: THREE.Vector3[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  return L;
}

function turn(cur: number, want: number, max: number): number {
  const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
  return cur + Math.max(-max, Math.min(max, d));
}

function edgeOf(id: string, th: number): number {
  return rOutAt(terrace(id), th);
}

