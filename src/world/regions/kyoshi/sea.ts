import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { Random } from '../../../core/Random';
import { kitMaterial } from '../../kit/Materials';
import { A, atBearing, KI } from '../../landforms/kyoshiIsland';
import type { P2 } from '../../WorldLayout';
import { shipParts } from '../../../travel/kit';

/**
 * Koi Bay's water life and traffic: fishing boats that go out at dawn and come home through the
 * day, trade ships at anchor and under way, shoals of huge orange elephant koi, the unagi that
 * haunts the deep channel (a warning ripple, a long grey body, a water jet), gulls over the harbor
 * and beach, fowl pecking round the village. Everything is instanced (a handful of draw calls).
 */

export const SEA = {
  fishing: 12,
  traders: 3,
  koi: 26,
  gulls: 12,
  fowl: 16,
  /** Seconds between unagi appearances (when someone is near the bay). */
  unagiEvery: [70, 150] as [number, number],
};

interface Boat {
  /** Stays at its berth all day (nets to mend, a hull to tar). */
  home: boolean;
  /** Route waypoints (berth → out → fishing ground) and timing. */
  route: P2[];
  len: number;
  /** Seconds of the daily cycle offset. */
  offset: number;
  x: number;
  z: number;
  yaw: number;
  moored: P2;
  mooredYaw: number;
}

function polylineLen(p: P2[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  return L;
}

function along(p: P2[], s: number, out: { x: number; z: number; yaw: number }): void {
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || i === p.length - 1) {
      const k = Math.max(0, Math.min(1, s / (L || 1)));
      out.x = a.x + (b.x - a.x) * k;
      out.z = a.z + (b.z - a.z) * k;
      out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
      return;
    }
    s -= L;
  }
}

/** Instanced copies of a multi-material ship. */
class ShipFleet {
  readonly meshes: THREE.InstancedMesh[] = [];
  constructor(parent: THREE.Object3D, style: 'fishing' | 'earth', count: number) {
    const s = shipParts(style);
    for (const part of s.parts) {
      const m = new THREE.InstancedMesh(part.geo, kitMaterial(part.mat), count);
      m.castShadow = style !== 'fishing';
      m.receiveShadow = true;
      m.frustumCulled = false;
      parent.add(m);
      this.meshes.push(m);
    }
  }
  set(i: number, m: THREE.Matrix4): void {
    for (const im of this.meshes) im.setMatrixAt(i, m);
  }
  commit(): void {
    for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
  }
  dispose(): void {
    for (const im of this.meshes) {
      im.removeFromParent();
      im.geometry.dispose();
      im.dispose();
    }
  }
}

function koiGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 10, 6);
  body.scale(0.45, 0.32, 1.25);
  const tail = new THREE.ConeGeometry(0.42, 0.9, 6);
  tail.rotateX(-Math.PI / 2);
  tail.scale(1, 0.2, 1);
  tail.translate(0, 0, -1.45);
  const parts = [body, tail].map((g) => g.toNonIndexed());
  const n = parts.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  const orange = new THREE.Color('#ee6a1e'), white = new THREE.Color('#f4efe6');
  for (const g of parts) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++, o++) {
      pos[o * 3] = p.getX(i);
      pos[o * 3 + 1] = p.getY(i);
      pos[o * 3 + 2] = p.getZ(i);
      const spot = Math.sin(p.getX(i) * 6 + p.getZ(i) * 3) > 0.35 || p.getY(i) < -0.18;
      const c = spot ? white : orange;
      col[o * 3] = c.r;
      col[o * 3 + 1] = c.g;
      col[o * 3 + 2] = c.b;
    }
  }
  body.dispose();
  tail.dispose();
  for (const g of parts) g.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Flat-coloured parts merged into one vertex-coloured geometry (one instanced draw). */
