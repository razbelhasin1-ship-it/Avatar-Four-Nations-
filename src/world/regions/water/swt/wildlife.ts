import * as THREE from 'three';
import { createModel } from '../../../../companions/models';
import { type AnimInput, type CreatureModel, defaultAnim } from '../../../../companions/models/CreatureModel';
import type { GameContext } from '../../../../core/GameContext';
import { Random } from '../../../../core/Random';
import { heightAt, seaIceField } from '../../../Heightfield';
import { WC_LANDING, WC_SLED_RUN } from '../../../landforms/wolfCove';
import type { P2 } from '../../../WorldLayout';
import { Pose } from '../../earth/bssFigures';
import { coloured, type Part } from './figures';
import { DOG_PENS, FLOOR, SWT } from './layout';
import type { PetOwner, Rider } from './life';
import { SHORE } from './shore';

/**
 * Wolf Cove's animals and boats: otter penguins on the slope by the sled run (waddling, belly-sliding
 * down to the shore ice — the companion model), tiger seals hauled out along the ice edge, the sled
 * dogs in their pens, gulls wheeling over the shore, one polar bear dog roaming the far tundra, and
 * the tribe's canoes and kayaks: drawn up at the ice edge at night, paddled out to the fishing grounds
 * at dawn and home in the afternoon (paddlers drawn with the crowd — `riders`).
 */

export const SWT_WILD = {
  penguins: 12,
  seals: SWT.seals,
  dogs: 12,
  gulls: 14,
  canoes: 4,
  kayaks: 3,
  /** Hours the boats leave and come home (each boat a little later than the last). */
  out: 6,
  home: 15.75,
} as const;

const ICE_Y = 0.12;
const outY = (x: number, z: number) => Math.max(heightAt(x, z), SHORE.iceY);
/** Open water (not sea ice, deep enough to float a canoe). */
const isOpen = (x: number, z: number, margin = 0) => {
  const h = heightAt(x, z);
  return h < -0.8 - margin && seaIceField(x, z, h) < -margin;
};

interface Penguin {
  m: CreatureModel;
  anim: AnimInput;
  x: number;
  z: number;
  yaw: number;
  tx: number;
  tz: number;
  state: 'idle' | 'waddle' | 'slide';
  t: number;
}

interface Boat {
  kayak: boolean;
  berth: P2;
  ground: P2;
  x: number;
  z: number;
  yaw: number;
  state: 'berth' | 'out' | 'fish' | 'back';
  leave: number;
  back: number;
  phase: number;
}

const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
const e4 = new THREE.Euler();
const v4 = new THREE.Vector3();
const s4 = new THREE.Vector3();

export class WolfCoveWildlife {
  readonly group = new THREE.Group();
  /** Paddlers to draw with the crowd this frame. */
  readonly riders: Rider[] = [];
  private readonly rnd = new Random(SWT.seed + 313);
  private readonly penguins: Penguin[] = [];
  private bear: { m: CreatureModel; anim: AnimInput; s: number; dir: number; pause: number; x: number; z: number; yaw: number } | null = null;
  private readonly loopPt = { x: 0, z: 0, yaw: 0 };
  private readonly riderPool: Rider[] = Array.from({ length: 16 }, () => ({ x: 0, y: 0, z: 0, yaw: 0, pose: 0, phase: 0 }));
  private readonly bearPath: P2[] = [
    { x: 340, z: 1812 },
    { x: 290, z: 1858 },
    { x: 220, z: 1872 },
    { x: 150, z: 1850 },
    { x: 120, z: 1800 },
    { x: 170, z: 1790 },
    { x: 250, z: 1805 },
  ];
  private bearLen = 0;
  private readonly seals: Array<{ x: number; z: number; yaw: number; phase: number; t: number; hop: number }> = [];
  private readonly dogs: Array<{ x: number; y: number; z: number; yaw: number; tx: number; tz: number; state: 'trot' | 'sit' | 'lie'; t: number; phase: number }> = [];
  private readonly boats: Boat[] = [];
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private sealMesh!: THREE.InstancedMesh;
  private dogMesh!: THREE.InstancedMesh;
  private gullMesh!: THREE.InstancedMesh;
  private canoeMesh!: THREE.InstancedMesh;
  private kayakMesh!: THREE.InstancedMesh;
  private time = 0;
  private lastHour = -1;
  /** Events for the region's sounds (seal howls, barks, penguin calls). */
  readonly calls: Array<{ kind: 'seal' | 'dog' | 'penguin'; x: number; y: number; z: number }> = [];
  stats = { penguins: 0, seals: 0, dogs: 0, gulls: 0, boats: 0, boatsOut: 0, bear: 0 };

