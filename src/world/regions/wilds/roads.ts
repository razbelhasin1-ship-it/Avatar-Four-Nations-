import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { roadAt, waterAt } from '../../Heightfield';
import { PLATEAUS, ROADS } from '../../WorldLayout';
import { BRIDGES, CAMPS, FARMS, HIARI, INNS, SHRINES, roadLength, roadPoint } from './layout';
import type { SignName } from './materials';
import { W, barrel, boat, crate, drape, ekHouse, fence, ground, lanternPost, milestone, rng, roadShrine, signpost, stoneArchBridge, v3, yawFacing } from './parts';
import { WildsSite } from './WildsSite';

/**
 * Roads and roadside life between the capitals:
 *  - RoadBridgeSite: stone arch bridges where the roads cross the Great River
 *    (computed crossings, see layout.ts BRIDGES).
 *  - RoadsideSite (one per road): mile stones, junction signposts, shrines.
 *  - InnSite: roadside inns / tea houses with a well and merchant spot.
 *  - FarmSite: farmsteads with fenced fields along the Earth Kingdom roads.
 *  - HiariDockSite: fishing dock on Lake Hiari.
 */

export class RoadBridgeSite extends WildsSite {
  readonly id: string;
  readonly center: { x: number; z: number };
  override readonly loadRadius = 300;
  constructor(private readonly key: keyof typeof BRIDGES) {
    super();
    const b = BRIDGES[key];
    this.id = `wilds_bridge_${key}`;
    this.center = { x: (b.a.x + b.c.x) / 2, z: (b.a.z + b.c.z) / 2 };
  }

  protected construct(_ctx: GameContext): void {
    const b = BRIDGES[this.key];
    const a = v3(b.a.x, b.a.y, b.a.z), c = v3(b.c.x, b.c.y, b.c.z);
    const hump = b.mid - (a.y + c.y) / 2;
    stoneArchBridge(this.major, a, c, { width: b.width, hump, waterY: b.waterY, nArches: b.arches, wall: 'stone_tan', deck: 'paving', rail: 'stone_light' });
    // Newel posts with lanterns at both ends.
    const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz);
    const ux = dx / l, uz = dz / l, nx = -uz, nz = ux;
    for (const [p, dir] of [[a, -1], [c, 1]] as const) {
      for (const s of [-1, 1]) {
        const x = p.x + nx * s * (b.width / 2 + 0.6) + ux * dir * 0.8, z = p.z + nz * s * (b.width / 2 + 0.6) + uz * dir * 0.8;
        const gy = ground(x, z);
        this.major.block('stone_light', { x, y: gy - 0.3, z, sx: 1, sy: 1.9, sz: 1 }, { collide: true });
        this.detail.lantern(v3(x, gy + 1.9, z), { color: 'warm' });
      }
    }
    this.mark('a', a.x, a.y, a.z);
    this.mark('c', c.x, c.y, c.z);
    this.mark('mid', (a.x + c.x) / 2, b.mid, (a.z + c.z) / 2);
  }
}

/** Junction signposts per road (placed at the road's start unless noted). */
const JUNCTIONS: Array<{ road: string; s: number; lat: number; arms: Array<[SignName, number, number]> }> = [
  { road: 'northern_road', s: 683, lat: 7.5, arms: [['OMASHU', -450, -650], ['NORTHERN WATER TRIBE', -220, -1600], ['RIVERBEND', 120, -560], ['BA SING SE', 430, -170]] },
  { road: 'omashu_road', s: 205, lat: 8, arms: [['OMASHU', -380, -680], ['RIVERBEND', -60, -800]] },
  { road: 'western_road', s: 705, lat: -8, arms: [['FOGGY SWAMP', -950, -60], ['FIRE NATION', -780, 700], ['BA SING SE', 240, 60]] },
  { road: 'western_road', s: 31, lat: 7.5, arms: [['GAOLING', 420, 300], ['BA SING SE', 430, -170], ['FOGGY SWAMP', -420, 260], ['FIRE NATION', -780, 700]] },
  { road: 'southern_road', s: 1108, lat: 8, arms: [['SOUTHERN WATER TRIBE', 220, 1600], ['MISTY PALMS', 160, 860], ['GAOLING', 420, 300]] },
  { road: 'eastern_road', s: 640, lat: -8, arms: [['AIR TEMPLE', 1210, 980], ['BA SING SE', 1260, -50]] },
];