function coloured(parts: Array<[THREE.BufferGeometry, string]>): THREE.BufferGeometry {
  const flat = parts.map(([g]) => g.toNonIndexed());
  const n = flat.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  let o = 0;
  flat.forEach((g, j) => {
    c.set(parts[j][1]);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++, o++) {
      pos[o * 3] = p.getX(i);
      pos[o * 3 + 1] = p.getY(i);
      pos[o * 3 + 2] = p.getZ(i);
      col[o * 3] = c.r;
      col[o * 3 + 1] = c.g;
      col[o * 3 + 2] = c.b;
    }
    g.dispose();
    parts[j][0].dispose();
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A small hen (facing +Z): body, raised tail, head with a red comb and wattle, yellow beak and legs. */
function henGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.2, 8, 6);
  body.scale(0.85, 0.8, 1.15);
  body.translate(0, 0.3, 0);
  const tail = new THREE.ConeGeometry(0.12, 0.26, 5);
  tail.rotateX(-2.3);
  tail.translate(0, 0.42, -0.24);
  const head = new THREE.SphereGeometry(0.085, 7, 5);
  head.translate(0, 0.5, 0.17);
  const comb = new THREE.BoxGeometry(0.025, 0.07, 0.1);
  comb.translate(0, 0.6, 0.17);
  const wattle = new THREE.SphereGeometry(0.03, 5, 4);
  wattle.translate(0, 0.43, 0.24);
  const beak = new THREE.ConeGeometry(0.03, 0.08, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.49, 0.27);
  const legL = new THREE.CylinderGeometry(0.014, 0.014, 0.16, 4);
  legL.translate(0.06, 0.08, 0);
  const legR = legL.clone();
  legR.translate(-0.12, 0, 0);
  return coloured([
    [body, '#e8dfcc'],
    [tail, '#d9cdb4'],
    [head, '#ece4d2'],
    [comb, '#c8322a'],
    [wattle, '#c8322a'],
    [beak, '#e0a53a'],
    [legL, '#d8a040'],
    [legR, '#d8a040'],
  ]);
}

export class BaySea {
  readonly group = new THREE.Group();
  private readonly rnd = new Random(KI.seed + 7);
  private readonly fishing: ShipFleet;
  private readonly traders: ShipFleet;
  private readonly boats: Boat[] = [];
  private readonly koiMesh: THREE.InstancedMesh;
  private readonly koiMat: THREE.MeshStandardMaterial;
  private readonly koi: Array<{ cx: number; cz: number; r: number; w: number; a: number; depth: number; jump: number }> = [];
  private readonly unagiMesh: THREE.InstancedMesh;
  private readonly unagiMat: THREE.MeshStandardMaterial;
  private readonly gullL: THREE.InstancedMesh;
  private readonly gullR: THREE.InstancedMesh;
  private readonly gullMat: THREE.MeshStandardMaterial;
  private readonly fowlMesh: THREE.InstancedMesh;
  private readonly fowlMat: THREE.MeshStandardMaterial;
  private readonly fowl: Array<{ x: number; z: number; y: number; yaw: number; t: number }> = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly tmp = { x: 0, z: 0, yaw: 0 };
  /** Unagi state: 0 idle, else seconds into an appearance. */
  private unagiT = 0;
  private unagiNext = 40;
  private unagiAt: P2 = { x: 0, z: 0 };
  private unagiYaw = 0;
  unagiSeen = 0;
  private fishingTime = 0;

