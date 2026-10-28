import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { ProjectileVisual } from '../../combat/types';
import type { BoneName } from '../../character/Animator';
import type { Humanoid } from '../../character/Humanoid';
import { debris, effect } from './loop';
import { fbm3 } from './noise';
import { rockGeometry, spikeGeometry, stoneMaterial } from './rocks';

/**
 * Earth effect builders: rocks torn out of the ground (they visibly rise from
 * where they came from), tumbling projectiles with dust, crowns of shards for
 * shockwaves, and stone plates bound to a humanoid's bones (guard / armor).
 */

const tmp = new THREE.Vector3();

function q(ctx: GameContext): 'low' | 'medium' | 'high' {
  return ctx.vfx.quality;
}

/**
 * A rock that erupts from the ground and hovers, waiting to be thrown. Animate
 * with the windup; hand it to a projectile with toVisual() at release.
 * `disc`: a flat stone disc (earth disc) that spins flat while it hovers and
 * flies spinning flat, like a thrown plate, instead of tumbling.
 */
export class RisingRock {
  readonly mesh: THREE.Mesh;
  private t = 0;
  private alive = true;
  private launched = false;
  readonly current = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext,
    private readonly ground: THREE.Vector3,
    private readonly hoverY: number,
    readonly radius: number,
    readonly tint: string,
    private readonly riseTime = 0.2,
    readonly disc = false,
  ) {
    this.mesh = new THREE.Mesh(rockGeometry(Math.floor(Math.random() * 8), q(ctx) === 'high' ? 2 : 1), stoneMaterial(tint));
    this.mesh.scale.setScalar(radius);
    if (disc) this.mesh.scale.y = radius * 0.3;
    this.mesh.castShadow = q(ctx) !== 'low';
    this.mesh.position.copy(ground).setY(ground.y - radius);
    this.current.copy(this.mesh.position);
    ctx.vfx.group.add(this.mesh);
    ctx.vfx.burst('dust', ground, { count: 6, radius: radius, speed: 0.9 });
    debris(ground, q(ctx) === 'low' ? 3 : 6, { spread: 0.7, speed: 4.5, size: radius * 0.25, radius: radius * 0.6, color: tint, life: 1.2 });
    ctx.world.fx.crack(ground, radius * 1.8);
    effect(
      (dt) => {
        if (!this.alive || this.launched) return false;
        this.t += dt;
        const k = Math.min(1, this.t / riseTime);
        const e = 1 - Math.pow(1 - k, 3);
        const y = ground.y - radius + (hoverY - (ground.y - radius)) * e + (k >= 1 ? Math.sin(this.t * 9) * 0.03 : 0);
        this.mesh.position.set(ground.x, y, ground.z);
        this.mesh.rotation.y += dt * (disc ? 14 : 2);
        this.current.copy(this.mesh.position);
        return true;
      },
      () => {
        if (!this.launched) this.dispose();
      },
    );
  }

  /** Becomes the projectile's visual (same mesh), tumbling with a dust trail. */
  toVisual(): ProjectileVisual {
    this.launched = true;
    this.mesh.removeFromParent();
    this.mesh.position.set(0, 0, 0);
    return rockVisualFor(this.ctx, this.mesh, this.radius, this.tint, true, this.disc);
  }

  /** Crumble without throwing (interrupted). */
  crumble(): void {
    if (!this.alive || this.launched) return;
    debris(this.mesh.position, 6, { spread: 1.2, speed: 3, size: this.radius * 0.3, color: this.tint });
    this.ctx.vfx.burst('dust', this.mesh.position, { count: 6, radius: this.radius });
    this.dispose();
  }

  private dispose(): void {
    this.alive = false;
    this.mesh.removeFromParent();
  }
}

