import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { GameEvents } from '../../../core/events';
import type { Action } from '../../../core/Input';
import type { Entity } from '../../../entities/Entity';
import { rockImpact, rockVisual } from '../../../vfx/effects/earth';
import { GUARD_PARTS, RockArmorVisual } from '../../../vfx/effects/rockArmor';
import { debris } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import type { Cast, Combatant } from '../../types';
import { bending } from '../bending/runtime';
import { anim, hitSphere, push, shake, stopAnim } from '../bending/util';
import { earthPrecheck, tintAt } from './common';

/**
 * Earth defense: Stone Guard (brace with stone forearms — heavy damage
 * reduction; a hit taken in the first moments is a PERFECT block that refunds
 * the damage and counters) and Rock Armor (stone plates torn from the ground and
 * fitted over the body: damage reduction, stagger & knockback immunity, heavier
 * stone fists, slower; blows crack and knock off plates until the stone gives
 * out; use again to burst the plates outward).
 * Blocks open the earth counter window: the next earth attack hits harder.
 */

/** Damage the stone can soak up (the absorbed half of every blow) before it breaks. */
export const ARMOR_INTEGRITY = 150;
/** Every time this fraction of the integrity is spent, a plate is knocked off. */
const BREAK_STEP = 0.14;
/** Earth basic attacks with stone fists. */
const STONE_FIST = 1.25;
const ARMOR_TIME = 12;

const tmp = new THREE.Vector3();

interface GuardState {
  cast: Cast;
  start: number;
  perfectUntil: number;
  plates: RockArmorVisual | null;
}

