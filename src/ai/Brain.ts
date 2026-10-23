import * as THREE from 'three';
import { getTechnique } from '../combat/CombatSystem';
import type { Combatant, Projectile } from '../combat/types';
import type { GameContext } from '../core/GameContext';
import type { EnemyTechnique } from '../data/enemies';
import type { Entity, HitInfo, HitResult } from '../entities/Entity';
import { aiAttack } from './attacks';
import type { Enemy } from './Enemy';

/**
 * Enemy AI: a state machine (idle / patrol / ambush / investigate / combat /
 * retreat / flee / return / seekWater) with utility scoring inside combat.
 *
 * Perception (4 Hz, staggered): sight cone + line of sight via
 * world.hasLineOfSight, awareness that builds faster up close, hearing of the
 * player's noise (footsteps, sprinting, bending, impacts) published by the
 * encounter director. Decisions (~3 Hz): keep the archetype's preferred range,
 * approach / back off / strafe (positioning mode held for a few seconds so
 * nobody jitters), attack only while holding an attack token, pick
 * techniques by weight × range fit × cooldown/chi/water availability, react
 * to the player's committed windups and incoming projectiles with dodges or
 * guards, retreat once when hurt, flee when beaten, leash home when the
 * player escapes. Waterbenders only bend when real water is within reach —
 * otherwise they fight with their fists and go looking for a river or the sea.
 */

export type BrainState = 'idle' | 'patrol' | 'ambush' | 'investigate' | 'combat' | 'retreat' | 'flee' | 'return' | 'seekWater';

type PosMode = 'hold' | 'strafe' | 'press';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const projScratch: Projectile[] = [];

export class Brain {
  state: BrainState;
  stateT = 0;
  target: Entity | null = null;
  awareness = 0;
  readonly lastKnown = new THREE.Vector3();
  lastSeenT = -99;
  canSee = false;
  dist = Infinity;
  /** Crouched in hiding (ambushers). */
  hidden = false;
  /** Water within reach right now (waterbenders). */
  hasWater = true;
  private perceiveT = Math.random() * 0.25;
  private thinkT = Math.random() * 0.3;
  private lastThink = 0;
  private patrolIndex = 0;
  private idleT = 1 + Math.random() * 3;
  private readonly wander = new THREE.Vector3();
  private posMode: PosMode = 'hold';
  private posT = 0;
  private retreatUsed = false;
  private retreatDur = 3;
  private nextAttackT = 0;
  private readonly techCD = new Map<string, number>();
  private waterCheckT = 0;
  private waterSearchT = 0;
  private waterTarget: THREE.Vector3 | null = null;
  private reactT = 0;
  private readonly sparring: boolean;

  constructor(readonly e: Enemy, o: { ambush: boolean; sparring: boolean }) {
    this.sparring = o.sparring;
    this.state = o.ambush ? 'ambush' : 'idle';
    this.hidden = o.ambush;
  }

  setState(s: BrainState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    this.posT = 0;
  }