function rockVisualFor(ctx: GameContext, mesh: THREE.Mesh, radius: number, tint: string, owned: boolean, disc = false): ProjectileVisual {
  const group = new THREE.Group();
  group.add(mesh);
  // A disc spins flat about its own axis (slightly tilted, like a thrown plate); rocks tumble.
  const spin = disc ? new THREE.Vector3(0, 24, 0) : new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
  if (disc) {
    mesh.rotation.set(0, 0, 0);
    group.rotation.z = 0.12;
  }
  const dust = ctx.vfx.emitter('dust', q(ctx) === 'low' ? 10 : 22, { speed: 0.3, size: 0.25 + radius * 0.5, color: '#b8a488' }, 3);
  let t = 0;
  return {
    object: group,
    update: (p, dt) => {
      t += dt;
      mesh.rotation.x += spin.x * dt;
      mesh.rotation.y += spin.y * dt;
      mesh.rotation.z += spin.z * dt;
      dust.position.copy(p.position);
      if (Math.random() < dt * 6) debris(p.position, 1, { spread: 0.5, speed: 1, size: radius * 0.18, color: tint, life: 0.8 });
    },
    dispose: () => {
      dust.stop();
      if (!owned) mesh.geometry.dispose();
    },
  };
}

/** Thrown rock visual (no rising phase). */
export function rockVisual(ctx: GameContext, radius: number, tint: string): ProjectileVisual {
  const mesh = new THREE.Mesh(rockGeometry(Math.floor(Math.random() * 8), q(ctx) === 'high' ? 2 : 1), stoneMaterial(tint));
  mesh.scale.setScalar(radius);
  mesh.castShadow = q(ctx) !== 'low';
  return rockVisualFor(ctx, mesh, radius, tint, true);
}

/** Rock impact: chunks, dust, a crack. */
export function rockImpact(ctx: GameContext, pos: THREE.Vector3, size: number, tint: string): void {
  debris(pos, Math.round((q(ctx) === 'low' ? 4 : 8) + size * 6), { spread: 1.3, speed: 5 + size * 3, size: 0.1 + size * 0.12, radius: size * 0.3, color: tint, life: 1.6 });
  ctx.vfx.burst('dust', pos, { count: Math.round(6 + size * 8), radius: size * 0.6, speed: 1.2 + size });
  ctx.vfx.burst('debris', pos, { count: Math.round(4 + size * 6), color: tint });
  const g = ctx.world.groundAt(pos.x, pos.z, pos.y + 1).y;
  if (pos.y - g < 1.2) ctx.world.fx.crack(tmp.set(pos.x, g, pos.z), 0.6 + size);
}

/**
 * Crown of stone shards bursting out of the ground in an expanding ring
 * (shockwave stomps). Visual only — pair with a ringSweep for hits.
 */
export function shardRing(ctx: GameContext, center: THREE.Vector3, radius: number, tint: string, duration = 0.3): void {
  const low = q(ctx) === 'low';
  const rings = radius > 5 ? 2 : 1;
  for (let r = 0; r < rings; r++) {
    const rr = radius * (rings === 1 ? 0.6 : r === 0 ? 0.4 : 0.85);
    const n = Math.round((low ? 7 : 12) * (0.6 + rr / radius));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const x = center.x + Math.cos(a) * rr, z = center.z + Math.sin(a) * rr;
      const g = ctx.world.groundAt(x, z, center.y + 2).y;
      if (ctx.world.liquidAt(x, z)) continue;
      const h = 0.7 + Math.random() * 0.8 + (r === 0 ? 0.3 : 0);
      const w = 0.25 + Math.random() * 0.2;
      const m = new THREE.Mesh(spikeGeometry(i % 4), stoneMaterial(tint));
      m.position.set(x, g - h, z);
      // Lean outward from the centre.
      m.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5, 'XYZ');
      m.lookAt(x + Math.cos(a), g + 2.2, z + Math.sin(a));
      m.rotateX(Math.PI / 2);
      m.scale.set(w, h, w);
      const delay = (rr / radius) * duration * 0.8;
      const life = delay + 0.75;
      ctx.vfx.addTransient(m, life, (t) => {
        const lt = (t * life - delay) / 0.75;
        if (lt <= 0) return;
        const up = lt < 0.2 ? 1 - Math.pow(1 - lt / 0.2, 3) : lt > 0.55 ? Math.max(0, 1 - (lt - 0.55) / 0.45) : 1;
        m.position.y = g - h + h * up * 0.95;
        if (lt > 0.02 && lt < 0.06 && Math.random() < 0.5) ctx.vfx.burst('dust', tmp.set(x, g + 0.1, z), { count: 2, speed: 1 });
      }, () => {});
    }
  }
  ctx.vfx.ring(center.clone().setY(center.y + 0.12), '#c8b088', radius * 1.15, duration + 0.25, { opacity: 0.55 });
  ctx.vfx.burst('dust', center, { count: low ? 18 : 34, radius: radius * 0.5, speed: 2.4, size: 1.4 });
  debris(center, low ? 8 : 16, { spread: 1.4, speed: 7, size: 0.16, radius: radius * 0.4, color: tint, life: 1.8 });
}

