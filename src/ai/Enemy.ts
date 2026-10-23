import * as THREE from 'three';
import type { Appearance } from '../character/Appearance';
import { Humanoid } from '../character/Humanoid';
import { getTechnique } from '../combat/CombatSystem';
import type { Combatant } from '../combat/types';
import type { GameContext } from '../core/GameContext';
import { angleDiff, damp, dampAngle } from '../core/MathUtil';
import type { Element } from '../core/types';
import type { BossPhase, EnemyArchetype, EnemyTechnique } from '../data/enemies';
import { Entity, Health, type HitInfo, type HitResult } from '../entities/Entity';
import { KinematicBody } from '../entities/KinematicBody';
import { aiAttack, type AiAttackDef, type AiAttackRuntime } from './attacks';
import { BeastModel, type BeastAction } from './BeastModel';
import { Brain } from './Brain';
import { attachProps, enemyAppearance, type PropSet } from './looks';
import type { AiHost } from './types';

/**
 * A hostile combatant: humanoid benders/non-benders and beasts.
 *
 * Implements Combatant exactly like the Player, so benders cast the real
 * techniques through ctx.combat.tryCast (chi, cooldowns, water sources, clips
 * on their own Humanoid). Every attack is preceded by a readable tell (stance
 * + hand glow / weapon glint / beast rear-up) the player can dodge or block.
 * Movement is a KinematicBody with collision, steered by the Brain with
 * obstacle / cliff / deep-water avoidance, crowd separation and stuck recovery.
 */

export interface EnemyOptions {
  level?: number;
  seed?: number;
  home?: THREE.Vector3;
  yaw?: number;
  encounterId?: string | null;
  /** Element override (sparring partners). */
  element?: Element;
  appearance?: Appearance;
  name?: string;
  patrol?: THREE.Vector3[];
  ambush?: boolean;
  sparring?: boolean;
  /** Starting water reserve (units of real water already drawn). */
  waterReserve?: number;
  /** Leash override (m). */
  leash?: number;
}

interface AttackState {
  tech: EnemyTechnique;
  ai: AiAttackDef | null;
  phase: 'tell' | 'active' | 'recovery' | 'cast';
  t: number;
  tell: number;
  burstLeft: number;
  step: number;
  target: Entity | null;
  readonly dir: THREE.Vector3;
  runtime: AiAttackRuntime | null;
  fx: number;
}

const FACTION_TINT: Record<string, string> = {
  fire_nation: '#7a1a12',
  earth_bandit: '#8a3020',
  dai_li: '#1d3a26',
  pirate: '#a02a24',
  beast: '#555555',
};

const ELEMENT_TELL: Record<Element, { preset: 'embers' | 'mist' | 'dust' | 'air'; color: string }> = {
  fire: { preset: 'embers', color: '#ffa040' },
  water: { preset: 'mist', color: '#9fd8ff' },
  earth: { preset: 'dust', color: '#b9a07a' },
  air: { preset: 'air', color: '#eef6ff' },
};

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const scratch: Entity[] = [];

export class Enemy extends Entity implements Combatant {
  readonly kind = 'enemy' as const;
  readonly isPlayer = false;
  readonly humanoid: Humanoid | null = null;
  readonly beast: BeastModel | null = null;
  element: Element;
  chi: number;
  maxChi: number;
  waterReserve = 0;
  maxWaterReserve = 40;
  readonly level: number;
  readonly basePower: number;
  powerMul = 1;
  speedMul = 1;
  tempoMul = 1;
  phaseIndex = -1;
  readonly techniques: EnemyTechnique[];
  readonly home = new THREE.Vector3();
  readonly patrol: THREE.Vector3[];
  readonly leash: number;
  readonly encounterId: string | null;
  readonly sparring: boolean;
  readonly brain: Brain;
  attack: AttackState | null = null;
  /** Granted by the director each frame (crowd control). */
  attackToken = false;
  // Motor (written by the Brain each think)
  moveMode: 'stop' | 'seek' | 'flee' | 'strafe' = 'stop';
  readonly moveGoal = new THREE.Vector3();
  moveSpeed = 0;
  /** Seek arrives this far from the goal (standoff from a target's body). */
  seekStop = 0.35;
  /** Keep this distance while strafing (m). */
  strafeRange = 8;
  strafeSign = 1;
  faceTarget: THREE.Vector3 | null = null;
  // State
  defeated = false;
  private defeatMode: 'kneel' | 'flee' | 'cower' = 'kneel';
  private defeatT = 0;
  private released = false;
  guardT = 0;
  private dodgeCD = 0;
  private knockT = 0;
  private staggerT = 0;
  private beastAction: BeastAction = 'none';
  private beastActionT = 0;
  lastDamagedT = -99;
  lastHitByPlayerT = -99;
  alertT = -99;
  private props: PropSet | null = null;
  private readonly smoothMove = new THREE.Vector3();
  private readonly steerDir = new THREE.Vector3(0, 0, 1);
  private steerOffset = 0;
  private steerT = 0;
  private lastYaw = 0;
  private stuckCheckT = 0;
  private readonly stuckPos = new THREE.Vector3();
  private detourT = 0;
  private detourSign = 1;
  /** Seconds of continuous "trying to move but not getting anywhere" (tests watch it). */
  stuckTime = 0;
  maxStuck = 0;
  readonly stats = { attacks: 0, castsOk: 0, castsFailed: 0, waterCasts: 0, waterFails: 0, aiAttacks: 0, dodges: 0, blocks: 0, hitsTaken: 0, recoveries: 0 };
  /** Last technique failure reason (debug). */
  lastFail: string | null = null;