  constructor(parent: THREE.Group, low: boolean) {
    this.group.name = 'swt_wildlife';
    parent.add(this.group);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mats.push(mat);
    const inst = (g: THREE.BufferGeometry, n: number, name: string) => {
      this.geos.push(g);
      const m = new THREE.InstancedMesh(g, mat, Math.max(1, n));
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.count = 0;
      m.name = name;
      this.group.add(m);
      this.meshes.push(m);
      return m;
    };
    this.sealMesh = inst(sealGeometry(), SWT_WILD.seals, 'swt_tiger_seals');
    this.dogMesh = inst(dogGeometry(), SWT_WILD.dogs, 'swt_dogs');
    this.gullMesh = inst(gullGeometry(), SWT_WILD.gulls, 'swt_gulls');
    this.canoeMesh = inst(canoeGeometry(false), SWT_WILD.canoes, 'swt_canoes');
    this.kayakMesh = inst(canoeGeometry(true), SWT_WILD.kayaks, 'swt_kayaks');
    this.placePenguins(low ? 6 : SWT_WILD.penguins);
    this.placeSeals();
    this.placeDogs();
    this.placeBoats();
    this.placeBear(low);
  }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------

  private placePenguins(n: number): void {
    const c = SHORE.penguins;
    for (let i = 0; i < n; i++) {
      const m = createModel('otter_penguin', i % 3, 0.8, this.rnd.range(0.85, 1.1));
      if (!m) break;
      m.setShadows(false);
      const a = this.rnd.next() * Math.PI * 2, r = 2 + this.rnd.next() * 9;
      const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
      this.group.add(m.root);
      this.penguins.push({ m, anim: defaultAnim(), x, z, yaw: this.rnd.range(-3, 3), tx: x, tz: z, state: 'idle', t: this.rnd.range(0, 4) });
    }
  }