/** Stone plates bound to humanoid bones (Stone Guard forearms, Rock Armor). */
export class BoneArmor {
  private readonly parts: Array<{ mesh: THREE.Mesh; bone: THREE.Object3D; scale: THREE.Vector3; delay: number }> = [];
  private t = 0;
  private dying = false;
  private dieT = 0;
  private alive = true;

  constructor(
    private readonly ctx: GameContext,
    private readonly humanoid: Humanoid,
    spec: Array<{ bone: BoneName; offset: [number, number, number]; scale: [number, number, number]; rot?: [number, number, number] }>,
    readonly tint: string,
  ) {
    spec.forEach((s, i) => {
      const bone = humanoid.bones[s.bone];
      const mesh = new THREE.Mesh(rockGeometry((i * 3) % 8, 1), stoneMaterial(tint));
      mesh.position.set(...s.offset);
      if (s.rot) mesh.rotation.set(...s.rot);
      mesh.scale.setScalar(0.001);
      mesh.castShadow = q(ctx) !== 'low';
      bone.add(mesh);
      this.parts.push({ mesh, bone, scale: new THREE.Vector3(...s.scale), delay: i * 0.03 });
    });
    effect(
      (dt) => this.update(dt),
      () => this.dispose(),
    );
  }

  private update(dt: number): boolean {
    if (!this.alive) return false;
    this.t += dt;
    if (this.dying) {
      this.dieT += dt;
      if (this.dieT > 0.01) {
        for (const p of this.parts) {
          p.mesh.getWorldPosition(tmp);
          debris(tmp, 2, { spread: 1.4, speed: 3, size: 0.09, color: this.tint, life: 1.2 });
        }
        this.ctx.vfx.burst('dust', this.humanoid.root.getWorldPosition(tmp).setY(tmp.y + 1), { count: 8, radius: 0.6 });
        return false;
      }
      return true;
    }
    for (const p of this.parts) {
      const k = Math.min(1, Math.max(0, (this.t - p.delay) / 0.18));
      const e = 1 - Math.pow(1 - k, 3);
      p.mesh.scale.copy(p.scale).multiplyScalar(Math.max(0.001, e * (k < 1 ? 1.15 - 0.15 * k : 1)));
    }
    return true;
  }

