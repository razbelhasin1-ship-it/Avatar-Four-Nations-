import * as THREE from 'three';
import type { Cast, TechniqueDef } from '../combat/types';
import type { GameContext, GameSystem } from '../core/GameContext';
import type { Persistable } from '../core/Save';
import { constructCount } from '../vfx/effects/constructs';
import { effectCount } from '../vfx/effects/loop';
import './clips';
import { AvatarAura } from './fx/AvatarAura';
import { environmentReact } from './fx/common';
import { ElementsSphere, SPHERE_SEQUENCE } from './fx/ElementsSphere';

/**
 * Avatar State controller.
 *  - Standard Avatar State: available from the start, toggled at will with the
 *    dedicated input (rebindable, T by default). A short (<1 s) transformation:
 *    levitation stance, eyes ignite, tattoos glow (or a luminous outline when
 *    the character has none), an energy aura, hair/cloth stirred by the surge,
 *    an expanding energy wave that knocks enemies back (CombatSystem areaHit)
 *    and makes the surroundings react. Control never leaves the player.
 *  - Elements Sphere: when progression.elementsSphereUnlocked, the same input
 *    enters the upgraded form: build-up, burst, the four elements arrive one
 *    after another and converge into a rotating formation, then an outward
 *    wave. Ability slots become the ultimates (Player maps them).
 *
 * Spirit energy: ~90 s of continuous use from full (~75 s in the sphere),
 * refilling while inactive; entering needs 20%. No long cooldown, no fixed
 * duration. Ultimates spend spirit (`spendSpirit`).
 *
 * Every gameplay boost lives in `boosts` (single source of truth read by the
 * Player, CombatSystem, water sources and the HUD). Deactivation (input,
 * empty spirit, defeat, mounting, travel, session end, load) restores the
 * character exactly: glow, hover, wind, lights and meshes are released.
 *
 * Public API used elsewhere: active, sphereActive, spirit, maxSpirit,
 * powerBonus, boosts, toggle/activate/deactivate, canActivate, spendSpirit.
 */

export interface AvatarBoosts {
  /** Outgoing damage multiplier (powerBonus). */
  power: number;
  /** Incoming damage multiplier. */
  damageTaken: number;
  /** Incoming knockback multiplier. */
  knockbackTaken: number;
  /** Outgoing knockback multiplier. */
  knockback: number;
  /** Technique cooldown multiplier. */
  cooldown: number;
  /** Chi cost multiplier. */
  chiCost: number;
  /** Extra chi regenerated per second. */
  chiRegen: number;
  /** Water draw range multiplier. */
  waterRange: number;
  /** Movement speed multiplier. */
  speed: number;
  /** Jump velocity multiplier. */
  jump: number;
}

const NO_BOOST: Readonly<AvatarBoosts> = Object.freeze({ power: 1, damageTaken: 1, knockbackTaken: 1, knockback: 1, cooldown: 1, chiCost: 1, chiRegen: 0, waterRange: 1, speed: 1, jump: 1 });
const STANDARD_BOOST: Readonly<AvatarBoosts> = Object.freeze({ power: 1.5, damageTaken: 0.6, knockbackTaken: 0.4, knockback: 1.3, cooldown: 0.6, chiCost: 0.5, chiRegen: 12, waterRange: 1.8, speed: 1.12, jump: 1.15 });
const SPHERE_BOOST: Readonly<AvatarBoosts> = Object.freeze({ power: 1.9, damageTaken: 0.5, knockbackTaken: 0.25, knockback: 1.45, cooldown: 0.5, chiCost: 0.4, chiRegen: 16, waterRange: 2.2, speed: 1.15, jump: 1.2 });

/** Spirit needed to enter the Avatar State. */
export const SPIRIT_TO_ENTER = 20;

/**
 * Unregistered technique used as the damage source of the activation waves:
 * hits go through CombatSystem (team rules, events, per-wave dedup) and never
 * touch the Avatar, companions or civilians. Never listed or learnable.
 */
const WAVE_DEF: TechniqueDef = {
  id: 'avatar_wave',
  name: 'Avatar State',
  element: 'avatar',
  kind: 'passive',
  tier: 1,
  description: 'The energy wave released by the Avatar State.',
  usage: '',
  icon: 'avatar',
  chiCost: 0,
  cooldown: 0,
  windup: 0,
  recovery: 0,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 8,
  release() {},
};