  constructor(readonly arch: EnemyArchetype, readonly host: AiHost, o: EnemyOptions = {}) {
    super();
    this.name = o.name ?? arch.name;
    this.team = 'hostile';
    this.tags.add('enemy');
    for (const t of arch.tags) this.tags.add(t);
    this.level = Math.max(1, Math.round(o.level ?? 1));
    const lv = this.level - 1;
    this.health = new Health(Math.round(arch.hp * (1 + lv * 0.07)), arch.poise * (1 + lv * 0.03), arch.poise * 0.6);
    this.damageTaken = arch.armor ?? 1;
    this.basePower = arch.power * (1 + lv * 0.04);
    this.element = o.element ?? arch.element ?? 'earth';
    this.maxChi = arch.chi ?? 100;
    this.chi = this.maxChi;
    this.waterReserve = Math.min(this.maxWaterReserve, o.waterReserve ?? 0);
    this.encounterId = o.encounterId ?? null;
    this.sparring = !!o.sparring;
    this.leash = o.leash ?? arch.behaviour.leash;
    this.techniques = arch.techniques.slice();
    this.patrol = o.patrol ?? [];
    const seed = o.seed ?? Math.floor(Math.random() * 1e6);
    if (arch.body === 'humanoid') {
      const app = o.appearance ?? enemyAppearance(arch.look ?? 'bandit', seed);
      if (arch.scale) app.height = Math.min(1.2, app.height * arch.scale);
      const h = new Humanoid(app, { castShadow: true });
      this.humanoid = h;
      this.root.add(h.root);
      this.height = h.height;
      this.radius = 0.38;
      this.body = new KinematicBody(0.34, this.height);
      this.props = attachProps(h, arch.props ?? [], FACTION_TINT[arch.faction] ?? '#555', app.colors.accent);
      h.animator.loco.style = arch.element ? this.element : 'guard';
      h.animator.onFootstep = null;
    } else {
      const b = new BeastModel(arch.body);
      this.beast = b;
      this.root.add(b.root);
      this.height = b.height;
      this.radius = b.radius;
      this.body = new KinematicBody(b.radius * 0.8, b.height);
      this.health.poiseRegen = arch.poise;
    }
    if (o.home) {
      this.home.copy(o.home);
      this.root.position.copy(o.home);
    }
    this.yaw = o.yaw ?? Math.random() * Math.PI * 2;
    this.lastYaw = this.yaw;
    this.root.rotation.y = this.yaw;
    this.brain = new Brain(this, { ambush: !!o.ambush, sparring: this.sparring });
  }

  get rank(): EnemyArchetype['rank'] {
    return this.arch.rank;
  }

  get hpFraction(): number {
    return this.health ? this.health.fraction : 0;
  }

  // ---------------------------------------------------------------------------
  // Combatant
  // ---------------------------------------------------------------------------

  castOrigin(which: 'handL' | 'handR' | 'hands' | 'chest' | 'feet', out: THREE.Vector3): THREE.Vector3 {
    if (which === 'feet') return out.copy(this.root.position);
    const h = this.humanoid;
    if (h) {
      h.root.updateWorldMatrix(true, true);
      switch (which) {
        case 'handL':
          return h.anchors.handL.getWorldPosition(out);
        case 'handR':
          return h.anchors.handR.getWorldPosition(out);
        case 'hands':
          h.anchors.handL.getWorldPosition(out);
          return out.add(h.anchors.handR.getWorldPosition(tmpC)).multiplyScalar(0.5);
        default:
          return h.anchors.chest.getWorldPosition(out);
      }
    }
    if (this.beast) {
      this.beast.root.updateWorldMatrix(true, true);
      return (which === 'chest' ? this.beast.chest : this.beast.mouth).getWorldPosition(out);
    }
    return this.aimPoint(out);
  }

  powerMultiplier(): number {
    return this.basePower * this.powerMul;
  }