  /** Crack off and fall away as debris. */
  shatter(): void {
    this.dying = true;
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const p of this.parts) p.mesh.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Earth Surf wave
// ---------------------------------------------------------------------------

const WAVE_HALF_W = 1.45;
const WAVE_BACK = -2.9;
const WAVE_FRONT = 2.1;
/** The crest sits a little ahead of the rider's feet: they ride its back slope. */
const WAVE_CREST = 0.35;
const WAKE_MAX = 40;
const wM = new THREE.Matrix4();
const wQ = new THREE.Quaternion();
const wE = new THREE.Euler();
const wS = new THREE.Vector3();
const wP = new THREE.Vector3();
const wD = new THREE.Vector3();

interface WakeRidge {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sz: number;
  age: number;
  life: number;
}

/**
 * Earth Surf's wave: a crest of earth that swells out of the ground under and just ahead of the
 * rider and travels with them, conforming to the terrain, its surface churning. Boulders tumble
 * over its front, clods spray off its flanks, and two ridges of pushed-aside earth settle back
 * into the ground behind it. ride() every frame while riding; update() runs from the effect
 * loop; collapse() sinks it into rubble, after which `done` turns true and dispose() frees it.
 */
export class EarthWave {
  private readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly nx: number;
  private readonly nz: number;
  private readonly boulders: Array<{ mesh: THREE.Mesh; x: number; s: number; phase: number }> = [];
  private readonly wake: THREE.InstancedMesh;
  private readonly ridges: WakeRidge[] = [];
  private readonly origin = new THREE.Vector3();
  private readonly lastRidge = new THREE.Vector3();
  private yaw = 0;
  private speed = 0;
  private t = 0;
  private roll = 0;
  private sprayT = 0;
  private height = 0;
  private riding = false;
  private collapsing = false;
  /** True once collapsed and every ridge has settled. */
  done = false;

  constructor(private readonly ctx: GameContext, private readonly tint: string) {
    const q = ctx.vfx.quality;
    this.nx = q === 'low' ? 9 : q === 'medium' ? 11 : 13;
    this.nz = q === 'low' ? 13 : q === 'medium' ? 17 : 21;
    const n = this.nx * this.nz;
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let j = 0; j < this.nz - 1; j++) {
      for (let i = 0; i < this.nx - 1; i++) {
        const a = j * this.nx + i;
        const b = a + 1;
        const c = a + this.nx;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, stoneMaterial(tint));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = q !== 'low';
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    ctx.vfx.group.add(this.mesh);
    const nb = q === 'low' ? 3 : 4;
    for (let i = 0; i < nb; i++) {
      const mesh = new THREE.Mesh(rockGeometry(i * 3 + 1, 0), stoneMaterial(tint));
      mesh.castShadow = q !== 'low';
      mesh.visible = false;
      ctx.vfx.group.add(mesh);
      this.boulders.push({ mesh, x: (i - (nb - 1) / 2) * 0.62, s: 0.26 + 0.08 * ((i * 5) % 3) * 0.5, phase: i * 2.1 });
    }
    this.wake = new THREE.InstancedMesh(rockGeometry(5, 0), stoneMaterial(tint), WAKE_MAX);
    // The shoved-aside earth is the same dark soil as the wave, not pale stone.
    const soil = new THREE.Color(0.62, 0.53, 0.44);
    for (let i = 0; i < WAKE_MAX; i++) this.wake.setColorAt(i, soil);
    this.wake.count = 0;
    this.wake.frustumCulled = false;
    this.wake.receiveShadow = true;
    ctx.vfx.group.add(this.wake);
  }

  /** How high the crest lifts the rider's feet (m). */
  get lift(): number {
    return this.height * 0.9;
  }

  /** The rider's position, travel heading and speed this frame. */
  ride(pos: THREE.Vector3, yaw: number, speed: number): void {
    if (this.collapsing) return;
    if (!this.riding) this.lastRidge.copy(pos);
    this.riding = true;
    this.origin.copy(pos);
    this.yaw = yaw;
    this.speed = speed;
  }

