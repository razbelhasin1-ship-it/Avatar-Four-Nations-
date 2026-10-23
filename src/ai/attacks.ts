import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { ElementOrAvatar } from '../core/types';
import type { Cast, Combatant, Projectile, ProjectileVisual, TechniqueDef } from '../combat/types';
import type { Entity } from '../entities/Entity';

/**
 * Non-bending enemy attacks: spear lunges, cutlass/club combos, dao flurries,
 * arrows, lobbed powder bombs and beast swipes/charges/roars.
 *
 * They are NOT registered in the technique catalogue (the player can never
 * learn them and the technique library stays clean). The enemy runtime plays
 * a readable tell, then executes them through `ctx.combat.detachedCast(...)`,
 * so every point of damage still flows through CombatSystem (per-cast dedup,
 * `hit` / `player:damaged` / `entity:killed` events, hit feedback) and arrows
 * are real CombatSystem projectiles (`cast.projectile` → spawnProjectile) that
 * Air Shield / Wind Redirection / Water Shield can deflect or block.
 */

export interface AiAttackRuntime {
  readonly ctx: GameContext;
  readonly caster: Combatant;
  readonly cast: Cast;
  readonly target: Entity | null;
  /** Locked attack direction (horizontal, normalized). */
  readonly dir: THREE.Vector3;
  /** Index within the burst (alternating arms etc.). */
  readonly step: number;
  /** Seconds since the attack became active. */
  t: number;
  data: Record<string, any>;
}

export interface AiAttackDef {
  /** TechniqueDef-shaped descriptor used for the detached cast (element, name, range, ids in hit events). */
  def: TechniqueDef;
  /** Seconds the attack stays active after the tell (tick() may end it early). */
  active: number;
  /** Committed seconds after the active phase. */
  recovery: number;
  /** Own cooldown (s) on top of the archetype's AI cooldown. */
  cooldown: number;
  /** Root the attacker during the tell/active phase. */
  root: boolean;
  /** Humanoid tell clip (looped / held while telegraphing). */
  tellClip?: string;
  /** Beast pose during the tell / active phase. */
  beastTell?: 'tell_swipe' | 'tell_charge' | 'tell_roar';
  beastActive?: 'swipe' | 'charge' | 'roar';
  start(r: AiAttackRuntime): void;
  /** Return false to end the active phase early. */
  tick?(r: AiAttackRuntime, dt: number): boolean;
}

function techDef(id: string, name: string, element: ElementOrAvatar, range: number): TechniqueDef {
  return {
    id,
    name,
    element,
    kind: 'basic',
    tier: 1,
    description: name,
    usage: '',
    icon: '⚔️',
    chiCost: 0,
    cooldown: 0,
    windup: 0,
    recovery: 0,
    movement: 'root',
    airborne: false,
    interruptible: true,
    range,
    release() {},
  };
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function play(r: AiAttackRuntime, clip: string, speed = 1): void {
  r.caster.humanoid?.animator.play(clip, { speed, fadeIn: 0.05 });
}

/** Melee arc in front of the attacker (deduplicated per detached cast). */
function meleeArc(r: AiAttackRuntime, reach: number, radius: number, o: { damage: number; knockback: number; stagger: number; launch?: number; knockdown?: boolean; halfAngle?: number }): Entity[] {
  const c = r.caster;
  const center = c.castOrigin('chest', tmp).addScaledVector(r.dir, reach);
  return r.cast.areaHit({
    center,
    radius,
    height: 1.4,
    cone: o.halfAngle ? { dir: r.dir, halfAngle: o.halfAngle } : undefined,
    damage: o.damage,
    knockback: o.knockback,
    knockDir: r.dir.clone(),
    stagger: o.stagger,
    launch: o.launch,
    knockdown: o.knockdown,
  });
}

// -----------------------------------------------------------------------------
// Shared projectile visuals (lazily created; released at session end)
// -----------------------------------------------------------------------------

let arrowGeo: THREE.BufferGeometry | null = null;
let arrowHeadGeo: THREE.BufferGeometry | null = null;
let arrowMat: THREE.MeshStandardMaterial | null = null;
let arrowHeadMat: THREE.MeshStandardMaterial | null = null;
let bombGeo: THREE.BufferGeometry | null = null;
let bombMat: THREE.MeshStandardMaterial | null = null;

export function disposeAttackResources(): void {
  for (const g of [arrowGeo, arrowHeadGeo, bombGeo]) g?.dispose();
  for (const m of [arrowMat, arrowHeadMat, bombMat]) m?.dispose();
  arrowGeo = arrowHeadGeo = bombGeo = null;
  arrowMat = arrowHeadMat = bombMat = null;
}

function arrowVisual(): ProjectileVisual {
  arrowGeo ??= new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4).rotateX(Math.PI / 2);
  arrowHeadGeo ??= new THREE.ConeGeometry(0.03, 0.1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.44);
  arrowMat ??= new THREE.MeshStandardMaterial({ color: '#6a4a2a', roughness: 0.8 });
  arrowHeadMat ??= new THREE.MeshStandardMaterial({ color: '#c0c4cc', roughness: 0.3, metalness: 0.8 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(arrowGeo, arrowMat), new THREE.Mesh(arrowHeadGeo, arrowHeadMat));
  return {
    object: g,
    update(p) {
      tmp2.copy(p.position).add(p.velocity);
      g.lookAt(tmp2);
    },
    dispose() {
      g.clear();
    },
  };
}

function bombVisual(ctx: GameContext): ProjectileVisual {
  bombGeo ??= new THREE.SphereGeometry(0.17, 10, 8);
  bombMat ??= new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6, metalness: 0.3 });
  const m = new THREE.Mesh(bombGeo, bombMat);
  let spark = 0;
  return {
    object: m,
    update(p, dt) {
      m.rotation.x += dt * 6;
      spark -= dt;
      if (spark <= 0) {
        spark = 0.06;
        ctx.vfx.burst('sparks', p.position, { count: 2, speed: 1.5, color: '#ffc060' });
      }
    },
    dispose() {},
  };
}

