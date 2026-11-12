import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { SurfaceType } from '../../../core/types';
import type { Entity } from '../../../entities/Entity';
import type { EnvironmentSystem } from '../../../world/env/EnvironmentSystem';
import { shardRing } from '../../../vfx/effects/earth';
import { debris, effect } from '../../../vfx/effects/loop';
import { stoneMaterial, wallGeometry } from '../../../vfx/effects/rocks';
import { createTerrainSample, sampleTerrain } from '../../../world/Heightfield';
import { waterTribeAt } from '../../../world/WorldLayout';
import type { Cast } from '../../types';
import { aimFlat, anim, enemiesNear, finisherFreeze, finisherImpact } from '../bending/util';
import { bendableAt, groundPoint, takeCounter, tintAt } from './common';
import { seismicPulse } from './seismic';

/**
 * Fifth strike of Rock Strike, the finisher: Earth Crusher. The bender stomps and throws the arms
 * out wide: two slabs of rock burst out of the ground on either side of the nearest foe in front.
 * The hands clap together and the slabs slam shut on whoever stands between them — heavy damage
 * and a stun. A beat later they crumble back into the earth, leaving loose stones an earthbender
 * can lift again. Slabs only rise from earth (not water, ice, wood or metal).
 */

export const CRUSH = {
  /** How far ahead a foe can be caught (m) and the half-angle of the search cone (rad). */
  reach: 13,
  cone: 0.85,
  /** Each slab's centre starts this far to the side of the target (m). */
  gap: 2.4,
  width: 2.4,
  height: 2.9,
  thick: 0.8,
  /** Seconds after the cast begins that the slabs burst out (the stomp), and how long they rise. */
  delay: 0.15,
  rise: 0.22,
  /** Seconds the slam takes, how long the slabs hold shut, how long they take to crumble away. */
  slam: 0.11,
  hold: 0.42,
  crumble: 0.4,
  /** How fast the slabs can glide after their foe before the clap (m/s). */
  follow: 8,
};

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const tA = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tQ2 = new THREE.Quaternion();
const ts = createTerrainSample();
const PAVING: ReadonlySet<SurfaceType> = new Set<SurfaceType>(['stone', 'cobble']);

interface Slab {
  /** +1: on the `side` of the target, −1: on the other side. */
  s: number;
  mesh: THREE.Mesh;
  base: THREE.Vector3;
}

/** Where the slabs close: the nearest foe ahead (or the cast's target), else the ground at the aim. */
function crushPoint(cast: Cast): { point: THREE.Vector3; foe: Entity | null } {
  const ctx = cast.ctx;
  const c = cast.caster;
  const fwd = aimFlat(cast);
  let foe: Entity | null = null;
  const t = cast.target;
  if (t && t.alive && ctx.combat.canHarm(c, t) && Math.hypot(t.position.x - c.position.x, t.position.z - c.position.z) <= CRUSH.reach) foe = t;
  if (!foe) {
    let best = Infinity;
    const cos = Math.cos(CRUSH.cone);
    for (const e of enemiesNear(cast, c.position, CRUSH.reach)) {
      const dx = e.position.x - c.position.x, dz = e.position.z - c.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.01 || Math.abs(e.position.y - c.position.y) > 4) continue;
      const dot = (dx * fwd.x + dz * fwd.z) / d;
      if (dot < cos) continue;
      // Nearest, favouring foes close to the aim line.
      const score = d * (1.6 - dot);
      if (score < best) {
        best = score;
        foe = e;
      }
    }
  }
  let along: number;
  if (foe) along = (foe.position.x - c.position.x) * fwd.x + (foe.position.z - c.position.z) * fwd.z;
  else along = Math.hypot(cast.aimPoint.x - c.position.x, cast.aimPoint.z - c.position.z);
  // Never close on the bender: the slabs' span stays clear of the caster.
  along = Math.max(2.1, Math.min(foe ? CRUSH.reach : 9, along));
  const lateral = foe ? (foe.position.x - c.position.x) * -fwd.z + (foe.position.z - c.position.z) * fwd.x : 0;
  const x = c.position.x + fwd.x * along - fwd.z * lateral;
  const z = c.position.z + fwd.z * along + fwd.x * lateral;
  return { point: groundPoint(ctx, x, z, foe ? foe.position.y : c.position.y), foe };
}

