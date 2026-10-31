import * as THREE from 'three';
import type { GameContext } from '../../../../core/GameContext';
import type { Emitter } from '../../../../vfx/VFX';
import { hullGeo } from '../geom';
import { crimsonMat, steelDarkMat, steelMat } from '../materials';
import { harborRefs } from './harbor';
import { CONFIG, FNC, HARBOR, PLAZA, atAxis, harborHalf } from './layout';
import { tankGeometry } from './machines';

/**
 * Harbour traffic and machines of the Fire Nation capital (counts from CONFIG):
 *  - Empire-class warships (steel hull, crimson trim, bridge, two smoking funnels, a flag mast):
 *    moored along both quays and the finger piers (walkable decks), two at anchor in the roads,
 *    and two that keep a schedule — in from the south-west, the Gates of Azulon swinging open
 *    before them, up the channel to the inner berth, loading, backing out, turning and steaming
 *    away to the south-east (the two never share the channel); a horn at the gate;
 *  - small boats bobbing in the harbour and the roads;
 *  - tundra tanks drilling up and down the plaza's side lanes (moving colliders, exhaust puffs),
 *    parked at the lane ends during rallies;
 *  - war balloons drifting high over the city.
 */

export const SHIP = { L: 44, B: 9, H: 5.2, draft: 2.4 };
/** Seconds per arrival/departure cycle; the two movers run half a cycle apart. */
const CYCLE = 300;
const BERTH_S = FNC.harbor.s0 + 8 + SHIP.L / 2 + 2;
const TURN_S = FNC.seaWallS - 38;
/** Inbound and outbound routes (axis t, s): sea → gate → berth; turn point → gate → sea. */
export const SHIP_IN: Array<[number, number]> = [[-430, 1000], [-230, 935], [-70, 862], [-9, 815], [-8, 776], [-2, 742], [0, BERTH_S]];
export const SHIP_OUT: Array<[number, number]> = [[0, TURN_S], [8, 772], [10, 805], [60, 860], [220, 935], [430, 1000]];

/** Moored and anchored berths (centre t, s and heading). */
export function berths(): Array<{ t: number; s: number; yaw: number }> {
  const out: Array<{ t: number; s: number; yaw: number }> = [];
  const Q = FNC.harbor;
  const k = (Q.half1 - Q.half0) / (Q.s1 - Q.s0);
  const n = Math.hypot(1, k);
  const off = SHIP.B / 2 + 1.3;
  for (const side of [-1, 1]) {
    // Along the slanted quay faces, clear of the water's edge.
    for (const s of [693, 742]) out.push({ t: side * (harborHalf(s) - off / n), s: s + (k * off) / n, yaw: Math.atan2(side * k, 1) + Math.PI });
    // Both sides of each finger pier.
    for (const o of [-1, 1]) out.push({ t: side * 22 + o * (HARBOR.pierW / 2 + SHIP.B / 2 + 0.8), s: Q.s0 + 8 + 32, yaw: Math.PI });
  }
  // At anchor in the roads outside the sea wall.
  out.push({ t: -170, s: 905, yaw: 0.35 }, { t: 175, s: 890, yaw: -0.45 });
  return out;
}

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}
function cyl(r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nrm.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  for (const g of list) g.dispose();
  for (const g of parts) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}