function detonate(ctx: GameContext, p: Projectile, at: THREE.Vector3): void {
  if (p.cast.data.__boom) return;
  p.cast.data.__boom = true;
  const center = at.clone();
  center.y = Math.max(center.y, ctx.world.groundAt(center.x, center.z, center.y + 2).y + 0.4);
  ctx.vfx.flash(center, '#ffb050', 8, 0.3);
  ctx.vfx.burst('fire', center, { count: 18, speed: 5 });
  ctx.vfx.burst('smoke', center, { count: 10, size: 1.2 });
  ctx.vfx.ring(center.clone().setY(center.y - 0.3), '#ffa040', 3.2, 0.4);
  ctx.audio.play('fire.explosion', { position: center, volume: 0.9 });
  ctx.world.fx.scorch(center, 1.6);
  const pl = ctx.player;
  if (pl && pl.position.distanceTo(center) < 14) ctx.events.emit('camera:shake', { intensity: 0.3, duration: 0.3 });
  p.cast.areaHit({ center, radius: 3.2, height: 2.4, damage: 14, knockback: 9, knockDir: 'radial', launch: 3, stagger: 30, status: [{ type: 'burn', duration: 2, magnitude: 0.6 }] });
}

// -----------------------------------------------------------------------------
// Attack catalogue
// -----------------------------------------------------------------------------