  private placeSeals(): void {
    // Along the ice edge east of the landing: sea ice with open water a few metres off.
    const cands: P2[] = [];
    for (let x = 236; x <= 430; x += 3) {
      for (let z = 1420; z <= 1500; z += 3) {
        const h = heightAt(x, z);
        if (h > -0.3 || seaIceField(x, z, h) < 0.6) continue;
        let edge = false;
        for (let k = 0; k < 8 && !edge; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (isOpen(x + Math.sin(a) * 5, z + Math.cos(a) * 5)) edge = true;
        }
        if (edge) cands.push({ x, z });
      }
    }
    this.rnd.shuffle(cands);
    for (const p of cands) {
      if (this.seals.length >= SWT_WILD.seals) break;
      if (this.seals.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 9)) continue;
      if (Math.hypot(p.x - SHORE.akka.x, p.z - SHORE.akka.z) < SHORE.akka.r + 3) continue;
      this.seals.push({ x: p.x, z: p.z, yaw: this.rnd.range(-3, 3), phase: this.rnd.range(0, 10), t: this.rnd.range(4, 20), hop: 0 });
    }
  }

  private placeDogs(): void {
    for (let i = 0; i < SWT_WILD.dogs; i++) {
      const a = this.rnd.next() * Math.PI * 2, r = this.rnd.next() * (DOG_PENS.r - 1.2);
      const x = DOG_PENS.x + Math.sin(a) * r, z = DOG_PENS.z + Math.cos(a) * r;
      this.dogs.push({ x, y: FLOOR, z, yaw: this.rnd.range(-3, 3), tx: x, tz: z, state: this.rnd.chance(0.5) ? 'lie' : 'sit', t: this.rnd.range(2, 12), phase: this.rnd.range(0, 10) });
    }
  }

  private placeBoats(): void {
    // The ice edge off the landing, then fishing grounds out in the cove with open water all the way.
    const L = WC_LANDING;
    const dir = { x: 300 - L.x, z: 1400 - L.z };
    const dl = Math.hypot(dir.x, dir.z);
    dir.x /= dl;
    dir.z /= dl;
    let edge: P2 | null = null;
    for (let s = 4; s < 180 && !edge; s += 2) {
      const x = L.x + dir.x * s, z = L.z + dir.z * s;
      if (isOpen(x, z, 0.3) && isOpen(x + dir.x * 4, z + dir.z * 4, 0.3)) edge = { x: x + dir.x * 3, z: z + dir.z * 3 };
    }
    if (!edge) return;
    const side = { x: -dir.z, z: dir.x };
    const grounds: P2[] = [];
    for (let x = 250; x <= 500; x += 11) for (let z = 1320; z <= 1460; z += 11) if (isOpen(x, z, 1.5)) grounds.push({ x, z });
    this.rnd.shuffle(grounds);
    const clearLine = (a: P2, b: P2) => {
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s <= l; s += 3) if (!isOpen(a.x + ((b.x - a.x) * s) / l, a.z + ((b.z - a.z) * s) / l, 0.2)) return false;
      return true;
    };
    const n = SWT_WILD.canoes + SWT_WILD.kayaks;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 3.2;
      const berth = { x: edge.x + side.x * off, z: edge.z + side.z * off };
      if (!isOpen(berth.x, berth.z, 0.2)) continue;
      const ground = grounds.find((g) => Math.hypot(g.x - berth.x, g.z - berth.z) > 35 && !this.boats.some((b) => Math.hypot(b.ground.x - g.x, b.ground.z - g.z) < 14) && clearLine(berth, g));
      if (!ground) continue;
      const kayak = i >= SWT_WILD.canoes;
      this.boats.push({
        kayak,
        berth,
        ground,
        x: berth.x,
        z: berth.z,
        yaw: Math.atan2(dir.x, dir.z),
        state: 'berth',
        leave: SWT_WILD.out + i * 0.22,
        back: SWT_WILD.home + i * 0.2,
        phase: this.rnd.range(0, 10),
      });
    }
  }

  private placeBear(low: boolean): void {
    if (low) return;
    const m = createModel('polar_bear_dog', 0, 0.7, 1);
    if (!m) return;
    m.setShadows(false);
    this.group.add(m.root);
    for (let i = 0; i < this.bearPath.length; i++) {
      const a = this.bearPath[i], b = this.bearPath[(i + 1) % this.bearPath.length];
      this.bearLen += Math.hypot(b.x - a.x, b.z - a.z);
    }
    this.bear = { m, anim: defaultAnim(), s: this.rnd.next() * this.bearLen, dir: 1, pause: 0, x: 0, z: 0, yaw: 0 };
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext, near: boolean, pets: readonly PetOwner[] = []): void {
    this.time += dt;
    this.calls.length = 0;
    const hour = ctx.world.sky.timeOfDay;
    const jump = this.lastHour >= 0 && Math.min(Math.abs(hour - this.lastHour), 24 - Math.abs(hour - this.lastHour)) > 0.5;
    const first = this.lastHour < 0;
    this.lastHour = hour;
    const p = ctx.player?.position ?? ctx.camera.position;
    this.updateBoats(dt, hour, first || jump);
    if (!near) {
      for (const pg of this.penguins) pg.m.root.visible = false;
      if (this.bear) this.bear.m.root.visible = false;
      this.sealMesh.count = this.dogMesh.count = this.gullMesh.count = 0;
      return;
    }
    this.updatePenguins(dt, p);
    this.updateSeals(dt, p);
    this.updateDogs(dt, p, pets);
    this.updateGulls();
    this.updateBear(dt, p);
  }

  private updatePenguins(dt: number, p: THREE.Vector3): void {
    const c = SHORE.penguins;
    const runEnd = WC_SLED_RUN[3];
    let shown = 0;
    for (const pg of this.penguins) {
      const vis = Math.hypot(pg.x - p.x, pg.z - p.z) < 140;
      pg.m.root.visible = vis;
      pg.t -= dt;
      let speed = 0;
      if (pg.state === 'idle') {
        if (pg.t <= 0) {
          const r = this.rnd.next();
          if (r < 0.15) {
            // Belly slide down toward the shore ice.
            pg.state = 'slide';
            const a = Math.atan2(runEnd.x - c.x, runEnd.z - c.z) + this.rnd.range(-0.5, 0.5);
            pg.tx = pg.x + Math.sin(a) * this.rnd.range(8, 14);
            pg.tz = pg.z + Math.cos(a) * this.rnd.range(8, 14);
            this.calls.push({ kind: 'penguin', x: pg.x, y: outY(pg.x, pg.z) + 0.5, z: pg.z });
          } else {
            pg.state = 'waddle';
            const a = this.rnd.next() * Math.PI * 2, r2 = 1 + this.rnd.next() * 10;
            pg.tx = c.x + Math.sin(a) * r2;
            pg.tz = c.z + Math.cos(a) * r2;
          }
        }
      } else {
        const dx = pg.tx - pg.x, dz = pg.tz - pg.z, d = Math.hypot(dx, dz);
        speed = pg.state === 'slide' ? 3.2 : 0.55;
        if (d < 0.3) {
          pg.state = 'idle';
          pg.t = this.rnd.range(3, 12);
          speed = 0;
        } else {
          const s = Math.min(d, speed * dt);
          pg.x += (dx / d) * s;
          pg.z += (dz / d) * s;
          const want = Math.atan2(dx, dz);
          let dy = want - pg.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          pg.yaw += dy * Math.min(1, dt * 5);
        }
      }
      if (!vis) continue;
      shown++;
      pg.m.root.position.set(pg.x, outY(pg.x, pg.z), pg.z);
      pg.m.root.rotation.y = pg.yaw;
      const a = pg.anim;
      a.dt = dt;
      a.time = this.time;
      a.speed = speed;
      a.action = pg.state === 'slide' ? 'slide' : 'none';
      a.actionT += dt;
      pg.m.update(a);
    }
    this.stats.penguins = shown;
  }

  private updateSeals(dt: number, p: THREE.Vector3): void {
    let n = 0;
    for (const s of this.seals) {
      s.t -= dt;
      if (s.t <= 0) {
        s.t = this.rnd.range(8, 26);
        if (this.rnd.chance(0.4)) s.hop = 2.5;
        else if (Math.hypot(s.x - p.x, s.z - p.z) < 120) this.calls.push({ kind: 'seal', x: s.x, y: ICE_Y + 0.4, z: s.z });
      }
      let pitch = 0, lift = 0;
      if (s.hop > 0) {
        // An inchworm shuffle along the ice (only where it stays ice).
        const step = dt * 0.9;
        s.hop -= step;
        const nx = s.x + Math.sin(s.yaw) * step, nz = s.z + Math.cos(s.yaw) * step;
        if (!isOpen(nx, nz)) {
          s.x = nx;
          s.z = nz;
        } else s.yaw += Math.PI * 0.7;
        const w = Math.sin(this.time * 7 + s.phase);
        pitch = w * 0.12;
        lift = Math.max(0, w) * 0.06;
      }
      const breathe = 1 + Math.sin(this.time * 1.3 + s.phase) * 0.03;
      e4.set(pitch, s.yaw + Math.sin(this.time * 0.2 + s.phase) * 0.15, Math.sin(this.time * 0.35 + s.phase) * 0.08, 'YXZ');
      q4.setFromEuler(e4);
      v4.set(s.x, ICE_Y + lift, s.z);
      s4.set(1, breathe, 1);
      this.sealMesh.setMatrixAt(n++, m4.compose(v4, q4, s4));
    }
    this.sealMesh.count = n;
    this.sealMesh.instanceMatrix.needsUpdate = true;
    this.stats.seals = n;
  }

  private updateDogs(dt: number, p: THREE.Vector3, pets: readonly PetOwner[]): void {
    let n = 0;
    for (let i = 0; i < this.dogs.length; i++) {
      const d = this.dogs[i];
      const owner = i < pets.length ? pets[i] : null;
      if (owner) {
        // A pet at heel: trots after its villager, sits when they stop, waits at the door when they go in.
        let bob = 0, pitch = 0, sy = 1;
        if (owner.out) {
          const tx = owner.x - Math.sin(owner.yaw) * 1.3 + Math.cos(owner.yaw) * 0.55;
          const tz = owner.z - Math.cos(owner.yaw) * 1.3 - Math.sin(owner.yaw) * 0.55;
          const dx = tx - d.x, dz = tz - d.z, dd = Math.hypot(dx, dz);
          if (dd > 30) {
            d.x = tx;
            d.z = tz;
          } else if (dd > 0.45) {
            const s = Math.min(dd, Math.min(4, 1.2 + dd) * dt);
            d.x += (dx / dd) * s;
            d.z += (dz / dd) * s;
            d.yaw = Math.atan2(dx, dz);
            bob = Math.abs(Math.sin(this.time * 9 + d.phase)) * 0.06;
          } else pitch = -0.38;
          d.y = owner.y;
        } else sy = 0.72;
        e4.set(pitch, d.yaw, 0, 'YXZ');
        q4.setFromEuler(e4);
        v4.set(d.x, d.y + bob + (pitch ? 0.08 : 0), d.z);
        s4.set(1, sy, 1);
        this.dogMesh.setMatrixAt(n++, m4.compose(v4, q4, s4));
        continue;
      }
      d.t -= dt;
      if (d.t <= 0) {
        const r = this.rnd.next();
        if (r < 0.45) {
          d.state = 'trot';
          const a = this.rnd.next() * Math.PI * 2, rr = this.rnd.next() * (DOG_PENS.r - 1.3);
          d.tx = DOG_PENS.x + Math.sin(a) * rr;
          d.tz = DOG_PENS.z + Math.cos(a) * rr;
          d.t = 12;
        } else {
          d.state = r < 0.75 ? 'sit' : 'lie';
          d.t = this.rnd.range(5, 16);
          if (this.rnd.chance(0.3) && Math.hypot(d.x - p.x, d.z - p.z) < 70) this.calls.push({ kind: 'dog', x: d.x, y: FLOOR + 0.6, z: d.z });
        }
      }
      let bob = 0, pitch = 0, sy = 1;
      if (d.state === 'trot') {
        const dx = d.tx - d.x, dz = d.tz - d.z, dd = Math.hypot(dx, dz);
        if (dd < 0.25) {
          d.state = 'sit';
          d.t = this.rnd.range(3, 9);
        } else {
          const s = Math.min(dd, 1.9 * dt);
          d.x += (dx / dd) * s;
          d.z += (dz / dd) * s;
          d.yaw = Math.atan2(dx, dz);
          bob = Math.abs(Math.sin(this.time * 9 + d.phase)) * 0.06;
        }
      } else if (d.state === 'sit') pitch = -0.38;
      else sy = 0.72;
      e4.set(pitch, d.yaw, 0, 'YXZ');
      q4.setFromEuler(e4);
      v4.set(d.x, FLOOR + bob + (d.state === 'sit' ? 0.08 : 0), d.z);
      s4.set(1, sy, 1);
      this.dogMesh.setMatrixAt(n++, m4.compose(v4, q4, s4));
    }
    this.dogMesh.count = n;
    this.dogMesh.instanceMatrix.needsUpdate = true;
    this.stats.dogs = n;
  }

  private updateGulls(): void {
    const c = { x: WC_LANDING.x + 10, z: WC_LANDING.z - 20 };
    for (let i = 0; i < SWT_WILD.gulls; i++) {
      const r = 18 + (i % 5) * 9, w = (0.12 + (i % 3) * 0.035) * (i % 2 ? 1 : -1);
      const a = this.time * w + i * 1.7;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r * 0.7;
      const y = 9 + (i % 4) * 3 + Math.sin(this.time * 0.4 + i) * 1.5;
      const flap = 0.55 + 0.45 * Math.sin(this.time * (5 + (i % 3)) + i);
      const yaw = a + (w > 0 ? Math.PI : 0);
      e4.set(0, yaw, w > 0 ? -0.25 : 0.25, 'YXZ');
      q4.setFromEuler(e4);
      v4.set(x, y, z);
      s4.set(1, 0.3 + flap * 1.6, 1);
      this.gullMesh.setMatrixAt(i, m4.compose(v4, q4, s4));
    }
    this.gullMesh.count = SWT_WILD.gulls;
    this.gullMesh.instanceMatrix.needsUpdate = true;
    this.stats.gulls = SWT_WILD.gulls;
  }

  private updateBear(dt: number, p: THREE.Vector3): void {
    const b = this.bear;
    if (!b) return;
    let speed = 0;
    // It keeps its distance: a traveller closer than ~170 m sends it loping away along its round.
    const shy = Math.hypot(b.x - p.x, b.z - p.z) < 170;
    if (shy) b.pause = 0;
    if (b.pause > 0) b.pause -= dt;
    else {
      speed = shy ? 3.4 : 1.3;
      if (shy) {
        const L = this.bearLen;
        this.loopAt((b.s + 4) % L);
        const ahead = Math.hypot(this.loopPt.x - p.x, this.loopPt.z - p.z);
        this.loopAt((b.s - 4 + L) % L);
        const back = Math.hypot(this.loopPt.x - p.x, this.loopPt.z - p.z);
        b.dir = ahead >= back ? 1 : -1;
      }
      b.s = (b.s + b.dir * speed * dt + this.bearLen) % this.bearLen;
      if (!shy && this.rnd.next() < dt / 40) b.pause = this.rnd.range(6, 14);
    }
    this.loopAt(b.s);
    b.x = this.loopPt.x;
    b.z = this.loopPt.z;
    b.yaw = this.loopPt.yaw + (b.dir < 0 ? Math.PI : 0);
    const vis = Math.hypot(b.x - p.x, b.z - p.z) < 420;
    b.m.root.visible = vis;
    this.stats.bear = vis ? 1 : 0;
    if (!vis) return;
    b.m.root.position.set(b.x, heightAt(b.x, b.z), b.z);
    b.m.root.rotation.y = b.yaw;
    const a = b.anim;
    a.dt = dt;
    a.time = this.time;
    a.speed = speed;
    a.action = b.pause > 0 ? 'sniff' : 'none';
    a.actionT = b.pause > 0 ? a.actionT + dt : 0;
    b.m.update(a);
  }

  /** Point and heading at distance `s` round the bear's loop (into loopPt). */
  private loopAt(s: number): void {
    for (let i = 0; i < this.bearPath.length; i++) {
      const a = this.bearPath[i], c = this.bearPath[(i + 1) % this.bearPath.length];
      const l = Math.hypot(c.x - a.x, c.z - a.z);
      if (s <= l || i === this.bearPath.length - 1) {
        const t = Math.min(1, s / l);
        this.loopPt.x = a.x + (c.x - a.x) * t;
        this.loopPt.z = a.z + (c.z - a.z) * t;
        this.loopPt.yaw = Math.atan2(c.x - a.x, c.z - a.z);
        return;
      }
      s -= l;
    }
  }

  /** Boats on the daily schedule; paddlers go to `riders`. */
  private updateBoats(dt: number, hour: number, settle: boolean): void {
    this.riders.length = 0;
    let nc = 0, nk = 0, out = 0, nr = 0;
    for (const b of this.boats) {
      const away = hour >= b.leave && hour < b.back;
      if (settle) {
        b.state = away ? 'fish' : 'berth';
        const at = away ? b.ground : b.berth;
        b.x = at.x;
        b.z = at.z;
      }
      if (b.state === 'berth' && away) b.state = 'out';
      if ((b.state === 'fish' || b.state === 'out') && !away) b.state = 'back';
      let moving = false;
      if (b.state === 'out' || b.state === 'back') {
        const to = b.state === 'out' ? b.ground : b.berth;
        const dx = to.x - b.x, dz = to.z - b.z, d = Math.hypot(dx, dz);
        const v = b.kayak ? 2.3 : 1.7;
        if (d < 0.5) b.state = b.state === 'out' ? 'fish' : 'berth';
        else {
          const s = Math.min(d, v * dt);
          b.x += (dx / d) * s;
          b.z += (dz / d) * s;
          const want = Math.atan2(dx, dz);
          let dy = want - b.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          b.yaw += dy * Math.min(1, dt * 1.5);
          moving = true;
        }
      } else if (b.state === 'fish') {
        // Drift slowly round the fishing ground.
        const a = this.time * 0.05 + b.phase;
        b.x += (b.ground.x + Math.cos(a) * 3 - b.x) * Math.min(1, dt * 0.2);
        b.z += (b.ground.z + Math.sin(a) * 3 - b.z) * Math.min(1, dt * 0.2);
        b.yaw += dt * 0.03;
      }
      if (b.state !== 'berth') out++;
      const bob = Math.sin(this.time * 1.4 + b.phase) * 0.04;
      e4.set(Math.sin(this.time * 1.1 + b.phase) * 0.025, b.yaw, Math.sin(this.time * 0.9 + b.phase) * 0.04, 'YXZ');
      q4.setFromEuler(e4);
      v4.set(b.x, 0.02 + bob, b.z);
      s4.set(1, 1, 1);
      m4.compose(v4, q4, s4);
      if (b.kayak) this.kayakMesh.setMatrixAt(nk++, m4);
      else this.canoeMesh.setMatrixAt(nc++, m4);
      // Paddlers out on the water (at the berth the boats wait empty).
      if (b.state !== 'berth') {
        for (let k = 0; k < (b.kayak ? 1 : 2) && nr < this.riderPool.length; k++) {
          const sz = b.kayak ? 0 : k ? -0.85 : 0.85;
          const r = this.riderPool[nr++];
          r.x = b.x + Math.sin(b.yaw) * sz;
          r.y = bob - 0.28;
          r.z = b.z + Math.cos(b.yaw) * sz;
          r.yaw = b.yaw;
          r.pose = moving ? Pose.work : Pose.sit;
          r.phase = this.time * 2 + b.phase + sz;
          this.riders.push(r);
        }
      }
    }
    this.canoeMesh.count = nc;
    this.kayakMesh.count = nk;
    this.canoeMesh.instanceMatrix.needsUpdate = true;
    this.kayakMesh.instanceMatrix.needsUpdate = true;
    this.stats.boats = this.boats.length;
    this.stats.boatsOut = out;
  }

  counts(): Record<string, number> {
    return { ...this.stats };
  }

  dispose(): void {
    for (const pg of this.penguins) {
      pg.m.root.removeFromParent();
      pg.m.dispose();
    }
    this.penguins.length = 0;
    if (this.bear) {
      this.bear.m.root.removeFromParent();
      this.bear.m.dispose();
      this.bear = null;
    }
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const m of this.meshes) m.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