  constructor(parent: THREE.Group, piers: Array<{ root: P2; head: P2; yaw: number }>, villagePts: P2[], private readonly ground: (x: number, z: number) => number) {
    this.group.name = 'kyoshi_sea';
    parent.add(this.group);
    const rnd = this.rnd;
    this.fishing = new ShipFleet(this.group, 'fishing', SEA.fishing);
    this.traders = new ShipFleet(this.group, 'earth', SEA.traders);
    // Fishing boats: berths along the piers; routes out of the bay mouth to fishing grounds.
    const mouth = atBearing(225, 300), sea = atBearing(225, 620);
    for (let i = 0; i < SEA.fishing; i++) {
      const p = piers[i % piers.length];
      const side = i % 2 ? 1 : -1;
      const k = 0.35 + 0.18 * Math.floor(i / piers.length);
      const cx = p.root.x + (p.head.x - p.root.x) * k, cz = p.root.z + (p.head.z - p.root.z) * k;
      const nx = -(p.head.z - p.root.z), nz = p.head.x - p.root.x;
      const nl = Math.hypot(nx, nz) || 1;
      const moored = { x: cx + (nx / nl) * side * 3.2, z: cz + (nz / nl) * side * 3.2 };
      const ground = atBearing(195 + rnd.range(0, 70), rnd.range(560, 780));
      const route = [moored, { x: (moored.x + p.head.x) / 2 + (nx / nl) * side * 6, z: (moored.z + p.head.z) / 2 + (nz / nl) * side * 6 }, A(0.5, 120), mouth, sea, ground];
      this.boats.push({ home: i % 3 === 2, route, len: polylineLen(route), offset: rnd.range(0, 1), x: moored.x, z: moored.z, yaw: Math.atan2(p.head.x - p.root.x, p.head.z - p.root.z), moored, mooredYaw: Math.atan2(p.head.x - p.root.x, p.head.z - p.root.z) });
    }
    // Koi shoals in the bay's clear water (west and north, away from the harbor).
    for (let i = 0; i < SEA.koi; i++) {
      const shoal = i % 3;
      const c = A(0.16 + shoal * 0.12, KI.Ri - 45 - shoal * 18);
      this.koi.push({ cx: c.x, cz: c.z, r: rnd.range(6, 18), w: rnd.range(0.12, 0.25) * (rnd.chance(0.5) ? 1 : -1), a: rnd.range(0, Math.PI * 2), depth: rnd.range(0.4, 1.3), jump: rnd.range(10, 60) });
    }
    this.koiMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
    this.koiMesh = new THREE.InstancedMesh(koiGeometry(), this.koiMat, SEA.koi);
    this.koiMesh.frustumCulled = false;
    this.group.add(this.koiMesh);
    // The unagi: 16 body segments and a head (instanced), hidden until it surfaces.
    this.unagiMat = new THREE.MeshStandardMaterial({ color: '#5d6a62', roughness: 0.4, metalness: 0.1 });
    const seg = new THREE.SphereGeometry(1, 10, 7);
    this.unagiMesh = new THREE.InstancedMesh(seg, this.unagiMat, 17);
    this.unagiMesh.frustumCulled = false;
    this.unagiMesh.visible = false;
    this.group.add(this.unagiMesh);
    // Gulls: two instanced wings per bird.
    this.gullMat = new THREE.MeshStandardMaterial({ color: '#f1f1ee', roughness: 0.8, side: THREE.DoubleSide });
    const wing = new THREE.PlaneGeometry(0.9, 0.28);
    wing.translate(0.45, 0, 0);
    wing.rotateX(-Math.PI / 2);
    const wingR = wing.clone();
    wingR.scale(-1, 1, 1);
    this.gullL = new THREE.InstancedMesh(wing, this.gullMat, SEA.gulls);
    this.gullR = new THREE.InstancedMesh(wingR, this.gullMat, SEA.gulls);
    for (const g of [this.gullL, this.gullR]) {
      g.frustumCulled = false;
      this.group.add(g);
    }
    // Village fowl.
    this.fowlMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.fowlMesh = new THREE.InstancedMesh(henGeometry(), this.fowlMat, SEA.fowl);
    this.fowlMesh.frustumCulled = false;
    this.group.add(this.fowlMesh);
    for (let i = 0; i < SEA.fowl; i++) {
      const c = villagePts[i % Math.max(1, villagePts.length)] ?? A(KI.village.u, 300);
      const x = c.x + rnd.range(-6, 6), z = c.z + rnd.range(-6, 6);
      this.fowl.push({ x, z, y: ground(x, z), yaw: rnd.range(0, 6.28), t: rnd.range(0, 5) });
    }
  }

  /** Seconds into the boats' daily rhythm: out at dawn (5–8), fishing, home by early afternoon. */
  private boatState(b: Boat, hour: number): { moving: boolean; s: number } {
    if (b.home) return { moving: false, s: 0 };
    const out0 = 5 + b.offset * 3, back0 = 11 + b.offset * 3.5;
    const sail = 0.45; // hours under way each direction
    if (hour >= out0 && hour < out0 + sail) return { moving: true, s: ((hour - out0) / sail) * b.len };
    if (hour >= out0 + sail && hour < back0) return { moving: true, s: b.len - 4 + Math.sin(hour * 9 + b.offset * 20) * 4 };
    if (hour >= back0 && hour < back0 + sail) return { moving: true, s: (1 - (hour - back0) / sail) * b.len };
    return { moving: false, s: 0 };
  }