/** Loose-stone tint of the ground at (x, z), matching stones torn out of it (RockLift). */
function stoneTint(ctx: GameContext, x: number, z: number, y: number): [number, number, number] {
  const g = ctx.world.groundAt(x, z, y + 1);
  if (PAVING.has(g.surface)) return [0.7, 0.67, 0.62];
  const c = sampleTerrain(x, z, g.y, 1 - g.ny, ts).soil;
  const j = (): number => 0.9 + Math.random() * 0.15;
  return [c[0] * j(), c[1] * j(), c[2] * j()];
}

/**
 * The two slabs, from bursting out to crumbling away. Created when the cast begins (they rise
 * with the stomp); `slam()` on release; `cancel()` if the cast is interrupted first.
 */
export class Crusher {
  readonly point: THREE.Vector3;
  readonly foe: Entity | null;
  private readonly fwd: THREE.Vector3;
  private readonly side: THREE.Vector3;
  private readonly slabs: Slab[] = [];
  private readonly tint: string;
  private t = 0;
  /** -1 rising/waiting; then seconds since the slam began. */
  private slamT = -1;
  private cancelT = -1;
  private struck = false;
  private risen = false;
  private crumbled = false;
  private closeTo = 0.42;
  private done = false;

  constructor(private readonly cast: Cast) {
    const ctx = cast.ctx;
    const { point, foe } = crushPoint(cast);
    this.point = point;
    this.foe = foe;
    this.fwd = aimFlat(cast);
    this.side = new THREE.Vector3(-this.fwd.z, 0, this.fwd.x);
    this.tint = tintAt(ctx, point);
    const variant = Math.floor(Math.random() * 3);
    for (const s of [1, -1]) {
      const bx = point.x + this.side.x * CRUSH.gap * s, bz = point.z + this.side.z * CRUSH.gap * s;
      const base = groundPoint(ctx, bx, bz, point.y);
      // Rock only comes out of earth; a slab that would rise from water or a wooden floor stays down.
      if (!bendableAt(ctx, base.x, base.z, base.y) || Math.abs(base.y - point.y) > 2.5) continue;
      const mesh = new THREE.Mesh(wallGeometry(CRUSH.width, CRUSH.height, CRUSH.thick, variant + (s > 0 ? 0 : 1)), stoneMaterial(this.tint));
      mesh.castShadow = ctx.vfx.quality !== 'low';
      mesh.receiveShadow = true;
      mesh.visible = false;
      ctx.vfx.group.add(mesh);
      this.slabs.push({ s, mesh, base });
    }
    effect(
      (dt) => this.update(dt),
      () => this.dispose(),
    );
  }

  /** Stands at least one slab (nothing rises from water or wood). */
  get valid(): boolean {
    return this.slabs.length > 0;
  }

  /** The hands clap: the slabs slam shut. */
  slam(): void {
    if (this.slamT >= 0 || this.cancelT >= 0) return;
    this.slamT = 0;
    // They close on whoever is between them (pinned against their body), else meet in the middle.
    const caught = this.caught();
    let r = 0.05;
    for (const e of caught) r = Math.max(r, e.radius);
    this.closeTo = CRUSH.thick / 2 + Math.min(0.55, r);
    this.cast.ctx.audio.play('bend_earth_slam', { position: this.point, volume: 0.55, pitch: 1.45 });
  }

