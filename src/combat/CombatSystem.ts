import * as THREE from 'three';
import type { Humanoid } from '../character/Humanoid';
import type { GameContext, GameSystem } from '../core/GameContext';
import type { Element, ElementOrAvatar, TechniqueFailReason } from '../core/types';
import { areHostile } from '../entities/EntityManager';
import type { Entity, HitInfo, HitResult } from '../entities/Entity';
import type { AreaHitOptions, Cast, Combatant, Projectile, ProjectileSpec, TechniqueDef, WaterGrant } from './types';

/**
 * Executes techniques for any Combatant (player or AI), simulates projectiles,
 * resolves hits with per-cast deduplication, and emits combat events.
 */

const TECHNIQUES = new Map<string, TechniqueDef>();

export function registerTechnique(def: TechniqueDef): TechniqueDef {
  if (TECHNIQUES.has(def.id)) console.warn(`[Combat] technique ${def.id} re-registered`);
  TECHNIQUES.set(def.id, def);
  return def;
}

export function getTechnique(id: string): TechniqueDef | undefined {
  return TECHNIQUES.get(id);
}

export function allTechniques(): TechniqueDef[] {
  return [...TECHNIQUES.values()];
}

/** The player bends faster than anyone: windup, recovery and the bending animation run at this tempo. */
export const PLAYER_TEMPO = 1.2;
/** Cooldowns are tuned for the player; other benders' techniques recover this much slower. */
const NPC_COOLDOWN_SCALE = 1.8;
/** Chi a landed basic strike gives back to the player: attacking fuels bending. */
const BASIC_HIT_CHI = 2.5;
/** Avatar Flow: damage bonus per extra element woven into one unbroken basic combo. */
const FLOW_BONUS = 0.12;
const FLOW_COLORS: Record<Element, string> = { air: '#eef6ff', water: '#5cc8ff', earth: '#b89a62', fire: '#ff8a3a' };

export interface CastRequest {
  aimDir?: THREE.Vector3;
  aimPoint?: THREE.Vector3;
  target?: Entity | null;
  charge?: number;
  /** Skip "is learned" check (AI, tutorial, debug). */
  force?: boolean;
  /** Free cast (no chi / cooldown) — training demonstrations. */
  free?: boolean;
}

export interface CastResult {
  ok: boolean;
  reason?: TechniqueFailReason;
  message?: string;
  cast?: Cast;
}

interface CasterState {
  cooldowns: Map<string, number>;
  active: CastImpl | null;
  combo: { id: string; index: number; time: number };
  /** Elements woven into the current unbroken basic combo (Avatar Flow). */
  flow: Element[];
}

let nextCastId = 1;
let nextProjectileId = 1;

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();

class CastImpl implements Cast {
  readonly id = nextCastId++;
  elapsed = 0;
  phase: Cast['phase'] = 'windup';
  data: Record<string, any> = {};
  readonly hitSet = new Set<number>();
  released = false;
  channelTime = 0;
  recoveryLeft = 0;
  constructor(
    readonly sys: CombatSystem,
    readonly ctx: GameContext,
    readonly def: TechniqueDef,
    readonly caster: Combatant,
    readonly origin: THREE.Vector3,
    readonly aimDir: THREE.Vector3,
    readonly aimPoint: THREE.Vector3,
    readonly target: Entity | null,
    readonly charge: number,
    readonly power: number,
    readonly comboIndex: number,
    readonly water: WaterGrant,
  ) {}

  get isPlayer(): boolean {
    return this.caster.isPlayer;
  }

  areaHit(o: AreaHitOptions): Entity[] {
    return this.sys.areaHit(this, o);
  }

  projectile(spec: ProjectileSpec): Projectile {
    return this.sys.spawnProjectile(this, spec);
  }

  hit(target: Entity, hit: Partial<HitInfo> & { damage: number }, allowRepeat = false): HitResult | null {
    if (!allowRepeat && this.hitSet.has(target.id)) return null;
    this.hitSet.add(target.id);
    // [avatar] Avatar State knockback boost for the player's hits (1 when inactive).
    const kb = this.caster.isPlayer ? (this.ctx.avatar?.boosts?.knockback ?? 1) : 1;
    return this.sys.applyHit(this.caster, target, {
      attacker: this.caster,
      element: this.def.element,
      techniqueId: this.def.id,
      hitId: this.id,
      ...hit,
      ...(kb !== 1 && hit.knockback ? { knockback: hit.knockback.clone().multiplyScalar(kb) } : {}),
      damage: hit.damage * this.power,
    });
  }

