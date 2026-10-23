import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { Collider } from '../../world/Collision';
import { addEffect, debris, type LiveEffect } from './loop';
import { pillarGeometry, rockGeometry, spikeGeometry, stoneMaterial, wallGeometry } from './rocks';

/**
 * Earthbending constructs: real stone that erupts from the ground, backed by
 * DYNAMIC colliders (ctx.world.collision.add(def, true)) so they block movement
 * and projectiles, can be stood on (pillars/walls are walkable), and are always
 * removed again (sink back into the ground or crumble into debris).
 *
 * Rising constructs lift entities standing on their footprint instead of
 * swallowing them (never trap anyone inside geometry). Moving constructs
 * (punched walls, boulders) report their sweep through callbacks so the
 * technique can apply hits via its Cast (dedup, events, XP).
 */

export type ConstructKind = 'pillar' | 'wall' | 'spike' | 'boulder';

const liveSet = new Set<EarthConstruct>();

export function liveConstructs(): ReadonlySet<EarthConstruct> {
  return liveSet;
}

export function constructCount(): number {
  return liveSet.size;
}

export interface ConstructTiming {
  rise: number;
  stand: number;
  sink: number;
}

const easeOutBack = (t: number) => {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const tmpV = new THREE.Vector3();

/** True if a solid collider (not in `ignore`) overlaps a sphere. Low obstacles (< stepUp above the bottom) are ignored. */
export function solidAt(ctx: GameContext, center: THREE.Vector3, radius: number, ignore: readonly number[] = [], stepUp = 0.6): Collider | null {
  const col = ctx.world.collision;
  let hit: Collider | null = null;
  col.query(center.x, center.z, radius, (c) => {
    if (hit || !c.solid || ignore.includes(c.id)) return;
    const top = c.shape === 'sphere' ? c.y + c.r : c.y + c.hy;
    const bottom = c.shape === 'sphere' ? c.y - c.r : c.y - c.hy;
    if (center.y + radius < bottom || center.y - radius + stepUp > top) return;
    if (c.shape === 'box') {
      if (col.topAt(c, center.x, center.z, radius) === -Infinity) return;
    } else if (Math.hypot(center.x - c.x, center.z - c.z) > c.r + radius) return;
    hit = c;
  });
  return hit;
}

export abstract class EarthConstruct implements LiveEffect {
  readonly group = new THREE.Group();
  readonly colliders: number[] = [];
  age = 0;
  phase: 'rise' | 'stand' | 'sink' | 'move' | 'gone' = 'rise';
  /** 0 = buried, 1 = fully raised. */
  level = 0;
  /** Entity id of the bender who raised it. */
  readonly ownerId: number;
  readonly tint: string;
  protected readonly timing: ConstructTiming;

  constructor(readonly ctx: GameContext, readonly kind: ConstructKind, ownerId: number, timing: ConstructTiming, tint: string) {
    this.ownerId = ownerId;
    this.timing = timing;
    this.tint = tint;
    this.group.name = `construct_${kind}`;
    ctx.vfx.group.add(this.group);
    liveSet.add(this);
    addEffect(this);
  }

  get alive(): boolean {
    return this.phase !== 'gone';
  }

  /** Apply the current raised level to mesh + collider. */
  protected abstract apply(prevLevel: number, dt: number): void;

  /** Override for moving constructs. */
  protected move(_dt: number): void {}

  update(dt: number): boolean {
    if (this.phase === 'gone') return false;
    this.age += dt;
    const prev = this.level;
    const t = this.timing;
    if (this.phase === 'rise') {
      const k = Math.min(1, this.age / Math.max(0.001, t.rise));
      this.level = Math.min(1.12, easeOutBack(k));
      if (k >= 1) {
        this.level = 1;
        this.phase = 'stand';
        this.age = 0;
      }
    } else if (this.phase === 'stand') {
      if (this.age >= t.stand) this.retract();
    } else if (this.phase === 'sink') {
      const k = Math.min(1, this.age / Math.max(0.001, t.sink));
      this.level = 1 - k * k;
      if (k >= 1) {
        this.phase = 'gone';
        return false;
      }
    } else if (this.phase === 'move') {
      this.move(dt);
      return this.alive;
    }
    this.apply(prev, dt);
    return true;
  }

  /** Begin sinking back into the ground. */
  retract(): void {
    if (this.phase === 'rise' || this.phase === 'stand') {
      this.phase = 'sink';
      this.age = 0;
      this.onSink();
    }
  }

  protected onSink(): void {
    const p = this.group.position;
    this.ctx.vfx.burst('dust', tmpV.set(p.x, this.baseY + 0.2, p.z), { count: 8, radius: 0.8, speed: 0.6 });
    this.ctx.audio.play('bend_earth_sink', { position: p, volume: 0.5 });
  }

  /** Ground height under the construct. */
  abstract readonly baseY: number;

  /** Break apart into debris immediately. */
  shatter(chunks = 14): void {
    if (this.phase === 'gone') return;
    const p = this.group.position;
    const c = tmpV.set(p.x, this.baseY + this.visualHeight * 0.5 * Math.max(0.3, this.level), p.z);
    debris(c, chunks, { spread: 1.4, speed: 7, size: 0.22, radius: this.visualHeight * 0.3, color: this.tint, life: 2 });
    this.ctx.vfx.burst('dust', c, { count: 14, radius: 1.2, speed: 1.2 });
    this.ctx.vfx.burst('debris', c, { count: 10, color: this.tint });
    this.ctx.audio.play('bend_earth_crumble', { position: c, volume: 0.8 });
    this.phase = 'gone';
  }

  protected abstract readonly visualHeight: number;

  /** Lift entities standing on the footprint as the top rises (prevents trapping). */
  protected carry(prevTop: number, top: number, cx: number, cz: number, reach: number, inside: (x: number, z: number, pad: number) => boolean): void {
    if (top <= prevTop + 1e-4) return;
    const list = this.ctx.entities.queryRadius(tmpV.set(cx, top, cz), reach + 1.5);
    for (const e of list) {
      if (!inside(e.position.x, e.position.z, e.radius * 0.6)) continue;
      const y = e.position.y;
      if (y >= top - 0.001) continue;
      if (y < prevTop - 0.9) continue;
      e.position.y = top;
      const b = e.body;
      if (b) {
        if (b.velocity.y < 0) b.velocity.y = 0;
        if (b.velocity.y <= 0.01) {
          b.grounded = true;
          b.groundY = top;
        }
      }
    }
  }

  dispose(): void {
    const col = this.ctx.world.collision;
    for (const id of this.colliders) col.remove(id);
    this.colliders.length = 0;
    this.group.removeFromParent();
    this.phase = 'gone';
    liveSet.delete(this);
  }
}

// ---------------------------------------------------------------------------
// Pillar
// ---------------------------------------------------------------------------

export interface PillarOptions {
  x: number;
  z: number;
  ground: number;
  radius?: number;
  height?: number;
  ownerId: number;
  timing?: Partial<ConstructTiming>;
  tint?: string;
  variant?: number;
}

export class RockPillar extends EarthConstruct {
  readonly radius: number;
  readonly height: number;
  readonly baseY: number;
  protected readonly visualHeight: number;
  top: number;
  private readonly mesh: THREE.Mesh;

  constructor(ctx: GameContext, o: PillarOptions) {
    const tint = o.tint ?? '#8a7860';
    super(ctx, 'pillar', o.ownerId, { rise: 0.22, stand: 5, sink: 0.7, ...o.timing }, tint);
    this.radius = o.radius ?? 0.9;
    this.height = o.height ?? 3.2;
    this.baseY = o.ground;
    this.visualHeight = this.height;
    this.top = o.ground;
    const radial = ctx.vfx.quality === 'low' ? 6 : 8;
    this.mesh = new THREE.Mesh(pillarGeometry(this.radius, this.height, o.variant ?? 0, radial), stoneMaterial(tint));
    this.mesh.castShadow = ctx.vfx.quality !== 'low';
    this.mesh.receiveShadow = true;
    this.mesh.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(this.mesh);
    this.group.position.set(o.x, 0, o.z);
    this.mesh.position.y = o.ground - this.height;
    this.colliders.push(
      ctx.world.collision.add({ shape: 'cylinder', x: o.x, y: o.ground - this.height / 2, z: o.z, r: this.radius, hy: this.height / 2, walkable: true, solid: true, surface: 'rock', tag: 'bending', owner: o.ownerId }, true),
    );
    // Eruption: dust ring, flying chunks.
    const base = new THREE.Vector3(o.x, o.ground + 0.2, o.z);
    ctx.vfx.burst('dust', base, { count: 16, radius: this.radius * 1.2, speed: 1.4 });
    debris(base, ctx.vfx.quality === 'low' ? 6 : 12, { spread: 0.9, speed: 8, size: 0.16, radius: this.radius, color: tint });
    ctx.world.fx.crack(base, this.radius * 2.2);
    ctx.audio.play('bend_earth_rise', { position: base, volume: 0.9 });
  }

  protected apply(prevLevel: number, _dt: number): void {
    const raised = this.height * this.level;
    const prevTop = this.baseY + this.height * prevLevel;
    this.mesh.position.y = this.baseY - this.height + raised;
    this.top = this.baseY + raised;
    const p = this.group.position;
    this.ctx.world.collision.update(this.colliders[0], { y: this.top - this.height / 2 });
    const r = this.radius;
    this.carry(prevTop, this.top, p.x, p.z, r, (x, z, pad) => Math.hypot(x - p.x, z - p.z) < r + pad);
  }
}

// ---------------------------------------------------------------------------
// Wall (can be punched forward)
// ---------------------------------------------------------------------------

export interface WallOptions {
  x: number;
  z: number;
  ground: number;
  yaw: number;
  width?: number;
  height?: number;
  thick?: number;
  ownerId: number;
  timing?: Partial<ConstructTiming>;
  tint?: string;
}

export class StoneWall extends EarthConstruct {
  readonly width: number;
  readonly height: number;
  readonly thick: number;
  baseY: number;
  protected readonly visualHeight: number;
  readonly yaw: number;
  top: number;
  private readonly mesh: THREE.Mesh;
  private flight: { dir: THREE.Vector3; speed: number; left: number; onMove: (center: THREE.Vector3, wall: StoneWall) => boolean } | null = null;

  constructor(ctx: GameContext, o: WallOptions) {
    const tint = o.tint ?? '#8a7860';
    super(ctx, 'wall', o.ownerId, { rise: 0.32, stand: 9, sink: 0.9, ...o.timing }, tint);
    this.width = o.width ?? 5;
    this.height = o.height ?? 3;
    this.thick = o.thick ?? 0.9;
    this.baseY = o.ground;
    this.visualHeight = this.height;
    this.yaw = o.yaw;
    this.top = o.ground;
    this.mesh = new THREE.Mesh(wallGeometry(this.width, this.height, this.thick, Math.floor(Math.random() * 3)), stoneMaterial(tint));
    this.mesh.castShadow = ctx.vfx.quality !== 'low';
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.position.set(o.x, 0, o.z);
    this.group.rotation.y = o.yaw;
    this.mesh.position.y = o.ground - this.height;
    this.colliders.push(
      ctx.world.collision.add(
        { shape: 'box', x: o.x, y: o.ground - this.height / 2, z: o.z, hx: this.width / 2, hz: this.thick / 2, hy: this.height / 2, yaw: o.yaw, walkable: true, solid: true, surface: 'rock', tag: 'bending', owner: o.ownerId },
        true,
      ),
    );
    const base = new THREE.Vector3(o.x, o.ground + 0.2, o.z);
    const along = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw));
    for (let i = -2; i <= 2; i++) {
      const p = base.clone().addScaledVector(along, (i / 2) * this.width * 0.45);
      ctx.vfx.burst('dust', p, { count: 6, radius: 0.6, speed: 1.3 });
      debris(p, ctx.vfx.quality === 'low' ? 2 : 4, { spread: 0.9, speed: 7, size: 0.15, radius: 0.4, color: tint });
    }
    ctx.world.fx.crack(base, this.width * 0.6, o.yaw);
    ctx.audio.play('bend_earth_rise', { position: base, volume: 1, pitch: 0.8 });
  }

  /** World-space direction along the wall's length. */
  get alongDir(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  get center(): THREE.Vector3 {
    const p = this.group.position;
    return new THREE.Vector3(p.x, this.baseY + this.height * 0.5 * this.level, p.z);
  }

  get launched(): boolean {
    return !!this.flight;
  }

  protected apply(prevLevel: number, _dt: number): void {
    const raised = this.height * this.level;
    const prevTop = this.baseY + this.height * prevLevel;
    this.mesh.position.y = this.baseY - this.height + raised;
    this.top = this.baseY + raised;
    const p = this.group.position;
    this.ctx.world.collision.update(this.colliders[0], { y: this.top - this.height / 2 });
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const hx = this.width / 2, hz = this.thick / 2;
    this.carry(prevTop, this.top, p.x, p.z, Math.hypot(hx, hz), (x, z, pad) => {
      const dx = x - p.x, dz = z - p.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < hx + pad && Math.abs(lz) < hz + pad;
    });
  }

  /**
   * Punch the wall forward: it rips free and slides along the ground. onMove is
   * called each frame with the wall's centre; return false to stop (it crumbles).
   */
  launch(dir: THREE.Vector3, speed: number, maxTime: number, onMove: (center: THREE.Vector3, wall: StoneWall) => boolean): void {
    if (this.phase === 'gone' || this.flight) return;
    this.level = 1;
    this.apply(1, 0);
    this.flight = { dir: dir.clone().setY(0).normalize(), speed, left: maxTime, onMove };
    this.phase = 'move';
    this.age = 0;
    // The slab is now a moving obstacle: no longer walkable.
    const col = this.ctx.world.collision.get(this.colliders[0]);
    if (col) col.walkable = false;
    const p = this.group.position;
    debris(new THREE.Vector3(p.x, this.baseY + 0.3, p.z), 10, { spread: 1.2, speed: 6, size: 0.18, radius: this.width * 0.4, color: this.tint });
    this.ctx.vfx.burst('dust', new THREE.Vector3(p.x, this.baseY + 0.3, p.z), { count: 18, radius: this.width * 0.4, speed: 2 });
  }

  protected override move(dt: number): void {
    const f = this.flight!;
    f.left -= dt;
    const p = this.group.position;
    const step = f.speed * dt;
    p.addScaledVector(f.dir, step);
    // Follow the terrain.
    const g = this.ctx.world.groundAt(p.x, p.z, this.baseY + 1.2).y;
    const rise = g - this.baseY;
    this.baseY = rise > 1.4 ? this.baseY : g;
    this.mesh.position.y = this.baseY;
    this.top = this.baseY + this.height;
    this.ctx.world.collision.update(this.colliders[0], { x: p.x, z: p.z, y: this.baseY + this.height / 2 });
    // Dust along the ground under the slab.
    if (Math.random() < dt * 30) this.ctx.vfx.burst('dust', tmpV.set(p.x, this.baseY + 0.2, p.z), { count: 2, radius: this.width * 0.4, speed: 0.8 });
    const front = tmpV.copy(p).addScaledVector(f.dir, this.thick * 0.5 + 0.4).setY(this.baseY + this.height * 0.5);
    const blocked = rise > 1.4 || solidAt(this.ctx, front, Math.min(1.2, this.width * 0.25), this.colliders) !== null || this.ctx.world.liquidAt(p.x, p.z) !== null;
    const keep = f.onMove(this.center, this);
    if (blocked || !keep || f.left <= 0) this.shatter(22);
  }
}

