import * as THREE from 'three';
import type { Entity } from '../../../entities/Entity';
import { registerTechnique } from '../../CombatSystem';
import { clamp01, easeOut } from '../../water/Curve';
import type { Meltable, WaterEffect, WaterFX } from '../../water/WaterFX';
import { sharedIceMaterial } from '../../water/WaterMaterials';
import type { Cast } from '../../types';
import { basis, fxOf, GatherStream, handPos, refundWater, shake, spill, UP } from './shared';
import { WhipEffect } from './whip';

/**
 * Ice techniques. They may carve ice directly from frozen sources (frozen
 * lakes and rivers, sea ice, glacier ice, ice walls) and prefer them when
 * available; otherwise they freeze water from a liquid source or the reserve.
 * Every construct is real: shards are projectiles, the wall is a walkable
 * dynamic collider registered as an ice source, spikes are solid colliders
 * that hit as they erupt. Fire heat ('bending:heat') melts them.
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
let crystalGeo: THREE.OctahedronGeometry | null = null;
let blockGeo: THREE.BoxGeometry | null = null;
let spikeGeo: THREE.ConeGeometry | null = null;

function crystal(): THREE.OctahedronGeometry {
  crystalGeo ??= new THREE.OctahedronGeometry(1, 0);
  return crystalGeo;
}

function iceLookFor(cast: Cast): number {
  return cast.water.frozen ? 1 : 0.6;
}

// ---------------------------------------------------------------------------
// Ice Shards
// ---------------------------------------------------------------------------

class ShardForm implements WaterEffect {
  readonly kind = 'shard_form';
  castId: number;
  readonly meshes: THREE.Mesh[] = [];
  readonly anchors: THREE.Vector3[] = [];
  private t = 0;
  private done = false;
  private readonly fx: WaterFX;

  constructor(readonly cast: Cast, readonly n: number) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(crystal(), sharedIceMaterial());
      m.frustumCulled = false;
      m.renderOrder = 11;
      this.fx.group.add(m);
      this.meshes.push(m);
      this.anchors.push(new THREE.Vector3());
    }
  }

  /** World anchor of shard i above the hands, fanned out. */
  private place(i: number, out: THREE.Vector3): THREE.Vector3 {
    const c = this.cast.caster;
    const { f, r } = basis(this.cast.aimDir, tA, tB);
    handPos(c, 'hands', out);
    const k = this.n > 1 ? i / (this.n - 1) - 0.5 : 0;
    out.addScaledVector(r, k * 1.5).addScaledVector(UP, 0.45 + 0.25 * (1 - 4 * k * k)).addScaledVector(f, 0.25);
    return out;
  }

  finish(): void {
    this.done = true;
  }

  update(dt: number): boolean {
    if (this.done) return false;
    this.t += dt;
    const g = easeOut(this.t / Math.max(0.05, this.cast.def.windup));
    for (let i = 0; i < this.n; i++) {
      const m = this.meshes[i];
      this.place(i, this.anchors[i]);
      m.position.copy(this.anchors[i]);
      m.lookAt(tC.copy(this.anchors[i]).addScaledVector(this.cast.aimDir, 3));
      const s = g * (0.9 + 0.1 * Math.sin(this.t * 20 + i));
      m.scale.set(0.12 * s, 0.12 * s, 0.48 * s);
    }
    return this.t < 3;
  }

  dispose(): void {
    for (const m of this.meshes) this.fx.group.remove(m);
  }
}

function stuckShard(cast: Cast, at: THREE.Vector3, dir: THREE.Vector3): void {
  const m = new THREE.Mesh(crystal(), sharedIceMaterial());
  m.position.copy(at);
  m.lookAt(tA.copy(at).add(dir));
  m.scale.set(0.12, 0.12, 0.48);
  cast.ctx.vfx.addTransient(
    m,
    3,
    (t) => {
      const s = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
      m.scale.set(0.12 * s, 0.12 * s, 0.48 * s);
    },
    () => {},
  );
}