  finish(): void {
    if (this.phase === 'windup' || this.phase === 'channel') {
      if (!this.released) {
        this.released = true;
        this.sys.safeCall(() => this.def.release(this));
      }
      this.phase = 'recovery';
      this.recoveryLeft = this.def.recovery;
    }
  }
}

class ProjectileImpl implements Projectile {
  readonly id = nextProjectileId++;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  age = 0;
  alive = true;
  pierced = 0;
  readonly hitSet = new Set<number>();
  constructor(readonly spec: ProjectileSpec, readonly cast: Cast) {
    this.position.copy(spec.position);
    this.velocity.copy(spec.velocity);
  }
  kill(): void {
    this.alive = false;
  }
}

export class CombatSystem implements GameSystem {
  private ctx!: GameContext;
  private states = new WeakMap<Combatant, CasterState>();
  private casts: CastImpl[] = [];
  private projectiles: ProjectileImpl[] = [];
  private readonly scratch: Entity[] = [];
  /** Global damage multipliers (difficulty). */
  playerDamageTakenMul = 1;
  playerDamageDealtMul = 1;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const apply = () => {
      const d = ctx.settings.data.gameplay.difficulty;
      this.playerDamageTakenMul = d === 'story' ? 0.5 : d === 'challenging' ? 1.4 : 1;
      this.playerDamageDealtMul = d === 'story' ? 1.3 : d === 'challenging' ? 0.9 : 1;
    };
    apply();
    ctx.events.on('settings:changed', apply);
  }

  safeCall(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error('[Combat] technique error', err);
    }
  }

  private state(c: Combatant): CasterState {
    let s = this.states.get(c);
    if (!s) {
      s = { cooldowns: new Map(), active: null, combo: { id: '', index: -1, time: -99 }, flow: [] };
      this.states.set(c, s);
    }
    return s;
  }

  /** Remaining cooldown (s) for a technique on a caster. */
  cooldownLeft(c: Combatant, id: string): number {
    const s = this.state(c);
    const until = s.cooldowns.get(id) ?? 0;
    return Math.max(0, until - this.ctx.time.elapsed);
  }

  cooldownFraction(c: Combatant, id: string): number {
    const def = TECHNIQUES.get(id);
    if (!def || def.cooldown <= 0) return 0;
    return this.cooldownLeft(c, id) / (def.cooldown * this.cooldownScale(c));
  }

  private cooldownScale(c: Combatant): number {
    return c.isPlayer ? (this.ctx.avatar?.boosts?.cooldown ?? 1) : NPC_COOLDOWN_SCALE;
  }

  /** Put a technique on cooldown now (techniques whose cooldown starts when their effect ends). */
  startCooldown(c: Combatant, id: string, seconds: number): void {
    this.state(c).cooldowns.set(id, this.ctx.time.elapsed + seconds * this.cooldownScale(c));
  }

  /** The caster's active cast, if any. */
  activeCast(c: Combatant): Cast | null {
    return this.state(c).active;
  }

  /** True while the caster is in windup or channel (can't start another technique). */
  isBusy(c: Combatant): boolean {
    const a = this.state(c).active;
    return !!a && (a.phase === 'windup' || a.phase === 'channel');
  }

  /** True during any phase including recovery. */
  isCommitted(c: Combatant): boolean {
    const a = this.state(c).active;
    return !!a && a.phase !== 'done';
  }

  /** Current movement restriction from the active cast. */
  movementMode(c: Combatant): 'free' | 'slow' | 'root' {
    const a = this.state(c).active;
    if (!a || a.phase === 'done') return 'free';
    // The player moves freely out of most of a recovery; other benders hold their pose longer.
    if (a.phase === 'recovery' && a.recoveryLeft < a.def.recovery * (c.isPlayer ? 0.75 : 0.4)) return 'free';
    return a.def.movement;
  }

  /** Cancel the caster's cast (dodge cancel, stagger). */
  interrupt(c: Combatant, onlyInterruptible = true): boolean {
    const s = this.state(c);
    const a = s.active;
    if (!a || a.phase === 'done') return false;
    if (onlyInterruptible && a.phase === 'windup' && !a.def.interruptible) return false;
    if (a.phase === 'recovery') {
      a.phase = 'done';
      this.safeCall(() => a.def.end?.(a, false));
      s.active = null;
      return true;
    }
    a.phase = 'done';
    this.safeCall(() => a.def.end?.(a, true));
    s.active = null;
    return true;
  }

  tryCast(caster: Combatant, id: string, req: CastRequest = {}): CastResult {
    const ctx = this.ctx;
    const def = TECHNIQUES.get(id);
    const fail = (reason: TechniqueFailReason, message?: string): CastResult => {
      if (caster.isPlayer) ctx.events.emit('technique:failed', { id, reason, message });
      return { ok: false, reason, message };
    };
    if (!def) return fail('locked', 'Unknown technique');
    if (!caster.alive) return fail('state');
    if (caster.isPlayer && !req.force && !ctx.progression.knows(id)) return fail('locked', 'You have not learned this technique.');
    if (def.requires === 'avatarState' && !(caster.isPlayer && ctx.avatar.active)) return fail('state', 'Requires the Avatar State.');
    if (def.requires === 'elementsSphere' && !(caster.isPlayer && ctx.avatar.sphereActive)) return fail('state', 'Requires the Elements Sphere.');
    const s = this.state(caster);
    if (s.active && (s.active.phase === 'windup' || s.active.phase === 'channel')) return fail('busy');
    if (caster.stunned > 0 || caster.hasStatus('freeze')) return fail('state');
    const now = ctx.time.elapsed;
    if (!req.free && (s.cooldowns.get(id) ?? 0) > now) return fail('cooldown', `${def.name} is recovering.`);
    const chiCost = req.free ? 0 : def.chiCost * (caster.isPlayer ? (ctx.avatar?.boosts?.chiCost ?? 1) : 1);
    if (caster.chi < chiCost) return fail('chi', 'Not enough chi.');
    if (!def.airborne && caster.body && !caster.body.grounded && !caster.body.swimming) return fail('airborne', 'Must be grounded.');
    // [additive: waterbending] Technique-specific precondition, before any cost is paid.
    if (def.precheck) {
      let pre: { reason: TechniqueFailReason; message: string } | null = null;
      try {
        pre = def.precheck(caster, ctx);
      } catch (err) {
        console.error('[Combat] precheck error', err);
      }
      if (pre) return fail(pre.reason, pre.message);
    }

    // Aim
    const origin = caster.castOrigin('chest', new THREE.Vector3());
    const aimDir = new THREE.Vector3();
    const aimPoint = new THREE.Vector3();
    const target = req.target ?? null;
    if (req.aimDir) aimDir.copy(req.aimDir).normalize();
    else if (target) aimDir.copy(target.aimPoint(tmpV)).sub(origin).normalize();
    else aimDir.set(Math.sin(caster.yaw), 0, Math.cos(caster.yaw));
    if (req.aimPoint) aimPoint.copy(req.aimPoint);
    else if (target) target.aimPoint(aimPoint);
    else aimPoint.copy(origin).addScaledVector(aimDir, def.range || 20);

    // Water requirement (source-dependent)
    let water: WaterGrant = { amount: 0, from: null, sourceId: null, sourceType: null, frozen: false };
    if (def.water) {
      const grant = ctx.water.acquire(caster, def.water, aimDir, aimPoint);
      if (!grant) {
        // Empty hands beside a source: the waterbending module turns this press into a gather.
        const wf = ctx.water.lastFailure;
        if (wf?.reason === 'gather') return fail('gather', wf.message);
        if (caster.isPlayer) {
          ctx.events.emit('water:unavailable', { techniqueId: id, needed: def.water.amount, available: caster.waterReserve });
        }
        return fail('water', 'No nearby water source.');
      }
      water = grant;
    }

    // Combo index. Avatar Flow: the player's basic combo carries on through an element switch, and
    // every element woven into one unbroken chain makes its strikes hit harder.
    let comboIndex = 0;
    let woven = false;
    if (def.comboLength && def.comboLength > 1) {
      const live = now - s.combo.time < 1.0;
      const prev = live && s.combo.id !== id ? TECHNIQUES.get(s.combo.id) : undefined;
      if (live && s.combo.id === id) comboIndex = (s.combo.index + 1) % def.comboLength;
      else if (caster.isPlayer && def.kind === 'basic' && prev?.kind === 'basic' && prev.element !== def.element) {
        comboIndex = (s.combo.index + 1) % def.comboLength;
        woven = true;
      }
      if (!live) s.flow = [];
      if (def.element !== 'avatar' && !s.flow.includes(def.element)) s.flow.push(def.element);
      s.combo = { id, index: comboIndex, time: now };
    }
    const flowMul = def.kind === 'basic' && caster.isPlayer ? 1 + FLOW_BONUS * Math.max(0, s.flow.length - 1) : 1;

    caster.chi -= chiCost;
    if (!req.free && def.cooldown > 0) s.cooldowns.set(id, now + def.cooldown * this.cooldownScale(caster));
    if (s.active && s.active.phase === 'recovery') {
      // Cancel the previous recovery into the new technique (combo flow).
      this.safeCall(() => s.active!.def.end?.(s.active!, false));
      s.active.phase = 'done';
    }
    const power = caster.powerMultiplier() * (caster.isPlayer ? this.playerDamageDealtMul : 1) * flowMul;
    const cast = new CastImpl(this, ctx, def, caster, origin, aimDir, aimPoint, target, Math.max(0, Math.min(1, req.charge ?? 0)), power, comboIndex, water);
    s.active = cast;
    this.casts.push(cast);
    // Face the aim direction.
    if (aimDir.x !== 0 || aimDir.z !== 0) caster.yaw = Math.atan2(aimDir.x, aimDir.z);
    this.safeCall(() => def.begin?.(cast));
    if (woven) this.weaveFlourish(caster, def.element as Element, s.flow, flowMul);
    ctx.events.emit('technique:cast', { id, casterId: caster.id, element: def.element, isPlayer: caster.isPlayer, position: { x: origin.x, y: origin.y, z: origin.z } });
    if (def.windup <= 0) this.releaseCast(cast);
    return { ok: true, cast };
  }

  /** Avatar Flow: a ring of the new element round the hands, a shimmer, and the HUD counter. */
  private weaveFlourish(caster: Combatant, element: Element, flow: Element[], mul: number): void {
    const ctx = this.ctx;
    const at = caster.castOrigin('chest', tmpV3);
    const fwd = tmpV2.set(Math.sin(caster.yaw), 0, Math.cos(caster.yaw));
    ctx.vfx.ring(at, FLOW_COLORS[element], 0.9 + 0.2 * flow.length, 0.35, { normal: fwd, opacity: 0.7 });
    for (const el of flow) ctx.vfx.burst('spirit', at, { count: 4, color: FLOW_COLORS[el], speed: 1.4 });
    ctx.audio.play('hit.avatar', { position: at, volume: 0.25 + 0.06 * flow.length, pitch: 1.1 + 0.08 * flow.length });
    ctx.events.emit('combo:weave', { elements: [...flow], bonus: mul - 1 });
  }

  private releaseCast(c: CastImpl): void {
    if (c.released) return;
    c.released = true;
    // Refresh origin at release time so it follows the caster.
    c.caster.castOrigin('chest', c.origin);
    this.safeCall(() => c.def.release(c));
    if (c.def.channel && c.def.channelUpdate) {
      c.phase = 'channel';
      c.channelTime = 0;
    } else {
      c.phase = 'recovery';
      c.recoveryLeft = c.def.recovery;
    }
  }

  // ---------------------------------------------------------------------------
  // Hits
  // ---------------------------------------------------------------------------

  /** Whether `attacker` may damage `target`. */
  canHarm(attacker: Entity | null, target: Entity): boolean {
    if (!target.alive || !target.targetable || !target.health) return false;
    if (!attacker) return true;
    if (attacker === target) return false;
    if (target.kind === 'target') return attacker.team === 'player' || attacker.team === 'ally';
    return areHostile(attacker.team, target.team);
  }

  applyHit(attacker: Entity | null, target: Entity, info: HitInfo): HitResult | null {
    if (!this.canHarm(attacker, target)) return null;
    const ctx = this.ctx;
    const hit: HitInfo = { ...info };
    if (target.kind === 'player') hit.damage *= this.playerDamageTakenMul;
    const res = target.receiveHit(hit, ctx);
    if (res.damage <= 0 && !res.blocked) return res;
    const p = hit.point ?? target.aimPoint(tmpV2);
    const isPlayerAttacker = !!attacker && attacker.kind === 'player';
    ctx.events.emit('hit', {
      attackerId: attacker?.id ?? 0,
      targetId: target.id,
      targetKind: target.kind,
      damage: res.damage,
      element: hit.element,
      techniqueId: hit.techniqueId,
      position: { x: p.x, y: p.y, z: p.z },
      killed: res.killed,
      blocked: res.blocked,
      playerIsAttacker: isPlayerAttacker,
    });
    this.hitFeedback(hit.element, p, res, isPlayerAttacker, target.kind === 'player', attacker, target);
    if (isPlayerAttacker && res.damage > 0 && hit.techniqueId && TECHNIQUES.get(hit.techniqueId)?.kind === 'basic') {
      const pc = attacker as unknown as Combatant;
      pc.chi = Math.min(pc.maxChi, pc.chi + BASIC_HIT_CHI);
    }
    if (target.kind === 'player') {
      ctx.events.emit('player:damaged', { amount: res.damage, sourceId: attacker?.id, element: hit.element });
    }
    if (res.killed) {
      ctx.events.emit('entity:killed', {
        entityId: target.id,
        kind: target.kind,
        tags: [...target.tags],
        killerId: attacker?.id,
        position: { x: target.position.x, y: target.position.y, z: target.position.z },
      });
    }
    if (isPlayerAttacker && hit.element !== 'avatar') {
      ctx.progression.addProficiency(hit.element, Math.min(6, res.damage * 0.15) + (res.killed ? 4 : 0));
    }
    return res;
  }

  private hitFeedback(element: ElementOrAvatar, p: THREE.Vector3, res: HitResult, byPlayer: boolean, onPlayer: boolean, attacker: Entity | null, target: Entity): void {
    const vfx = this.ctx.vfx;
    const colors: Record<ElementOrAvatar, string> = { air: '#eef6ff', water: '#9fd8ff', earth: '#a8906a', fire: '#ffb050', avatar: '#cfefff' };
    const shake = this.ctx.settings.data.controls.cameraShake;
    if (res.blocked) {
      vfx.burst('sparks', p, { count: 8, color: '#ffffff' });
      this.ctx.audio.play('rock_impact', { position: p, volume: 0.7, pitch: 1.5 });
      if (onPlayer && shake > 0) this.ctx.events.emit('camera:shake', { intensity: 0.15, duration: 0.15 });
      return;
    }
    // Impact: each element strikes in its own way, sized by the blow.
    const k = 0.7 + Math.min(1.6, res.damage / 18);
    const heavy = res.damage >= 16 || res.staggered || res.killed;
    const n = (attacker ? tmpV3.subVectors(target.position, attacker.position).setY(0) : tmpV3.set(0, 0, 1)).normalize();
    switch (element) {
      case 'air':
        vfx.burst('air', p, { count: Math.round(9 * k), dir: n, spread: 0.9, speed: 1.4 });
        vfx.burst('swirl', p, { count: Math.round(5 * k), swirl: 6, speed: 0.6 });
        vfx.ring(p, '#f4f9ff', 0.7 * k, 0.3, { normal: n, opacity: 0.55 });
        break;
      case 'water':
        vfx.burst('splash', p, { count: Math.round(14 * k), dir: n, spread: 1.1 });
        vfx.burst('spray', p, { count: Math.round(7 * k), size: 0.8 + 0.3 * k });
        vfx.ring(p, '#c4ecff', 0.65 * k, 0.28, { normal: n, opacity: 0.5 });
        break;
      case 'earth':
        vfx.burst('debris', p, { count: Math.round(8 * k), dir: n, spread: 1.0 });
        vfx.burst('dust', p, { count: Math.round(5 * k), size: 0.7 + 0.25 * k });
        vfx.ring(p, '#cdb08a', 0.6 * k, 0.24, { normal: n, opacity: 0.45 });
        break;
      case 'fire':
        vfx.burst('fire', p, { count: Math.round(9 * k), dir: n, spread: 1.0 });
        vfx.burst('embers', p, { count: Math.round(8 * k), dir: n });
        if (heavy) vfx.burst('smoke', p, { count: 2 });
        vfx.flash(p, '#ff9a40', 2.5 + 2 * k, 0.14, 7);
        break;
      default:
        vfx.burst('spirit', p, { count: Math.round(10 * k) });
        vfx.ring(p, '#d6f2ff', 0.8 * k, 0.3, { normal: n, opacity: 0.6 });
    }
    vfx.burst('glow', p, { color: colors[element], size: 0.6 + Math.min(1.5, res.damage / 25) });
    if (heavy) vfx.ring(p, colors[element], 1.2 * k, 0.4, { normal: n, opacity: 0.35 });
    this.ctx.audio.play('hit', { position: p, volume: 0.6 + Math.min(0.4, res.damage / 50), pitch: heavy ? 0.85 : 1 });
    // Hit-freeze: the striker and the struck hold their pose for a beat, longer for heavier blows.
    if (byPlayer || onPlayer) {
      const freeze = Math.min(0.11, 0.03 + res.damage * 0.0025) * (res.killed ? 1.5 : 1);
      (target as { humanoid?: Humanoid | null }).humanoid?.hitFreeze(freeze);
      (attacker as { humanoid?: Humanoid | null } | null)?.humanoid?.hitFreeze(freeze * 0.7);
    }
    if (shake <= 0) return;
    if (onPlayer) this.ctx.events.emit('camera:shake', { intensity: Math.min(0.6, 0.15 + res.damage / 60), duration: 0.25 });
    else if (byPlayer) this.ctx.events.emit('camera:shake', { intensity: heavy ? 0.12 + Math.min(0.2, res.damage / 120) : 0.05 + res.damage / 300, duration: heavy ? 0.18 : 0.1 });
  }

  areaHit(cast: CastImpl | null, o: AreaHitOptions): Entity[] {
    const attacker = cast?.caster ?? null;
    const hits: Entity[] = [];
    const list = this.ctx.entities.queryRadius(o.center, o.radius + 1.5, undefined, this.scratch);
    for (const e of [...list]) {
      if (e === attacker && !o.includeCaster) continue;
      if (!o.friendlyFire && !this.canHarm(attacker, e)) continue;
      const ap = e.aimPoint(tmpV);
      const dx = ap.x - o.center.x, dz = ap.z - o.center.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > o.radius + e.radius) continue;
      const hh = o.height ?? o.radius;
      if (Math.abs(ap.y - o.center.y) > hh + e.height * 0.5) continue;
      if (o.cone && horiz > 0.5) {
        const dot = (dx * o.cone.dir.x + dz * o.cone.dir.z) / (horiz * Math.hypot(o.cone.dir.x, o.cone.dir.z) || 1);
        if (Math.acos(Math.max(-1, Math.min(1, dot))) > o.cone.halfAngle) continue;
      }
      const kb = new THREE.Vector3();
      if (o.knockback) {
        if (o.knockDir instanceof THREE.Vector3) kb.copy(o.knockDir).setY(0).normalize().multiplyScalar(o.knockback);
        else kb.set(dx, 0, dz).normalize().multiplyScalar(o.knockback);
      }
      const info = {
        damage: o.damage,
        knockback: kb,
        launch: o.launch,
        stagger: o.stagger,
        stun: o.stun,
        knockdown: o.knockdown,
        status: o.status,
        point: ap.clone(),
      };
      let res: HitResult | null;
      if (cast) res = cast.hit(e, info);
      else res = this.applyHit(null, e, { attacker: null, element: 'avatar', techniqueId: 'environment', ...info });
      if (res) hits.push(e);
    }
    return hits;
  }

  spawnProjectile(cast: Cast, spec: ProjectileSpec): Projectile {
    const p = new ProjectileImpl(spec, cast);
    if (spec.visual) {
      spec.visual.object.position.copy(p.position);
      this.ctx.vfx.group.add(spec.visual.object);
    }
    this.projectiles.push(p);
    return p;
  }

  private updateProjectiles(dt: number): void {
    const world = this.ctx.world;
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      const s = p.spec;
      p.age += dt;
      if (p.age >= s.life) {
        p.alive = false;
        this.safeCall(() => s.onExpire?.(p));
        continue;
      }
      if (s.homing && s.target && s.target.alive) {
        const desired = s.target.aimPoint(tmpV).sub(p.position).normalize();
        const speed = p.velocity.length();
        const cur = tmpV2.copy(p.velocity).normalize();
        const angle = cur.angleTo(desired);
        const maxTurn = s.homing * dt;
        if (angle > 1e-4) cur.lerp(desired, Math.min(1, maxTurn / angle)).normalize();
        p.velocity.copy(cur.multiplyScalar(speed));
      }
      if (s.gravity) p.velocity.y -= s.gravity * dt;
      p.position.addScaledVector(p.velocity, dt);

      // Entities
      const caster = p.cast.caster;
      const near = this.ctx.entities.queryRadius(p.position, s.radius + 2, undefined, this.scratch);
      for (const e of near) {
        if (!p.alive) break;
        if (e === caster || p.hitSet.has(e.id) || !this.canHarm(caster, e)) continue;
        // Distance from point to entity's vertical capsule segment.
        const by = e.position.y + e.radius, ty = e.position.y + e.height - e.radius;
        const cy = Math.max(by, Math.min(ty, p.position.y));
        const dx = p.position.x - e.position.x, dy = p.position.y - cy, dz = p.position.z - e.position.z;
        const rr = s.radius + e.radius;
        if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
        p.hitSet.add(e.id);
        const kb = tmpV.copy(p.velocity).setY(0);
        if (kb.lengthSq() > 0) kb.normalize().multiplyScalar(s.knockback ?? 0);
        const res = this.applyHit(caster, e, {
          attacker: caster,
          damage: s.damage * p.cast.power,
          element: p.cast.def.element,
          techniqueId: p.cast.def.id,
          knockback: kb.clone(),
          launch: s.launch,
          stagger: s.stagger,
          stun: s.stun,
          status: s.status,
          point: p.position.clone(),
          hitId: p.cast.id * 1000 + (p.id % 1000),
        });
        this.safeCall(() => s.onHitEntity?.(p, e, res));
        p.pierced++;
        if (p.pierced > (s.pierce ?? 0)) p.alive = false;
      }
      if (!p.alive) continue;

      // World
      if (s.collideWorld !== false) {
        const gh = world.heightAt(p.position.x, p.position.z);
        const hitCol = world.collision.overlapSphere(p.position, s.radius * 0.8);
        if (p.position.y - s.radius * 0.5 < gh || hitCol) {
          if (p.position.y < gh) p.position.y = gh + 0.05;
          p.alive = false;
          this.safeCall(() => s.onHitWorld?.(p, p.position.clone()));
        }
      }
    }
    // Visuals & cleanup
    for (const p of this.projectiles) {
      const v = p.spec.visual;
      if (!v) continue;
      if (p.alive) {
        v.object.position.copy(p.position);
        this.safeCall(() => v.update(p, dt));
      }
    }
    const dead = this.projectiles.filter((p) => !p.alive);
    if (dead.length) {
      for (const p of dead) {
        const v = p.spec.visual;
        if (v) {
          this.ctx.vfx.group.remove(v.object);
          this.safeCall(() => v.dispose());
        }
      }
      this.projectiles = this.projectiles.filter((p) => p.alive);
    }
  }

  update(dt: number): void {
    for (const c of this.casts) {
      if (c.phase === 'done') continue;
      const tempo = c.caster.isPlayer ? PLAYER_TEMPO : 1;
      c.elapsed += dt * tempo;
      if (!c.caster.alive) {
        c.phase = 'done';
        this.safeCall(() => c.def.end?.(c, true));
        continue;
      }
      if (c.phase === 'windup') {
        if (c.caster.stunned > 0 && c.def.interruptible) {
          c.phase = 'done';
          this.safeCall(() => c.def.end?.(c, true));
          continue;
        }
        if (c.elapsed >= c.def.windup) this.releaseCast(c);
      } else if (c.phase === 'channel') {
        c.channelTime += dt;
        let keep = true;
        this.safeCall(() => {
          keep = c.def.channelUpdate!(c, dt);
        });
        if (!keep || c.channelTime >= (c.def.channel ?? 0)) {
          c.phase = 'recovery';
          c.recoveryLeft = c.def.recovery;
        }
      } else if (c.phase === 'recovery') {
        c.recoveryLeft -= dt * tempo;
        if (c.recoveryLeft <= 0) {
          c.phase = 'done';
          this.safeCall(() => c.def.end?.(c, false));
        }
      }
    }
    for (const c of this.casts) {
      if (c.phase !== 'done') continue;
      const s = this.states.get(c.caster);
      if (s && s.active === c) s.active = null;
    }
    this.casts = this.casts.filter((c) => c.phase !== 'done');
    // The player's bending animation runs at the bending tempo while a technique is committed.
    const pl = this.ctx.player;
    if (pl?.humanoid) pl.humanoid.timeScale = this.isCommitted(pl) ? PLAYER_TEMPO : 1;
    this.updateProjectiles(dt);
  }

  get projectileCount(): number {
    return this.projectiles.length;
  }

  // ---------------------------------------------------------------------------
  // [additive: waterbending] Projectile queries for shields / constructs that
  // stop or redirect projectiles. Does not change existing behaviour.
  // ---------------------------------------------------------------------------

  /** Live projectiles whose centre is within `radius` of `center` (any owner). */
  projectilesInRadius(center: THREE.Vector3, radius: number, out: Projectile[] = []): Projectile[] {
    out.length = 0;
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      const r = radius + p.spec.radius;
      if (p.position.distanceToSquared(center) <= r * r) out.push(p);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // [additive: air/fire/earth bending] Projectile redirection (Air Shield,
  // Wind Redirection) and detached damage sources. Does not change existing
  // behaviour.
  // ---------------------------------------------------------------------------

  /**
   * Hand a live projectile to a new owner (deflect / reflect). It keeps its spec
   * (damage, statuses, visual) but now belongs to `by` via technique
   * `techniqueId`: it can hit by's enemies — including its former owner — and no
   * longer hits `by`. Hit memory is cleared and its life is extended.
   * Projectile callbacks should use `p.cast` (not a captured cast) so follow-up
   * explosions are attributed to the new owner.
   */
  redirectProjectile(
    p: Projectile,
    by: Combatant,
    techniqueId: string,
    velocity: THREE.Vector3,
    opts: { target?: Entity | null; homing?: number; damageMul?: number; extraLife?: number } = {},
  ): boolean {
    const impl = p as ProjectileImpl;
    if (!impl.alive) return false;
    const def = TECHNIQUES.get(techniqueId) ?? impl.cast.def;
    const dir = velocity.clone().normalize();
    (impl as { cast: Cast }).cast = this.detachedCast(by, def, impl.position, dir, opts.target ?? null);
    impl.velocity.copy(velocity);
    impl.hitSet.clear();
    impl.pierced = 0;
    impl.age = Math.max(0, impl.age - (opts.extraLife ?? impl.spec.life * 0.6));
    if (opts.damageMul) impl.spec.damage *= opts.damageMul;
    if (opts.target !== undefined) {
      impl.spec.target = opts.target;
      if (opts.homing !== undefined) impl.spec.homing = opts.homing;
    }
    return true;
  }

  /**
   * A cast that is not simulated (no windup/channel/recovery). Damage source for
   * things that outlive their technique (reflected projectiles, lingering
   * flames); hit()/areaHit() keep their own dedup set.
   */
  detachedCast(caster: Combatant, def: TechniqueDef, origin: THREE.Vector3, aimDir: THREE.Vector3, target: Entity | null = null): Cast {
    const power = caster.powerMultiplier() * (caster.isPlayer ? this.playerDamageDealtMul : 1);
    const water: WaterGrant = { amount: 0, from: null, sourceId: null, sourceType: null, frozen: false };
    const aimPoint = origin.clone().addScaledVector(aimDir, def.range || 10);
    const c = new CastImpl(this, this.ctx, def, caster, origin.clone(), aimDir.clone(), aimPoint, target, 0, power, 0, water);
    c.released = true;
    c.phase = 'done';
    return c;
  }

  /** Casts currently simulated (tests check for runaway casts). */
  get activeCastCount(): number {
    return this.casts.length;
  }

  /** Clear all casts/projectiles (session end). */
  clear(): void {
    for (const c of this.casts) {
      c.phase = 'done';
      this.safeCall(() => c.def.end?.(c, true));
    }
    this.casts = [];
    for (const p of this.projectiles) {
      p.alive = false;
      if (p.spec.visual) {
        this.ctx.vfx.group.remove(p.spec.visual.object);
        this.safeCall(() => p.spec.visual!.dispose());
      }
    }
    this.projectiles = [];
    this.states = new WeakMap();
  }

  onSessionEnd(): void {
    this.clear();
  }
}