interface PendingWave {
  t: number;
  radius: number;
  knockback: number;
  launch: number;
  damage: number;
  color: string;
}

type Visual = AvatarAura | ElementsSphere;

const tmp = new THREE.Vector3();

export class AvatarStateSystem implements GameSystem, Persistable {
  readonly saveKey = 'avatarState';
  private ctx!: GameContext;
  active = false;
  sphereActive = false;
  /** 0..100 */
  spirit = 100;
  readonly maxSpirit = 100;
  drainPerSec = 100 / 90;
  sphereDrainPerSec = 100 / 75;
  regenPerSec = 100 / 40;
  /** Seconds left of the activation sequence (control is never locked). */
  transition = 0;
  /** Number of activations this session (debug / tests). */
  activations = 0;
  private toggleCooldown = 0;
  private glow = 0;
  private aura: AvatarAura | null = null;
  private sphere: ElementsSphere | null = null;
  /** Visuals fading out after deactivation (disposed when finished or on the next activation). */
  private fading: Visual[] = [];
  private waves: PendingWave[] = [];
  private readonly lastPos = new THREE.Vector3();
  private hasLastPos = false;
  /** Late-frame driver (registered as module 'avatar_fx'): visuals follow the player after it moved. */
  readonly late: GameSystem = { update: (dt) => this.lateUpdate(dt) };

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.installDebug();
  }

  /** All gameplay modifiers of the current state (identity when inactive). */
  get boosts(): Readonly<AvatarBoosts> {
    return this.sphereActive ? SPHERE_BOOST : this.active ? STANDARD_BOOST : NO_BOOST;
  }

  /** Damage multiplier while active. */
  get powerBonus(): number {
    return this.boosts.power;
  }

  /** Live Elements Sphere formation (ultimates make it converge / flare). */
  get sphereFx(): ElementsSphere | null {
    return this.sphere;
  }

  canActivate(): boolean {
    const p = this.ctx.player;
    if (!p || !p.alive || p.defeated || !this.ctx.progression.avatarStateUnlocked) return false;
    if (this.ctx.ui.blocksGameplay || this.ctx.companions.mounted) return false;
    return this.spirit >= SPIRIT_TO_ENTER;
  }

  /** Spend spirit (ultimates). Returns false (and spends nothing) if there is not enough. */
  spendSpirit(amount: number): boolean {
    if (this.spirit < amount) return false;
    this.spirit = Math.max(0, this.spirit - amount);
    return true;
  }

  toggle(): void {
    if (this.toggleCooldown > 0) return;
    this.toggleCooldown = 0.35;
    if (this.active) this.deactivate();
    else this.activate();
  }

  activate(): boolean {
    if (this.active) return true;
    const ctx = this.ctx;
    if (!this.canActivate()) {
      if (this.spirit < SPIRIT_TO_ENTER) ctx.events.emit('ui:notify', { text: 'Your spirit needs rest before entering the Avatar State.', kind: 'warning', duration: 2.5 });
      return false;
    }
    const p = ctx.player!;
    this.flushFading();
    this.active = true;
    this.sphereActive = ctx.progression.elementsSphereUnlocked;
    this.activations++;
    this.transition = this.sphereActive ? SPHERE_SEQUENCE : 0.75;
    this.aura = new AvatarAura(ctx, p, this.sphereActive);
    const moving = p.body ? Math.hypot(p.body.velocity.x, p.body.velocity.z) > 1.5 : false;
    const anim = p.humanoid?.animator;
    if (this.sphereActive) {
      this.sphere = new ElementsSphere(ctx, p);
      anim?.play(moving ? 'avatar_awaken_upper' : 'avatar_sphere_awaken', { fadeIn: 0.06 });
      ctx.audio.play('avatar.sphere.activate', { position: p.position, volume: 1 });
      // Build-up → initial burst (small) ... four elements ... outward wave (large).
      this.waves.push({ t: 0.5, radius: 6.5, knockback: 10, launch: 2, damage: 4, color: '#e8f4ff' });
      this.waves.push({ t: SPHERE_SEQUENCE - 0.05, radius: 10, knockback: 15, launch: 4.5, damage: 10, color: '#fff2d8' });
      ctx.events.emit('camera:impulse', { pullback: 3.5, fovKick: 7, duration: SPHERE_SEQUENCE + 0.6 });
    } else {
      anim?.play(moving ? 'avatar_awaken_upper' : 'avatar_awaken', { fadeIn: 0.05 });
      ctx.audio.play('avatar_surge', { position: p.position, volume: 1 });
      this.waves.push({ t: 0.3, radius: 7, knockback: 11, launch: 2.5, damage: 5, color: '#bfe8ff' });
      ctx.events.emit('camera:impulse', { pullback: 1.6, fovKick: 6, duration: 1.1 });
    }
    ctx.events.emit('camera:shake', { intensity: 0.2, duration: 0.35 });
    ctx.events.emit('avatarState:changed', { active: true, sphere: this.sphereActive });
    return true;
  }

  /** Leave the Avatar State. `quiet` skips the release burst/sound (travel, session end, load). */
  deactivate(quiet = false): void {
    if (!this.active) return;
    const ctx = this.ctx;
    this.active = false;
    this.sphereActive = false;
    this.transition = 0;
    this.waves.length = 0;
    this.glow = 0;
    const p = ctx.player;
    p?.humanoid?.setGlow(0, 0);
    if (this.aura) {
      this.aura.release(quiet);
      this.fading.push(this.aura);
      this.aura = null;
    }
    if (this.sphere) {
      this.sphere.release(quiet);
      this.fading.push(this.sphere);
      this.sphere = null;
    }
    if (quiet) this.flushFading();
    else if (p) {
      ctx.vfx.burst('spirit', p.aimPoint(tmp), { count: 18, speed: 1 });
      ctx.audio.play('avatar.release', { position: p.position, volume: 0.8 });
    }
    ctx.events.emit('avatarState:changed', { active: false, sphere: false });
  }

  update(dt: number): void {
    this.toggleCooldown = Math.max(0, this.toggleCooldown - dt);
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return;
    if (ctx.input.wasPressed('avatarState')) this.toggle();
    // Travel (fast travel / teleports): leave the state without a trace.
    if (this.active && this.hasLastPos && p.position.distanceToSquared(this.lastPos) > 40 * 40) this.deactivate(true);
    this.lastPos.copy(p.position);
    this.hasLastPos = true;
    if (this.active) {
      this.transition = Math.max(0, this.transition - dt);
      this.spirit = Math.max(0, this.spirit - (this.sphereActive ? this.sphereDrainPerSec : this.drainPerSec) * dt);
      if (this.spirit <= 0) {
        ctx.events.emit('ui:notify', { text: 'Your spirit is spent — the Avatar State fades.', kind: 'avatar', duration: 2.5 });
        this.deactivate();
      } else if (!p.alive || p.defeated || ctx.companions.mounted) this.deactivate(!p.alive || p.defeated);
    } else {
      this.spirit = Math.min(this.maxSpirit, this.spirit + this.regenPerSec * dt);
    }
    if (this.active) {
      this.glow = Math.min(1, this.glow + dt * 4);
      p.humanoid?.setGlow(this.glow, this.glow, this.sphereActive ? '#e6f6ff' : '#c8ecff');
      p.chi = Math.min(p.maxChi, p.chi + this.boosts.chiRegen * dt);
      ctx.render.bloomBoost = (this.sphereActive ? 0.15 : 0.2) * this.glow;
      // Scheduled energy waves of the activation sequence.
      for (const w of this.waves) w.t -= dt;
      const due = this.waves.filter((w) => w.t <= 0);
      if (due.length) {
        this.waves = this.waves.filter((w) => w.t > 0);
        for (const w of due) this.wave(w);
      }
    } else {
      ctx.render.bloomBoost = Math.max(0, ctx.render.bloomBoost - dt);
    }
  }

  /** Expanding energy wave: knockback through CombatSystem + environment reaction. */
  private wave(w: PendingWave): Cast | null {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return null;
    const center = p.position.clone().setY(p.position.y + 1);
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const cast = ctx.combat.detachedCast(p, WAVE_DEF, center, fwd);
    cast.areaHit({ center, radius: w.radius, height: 3, damage: w.damage, knockback: w.knockback, knockDir: 'radial', launch: w.launch, stagger: 45 });
    ctx.vfx.sphereWave(center, w.color, w.radius * 1.3, 0.75, 0.2);
    ctx.vfx.ring(p.position.clone().setY(p.position.y + 0.15), w.color, w.radius * 1.5, 0.7, { opacity: 0.7 });
    ctx.vfx.flash(center, w.color, 6, 0.4, 22);
    ctx.vfx.burst('spirit', center, { count: 26, speed: 3, radius: 0.4 });
    environmentReact(ctx, p.position, w.radius * 2.2, 1.5);
    ctx.events.emit('camera:shake', { intensity: 0.32, duration: 0.45 });
    return cast;
  }

  private lateUpdate(dt: number): void {
    const p = this.ctx.player;
    if (p) {
      this.aura?.update(dt);
      this.sphere?.update(dt);
    }
    if (this.fading.length) {
      const keep: Visual[] = [];
      for (const f of this.fading) {
        let alive = false;
        try {
          alive = f.update(dt);
        } catch (err) {
          console.error('[avatar] fade update failed', err);
        }
        if (alive) keep.push(f);
        else f.dispose();
      }
      this.fading = keep;
    }
  }

  /** Dispose every fading visual immediately. */
  private flushFading(): void {
    for (const f of this.fading) f.dispose();
    this.fading = [];
  }

  /** Hard reset to the inactive state with nothing left in the scene. */
  private forceOff(): void {
    if (this.active) this.deactivate(true);
    this.flushFading();
    this.waves.length = 0;
    this.glow = 0;
    this.transition = 0;
    this.hasLastPos = false;
    if (this.ctx) this.ctx.render.bloomBoost = 0;
  }

  onSessionStart(): void {
    this.installDebug(); // window.__game exists by now (init runs before Debug is installed)
    this.forceOff();
    this.activations = 0;
  }

  onSessionEnd(): void {
    this.forceOff();
    this.spirit = this.maxSpirit;
  }

  // ---- Persistable -------------------------------------------------------------

  serialize(): unknown {
    return { spirit: Math.round(this.spirit * 10) / 10 };
  }

  deserialize(data: unknown): void {
    // Never starts active after a load.
    this.forceOff();
    const s = (data as { spirit?: unknown } | undefined)?.spirit;
    this.spirit = typeof s === 'number' && Number.isFinite(s) ? Math.max(0, Math.min(this.maxSpirit, s)) : this.maxSpirit;
  }

  reset(): void {
    this.forceOff();
    this.spirit = this.maxSpirit;
  }

  // ---- Debug (window.__game.debug.avatar) ---------------------------------------

  private installDebug(): void {
    const g = (globalThis as any).__game;
    const ctx = this.ctx;
    if (!g?.debug || g.debug.avatar) return;
    g.debug.avatar = {
      state: () => ({
        active: this.active,
        sphere: this.sphereActive,
        spirit: +this.spirit.toFixed(2),
        transition: +this.transition.toFixed(2),
        boosts: { ...this.boosts },
        activations: this.activations,
        aura: !!this.aura,
        sphereFx: this.sphere ? this.sphere.info() : null,
        fading: this.fading.length,
        glow: this.glow,
      }),
      setSpirit: (v: number) => {
        this.spirit = Math.max(0, Math.min(this.maxSpirit, v));
      },
      /** Press the real (rebindable) Avatar State input for one frame. */
      press: () => {
        ctx.input.setVirtual('avatarState', true);
        g.step(1);
        ctx.input.setVirtual('avatarState', false);
        g.step(1);
        return this.active;
      },
      /** Scene / effect counters for leak checks. */
      counts: () => {
        let objects = 0;
        let lights = 0;
        ctx.scene.traverse((o) => {
          objects++;
          if ((o as THREE.Light).isLight && (o as THREE.Light).intensity > 0 && o.visible) lights++;
        });
        const h = ctx.player?.humanoid;
        const mem = ctx.render.renderer.info.memory;
        return {
          objects,
          lights,
          vfxChildren: ctx.vfx.group.children.length,
          effects: effectCount(),
          constructs: constructCount(),
          particles: ctx.vfx.particleCount,
          geometries: mem.geometries,
          textures: mem.textures,
          hover: h ? +h.root.position.y.toFixed(4) : 0,
          wind: h ? +h.wind.length().toFixed(4) : 0,
          bloomBoost: ctx.render.bloomBoost,
        };
      },
    };
  }
}
