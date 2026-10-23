import * as THREE from 'three';
import type { GameContext, GameSystem } from '../../../core/GameContext';
import type { Action } from '../../../core/Input';
import type { Element } from '../../../core/types';
import type { Entity } from '../../../entities/Entity';
import type { Player } from '../../../player/Player';
import { constructCount, liveConstructs } from '../../../vfx/effects/constructs';
import { DebrisField } from '../../../vfx/effects/debris';
import { clearEffects, effectCount, setDebrisField, updateEffects } from '../../../vfx/effects/loop';
import { FX_TIME } from '../../../vfx/effects/materials';
import { getTechnique } from '../../CombatSystem';
import type { Cast, Combatant } from '../../types';
import { SparringDummy } from './SparringDummy';

/**
 * Bending runtime for the air / fire / earth movesets.
 *
 * Two GameSystems (registered in src/modules.ts):
 *  - `bending` (order 25, BEFORE entities/player): forced-motion "movers"
 *    (dashes, scooter, surf, leaps — they drive KinematicBody.external so
 *    collision still applies) and channel input semantics (hold / toggle).
 *  - `bending_fx` (order 850, after combat, before vfx/camera): effect loop,
 *    constructs, debris, charge visuals, seismic markers.
 *
 * Element modules plug in through bending.hook({...}).
 */

export interface MoverVelocity {
  x: number;
  z: number;
  /** Optional vertical velocity override (m/s). */
  y?: number;
}

export interface Mover {
  entity: Entity;
  /** Desired velocity this frame, or null to stop. */
  step(dt: number): MoverVelocity | null;
  /** Called once when the mover is removed (stopped, replaced or session end). */
  done?(): void;
}

export interface MoverHandle {
  stop(): void;
  readonly active: boolean;
}

/** Hold: channel lasts while the slot key is held. Toggle: press again (or attack/dodge) to end. */
export type ChannelMode = 'hold' | 'toggle';

interface ChannelInput {
  mode: ChannelMode;
  action: Action | null;
  /** Minimum channel seconds before a release/toggle ends it. */
  min: number;
  /** Duration used when not key-driven (AI / scripted casts). */
  auto: number;
  /** For toggles: other actions that end the channel without being consumed. */
  breakOn: Action[];
}

export interface BenderState {
  /** Time of the last dodge / air dash (air: slipstream window). */
  lastEvade: number;
  /** Fire momentum stacks (0..5), refreshed by landing fire hits. */
  heat: number;
  heatTime: number;
  /** Earth: counter window after a block / perfect guard. */
  counterUntil: number;
  /** Seismic sense cooldown. */
  seismicReady: number;
}

export interface ChargeFx {
  update(dt: number, charge: number): void;
  end(): void;
}

export interface RuntimeHook {
  init?(ctx: GameContext): void;
  sessionStart?(ctx: GameContext): void;
  sessionEnd?(ctx: GameContext): void;
  /** Before entities/player update. */
  pre?(dt: number, ctx: GameContext): void;
  /** After combat, before vfx/camera. */
  post?(dt: number, ctx: GameContext): void;
}

interface MoverEntry {
  m: Mover;
  alive: boolean;
}

class BendingRuntime {
  ctx: GameContext | null = null;
  debris: DebrisField | null = null;
  private movers: MoverEntry[] = [];
  private hooks: RuntimeHook[] = [];
  private states = new WeakMap<Entity, BenderState>();
  private warmed = false;

  // ---------------------------------------------------------------------------
  // Systems
  // ---------------------------------------------------------------------------

  readonly pre: GameSystem = {
    init: (ctx) => this.init(ctx),
    onSessionStart: (ctx) => this.sessionStart(ctx),
    onSessionEnd: (ctx) => this.sessionEnd(ctx),
    update: (dt, ctx) => this.preUpdate(dt, ctx),
  };

  readonly fx: GameSystem = {
    update: (dt, ctx) => this.postUpdate(dt, ctx),
  };

  hook(h: RuntimeHook): void {
    this.hooks.push(h);
    if (this.ctx) h.init?.(this.ctx);
  }