registerTechnique({
  id: 'ice_shards',
  name: 'Ice Shards',
  element: 'water',
  kind: 'ability',
  tier: 2,
  description: 'Freeze water into a fan of razor-sharp shards and fling them. Carves straight from ice when there is any nearby; slows whatever it strikes.',
  usage: 'Ability. Fires a fan of ice projectiles toward your aim. Uses ice, water or your reserve.',
  icon: 'water',
  chiCost: 14,
  cooldown: 4,
  water: { amount: 8, allowIce: true, preferFrozen: true },
  windup: 0.3,
  recovery: 0.35,
  movement: 'slow',
  airborne: true,
  interruptible: true,
  range: 20,
  begin(cast) {
    cast.caster.humanoid?.animator.play('water_ice_shards', { fadeIn: 0.05 });
    const fx = fxOf(cast);
    const n = fx.quality === 'low' ? 5 : 7;
    const form = fx.add(new ShardForm(cast, n));
    cast.data.form = form;
    cast.data.gather = fx.add(
      new GatherStream(cast, {
        hand: 'hands',
        duration: cast.def.windup * 0.8,
        radius: 0.14,
        look: { ice: iceLookFor(cast) },
        target: (out) => handPos(cast.caster, 'hands', out).addScaledVector(UP, 0.55),
      }),
    );
    if (cast.water.from && cast.water.frozen) cast.ctx.vfx.burst('ice', cast.water.from, { count: 12, speed: 1.2 });
    cast.ctx.audio.play('ice_form', { position: handPos(cast.caster, 'hands', tA), volume: 0.7 });
  },
  release(cast) {
    cast.data.released = true;
    const ctx = cast.ctx;
    const form = cast.data.form as ShardForm;
    (cast.data.gather as GatherStream | undefined)?.absorb();
    const n = form.n;
    const spread = 0.72;
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) - 0.5 : 0;
      const start = form.anchors[i].clone();
      // Each shard flies from its own anchor through the aim line, fanned out.
      const dir = cast.aimPoint.clone().sub(start).normalize().applyAxisAngle(UP, -k * spread);
      dir.normalize();
      const mesh = new THREE.Mesh(crystal(), sharedIceMaterial());
      mesh.scale.set(0.12, 0.12, 0.5);
      mesh.frustumCulled = false;
      cast.projectile({
        position: start,
        velocity: dir.clone().multiplyScalar(36),
        radius: 0.24,
        gravity: 1.2,
        life: 0.85,
        damage: 7,
        knockback: 2.5,
        stagger: 11,
        status: [{ type: 'slow', duration: 2.5 }],
        visual: {
          object: mesh,
          update: (p) => {
            mesh.lookAt(tA.copy(p.position).add(p.velocity));
            if (Math.random() < 0.25) ctx.vfx.burst('ice', p.position, { count: 1, speed: 0.2, size: 0.6 });
          },
          dispose: () => {},
        },
        onHitEntity: (p, e) => {
          ctx.vfx.burst('ice', p.position, { count: 10, speed: 1 });
          ctx.audio.play('ice_shatter', { position: p.position, volume: 0.45, pitch: 1.2 });
          fxOf(cast).extinguish(e);
        },
        onHitWorld: (p, pt) => {
          ctx.vfx.burst('ice', pt, { count: 8, speed: 0.8 });
          ctx.world.fx.frost(pt, 0.9);
          stuckShard(cast, pt, p.velocity.clone().normalize());
        },
      });
    }
    form.finish();
    ctx.audio.play('whoosh', { position: form.anchors[0], volume: 0.6, pitch: 1.6 });
    // The ice came from somewhere: what is not thrown melts off as a little runoff.
    void spill;
  },
  end(cast, interrupted) {
    (cast.data.form as ShardForm | undefined)?.finish();
    if (interrupted && !cast.data.released) {
      (cast.data.gather as GatherStream | undefined)?.drop();
      refundWater(cast);
    }
  },
  aiScore(_c, _t, dist) {
    return dist > 4 && dist < 18 ? 0.55 : 0.05;
  },
});

// ---------------------------------------------------------------------------
// Ice Wall
// ---------------------------------------------------------------------------

export const ICE_WALL = { width: 5.4, height: 3.2, thickness: 0.95, life: 22 };