/**
 * Roadside props for one stretch [s0, s1) of a road. Roads are split into
 * ~400 m stretches so each stretch streams, culls and LODs on its own.
 */
export class RoadsideSite extends WildsSite {
  readonly id: string;
  readonly center: { x: number; z: number };
  override readonly loadRadius: number;
  constructor(private readonly road: string, private readonly s0: number, private readonly s1: number) {
    super();
    const mid = roadPoint(road, (s0 + s1) / 2);
    this.id = `wilds_roadside_${road}_${Math.round(s0)}`;
    this.center = { x: mid.x, z: mid.z };
    this.loadRadius = (s1 - s0) / 2 + 240;
  }

  /** Factories for every stretch of every road. */
  static factories(): Array<() => RoadsideSite> {
    const out: Array<() => RoadsideSite> = [];
    for (const r of ROADS) {
      const len = roadLength(r.id);
      const n = Math.max(1, Math.round(len / 400));
      for (let i = 0; i < n; i++) {
        const s0 = (len * i) / n, s1 = i === n - 1 ? len + 1 : (len * (i + 1)) / n;
        out.push(() => new RoadsideSite(r.id, s0, s1));
      }
    }
    return out;
  }

  protected construct(_ctx: GameContext): void {
    const D = this.detail;
    const def = ROADS.find((r) => r.id === this.road)!;
    const half = def.width / 2;
    const len = roadLength(this.road);
    const avoid: Array<{ x: number; z: number; r: number }> = [
      ...PLATEAUS.map((p) => ({ x: p.x, z: p.z, r: p.r + p.blend * 0.6 })),
      ...Object.values(BRIDGES).map((b) => ({ x: (b.a.x + b.c.x) / 2, z: (b.a.z + b.c.z) / 2, r: 70 })),
      ...INNS.map((i) => ({ x: i.x, z: i.z, r: 30 })),
      ...FARMS.map((f) => ({ x: f.x, z: f.z, r: 40 })),
      ...CAMPS.map((c) => ({ x: c.x, z: c.z, r: 25 })),
      { x: 850, z: -50, r: 440 }, // Ba Sing Se walls
      { x: -1300, z: 1320, r: 560 }, // Fire Nation capital (volcano, Harbor City, harbour)
    ];
    const clear = (x: number, z: number) => !avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r) && !waterAt(x, z) && !roadAt(x, z, 0.6);
    // Mile stones every 200 m, alternating sides.
    let n = 0, side = 1;
    for (let s = 100; s < len - 40; s += 200) {
      side = -side;
      if (s < this.s0 || s >= this.s1) continue;
      const p = roadPoint(this.road, s, side * (half + 2.2));
      if (!clear(p.x, p.z)) continue;
      const r = roadPoint(this.road, s, 0);
      milestone(D, p.x, p.z, yawFacing(r.x - p.x, r.z - p.z));
      n++;
    }
    this.mark('milestones', n, 0, 0);
    // Junction signposts.
    let signs = 0;
    for (const j of JUNCTIONS) {
      if (j.road !== this.road || j.s < this.s0 || j.s >= this.s1) continue;
      let lat = j.lat;
      let p = roadPoint(this.road, j.s, lat);
      for (let k = 0; k < 6 && roadAt(p.x, p.z, 1); k++) {
        lat += Math.sign(lat) * 2;
        p = roadPoint(this.road, j.s, lat);
      }
      signpost(D, p.x, p.z, j.arms.map(([name, x, z]) => ({ name, toward: { x, z } })));
      this.mark(`sign_${signs++}`, p.x, ground(p.x, p.z), p.z);
    }
    // Roadside shrines.
    for (const s of SHRINES) {
      if (s.road !== this.road || s.s < this.s0 || s.s >= this.s1) continue;
      roadShrine(D, s.x, s.z, s.face);
      lanternPost(D, s.x + Math.cos(s.face) * 2.4, s.z - Math.sin(s.face) * 2.4, 'red');
      this.mark(`shrine_${s.id}`, s.x, ground(s.x, s.z), s.z);
    }
  }
}