  /** The cast was interrupted before the clap: the slabs crumble where they stand. */
  cancel(): void {
    if (this.slamT >= 0 || this.cancelT >= 0) return;
    this.cancelT = 0;
  }

  /** Foes standing between the slabs right now. */
  private caught(): Entity[] {
    const out: Entity[] = [];
    const p = this.point;
    for (const e of enemiesNear(this.cast, p, CRUSH.gap + CRUSH.width)) {
      const dx = e.position.x - p.x, dz = e.position.z - p.z;
      const along = dx * this.fwd.x + dz * this.fwd.z;
      const lat = dx * this.side.x + dz * this.side.z;
      if (Math.abs(along) > CRUSH.width / 2 + e.radius) continue;
      if (Math.abs(lat) > CRUSH.gap - CRUSH.thick / 2 + e.radius * 0.5) continue;
      if (e.position.y > p.y + CRUSH.height || e.position.y + e.height < p.y - 0.5) continue;
      out.push(e);
    }
    return out;
  }

  private update(dt: number): boolean {
    if (this.done) return false;
    const ctx = this.cast.ctx;
    this.t += dt;
    if (this.cancelT >= 0) this.cancelT += dt;
    if (this.slamT >= 0) this.slamT += dt;
    // ---- Rise -----------------------------------------------------------------------------------
    const rt = this.t - CRUSH.delay;
    // Called off before the stomp: nothing ever came out of the ground.
    if (this.cancelT >= 0 && !this.risen) {
      this.done = true;
      return false;
    }
    if (rt >= 0 && !this.risen && this.slabs.length) this.burst();
    const rise = Math.max(0, Math.min(1, rt / CRUSH.rise));
    const up = 1 - Math.pow(1 - rise, 3);
    // Until they meet, the slabs keep their foe between them: the earth follows a foe that is
    // knocked back or steps aside (up to CRUSH.follow m/s; a quick enough dodge still gets away).
    if (!this.struck && this.cancelT < 0) this.follow(dt);
    // ---- Slam -------------------------------------------------------------------------------------
    const k = this.slamT < 0 ? 0 : Math.min(1, this.slamT / CRUSH.slam);
    const shut = k * k;
    if (k >= 1 && !this.struck) this.strike();
    // ---- Crumble (after the hold, or at once when cancelled) ---------------------------------------
    const ct = this.cancelT >= 0 ? this.cancelT : this.slamT >= 0 ? this.slamT - CRUSH.slam - CRUSH.hold : -1;
    if (ct >= 0 && !this.crumbled) this.crumble();
    const sink = ct < 0 ? 0 : Math.min(1, ct / CRUSH.crumble);
    for (const sl of this.slabs) {
      // Waiting for the clap, the tops lean out (anticipation); slamming, they lean in.
      const lean = this.slamT < 0 ? 0.12 * up : 0.12 - 0.24 * shut;
      const off = CRUSH.gap + (this.closeTo - CRUSH.gap) * shut;
      const m = sl.mesh;
      m.position.set(this.point.x + this.side.x * off * sl.s, sl.base.y - CRUSH.height * (1 - up) - CRUSH.height * 0.85 * sink * sink - 0.12, this.point.z + this.side.z * off * sl.s);
      // Face along `side` (thickness axis), then tilt about the slab's width axis (+ = top outward).
      tQ.setFromAxisAngle(UP, Math.atan2(this.side.x, this.side.z));
      tQ2.setFromAxisAngle(X, lean * sl.s + (sink > 0 ? 0.25 * sink * sl.s : 0));
      m.quaternion.copy(tQ).multiply(tQ2);
      if (sink > 0 && Math.random() < dt * 20) ctx.vfx.burst('dust', tA.copy(sl.base).setY(sl.base.y + 0.3), { count: 2, radius: 1, speed: 0.8 });
    }
    if (sink >= 1 || this.t > 4) {
      this.done = true;
      return false;
    }
    return true;
  }