  update(dt: number, ctx: GameContext): void {
    this.stateT += dt;
    const now = ctx.time.elapsed;
    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = 0.22 + Math.random() * 0.06;
      this.perceive(ctx, 0.25);
    }
    if (this.state === 'return') this.e.health!.heal(this.e.health!.maxHp * 0.2 * dt);
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.26 + Math.random() * 0.12;
      const step = Math.min(1, now - this.lastThink);
      this.lastThink = now;
      this.think(ctx, step);
    }
    // Track the target smoothly between thinks.
    if (this.state === 'combat' && this.target && this.e.faceTarget) this.e.faceTarget = this.target.position;
  }

  // ---------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------

  private perceive(ctx: GameContext, step: number): void {
    const e = this.e;
    const p = ctx.player;
    const now = ctx.time.elapsed;
    const B = e.arch.behaviour;
    this.target = p && p.alive && !p.defeated && ctx.combat.canHarm(e, p) ? p : null;
    const t = this.target;
    if (!t) {
      this.canSee = false;
      this.dist = Infinity;
      this.awareness = Math.max(0, this.awareness - 0.3 * step);
      return;
    }
    const pos = e.position;
    const dx = t.position.x - pos.x, dz = t.position.z - pos.z;
    const dist = Math.hypot(dx, dz);
    this.dist = dist;
    const sight = B.sight * (this.hidden ? 0.6 : 1);
    let seen = false;
    if (dist < sight) {
      const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
      const cos = dist > 1e-3 ? (dx * fx + dz * fz) / dist : 1;
      const inCone = dist < 4 || this.state === 'combat' || this.sparring || Math.acos(Math.max(-1, Math.min(1, cos))) < (B.fov * Math.PI) / 360;
      if (inCone) {
        const eye = tmp.copy(pos).setY(pos.y + e.height * 0.9);
        seen = ctx.world.hasLineOfSight(eye, t.aimPoint(tmp2));
      }
    }
    this.canSee = seen;
    if (seen) {
      this.lastKnown.copy(t.position);
      this.lastSeenT = now;
      this.awareness = Math.min(1.5, this.awareness + (1.1 + 3.6 * (1 - dist / sight)) * step);
    } else if (this.state !== 'combat') this.awareness = Math.max(0, this.awareness - 0.1 * step);
    // Hearing.
    for (const n of e.host.noises()) {
      if (now - n.t > 1) continue;
      const r = n.radius * B.hearing;
      const d = Math.hypot(n.x - pos.x, n.z - pos.z);
      if (d > r) continue;
      if (this.state !== 'combat') this.lastKnown.set(n.x, n.y, n.z);
      this.awareness = Math.max(this.awareness, n.combat ? (d < r * 0.6 ? 1 : 0.75) : 0.5);
    }
  }

  // ---------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------

  private think(ctx: GameContext, step: number): void {
    const e = this.e;
    const B = e.arch.behaviour;
    const now = ctx.time.elapsed;
    const t = this.target;
    e.seekStop = this.state === 'combat' && t ? e.radius + t.radius + 0.3 : 0.35;
    if (this.sparring) {
      if (t) {
        if (this.state !== 'combat') this.enterCombat(ctx, false);
        this.lastSeenT = now;
        this.combat(ctx, step);
      } else {
        e.moveMode = 'stop';
        e.faceTarget = null;
      }
      return;
    }
    switch (this.state) {
      case 'ambush': {
        this.hidden = true;
        e.moveMode = 'stop';
        e.faceTarget = t && this.dist < 30 ? t.position : null;
        if (t && (this.dist < 13 || this.awareness >= 1)) this.enterCombat(ctx, true);
        break;
      }
      case 'idle':
      case 'patrol': {
        if (this.awareness >= 1) this.enterCombat(ctx, true);
        else if (this.awareness >= 0.4) {
          this.setState('investigate');
          e.alertT = now;
        } else this.idleOrPatrol(ctx, step);
        break;
      }
      case 'investigate': {
        e.moveMode = 'seek';
        e.moveGoal.copy(this.lastKnown);
        e.moveSpeed = e.arch.speed.walk * 1.6;
        e.faceTarget = null;
        if (this.awareness >= 1) this.enterCombat(ctx, true);
        else if (this.stateT > 12 || (this.stateT > 4 && e.position.distanceTo(this.lastKnown) < 2)) {
          e.moveMode = 'stop';
          if (this.stateT > 6 || this.stateT > 12) this.setState('return');
        }
        break;
      }
      case 'combat':
        this.combat(ctx, step);
        break;
      case 'retreat': {
        if (!t) {
          this.setState('return');
          break;
        }
        if (B.fleeAt > 0 && e.hpFraction <= B.fleeAt && e.rank !== 'boss') {
          this.setState('flee');
          break;
        }
        e.moveMode = 'flee';
        e.moveGoal.copy(t.position);
        e.moveSpeed = e.arch.speed.run;
        e.faceTarget = this.stateT > this.retreatDur * 0.6 ? t.position : null;
        if (this.stateT > this.retreatDur || this.dist > B.preferred + 14) this.setState('combat');
        break;
      }
      case 'flee': {
        e.moveMode = 'flee';
        if (t) e.moveGoal.copy(t.position);
        e.moveSpeed = e.arch.speed.run;
        e.faceTarget = null;
        if (this.stateT > 9 || this.dist > 42) e.vanish(ctx);
        break;
      }
      case 'return': {
        e.moveMode = 'seek';
        e.moveGoal.copy(e.home);
        e.moveSpeed = e.arch.speed.run * 0.8;
        e.faceTarget = null;
        if (e.position.distanceTo(e.home) < 2.5 || this.stateT > 30) {
          if (this.stateT > 30) e.recoverToHome(ctx);
          this.awareness = 0;
          e.health!.heal(e.health!.maxHp);
          this.retreatUsed = false;
          this.setState(e.patrol.length > 1 ? 'patrol' : 'idle');
          e.moveMode = 'stop';
        }
        break;
      }
      case 'seekWater': {
        const w = this.waterTarget;
        if (!w || !t) {
          this.setState('combat');
          break;
        }
        e.moveMode = 'seek';
        e.moveGoal.copy(w);
        e.moveSpeed = e.arch.speed.run;
        e.faceTarget = null;
        const d = Math.hypot(w.x - e.position.x, w.z - e.position.z);
        if (d < 13) {
          const dir = tmp.copy(w).sub(e.position).setY(0).normalize();
          const got = ctx.water.drawToReserve(e, 24, dir);
          if (got) {
            ctx.vfx.burst('splash', got.point, { count: 10, speed: 2 });
            ctx.vfx.burst('mist', e.castOrigin('hands', tmp2), { count: 6, speed: 0.6 });
            e.humanoid?.animator.play('lift_up', { fadeIn: 0.1, speed: 1.4 });
            this.hasWater = true;
            this.waterCheckT = now + 1.5;
            this.setState('combat');
          } else if (this.stateT > 4) this.setState('combat');
        } else if (this.stateT > 12) this.setState('combat');
        // Do not wander off the leash looking for water.
        if (e.position.distanceTo(e.home) > e.leash) this.setState('combat');
        break;
      }
    }
  }

  private idleOrPatrol(ctx: GameContext, step: number): void {
    const e = this.e;
    e.faceTarget = null;
    if (e.patrol.length > 1) {
      this.state = 'patrol';
      if (this.idleT > 0) {
        this.idleT -= step;
        e.moveMode = 'stop';
        return;
      }
      const wp = e.patrol[this.patrolIndex % e.patrol.length];
      if (Math.hypot(wp.x - e.position.x, wp.z - e.position.z) < 1.4) {
        this.patrolIndex++;
        this.idleT = 1 + Math.random() * 2.5;
        e.moveMode = 'stop';
        return;
      }
      e.moveMode = 'seek';
      e.moveGoal.copy(wp);
      e.moveSpeed = e.arch.speed.walk;
      return;
    }
    this.state = 'idle';
    this.idleT -= step;
    if (this.idleT <= 0) {
      this.idleT = 4 + Math.random() * 6;
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 4;
      this.wander.set(e.home.x + Math.cos(a) * r, e.home.y, e.home.z + Math.sin(a) * r);
      e.moveMode = 'seek';
      e.moveGoal.copy(this.wander);
      e.moveSpeed = e.arch.speed.walk * 0.8;
    } else if (e.moveMode === 'seek' && e.position.distanceTo(e.moveGoal) < 0.8) e.moveMode = 'stop';
    void ctx;
  }

  enterCombat(ctx: GameContext, shout: boolean): void {
    if (this.state === 'combat') return;
    const e = this.e;
    const now = ctx.time.elapsed;
    this.setState('combat');
    this.hidden = false;
    this.awareness = Math.max(this.awareness, 1.2);
    e.alertT = now;
    this.nextAttackT = now + 0.5 + Math.random() * 0.9;
    if (this.target) this.lastKnown.copy(this.target.position);
    if (shout && e.arch.behaviour.callAllies) {
      e.host.alertAllies(e, this.lastKnown);
      ctx.audio.play('voice.effort', { position: e.position, volume: 0.6, pitch: 0.75 });
    }
    if (shout && e.beast) ctx.audio.play('creature.polarbeardog.growl', { position: e.position, volume: 0.7, pitch: 0.7 });
  }

  /** Called by the director when an ally spots the player. */
  hearAlly(ctx: GameContext, at: THREE.Vector3): void {
    if (this.state === 'combat' || this.state === 'flee' || this.e.defeated) return;
    this.lastKnown.copy(at);
    this.awareness = 1.2;
    this.enterCombat(ctx, false);
  }

  private combat(ctx: GameContext, step: number): void {
    const e = this.e;
    const B = e.arch.behaviour;
    const now = ctx.time.elapsed;
    const t = this.target;
    if (!t) {
      this.setState('return');
      return;
    }
    const d = this.dist;
    if (!this.sparring) {
      const homeD = Math.hypot(e.position.x - e.home.x, e.position.z - e.home.z);
      if ((homeD > e.leash && d > 6) || now - this.lastSeenT > 9 || d > 80) {
        e.cancelAttack(ctx);
        this.setState('return');
        return;
      }
      const frac = e.hpFraction;
      if (e.rank !== 'boss') {
        if (B.fleeAt > 0 && frac <= B.fleeAt) {
          e.cancelAttack(ctx);
          this.setState('flee');
          return;
        }
        if (B.retreatAt > 0 && frac <= B.retreatAt && !this.retreatUsed) {
          this.retreatUsed = true;
          this.retreatDur = 2.2 + Math.random() * 1.6;
          e.cancelAttack(ctx);
          if (B.callAllies) e.host.alertAllies(e, t.position);
          this.setState('retreat');
          return;
        }
      }
    }
    // Water availability (waterbenders): real water within reach, or reserve.
    if (e.arch.element === 'water' && now >= this.waterCheckT) {
      this.waterCheckT = now + 0.6;
      this.hasWater = ctx.water.availableFor(e, { amount: 4 }) >= 4 - 1e-3;
    }
    // Defensive reactions to readable attacks.
    if (!e.attack && now >= this.reactT) {
      const threat = this.threat(ctx, t, d);
      if (threat) {
        this.reactT = now + 1.1;
        const r = Math.random();
        if (r < B.dodge) {
          if (Math.random() < 0.5) threat.multiplyScalar(-1);
          if (e.dodge(ctx, threat)) return;
        } else if (r < B.dodge + B.block) {
          const wall = e.techniques.find((x) => x.defensive && (this.techCD.get(x.id) ?? 0) <= now && ctx.combat.cooldownLeft(e, x.id) <= 0 && e.chi >= (getTechnique(x.id)?.chiCost ?? 0));
          if (wall && d > 5 && e.beginAttack(ctx, wall, t)) {
            this.techCD.set(wall.id, now + (wall.cooldown ?? 3));
            return;
          }
          e.guard(0.6 + Math.random() * 0.5);
          return;
        }
      }
    }
    if (e.attack) {
      e.moveMode = 'stop';
      e.faceTarget = t.position;
      return;
    }
    const token = e.attackToken || this.sparring;
    // Attack?
    if (token && now >= this.nextAttackT && this.canSee && Math.random() < 0.55 + B.aggression * 0.45) {
      const tech = this.pickTechnique(ctx, t, d);
      if (tech) {
        const max = this.maxRange(tech);
        const min = tech.min ?? 0;
        // Melee attacks lunge, so they may start a little beyond their reach.
        const melee = max <= 4.5;
        const reach = melee ? max + 0.6 : max;
        if (d >= min && d <= reach) {
          if (e.beginAttack(ctx, tech, t)) {
            e.moveMode = 'stop';
            e.faceTarget = t.position;
            return;
          }
        } else {
          e.moveMode = d > reach ? 'seek' : 'flee';
          e.moveGoal.copy(t.position);
          // Close the gap at a run (a walking target would otherwise outpace a melee chaser).
          e.moveSpeed = d > reach && (melee || d > max + 1.5) ? e.arch.speed.run : e.arch.speed.walk * 1.7;
          e.faceTarget = d < 14 ? t.position : null;
          return;
        }
      }
    }
    // Waterbender with no water anywhere near: go find some (unless the fight is in its face).
    if (e.arch.element === 'water' && !this.hasWater && d > 3.5 && this.findWater(ctx)) {
      this.setState('seekWater');
      return;
    }
    // Positioning (mode held for a while so it never jitters).
    this.posT -= step;
    if (this.posT <= 0) {
      this.posT = 1.6 + Math.random() * 1.8;
      const r = Math.random();
      this.posMode = r < B.strafe ? 'strafe' : r < B.strafe + B.aggression * 0.4 ? 'press' : 'hold';
      if (Math.random() < 0.5) e.strafeSign = -e.strafeSign;
    }
    const preferred = this.preferredRange(ctx);
    const ring = token ? preferred : Math.max(preferred, 5) + 2.5;
    e.faceTarget = t.position;
    if (d > ring + 2.5) {
      e.moveMode = 'seek';
      e.moveGoal.copy(t.position);
      e.moveSpeed = d > ring + 3.5 ? e.arch.speed.run : e.arch.speed.walk * 1.6;
      if (d > 14) e.faceTarget = null;
    } else if (d < B.minRange) {
      e.moveMode = 'flee';
      e.moveGoal.copy(t.position);
      e.moveSpeed = e.arch.speed.walk * 1.4;
    } else if (this.posMode === 'strafe') {
      e.moveMode = 'strafe';
      e.moveGoal.copy(t.position);
      e.strafeRange = ring;
      e.moveSpeed = e.arch.speed.walk * 1.15;
    } else if (this.posMode === 'press' && d > ring) {
      e.moveMode = 'seek';
      e.moveGoal.copy(t.position);
      e.moveSpeed = e.arch.speed.walk;
    } else e.moveMode = 'stop';
  }

  /** Waterbenders without water fall back to melee range. */
  private preferredRange(_ctx: GameContext): number {
    const e = this.e;
    if (e.arch.element === 'water' && !this.hasWater) return 2;
    return e.arch.behaviour.preferred;
  }

  private maxRange(t: EnemyTechnique): number {
    return t.max ?? getTechnique(t.id)?.range ?? aiAttack(t.id)?.def.range ?? 10;
  }

  private pickTechnique(ctx: GameContext, target: Entity, d: number): EnemyTechnique | null {
    const e = this.e;
    const now = ctx.time.elapsed;
    const noWater = e.arch.element === 'water' && !this.hasWater;
    let best: EnemyTechnique | null = null;
    let bestS = 0;
    for (const t of e.techniques) {
      if (t.defensive) continue;
      const isAi = t.id.startsWith('atk_');
      if (t.weight <= 0 && !(noWater && isAi)) continue;
      if ((this.techCD.get(t.id) ?? 0) > now) continue;
      if (!isAi) {
        const def = getTechnique(t.id);
        if (!def) continue;
        if (def.water && noWater) continue;
        if (ctx.combat.cooldownLeft(e, t.id) > 0) continue;
        if (e.chi < def.chiCost) continue;
      }
      const max = this.maxRange(t);
      const min = t.min ?? 0;
      const fit = d >= min && d <= max ? 1 : d > max ? 0.35 : 0.12;
      const s = (t.weight > 0 ? t.weight : 1) * fit * (0.6 + Math.random() * 0.8);
      if (s > bestS) {
        bestS = s;
        best = t;
      }
    }
    void target;
    return best;
  }

  /** A readable incoming attack: returns a sideways dodge direction, or null. */
  private threat(ctx: GameContext, t: Entity, d: number): THREE.Vector3 | null {
    const e = this.e;
    const pos = e.position;
    const c = t as unknown as Combatant;
    if (typeof (c as Partial<Combatant>).castOrigin === 'function') {
      const pc = ctx.combat.activeCast(c);
      if (pc && (pc.phase === 'windup' || pc.phase === 'channel') && d < (pc.def.range || 10) + 3) {
        tmp.set(pos.x - pc.origin.x, 0, pos.z - pc.origin.z);
        const len = tmp.length();
        const ax = pc.aimDir.x, az = pc.aimDir.z;
        const al = Math.hypot(ax, az);
        if (len > 1e-3 && al > 1e-3 && (tmp.x * ax + tmp.z * az) / (len * al) > 0.85) return new THREE.Vector3(-tmp.z / len, 0, tmp.x / len);
      }
    }
    for (const p of ctx.combat.projectilesInRadius(tmp.copy(pos).setY(pos.y + 1), 7, projScratch)) {
      if (p.cast.caster !== t) continue;
      const vx = p.velocity.x, vz = p.velocity.z;
      const rx = pos.x - p.position.x, rz = pos.z - p.position.z;
      const vl = Math.hypot(vx, vz), rl = Math.hypot(rx, rz);
      if (vl < 1 || rl < 1e-3) continue;
      if ((vx * rx + vz * rz) / (vl * rl) > 0.9) return new THREE.Vector3(-vz / vl, 0, vx / vl);
    }
    return null;
  }

  private findWater(ctx: GameContext): boolean {
    const now = ctx.time.elapsed;
    if (now < this.waterSearchT) return !!this.waterTarget;
    this.waterSearchT = now + 2;
    const hit = ctx.water.findBest(this.e.position, 60, { allowLiquid: true, allowIce: true });
    this.waterTarget = hit ? hit.point.clone() : null;
    return !!this.waterTarget;
  }

  // ---------------------------------------------------------------------------
  // Callbacks from the Enemy
  // ---------------------------------------------------------------------------

  onAttackFinished(ctx: GameContext, tech: EnemyTechnique, ok: boolean): void {
    const e = this.e;
    const now = ctx.time.elapsed;
    const B = e.arch.behaviour;
    const pace = (2.3 - B.aggression * 1.4) * e.tempoMul * (0.75 + Math.random() * 0.6);
    this.nextAttackT = now + (ok ? pace : 0.35);
    if (tech.cooldown) this.techCD.set(tech.id, now + tech.cooldown * e.tempoMul);
  }

  onNoWater(ctx: GameContext): void {
    this.hasWater = false;
    this.waterCheckT = ctx.time.elapsed + 1;
  }

  onDamaged(ctx: GameContext, hit: HitInfo, res: HitResult): void {
    const a = hit.attacker;
    if (!a || a.kind !== 'player') return;
    this.lastKnown.copy(a.position);
    this.lastSeenT = ctx.time.elapsed;
    this.awareness = 1.5;
    if (this.state === 'idle' || this.state === 'patrol' || this.state === 'investigate' || this.state === 'ambush' || this.state === 'return') this.enterCombat(ctx, true);
    void res;
  }
}