  /** The rider stepped off (or the wave broke): it sinks back into the ground as rubble. */
  collapse(): void {
    if (this.collapsing) return;
    this.collapsing = true;
    if (!this.riding) return;
    const top = wP.set(this.origin.x + Math.sin(this.yaw) * WAVE_CREST, this.origin.y + this.height * 0.6, this.origin.z + Math.cos(this.yaw) * WAVE_CREST);
    debris(top, this.ctx.vfx.quality === 'low' ? 8 : 14, { spread: 1.3, speed: 4.5, size: 0.14, radius: 0.8, color: this.tint, life: 1.3 });
    this.ctx.vfx.burst('dust', top, { count: 10, radius: 1.1, speed: 1.4 });
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.riding) {
      if (this.collapsing) this.done = true;
      return;
    }
    const want = this.collapsing ? 0 : 0.5 + 0.3 * Math.min(1, this.speed / 14);
    this.height += (want - this.height) * Math.min(1, dt * (this.collapsing ? 6 : 5));
    this.build();
    this.updateBoulders(dt);
    if (!this.collapsing) this.spray(dt);
    this.updateWake(dt);
    if (this.collapsing && this.height < 0.03) {
      this.mesh.visible = false;
      for (const b of this.boulders) b.mesh.visible = false;
      if (this.ridges.length === 0) this.done = true;
    }
  }