/** Warship parts in the local frame (bow +Z, waterline y = 0): hull, steel, dark, crimson. */
function shipGeo(): THREE.BufferGeometry[] {
  const { L, B, H, draft } = SHIP;
  const hull = hullGeo(L, B, H);
  hull.translate(0, -draft, 0);
  const top = H - draft;
  const steel = merge([
    box(B * 0.8, 0.3, L * 0.8, 0, top + 0.15, -1),
    box(6.4, 4.6, 7, 0, top + 2.3, -6),
    box(4.6, 2.2, 5, 0, top + 5.7, -6.6),
    box(3.4, 1.2, 9, 0, top + 0.9, 8),
    box(2.2, 1.4, 2.8, 0, top + 1.4, 15),
  ]);
  const dark = merge([
    cyl(1.15, 1.25, 7.5, 0, top + 0.3, 1.5),
    cyl(1.15, 1.25, 7.5, 0, top + 0.3, 5.6),
    cyl(0.22, 0.22, 3.6, 0, top + 1.6, 18.6),
    cyl(0.16, 0.16, 12, 0, top + 4.5, -9.6, 6),
    box(6.6, 0.4, 7.2, 0, top + 4.8, -6),
  ]);
  const red = merge([
    box(B * 1.0, 0.45, L * 0.84, 0, top - 0.35, -0.5),
    cyl(1.3, 1.3, 0.8, 0, top + 6.2, 1.5),
    cyl(1.3, 1.3, 0.8, 0, top + 6.2, 5.6),
    box(0.08, 2.2, 3.2, 0, top + 14.2, -8.0),
  ]);
  return [hull, steel, dark, red];
}

function boatGeo(): THREE.BufferGeometry[] {
  const hull = hullGeo(7, 2.2, 1.2);
  hull.translate(0, -0.5, 0);
  const deck = merge([box(1.6, 1.1, 2.2, 0, 0.9, -0.6), cyl(0.06, 0.06, 4, 0, 0.6, 1.2, 5)]);
  return [hull, deck];
}

interface Route {
  pts: Float32Array;
  len: Float32Array;
  total: number;
}

/** Dense route polyline with cumulative lengths (Catmull-Rom through the control points). */
export function route(ctrl: Array<[number, number]>): Route {
  const P = ctrl.map(([t, s]) => atAxis(t, s));
  const out: number[] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const n = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / 6));
    for (let k = 0; k < n; k++) {
      const u = k / n, u2 = u * u, u3 = u2 * u;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      out.push(f(p0.x, p1.x, p2.x, p3.x), f(p0.z, p1.z, p2.z, p3.z));
    }
  }
  out.push(P[P.length - 1].x, P[P.length - 1].z);
  const pts = new Float32Array(out);
  const len = new Float32Array(pts.length / 2);
  for (let i = 1; i < len.length; i++) len[i] = len[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  return { pts, len, total: len[len.length - 1] };
}

function along(r: Route, d: number, out: { x: number; z: number; yaw: number }): void {
  const L = r.len;
  let i = 1;
  while (i < L.length - 1 && L[i] < d) i++;
  const a = i - 1;
  const k = Math.min(1, Math.max(0, (d - L[a]) / Math.max(1e-6, L[i] - L[a])));
  const ax = r.pts[a * 2], az = r.pts[a * 2 + 1], bx = r.pts[i * 2], bz = r.pts[i * 2 + 1];
  out.x = ax + (bx - ax) * k;
  out.z = az + (bz - az) * k;
  out.yaw = Math.atan2(bx - ax, bz - az);
}

const ease = (k: number): number => {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
};

interface Mover {
  group: THREE.Group;
  offset: number;
  smoke: Emitter[];
  x: number;
  z: number;
  yaw: number;
  s: number;
  visible: boolean;
  horned: number;
}

export class Vessels {
  readonly root = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly inst: THREE.InstancedMesh[] = [];
  private readonly movers: Mover[] = [];
  private readonly moored: Array<{ x: number; z: number; yaw: number }> = [];
  private readonly mooredSmoke: Emitter[] = [];
  private readonly boats: Array<{ g: THREE.Group; cx: number; cz: number; rx: number; rz: number; w: number; p: number }> = [];
  private readonly tanks: Array<{ g: THREE.Group; t: number; s0: number; s1: number; s: number; dir: number; turn: number; collider: number; puff: number; yaw: number }> = [];
  private readonly balloons: Array<{ g: THREE.Group; cx: number; cz: number; r: number; y: number; w: number; p: number }> = [];
  private readonly colliders: number[] = [];
  private readonly rIn = route(SHIP_IN);
  private readonly rOut = route(SHIP_OUT);
  private readonly tmp = { x: 0, z: 0, yaw: 0 };
  private readonly tmpV = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private gateOpen = 0;
  /** Tanks hold at the lane ends (rallies). */
  parked = false;
  time = 0;