  // ---------------------------------------------------------------------------
  // Actions (called by the Brain)
  // ---------------------------------------------------------------------------

  /** Begin a telegraphed attack. Returns false when it cannot start now. */
  beginAttack(ctx: GameContext, tech: EnemyTechnique, target: Entity | null): boolean {
    if (this.attack || this.defeated || this.stunned > 0 || this.knockT > 0 || this.staggerT > 0) return false;
    if (ctx.combat.isBusy(this)) return false;
    const ai = tech.id.startsWith('atk_') ? aiAttack(tech.id) ?? null : null;
    if (!ai && !getTechnique(tech.id)) return false;
    const diff = ctx.settings.data.gameplay.difficulty;
    const diffTell = diff === 'story' ? 1.3 : diff === 'challenging' ? 0.85 : 1;
    const tell = Math.max(0.12, (tech.tell ?? 0.4) * this.tempoMul * diffTell);
    const b = tech.burst ?? [1, 1];
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (target) {
      tmpA.copy(target.position).sub(this.position).setY(0);
      if (tmpA.lengthSq() > 1e-4) dir.copy(tmpA.normalize());
    }
    this.attack = { tech, ai, phase: 'tell', t: 0, tell, burstLeft: b[0] + Math.floor(Math.random() * (b[1] - b[0] + 1)), step: 0, target, dir, runtime: null, fx: 0 };
    this.guardT = 0;
    this.setGuard(false);
    if (this.humanoid) this.humanoid.animator.play(ai?.tellClip ?? 'charge_hold', { hold: true, fadeIn: 0.12 });
    if (this.beast && ai?.beastTell) this.setBeastAction(ai.beastTell);
    this.stats.attacks++;
    return true;
  }

  cancelAttack(ctx: GameContext): void {
    const a = this.attack;
    if (!a) return;
    if (this.humanoid && a.phase === 'tell') this.humanoid.animator.stop(a.ai?.tellClip ?? 'charge_hold', 0.1);
    if (a.phase === 'cast') ctx.combat.interrupt(this, true);
    this.attack = null;
    if (this.beast) this.setBeastAction('none');
  }

  /** Raise a guard for `seconds` (blocks most damage, sparks on hit). */
  guard(seconds: number): void {
    if (this.attack || this.defeated) return;
    this.guardT = seconds;
    this.setGuard(true);
    this.stats.blocks++;
  }

  private setGuard(on: boolean): void {
    if (this.guarding === on) return;
    this.guarding = on;
    const an = this.humanoid?.animator;
    if (!an) return;
    if (on) an.play('block_cross', { hold: true, fadeIn: 0.06 });
    else an.stop('block_cross', 0.12);
  }

  /** Quick evasive step (sideways impulse + short i-frames). */
  dodge(ctx: GameContext, dir: THREE.Vector3): boolean {
    const b = this.body!;
    if (this.attack || this.dodgeCD > 0 || !b.grounded || this.defeated || this.stunned > 0) return false;
    b.impulse(dir.x * 9, 0, dir.z * 9);
    this.health!.invulnerable = Math.max(this.health!.invulnerable, 0.25);
    this.dodgeCD = 2.2;
    this.setGuard(false);
    const el = this.arch.element ?? 'earth';
    this.humanoid?.animator.play(`dodge_${el}`, { fadeIn: 0.04 });
    ctx.vfx.burst('dust', this.position, { count: 5, speed: 1.5 });
    ctx.audio.play(`dodge.${el}`, { position: this.position, volume: 0.5 });
    this.stats.dodges++;
    return true;
  }

  private setBeastAction(a: BeastAction): void {
    if (this.beastAction === a) return;
    this.beastAction = a;
    this.beastActionT = 0;
  }

  /** Apply a boss phase (techniques, tempo, power). */
  applyPhase(ctx: GameContext, p: BossPhase, index: number): void {
    this.phaseIndex = index;
    if (p.techniques) for (const t of p.techniques) this.techniques.push(t);
    if (p.powerMul) this.powerMul *= p.powerMul;
    if (p.speedMul) this.speedMul *= p.speedMul;
    if (p.tempoMul) this.tempoMul *= p.tempoMul;
    this.cancelAttack(ctx);
    this.health!.invulnerable = Math.max(this.health!.invulnerable, 0.9);
    this.health!.poise = this.health!.maxPoise;
    this.humanoid?.animator.play('raise_two', { fadeIn: 0.08 });
    if (this.beast) this.setBeastAction('roar');
    const pos = this.position;
    ctx.vfx.ring(tmpA.copy(pos).setY(pos.y + 0.15), this.element === 'fire' ? '#ff8a3a' : this.element === 'earth' ? '#b9a07a' : '#cfe4ff', 6, 0.6);
    ctx.vfx.burst(this.element === 'fire' ? 'fire' : 'dust', tmpB.copy(pos).setY(pos.y + 1), { count: 16, speed: 4 });
    ctx.events.emit('camera:shake', { intensity: 0.3, duration: 0.4 });
  }