export class InnSite extends WildsSite {
  readonly id: string;
  readonly center: { x: number; z: number };
  override readonly loadRadius = 280;
  constructor(private readonly idx: number) {
    super();
    const inn = INNS[idx];
    this.id = `wilds_inn_${inn.id}`;
    this.center = { x: inn.x, z: inn.z };
  }

  protected construct(_ctx: GameContext): void {
    const inn = INNS[this.idx];
    const M = this.major, D = this.detail, Cl = this.clutter;
    const r = rng(700 + this.idx);
    const yaw = inn.face;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), cx = Math.cos(yaw), cz = -Math.sin(yaw);
    const at = (along: number, front: number) => ({ x: inn.x + cx * along + fx * front, z: inn.z + cz * along + fz * front });
    // Main house: two floors, green roof, veranda.
    ekHouse(M, inn.x, inn.z, yaw, { w: 12, d: 8.5, floors: 2, wall: this.idx === 1 ? 'plaster_green' : 'plaster_cream', roof: this.idx === 1 ? 'roof_teal' : 'roof_green' });
    const gy = ground(inn.x, inn.z);
    const vp = at(0, 5.6);
    M.box('roof_green', { x: vp.x, y: gy + 3.5, z: vp.z, sx: 12.5, sy: 0.2, sz: 2.8, yaw, pitch: -0.2 });
    for (const k of [-5.6, -1.9, 1.9, 5.6]) {
      const p = at(k, 6.7);
      D.box('wood_red', { x: p.x, y: ground(p.x, p.z) + 1.6, z: p.z, sx: 0.2, sy: 3.4, sz: 0.2 }, { collide: true, walkable: false });
    }
    const sign = at(0, 4.35);
    D.box('black_lacquer', { x: sign.x, y: gy + 4.4, z: sign.z, sx: 3.2, sy: 0.8, sz: 0.08, yaw });
    D.box('gold', { x: sign.x + fx * 0.05, y: gy + 4.4, z: sign.z + fz * 0.05, sx: 2.4, sy: 0.18, sz: 0.04, yaw }, { castShadow: false });
    for (const k of [-6.2, 6.2]) {
      const p = at(k, 6.7);
      D.lantern(v3(p.x, ground(p.x, p.z) + 3, p.z), { color: 'red' });
    }
    // Tables and benches on the forecourt.
    for (const k of [-3.6, 3.6]) {
      const p = at(k, 9.5);
      const y = ground(p.x, p.z);
      D.box('wood', { x: p.x, y: y + 0.75, z: p.z, sx: 2.2, sy: 0.12, sz: 1, yaw }, { collide: true, walkable: true, surface: 'wood' });
      D.box('wood_dark', { x: p.x, y: y + 0.35, z: p.z, sx: 0.3, sy: 0.7, sz: 0.3, yaw });
      for (const s of [-1, 1]) D.box('wood_dark', { x: p.x + fx * s * 1, y: y + 0.42, z: p.z + fz * s * 1, sx: 2, sy: 0.1, sz: 0.4, yaw });
    }
    // Stable: open shed on posts with hay, beside the house.
    {
      const st = at(-12, -1);
      const y = ground(st.x, st.z);
      for (const a of [-2.6, 2.6]) for (const f of [-2, 2]) {
        const p = { x: st.x + cx * a + fx * f, z: st.z + cz * a + fz * f };
        D.box('wood_dark', { x: p.x, y: y + 1.5, z: p.z, sx: 0.22, sy: 3, sz: 0.22 }, { collide: true, walkable: false });
      }
      M.roof('roof_dark', { x: st.x, y: y + 3, z: st.z, w: 5.6, d: 4.4, height: 1.3, yaw, style: 'gable', overhang: 0.4 });
      for (let k = 0; k < 3; k++) D.cylinder(W('straw'), { x: st.x + cx * (k - 1) * 1.4, y, z: st.z + cz * (k - 1) * 1.4, r: 0.6, h: 0.9, segments: 10 }, { collide: true, surface: 'grass' });
      fence(D, [at(-15, 3), at(-15, -5), at(-9, -5)], { h: 1.1 });
    }
    // Well (registered water source).
    {
      const w = at(9.5, 3);
      const y = ground(w.x, w.z);
      M.cylinder('stone_grey', { x: w.x, y: y - 0.1, z: w.z, r: 1.1, h: 0.9, segments: 14 }, { collide: true });
      for (const s of [-1, 1]) D.box('wood_dark', { x: w.x + cx * s * 1, y: y + 1.3, z: w.z + cz * s * 1, sx: 0.14, sy: 2, sz: 0.14 });
      D.roof('roof_dark', { x: w.x, y: y + 2.3, z: w.z, w: 2, d: 1.6, height: 0.6, yaw, style: 'gable', overhang: 0.2, ridge: null });
      this.waterSurface({ id: `wilds:inn_well_${inn.id}`, label: `${inn.name} well`, x: w.x, y: y + 0.75, z: w.z, w: 1.7, d: 1.7, circle: true, type: 'fountain', capacity: 40, regen: 1 });
      this.mark('well', w.x, y + 0.75, w.z);
    }
    // Goods by the door.
    for (let k = 0; k < 3; k++) {
      const p = at(4.5 + k * 0.9, 5.2);
      if (k === 1) barrel(D, p.x, p.z);
      else crate(D, p.x, p.z, 0.7, yaw + r());
    }
    // Path from the road.
    drape(D, 'paving_dark', (inn.x + fx * 4.25 + inn.roadX) / 2, (inn.z + fz * 4.25 + inn.roadZ) / 2, 3, Math.hypot(inn.roadX - inn.x, inn.roadZ - inn.z) - 4, { yaw, lift: 0.05, tile: 3 });
    for (let i = 0; i < 8; i++) {
      const p = at((r() - 0.5) * 30, -6 - r() * 6);
      const m = new THREE.Matrix4().compose(v3(p.x, ground(p.x, p.z) + 0.3, p.z), new THREE.Quaternion(), v3(1 + r(), 0.7 + r() * 0.4, 1 + r()));
      Cl.instance('inn_bush', () => new THREE.IcosahedronGeometry(0.7, 1), W('foliage'), m);
    }
    this.mark('inn', inn.x, gy, inn.z);
  }
}