// ---------------------------------------------------------------------------
// Geometry (vertex-coloured, one instanced draw each)
// ---------------------------------------------------------------------------

const at = <G extends THREE.BufferGeometry>(g: G, x: number, y: number, z: number): G => {
  g.translate(x, y, z);
  return g;
};

/** Tiger seal: a long tawny body with dark stripes across the back, a pale belly, a whiskered head. */
function sealGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const body = new THREE.SphereGeometry(0.42, 14, 9);
  body.scale(0.85, 0.62, 2.1);
  parts.push({ g: at(body, 0, 0.27, 0), c: '#c58a4c' });
  const belly = new THREE.SphereGeometry(0.4, 12, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
  belly.scale(0.83, 0.55, 2.0);
  parts.push({ g: at(belly, 0, 0.27, 0), c: '#efe0c4' });
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.TorusGeometry(0.31, 0.035, 4, 10, Math.PI * 0.9);
    stripe.rotateZ(Math.PI * 0.05);
    stripe.scale(1.12, 0.9, 1);
    parts.push({ g: at(stripe, 0, 0.27, -0.6 + i * 0.24), c: '#3b2716' });
  }
  const head = new THREE.SphereGeometry(0.22, 10, 8);
  head.scale(1, 0.9, 1.15);
  parts.push({ g: at(head, 0, 0.42, 0.88), c: '#c88e50' });
  parts.push({ g: at(new THREE.SphereGeometry(0.06, 6, 5), 0, 0.42, 1.12), c: '#2a1c12' });
  for (const s of [-1, 1]) {
    parts.push({ g: at(new THREE.SphereGeometry(0.035, 5, 4), s * 0.1, 0.5, 1.02), c: '#141010' });
    const fl = new THREE.BoxGeometry(0.34, 0.04, 0.2);
    fl.rotateZ(s * 0.5);
    parts.push({ g: at(fl, s * 0.38, 0.12, 0.35), c: '#9c6a3a' });
  }
  const tail = new THREE.ConeGeometry(0.2, 0.42, 6);
  tail.rotateX(-Math.PI / 2);
  tail.scale(1.6, 0.4, 1);
  parts.push({ g: at(tail, 0, 0.18, -0.98), c: '#9c6a3a' });
  return coloured(parts);
}