  /**
   * Gathering visual + held pose while the player charges a heavy technique of
   * `element` (hold Aim). The release itself is the technique's job.
   */
  chargeVisual(element: Element, make: (ctx: GameContext, p: Player) => ChargeFx, clip?: string): void {
    let fx: ChargeFx | null = null;
    let clipOn = false;
    const stop = (p: Player | null) => {
      if (fx) {
        try {
          fx.end();
        } catch (err) {
          console.error('[bending] charge fx end failed', err);
        }
      }
      fx = null;
      if (clipOn && clip && p) p.humanoid.animator.stop(clip, 0.12);
      clipOn = false;
    };
    this.hook({
      post: (dt, ctx) => {
        const p = ctx.player as Player | null;
        const charge = p && p.element === element && !p.defeated ? p.charging : 0;
        if (p && charge > 0) {
          if (!fx) {
            fx = make(ctx, p);
            if (clip) {
              p.humanoid.animator.play(clip, { hold: true, fadeIn: 0.14 });
              clipOn = true;
            }
          }
          fx.update(dt, charge);
        } else if (fx) stop(p);
      },
      sessionEnd: (ctx) => stop(ctx.player as Player | null),
    });
  }

  private init(ctx: GameContext): void {
    this.ctx = ctx;
    const cap = ctx.settings.data.graphics.effectsQuality === 'low' ? 90 : ctx.settings.data.graphics.effectsQuality === 'medium' ? 160 : 240;
    this.debris = new DebrisField(cap);
    ctx.vfx.group.add(this.debris.mesh);
    setDebrisField(this.debris);
    ctx.events.on('player:dodged', () => {
      const p = ctx.player;
      if (p) this.state(p).lastEvade = ctx.time.elapsed;
    });
    ctx.events.on('hit', (e) => {
      if (e.element !== 'fire' || !e.attackerId || e.damage <= 0) return;
      const a = ctx.entities.get(e.attackerId);
      if (!a) return;
      const s = this.state(a);
      if (ctx.time.elapsed - s.heatTime > 1.6) s.heat = 0;
      s.heat = Math.min(5, s.heat + (e.techniqueId === 'fire_jab' ? 1 : 0.5));
      s.heatTime = ctx.time.elapsed;
    });
    for (const h of this.hooks) h.init?.(ctx);
    this.installDebug(ctx);
  }

  private sessionStart(ctx: GameContext): void {
    this.installDebug(ctx);
    if (!this.warmed) {
      this.warmed = true;
      try {
        warmupShaders(ctx);
      } catch (err) {
        console.warn('[bending] shader warmup failed', err);
      }
    }
    for (const h of this.hooks) h.sessionStart?.(ctx);
  }

  private sessionEnd(ctx: GameContext): void {
    for (const h of this.hooks) {
      try {
        h.sessionEnd?.(ctx);
      } catch (err) {
        console.error('[bending] hook sessionEnd failed', err);
      }
    }
    for (const e of this.movers) {
      e.alive = false;
      e.m.done?.();
    }
    this.movers = [];
    clearEffects();
    this.debris?.clear();
    this.states = new WeakMap();
  }

  private preUpdate(dt: number, ctx: GameContext): void {
    FX_TIME.value += dt;
    this.channelInput(ctx);
    // Movers drive KinematicBody.external (compensated for this frame's friction decay)
    // so the body's own step() resolves collisions as usual.
    for (const entry of this.movers) {
      if (!entry.alive) continue;
      const e = entry.m.entity;
      const b = e.body;
      if (!b || !e.alive || e.disposed) {
        this.endMover(entry);
        continue;
      }
      let v: MoverVelocity | null = null;
      try {
        v = entry.m.step(dt);
      } catch (err) {
        console.error('[bending] mover failed', err);
      }
      if (!v) {
        this.endMover(entry);
        continue;
      }
      const decay = Math.exp(-(b.grounded ? 7 : 1.2) * dt);
      b.external.x = v.x / decay;
      b.external.z = v.z / decay;
      b.move.set(0, 0, 0);
      if (v.y !== undefined) {
        b.velocity.y = v.y;
        if (v.y > 0.01) b.grounded = false;
      }
    }
    this.movers = this.movers.filter((m) => m.alive);
    for (const h of this.hooks) h.pre?.(dt, ctx);
  }

