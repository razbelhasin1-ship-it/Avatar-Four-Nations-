import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import type { GameContext } from '../../../core/GameContext';
import type { GameEvents } from '../../../core/events';
import { FireWheel, flameArc, steam } from '../../../vfx/effects/fire';
import { debris } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import type { Cast, Projectile } from '../../types';
import { bending } from '../bending/runtime';
import { aimFlat, anim, hitSphere, push, shake, stopAnim } from '../bending/util';
import { fireOnEntity, heat } from './common';

/**
 * Fire Shield (defense): both palms thrust out and a wheel of fire spins up in front of the
 * bender. While it is held it burns hostile projectiles out of the air in front of it, absorbs
 * most of any blow (guarding) and scorches anyone who closes in. A blow caught in the first
 * 0.3 s is a perfect block: the wheel bursts outward in a blast of flame that throws the
 * attacker back, and the shield is spent.
 */

const tmp = new THREE.Vector3();
const scratch: Projectile[] = [];

interface ShieldState {
  cast: Cast;
  wheel: FireWheel;
  loop: LoopHandle;
  perfectUntil: number;
  ticks: Map<number, number>;
  burned: number;
  burst: boolean;
}

const shields = new Map<number, ShieldState>();

/** Chest-height centre of the wheel, a little in front of the bender. */
function wheelCenter(cast: Cast, dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return cast.caster.castOrigin('chest', out).addScaledVector(dir, 0.85);
}

/** A projectile meets the wheel: water hisses into steam, everything else is burned away. */
function burnAway(ctx: GameContext, p: Projectile): void {
  const at = p.position.clone();
  const el = p.cast.def.element;
  p.kill();
  if (el === 'water') {
    steam(ctx, at, 0.9);
    return;
  }
  ctx.vfx.burst('fire', at, { count: 8, speed: 2.2, size: 0.8 });
  ctx.vfx.flash(at, '#ffa040', 3, 0.12, 8);
  if (el === 'earth') debris(at, 5, { spread: 1.2, speed: 4, size: 0.1, color: '#6a5a4a', life: 0.9 });
  ctx.audio.play('bend_fire_puff', { position: at, volume: 0.8 });
}

/** Perfect block: the wheel bursts outward in a blast of flame. */
function burst(s: ShieldState): void {
  const cast = s.cast;
  const ctx = cast.ctx;
  const c = cast.caster;
  const dir = aimFlat(cast, new THREE.Vector3());
  const center = wheelCenter(cast, dir, new THREE.Vector3());
  s.burst = true;
  flameArc(ctx, center.clone().setY(c.position.y + 0.15), dir, { r0: 0.8, r1: 4.2, arc: 2.2, height: 1.9, duration: 0.42 });
  ctx.vfx.burst('fireball', center, { count: 8, dir, spread: 0.5, speed: 4, size: 0.6 });
  ctx.vfx.flash(center, '#ffb050', 6, 0.2, 12);
  // allowRepeat: the wheel's scorch may already have touched this attacker during the cast.
  hitSphere(
    cast,
    center.clone().addScaledVector(dir, 1.6),
    2.4,
    2,
    (e, away) => {
      fireOnEntity(ctx, e, e.aimPoint(tmp), 1);
      return { damage: 14, knockback: push(away.lerp(dir, 0.5).normalize(), 14), launch: 2, stagger: 60, status: [{ type: 'burn', duration: 2.5 }] };
    },
    true,
  );
  heat(ctx, center.clone().addScaledVector(dir, 1.5), 3, 1.2, c.id);
  ctx.audio.play('bend_fire_whoosh', { position: center, volume: 1, pitch: 0.8 });
  shake(ctx, center, 0.22, 0.25);
}

function onHit(ctx: GameContext, e: GameEvents['hit']): void {
  const s = shields.get(e.targetId);
  if (!s || !e.blocked || s.burst) return;
  const at = new THREE.Vector3(e.position.x, e.position.y, e.position.z);
  const perfect = ctx.time.elapsed <= s.perfectUntil;
  s.wheel.pulse(perfect ? 1.4 : 0.6);
  if (perfect) {
    ctx.entities.get(e.targetId)?.health?.heal(e.damage);
    ctx.audio.play('bend_perfect_block', { position: at, volume: 0.9 });
    burst(s);
  } else {
    ctx.vfx.burst('flame', at, { count: 5, speed: 2 });
    ctx.audio.play('bend_fire_puff', { position: at, volume: 0.7 });
  }
  if (e.targetId === ctx.player?.id) ctx.events.emit('player:blocked', { attackerId: e.attackerId ?? 0, perfect });
}