/** Sled dog: pale coat with a grey saddle, pointed ears, a tail curled over the back. */
function dogGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const body = new THREE.SphereGeometry(0.22, 10, 7);
  body.scale(0.95, 0.9, 1.9);
  parts.push({ g: at(body, 0, 0.5, 0), c: '#e9e6e0' });
  const saddle = new THREE.SphereGeometry(0.215, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.4);
  saddle.scale(0.97, 0.9, 1.85);
  parts.push({ g: at(saddle, 0, 0.53, 0), c: '#8d8f94' });
  const head = new THREE.SphereGeometry(0.13, 8, 6);
  parts.push({ g: at(head, 0, 0.72, 0.44), c: '#efece6' });
  const snout = new THREE.BoxGeometry(0.08, 0.07, 0.14);
  parts.push({ g: at(snout, 0, 0.68, 0.58), c: '#e2ded6' });
  parts.push({ g: at(new THREE.SphereGeometry(0.022, 5, 4), 0, 0.7, 0.65), c: '#1a1a1a' });
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.045, 0.11, 4);
    parts.push({ g: at(ear, s * 0.07, 0.85, 0.42), c: '#8d8f94' });
    for (const zz of [0.24, -0.26]) parts.push({ g: at(new THREE.CylinderGeometry(0.035, 0.03, 0.4, 5), s * 0.11, 0.2, zz), c: '#e3dfd8' });
  }
  const tail = new THREE.TorusGeometry(0.1, 0.04, 5, 8, Math.PI * 1.3);
  tail.rotateY(Math.PI / 2);
  parts.push({ g: at(tail, 0, 0.72, -0.38), c: '#d8d4cc' });
  return coloured(parts);
}