  update(dt: number, ctx: GameContext, near: boolean): void {
    const t = ctx.time.elapsed;
    const hour = ctx.world.sky.timeOfDay;
    this.fishingTime += dt;
    const m = this.m, q = this.q, e = this.e, s = this.s, p = this.p;
    // Fishing boats.
    for (let i = 0; i < this.boats.length; i++) {
      const b = this.boats[i];
      const st = this.boatState(b, hour);
      let yaw = b.mooredYaw;
      if (st.moving) {
        along(b.route, st.s, this.tmp);
        b.x = this.tmp.x;
        b.z = this.tmp.z;
        yaw = this.tmp.yaw;
      } else {
        b.x = b.moored.x;
        b.z = b.moored.z;
      }
      const bob = Math.sin(t * 1.3 + i) * 0.08;
      e.set(Math.sin(t * 0.9 + i) * 0.03, yaw, Math.sin(t * 1.1 + i * 2) * 0.04);
      q.setFromEuler(e);
      m.compose(p.set(b.x, 0.05 + bob, b.z), q, s.set(1, 1, 1));
      this.fishing.set(i, m);
    }
    this.fishing.commit();
    // Trade ships: one at the passenger pier, one at anchor, one sailing in and out on a slow loop.
    const pier = A(0.82, 160), anchor = A(0.62, 95);
    const loop = (t * 0.004) % 1;
    const inout = loop < 0.5 ? loop * 2 : 2 - loop * 2;
    const far = atBearing(228, 900), mid = A(0.45, 90);
    const sx = far.x + (mid.x - far.x) * inout, sz = far.z + (mid.z - far.z) * inout;
    const ships: Array<[number, number, number]> = [
      [pier.x, pier.z, Math.atan2(A(0.82, 120).x - pier.x, A(0.82, 120).z - pier.z) + Math.PI / 2],
      [anchor.x, anchor.z, 0.6 + Math.sin(t * 0.05) * 0.1],
      [sx, sz, Math.atan2(mid.x - far.x, mid.z - far.z) + (loop < 0.5 ? 0 : Math.PI)],
    ];
    for (let i = 0; i < ships.length; i++) {
      e.set(Math.sin(t * 0.7 + i) * 0.015, ships[i][2], Math.sin(t * 0.8 + i) * 0.02);
      q.setFromEuler(e);
      m.compose(p.set(ships[i][0], Math.sin(t * 0.9 + i) * 0.06, ships[i][1]), q, s.set(1, 1, 1));
      this.traders.set(i, m);
    }
    this.traders.commit();
    if (!near) return;
    // Koi: circling shoals just under the surface, now and then a leap.
    for (let i = 0; i < this.koi.length; i++) {
      const k = this.koi[i];
      k.a += k.w * dt;
      let y = -k.depth;
      k.jump -= dt;
      let pitch = 0;
      if (k.jump < 0) {
        const j = -k.jump;
        if (j < 1.2) {
          y = -0.3 + Math.sin((j / 1.2) * Math.PI) * 1.8;
          pitch = -Math.cos((j / 1.2) * Math.PI) * 0.8;
          if (j < dt * 1.5) ctx.vfx.burst('spray', p.set(k.cx + Math.cos(k.a) * k.r, 0.1, k.cz + Math.sin(k.a) * k.r), { count: 6, speed: 2 });
        } else k.jump = this.rnd.range(20, 70);
      }
      // Flee from the unagi.
      if (this.unagiT > 0 && Math.hypot(k.cx - this.unagiAt.x, k.cz - this.unagiAt.z) < 60) k.w = Math.sign(k.w || 1) * 0.6;
      const x = k.cx + Math.cos(k.a) * k.r, z = k.cz + Math.sin(k.a) * k.r;
      const yaw = Math.atan2(-Math.sin(k.a) * Math.sign(k.w), Math.cos(k.a) * Math.sign(k.w)) + Math.sin(t * 6 + i) * 0.12;
      e.set(pitch, yaw, 0);
      q.setFromEuler(e);
      const sc = 1.15 + (i % 5) * 0.12;
      m.compose(p.set(x, y, z), q, s.set(sc, sc, sc));
      this.koiMesh.setMatrixAt(i, m);
    }
    this.koiMesh.instanceMatrix.needsUpdate = true;
    this.updateUnagi(dt, ctx);
    // Gulls wheeling over the harbor and the beach.
    for (let i = 0; i < SEA.gulls; i++) {
      const c = i % 2 ? A(0.82, 200) : A(0.22, 200);
      const r = 18 + (i % 4) * 9, w = 0.18 + (i % 3) * 0.05;
      const a = t * w + i * 1.7;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, y = 16 + (i % 5) * 4 + Math.sin(t * 0.5 + i) * 2;
      const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
      const flap = Math.sin(t * 7 + i) * 0.5;
      for (const [im, sgn] of [[this.gullL, 1], [this.gullR, -1]] as const) {
        e.set(0, yaw, sgn * flap);
        q.setFromEuler(e);
        m.compose(p.set(x, y, z), q, s.set(1, 1, 1));
        im.setMatrixAt(i, m);
      }
    }
    this.gullL.instanceMatrix.needsUpdate = true;
    this.gullR.instanceMatrix.needsUpdate = true;
    // Fowl: peck, wander a little (asleep at night).
    const night = hour >= 21 || hour < 5.5;
    for (let i = 0; i < this.fowl.length; i++) {
      const f = this.fowl[i];
      f.t -= dt;
      if (!night && f.t < 0) {
        f.t = this.rnd.range(1.5, 4);
        f.yaw += this.rnd.range(-1.2, 1.2);
        const nx = f.x + Math.sin(f.yaw) * 0.6, nz = f.z + Math.cos(f.yaw) * 0.6;
        f.x = nx;
        f.z = nz;
        f.y = this.ground(nx, nz);
      }
      const peck = night ? 0 : Math.max(0, Math.sin(t * 5 + i)) * 0.35;
      e.set(peck, f.yaw, 0);
      q.setFromEuler(e);
      m.compose(p.set(f.x, f.y, f.z), q, s.set(1, 1, 1));
      this.fowlMesh.setMatrixAt(i, m);
    }
    this.fowlMesh.instanceMatrix.needsUpdate = true;
  }