bending.hook({
  init: (ctx) => ctx.events.on('hit', (e) => onHit(ctx, e)),
  sessionEnd: () => {
    for (const s of shields.values()) {
      s.cast.caster.guarding = false;
      s.wheel.dispose(0);
      s.loop.stop(0);
    }
    shields.clear();
  },
});

registerTechnique({
  id: 'fire_shield',
  name: 'Fire Shield',
  element: 'fire',
  kind: 'defense',
  tier: 2,
  description: 'Thrust both palms out and spin a roaring wheel of fire in front of you. It burns incoming attacks out of the air and scorches anyone who comes close. Catch a blow the moment it goes up and the wheel bursts outward in a blast of flame.',
  usage: 'Hold the technique key to keep the shield up (drains chi). It burns away projectiles in front of you, absorbs most of any blow and scorches attackers in reach. A hit in the first 0.3 s is a Perfect Block: no damage, and the shield bursts into a counter blast.',
  icon: 'fire',
  chiCost: 12,
  cooldown: 5,
  windup: 0.1,
  recovery: 0.25,
  movement: 'slow',
  airborne: false,
  interruptible: false,
  range: 3,
  channel: 3.5,
  begin(cast) {
    bending.channel(cast, 'hold', { min: 0.6, auto: 1.8 });
    anim(cast.caster, 'fire_shield_hold', { fadeIn: 0.08 });
    cast.ctx.vfx.burst('flame', cast.caster.castOrigin('hands', tmp), { count: 6, speed: 1.2 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    c.guarding = true;
    const s: ShieldState = {
      cast,
      wheel: new FireWheel(ctx, 1.3),
      loop: ctx.audio.loop('bend_flame_loop', { position: c.position, volume: 0.8 }),
      perfectUntil: ctx.time.elapsed + 0.3,
      ticks: new Map(),
      burned: 0,
      burst: false,
    };
    shields.set(c.id, s);
    cast.data.shield = s;
    ctx.audio.play('bend_fire_whoosh', { position: c.position, volume: 0.8, pitch: 1.1 });
  },
  channelUpdate(cast, dt) {
    const s = cast.data.shield as ShieldState | undefined;
    if (!s || s.burst) return false;
    if (!bending.channelKeep(cast, dt)) return false;
    const ctx = cast.ctx;
    const c = cast.caster;
    const drain = 5 * dt;
    if (c.chi < drain) return false;
    c.chi -= drain;
    c.guarding = true;
    const dir = aimFlat(cast, new THREE.Vector3());
    const center = wheelCenter(cast, dir, new THREE.Vector3());
    s.wheel.update(dt, center, dir);
    s.loop.setPosition(center);
    // Burn hostile projectiles out of the air in front of the wheel.
    const chest = c.castOrigin('chest', tmp);
    for (const p of [...ctx.combat.projectilesInRadius(center, 2.6, scratch)]) {
      if (!p.alive || p.cast.caster === c || !ctx.combat.canHarm(p.cast.caster, c)) continue;
      if ((p.position.x - chest.x) * dir.x + (p.position.z - chest.z) * dir.z < -0.2) continue;
      burnAway(ctx, p);
      s.burned++;
      s.wheel.pulse(0.5);
    }
    // Anyone pressing in is scorched and driven back.
    const now = ctx.time.elapsed;
    hitSphere(
      cast,
      center,
      1.5,
      1.9,
      (e, away) => {
        if ((s.ticks.get(e.id) ?? 0) > now) return null;
        s.ticks.set(e.id, now + 0.45);
        fireOnEntity(ctx, e, e.aimPoint(tmp), 0.5);
        return { damage: 4, knockback: push(away, 10), stagger: 22, status: [{ type: 'burn', duration: 1.5 }] };
      },
      true,
    );
    if (Math.random() < dt * 5) heat(ctx, center, 1.6, 0.6, c.id);
    return true;
  },
  end(cast) {
    const c = cast.caster;
    const s = cast.data.shield as ShieldState | undefined;
    if (s) {
      if (shields.get(c.id) === s) shields.delete(c.id);
      s.wheel.dispose(s.burst ? 0.12 : 0.22);
      s.loop.stop(0.25);
      cast.data.shield = undefined;
    }
    c.guarding = false;
    stopAnim(c, 'fire_shield_hold', 0.2);
    if (s?.burst) anim(c, 'fire_push', { speed: 1.4, fadeIn: 0.04 });
  },
  aiScore: (_c, _t, dist) => (dist < 4 ? 0.3 : 0.05),
});