class IceWallEffect implements WaterEffect, Meltable {
  readonly kind = 'ice_wall';
  castId: number;
  readonly position = new THREE.Vector3();
  readonly radius = ICE_WALL.width * 0.5;
  private readonly group = new THREE.Group();
  private readonly blocks: Array<{ m: THREE.Mesh; h: number; y: number }> = [];
  private readonly fx: WaterFX;
  private colliderId = 0;
  sourceId: string | null = null;
  private t = 0;
  private life = ICE_WALL.life;
  private meltT = -1;
  private crumbleT = -1;
  private heightShown = 0;
  private lastColliderH = -1;
  private readonly yaw: number;
  private removeMeltable: (() => void) | null = null;
  private readonly fwd = new THREE.Vector3();

  constructor(readonly cast: Cast, center: THREE.Vector3, yaw: number) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    this.position.copy(center);
    this.yaw = yaw;
    this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    blockGeo ??= new THREE.BoxGeometry(1, 1, 1);
    const W = ICE_WALL.width, H = ICE_WALL.height, T = ICE_WALL.thickness;
    // Main slab built from a few jagged blocks plus crystals along the top.
    const nb = 5;
    for (let i = 0; i < nb; i++) {
      const w = W / nb + 0.15;
      const h = H * (0.82 + 0.3 * Math.random());
      const m = new THREE.Mesh(blockGeo, sharedIceMaterial(i % 2 === 1));
      m.scale.set(w, h, T * (0.85 + 0.3 * Math.random()));
      m.position.set(-W / 2 + (i + 0.5) * (W / nb), h / 2, (Math.random() - 0.5) * 0.15);
      m.rotation.set((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.1);
      m.castShadow = true;
      m.renderOrder = 10;
      this.group.add(m);
      this.blocks.push({ m, h, y: h / 2 });
    }
    const nc = fxOf(cast).quality === 'low' ? 4 : 8;
    for (let i = 0; i < nc; i++) {
      const m = new THREE.Mesh(crystal(), sharedIceMaterial());
      const h = 0.6 + Math.random() * 0.7;
      m.scale.set(0.25 + Math.random() * 0.2, h, 0.22 + Math.random() * 0.15);
      m.position.set(-W / 2 + Math.random() * W, H * 0.92 + h * 0.3, (Math.random() - 0.5) * 0.4);
      m.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
      this.group.add(m);
      this.blocks.push({ m, h: m.position.y, y: m.position.y });
    }
    this.group.position.copy(center);
    this.group.rotation.y = yaw;
    this.group.scale.set(1, 0.001, 1);
    this.fx.group.add(this.group);
    // Real collider: walkable top, blocks movement and projectiles.
    this.colliderId = cast.ctx.world.collision.add(
      { shape: 'box', x: center.x, y: center.y + 0.05, z: center.z, hx: W / 2, hz: T / 2, hy: 0.05, yaw, walkable: true, solid: true, surface: 'ice', tag: 'ice_wall', owner: cast.id },
      true,
    );
    // The wall is itself an ice source (carving it shrinks it).
    this.sourceId = cast.ctx.water.registerDynamic({ type: 'ice', label: 'Ice Wall', x: center.x, y: center.y + H * 0.6, z: center.z, r: W / 2, capacity: 40, regen: 0, frozen: true, ttl: ICE_WALL.life + 8, owner: cast.id, size: 'medium' });
    this.removeMeltable = this.fx.addMeltable(this);
  }

  melt(intensity: number): void {
    this.life -= 9 * Math.max(0.3, intensity);
    this.fx.steam(tA.copy(this.position).setY(this.position.y + 1.2), 1);
  }

  private setCollider(h: number): void {
    if (Math.abs(h - this.lastColliderH) < 0.03) return;
    this.lastColliderH = h;
    const hy = Math.max(0.05, h / 2);
    this.cast.ctx.world.collision.update(this.colliderId, { y: this.position.y + hy, hy });
  }

