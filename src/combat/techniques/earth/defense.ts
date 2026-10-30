import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { GameEvents } from '../../../core/events';
import type { Action } from '../../../core/Input';
import type { Entity } from '../../../entities/Entity';
import { BoneArmor, rockImpact, rockVisual } from '../../../vfx/effects/earth';
import { debris } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import type { Cast, Combatant } from '../../types';
import { bending } from '../bending/runtime';
import { anim, hitSphere, push, shake, stopAnim } from '../bending/util';
import { earthPrecheck, tintAt } from './common';

/**
 * Earth defense: Stone Guard (brace with stone forearms — heavy damage
 * reduction; a hit taken in the first moments is a PERFECT block that refunds
 * the damage and counters) and Rock Armor (stone plates: damage reduction,
 * stagger & knockback immunity, slower; use again to burst it outward).
 * Blocks open the earth counter window: the next earth attack hits harder.
 */

const tmp = new THREE.Vector3();

interface GuardState {
  cast: Cast;
  start: number;
  perfectUntil: number;
  plates: BoneArmor | null;
}

interface ArmorState {
  entity: Combatant;
  cast: Cast;
  until: number;
  plates: BoneArmor | null;
  maxPoise: number;
  addedSlow: boolean;
  tint: string;
}

const guards = new Map<number, GuardState>();
const armors = new Map<number, ArmorState>();

function onHit(ctx: GameContext, e: GameEvents['hit']): void {
  const target = ctx.entities.get(e.targetId);
  if (!target) return;
  const g = guards.get(e.targetId);
  if (g && e.blocked) {
    const attacker = e.attackerId ? ctx.entities.get(e.attackerId) : undefined;
    const perfect = ctx.time.elapsed <= g.perfectUntil;
    const at = new THREE.Vector3(e.position.x, e.position.y, e.position.z);
    if (perfect) {
      target.health?.heal(e.damage);
      bending.openCounter(g.cast.caster, 2.5);
      ctx.vfx.flash(at, '#ffe7a8', 5, 0.2, 10);
      ctx.vfx.ring(target.position.clone().setY(target.position.y + 0.1), '#f2d27a', 4, 0.4, { opacity: 0.8 });
      ctx.audio.play('bend_perfect_block', { position: at, volume: 0.9 });
      shake(ctx, at, 0.25, 0.2);
      if (attacker && attacker.alive) counterStrike(g.cast, attacker);
    } else {
      bending.openCounter(g.cast.caster, 1.2);
      ctx.audio.play('bend_stone_block', { position: at, volume: 0.8 });
      debris(at, 3, { spread: 1.2, speed: 4, size: 0.08, color: tintAt(ctx, target.position), life: 0.9 });
    }
    if (target === ctx.player) ctx.events.emit('player:blocked', { attackerId: e.attackerId, perfect });
  }
  const a = armors.get(e.targetId);
  if (a && target.body) {
    // Stone plates: barely moved by impacts.
    target.body.external.multiplyScalar(0.3);
    if (target.body.velocity.y > 0) target.body.velocity.y *= 0.25;
    debris(new THREE.Vector3(e.position.x, e.position.y, e.position.z), 2, { spread: 1.3, speed: 3.5, size: 0.08, color: a.tint, life: 0.8 });
    ctx.audio.play('bend_stone_block', { position: e.position, volume: 0.5, pitch: 0.8 });
  }
}

/** Perfect-guard counter: a stone burst at a close attacker, a rock hurled at a distant one. */
function counterStrike(cast: Cast, attacker: Entity): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  const to = tmp.subVectors(attacker.position, c.position).setY(0);
  const d = to.length();
  const dir = d > 0.01 ? to.divideScalar(d).clone() : new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
  if (d < 3.5) {
    cast.hit(attacker, { damage: 14, knockback: push(dir, 13), stagger: 75, stun: 0.4, point: attacker.aimPoint(new THREE.Vector3()) }, true);
    rockImpact(ctx, attacker.aimPoint(new THREE.Vector3()), 0.8, tintAt(ctx, c.position));
  } else {
    const from = c.castOrigin('chest', new THREE.Vector3()).addScaledVector(dir, 0.8);
    const vel = attacker.aimPoint(new THREE.Vector3()).sub(from).normalize().multiplyScalar(32);
    const tint = tintAt(ctx, c.position);
    cast.ctx.combat.detachedCast(c, cast.def, from, vel.clone().normalize(), attacker).projectile({
      position: from,
      velocity: vel,
      radius: 0.4,
      life: 1.4,
      damage: 16,
      knockback: 9,
      stagger: 60,
      homing: 4,
      target: attacker,
      visual: rockVisual(ctx, 0.4, tint),
      onHitEntity: (p) => rockImpact(ctx, p.position, 0.7, tint),
      onHitWorld: (_p, pt) => rockImpact(ctx, pt, 0.7, tint),
    });
  }
}