interface ArmorState {
  entity: Combatant;
  cast: Cast;
  until: number;
  plates: RockArmorVisual | null;
  maxPoise: number;
  addedSlow: boolean;
  tint: string;
  /** Damage soaked up by the stone so far, and the next plate-knocking threshold (fraction). */
  absorbed: number;
  nextBreak: number;
  /** Heavy footsteps. */
  lastX: number;
  lastZ: number;
  stride: number;
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
  if (a) {
    // Stone plates: barely moved by impacts.
    if (target.body) {
      target.body.external.multiplyScalar(0.3);
      if (target.body.velocity.y > 0) target.body.velocity.y *= 0.25;
    }
    const at = new THREE.Vector3(e.position.x, e.position.y, e.position.z);
    // The stone took as much as got through (it halves every blow).
    a.absorbed += e.damage;
    const frac = a.absorbed / ARMOR_INTEGRITY;
    let knockOff = false;
    if (frac >= a.nextBreak && frac < 1) {
      knockOff = true;
      a.nextBreak += BREAK_STEP;
    }
    // Burn ticks and the like wear the stone down quietly; real blows chip and shake it.
    if (e.damage >= 2.5 || knockOff) {
      a.plates?.impact(at, { crack: e.damage >= 4 || frac > 0.5, knockOff });
      debris(at, 2, { spread: 1.3, speed: 3.5, size: 0.08, color: a.tint, life: 0.8 });
      ctx.audio.play('bend_stone_block', { position: e.position, volume: 0.5, pitch: 0.8 });
    }
    if (frac >= 1) endArmor(ctx, a, 'broken');
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

type ArmorEnd = 'burst' | 'timeout' | 'broken' | 'silent';

function endArmor(ctx: GameContext, a: ArmorState, how: ArmorEnd): void {
  if (armors.get(a.entity.id) !== a) return;
  armors.delete(a.entity.id);
  const e = a.entity;
  e.removeStatus('armor');
  if (a.addedSlow) e.removeStatus('slow');
  if (e.health) {
    e.health.maxPoise = a.maxPoise;
    e.health.poise = Math.min(e.health.poise, a.maxPoise);
  }
  const center = e.position.clone().setY(e.position.y + 1);
  if (how === 'silent') {
    a.plates?.dispose();
    return;
  }
  if (how === 'burst') {
    // The plates themselves fly outward: what they reach (4 m) is what they hit.
    a.plates?.burst();
    hitSphere(a.cast, center, 4.2, 1.8, (_x, away) => ({ damage: 18, knockback: push(away, 14), launch: 3, stagger: 55 }), true);
    debris(center, 14, { spread: 1.6, speed: 10, size: 0.12, radius: 0.5, color: a.tint, life: 1.4 });
    ctx.vfx.burst('dust', center, { count: 18, radius: 1.2, speed: 2.5 });
    ctx.vfx.ring(e.position.clone().setY(e.position.y + 0.1), '#c8b088', 5, 0.35, { opacity: 0.6 });
    ctx.audio.play('bend_earth_crumble', { position: center, volume: 1, pitch: 0.8 });
    shake(ctx, center, 0.25, 0.25);
  } else if (how === 'broken') {
    // Spent: the cracked stone gives way all at once.
    a.plates?.crumble(true);
    debris(center, 10, { spread: 1.4, speed: 4, size: 0.1, radius: 0.4, color: a.tint, life: 1.2 });
    ctx.vfx.burst('dust', center, { count: 12, radius: 0.8, speed: 1.4 });
    ctx.audio.play('bend_earth_crumble', { position: center, volume: 0.9, pitch: 1.05 });
    if (e === ctx.player) ctx.events.emit('ui:notify', { text: 'Your rock armor shatters.', kind: 'warning', duration: 2 });
  } else {
    a.plates?.crumble(false);
    ctx.audio.play('bend_earth_crumble', { position: center, volume: 0.6 });
  }
}

/** Automation: window.__game.debug.rockArmor.state(id?) / plates(id?) (the player by default). */
function installDebug(ctx: GameContext): void {
  const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
  if (!g?.debug || g.debug.rockArmor) return;
  const who = (id?: number) => (id ? ctx.entities.get(id) : ctx.player);
  g.debug.rockArmor = {
    state: (id?: number) => {
      const e = who(id);
      return e ? earthDefenseState(e) : null;
    },
    /** The same burst as pressing Rock Armor again while armored. */
    burst: (id?: number) => {
      const e = who(id);
      const a = e ? armors.get(e.id) : undefined;
      if (!a) return false;
      anim(a.entity, 'earth_slam', { speed: 1.6, fadeIn: 0.04 });
      endArmor(ctx, a, 'burst');
      return true;
    },
    plates: (id?: number) => {
      const e = who(id);
      const a = e ? armors.get(e.id) : undefined;
      return a?.plates ? a.plates.pieces.map((p) => ({ part: p.def.part, state: p.state, cracked: p.cracked })) : null;
    },
  };
}

/** Stone fists: earth basic attacks hit harder while armored (registered once per game). */
const fistMods = new WeakSet<object>();

bending.hook({
  init: (ctx) => {
    ctx.events.on('hit', (e) => onHit(ctx, e));
    installDebug(ctx);
    if (!fistMods.has(ctx.combat)) {
      fistMods.add(ctx.combat);
      ctx.combat.powerMods.push((c, def) => (def.element === 'earth' && def.kind === 'basic' && armors.has(c.id) ? STONE_FIST : 1));
    }
  },
  pre: (_dt, ctx) => {
    installDebug(ctx);
    const now = ctx.time.elapsed;
    for (const a of [...armors.values()]) {
      const e = a.entity;
      // Ends on timeout, death, or when something strips the armor status (cleanse, session reset).
      if (!e.alive || e.disposed || !e.hasStatus('armor')) {
        endArmor(ctx, a, 'silent');
        continue;
      }
      if (now >= a.until) {
        endArmor(ctx, a, 'timeout');
        continue;
      }
      if (e.health) e.health.poise = e.health.maxPoise;
      // Heavy stone steps: a thud and a puff of dust every stride.
      const step = Math.hypot(e.position.x - a.lastX, e.position.z - a.lastZ);
      a.lastX = e.position.x;
      a.lastZ = e.position.z;
      if (step < 1) a.stride += step;
      if (a.stride > 0.85 && (e.body?.grounded ?? true)) {
        a.stride = 0;
        ctx.vfx.burst('dust', e.position, { count: 3, radius: 0.25, speed: 0.5 });
        ctx.audio.play('bend_stone_block', { position: e.position, volume: e === ctx.player ? 0.26 : 0.14, pitch: 0.5 + Math.random() * 0.1 });
      }
    }
    // Player: pressing Rock Armor again while armored bursts the plates outward.
    const p = ctx.player;
    if (p && armors.has(p.id) && p.element === 'earth') {
      const i = ctx.progression.slotsFor('earth').indexOf('rock_armor');
      const action = i >= 0 ? (['ability1', 'ability2', 'ability3', 'ability4'] as Action[])[i] : null;
      if (action && ctx.input.wasPressed(action)) {
        ctx.input.consume(action);
        anim(p, 'earth_slam', { speed: 1.6, fadeIn: 0.04 });
        endArmor(ctx, armors.get(p.id)!, 'burst');
      }
    }
  },
  sessionEnd: (ctx) => {
    for (const a of [...armors.values()]) endArmor(ctx, a, 'silent');
    for (const g of guards.values()) {
      g.cast.caster.guarding = false;
      g.plates?.dispose();
    }
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
    // Stone cuffs and knuckles snap up onto the forearms (the same stone as Rock Armor).
    const plates = c.humanoid ? new RockArmorVisual(ctx, c.humanoid, tint, { parts: GUARD_PARTS, speed: 6, fromGround: false }) : null;
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
      g.plates?.crumble();
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
  description: 'Stamp, and slabs tear out of the ground and clamp onto you from your boots to your helmet. Blows lose half their force, nothing staggers you, impacts barely move you and your stone fists hit harder — but you move slower, and every blow cracks the stone until it gives way. Burst it outward when you are done.',
  usage: `Lasts ${ARMOR_TIME} s or until the stone has soaked up ${ARMOR_INTEGRITY} damage (blows crack it and knock plates off): 50% damage reduction, stagger and knockback immunity, earth basic attacks +25%, slower movement. Press the technique key again to blast the plates outward (they hit and repel enemies within 4 m).`,
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
    cast.ctx.world.fx.crack(c.position, 1.3);
    cast.ctx.audio.play('bend_earth_rise', { position: c.position, volume: 0.8, pitch: 1.2 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const old = armors.get(c.id);
    if (old) endArmor(ctx, old, 'silent');
    const tint = tintAt(ctx, c.position);
    // Slabs torn out of the ground fly up and clamp on, boots first, helmet last.
    const plates = c.humanoid ? new RockArmorVisual(ctx, c.humanoid, tint) : null;
    const hadSlow = !!c.hasStatus('slow');
    c.addStatus('armor', ARMOR_TIME, 1, c.id);
    if (!hadSlow) c.addStatus('slow', ARMOR_TIME, 1, c.id);
    const maxPoise = c.health?.maxPoise ?? 30;
    if (c.health) {
      c.health.maxPoise = 9999;
      c.health.poise = 9999;
    }
    armors.set(c.id, {
      entity: c,
      cast,
      until: ctx.time.elapsed + ARMOR_TIME,
      plates,
      maxPoise,
      addedSlow: !hadSlow,
      tint,
      absorbed: 0,
      nextBreak: BREAK_STEP,
      lastX: c.position.x,
      lastZ: c.position.z,
      stride: 0,
    });
    ctx.vfx.ring(c.position.clone().setY(c.position.y + 0.1), '#c8b088', 3, 0.35, { opacity: 0.6 });
    ctx.audio.play('bend_earth_slam', { position: c.position, volume: 0.6, pitch: 1.4 });
    shake(ctx, c.position, 0.15, 0.2);
  },
  aiScore: (c, _t, dist) => (dist < 8 && !c.hasStatus('armor') ? 0.3 : 0),
});

/** Tests / UI: is this entity wearing rock armor or guarding (and how much stone is left)? */
export function earthDefenseState(e: Entity): { armor: boolean; guard: boolean; integrity: number; plates: number; assembled: boolean } {
  const a = armors.get(e.id);
  return {
    armor: !!a,
    guard: guards.has(e.id),
    integrity: a ? Math.max(0, 1 - a.absorbed / ARMOR_INTEGRITY) : 0,
    plates: a?.plates?.attached ?? 0,
    assembled: a?.plates?.assembled ?? false,
  };
}