/** Gull: white body, grey wings in a shallow V (scaled in y to beat). */
function gullGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const body = new THREE.SphereGeometry(0.12, 6, 5);
  body.scale(0.8, 0.8, 2.2);
  parts.push({ g: body, c: '#f4f4f2' });
  for (const s of [-1, 1]) {
    const w = new THREE.BufferGeometry();
    w.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, s * 0.75, 0.18, -0.02, 0, 0, -0.14, s * 0.75, 0.18, -0.02, s * 0.4, 0.1, -0.12, 0, 0, -0.14], 3));
    w.computeVertexNormals();
    parts.push({ g: w, c: '#a8adb4' });
  }
  parts.push({ g: at(new THREE.ConeGeometry(0.03, 0.09, 4).rotateX(Math.PI / 2), 0, 0, 0.3), c: '#e2b23a' });
  return coloured(parts);
}

/** Canoe (open, two paddlers) or kayak (decked, one cockpit): dark wood, a blue band, bone prows. */
function canoeGeometry(kayak: boolean): THREE.BufferGeometry {
  const parts: Part[] = [];
  const len = kayak ? 3.6 : 4.8, w = kayak ? 0.55 : 0.85;
  const hull = new THREE.SphereGeometry(0.5, 14, 6, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
  hull.scale(w, 0.7, len);
  parts.push({ g: at(hull, 0, 0.32, 0), c: '#5c3d24' });
  const band = new THREE.TorusGeometry(0.5, 0.03, 4, 24);
  band.rotateX(Math.PI / 2);
  band.scale(w, 1, len);
  parts.push({ g: at(band, 0, 0.3, 0), c: '#2f64a8' });
  if (kayak) {
    const deck = new THREE.SphereGeometry(0.5, 14, 4, 0, Math.PI * 2, 0, Math.PI * 0.18);
    deck.scale(w, 0.4, len);
    parts.push({ g: at(deck, 0, 0.26, 0), c: '#8a6440' });
    const ring = new THREE.TorusGeometry(0.2, 0.03, 4, 10);
    ring.rotateX(Math.PI / 2);
    parts.push({ g: at(ring, 0, 0.36, 0), c: '#3a2614' });
  } else {
    for (const zz of [-0.85, 0.85]) parts.push({ g: at(new THREE.BoxGeometry(w * 0.9, 0.04, 0.16), 0, 0.22, zz), c: '#7a5434' });
  }
  for (const s of [-1, 1]) {
    const prow = new THREE.ConeGeometry(0.06, 0.4, 5);
    prow.rotateX(s * 0.6);
    parts.push({ g: at(prow, 0, 0.45, (s * len) / 2 - s * 0.08), c: '#e6dcc4' });
  }
  return coloured(parts);
}