  /** Glide the slabs after their foe along the ground (they stay on earth, never climb walls). */
  private follow(dt: number): void {
    const foe = this.foe;
    if (!foe || !foe.alive) return;
    const ctx = this.cast.ctx;
    const dx = foe.position.x - this.point.x, dz = foe.position.z - this.point.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    // Too far gone (or up a ledge): they let it go.
    if (d > 6 || Math.abs(foe.position.y - this.point.y) > 2.5) return;
    const step = Math.min(d, CRUSH.follow * dt);
    const nx = this.point.x + (dx / d) * step, nz = this.point.z + (dz / d) * step;
    const ny = groundPoint(ctx, nx, nz, this.point.y, tA).y;
    if (Math.abs(ny - this.point.y) > 0.8) return;
    const bases: THREE.Vector3[] = [];
    for (const sl of this.slabs) {
      const b = groundPoint(ctx, nx + this.side.x * CRUSH.gap * sl.s, nz + this.side.z * CRUSH.gap * sl.s, ny);
      if (!bendableAt(ctx, b.x, b.z, b.y) || Math.abs(b.y - ny) > 1.2) return;
      bases.push(b);
    }
    this.point.set(nx, ny, nz);
    this.slabs.forEach((sl, i) => sl.base.copy(bases[i]));
    // Dragged through the ground: dust and grit at the slab feet.
    if (this.risen && Math.random() < dt * 25) for (const sl of this.slabs) ctx.vfx.burst('dust', sl.base, { count: 1, radius: 0.8, speed: 1 });
  }

  /** The stomp: both slabs burst out of the ground. */
  private burst(): void {
    const ctx = this.cast.ctx;
    this.risen = true;
    for (const sl of this.slabs) {
      sl.mesh.visible = true;
      ctx.vfx.burst('dust', sl.base, { count: 10, radius: 1.1, speed: 1.4 });
      debris(sl.base.clone().setY(sl.base.y + 0.2), ctx.vfx.quality === 'low' ? 5 : 9, { spread: 1, speed: 5, size: 0.14, color: this.tint, life: 1.2 });
      ctx.world.fx.crack(sl.base, 1.6);
    }
    ctx.audio.play('bend_earth_rise', { position: this.point, volume: 0.95, pitch: 0.75 });
    shardRing(ctx, this.point, 1.6, this.tint, 0.22);
  }

  /** The slabs meet: whoever stands between them is crushed. */
  private strike(): void {
    this.struck = true;
    const cast = this.cast;
    const ctx = cast.ctx;
    const mul = takeCounter(cast);
    const joint = tA.copy(this.point).setY(this.point.y + 1.2);
    for (const e of this.caught()) {
      const res = cast.hit(e, { damage: 28 * mul, stun: 1.3, stagger: 100 * mul, knockback: new THREE.Vector3(0, 0, 0), point: e.aimPoint(new THREE.Vector3()) });
      if (!res) continue;
      finisherFreeze(cast, e, 0.17);
      debris(e.aimPoint(new THREE.Vector3()), 6, { spread: 1.2, speed: 4, size: 0.12, color: this.tint });
    }
    ctx.vfx.burst('dust', joint, { count: 18, radius: 1.2, speed: 2.2 });
    ctx.vfx.burst('debris', joint, { count: 14, spread: 1.4, speed: 3 });
    debris(joint.clone(), ctx.vfx.quality === 'low' ? 8 : 14, { spread: 1.4, speed: 7, size: 0.16, color: this.tint });
    ctx.vfx.ring(this.point.clone().setY(this.point.y + 0.1), '#cdb08a', 2.6, 0.32, { opacity: 0.45 });
    ctx.world.fx.crack(this.point, 2.3);
    ctx.world.fx.disturb(this.point, 4, 1);
    finisherImpact(cast, this.point, 0.4, 0.42);
    ctx.audio.play('stone.slam', { position: this.point, volume: 1, pitch: 0.85 });
    ctx.audio.play('rock_impact', { position: this.point, volume: 0.9, pitch: 0.65 });
    seismicPulse(ctx, cast.caster, this.point, 30);
  }