function endArmor(ctx: GameContext, a: ArmorState, burst: boolean): void {
  armors.delete(a.entity.id);
  const e = a.entity;
  e.removeStatus('armor');
  if (a.addedSlow) e.removeStatus('slow');
  if (e.health) {
    e.health.maxPoise = a.maxPoise;
    e.health.poise = Math.min(e.health.poise, a.maxPoise);
  }
  a.plates?.shatter();
  const center = e.position.clone().setY(e.position.y + 1);
  if (burst) {
    hitSphere(a.cast, center, 4.2, 1.8, (_x, away) => ({ damage: 18, knockback: push(away, 14), launch: 3, stagger: 55 }), true);
    debris(center, 22, { spread: 1.6, speed: 10, size: 0.16, radius: 0.5, color: a.tint, life: 1.6 });
    ctx.vfx.burst('dust', center, { count: 18, radius: 1.2, speed: 2.5 });
    ctx.vfx.ring(e.position.clone().setY(e.position.y + 0.1), '#c8b088', 5, 0.35, { opacity: 0.6 });
    ctx.audio.play('bend_earth_crumble', { position: center, volume: 1, pitch: 0.8 });
    shake(ctx, center, 0.25, 0.25);
  } else {
    ctx.audio.play('bend_earth_crumble', { position: center, volume: 0.6 });
  }
}

bending.hook({
  init: (ctx) => ctx.events.on('hit', (e) => onHit(ctx, e)),
  pre: (_dt, ctx) => {
    const now = ctx.time.elapsed;
    for (const a of [...armors.values()]) {
      const e = a.entity;
      // Ends on timeout, death, or when something strips the armor status (cleanse, session reset).
      if (!e.alive || e.disposed || now >= a.until || !e.hasStatus('armor')) {
        endArmor(ctx, a, false);
        continue;
      }
      if (e.health) e.health.poise = e.health.maxPoise;
    }
    // Player: pressing Rock Armor again while armored bursts the plates outward.
    const p = ctx.player;
    if (p && armors.has(p.id) && p.element === 'earth') {
      const i = ctx.progression.slotsFor('earth').indexOf('rock_armor');
      const action = i >= 0 ? (['ability1', 'ability2', 'ability3', 'ability4'] as Action[])[i] : null;
      if (action && ctx.input.wasPressed(action)) {
        ctx.input.consume(action);
        anim(p, 'earth_slam', { speed: 1.6, fadeIn: 0.04 });
        endArmor(ctx, armors.get(p.id)!, true);
      }
    }
  },
  sessionEnd: (ctx) => {
    for (const a of [...armors.values()]) endArmor(ctx, a, false);
    for (const g of guards.values()) g.cast.caster.guarding = false;
    guards.clear();
  },
});

// ---------------------------------------------------------------------------
// Stone Guard
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'stone_guard',
  name: 'Stone Guard',
  element: 'earth',
  kind: 'defense',
  tier: 2,
  description: 'Brace with stone-clad forearms: most of any blow is absorbed. Catch an attack the instant you raise your guard for a perfect block that counters the attacker.',
  usage: 'Hold the technique key to guard (75% damage reduction, barely moved). A hit in the first 0.3 s is a Perfect Block: no damage and an automatic counter. Any block opens a counter window — your next earth attack hits harder.',
  icon: 'earth',
  chiCost: 10,
  cooldown: 1.0,
  windup: 0.08,
  recovery: 0.25,
  movement: 'root',
  airborne: false,
  interruptible: false,
  range: 3,
  channel: 3,
  precheck: earthPrecheck,
  begin(cast) {
    bending.channel(cast, 'hold', { min: 0.35, auto: 1.6 });
    anim(cast.caster, 'earth_guard', { fadeIn: 0.06 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    c.guarding = true;
    const tint = tintAt(ctx, c.position);
    const plates = c.humanoid
      ? new BoneArmor(
          ctx,
          c.humanoid,
          [
            { bone: 'foreArmL', offset: [0, -0.12, 0.02], scale: [0.11, 0.17, 0.1] },
            { bone: 'foreArmR', offset: [0, -0.12, 0.02], scale: [0.11, 0.17, 0.1] },
            { bone: 'handL', offset: [0, -0.05, 0.02], scale: [0.08, 0.08, 0.08] },
            { bone: 'handR', offset: [0, -0.05, 0.02], scale: [0.08, 0.08, 0.08] },
          ],
          tint,
        )
      : null;
    guards.set(c.id, { cast, start: ctx.time.elapsed, perfectUntil: ctx.time.elapsed + 0.3, plates });
    ctx.vfx.burst('dust', c.position, { count: 8, radius: 0.6, speed: 0.8 });
    debris(c.position.clone().setY(c.position.y + 0.2), 4, { spread: 0.6, speed: 3, size: 0.07, color: tint, life: 0.6 });
    ctx.audio.play('bend_stone_block', { position: c.position, volume: 0.7, pitch: 0.7 });
  },
  channelUpdate(cast, dt) {
    return bending.channelKeep(cast, dt);
  },
  end(cast) {
    const c = cast.caster;
    const g = guards.get(c.id);
    if (g && g.cast === cast) {
      guards.delete(c.id);
      g.plates?.shatter();
    }
    c.guarding = false;
    stopAnim(c, 'earth_guard', 0.15);
  },
  aiScore: (_c, _t, dist) => (dist < 4 ? 0.3 : 0),
});