// ---------------------------------------------------------------------------
// Spike
// ---------------------------------------------------------------------------

export interface SpikeOptions {
  x: number;
  z: number;
  ground: number;
  radius?: number;
  height?: number;
  ownerId: number;
  timing?: Partial<ConstructTiming>;
  tint?: string;
  /** Add a collider (small spikes can skip it). */
  collider?: boolean;
  tilt?: THREE.Vector2;
}

export class StoneSpike extends EarthConstruct {
  readonly radius: number;
  readonly height: number;
  readonly baseY: number;
  protected readonly visualHeight: number;
  private readonly mesh: THREE.Mesh;

  constructor(ctx: GameContext, o: SpikeOptions) {
    const tint = o.tint ?? '#8a7860';
    super(ctx, 'spike', o.ownerId, { rise: 0.09, stand: 1.0, sink: 0.45, ...o.timing }, tint);
    this.radius = o.radius ?? 0.45;
    this.height = o.height ?? 1.8;
    this.baseY = o.ground;
    this.visualHeight = this.height;
    this.mesh = new THREE.Mesh(spikeGeometry(Math.floor(Math.random() * 4)), stoneMaterial(tint));
    this.mesh.scale.set(this.radius, this.height, this.radius);
    this.mesh.rotation.y = Math.random() * Math.PI * 2;
    if (o.tilt) {
      this.mesh.rotation.x = o.tilt.x;
      this.mesh.rotation.z = o.tilt.y;
    }
    this.mesh.castShadow = ctx.vfx.quality === 'high';
    this.group.add(this.mesh);
    this.group.position.set(o.x, 0, o.z);
    this.mesh.position.y = o.ground - this.height;
    if (o.collider !== false) {
      this.colliders.push(
        ctx.world.collision.add({ shape: 'cylinder', x: o.x, y: o.ground - this.height / 2, z: o.z, r: this.radius * 0.6, hy: this.height / 2, walkable: false, solid: true, surface: 'rock', tag: 'bending', owner: o.ownerId }, true),
      );
    }
  }