  update(dt: number): boolean {
    this.t += dt;
    const ctx = this.cast.ctx;
    const H = ICE_WALL.height;
    const src = this.sourceId ? ctx.water.get(this.sourceId) : undefined;
    const carved = src ? clamp01(src.amount / src.capacity) : 0;
    if (this.crumbleT < 0 && this.meltT < 0) {
      if (src && src.amount < 2) this.crumble();
      this.life -= dt;
      if (this.life <= 0) this.startMelt();
    }
    let k = easeOut(this.t / 0.3) * (0.3 + 0.7 * carved);
    if (this.meltT >= 0) {
      this.meltT += dt;
      k *= Math.max(0, 1 - this.meltT / 2.5);
      if (Math.random() < dt * 14) ctx.vfx.burst('splash', tA.copy(this.position).addScaledVector(tB.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), (Math.random() - 0.5) * ICE_WALL.width).setY(this.position.y + H * k * Math.random()), { count: 1, speed: 0.3, size: 0.6 });
      if (this.meltT >= 2.5) {
        this.finish(true);
        return false;
      }
    }
    if (this.crumbleT >= 0) {
      this.crumbleT += dt;
      k *= Math.max(0, 1 - this.crumbleT / 0.35);
      if (this.crumbleT >= 0.35) {
        this.finish(false);
        return false;
      }
    }
    this.heightShown = H * k;
    this.group.scale.set(1, Math.max(0.001, k), 1);
    this.setCollider(this.heightShown * 0.98);
    return true;
  }

  private startMelt(): void {
    if (this.meltT >= 0) return;
    this.meltT = 0;
    this.cast.ctx.audio.play('water_splash', { position: this.position, volume: 0.4, pitch: 0.7 });
  }

  crumble(): void {
    if (this.crumbleT >= 0) return;
    this.crumbleT = 0;
    const at = tA.copy(this.position).setY(this.position.y + this.heightShown * 0.5);
    this.cast.ctx.vfx.burst('ice', at, { count: 30, speed: 1.4, radius: 1.5 });
    this.cast.ctx.vfx.burst('snowpuff', at, { count: 8, radius: 1 });
    this.cast.ctx.audio.play('ice_shatter', { position: at, volume: 0.9, pitch: 0.8 });
  }

  private finish(melted: boolean): void {
    const ctx = this.cast.ctx;
    if (this.sourceId) {
      const src = ctx.water.get(this.sourceId);
      const left = src ? src.amount : 0;
      ctx.water.unregister(this.sourceId);
      this.sourceId = null;
      // Meltwater pools at the base.
      if (melted && left > 2) spill(this.cast, this.position, Math.max(6, left * 0.5));
    }
  }

  trace(): Record<string, unknown> {
    return { center: this.position.toArray(), height: this.heightShown, collider: this.colliderId, source: this.sourceId };
  }

  dispose(): void {
    const ctx = this.cast.ctx;
    if (this.colliderId) ctx.world.collision.remove(this.colliderId);
    this.colliderId = 0;
    if (this.sourceId) ctx.water.unregister(this.sourceId);
    this.sourceId = null;
    this.removeMeltable?.();
    this.fx.group.remove(this.group);
  }
}

registerTechnique({
  id: 'ice_wall',
  name: 'Ice Wall',
  element: 'water',
  kind: 'defense',
  tier: 2,
  description: 'Raise a thick wall of ice that blocks attacks and can be climbed. The wall is itself a source of ice for other techniques, and slowly melts.',
  usage: 'Defensive technique. Raises a wall a few metres in front of you. Uses ice or water.',
  icon: 'water',
  chiCost: 20,
  cooldown: 9,
  water: { amount: 16, allowIce: true, preferFrozen: true },
  windup: 0.35,
  recovery: 0.45,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 6,
  begin(cast) {
    cast.caster.humanoid?.animator.play('water_ice_wall', { fadeIn: 0.05 });
    const c = cast.caster;
    const { f } = basis(cast.aimDir, tA, tB);
    const at = c.position.clone().addScaledVector(f, 3.3);
    at.y = cast.ctx.world.groundAt(at.x, at.z, c.position.y + 3).y;
    cast.data.at = at;
    cast.data.yaw = Math.atan2(f.x, f.z);
    cast.data.gather = fxOf(cast).add(
      new GatherStream(cast, {
        hand: 'hands',
        duration: cast.def.windup * 0.9,
        radius: 0.2,
        arc: 0.2,
        look: { ice: iceLookFor(cast) * 0.6 },
        target: (out) => out.copy(at).setY(at.y + 0.3),
      }),
    );
  },
  release(cast) {
    cast.data.released = true;
    const ctx = cast.ctx;
    const at = cast.data.at as THREE.Vector3;
    (cast.data.gather as GatherStream | undefined)?.absorb();
    const wall = fxOf(cast).add(new IceWallEffect(cast, at, cast.data.yaw as number));
    cast.data.wall = wall;
    // Anything standing where the wall erupts is thrown up and back.
    const f = new THREE.Vector3(Math.sin(cast.data.yaw), 0, Math.cos(cast.data.yaw));
    cast.areaHit({ center: at.clone().setY(at.y + 1), radius: 2.9, height: 1.6, damage: 6, knockback: 7, knockDir: f, launch: 7, stagger: 25 });
    ctx.vfx.burst('ice', at.clone().setY(at.y + 0.5), { count: 26, speed: 1.3, radius: 2 });
    ctx.vfx.burst('snowpuff', at, { count: 10, radius: 2.2 });
    ctx.world.fx.frost(at, 3.2);
    ctx.audio.play('ice_form', { position: at, volume: 1, pitch: 0.7 });
    ctx.audio.play('rock_rise', { position: at, volume: 0.5, pitch: 1.6 });
    shake(cast, 0.18, 0.25);
  },
  end(cast, interrupted) {
    if (interrupted && !cast.data.released) {
      (cast.data.gather as GatherStream | undefined)?.drop();
      refundWater(cast);
    }
  },
  aiScore(_c, _t, dist) {
    return dist > 6 && dist < 20 ? 0.25 : 0.05;
  },
});