export class FarmSite extends WildsSite {
  readonly id: string;
  readonly center: { x: number; z: number };
  override readonly loadRadius = 280;
  constructor(private readonly idx: number) {
    super();
    const f = FARMS[idx];
    this.id = `wilds_farm_${f.id}`;
    this.center = { x: f.x, z: f.z };
  }

  protected construct(_ctx: GameContext): void {
    const f = FARMS[this.idx];
    const M = this.major, D = this.detail;
    const r = rng(f.seed * 31);
    const yaw = f.face;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), cx = Math.cos(yaw), cz = -Math.sin(yaw);
    const at = (along: number, front: number) => ({ x: f.x + cx * along + fx * front, z: f.z + cz * along + fz * front });
    // Farmhouse (faces the road) and a barn.
    ekHouse(M, f.x, f.z, yaw, { w: 8, d: 6, floors: 1, wall: 'plaster_tan', roof: 'roof_dark', base: 'stone_grey' });
    const barn = at(11, -3);
    ekHouse(M, barn.x, barn.z, yaw + Math.PI / 2, { w: 9, d: 6.5, floors: 1, wall: 'wood', roof: 'roof_dark', roofStyle: 'gable', base: 'stone_dark' });
    // Fields behind the house (away from the road), skipped where a road would cut through.
    let fields = 0;
    for (let i = 0; i < 4; i++) {
      const along = -15 + (i % 2) * 22, back = -14 - Math.floor(i / 2) * 17;
      const c = at(along, back);
      const w = 18, d = 13;
      const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => ({ x: c.x + cx * a + fx * b, z: c.z + cz * a + fz * b }));
      if (corners.some((p) => roadAt(p.x, p.z, 1.5) || waterAt(p.x, p.z)) || roadAt(c.x, c.z, 1.5)) continue;
      drape(D, W(i % 3 === 1 ? 'crops_gold' : 'crops'), c.x, c.z, w - 1, d - 1, { yaw, lift: 0.04, tile: 2.5, seg: 6 });
      const gate = i % 2 === 0 ? 1 : 0;
      fence(D, [corners[gate], corners[(gate + 1) % 4], corners[(gate + 2) % 4], corners[(gate + 3) % 4]], { h: 1 });
      fields++;
    }
    this.mark('fields', fields, 0, 0);
    // Scarecrow, haystacks, cart.
    {
      const s = at(-4, -22);
      const y = ground(s.x, s.z);
      D.box('wood_dark', { x: s.x, y: y + 1.1, z: s.z, sx: 0.12, sy: 2.2, sz: 0.12 }, { collide: true, walkable: false });
      D.box('wood_dark', { x: s.x, y: y + 1.6, z: s.z, sx: 1.6, sy: 0.1, sz: 0.1, yaw });
      D.mesh(W('straw'), new THREE.SphereGeometry(0.3, 8, 6), { x: s.x, y: y + 2.3, z: s.z });
      D.box('cloth_blue', { x: s.x, y: y + 1.45, z: s.z, sx: 0.9, sy: 0.9, sz: 0.3, yaw });
      for (let k = 0; k < 3; k++) {
        const h = at(16 + k * 2.4, -9 + (k % 2) * 2);
        const hy = ground(h.x, h.z);
        D.cylinder(W('straw'), { x: h.x, y: hy - 0.1, z: h.z, r: 1.1, rTop: 0.9, h: 1.4, segments: 12 }, { collide: true, surface: 'grass' });
        D.cylinder(W('straw'), { x: h.x, y: hy + 1.3, z: h.z, r: 0.95, rTop: 0.05, h: 0.9, segments: 12 });
      }
      const cart = at(-7, 5);
      crate(D, cart.x, cart.z, 0.9, yaw + 0.3);
      barrel(D, cart.x + cx * 1.3, cart.z + cz * 1.3);
    }
    lanternPost(D, at(-4.5, 4.5).x, at(-4.5, 4.5).z, 'warm');
    void r;
  }
}

