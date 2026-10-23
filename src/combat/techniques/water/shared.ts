import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { Entity } from '../../../entities/Entity';
import { clamp01, easeOut, PathSampler } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { getWaterFX, StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import type { WaterLook } from '../../water/WaterMaterials';
import type { Cast, Combatant } from '../../types';

/**
 * Helpers shared by the waterbending techniques: caster basis, capsule hit
 * tests along the same curves that pose the water meshes, gather streams
 * (source → hands) and water bookkeeping (refunds, returns, spills).
 */

export const UP = new THREE.Vector3(0, 1, 0);
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();

export type HandName = 'handL' | 'handR' | 'hands';

export function fxOf(cast: Cast): WaterFX {
  return getWaterFX(cast.ctx);
}

export function handPos(caster: Combatant, which: HandName | 'chest', out = new THREE.Vector3()): THREE.Vector3 {
  return caster.castOrigin(which, out);
}

/** Horizontal forward (f) and character-right (r) unit vectors from a direction. */
export function basis(dir: THREE.Vector3, f = new THREE.Vector3(), r = new THREE.Vector3()): { f: THREE.Vector3; r: THREE.Vector3 } {
  f.set(dir.x, 0, dir.z);
  if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
  f.normalize();
  r.set(-f.z, 0, f.x);
  return { f, r };
}

/** Distance from point q to an entity's vertical capsule surface (negative = inside). */
export function capsuleDistance(e: Entity, q: THREE.Vector3): number {
  const by = e.position.y + e.radius, ty = e.position.y + Math.max(e.radius, e.height - e.radius);
  const cy = Math.max(by, Math.min(ty, q.y));
  const dx = q.x - e.position.x, dy = q.y - cy, dz = q.z - e.position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - e.radius;
}

export interface PathContact {
  e: Entity;
  point: THREE.Vector3;
  s: number;
}

const _cands: Entity[] = [];

/**
 * Entities the caster may harm whose capsule touches the tube of radius `r`
 * around path[s0..s1]. Sampled every ~0.3 m — the same path that poses the
 * visible water, so collision matches what is drawn.
 */
export function contactsAlongPath(cast: Cast, path: PathSampler, s0: number, s1: number, r: number, out: PathContact[] = [], samples?: number[][]): PathContact[] {
  out.length = 0;
  if (s1 - s0 < 0.01) return out;
  const n = Math.max(2, Math.ceil((s1 - s0) / 0.3));
  const mid = path.at((s0 + s1) * 0.5, tA);
  const reach = (s1 - s0) * 0.5 + r + 2.5;
  const ents = cast.ctx.entities.queryRadius(mid, reach, undefined, _cands);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = path.at(s0 + ((s1 - s0) * i) / n, new THREE.Vector3());
    pts.push(p);
    if (samples) samples.push([+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]);
  }
  for (const e of ents) {
    if (e === cast.caster || !cast.ctx.combat.canHarm(cast.caster, e)) continue;
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = capsuleDistance(e, pts[i]);
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (best <= r) out.push({ e, point: pts[bi].clone(), s: s0 + ((s1 - s0) * bi) / n });
  }
  return out;
}

/** Return unused / recovered water to the caster's reserve (capped). Returns units actually added. */
export function returnToReserve(cast: Cast, amount: number): number {
  const c = cast.caster;
  if (!c.alive || amount <= 0) return 0;
  const add = Math.min(amount, Math.max(0, c.maxWaterReserve - c.waterReserve));
  if (add <= 0) return 0;
  c.waterReserve += add;
  fxOf(cast).pulseReserve(c, add / 6);
  if (c.isPlayer) cast.ctx.events.emit('water:reserve', { amount: c.waterReserve, max: c.maxWaterReserve });
  return add;
}

/** Spent water returns to the world at a point (refills finite sources / leaves a puddle). */
export function spill(cast: Cast, at: THREE.Vector3, amount: number): void {
  if (amount <= 0) return;
  const g = cast.ctx.world.groundAt(at.x, at.z, at.y + 1);
  tB.set(at.x, Math.min(at.y, g.y + 0.05), at.z);
  cast.ctx.water.release(tB, amount);
  if (Math.abs(at.y - g.y) < 2) cast.ctx.world.fx.wet(tB, Math.min(3, 0.6 + amount * 0.08));
}

/**
 * A cast interrupted before release gives its water back: reserve water returns
 * to the reserve; drawn water falls back where it came from (finite sources are
 * refilled through release()).
 */
export function refundWater(cast: Cast): void {
  const w = cast.water;
  if (w.amount <= 0 || cast.data.refunded) return;
  cast.data.refunded = true;
  if (w.sourceType === 'reserve') {
    returnToReserve(cast, w.amount);
  } else if (w.from && w.sourceType !== 'conjured') {
    cast.ctx.water.release(w.from, w.amount);
  }
}

/** Water touching a burning entity puts it out with steam. */
export function douse(cast: Cast, e: Entity): void {
  fxOf(cast).extinguish(e);
}