  protected apply(_prev: number, _dt: number): void {
    const raised = this.height * this.level;
    this.mesh.position.y = this.baseY - this.height + raised;
    if (this.colliders.length) this.ctx.world.collision.update(this.colliders[0], { y: this.baseY + raised - this.height / 2 });
  }

  protected override onSink(): void {
    // Spikes sink quietly (a line of them would be noisy).
  }
}

// ---------------------------------------------------------------------------
// Boulder
// ---------------------------------------------------------------------------

export interface BoulderOptions {
  x: number;
  z: number;
  ground: number;
  radius?: number;
  ownerId: number;
  tint?: string;
  /** Seconds to rip out of the ground before it can roll. */
  rise?: number;
}

export class Boulder extends EarthConstruct {
  readonly radius: number;
  baseY: number;
  protected readonly visualHeight: number;
  private readonly mesh: THREE.Mesh;
  readonly velocity = new THREE.Vector3();
  private roll: { dir: THREE.Vector3; speed: number; maxSpeed: number; accel: number; left: number; travelled: number; onMove: (center: THREE.Vector3, b: Boulder) => boolean } | null = null;
  private readonly axis = new THREE.Vector3();
  private waterTime = 0;

  constructor(ctx: GameContext, o: BoulderOptions) {
    const tint = o.tint ?? '#8a7860';
    super(ctx, 'boulder', o.ownerId, { rise: o.rise ?? 0.4, stand: 6, sink: 0.6 }, tint);
    this.radius = o.radius ?? 1.3;
    this.baseY = o.ground;
    this.visualHeight = this.radius * 2;
    const detail = ctx.vfx.quality === 'high' ? 2 : 1;
    this.mesh = new THREE.Mesh(rockGeometry(Math.floor(Math.random() * 8), detail), stoneMaterial(tint));
    this.mesh.scale.setScalar(this.radius);
    this.mesh.castShadow = ctx.vfx.quality !== 'low';
    this.group.add(this.mesh);
    this.group.position.set(o.x, o.ground - this.radius, o.z);
    this.colliders.push(ctx.world.collision.add({ shape: 'sphere', x: o.x, y: o.ground - this.radius, z: o.z, r: this.radius * 0.92, walkable: false, solid: true, surface: 'rock', tag: 'bending', owner: o.ownerId }, true));
    const base = new THREE.Vector3(o.x, o.ground + 0.2, o.z);
    ctx.vfx.burst('dust', base, { count: 18, radius: this.radius, speed: 1.6 });
    debris(base, ctx.vfx.quality === 'low' ? 6 : 12, { spread: 1.0, speed: 8, size: 0.2, radius: this.radius, color: tint });
    ctx.world.fx.crack(base, this.radius * 2.4);
    ctx.audio.play('bend_earth_rise', { position: base, volume: 1, pitch: 0.65 });
  }