  /** The slabs break apart and sink back into the earth; the player's leave loose stones to lift. */
  private crumble(): void {
    this.crumbled = true;
    const ctx = this.cast.ctx;
    for (const sl of this.slabs) {
      const c = sl.mesh.position.clone().setY(sl.base.y + CRUSH.height * 0.5);
      debris(c, ctx.vfx.quality === 'low' ? 6 : 12, { spread: 1.5, speed: 3.5, size: 0.2, radius: 0.9, color: this.tint, life: 1.4 });
      ctx.vfx.burst('dust', c, { count: 10, radius: 1.2, speed: 1 });
    }
    ctx.audio.play('bend_earth_crumble', { position: this.point, volume: 0.8, pitch: 0.9 });
    if (this.cast.isPlayer && this.struck) this.leaveStones();
  }

  /** Two stones from the rubble, where the slabs stood: loose stones the bender can lift again. */
  private leaveStones(): void {
    const ctx = this.cast.ctx;
    const stones = ctx.player?.play?.stones;
    const veg = (ctx.extra.get('environment') as EnvironmentSystem | undefined)?.vegetation;
    const geo = veg?.rockGeometry();
    if (!stones || !geo) return;
    for (const sl of this.slabs) {
      const off = 1.0 + Math.random() * 0.4;
      const x = this.point.x + this.side.x * off * sl.s + this.fwd.x * (Math.random() - 0.5) * 1.2;
      const z = this.point.z + this.side.z * off * sl.s + this.fwd.z * (Math.random() - 0.5) * 1.2;
      const g = groundPoint(ctx, x, z, sl.base.y);
      if (waterTribeAt(x, z) || !bendableAt(ctx, x, z, g.y) || ctx.world.collision.overlapSphere(tA.set(x, g.y + 0.6, z), 0.5)) continue;
      const sxz = 0.6 + Math.random() * 0.18;
      const sy = sxz * (0.75 + Math.random() * 0.2);
      const m = new THREE.Matrix4().compose(tA.set(x, g.y - 0.1, z), tQ.setFromAxisAngle(UP, Math.random() * Math.PI * 2), new THREE.Vector3(sxz, sy, sxz));
      stones.add(geo, m, sxz, sy, stoneTint(ctx, x, z, g.y));
    }
  }

  private dispose(): void {
    this.done = true;
    for (const sl of this.slabs) sl.mesh.removeFromParent();
    this.slabs.length = 0;
  }
}

/** The finisher winds up: the stomp raises the slabs; the clap comes at 0.5 s into the clip. */
export function beginCrusher(cast: Cast): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  anim(c, 'earth_strike_crush', { speed: 1, fadeIn: 0.05, fadeOut: 0.18 });
  cast.elapsed -= 0.28;
  cast.movement = 'root';
  cast.recovery = 0.4;
  const crusher = new Crusher(cast);
  cast.data.crush = crusher;
  ctx.vfx.burst('dust', c.position, { count: 6, radius: 0.5, speed: 0.9 });
  seismicPulse(ctx, c, c.position, 22);
  if (!crusher.valid) ctx.audio.play('bend_earth_sink', { position: c.position, volume: 0.5, pitch: 1.2 });
}

/** The clap. */
export function releaseCrusher(cast: Cast): void {
  const crusher = cast.data.crush as Crusher | undefined;
  if (!crusher) return;
  crusher.slam();
  const c = cast.caster;
  cast.ctx.vfx.burst('dust', c.castOrigin('hands', tA), { count: 5, radius: 0.2, speed: 1.2 });
  cast.ctx.audio.play('bend_stone_block', { position: c.position, volume: 0.5, pitch: 1.3 });
}