  constructor(parent: THREE.Object3D) {
    this.root.name = 'fnc_vessels';
    parent.add(this.root);
  }

  build(ctx: GameContext): void {
    const parts = shipGeo();
    this.geos.push(...parts);
    const mats = [steelDarkMat(), steelMat(), steelDarkMat(), crimsonMat()];
    const list = berths().slice(0, Math.max(0, CONFIG.warships - 2));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    parts.forEach((g, i) => {
      const im = new THREE.InstancedMesh(g, mats[i], Math.max(1, list.length));
      im.castShadow = true;
      im.receiveShadow = true;
      list.forEach((bt, k) => {
        const p = atAxis(bt.t, bt.s);
        im.setMatrixAt(k, m4.compose(this.tmpV.set(p.x, 0, p.z), q.setFromAxisAngle(this.up, bt.yaw), one));
      });
      im.computeBoundingSphere();
      this.root.add(im);
      this.inst.push(im);
    });
    // Walkable decks; the bridge and funnels are solid.
    const col = ctx.world.collision;
    const top = SHIP.H - SHIP.draft;
    for (const bt of list) {
      const p = atAxis(bt.t, bt.s);
      this.moored.push({ x: p.x, z: p.z, yaw: bt.yaw });
      const c = Math.cos(bt.yaw), s = Math.sin(bt.yaw);
      const add = (lx: number, lz: number, def: { shape: 'box' | 'cylinder'; y: number; hx?: number; hy: number; hz?: number; r?: number }): void => {
        const wx = p.x + lz * s + lx * c, wz = p.z + lz * c - lx * s;
        this.colliders.push(col.add({ ...def, x: wx, z: wz, yaw: bt.yaw, walkable: true, solid: true, tag: 'fnc_ship' }));
      };
      const hullY = (top + 0.3 - SHIP.draft) / 2, hullH = (top + 0.3 + SHIP.draft) / 2;
      add(0, -8, { shape: 'box', y: hullY, hx: SHIP.B / 2 - 0.2, hy: hullH, hz: 14 });
      add(0, 12, { shape: 'box', y: hullY, hx: 2.4, hy: hullH, hz: 6 });
      add(0, -6, { shape: 'box', y: top + 2.3, hx: 3.2, hy: 2.3, hz: 3.5 });
      for (const lz of [1.5, 5.6]) add(0, lz, { shape: 'cylinder', y: top + 4.05, r: 1.25, hy: 3.75 });
    }
    // The two scheduled ships.
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group();
      parts.forEach((pg, i) => {
        const m = new THREE.Mesh(pg, mats[i]);
        m.castShadow = true;
        g.add(m);
      });
      g.visible = false;
      this.root.add(g);
      this.movers.push({ group: g, offset: k * (CYCLE / 2), smoke: [], x: 0, z: 0, yaw: 0, s: 0, visible: false, horned: -1 });
    }
    // Small boats: half out in the roads, half in the basin.
    const bg = boatGeo();
    this.geos.push(...bg);
    const wood = new THREE.MeshStandardMaterial({ color: '#6a4a30', roughness: 0.9 });
    this.mats.push(wood);
    for (let k = 0; k < CONFIG.boats; k++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bg[0], k % 3 ? wood : crimsonMat()), new THREE.Mesh(bg[1], k % 2 ? wood : steelMat()));
      this.root.add(g);
      const outside = k < CONFIG.boats / 2;
      const side = k % 2 ? -1 : 1;
      const c = outside ? atAxis(side * (70 + (k % 3) * 40), FNC.seaWallS + 70 + (k % 4) * 24) : atAxis(side * (40 + (k % 3) * 10), 718 + (k % 3) * 12);
      this.boats.push({ g, cx: c.x, cz: c.z, rx: outside ? 30 + (k % 5) * 8 : 5 + (k % 3) * 2, rz: outside ? 16 + (k % 4) * 6 : 3.5, w: (0.03 + (k % 4) * 0.012) * (k % 2 ? 1 : -1), p: k * 1.7 });
    }
    // Tundra tanks in the plaza's side lanes.
    const tc = tankGeometry();
    const tg = { steel: tc.steel.clone(), dark: tc.dark.clone(), red: tc.red.clone() };
    this.geos.push(tg.steel, tg.dark, tg.red);
    for (let k = 0; k < Math.min(4, CONFIG.tanks); k++) {
      const side = k % 2 ? 1 : -1;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(tg.steel, steelMat()), new THREE.Mesh(tg.dark, steelDarkMat()), new THREE.Mesh(tg.red, crimsonMat()));
      g.traverse((o) => (o.castShadow = true));
      this.root.add(g);
      const s = k > 1 ? 626 : 584;
      const id = col.add({ shape: 'box', x: 0, y: PLAZA.y + 1.4, z: 0, hx: 1.8, hy: 1.4, hz: 3.8, yaw: 0, walkable: true, solid: true, tag: 'fnc_tank' }, true);
      this.tanks.push({ g, t: side * 15.4, s0: 574, s1: 636, s, dir: k > 1 ? -1 : 1, turn: 0, collider: id, puff: k * 0.3, yaw: k > 1 ? Math.PI : 0 });
    }
    // War balloons over the city.
    const bm = {
      env: new THREE.MeshStandardMaterial({ color: '#a8261c', roughness: 0.85 }),
      band: new THREE.MeshStandardMaterial({ color: '#1c1414', roughness: 0.8 }),
      basket: new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 0.9 }),
    };
    this.mats.push(bm.env, bm.band, bm.basket);
    const envG = new THREE.SphereGeometry(7, 16, 12);
    envG.scale(1, 1.18, 1);
    const bandG = new THREE.CylinderGeometry(7.05, 6.4, 2.2, 16, 1, true);
    const basketG = new THREE.BoxGeometry(3.2, 1.6, 3.2);
    const ropeG = new THREE.CylinderGeometry(0.04, 0.04, 6.2, 4);
    this.geos.push(envG, bandG, basketG, ropeG);
    for (let k = 0; k < CONFIG.balloons; k++) {
      const g = new THREE.Group();
      const e = new THREE.Mesh(envG, bm.env);
      e.position.y = 12;
      const b = new THREE.Mesh(bandG, bm.band);
      b.position.y = 9.2;
      const bk = new THREE.Mesh(basketG, bm.basket);
      bk.position.y = 0.8;
      g.add(e, b, bk);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const r = new THREE.Mesh(ropeG, bm.basket);
        r.position.set(x * 2.2, 4.6, z * 2.2);
        g.add(r);
      }
      this.root.add(g);
      const c = atAxis(-60 + k * 70, 400 + (k % 2) * 70);
      this.balloons.push({ g, cx: c.x, cz: c.z, r: 150 + k * 45, y: 175 + k * 22, w: 0.012 + k * 0.004, p: k * 2.1 });
    }
  }

  /** Where a scheduled ship is at second u of its cycle. */
  private pose(m: Mover, u: number): void {
    const o = this.tmp;
    m.visible = u < 225;
    if (u < 70) {
      along(this.rIn, this.rIn.total * ease(u / 70), o);
      m.yaw = o.yaw;
    } else if (u < 130) {
      along(this.rIn, this.rIn.total, o);
      m.yaw = Math.PI;
    } else if (u < 150) {
      const p = atAxis(0, BERTH_S + (TURN_S - BERTH_S) * ease((u - 130) / 20));
      o.x = p.x;
      o.z = p.z;
      m.yaw = Math.PI;
    } else if (u < 165) {
      const p = atAxis(0, TURN_S);
      o.x = p.x;
      o.z = p.z;
      m.yaw = Math.PI + Math.PI * ease((u - 150) / 15);
    } else {
      along(this.rOut, this.rOut.total * ease((u - 165) / 60), o);
      m.yaw = o.yaw;
    }
    m.x = o.x;
    m.z = o.z;
    m.s = o.z - FNC.V.z;
  }

  /** Per frame while the region is near. */
  update(dt: number, ctx: GameContext): void {
    this.time += dt;
    const t = this.time;
    const cam = ctx.camera.position;
    const lis = ctx.player?.position ?? cam;
    const near = (x: number, z: number, r: number) => Math.abs(cam.x - x) + Math.abs(cam.z - z) < r;
    // --- Scheduled warships.
    let wantOpen = 0;
    for (const m of this.movers) {
      const clock = t + m.offset + 20;
      const u = clock % CYCLE;
      this.pose(m, u);
      const g = m.group;
      g.visible = m.visible;
      g.position.set(m.x, Math.sin(t * 0.6 + m.offset) * 0.1, m.z);
      g.rotation.set(0, m.yaw, Math.sin(t * 0.5 + m.offset) * 0.01);
      if (m.visible && m.s > TURN_S - 30 && m.s < FNC.seaWallS + 60) wantOpen = 1;
      // A long blast on the horn as the ship nears the gate, each way.
      const lap = Math.floor(clock / CYCLE) * 2 + (u < 100 ? 0 : 1);
      if (m.visible && Math.abs(m.s - (FNC.seaWallS + 45)) < 12 && m.horned !== lap) {
        m.horned = lap;
        if (Math.hypot(lis.x - m.x, lis.z - m.z) < 900) ctx.audio.play('fnc_horn', { position: this.tmpV.set(m.x, 12, m.z), volume: 1, pitch: m.offset ? 0.92 : 1 });
      }
      const emit = m.visible && near(m.x, m.z, 700);
      if (emit && !m.smoke.length) {
        for (let k = 0; k < 2; k++) m.smoke.push(ctx.vfx.emitter('smoke', 2.5, { size: 2.4, speed: 1.4, color: '#3e3836', color2: '#8a8480', life: 5, dir: this.up, spread: 0.2 }));
      } else if (!emit && m.smoke.length) {
        for (const e of m.smoke) e.stop();
        m.smoke.length = 0;
      }
      const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
      for (let k = 0; k < m.smoke.length; k++) {
        const lz = k ? 5.6 : 1.5;
        m.smoke[k].position.set(m.x + lz * s, SHIP.H - SHIP.draft + 8.3, m.z + lz * c);
      }
    }
    // Moored ships: thin smoke from the first funnel when near.
    const mooredNear = this.moored.length > 0 && near(this.moored[0].x, this.moored[0].z, 600);
    if (mooredNear && !this.mooredSmoke.length) {
      for (const b of this.moored) {
        const e = ctx.vfx.emitter('smoke', 0.9, { size: 2, speed: 1, color: '#4a4442', color2: '#8a8480', life: 5, dir: this.up, spread: 0.2 });
        e.position.set(b.x + 1.5 * Math.sin(b.yaw), SHIP.H - SHIP.draft + 8.3, b.z + 1.5 * Math.cos(b.yaw));
        this.mooredSmoke.push(e);
      }
    } else if (!mooredNear && this.mooredSmoke.length) {
      for (const e of this.mooredSmoke) e.stop();
      this.mooredSmoke.length = 0;
    }
    // --- The Gates of Azulon swing in for the ships.
    this.gateOpen += (wantOpen - this.gateOpen) * Math.min(1, dt * 0.3);
    harborRefs.leaves.forEach((pv, i) => {
      const side = i === 0 ? -1 : 1;
      pv.rotation.y = -side * 1.4 * ease(this.gateOpen);
    });
    // --- Small boats bob along slow loops.
    for (const b of this.boats) {
      const a = t * b.w + b.p;
      b.g.position.set(b.cx + Math.cos(a) * b.rx, Math.sin(t * 1.3 + b.p) * 0.15, b.cz + Math.sin(a) * b.rz);
      const vx = -Math.sin(a) * b.rx * b.w, vz = Math.cos(a) * b.rz * b.w;
      b.g.rotation.set(0, Math.atan2(vx, vz), Math.sin(t * 1.1 + b.p) * 0.05);
    }
    // --- Tanks drill along the plaza's side lanes (or hold at the ends).
    for (const k of this.tanks) {
      if (this.parked) {
        const end = k.s < (k.s0 + k.s1) / 2 ? k.s0 : k.s1;
        const d = end - k.s;
        if (Math.abs(d) > 0.05) {
          k.s += Math.sign(d) * Math.min(Math.abs(d), 2.4 * dt);
          const want = d > 0 ? 0 : Math.PI;
          k.yaw += Math.atan2(Math.sin(want - k.yaw), Math.cos(want - k.yaw)) * Math.min(1, dt * 1.5);
        }
        k.turn = 0;
      } else if (k.turn > 0) {
        k.turn -= dt;
        k.yaw += (Math.PI / 2.6) * dt;
        if (k.turn <= 0) {
          k.dir = -k.dir;
          k.yaw = k.dir > 0 ? 0 : Math.PI;
        }
      } else {
        k.s += k.dir * 2.4 * dt;
        k.yaw = k.dir > 0 ? 0 : Math.PI;
        if (k.s > k.s1 || k.s < k.s0) {
          k.s = Math.min(k.s1, Math.max(k.s0, k.s));
          k.turn = 2.6;
        }
      }
      const p = atAxis(k.t, k.s);
      k.g.position.set(p.x, PLAZA.y, p.z);
      k.g.rotation.y = k.yaw;
      ctx.world.collision.update(k.collider, { x: p.x, z: p.z, yaw: k.yaw });
      k.puff -= dt;
      if (k.puff <= 0 && near(p.x, p.z, 140)) {
        k.puff = 0.7;
        const bx = p.x - Math.sin(k.yaw) * 3.4, bz = p.z - Math.cos(k.yaw) * 3.4;
        ctx.vfx.burst('smoke', this.tmpV.set(bx, PLAZA.y + 2.6, bz), { count: 2, size: 0.9, speed: 0.7, color: '#3a3634', life: 2 });
      }
    }
    // --- War balloons drift in wide circles.
    for (const b of this.balloons) {
      const a = t * b.w + b.p;
      b.g.position.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(t * 0.2 + b.p) * 3, b.cz + Math.sin(a) * b.r);
      b.g.rotation.y = -a;
    }
  }

  /** Debug / overlay counts. */
  counts(): { warships: number; moving: number; boats: number; tanks: number; balloons: number; gate: number } {
    return { warships: this.moored.length + this.movers.length, moving: this.movers.filter((m) => m.visible).length, boats: this.boats.length, tanks: this.tanks.length, balloons: this.balloons.length, gate: Math.round(this.gateOpen * 100) / 100 };
  }

  /** Debug: jump the schedule clock (seconds). */
  skip(seconds: number): void {
    this.time += seconds;
  }

  /** Ship positions (debug / tests). */
  ships(): Array<{ x: number; z: number; yaw: number; visible: boolean }> {
    return this.movers.map((m) => ({ x: m.x, z: m.z, yaw: m.yaw, visible: m.visible }));
  }

  dispose(ctx: GameContext): void {
    for (const m of this.movers) for (const e of m.smoke) e.stop();
    for (const e of this.mooredSmoke) e.stop();
    for (const k of this.tanks) ctx.world.collision.remove(k.collider);
    for (const id of this.colliders) ctx.world.collision.remove(id);
    this.root.removeFromParent();
    for (const im of this.inst) im.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