// ---------------------------------------------------------------------------
// Rock Armor
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'rock_armor',
  name: 'Rock Armor',
  element: 'earth',
  kind: 'defense',
  tier: 3,
  description: 'Pull stone plates up over your body. Blows lose half their force, nothing staggers you and impacts barely move you — but you move slower. Burst the armor outward when you are done.',
  usage: 'Lasts 12 s: 50% damage reduction, stagger and knockback immunity, slower movement. Press the technique key again to blast the plates outward (damages and repels nearby enemies).',
  icon: 'earth',
  chiCost: 30,
  cooldown: 8,
  windup: 0.5,
  recovery: 0.3,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 4,
  precheck: earthPrecheck,
  begin(cast) {
    anim(cast.caster, 'earth_armor', { fadeIn: 0.06 });
    const c = cast.caster;
    cast.ctx.vfx.burst('dust', c.position, { count: 14, radius: 1, speed: 1.2 });
    debris(c.position.clone().setY(c.position.y + 0.1), 8, { dir: new THREE.Vector3(0, 1, 0), spread: 0.35, speed: 5, size: 0.12, radius: 0.7, color: tintAt(cast.ctx, c.position), life: 0.6 });
    cast.ctx.audio.play('bend_earth_rise', { position: c.position, volume: 0.8, pitch: 1.2 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const old = armors.get(c.id);
    if (old) endArmor(ctx, old, false);
    const tint = tintAt(ctx, c.position);
    const plates = c.humanoid
      ? new BoneArmor(
          ctx,
          c.humanoid,
          [
            { bone: 'chest', offset: [0, 0.1, 0.1], scale: [0.2, 0.17, 0.1] },
            { bone: 'chest', offset: [0, 0.12, -0.11], scale: [0.2, 0.17, 0.09] },
            { bone: 'spine', offset: [0, 0.05, 0.09], scale: [0.17, 0.1, 0.08] },
            { bone: 'upperArmL', offset: [0.02, -0.08, 0], scale: [0.09, 0.13, 0.09] },
            { bone: 'upperArmR', offset: [-0.02, -0.08, 0], scale: [0.09, 0.13, 0.09] },
            { bone: 'foreArmL', offset: [0, -0.12, 0.01], scale: [0.08, 0.14, 0.08] },
            { bone: 'foreArmR', offset: [0, -0.12, 0.01], scale: [0.08, 0.14, 0.08] },
            { bone: 'thighL', offset: [0, -0.2, 0.03], scale: [0.1, 0.17, 0.1] },
            { bone: 'thighR', offset: [0, -0.2, 0.03], scale: [0.1, 0.17, 0.1] },
            { bone: 'shinL', offset: [0, -0.2, 0.03], scale: [0.08, 0.15, 0.08] },
            { bone: 'shinR', offset: [0, -0.2, 0.03], scale: [0.08, 0.15, 0.08] },
            { bone: 'head', offset: [0, 0.2, -0.02], scale: [0.11, 0.06, 0.11] },
          ],
          tint,
        )
      : null;
    const hadSlow = !!c.hasStatus('slow');
    c.addStatus('armor', 12, 1, c.id);
    if (!hadSlow) c.addStatus('slow', 12, 1, c.id);
    const maxPoise = c.health?.maxPoise ?? 30;
    if (c.health) {
      c.health.maxPoise = 9999;
      c.health.poise = 9999;
    }
    armors.set(c.id, { entity: c, cast, until: ctx.time.elapsed + 12, plates, maxPoise, addedSlow: !hadSlow, tint });
    ctx.vfx.ring(c.position.clone().setY(c.position.y + 0.1), '#c8b088', 3, 0.35, { opacity: 0.6 });
    ctx.audio.play('bend_earth_slam', { position: c.position, volume: 0.6, pitch: 1.4 });
    shake(ctx, c.position, 0.15, 0.2);
  },
  aiScore: (c, _t, dist) => (dist < 8 && !c.hasStatus('armor') ? 0.3 : 0),
});

/** Tests / UI: is this entity wearing rock armor or guarding? */
export function earthDefenseState(e: Entity): { armor: boolean; guard: boolean } {
  return { armor: armors.has(e.id), guard: guards.has(e.id) };
}