  // ---------------------------------------------------------------------------
  // Hits
  // ---------------------------------------------------------------------------

  override receiveHit(hit: HitInfo, ctx: GameContext): HitResult {
    if (this.defeated) return { damage: 0, killed: false, blocked: false, staggered: false };
    if (this.sparring && this.health) {
      // Non-lethal duel: never drop to 0.
      const room = Math.max(0, this.health.hp - 1) / Math.max(0.01, this.damageTaken);
      if (hit.damage > room) hit = { ...hit, damage: room };
    }
    const res = super.receiveHit(hit, ctx);
    if (res.damage > 0 || res.blocked) this.stats.hitsTaken++;
    return res;
  }

  protected override onHitReaction(hit: HitInfo, res: HitResult, ctx: GameContext): void {
    const now = ctx.time.elapsed;
    if (res.damage > 0) this.lastDamagedT = now;
    if (hit.attacker && hit.attacker.kind === 'player') this.lastHitByPlayerT = now;
    if (res.damage > 0) {
      this.humanoid?.flash('#fff0e0', 0.1);
      this.beast?.flash('#ff9070', 0.12);
      let side = 0;
      if (hit.point) {
        const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
        side = (hit.point.x - this.position.x) * lx + (hit.point.z - this.position.z) * lz > 0 ? -1 : 1;
      }
      this.humanoid?.animator.hitReact(Math.min(1.2, 0.3 + res.damage / 18), side);
    }
    const knocked = !!hit.knockdown && !res.blocked && !this.arch.phases;
    if (res.staggered || knocked || (hit.stun && !res.blocked)) {
      this.cancelAttack(ctx);
      ctx.combat.interrupt(this, true);
      this.setGuard(false);
      this.guardT = 0;
      if (knocked && this.humanoid) {
        this.knockT = 1.25;
        this.humanoid.animator.play('knockdown', { hold: true, fadeIn: 0.05 });
      } else {
        this.staggerT = Math.max(this.staggerT, 0.45);
        if (this.beast) this.setBeastAction('stagger');
      }
    }
    this.brain.onDamaged(ctx, hit, res);
    // Boss phases.
    const phases = this.arch.phases;
    if (phases && !this.sparring) {
      const f = this.hpFraction;
      for (let i = this.phaseIndex + 1; i < phases.length; i++) {
        if (f <= phases[i].at) {
          this.applyPhase(ctx, phases[i], i);
          this.host.onBossPhase(this, phases[i]);
        }
      }
    }
    if (this.sparring && this.hpFraction < 0.15) this.host.onSparringThreshold(this, true);
  }