  get center(): THREE.Vector3 {
    return this.group.position;
  }

  protected apply(_prev: number, _dt: number): void {
    const p = this.group.position;
    p.y = this.baseY - this.radius + this.radius * 2 * this.level;
    this.ctx.world.collision.update(this.colliders[0], { x: p.x, y: p.y, z: p.z });
    this.mesh.rotation.y += 0.02;
  }

  /** Start rolling along dir. onMove(center) runs every frame; return false to stop. */
  startRolling(dir: THREE.Vector3, o: { speed: number; maxSpeed: number; accel: number; maxTime: number }, onMove: (center: THREE.Vector3, b: Boulder) => boolean): void {
    if (this.phase === 'gone') return;
    this.level = 1;
    this.apply(1, 0);
    this.roll = { dir: dir.clone().setY(0).normalize(), speed: o.speed, maxSpeed: o.maxSpeed, accel: o.accel, left: o.maxTime, travelled: 0, onMove };
    this.axis.set(this.roll.dir.z, 0, -this.roll.dir.x);
    this.phase = 'move';
  }

  get rolling(): boolean {
    return !!this.roll;
  }

  protected override move(dt: number): void {
    const r = this.roll!;
    r.left -= dt;
    r.speed = Math.min(r.maxSpeed, r.speed + r.accel * dt);
    const p = this.group.position;
    const step = r.speed * dt;
    const nx = p.x + r.dir.x * step, nz = p.z + r.dir.z * step;
    const g = this.ctx.world.groundAt(nx, nz, p.y + 1).y;
    const prevGround = p.y - this.radius;
    // Too steep to climb → stop.
    const climb = g - prevGround;
    if (climb > 1.0) {
      this.shatter(26);
      return;
    }
    p.set(nx, Math.max(g, prevGround - 2.5 * dt * 10) + this.radius, nz);
    if (p.y - this.radius < g) p.y = g + this.radius;
    r.travelled += step;
    this.velocity.copy(r.dir).multiplyScalar(r.speed);
    this.mesh.rotateOnWorldAxis(this.axis, step / this.radius);
    this.ctx.world.collision.update(this.colliders[0], { x: p.x, y: p.y, z: p.z });
    // Ground churn.
    if (Math.random() < dt * 24) {
      const back = tmpV.copy(p).addScaledVector(r.dir, -this.radius * 0.6).setY(g + 0.15);
      this.ctx.vfx.burst('dust', back, { count: 2, radius: this.radius * 0.5, speed: 1 });
      if (Math.random() < 0.4) debris(back, 1, { spread: 0.6, speed: 3, size: 0.1, color: this.tint, life: 1 });
    }
    if (this.ctx.world.liquidAt(p.x, p.z)) {
      this.waterTime += dt;
      if (Math.random() < dt * 20) this.ctx.vfx.burst('splash', tmpV.copy(p).setY(p.y - this.radius * 0.5), { count: 4 });
      if (this.waterTime > 0.6) {
        this.shatter(10);
        return;
      }
    }
    const front = tmpV.copy(p).addScaledVector(r.dir, this.radius * 0.6);
    const blocked = solidAt(this.ctx, front, this.radius * 0.7, this.colliders, this.radius * 0.8) !== null;
    const keep = r.onMove(p, this);
    if (blocked || !keep || r.left <= 0) this.shatter(30);
  }
}
