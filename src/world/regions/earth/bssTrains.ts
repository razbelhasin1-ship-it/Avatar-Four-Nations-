import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { kitMaterial } from '../../kit/Materials';
import './bssAudio';
import { RAIL, RAIL_LINES, TRAINS, hash01, type RailLineDef } from './bssLayout';
import type { PathSample, RailPath } from './bssKit';
import { Acc, FigureRenderer, Pose } from './bssFigures';
import { trackOffset, type StationRt } from './bssRail';
import { railPath } from './bssWalls';

/**
 * Monorail trains: deterministic timetables (accelerate, cruise, brake, dwell
 * at every station, reverse at shuttle terminals), so positions are a pure
 * function of game time. A pair of earthbenders on the trailing platform
 * stomps in rhythm — each kick gives the train a pulse of speed, kicks up
 * dust and thuds. Passengers wait on platforms, board and get off. The
 * player can board at a platform while a train stands there and ride on the
 * roof of the leading car (mountAnchor), getting off at any station.
 */

const PULSE = 0.3;
const KICK_PERIOD = 1.3;
const CAR_GAP = 0.7;

interface Leg {
  s0: number;
  s1: number;
  t0: number;
  tm: number;
  td: number;
  st: StationRt;
  dir: 1 | -1;
  omega: number;
}

export interface TrainPos {
  s: number;
  dir: 1 | -1;
  moving: boolean;
  station: StationRt | null;
  /** Kick phase (radians) while moving. */
  kick: number;
  /** Seconds into the dwell (or −1 while moving). */
  dwellT: number;
  td: number;
}

function moveTime(D: number): number {
  const v = TRAINS.cruise, a = TRAINS.accel;
  const da = (v * v) / (2 * a);
  return D >= 2 * da ? (2 * v) / a + (D - 2 * da) / v : 2 * Math.sqrt(D / a);
}

function moveDist(D: number, tm: number, tau: number): number {
  const v = TRAINS.cruise, a = TRAINS.accel;
  const da = (v * v) / (2 * a);
  if (D >= 2 * da) {
    const ta = v / a;
    if (tau < ta) return 0.5 * a * tau * tau;
    if (tau < tm - ta) return da + v * (tau - ta);
    const r = tm - tau;
    return D - 0.5 * a * r * r;
  }
  const h = tm / 2;
  if (tau < h) return 0.5 * a * tau * tau;
  const r = tm - tau;
  return D - 0.5 * a * r * r;
}

export class Schedule {
  readonly legs: Leg[] = [];
  period = 0;

  constructor(readonly line: RailLineDef, readonly path: RailPath, sts: StationRt[]) {
    const add = (s0: number, s1: number, st: StationRt, dir: 1 | -1, td: number) => {
      const D = Math.abs(s1 - s0);
      const tm = moveTime(D);
      const k = Math.max(1, Math.round(tm / KICK_PERIOD));
      this.legs.push({ s0, s1, t0: this.period, tm, td, st, dir, omega: (2 * Math.PI * k) / tm });
      this.period += tm + td;
    };
    if (line.kind === 'shuttle') {
      for (let i = 0; i < sts.length - 1; i++) add(sts[i].s, sts[i + 1].s, sts[i + 1], 1, i + 1 === sts.length - 1 ? TRAINS.terminalDwell : TRAINS.dwell);
      for (let i = sts.length - 1; i > 0; i--) add(sts[i].s, sts[i - 1].s, sts[i - 1], -1, i - 1 === 0 ? TRAINS.terminalDwell : TRAINS.dwell);
    } else {
      for (let i = 0; i < sts.length; i++) {
        const a = sts[i].s;
        let b = sts[(i + 1) % sts.length].s;
        if (b <= a) b += path.total;
        add(a, b, sts[(i + 1) % sts.length], 1, TRAINS.dwell);
      }
    }
  }