export class HiariDockSite extends WildsSite {
  readonly id = 'wilds_hiari_dock';
  readonly center = { x: HIARI.shore.x, z: HIARI.shore.z };
  override readonly loadRadius = 250;

  protected construct(_ctx: GameContext): void {
    const H = HIARI;
    const M = this.major, D = this.detail;
    const y = H.deckY;
    M.bridge({ a: v3(H.shore.x, Math.max(y, ground(H.shore.x, H.shore.z) + 0.05), H.shore.z), b: v3(H.pierEnd.x, y, H.pierEnd.z), width: 2.6, deck: 'wood', rail: null, support: 'wood_dark', supportBottom: y - 4, surface: 'wood' });
    M.box('wood', { x: H.pierEnd.x + 1.2, y: y - 0.2, z: H.pierEnd.z, sx: 3, sy: 0.4, sz: 5.5 }, { collide: true, surface: 'wood' });
    const lake = waterAt(H.pierEnd.x, H.pierEnd.z);
    const wl = lake ? lake.level : y - 0.95;
    boat(D, H.pierEnd.x + 6, wl + 0.02, H.pierEnd.z + 3.6, 0.1, 5.5);
    boat(D, H.pierEnd.x + 2, wl + 0.02, H.pierEnd.z - 4.2, Math.PI + 0.2, 6, { mast: true, sail: 'cloth_white' });
    // Fisher's hut, nets drying, crates.
    const hy = ground(H.hut.x, H.hut.z);
    ekHouse(M, H.hut.x, H.hut.z, -Math.PI / 2, { w: 6, d: 5, wall: 'wood', roof: 'roof_dark', y: hy });
    for (const dz of [-1.6, 1.6]) D.box('wood_dark', { x: H.shore.x + 2.5, y: ground(H.shore.x + 2.5, H.shore.z + 6 + dz) + 1, z: H.shore.z + 6 + dz, sx: 0.14, sy: 2, sz: 0.14 }, { collide: true, walkable: false });
    D.box('cloth_white', { x: H.shore.x + 2.5, y: ground(H.shore.x + 2.5, H.shore.z + 6) + 1.4, z: H.shore.z + 6, sx: 0.05, sy: 1.3, sz: 3.2 }, { castShadow: false });
    crate(D, H.shore.x + 4, H.shore.z - 3.5, 0.8, 0.3);
    barrel(D, H.shore.x + 5.3, H.shore.z - 3.3);
    lanternPost(D, H.shore.x + 1, H.shore.z + 2, 'warm');
    this.mark('pierEnd', H.pierEnd.x + 1.5, y, H.pierEnd.z);
    this.mark('shore', H.shore.x + 3, ground(H.shore.x + 3, H.shore.z), H.shore.z);
  }
}