// ---------------------------------------------------------------------------
// Ice Spikes
// ---------------------------------------------------------------------------

interface Spike {
  pos: THREE.Vector3;
  t0: number;
  h: number;
  mesh: THREE.Mesh | null;
  collider: number;
  erupted: boolean;
  dead: boolean;
  tiltX: number;
  tiltZ: number;
}

class IceSpikesEffect implements WaterEffect, Meltable {
  readonly kind = 'ice_spikes';
  castId: number;
  readonly position = new THREE.Vector3();
  radius = 8;
  private readonly fx: WaterFX;
  private readonly spikes: Spike[] = [];
  private t = 0;
  private life = 4.2;
  private removeMeltable: (() => void) | null = null;
  readonly hits: Array<{ id: number; spike: number; frame: number }> = [];
  private lastErupted = -1;

  constructor(readonly cast: Cast, origin: THREE.Vector3, dir: THREE.Vector3, length: number) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    spikeGeo ??= new THREE.ConeGeometry(0.42, 1, 6, 1).translate(0, 0.5, 0);
    const ctx = cast.ctx;
    const n = Math.round(length / 1.45);
    let prevY = origin.y;
    for (let i = 0; i < n; i++) {
      const d = 1.6 + i * 1.45;
      const p = origin.clone().addScaledVector(dir, d);
      const g = ctx.world.groundAt(p.x, p.z, prevY + 3);
      const w = ctx.world.waterAt(p.x, p.z);
      p.y = w && w.level > g.y ? w.level : g.y;
      if (Math.abs(p.y - prevY) > 2.6) break; // cliffs stop the line
      if (ctx.world.collision.raycast(tA.copy(origin).setY(origin.y + 0.8), dir, d)) break; // walls stop it
      prevY = p.y;
      const side = (i % 2 ? 1 : -1) * 0.18;
      p.addScaledVector(tB.set(-dir.z, 0, dir.x), side);
      this.spikes.push({ pos: p, t0: 0.05 * i, h: 1.5 + Math.random() * 0.9 + Math.min(0.8, i * 0.06), mesh: null, collider: 0, erupted: false, dead: false, tiltX: dir.x * 0.25 + (Math.random() - 0.5) * 0.15, tiltZ: dir.z * 0.25 + (Math.random() - 0.5) * 0.15 });
    }
    this.position.copy(origin).addScaledVector(dir, length * 0.5);
    this.radius = length * 0.5 + 1;
    this.removeMeltable = this.fx.addMeltable(this);
  }

  get count(): number {
    return this.spikes.length;
  }

  melt(intensity: number): void {
    this.life = Math.min(this.life, this.t + 0.4 / Math.max(0.3, intensity));
  }

  private erupt(i: number): void {
    const s = this.spikes[i];
    const ctx = this.cast.ctx;
    s.erupted = true;
    const m = new THREE.Mesh(spikeGeo!, sharedIceMaterial(i % 3 === 1));
    m.position.copy(s.pos);
    m.rotation.set(s.tiltZ, 0, -s.tiltX);
    m.scale.set(1, 0.01, 1);
    m.castShadow = true;
    m.renderOrder = 10;
    this.fx.group.add(m);
    s.mesh = m;
    s.collider = ctx.world.collision.add({ shape: 'cylinder', x: s.pos.x, y: s.pos.y + s.h * 0.45, z: s.pos.z, r: 0.34, hy: s.h * 0.45, solid: true, walkable: false, surface: 'ice', tag: 'ice_spike', owner: this.cast.id }, true);
    const hitAt = tA.copy(s.pos).setY(s.pos.y + 0.9);
    const hit = this.cast.areaHit({ center: hitAt.clone(), radius: 1.15, height: 1.3, damage: 14, launch: 7.5, knockback: 3, knockDir: 'radial', stagger: 40, status: [{ type: 'slow', duration: 2 }] });
    for (const e of hit) this.hits.push({ id: e.id, spike: i, frame: ctx.time.frame });
    if (hit.length) shake(this.cast, 0.14, 0.15);
    ctx.vfx.burst('ice', tB.copy(s.pos).setY(s.pos.y + 0.3), { count: 8, speed: 1.1 });
    if (i % 2 === 0) ctx.vfx.burst('snowpuff', s.pos, { count: 3 });
    ctx.world.fx.frost(s.pos, 1.1);
    if (i % 2 === 0) ctx.audio.play('ice_form', { position: s.pos, volume: 0.55, pitch: 0.9 + i * 0.03 });
    this.lastErupted = i;
  }

  update(dt: number): boolean {
    this.t += dt;
    for (let i = 0; i < this.spikes.length; i++) {
      const s = this.spikes[i];
      if (s.dead) continue;
      if (!s.erupted && this.t >= s.t0) this.erupt(i);
      if (!s.mesh) continue;
      const age = this.t - s.t0;
      let k = Math.min(1.08, easeOutBack(Math.min(1, age / 0.14)));
      if (this.t > this.life) {
        const d = (this.t - this.life) / 0.3;
        k *= Math.max(0, 1 - d);
        if (d >= 1) {
          this.kill(i, true);
          continue;
        }
      }
      s.mesh.scale.set(1, Math.max(0.01, s.h * k), 1);
    }
    return this.spikes.some((s) => !s.dead) || this.t < 0.2;
  }

  private kill(i: number, shatter: boolean): void {
    const s = this.spikes[i];
    if (s.dead) return;
    s.dead = true;
    if (s.collider) this.cast.ctx.world.collision.remove(s.collider);
    s.collider = 0;
    if (s.mesh) {
      this.fx.group.remove(s.mesh);
      if (shatter) this.cast.ctx.vfx.burst('ice', tA.copy(s.pos).setY(s.pos.y + s.h * 0.5), { count: 6, speed: 0.9 });
      s.mesh = null;
    }
    if (shatter && i % 3 === 0) this.cast.ctx.audio.play('ice_shatter', { position: s.pos, volume: 0.4 });
  }

  trace(): Record<string, unknown> {
    return { spikes: this.spikes.filter((s) => s.erupted && !s.dead).map((s) => s.pos.toArray()), last: this.lastErupted, hits: this.hits.length };
  }

  dispose(): void {
    for (let i = 0; i < this.spikes.length; i++) this.kill(i, false);
    this.removeMeltable?.();
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

registerTechnique({
  id: 'ice_spikes',
  name: 'Ice Spikes',
  element: 'water',
  kind: 'ability',
  tier: 4,
  description: 'Drive water into the ground and freeze it into a line of jagged spikes that erupt toward your foe, hurling them into the air. Walls and cliffs stop the line.',
  usage: 'Ability. Stomp to send a line of ice spikes forward. Uses ice or water.',
  icon: 'water',
  chiCost: 26,
  cooldown: 11,
  water: { amount: 18, allowIce: true, preferFrozen: true },
  windup: 0.45,
  recovery: 0.5,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 16,
  begin(cast) {
    cast.caster.humanoid?.animator.play('water_ice_spikes', { fadeIn: 0.05 });
    const c = cast.caster;
    cast.data.gather = fxOf(cast).add(
      new GatherStream(cast, {
        hand: 'hands',
        duration: cast.def.windup * 0.85,
        radius: 0.18,
        arc: 0.4,
        look: { ice: iceLookFor(cast) * 0.7 },
        target: (out) => out.set(c.position.x + Math.sin(c.yaw) * 0.9, c.position.y + 0.05, c.position.z + Math.cos(c.yaw) * 0.9),
      }),
    );
  },
  release(cast) {
    cast.data.released = true;
    const c = cast.caster;
    (cast.data.gather as GatherStream | undefined)?.absorb();
    const { f } = basis(cast.aimDir, tA, tB);
    const origin = c.position.clone();
    const length = 15;
    const fx = fxOf(cast).add(new IceSpikesEffect(cast, origin, f.clone(), length));
    cast.data.spikes = fx;
    cast.ctx.vfx.ring(origin.clone().setY(origin.y + 0.1), '#dff6ff', 3, 0.4, { opacity: 0.6 });
    cast.ctx.vfx.burst('snowpuff', origin, { count: 8, radius: 0.8 });
    cast.ctx.audio.play('rock_impact', { position: origin, volume: 0.5, pitch: 1.5 });
    shake(cast, 0.15, 0.2);
  },
  end(cast, interrupted) {
    if (interrupted && !cast.data.released) {
      (cast.data.gather as GatherStream | undefined)?.drop();
      refundWater(cast);
    }
  },
  aiScore(_c, _t, dist) {
    return dist > 3 && dist < 14 ? 0.5 : 0;
  },
});

// ---------------------------------------------------------------------------
// Freezing Strike
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'freezing_strike',
  name: 'Freezing Strike',
  element: 'water',
  kind: 'ability',
  tier: 2,
  description: 'A snapping lash of near-frozen water that wraps a foe and freezes them solid for a few heartbeats. Soaked targets stay frozen longer.',
  usage: 'Ability. A fast lash toward your aim; freezes the first foes it touches. Uses water or ice.',
  icon: 'water',
  chiCost: 16,
  cooldown: 6,
  water: { amount: 6, allowIce: true },
  windup: 0.16,
  recovery: 0.32,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 10,
  begin(cast) {
    cast.caster.humanoid?.animator.play('water_freeze_strike', { fadeIn: 0.05 });
    cast.data.whip = fxOf(cast).add(
      new WhipEffect(cast, {
        style: 'freeze',
        hand: 'handR',
        range: 10,
        swing: 0.17,
        radius: 0.17,
        damage: 10,
        knockback: 1.5,
        stagger: 20,
        ice: 0.85,
        returnFrac: 0,
        status: [{ type: 'soaked', duration: 3 }],
        onHit: (e: Entity, point, c, res) => {
          if (res.blocked) return;
          const soaked = !!e.hasStatus('soaked');
          e.addStatus('freeze', soaked ? 3.6 : 2.6, 1, c.caster.id);
          c.ctx.vfx.burst('ice', point, { count: 16, speed: 1 });
          c.ctx.vfx.burst('snowpuff', point, { count: 5 });
          c.ctx.audio.play('ice_form', { position: point, volume: 0.8 });
          c.ctx.world.fx.frost(e.position, 1.6);
        },
        onFinish: (tip, c) => {
          const g = c.ctx.world.groundAt(tip.x, tip.z, tip.y + 1);
          if (tip.y - g.y < 3) {
            c.ctx.world.fx.frost(tA.set(tip.x, g.y, tip.z), 1.2);
            c.ctx.vfx.burst('ice', tA.set(tip.x, g.y + 0.2, tip.z), { count: 8, speed: 0.6 });
          }
        },
      }),
    );
  },
  release(cast) {
    (cast.data.whip as WhipEffect | undefined)?.release();
    cast.ctx.audio.play('water_whip', { position: handPos(cast.caster, 'handR', tA), volume: 0.8, pitch: 1.25 });
  },
  end(cast, interrupted) {
    if (interrupted) (cast.data.whip as WhipEffect | undefined)?.abort();
  },
  aiScore(_c, target, dist) {
    return dist < 9 && !target.hasStatus('freeze') ? 0.6 : 0;
  },
});