  at(u: number, out: TrainPos): TrainPos {
    u = ((u % this.period) + this.period) % this.period;
    let leg = this.legs[this.legs.length - 1];
    for (const l of this.legs) {
      if (u < l.t0 + l.tm + l.td) {
        leg = l;
        break;
      }
    }
    const tau = u - leg.t0;
    if (tau < leg.tm) {
      // Pulsed time warp: monotonic, ends exactly at tm (whole number of kicks).
      const w = tau - (PULSE / leg.omega) * Math.sin(leg.omega * tau);
      const d = moveDist(Math.abs(leg.s1 - leg.s0), leg.tm, Math.max(0, Math.min(leg.tm, w)));
      out.s = this.path.wrap(leg.s0 + Math.sign(leg.s1 - leg.s0) * d);
      out.moving = true;
      out.station = null;
      out.kick = leg.omega * tau;
      out.dwellT = -1;
    } else {
      out.s = this.path.wrap(leg.s1);
      out.moving = false;
      out.station = leg.st;
      out.kick = 0;
      out.dwellT = tau - leg.tm;
    }
    out.dir = leg.dir;
    out.td = leg.td;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Car geometry
// ---------------------------------------------------------------------------

type Part = 'under' | 'body' | 'frame' | 'glass' | 'roof' | 'trim';

function carParts(): Record<Part, THREE.BufferGeometry> {
  const L = RAIL.carLen, W = RAIL.carW;
  const parts: Record<Part, THREE.BufferGeometry[]> = { under: [], body: [], frame: [], glass: [], roof: [], trim: [] };
  const box = (p: Part, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    parts[p].push(g);
  };
  box('under', 0, 0.28, 0, 1.3, 0.56, L - 1.6);
  box('under', 0, 0.62, 0, W - 0.1, 0.14, L);
  box('body', 0, 1.3, 0, W, 1.3, L - 0.2);
  box('glass', 0, 2.38, 0, W + 0.02, 0.86, L - 0.6);
  box('body', 0, 2.95, 0, W, 0.28, L - 0.2);
  // Posts between window panes and corner posts.
  for (let i = 0; i <= 6; i++) {
    const z = -L / 2 + 0.3 + (i * (L - 0.6)) / 6;
    for (const s of [1, -1]) box('frame', s * (W / 2 + 0.02), 2.38, z, 0.06, 0.92, 0.16);
  }
  box('frame', 0, 0.7, 0, W + 0.06, 0.18, L - 0.1);
  box('frame', 0, 1.92, 0, W + 0.05, 0.08, L - 0.15);
  // End platforms with rails.
  for (const s of [1, -1]) {
    box('frame', 0, 0.7, s * (L / 2 + 0.45), W - 0.4, 0.14, 0.9);
    box('frame', 0, 1.25, s * (L / 2 + 0.88), W - 0.4, 0.07, 0.07);
    for (const x of [-1, 1]) box('frame', x * (W / 2 - 0.25), 1.0, s * (L / 2 + 0.88), 0.07, 0.6, 0.07);
    box('glass', 0, 2.4, s * (L / 2 - 0.08), 1.0, 0.7, 0.04);
  }
  // Barrel roof (green tile), eaves and ridge trim.
  const shape = new THREE.Shape();
  const r0 = 2.3, r1 = 2.12, a0 = Math.PI / 2 - 0.78, a1 = Math.PI / 2 + 0.78;
  shape.absarc(0, 0, r0, a0, a1, false);
  shape.absarc(0, 0, r1, a1, a0, true);
  const roof = new THREE.ExtrudeGeometry(shape, { depth: L + 0.4, bevelEnabled: false, curveSegments: 12 });
  roof.translate(0, 3.09 - r1 * Math.cos(0.78) + 0.02, -(L + 0.4) / 2);
  parts.roof.push(roof);
  const ex = r0 * Math.sin(0.78);
  for (const s of [1, -1]) box('trim', s * ex, 3.12 - (r0 - r1) * 0.2, 0, 0.09, 0.09, L + 0.4);
  box('trim', 0, 3.09 - r1 * Math.cos(0.78) + r0 + 0.02, 0, 0.12, 0.1, L + 0.45);
  box('trim', 0, 1.96, 0, W + 0.08, 0.05, L - 0.12);
  box('trim', 0, 2.83, 0, W + 0.08, 0.05, L - 0.12);
  const out = {} as Record<Part, THREE.BufferGeometry>;
  for (const k of Object.keys(parts) as Part[]) out[k] = mergeUV(parts[k]);
  return out;
}

function mergeUV(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ps = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const p of ps) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of ps) {
    const pa = p.getAttribute('position'), na = p.getAttribute('normal'), ua = p.getAttribute('uv');
    for (let i = 0; i < pa.count; i++, o++) {
      pos.set([pa.getX(i), pa.getY(i), pa.getZ(i)], o * 3);
      nrm.set([na.getX(i), na.getY(i), na.getZ(i)], o * 3);
      if (ua) uv.set([ua.getX(i), ua.getY(i)], o * 2);
    }
  }
  for (const g of gs) g.dispose();
  for (const p of ps) p.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd88a';
  g.fillRect(0, 0, 256, 64);
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,240,200,0.6)');
  grd.addColorStop(1, 'rgba(160,90,30,0.5)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 64);
  // Lattice and passenger silhouettes.
  g.fillStyle = 'rgba(60,35,20,0.85)';
  for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 3, 64);
  g.fillRect(0, 30, 256, 2);
  g.fillStyle = 'rgba(70,45,30,0.55)';
  for (let i = 0; i < 6; i++) {
    const x = 12 + i * 41 + ((i * 17) % 11);
    g.beginPath();
    g.arc(x, 40, 7, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x - 9, 46, 18, 18);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

interface Passenger {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  t: number;
  dur: number;
  vanish: boolean;
  robe: number;
  pants: number;
  skin: number;
  acc: number;
  phase: number;
}

interface PlatformRt {
  st: StationRt;
  board: THREE.Vector3;
  spawnT: number;
  waiting: Passenger[];
  moving: Passenger[];
  lastTrain: string;
}

export interface TrainRt {
  id: string;
  line: RailLineDef;
  path: RailPath;
  sched: Schedule;
  phase: number;
  cars: number;
  len: number;
  pos: TrainPos;
  kickIdx: number;
  /** World transforms of the cars (front first). */
  cx: Float32Array;
  cy: Float32Array;
  cz: Float32Array;
  cyaw: Float32Array;
  rear: THREE.Vector3;
  rearYaw: number;
  wasStation: string;
}

const PALETTES = [
  [0x6b7a4a, 0x8a7a55],
  [0x8a6a42, 0x5a4a35],
  [0x3f6e5a, 0xc9b98f],
  [0x9a8a62, 0x6a5a40],
  [0x5a7d4a, 0x3d3a2e],
  [0xb5a37a, 0x4f5a3a],
  [0x7a4a3a, 0xc8b88a],
  [0x2f5f72, 0xd8c9a0],
];
const SKINS = [0xe2b896, 0xc99a72, 0xa87856, 0xf0c8a4, 0x8a5c3c];

export class TrainSystem {
  readonly group = new THREE.Group();
  readonly trains: TrainRt[] = [];
  private readonly meshes: Partial<Record<Part, THREE.InstancedMesh>> = {};
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly glass: THREE.MeshStandardMaterial;
  private readonly platforms: PlatformRt[] = [];
  private readonly anchor = new THREE.Object3D();
  private ride: { train: TrainRt } | null = null;
  private offs: Array<() => void> = [];
  private ctx: GameContext | null = null;
  private readonly tmp: PathSample = { x: 0, z: 0, tx: 1, tz: 0 };
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly alightPos = new THREE.Vector3();
  /** Simulation clock offset (tests can fast-forward trains). */
  timeOffset = 0;
  stats = { kicks: 0, boarded: 0, alighted: 0 };

  constructor(parent: THREE.Group, readonly stations: StationRt[]) {
    this.group.name = 'bss_trains';
    parent.add(this.group);
    let total = 0;
    for (const line of RAIL_LINES) {
      const path = railPath(line.id);
      const sts = stations.filter((s) => s.line === line);
      const sched = new Schedule(line, path, sts);
      for (let i = 0; i < line.trains; i++) {
        const radial = line.kind === 'shuttle';
        const cars = radial ? 3 + Math.floor(hash01(i, line.deck, 7) * 2) : 4 + Math.floor(hash01(i, 11, line.deck) * 2);
        const len = cars * RAIL.carLen + (cars - 1) * CAR_GAP;
        this.trains.push({
          id: `${line.id}_${i}`,
          line,
          path,
          sched,
          phase: (sched.period * i) / line.trains,
          cars,
          len,
          pos: { s: 0, dir: 1, moving: false, station: null, kick: 0, dwellT: 0, td: 0 },
          kickIdx: 0,
          cx: new Float32Array(cars),
          cy: new Float32Array(cars),
          cz: new Float32Array(cars),
          cyaw: new Float32Array(cars),
          rear: new THREE.Vector3(),
          rearYaw: 0,
          wasStation: '',
        });
        total += cars;
      }
    }
    const parts = carParts();
    this.glass = new THREE.MeshStandardMaterial({ map: windowTexture(), emissive: '#ffcf80', roughness: 0.4 });
    this.glass.emissiveMap = this.glass.map;
    this.mats.push(this.glass);
    const matOf: Record<Part, THREE.Material> = {
      under: kitMaterial('wood_dark'),
      body: kitMaterial('plaster_cream'),
      frame: kitMaterial('wood_red'),
      glass: this.glass,
      roof: kitMaterial('roof_green'),
      trim: kitMaterial('gold'),
    };
    for (const k of Object.keys(parts) as Part[]) {
      const m = new THREE.InstancedMesh(parts[k], matOf[k], total);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = k !== 'glass' && k !== 'trim';
      m.receiveShadow = true;
      m.name = `bss_train_${k}`;
      this.geos.push(parts[k]);
      this.group.add(m);
      this.meshes[k] = m;
    }
    // Platform passengers.
    for (const st of stations) {
      this.platforms.push({ st, board: new THREE.Vector3(), spawnT: hash01(st.s | 0, 3) * 6, waiting: [], moving: [], lastTrain: '' });
    }
  }

  /** Current schedule time (game seconds + test offset). */
  private now(ctx: GameContext): number {
    return ctx.time.elapsed + this.timeOffset;
  }

  // ---------------------------------------------------------------------------
  // Session: interactions for boarding and getting off
  // ---------------------------------------------------------------------------

  onSessionStart(ctx: GameContext): void {
    this.onSessionEnd();
    this.ctx = ctx;
    for (const pf of this.platforms) {
      const st = pf.st;
      this.offs.push(
        ctx.interactions.register({
          id: `bss_board_${st.id}`,
          position: pf.board,
          radius: 7,
          label: `Board the ${st.line.name} train`,
          priority: 3,
          enabled: () => !this.ride && !!this.dwellingAt(st) && Math.abs((ctx.player?.position.y ?? -99) - st.top) < 2.5,
          interact: () => {
            const t = this.dwellingAt(st);
            if (t) this.board(t, ctx);
          },
        }),
      );
    }
    const alight = {
      id: 'bss_alight',
      position: this.alightPos,
      radius: 4,
      label: 'Get off the train',
      priority: 4,
      enabled: () => !!this.ride && !this.ride.train.pos.moving && !!this.ride.train.pos.station,
      interact: () => this.alight(ctx),
    };
    this.offs.push(ctx.interactions.register(alight));
  }

  onSessionEnd(): void {
    if (this.ride && this.ctx?.player && this.ctx.player.mountAnchor === this.anchor) this.ctx.player.mountAnchor = null;
    this.ride = null;
    for (const off of this.offs) off();
    this.offs = [];
    this.ctx = null;
  }

  private dwellingAt(st: StationRt): TrainRt | null {
    for (const t of this.trains) if (!t.pos.moving && t.pos.station === st && t.pos.dwellT < t.pos.td - 1.5) return t;
    return null;
  }

  get riding(): string | null {
    return this.ride?.train.id ?? null;
  }

  board(t: TrainRt, ctx: GameContext): void {
    const pl = ctx.player;
    if (!pl) return;
    this.ride = { train: t };
    this.placeAnchor(t);
    pl.mountAnchor = this.anchor;
    this.stats.boarded++;
    ctx.audio.play('bss_train_grind', { position: new THREE.Vector3(t.cx[0], t.cy[0], t.cz[0]), volume: 0.5 });
    ctx.ui.notify(`Riding the ${t.line.name}. Press interact at a station to get off.`, 'info', 4);
  }

  alight(ctx: GameContext): void {
    const pl = ctx.player;
    const r = this.ride;
    if (!pl || !r) return;
    const t = r.train;
    const st = t.pos.station;
    this.ride = null;
    if (pl.mountAnchor === this.anchor) pl.mountAnchor = null;
    if (st) {
      const p = t.path.at(t.pos.s, this.tmp);
      const side = trackOffset(t.line, t.path, t.pos.s, t.pos.dir) >= 0 ? 1 : -1;
      const lat = side * (st.inner + RAIL.platformW / 2);
      pl.teleport(new THREE.Vector3(p.x + -p.tz * lat, st.top + 0.05, p.z + p.tx * lat), Math.atan2(p.tx * t.pos.dir, p.tz * t.pos.dir));
      ctx.ui.notify(st.name, 'info', 2.5);
    }
    this.stats.alighted++;
  }

  private placeAnchor(t: TrainRt): void {
    this.anchor.position.set(t.cx[0], t.cy[0] + 3.42, t.cz[0]);
    this.anchor.rotation.set(0, t.cyaw[0], 0);
    this.anchor.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext, figures: FigureRenderer, cam: THREE.Vector3): void {
    const now = this.now(ctx);
    const hour = ctx.world.sky?.timeOfDay ?? 12;
    const night = hour < 6 || hour > 18.5 ? 1 : hour < 7.5 ? (7.5 - hour) / 1.5 : hour > 17 ? (hour - 17) / 1.5 : 0;
    this.glass.emissiveIntensity = 0.12 + 0.9 * night;
    let ci = 0;
    for (const t of this.trains) {
      t.sched.at(now + t.phase, t.pos);
      const deckY = 26 + t.line.deck;
      const baseY = deckY + 0.42;
      const dir = t.pos.dir;
      // Cars: front first, centred on the train's arc position.
      for (let c = 0; c < t.cars; c++) {
        const sc = t.pos.s + dir * (t.len / 2 - RAIL.carLen / 2 - c * (RAIL.carLen + CAR_GAP));
        const p = t.path.at(sc, this.tmp);
        const off = trackOffset(t.line, t.path, t.path.wrap(sc), dir);
        const x = p.x + -p.tz * off, z = p.z + p.tx * off;
        const yaw = Math.atan2(p.tx * dir, p.tz * dir);
        t.cx[c] = x;
        t.cy[c] = baseY;
        t.cz[c] = z;
        t.cyaw[c] = yaw;
        this.q.setFromAxisAngle(this.up, yaw);
        this.v.set(x, baseY, z);
        this.m4.compose(this.v, this.q, this.one);
        for (const m of Object.values(this.meshes)) m!.setMatrixAt(ci, this.m4);
        ci++;
      }
      // Earthbenders on the trailing platform.
      const sr = t.pos.s - dir * (t.len / 2 + 0.75);
      const pr = t.path.at(sr, this.tmp);
      const offR = trackOffset(t.line, t.path, t.path.wrap(sr), dir);
      t.rear.set(pr.x + -pr.tz * offR, baseY + 0.62, pr.z + pr.tx * offR);
      t.rearYaw = Math.atan2(pr.tx * dir, pr.tz * dir);
      const near = t.rear.distanceToSquared(cam) < 140 * 140;
      if (t.pos.moving) {
        const idx = Math.floor(t.pos.kick / (Math.PI * 2));
        if (idx !== t.kickIdx) {
          t.kickIdx = idx;
          this.stats.kicks++;
          if (near) {
            ctx.vfx.burst('dust', t.rear, { count: 5, size: 1.1, radius: 0.6 });
            if (t.rear.distanceToSquared(cam) < 70 * 70) ctx.audio.play('bss_train_stomp', { position: t.rear, volume: 0.55, pitch: 0.9 + hash01(idx, ci) * 0.2 });
          }
        }
      }
      // Terminal reversal: the benders walk to the new trailing end during the dwell.
      let bx = t.rear.x, bz = t.rear.z, pose: number = t.pos.moving ? Pose.push : Pose.idle, byaw = t.rearYaw;
      const st = t.pos.station;
      if (!t.pos.moving && st && st.terminal) {
        const k = Math.min(1, Math.max(0, (t.pos.dwellT - 2) / 9));
        if (k > 0 && k < 1) pose = Pose.walk;
        const sNew = t.pos.s + dir * (t.len / 2 + 0.75);
        const pn = t.path.at(sNew, this.tmp);
        const offN = trackOffset(t.line, t.path, t.path.wrap(sNew), dir);
        // Before reversal the trailing end is behind (−dir); the train leaves with −dir next.
        const fromX = t.rear.x, fromZ = t.rear.z;
        const toX = pn.x + -pn.tz * offN, toZ = pn.z + pn.tx * offN;
        bx = fromX + (toX - fromX) * k;
        bz = fromZ + (toZ - fromZ) * k;
        byaw = k > 0 && k < 1 ? Math.atan2(toX - fromX, toZ - fromZ) : k >= 1 ? t.rearYaw + Math.PI : t.rearYaw;
      }
      if (figures.visible(bx, baseY, bz)) {
        const ph = t.pos.moving ? t.pos.kick : now * 3;
        for (const side of [1, -1]) {
          const lx = Math.cos(byaw) * side * 0.65, lz = -Math.sin(byaw) * side * 0.65;
          figures.push(bx + lx, baseY + 0.62, bz + lz, byaw, pose, ph + (side > 0 ? 0 : Math.PI), 1, 0, 0x34532f, 0x6e6450, side > 0 ? 0xc99a72 : 0xe2b896, Acc.guardHelm);
        }
      }
      // Arrival / departure bookkeeping for passengers.
      const sid = t.pos.station?.id ?? '';
      if (sid && sid !== t.wasStation) this.onArrive(t, t.pos.station!, ctx);
      t.wasStation = sid;
    }
    for (const m of Object.values(this.meshes)) {
      m!.count = ci;
      m!.instanceMatrix.needsUpdate = true;
    }
    // Riding: keep the player glued to the leading car this frame (no lag).
    const pl = ctx.player;
    if (this.ride && pl) {
      if (pl.mountAnchor !== this.anchor) {
        this.ride = null;
      } else {
        this.placeAnchor(this.ride.train);
        pl.root.position.copy(this.anchor.position);
        pl.yaw = this.anchor.rotation.y;
        pl.root.rotation.y = pl.yaw;
        this.alightPos.copy(pl.root.position);
        if (this.ride.train.pos.station && !this.ride.train.pos.moving) {
          const st = this.ride.train.pos.station;
          const it = ctx.interactions.get('bss_alight');
          if (it) it.label = `Get off at ${st.name}`;
        }
      }
    }
    this.updatePassengers(dt, ctx, figures, cam);
  }

  // ---------------------------------------------------------------------------
  // Passengers
  // ---------------------------------------------------------------------------

  private platformPoint(st: StationRt, u: number, side: number, inset = 0.5): { x: number; z: number } {
    const p = railPath(st.line.id).at(st.s + u * st.half * 0.9, this.tmp);
    const lat = side * (st.inner + RAIL.platformW * inset);
    return { x: p.x + -p.tz * lat, z: p.z + p.tx * lat };
  }

  private newPassenger(seed: number, y: number): Passenger {
    const pal = PALETTES[Math.floor(hash01(seed, 1) * PALETTES.length)];
    const r = hash01(seed, 2);
    return { x0: 0, z0: 0, x1: 0, z1: 0, y, t: 0, dur: 1, vanish: false, robe: pal[0], pants: pal[1], skin: SKINS[Math.floor(hash01(seed, 3) * SKINS.length)], acc: r < 0.12 ? Acc.bundle : r < 0.2 ? Acc.strawHat : r < 0.26 ? Acc.topknot : 0, phase: hash01(seed, 4) * 6 };
  }

  private onArrive(t: TrainRt, st: StationRt, ctx: GameContext): void {
    const pf = this.platforms.find((q) => q.st === st);
    if (!pf || pf.lastTrain === t.id + Math.floor(this.now(ctx))) return;
    pf.lastTrain = t.id + Math.floor(this.now(ctx));
    const side = trackOffset(t.line, t.path, t.pos.s, t.pos.dir) >= 0 ? 1 : -1;
    // Waiting passengers walk to the nearest door and board.
    for (const p of pf.waiting.splice(0)) {
      const c = Math.floor(hash01(p.phase * 100) * t.cars);
      const dx = t.cx[c] + -Math.cos(t.cyaw[c]) * 0, dz = t.cz[c];
      p.x0 = p.x1;
      p.z0 = p.z1;
      p.x1 = dx + (p.x1 - dx) * 0.18;
      p.z1 = dz + (p.z1 - dz) * 0.18;
      p.t = 0;
      p.dur = 1.5 + hash01(p.phase) * 3;
      p.vanish = true;
      pf.moving.push(p);
    }
    // A few get off and head for the lift.
    const n = Math.floor(hash01(this.stats.kicks, st.s | 0) * 4);
    for (let i = 0; i < n; i++) {
      const p = this.newPassenger(this.stats.kicks * 7 + i, st.top);
      const c = i % t.cars;
      const door = { x: t.cx[c], z: t.cz[c] };
      const to = this.platformPoint(st, st.liftSide ? 0 : (i % 2 ? 0.8 : -0.8), st.liftSide || side, 1);
      p.x0 = door.x + (to.x - door.x) * 0.25;
      p.z0 = door.z + (to.z - door.z) * 0.25;
      p.x1 = to.x;
      p.z1 = to.z;
      p.t = -i * 0.6;
      p.dur = 4 + hash01(i, st.s | 0) * 3;
      p.vanish = true;
      pf.moving.push(p);
    }
  }

  private updatePassengers(dt: number, ctx: GameContext, figures: FigureRenderer, cam: THREE.Vector3): void {
    for (const pf of this.platforms) {
      const st = pf.st;
      const c = railPath(st.line.id).at(st.s, this.tmp);
      // Boarding prompt follows the standing train (or the platform centre).
      const t = this.dwellingAt(st);
      if (t) {
        const k = Math.floor(t.cars / 2);
        pf.board.set(t.cx[k], st.top + 1, t.cz[k]);
      } else pf.board.set(c.x, st.top + 1, c.z);
      if ((c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 > 160 * 160) continue;
      // New arrivals come up the lift and wait.
      pf.spawnT -= dt;
      if (pf.spawnT <= 0 && pf.waiting.length < 7) {
        pf.spawnT = 5 + hash01(pf.waiting.length, st.s | 0, Math.floor(ctx.time.elapsed)) * 8;
        const seed = Math.floor(ctx.time.elapsed * 13) + (st.s | 0);
        const p = this.newPassenger(seed, st.top);
        const side = st.liftSide || (hash01(seed, 9) < 0.5 ? 1 : -1);
        const from = this.platformPoint(st, 0, side, 1);
        const to = this.platformPoint(st, hash01(seed, 5) * 2 - 1, hash01(seed, 6) < 0.5 ? 1 : -1, 0.45);
        p.x0 = from.x;
        p.z0 = from.z;
        p.x1 = to.x;
        p.z1 = to.z;
        p.dur = 3 + hash01(seed, 7) * 4;
        pf.moving.push(p);
      }
      for (let i = pf.moving.length - 1; i >= 0; i--) {
        const p = pf.moving[i];
        p.t += dt;
        if (p.t >= p.dur) {
          pf.moving.splice(i, 1);
          if (!p.vanish) pf.waiting.push(p);
          continue;
        }
        const k = Math.max(0, p.t / p.dur);
        const x = p.x0 + (p.x1 - p.x0) * k, z = p.z0 + (p.z1 - p.z0) * k;
        figures.push(x, p.y, z, Math.atan2(p.x1 - p.x0, p.z1 - p.z0), p.t < 0 ? Pose.idle : Pose.walk, ctx.time.elapsed * 7 + p.phase, 1, 0, p.robe, p.pants, p.skin, p.acc);
      }
      for (const p of pf.waiting) {
        figures.push(p.x1, p.y, p.z1, Math.atan2(c.x - p.x1, c.z - p.z1), Pose.idle, ctx.time.elapsed + p.phase, 0, 0, p.robe, p.pants, p.skin, p.acc);
      }
    }
  }

  /** Debug summary. */
  /**
   * Debug soak: sample every train's schedule from `start` for `seconds` (steps of `dt`) and report the
   * extremes — top speed and acceleration, the closest approach of two trains on the same track, stops made
   * and any sample off the line or not finite.
   */
  soak(start: number, seconds: number, dt = 1 / 30): { samples: number; maxSpeed: number; maxAccel: number; minGap: number; stops: number; bad: number } {
    const n = this.trains.length;
    const pos: TrainPos[] = this.trains.map(() => ({ s: 0, dir: 1, moving: false, station: null, kick: 0, dwellT: -1, td: 0 }));
    const prevS = new Float64Array(n), prevV = new Float64Array(n);
    const wasAt: Array<string | null> = new Array(n).fill(null);
    let samples = 0, maxSpeed = 0, maxAccel = 0, stops = 0, bad = 0, minGap = Infinity;
    const steps = Math.round(seconds / dt);
    for (let k = 0; k <= steps; k++) {
      const time = start + k * dt;
      for (let i = 0; i < n; i++) {
        const t = this.trains[i], p = pos[i];
        t.sched.at(time + t.phase, p);
        samples++;
        if (!Number.isFinite(p.s) || (!t.path.closed && (p.s < -0.5 || p.s > t.path.total + 0.5))) bad++;
        if (k > 0) {
          let ds = p.s - prevS[i];
          if (t.path.closed) ds = ((((ds + t.path.total / 2) % t.path.total) + t.path.total) % t.path.total) - t.path.total / 2;
          const v = Math.abs(ds) / dt;
          maxSpeed = Math.max(maxSpeed, v);
          if (k > 1) maxAccel = Math.max(maxAccel, Math.abs(v - prevV[i]) / dt);
          prevV[i] = v;
        }
        prevS[i] = p.s;
        const at = p.station?.id ?? null;
        if (at && at !== wasAt[i]) stops++;
        wasAt[i] = at;
      }
      // Two trains on one track (same line, same direction) never close up.
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = this.trains[i], b = this.trains[j];
        if (a.line.id !== b.line.id || pos[i].dir !== pos[j].dir) continue;
        let d = Math.abs(pos[i].s - pos[j].s);
        if (a.path.closed) d = Math.min(d, a.path.total - d);
        minGap = Math.min(minGap, d - (a.len + b.len) / 2);
      }
    }
    return { samples, maxSpeed: +maxSpeed.toFixed(2), maxAccel: +maxAccel.toFixed(2), minGap: +minGap.toFixed(1), stops, bad };
  }

  summary(): Array<{ id: string; s: number; dir: number; moving: boolean; station: string | null; x: number; z: number; cars: number }> {
    return this.trains.map((t) => ({ id: t.id, s: +t.pos.s.toFixed(1), dir: t.pos.dir, moving: t.pos.moving, station: t.pos.station?.id ?? null, x: +t.cx[0].toFixed(1), z: +t.cz[0].toFixed(1), cars: t.cars }));
  }

  dispose(): void {
    this.onSessionEnd();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.glass.map?.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