export const AI_ATTACKS: Record<string, AiAttackDef> = {
  atk_spear_lunge: {
    def: techDef('atk_spear_lunge', 'Spear Lunge', 'earth', 3.4),
    active: 0.3,
    recovery: 0.35,
    cooldown: 0.2,
    root: true,
    tellClip: 'charge_hold',
    start(r) {
      play(r, 'strike_r', 1.25);
      r.caster.body?.impulse(r.dir.x * 6.5, 0, r.dir.z * 6.5);
      r.ctx.audio.play('air.whoosh', { position: r.caster.position, volume: 0.5, pitch: 1.3 });
    },
    tick(r) {
      if (r.t >= 0.12 && !r.data.hit) {
        r.data.hit = true;
        meleeArc(r, 1.7, 1.5, { damage: 9, knockback: 5, stagger: 18, halfAngle: 0.8 });
      }
      return true;
    },
  },
  atk_club_combo: {
    def: techDef('atk_club_combo', 'Cutlass Slash', 'earth', 2.6),
    active: 0.26,
    recovery: 0.28,
    cooldown: 0,
    root: false,
    tellClip: 'block_cross',
    start(r) {
      play(r, r.step % 2 ? 'whip_l' : 'whip_r', 1.4);
      r.caster.body?.impulse(r.dir.x * 3.5, 0, r.dir.z * 3.5);
      r.ctx.audio.play('air.whoosh', { position: r.caster.position, volume: 0.45, pitch: 1.5 });
    },
    tick(r) {
      if (r.t >= 0.13 && !r.data.hit) {
        r.data.hit = true;
        meleeArc(r, 1.2, 1.35, { damage: 7, knockback: 3.5, stagger: 12, halfAngle: 1.1 });
      }
      return true;
    },
  },
  atk_staff: {
    def: techDef('atk_staff', 'Desperate Strike', 'water', 2.6),
    active: 0.26,
    recovery: 0.3,
    cooldown: 0,
    root: false,
    tellClip: 'block_cross',
    start(r) {
      play(r, r.step % 2 ? 'strike_l' : 'strike_r', 1.2);
      r.caster.body?.impulse(r.dir.x * 3, 0, r.dir.z * 3);
    },
    tick(r) {
      if (r.t >= 0.14 && !r.data.hit) {
        r.data.hit = true;
        meleeArc(r, 1.1, 1.3, { damage: 5, knockback: 3, stagger: 10, halfAngle: 1 });
      }
      return true;
    },
  },
  atk_dao_flurry: {
    def: techDef('atk_dao_flurry', 'Twin Dao Flurry', 'earth', 3),
    active: 0.24,
    recovery: 0.22,
    cooldown: 0,
    root: false,
    tellClip: 'block_cross',
    start(r) {
      play(r, r.step % 2 ? 'whip_l' : 'whip_r', 1.6);
      r.caster.body?.impulse(r.dir.x * 4.5, 0, r.dir.z * 4.5);
      r.ctx.audio.play('air.whoosh', { position: r.caster.position, volume: 0.5, pitch: 1.7 });
    },
    tick(r) {
      if (r.t >= 0.12 && !r.data.hit) {
        r.data.hit = true;
        meleeArc(r, 1.4, 1.6, { damage: 8, knockback: 4, stagger: 15, halfAngle: 1.1 });
      }
      return true;
    },
  },
  atk_arrow: {
    def: techDef('atk_arrow', 'Arrow', 'air', 40),
    active: 0.1,
    recovery: 0.45,
    cooldown: 0.4,
    root: true,
    tellClip: 'charge_hold',
    start(r) {
      play(r, 'release_forward', 1.2);
      const c = r.caster;
      const from = c.castOrigin('handL', new THREE.Vector3());
      const speed = 40;
      const aim = new THREE.Vector3();
      if (r.target) {
        r.target.aimPoint(aim);
        // Lead the target a little (archers are good, not perfect).
        const d = aim.distanceTo(from);
        const tv = r.target.body?.velocity;
        if (tv) aim.addScaledVector(tmp.set(tv.x, 0, tv.z), (d / speed) * 0.7);
        aim.y += (0.5 * 5 * d * d) / (speed * speed); // gravity compensation (g = 5)
      } else aim.copy(from).addScaledVector(r.dir, 30);
      const vel = aim.sub(from).normalize().multiplyScalar(speed);
      r.cast.projectile({
        position: from,
        velocity: vel,
        radius: 0.14,
        gravity: 5,
        life: 2.4,
        damage: 8,
        knockback: 2,
        stagger: 8,
        visual: arrowVisual(),
        onHitWorld: (p, pt) => r.ctx.vfx.burst('dust', pt, { count: 4, speed: 1 }),
      });
      r.ctx.audio.play('air.whoosh', { position: from, volume: 0.6, pitch: 2 });
    },
  },
  atk_bomb: {
    def: techDef('atk_bomb', 'Powder Bomb', 'fire', 22),
    active: 0.1,
    recovery: 0.5,
    cooldown: 0.5,
    root: true,
    tellClip: 'charge_hold',
    start(r) {
      play(r, 'push_two', 1.1);
      const ctx = r.ctx;
      const from = r.caster.castOrigin('handR', new THREE.Vector3());
      const to = new THREE.Vector3();
      if (r.target) to.copy(r.target.position);
      else to.copy(from).addScaledVector(r.dir, 12);
      const g = 16;
      const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
      const T = Math.max(0.6, Math.min(1.3, Math.hypot(dx, dz) / 14));
      const vel = new THREE.Vector3(dx / T, (dy + 0.5 * g * T * T) / T, dz / T);
      r.cast.projectile({
        position: from,
        velocity: vel,
        radius: 0.2,
        gravity: g,
        life: T + 0.6,
        damage: 0,
        visual: bombVisual(ctx),
        onHitEntity: (p) => detonate(ctx, p, p.position),
        onHitWorld: (p, pt) => detonate(ctx, p, pt),
        onExpire: (p) => detonate(ctx, p, p.position),
      });
    },
  },
  atk_beast_swipe: {
    def: techDef('atk_beast_swipe', 'Claw Swipe', 'earth', 3.6),
    active: 0.3,
    recovery: 0.4,
    cooldown: 0.3,
    root: true,
    beastTell: 'tell_swipe',
    beastActive: 'swipe',
    start(r) {
      r.caster.body?.impulse(r.dir.x * 4, 0, r.dir.z * 4);
      r.ctx.audio.play('creature.polarbeardog.growl', { position: r.caster.position, volume: 0.6, pitch: 0.8 });
    },
    tick(r) {
      if (r.t >= 0.14 && !r.data.hit) {
        r.data.hit = true;
        meleeArc(r, 1.7, 1.9, { damage: 12, knockback: 8, stagger: 26, halfAngle: 1.1 });
      }
      return true;
    },
  },
  atk_beast_charge: {
    def: techDef('atk_beast_charge', 'Charge', 'earth', 18),
    active: 1.3,
    recovery: 0.7,
    cooldown: 0.5,
    root: false,
    beastTell: 'tell_charge',
    beastActive: 'charge',
    start(r) {
      r.ctx.audio.play('creature.polarbeardog.growl', { position: r.caster.position, volume: 0.9, pitch: 0.6 });
      r.data.speed = 12.5;
    },
    tick(r, dt) {
      const c = r.caster;
      const b = c.body;
      if (!b) return false;
      // Slight homing so a sidestep late in the tell still dodges it.
      if (r.target && r.t < 0.5) {
        tmp.copy(r.target.position).sub(c.position).setY(0);
        if (tmp.lengthSq() > 1) {
          tmp.normalize();
          const cross = r.dir.x * tmp.z - r.dir.z * tmp.x;
          const turn = Math.max(-0.9 * dt, Math.min(0.9 * dt, Math.asin(Math.max(-1, Math.min(1, cross)))));
          const ca = Math.cos(-turn), sa = Math.sin(-turn);
          const nx = r.dir.x * ca - r.dir.z * sa, nz = r.dir.x * sa + r.dir.z * ca;
          r.dir.set(nx, 0, nz).normalize();
        }
      }
      // Stop at cliffs, deep water and walls.
      const ahead = tmp2.copy(c.position).addScaledVector(r.dir, 2);
      const g = r.ctx.world.groundAt(ahead.x, ahead.z, c.position.y + 1.5);
      if (g.y < c.position.y - 2 || g.y > c.position.y + 1.2) return false;
      if (r.ctx.world.collision.raycast(tmp.copy(c.position).setY(c.position.y + 0.6), r.dir, 1.6)) return false;
      b.move.set(r.dir.x * r.data.speed, 0, r.dir.z * r.data.speed);
      c.yaw = Math.atan2(r.dir.x, r.dir.z);
      if (Math.random() < dt * 14) r.ctx.vfx.burst('dust', c.position, { count: 2, speed: 1.2 });
      const hits = meleeArc(r, 1.1, 1.6, { damage: 15, knockback: 11, stagger: 40, launch: 4, knockdown: true });
      if (hits.length) {
        r.ctx.events.emit('camera:shake', { intensity: 0.35, duration: 0.3 });
        return false;
      }
      return true;
    },
  },
  atk_beast_roar: {
    def: techDef('atk_beast_roar', 'Terrifying Roar', 'earth', 9),
    active: 0.6,
    recovery: 0.4,
    cooldown: 1,
    root: true,
    beastTell: 'tell_roar',
    beastActive: 'roar',
    start(r) {
      const ctx = r.ctx;
      const c = r.caster;
      ctx.audio.play('creature.dragon.roar', { position: c.position, volume: 0.9, pitch: 1.4 });
      ctx.vfx.ring(c.position.clone().setY(c.position.y + 0.2), '#d8c8a0', 8, 0.5);
      ctx.vfx.burst('dust', c.position, { count: 14, speed: 4 });
      const pl = ctx.player;
      if (pl && pl.position.distanceTo(c.position) < 16) ctx.events.emit('camera:shake', { intensity: 0.4, duration: 0.5 });
      r.cast.areaHit({ center: c.position.clone().setY(c.position.y + 1), radius: 7.5, height: 3, damage: 3, knockback: 5, knockDir: 'radial', stun: 0.8, stagger: 30 });
    },
  },
};

export function aiAttack(id: string): AiAttackDef | undefined {
  return AI_ATTACKS[id];
}