  private postUpdate(dt: number, ctx: GameContext): void {
    updateEffects(dt);
    this.debris?.update(dt, (x, z) => ctx.world.heightAt(x, z));
    for (const h of this.hooks) {
      try {
        h.post?.(dt, ctx);
      } catch (err) {
        console.error('[bending] hook post failed', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Movers
  // ---------------------------------------------------------------------------

  /** Drive an entity's horizontal (and optionally vertical) velocity. Replaces its previous mover. */
  drive(m: Mover): MoverHandle {
    for (const e of this.movers) if (e.alive && e.m.entity === m.entity) this.endMover(e);
    const entry: MoverEntry = { m, alive: true };
    this.movers.push(entry);
    return {
      stop: () => this.endMover(entry),
      get active() {
        return entry.alive;
      },
    };
  }

  private endMover(entry: MoverEntry): void {
    if (!entry.alive) return;
    entry.alive = false;
    try {
      entry.m.done?.();
    } catch (err) {
      console.error('[bending] mover done failed', err);
    }
  }

  isDriven(e: Entity): boolean {
    return this.movers.some((m) => m.alive && m.m.entity === e);
  }

  // ---------------------------------------------------------------------------
  // Channel input (player): hold-to-maintain / press-again toggles
  // ---------------------------------------------------------------------------

  /**
   * Configure how a channel ends. Call from begin(). Player casts started from a
   * held slot key follow the key; AI/scripted casts run for `auto` seconds.
   */
  channel(cast: Cast, mode: ChannelMode, o: { min?: number; auto: number; breakOn?: Action[] }): void {
    const ctx = cast.ctx;
    let action: Action | null = null;
    if (cast.isPlayer) {
      const slots = ctx.progression.slotsFor(cast.caster.element);
      const i = slots.indexOf(cast.def.id);
      const a = i >= 0 ? (['ability1', 'ability2', 'ability3', 'ability4'] as const)[i] : null;
      if (a && ctx.input.isDown(a)) action = a;
    }
    const ci: ChannelInput = { mode, action, min: o.min ?? 0.3, auto: o.auto, breakOn: o.breakOn ?? [] };
    cast.data.__channel = ci;
    cast.data.__chStart = -1;
  }

  /**
   * Call at the top of channelUpdate(): returns false when the channel should end
   * (key released, toggled off, or auto duration reached).
   */
  channelKeep(cast: Cast, dt: number): boolean {
    const ci = cast.data.__channel as ChannelInput | undefined;
    if (cast.data.__chStart < 0 || cast.data.__chStart === undefined) cast.data.__chStart = cast.elapsed - dt;
    const t = cast.elapsed - cast.data.__chStart;
    if (!ci) return true;
    if (cast.data.__stop) return false;
    if (!ci.action) return t < ci.auto;
    if (ci.mode === 'hold') return t < ci.min || this.ctx!.input.isDown(ci.action);
    return true;
  }

  /** Seconds since the channel phase began. */
  channelTime(cast: Cast): number {
    const s = cast.data.__chStart;
    return s === undefined || s < 0 ? 0 : cast.elapsed - s;
  }

  private channelInput(ctx: GameContext): void {
    const p = ctx.player;
    if (!p) return;
    const cast = ctx.combat.activeCast(p);
    if (!cast || cast.phase !== 'channel') return;
    const ci = cast.data.__channel as ChannelInput | undefined;
    if (!ci || ci.mode !== 'toggle') return;
    const t = this.channelTime(cast);
    const input = ctx.input;
    if (ci.action && input.wasPressed(ci.action) && t > ci.min) {
      input.consume(ci.action);
      cast.data.__stop = true;
      cast.finish();
      return;
    }
    for (const a of ci.breakOn) {
      if (input.wasPressed(a) && t > 0.1) {
        cast.data.__stop = true;
        cast.data.__brokenBy = a;
        cast.finish();
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-bender state (rhythm mechanics)
  // ---------------------------------------------------------------------------

  state(e: Entity): BenderState {
    let s = this.states.get(e);
    if (!s) {
      s = { lastEvade: -99, heat: 0, heatTime: -99, counterUntil: -99, seismicReady: 0 };
      this.states.set(e, s);
    }
    return s;
  }

  /** Air: true within the slipstream window after a dodge / air dash. */
  slipstream(c: Combatant, window = 0.75): boolean {
    const ctx = this.ctx;
    return !!ctx && ctx.time.elapsed - this.state(c).lastEvade < window;
  }

  /** Fire: current momentum stacks (decays 1.6 s after the last hit). */
  heat(c: Combatant): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const s = this.state(c);
    if (ctx.time.elapsed - s.heatTime > 1.6) s.heat = 0;
    return s.heat;
  }

  /** Earth: counter window open? Consumes it when `consume`. */
  counter(c: Combatant, consume = false): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const s = this.state(c);
    const open = ctx.time.elapsed < s.counterUntil;
    if (open && consume) s.counterUntil = -99;
    return open;
  }

  openCounter(c: Combatant, seconds: number): void {
    if (!this.ctx) return;
    this.state(c).counterUntil = this.ctx.time.elapsed + seconds;
  }

  // ---------------------------------------------------------------------------
  // Debug / automation (window.__game.debug.bending)
  // ---------------------------------------------------------------------------

  private installDebug(ctx: GameContext): void {
    const g = (globalThis as any).__game;
    if (!g || !g.debug || g.debug.bending) return;
    g.debug.bending = {
      /** Spawn a movable sparring dummy in front of the player. */
      spawnTarget: (dist = 6, side = 0, hp = 400) => {
        const p = ctx.player;
        if (!p) return null;
        const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const r = new THREE.Vector3(-f.z, 0, f.x);
        const pos = p.position.clone().addScaledVector(f, dist).addScaledVector(r, side);
        pos.y = ctx.world.groundAt(pos.x, pos.z, pos.y + 5).y;
        const d = new SparringDummy(hp);
        d.position.copy(pos);
        ctx.entities.add(d);
        return { id: d.id, x: pos.x, y: pos.y, z: pos.z };
      },
      target: (id: number) => {
        const e = ctx.entities.get(id) as SparringDummy | undefined;
        if (!e) return null;
        return {
          id: e.id,
          x: e.position.x,
          y: e.position.y,
          z: e.position.z,
          hp: e.health?.hp ?? 0,
          totalDamage: e.totalDamage ?? 0,
          hits: e.hits ?? 0,
          lastElement: e.lastElement ?? null,
          maxLaunch: e.maxLaunch ?? 0,
          knockdowns: e.knockdowns ?? 0,
          statuses: e.statuses.map((s) => s.type),
          grounded: e.body?.grounded ?? true,
          vy: e.body?.velocity.y ?? 0,
        };
      },
      /**
       * Turn sparring dummy `fromId` hostile and fire a test bolt at the player
       * (shield / redirect / wall / guard tests). Returns false if impossible.
       */
      shootAt: (fromId: number, o: { speed?: number; damage?: number; radius?: number; life?: number; at?: { x: number; y: number; z: number } } = {}) => {
        const from = ctx.entities.get(fromId);
        const p = ctx.player;
        const def = getTechnique('fire_jab');
        if (!(from instanceof SparringDummy) || !p || !def) return false;
        from.team = 'hostile';
        const origin = from.castOrigin('chest', new THREE.Vector3());
        const aim = o.at ? new THREE.Vector3(o.at.x, o.at.y, o.at.z) : p.aimPoint(new THREE.Vector3());
        const dir = aim.sub(origin).normalize();
        origin.addScaledVector(dir, from.radius + 0.35);
        const r = o.radius ?? 0.28;
        const mat = new THREE.MeshBasicMaterial({ color: '#ff7a2a' });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(r * 1.2, 10, 8), mat);
        ctx.vfx.group.add(mesh);
        ctx.combat.detachedCast(from, def, origin, dir, p).projectile({
          position: origin,
          velocity: dir.clone().multiplyScalar(o.speed ?? 16),
          radius: r,
          life: o.life ?? 3,
          damage: o.damage ?? 10,
          knockback: 3,
          visual: {
            object: mesh,
            update: (pr) => mesh.position.copy(pr.position),
            dispose: () => {
              mesh.removeFromParent();
              mesh.geometry.dispose();
              mat.dispose();
            },
          },
        });
        return true;
      },
      /** Live projectiles with their current owner (deflection tests). */
      projectiles: () =>
        ctx.combat.projectilesInRadius(ctx.player?.position ?? new THREE.Vector3(), 1e5).map((pr) => ({
          owner: pr.cast.caster.id,
          technique: pr.cast.def.id,
          x: pr.position.x,
          y: pr.position.y,
          z: pr.position.z,
          vx: pr.velocity.x,
          vz: pr.velocity.z,
        })),
      /** Reset the player's cooldowns and refill chi (test loops). */
      refresh: () => {
        const p = ctx.player;
        if (!p) return;
        const st = (ctx.combat as unknown as { states: WeakMap<Entity, { cooldowns: Map<string, number> }> }).states.get(p);
        st?.cooldowns.clear();
        p.chi = p.maxChi;
        this.state(p).heat = 0;
      },
      stats: () => ({
        constructs: constructCount(),
        constructKinds: [...liveConstructs()].map((c) => c.kind),
        effects: effectCount(),
        movers: this.movers.filter((m) => m.alive).length,
        debris: this.debris?.live ?? 0,
        colliders: ctx.world.collision.count,
        /** Colliders created by bending constructs (tag 'bending') — leak checks independent of world streaming. */
        bendingColliders: countTagged(ctx, 'bending'),
        projectiles: ctx.combat.projectileCount,
        particles: ctx.vfx.particleCount,
        casts: ctx.combat.activeCastCount,
      }),
      activeCast: () => {
        const p = ctx.player;
        const c = p ? ctx.combat.activeCast(p) : null;
        return c ? { id: c.def.id, phase: c.phase, elapsed: c.elapsed } : null;
      },
      player: () => {
        const p = ctx.player as Player | null;
        if (!p) return null;
        return {
          x: p.position.x,
          y: p.position.y,
          z: p.position.z,
          vy: p.body?.velocity.y ?? 0,
          grounded: p.body?.grounded ?? true,
          guarding: p.guarding,
          statuses: p.statuses.map((s) => s.type),
          chi: p.chi,
          hp: p.health?.hp ?? 0,
          heat: this.heat(p),
        };
      },
    };
  }
}

export const bending = new BendingRuntime();

/** Debug: number of live colliders carrying `tag` (reads CollisionWorld's table; -1 if unavailable). */
function countTagged(ctx: GameContext, tag: string): number {
  const table = (ctx.world.collision as unknown as { colliders?: Map<number, { tag?: string }> }).colliders;
  if (!(table instanceof Map)) return -1;
  let n = 0;
  for (const c of table.values()) if (c.tag === tag) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Shader warmup: compile the bending programs once so the first cast doesn't hitch.
// ---------------------------------------------------------------------------

const warmupFns: Array<(group: THREE.Group) => void> = [];
/** Warmup materials are kept alive so their compiled programs stay cached for real effects. */
const warmKeep: THREE.Material[] = [];

/** Element modules register meshes whose materials should be precompiled. */
export function registerWarmup(fn: (group: THREE.Group) => void): void {
  warmupFns.push(fn);
}

function warmupShaders(ctx: GameContext): void {
  const group = new THREE.Group();
  for (const f of warmupFns) f(group);
  if (!group.children.length) return;
  group.position.copy(ctx.camera.position);
  ctx.scene.add(group);
  try {
    ctx.render.renderer.compile(ctx.scene, ctx.camera);
  } finally {
    ctx.scene.remove(group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.geometry.userData.shared) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) if (!mat.userData.shared) warmKeep.push(mat);
    });
  }
}