  private build(): void {
    const world = this.ctx.world;
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const col = this.geo.attributes.color as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const C = col.array as Float32Array;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
    const o = this.origin;
    const H = this.height;
    const nx = this.nx, nz = this.nz;
    this.mesh.position.copy(o);
    this.mesh.visible = true;
    for (let j = 0; j < nz; j++) {
      const v = j / (nz - 1);
      const z = WAVE_BACK + (WAVE_FRONT - WAVE_BACK) * v;
      const dz = z - WAVE_CREST;
      // A steep front face, the back slope the rider stands on, a settling ripple behind.
      const prof = (dz > 0 ? Math.exp(-(dz * dz) / 0.3) : Math.exp(-(dz * dz) / 1.8)) + 0.25 * Math.exp(-((z + 2.0) * (z + 2.0)) / 0.3);
      const endFade = Math.min(1, v / 0.12, (1 - v) / 0.1);
      for (let i = 0; i < nx; i++) {
        const u = i / (nx - 1);
        const x = (u * 2 - 1) * WAVE_HALF_W;
        const ax = Math.abs(x) / WAVE_HALF_W;
        const cross = Math.pow(Math.max(0, 1 - ax * ax), 1.3) * endFade;
        const wx = o.x + sx * x + fx * z;
        const wz = o.z + sz * x + fz * z;
        const g = world.groundAt(wx, wz, o.y + 2.5).y;
        // Churning clods that roll forward with the wave (coarse lumps plus grit).
        const churn = (fbm3(wx * 2.2, wz * 2.2, this.t * 2.2) * 0.16 + fbm3(wx * 5.1, wz * 5.1, this.t * 3) * 0.05) * Math.min(1, H * 3) * (0.35 + prof);
        const h = (H * prof + churn) * cross - 0.05 * (1 - cross);
        const k = (j * nx + i) * 3;
        P[k] = wx - o.x;
        P[k + 1] = g + h - o.y;
        P[k + 2] = wz - o.z;
        // Freshly turned soil: dark and moist in the folds and at the edges, drier and paler
        // where the crest breaks open.
        const shade = (0.5 + 0.24 * Math.min(1, prof * cross) + churn * 1.3) * (0.72 + 0.28 * cross);
        C[k] = shade;
        C[k + 1] = shade * 0.86;
        C[k + 2] = shade * 0.72;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  private updateBoulders(dt: number): void {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
    const H = this.height;
    // They roll over the front face as fast as the wave travels.
    this.roll += (this.speed / 0.25) * dt;
    for (const b of this.boulders) {
      const z = WAVE_CREST + 0.55 + 0.1 * Math.sin(this.t * 3 + b.phase);
      const x = b.x + 0.12 * Math.sin(this.t * 2.3 + b.phase);
      const wx = this.origin.x + sx * x + fx * z;
      const wz = this.origin.z + sz * x + fz * z;
      const g = this.ctx.world.groundAt(wx, wz, this.origin.y + 2.5).y;
      const s = b.s * Math.min(1, H / 0.35);
      b.mesh.visible = s > 0.02;
      b.mesh.position.set(wx, g + H * 0.55 + s * 0.45 + 0.06 * Math.abs(Math.sin(this.t * 7 + b.phase)), wz);
      b.mesh.rotation.set(this.roll + b.phase, this.yaw, 0, 'YXZ');
      b.mesh.scale.setScalar(s);
    }
  }

  /** Clods and dust thrown off the flanks, faster and further the quicker it rides. */
  private spray(dt: number): void {
    this.sprayT -= dt * (2 + this.speed * 0.9);
    if (this.sprayT > 0) return;
    this.sprayT = 1;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * WAVE_HALF_W * 0.7;
    const z = WAVE_CREST - 0.3;
    const at = wP.set(this.origin.x + sx * x + fx * z, 0, this.origin.z + sz * x + fz * z);
    at.y = this.ctx.world.groundAt(at.x, at.z, this.origin.y + 2.5).y + this.height * 0.45;
    wD.set(sx * side - fx * 0.5, 0.9, sz * side - fz * 0.5);
    debris(at, this.ctx.vfx.quality === 'low' ? 2 : 3, { dir: wD, spread: 0.4, speed: 2.5 + this.speed * 0.2, size: 0.07 + Math.random() * 0.07, color: this.tint, life: 1 });
    if (Math.random() < 0.6) this.ctx.vfx.burst('dust', at, { count: 1, dir: wD, speed: 0.8, radius: 0.2 });
  }

  /** Two ridges of pushed-aside earth flank the furrow and settle back into the ground. */
  private updateWake(dt: number): void {
    if (!this.collapsing && this.origin.distanceToSquared(this.lastRidge) > 0.64) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
      // Just behind the wave and beside its path: the earth it shoved aside.
      const back = WAVE_BACK + 0.4;
      for (const side of [-1, 1]) {
        const x = side * (1.15 + Math.random() * 0.3);
        const wx = this.origin.x + sx * x + fx * back;
        const wz = this.origin.z + sz * x + fz * back;
        if (this.ridges.length >= WAKE_MAX) this.ridges.shift();
        this.ridges.push({ x: wx, y: this.ctx.world.groundAt(wx, wz, this.origin.y + 2.5).y, z: wz, yaw: this.yaw + (Math.random() - 0.5) * 0.4, sx: 0.38 + Math.random() * 0.14, sz: 0.7 + Math.random() * 0.25, age: 0, life: 2 + Math.random() * 0.6 });
      }
      const mid = wP.set(this.origin.x + fx * back, this.origin.y, this.origin.z + fz * back);
      if (Math.random() < 0.35) this.ctx.world.fx.crack(mid, 0.7, this.yaw);
      this.ctx.world.fx.disturb(mid, 1.6, 0.5);
      this.ctx.vfx.burst('dust', mid, { count: 1, radius: 0.8, speed: 0.6 });
      this.lastRidge.copy(this.origin);
    }
    for (let k = this.ridges.length - 1; k >= 0; k--) {
      this.ridges[k].age += dt;
      if (this.ridges[k].age >= this.ridges[k].life) this.ridges.splice(k, 1);
    }
    let n = 0;
    for (const r of this.ridges) {
      const a = r.age / r.life;
      // Shoved up as the wave passes, then settling slowly back into the ground.
      const rise = a < 0.08 ? a / 0.08 : 1 - Math.pow((a - 0.08) / 0.92, 1.6);
      wP.set(r.x, r.y - 0.12 + 0.14 * rise, r.z);
      wQ.setFromEuler(wE.set(0, r.yaw, 0));
      wS.set(r.sx, 0.3 * (0.25 + 0.75 * rise), r.sz);
      wM.compose(wP, wQ, wS);
      this.wake.setMatrixAt(n++, wM);
    }
    this.wake.count = n;
    this.wake.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    for (const b of this.boulders) b.mesh.removeFromParent();
    this.wake.removeFromParent();
    this.wake.dispose();
  }
}