/** Camera shake for the player's impactful hits (respects the setting via CameraRig). */
export function shake(cast: Cast, intensity: number, duration = 0.2): void {
  if (!cast.isPlayer) return;
  cast.ctx.events.emit('camera:shake', { intensity, duration });
}

const lastNotice = new Map<string, number>();

/** Toast for the player only (technique refusals the HUD does not show), throttled per message. */
export function notifyPlayer(caster: Combatant, ctx: GameContext, text: string, kind: 'warning' | 'info' = 'warning'): void {
  if (!caster.isPlayer) return;
  const now = ctx.time.real;
  if ((lastNotice.get(text) ?? -99) > now - 1.5) return;
  lastNotice.set(text, now);
  ctx.events.emit('ui:notify', { text, kind, duration: 2.5 });
}

export function isFrozenGrant(cast: Cast): boolean {
  return cast.water.frozen && cast.water.sourceType !== 'snow';
}

// ---------------------------------------------------------------------------
// GatherStream: water rising from its origin (source / reserve / water skin)
// and flowing into the bender's hands during the windup.
// ---------------------------------------------------------------------------

export interface GatherOptions {
  hand: HandName;
  /** Seconds for the head to reach the hands. */
  duration: number;
  radius?: number;
  look?: WaterLook;
  /** Optional custom destination (defaults to the hand position). */
  target?: (out: THREE.Vector3) => THREE.Vector3;
  /** Extra apex height (m). */
  arc?: number;
}

export class GatherStream implements WaterEffect {
  readonly kind = 'gather';
  castId: number;
  readonly origin = new THREE.Vector3();
  readonly end = new THREE.Vector3();
  private t = 0;
  private body: StreamBody;
  private absorbT = -1;
  private dropT = -1;
  private readonly fx: WaterFX;
  private gone = false;

  constructor(readonly cast: Cast, readonly o: GatherOptions) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    const h = handPos(cast.caster, o.hand, tA);
    this.fx.originFor(cast, h, this.origin);
    const dist = this.origin.distanceTo(h);
    this.body = new StreamBody(this.fx, { flow: 7, ...(o.look ?? {}) }, dist > 9 ? 1.4 : 1, 3);
    this.body.radius = o.radius ?? 0.16;
    this.body.wobble = 0.05;
    this.fx.logCast(cast, this.origin);
    if (cast.water.from) {
      const ice = cast.water.frozen;
      this.fx.splash(this.origin, 0.6, { ice, sound: false, ring: true });
      cast.ctx.audio.play(ice ? 'ice_form' : 'water_gather', { position: this.origin, volume: 0.6 });
    } else {
      cast.ctx.audio.play('water_gather', { position: h, volume: 0.35, pitch: 1.4 });
    }
  }

  /** The water reached the hands and is absorbed into the technique (tail catches up). */
  absorb(): void {
    if (this.absorbT < 0 && this.dropT < 0) this.absorbT = 0;
  }

  /** Interrupted: the water collapses and falls back. */
  drop(): void {
    if (this.dropT < 0 && this.absorbT < 0) {
      this.dropT = 0;
      this.fx.droplets(this.body.path, 0, this.body.path.length * this.body.head, 6, this.cast.water.frozen);
    }
  }

  get headPoint(): THREE.Vector3 {
    return this.body.path.at(this.body.path.length * this.body.head, new THREE.Vector3());
  }

  update(dt: number): boolean {
    if (this.gone) return false;
    this.t += dt;
    const o = this.o;
    if (o.target) o.target(this.end);
    else handPos(this.cast.caster, o.hand, this.end);
    const p = this.body.pts;
    p[0].copy(this.origin);
    const d = this.origin.distanceTo(this.end);
    p[1].lerpVectors(this.origin, this.end, 0.5).addScaledVector(UP, 0.25 * d + (o.arc ?? 0.6));
    p[2].copy(this.end);
    this.body.head = easeOut(this.t / Math.max(0.05, o.duration));
    this.body.tail = 0;
    if (this.absorbT >= 0) {
      this.absorbT += dt;
      this.body.head = 1;
      this.body.tail = clamp01(this.absorbT / 0.16);
      if (this.body.tail >= 0.999) return false;
    } else if (this.dropT >= 0) {
      this.dropT += dt;
      for (const q of p) q.y -= 9 * this.dropT * dt * 4;
      this.body.radius *= Math.max(0, 1 - dt * 5);
      if (this.dropT > 0.3) return false;
    } else if (this.t > o.duration + 2.5) {
      // Safety: a gather never lingers forever.
      return false;
    }
    const r = this.body.radius;
    this.body.profile = (u) => capTaper(u, 0.1, 0.12) * (0.75 + 0.25 * u);
    void r;
    this.body.build(3);
    return true;
  }

  trace(): Record<string, unknown> {
    return { start: this.origin.toArray(), head: this.headPoint.toArray(), phase: this.absorbT >= 0 ? 'absorb' : this.dropT >= 0 ? 'drop' : 'gather' };
  }

  dispose(): void {
    this.gone = true;
    this.body.dispose();
  }
}