  protected override onDeath(ctx: GameContext, hit: HitInfo): void {
    this.defeated = true;
    this.targetable = false;
    this.cancelAttack(ctx);
    ctx.combat.interrupt(this, false);
    this.setGuard(false);
    this.humanoid?.animator.stop();
    this.knockT = 0;
    this.defeatT = 0;
    const s = this.arch.behaviour.surrender;
    if (this.beast) this.defeatMode = 'cower';
    else if (this.arch.rank === 'boss') this.defeatMode = 'kneel';
    else this.defeatMode = s === 'mixed' ? (Math.random() < 0.5 ? 'kneel' : 'flee') : s;
    if (this.defeatMode === 'kneel') ctx.vfx.burst('dust', this.position, { count: 6, speed: 1 });
    ctx.audio.play(this.beast ? 'creature.polarbeardog.growl' : 'voice.hurt', { position: this.position, volume: 0.7, pitch: this.beast ? 1.5 : 0.9 });
    this.host.onEnemyDefeated(this, hit);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext): void {
    if (this.released) return;
    const h = this.health!;
    h.update(dt);
    const dot = this.updateStatuses(dt);
    // Status damage over time never finishes a foe off (defeat always comes from a CombatSystem hit).
    if (dot > 0 && !this.defeated) h.hp = Math.max(1, h.hp - dot);
    if (this.sparring && !this.defeated && this.hpFraction < 0.15) this.host.onSparringThreshold(this, true);
    this.dodgeCD = Math.max(0, this.dodgeCD - dt);
    this.chi = Math.min(this.maxChi, this.chi + 12 * dt);
    if (this.defeated) {
      this.updateDefeated(dt, ctx);
      this.animate(dt, ctx);
      return;
    }
    if (this.knockT > 0) {
      this.knockT -= dt;
      if (this.knockT <= 0) this.humanoid?.animator.play('getup', { fadeIn: 0.05 });
    }
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      if (this.staggerT <= 0 && this.beast && this.beastAction === 'stagger') this.setBeastAction('none');
    }
    if (this.guardT > 0) {
      this.guardT -= dt;
      if (this.guardT <= 0) this.setGuard(false);
    }
    this.brain.update(dt, ctx);
    this.updateAttack(dt, ctx);
    this.updateMotor(dt, ctx);
    const body = this.body!;
    body.step(dt, this.root.position, ctx.world);
    if (this.root.position.y < -60 || !Number.isFinite(this.root.position.x)) this.recoverToHome(ctx);
    this.animate(dt, ctx);
  }

  /** Put the enemy back on the ground at home (fell out of the world / hopelessly stuck). */
  recoverToHome(ctx: GameContext): void {
    const p = this.home;
    const g = ctx.world.groundAt(p.x, p.z, p.y + 3);
    this.body!.place(tmpA.set(p.x, g.y + 0.05, p.z), this.root.position);
    this.stuckTime = 0;
    this.stats.recoveries++;
  }

  private updateAttack(dt: number, ctx: GameContext): void {
    const a = this.attack;
    if (!a) return;
    a.t += dt;
    const tgt = a.target;
    if (tgt && (!tgt.alive || (tgt.kind === 'player' && (tgt as any).defeated))) {
      this.cancelAttack(ctx);
      this.brain.onAttackFinished(ctx, a.tech, false);
      return;
    }
    switch (a.phase) {
      case 'tell': {
        if (tgt && a.t < a.tell * 0.75) {
          tmpA.copy(tgt.position).sub(this.position).setY(0);
          if (tmpA.lengthSq() > 1e-4) a.dir.copy(tmpA.normalize());
        }
        this.yaw = dampAngle(this.yaw, Math.atan2(a.dir.x, a.dir.z), 14, dt);
        a.fx -= dt;
        if (a.fx <= 0) {
          a.fx = 0.11;
          if (this.humanoid && !a.ai && this.arch.element) {
            const t = ELEMENT_TELL[this.element];
            const hp = this.castOrigin('hands', tmpB);
            ctx.vfx.burst(t.preset === 'dust' ? 'dust' : 'glow', hp, { count: t.preset === 'dust' ? 2 : 1, color: t.color, size: 0.35, speed: 0.3 });
            if (this.element === 'fire') ctx.vfx.burst('embers', hp, { count: 2, speed: 0.6 });
          } else if (this.humanoid && a.ai && a.t > a.tell * 0.45 && !a.runtime) {
            // Weapon glint: the classic "about to strike" tell.
            ctx.vfx.burst('glow', this.castOrigin('handR', tmpB), { color: '#fff6d8', size: 0.3 + Math.min(0.4, a.t), speed: 0 });
          } else if (this.beast && a.t > a.tell * 0.3) {
            ctx.vfx.burst('dust', this.position, { count: 2, speed: 1.2 });
          }
        }
        if (a.t >= a.tell) this.releaseAttack(ctx, a);
        break;
      }
      case 'active': {
        const rt = a.runtime!;
        rt.t += dt;
        let keep = true;
        try {
          keep = a.ai!.tick ? a.ai!.tick(rt, dt) : true;
        } catch (err) {
          console.error('[enemies] attack tick failed', err);
          keep = false;
        }
        if (!keep || rt.t >= a.ai!.active) {
          a.phase = 'recovery';
          a.t = 0;
          if (this.beast) this.setBeastAction('none');
        }
        break;
      }
      case 'recovery': {
        if (a.t >= a.ai!.recovery * this.tempoMul) {
          if (a.burstLeft > 1 && tgt && this.inBand(a.tech, tgt.position.distanceTo(this.position) - 0.5)) {
            a.burstLeft--;
            a.step++;
            a.phase = 'tell';
            a.t = 0;
            a.tell = Math.min(a.tell, 0.16);
            a.runtime = null;
            if (this.beast && a.ai?.beastTell) this.setBeastAction(a.ai.beastTell);
          } else this.finishAttack(ctx, a, true);
        }
        break;
      }
      case 'cast': {
        if (!ctx.combat.isBusy(this)) {
          if (a.burstLeft > 1 && tgt && a.t > 0.05 && this.inBand(a.tech, tgt.position.distanceTo(this.position))) {
            a.burstLeft--;
            a.step++;
            a.t = 0;
            if (!this.castBending(ctx, a)) this.finishAttack(ctx, a, false);
          } else if (!ctx.combat.isCommitted(this) || a.t > 2.5) this.finishAttack(ctx, a, true);
        } else if (a.t > 7) this.finishAttack(ctx, a, true);
        break;
      }
    }
  }

  private inBand(t: EnemyTechnique, d: number): boolean {
    const max = t.max ?? (getTechnique(t.id)?.range ?? aiAttack(t.id)?.def.range ?? 10);
    return d >= (t.min ?? 0) * 0.7 && d <= max * 1.15;
  }

  private releaseAttack(ctx: GameContext, a: AttackState): void {
    if (this.humanoid) this.humanoid.animator.stop(a.ai?.tellClip ?? 'charge_hold', 0.06);
    if (a.ai) {
      const origin = this.castOrigin('chest', new THREE.Vector3());
      const cast = ctx.combat.detachedCast(this, a.ai.def, origin, a.dir, a.target);
      a.runtime = { ctx, caster: this, cast, target: a.target, dir: a.dir, step: a.step, t: 0, data: {} };
      try {
        a.ai.start(a.runtime);
      } catch (err) {
        console.error('[enemies] attack start failed', err);
      }
      a.phase = 'active';
      a.t = 0;
      if (this.beast && a.ai.beastActive) this.setBeastAction(a.ai.beastActive);
      this.stats.aiAttacks++;
      return;
    }
    a.phase = 'cast';
    a.t = 0;
    if (!this.castBending(ctx, a)) this.finishAttack(ctx, a, false);
  }

  private castBending(ctx: GameContext, a: AttackState): boolean {
    const def = getTechnique(a.tech.id);
    if (!def) return false;
    const origin = this.castOrigin('chest', tmpA);
    const aimPoint = new THREE.Vector3();
    if (a.target) {
      a.target.aimPoint(aimPoint);
      const d = aimPoint.distanceTo(origin);
      const tv = a.target.body?.velocity;
      if (tv) aimPoint.addScaledVector(tmpB.set(tv.x, 0, tv.z), Math.min(0.6, d / 30));
      // Human error grows with distance (and shrinks for elites/bosses).
      const err = (this.arch.rank === 'minion' ? 0.035 : 0.018) * d;
      aimPoint.x += (Math.random() - 0.5) * err;
      aimPoint.z += (Math.random() - 0.5) * err;
    } else aimPoint.copy(origin).addScaledVector(a.dir, def.range || 10);
    const aimDir = aimPoint.clone().sub(origin).normalize();
    const res = ctx.combat.tryCast(this, def.id, { target: a.target, aimDir, aimPoint, charge: a.tech.charge ?? 0, force: true });
    if (res.ok) {
      this.stats.castsOk++;
      if (def.element === 'water') this.stats.waterCasts++;
      return true;
    }
    this.stats.castsFailed++;
    this.lastFail = res.reason ?? 'failed';
    if (res.reason === 'water') {
      this.stats.waterFails++;
      this.brain.onNoWater(ctx);
    }
    return false;
  }

  private finishAttack(ctx: GameContext, a: AttackState, ok: boolean): void {
    if (this.attack !== a) return;
    this.attack = null;
    if (this.beast) this.setBeastAction('none');
    this.brain.onAttackFinished(ctx, a.tech, ok);
  }

  // ---------------------------------------------------------------------------
  // Motor: steering, avoidance, stuck recovery
  // ---------------------------------------------------------------------------

  private updateMotor(dt: number, ctx: GameContext): void {
    const body = this.body!;
    const pos = this.root.position;
    const a = this.attack;
    // A beast charge drives the body itself.
    if (a && a.phase === 'active' && a.ai && !a.ai.root && a.tech.id === 'atk_beast_charge') return;
    let speed = this.moveSpeed * this.speedMul * this.speedFactor;
    const mm = ctx.combat.movementMode(this);
    if (mm === 'root') speed = 0;
    else if (mm === 'slow') speed *= 0.4;
    if (a && (a.phase === 'tell' || a.phase === 'active') && (a.ai ? a.ai.root : false)) speed = 0;
    if (a && a.phase === 'tell' && !a.ai) speed *= 0.35;
    if (this.knockT > 0 || this.staggerT > 0 || this.stunned > 0) speed = 0;
    if (this.guarding) speed *= 0.35;
    const dir = tmpA.set(0, 0, 0);
    if (speed > 0.05 && this.moveMode !== 'stop') {
      const g = this.moveGoal;
      if (this.moveMode === 'seek') {
        dir.set(g.x - pos.x, 0, g.z - pos.z);
        const d = dir.length();
        if (d <= this.seekStop) speed = 0;
        else {
          dir.divideScalar(d);
          if (d < this.seekStop + 1.2) speed *= Math.max(0.15, (d - this.seekStop) / 1.2);
        }
      } else if (this.moveMode === 'flee') {
        dir.set(pos.x - g.x, 0, pos.z - g.z);
        if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI));
        dir.normalize();
      } else if (this.moveMode === 'strafe') {
        const rx = g.x - pos.x, rz = g.z - pos.z;
        const d = Math.hypot(rx, rz) || 1;
        const ux = rx / d, uz = rz / d;
        const corr = Math.max(-1, Math.min(1, (d - this.strafeRange) * 0.4));
        dir.set(-uz * this.strafeSign + ux * corr, 0, ux * this.strafeSign + uz * corr).normalize();
      }
      // Crowd separation.
      if (speed > 0) {
        const near = ctx.entities.queryRadius(pos, 2.2, { kinds: ['enemy'] }, scratch);
        for (const o of near) {
          if (o === this) continue;
          const ox = pos.x - o.position.x, oz = pos.z - o.position.z;
          const od = Math.hypot(ox, oz);
          if (od < 1e-3 || od > 2.2) continue;
          const w = ((2.2 - od) / 2.2) * 1.3;
          dir.x += (ox / od) * w;
          dir.z += (oz / od) * w;
        }
        // Never stand inside the target's body.
        const t = this.brain.target;
        if (t) {
          const ox = pos.x - t.position.x, oz = pos.z - t.position.z;
          const od = Math.hypot(ox, oz);
          const min = this.radius + t.radius + 0.15;
          if (od > 1e-3 && od < min) {
            const w = ((min - od) / min) * 2.5;
            dir.x += (ox / od) * w;
            dir.z += (oz / od) * w;
          }
        }
        if (dir.lengthSq() > 1e-6) dir.normalize();
      }
      // Stuck detour: bias the heading sideways, still validated by the avoidance below.
      if (this.detourT > 0 && dir.lengthSq() > 1e-6) {
        const c = Math.cos(1.3 * this.detourSign), s = Math.sin(1.3 * this.detourSign);
        dir.set(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
      }
      if (speed > 0) this.avoid(ctx, dir, dt);
    } else speed = 0;
    if (this.detourT > 0) this.detourT -= dt;
    // Stuck detection: trying to move, not getting anywhere.
    this.stuckCheckT -= dt;
    if (this.stuckCheckT <= 0) {
      const moved = Math.hypot(pos.x - this.stuckPos.x, pos.z - this.stuckPos.z);
      const trying = speed > 1 && this.moveMode !== 'stop' && !this.attack;
      if (trying && moved < 0.3) {
        this.stuckTime += 0.8;
        this.detourT = 1.1;
        this.detourSign = Math.random() < 0.5 ? -1 : 1;
        if (this.stuckTime > 5 && !this.inView(ctx)) this.recoverToHome(ctx);
      } else if (moved > 0.6 || !trying) this.stuckTime = 0;
      this.maxStuck = Math.max(this.maxStuck, this.stuckTime);
      this.stuckPos.copy(pos);
      this.stuckCheckT = 0.8;
    }
    const tx = dir.x * speed, tz = dir.z * speed;
    this.smoothMove.x = damp(this.smoothMove.x, tx, 9, dt);
    this.smoothMove.z = damp(this.smoothMove.z, tz, 9, dt);
    body.move.set(this.smoothMove.x, 0, this.smoothMove.z);
    // Facing.
    const committed = ctx.combat.isBusy(this) || (a && a.phase === 'tell');
    if (!committed) {
      let want = this.yaw;
      if (this.faceTarget) want = Math.atan2(this.faceTarget.x - pos.x, this.faceTarget.z - pos.z);
      else if (this.smoothMove.lengthSq() > 0.25) want = Math.atan2(this.smoothMove.x, this.smoothMove.z);
      this.yaw = dampAngle(this.yaw, want, this.beast ? 5 : 8, dt);
    }
  }

  /** Steer `dir` (in/out) around walls, cliffs and deep water; re-evaluated a few times per second. */
  private avoid(ctx: GameContext, dir: THREE.Vector3, dt: number): void {
    this.steerT -= dt;
    const base = Math.atan2(dir.x, dir.z);
    if (this.steerT <= 0) {
      this.steerT = 0.2;
      const offsets = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI];
      // Prefer the previous offset to avoid flip-flopping.
      if (this.steerOffset !== 0) offsets.splice(1, 0, this.steerOffset);
      let chosen: number | null = null;
      for (const off of offsets) {
        if (this.walkable(ctx, base + off)) {
          chosen = off;
          break;
        }
      }
      this.steerOffset = chosen ?? 0;
      this.steerDir.set(chosen === null ? 0 : 1, 0, 0);
    }
    if (this.steerDir.x === 0) {
      dir.set(0, 0, 0);
      return;
    }
    const a = base + this.steerOffset;
    dir.set(Math.sin(a), 0, Math.cos(a));
  }

  private walkable(ctx: GameContext, yaw: number): boolean {
    const pos = this.root.position;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const dist = 2.2;
    const px = pos.x + dx * dist, pz = pos.z + dz * dist;
    const g = ctx.world.groundAt(px, pz, pos.y + 1.6);
    if (g.y < pos.y - 2.2) return false; // cliff edge
    if (g.y > pos.y + 1.3) return false; // wall of rock / steep rise
    const w = ctx.world.liquidAt(px, pz);
    const wade = this.arch.element === 'water' ? 1.1 : 0.75;
    if (w && w.level - g.y > wade) return false; // deep water
    tmpB.set(pos.x, pos.y + 0.6, pos.z);
    tmpC.set(dx, 0, dz);
    if (ctx.world.collision.raycast(tmpB, tmpC, 1.4)) return false;
    return true;
  }

  /** Roughly inside the camera frustum (used to avoid popping in/out in view). */
  inView(ctx: GameContext): boolean {
    const cam = ctx.camera;
    tmpB.copy(this.root.position).setY(this.root.position.y + 1).project(cam);
    return tmpB.z < 1 && Math.abs(tmpB.x) < 1.1 && Math.abs(tmpB.y) < 1.1 && cam.position.distanceTo(this.root.position) < 160;
  }

  // ---------------------------------------------------------------------------
  // Defeat
  // ---------------------------------------------------------------------------

  private updateDefeated(dt: number, ctx: GameContext): void {
    this.defeatT += dt;
    const body = this.body!;
    const pos = this.root.position;
    const p = ctx.player;
    let speed = 0;
    if (this.defeatMode === 'cower') {
      this.setBeastAction('cower');
      if (this.defeatT > 1.1) {
        this.defeatMode = 'flee';
        this.setBeastAction('none');
      }
    } else if (this.defeatMode === 'flee' && p) {
      const dir = tmpA.set(pos.x - p.position.x, 0, pos.z - p.position.z);
      if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      dir.normalize();
      this.avoid(ctx, dir, dt);
      speed = this.arch.speed.run * 0.95;
      this.smoothMove.x = damp(this.smoothMove.x, dir.x * speed, 6, dt);
      this.smoothMove.z = damp(this.smoothMove.z, dir.z * speed, 6, dt);
      if (this.smoothMove.lengthSq() > 0.25) this.yaw = dampAngle(this.yaw, Math.atan2(this.smoothMove.x, this.smoothMove.z), 6, dt);
    }
    if (this.defeatMode !== 'flee') this.smoothMove.multiplyScalar(Math.exp(-8 * dt));
    body.move.set(this.smoothMove.x, 0, this.smoothMove.z);
    body.step(dt, pos, ctx.world);
    const far = p ? pos.distanceTo(p.position) > 38 : true;
    const done = this.defeatMode === 'kneel' ? this.defeatT > 6 : this.defeatT > 8 || (far && this.defeatT > 2.5);
    if (done) this.vanish(ctx);
  }

  /** Leave the world (puff of dust) and ask the host to remove us. */
  vanish(ctx: GameContext): void {
    if (this.released) return;
    this.released = true;
    if (this.inView(ctx)) ctx.vfx.burst('smoke', tmpA.copy(this.position).setY(this.position.y + 0.8), { count: 8, size: 1.2 });
    this.host.release(this);
  }

  get isReleased(): boolean {
    return this.released;
  }

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------

  private animate(dt: number, ctx: GameContext): void {
    const body = this.body!;
    this.root.rotation.y = this.yaw;
    const turnRate = angleDiff(this.lastYaw, this.yaw) / Math.max(dt, 1e-3);
    this.lastYaw = this.yaw;
    const v = body.velocity;
    const spd = Math.hypot(v.x, v.z);
    if (this.humanoid) {
      const L = this.humanoid.animator.loco;
      L.speed = spd;
      L.grounded = body.grounded;
      L.vy = v.y;
      L.swimming = body.swimming;
      L.sliding = body.sliding;
      L.turnRate = turnRate;
      L.sprinting = spd > 5.2;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const lx = fz, lz = -fx;
      L.moveDir = spd > 0.3 ? Math.atan2(v.x * lx + v.z * lz, v.x * fx + v.z * fz) : 0;
      L.idleVariant = this.defeated && this.defeatMode === 'kneel' ? 'kneel' : this.brain.hidden ? 'kneel' : 'stand';
      if (this.distToPlayer < 150) this.humanoid.update(dt);
    } else if (this.beast) {
      this.beastActionT += dt;
      if (this.distToPlayer < 150) this.beast.update(dt, spd, this.beastAction, this.beastActionT);
    }
    void ctx;
  }

  override dispose(): void {
    this.props?.dispose();
    this.props = null;
    this.humanoid?.dispose();
    this.beast?.dispose();
    super.dispose();
  }
}