  /** The unagi: a warning ripple, a long grey body arching out of the deep channel, a water jet. */
  private updateUnagi(dt: number, ctx: GameContext): void {
    if (this.unagiT <= 0) {
      this.unagiNext -= dt;
      if (this.unagiNext > 0) return;
      this.unagiNext = this.rnd.range(SEA.unagiEvery[0], SEA.unagiEvery[1]);
      this.unagiT = 0.001;
      this.unagiAt = A(this.rnd.range(0.3, 0.7), this.rnd.range(40, 120));
      this.unagiYaw = this.rnd.range(0, Math.PI * 2);
      this.unagiSeen++;
      ctx.events.emit('ui:notify', { text: 'The water churns in the deep channel…', kind: 'info', duration: 3 });
    }
    this.unagiT += dt;
    const T = this.unagiT;
    const p = this.p, m = this.m, q = this.q, s = this.s;
    const c = this.unagiAt;
    if (T < 2.5) {
      // Warning ripple.
      if (Math.floor(T * 4) !== Math.floor((T - dt) * 4)) ctx.vfx.burst('spray', p.set(c.x, 0.1, c.z), { count: 10, speed: 1.4, spread: 1.2 });
      this.unagiMesh.visible = false;
      return;
    }
    const k = (T - 2.5) / 6;
    if (k >= 1) {
      this.unagiMesh.visible = false;
      this.unagiT = 0;
      return;
    }
    this.unagiMesh.visible = true;
    const fx = Math.sin(this.unagiYaw), fz = Math.cos(this.unagiYaw);
    const rise = Math.sin(k * Math.PI);
    for (let i = 0; i < 17; i++) {
      const u = i / 16;
      const along = (u - 0.5) * 26 + k * 18;
      const arc = Math.sin(u * Math.PI * 1.6 + k * 4) * 4.2 * rise - 2.2 + rise * 1.4;
      const sway = Math.sin(u * 7 + T * 3) * 1.2;
      const x = c.x + fx * along - fz * sway, z = c.z + fz * along + fx * sway;
      const r = i === 16 ? 1.5 : 0.85 + Math.sin(u * Math.PI) * 0.55;
      q.identity();
      m.compose(p.set(x, arc, z), q, s.set(r, r * (i === 16 ? 0.8 : 1), r * (i === 16 ? 1.6 : 1.3)));
      this.unagiMesh.setMatrixAt(i, m);
    }
    this.unagiMesh.instanceMatrix.needsUpdate = true;
    // The jet of water at the top of the arc.
    if (k > 0.45 && k - dt / 6 <= 0.45) {
      const hx = c.x + fx * (8 + 18 * k), hz = c.z + fz * (8 + 18 * k);
      ctx.vfx.burst('spray', p.set(hx, 3, hz), { count: 40, speed: 9, spread: 0.35, dir: new THREE.Vector3(0, 1, 0) });
    }
  }

  counts(): Record<string, number> {
    let out = 0;
    const hour = 0;
    void hour;
    for (const b of this.boats) if (Math.hypot(b.x - b.moored.x, b.z - b.moored.z) > 2) out++;
    return { fishing: this.boats.length, out, traders: SEA.traders, koi: this.koi.length, gulls: SEA.gulls, fowl: this.fowl.length, unagi: this.unagiT > 0 ? 1 : 0, unagiSeen: this.unagiSeen };
  }

  /** Debug: make the unagi surface now. */
  summonUnagi(): void {
    this.unagiNext = 0;
    this.unagiT = 0;
  }

  dispose(): void {
    this.fishing.dispose();
    this.traders.dispose();
    for (const im of [this.koiMesh, this.unagiMesh, this.gullL, this.gullR, this.fowlMesh]) {
      im.removeFromParent();
      im.geometry.dispose();
      im.dispose();
    }
    for (const mt of [this.koiMat, this.unagiMat, this.gullMat, this.fowlMat]) mt.dispose();
    this.group.removeFromParent();
  }
}
