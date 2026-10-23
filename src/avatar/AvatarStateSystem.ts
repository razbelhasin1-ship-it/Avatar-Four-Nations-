import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';

/**
 * Avatar State controller.
 *  - Standard Avatar State: available from the start, toggled at will with the
 *    dedicated input. Glowing eyes/tattoos, energy wave, empowered bending.
 *  - Elements Sphere: when progression.elementsSphereUnlocked, the same input
 *    activates the upgraded form with the four-element sphere and ultimates.
 *
 * Spirit energy is generous: ~90 s of continuous use from full, refilling while
 * inactive; activation needs only 20%. There is no long cooldown.
 *
 * The avatar module may replace visuals (sphere formation, transformation
 * sequence) but must keep this public API.
 */
export class AvatarStateSystem implements GameSystem {
  private ctx!: GameContext;
  active = false;
  sphereActive = false;
  /** 0..100 */
  spirit = 100;
  readonly maxSpirit = 100;
  drainPerSec = 100 / 90;
  regenPerSec = 100 / 40;
  /** Seconds of the activation burst (control returns quickly). */
  transition = 0;
  private toggleCooldown = 0;
  private glow = 0;
  private readonly tmp = new THREE.Vector3();

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  /** Damage multiplier while active. */
  get powerBonus(): number {
    return this.sphereActive ? 1.9 : this.active ? 1.5 : 1;
  }

  canActivate(): boolean {
    const p = this.ctx.player;
    if (!p || !p.alive || !this.ctx.progression.avatarStateUnlocked) return false;
    if (this.ctx.ui.blocksGameplay || this.ctx.companions.mounted) return false;
    return this.spirit >= 20;
  }

  toggle(): void {
    if (this.toggleCooldown > 0) return;
    this.toggleCooldown = 0.5;
    if (this.active) this.deactivate();
    else this.activate();
  }

  activate(): boolean {
    if (this.active) return true;
    if (!this.canActivate()) {
      if (this.spirit < 20) this.ctx.events.emit('ui:notify', { text: 'Your spirit needs rest before entering the Avatar State.', kind: 'warning', duration: 2.5 });
      return false;
    }
    const p = this.ctx.player!;
    this.active = true;
    this.sphereActive = this.ctx.progression.elementsSphereUnlocked;
    this.transition = this.sphereActive ? 1.6 : 0.9;
    p.humanoid?.animator.play('avatar_activate', { fadeIn: 0.05 });
    const pos = p.aimPoint(this.tmp);
    this.ctx.vfx.sphereWave(pos, this.sphereActive ? '#e8f4ff' : '#bfe8ff', 14, 0.9, 0.35);
    this.ctx.vfx.ring(p.position.clone().setY(p.position.y + 0.2), '#cfefff', 16, 0.8);
    this.ctx.vfx.burst('spirit', pos, { count: 40, speed: 2 });
    this.ctx.vfx.flash(pos, '#cfefff', 10, 0.5, 25);
    this.ctx.world.fx.disturb(p.position, 18, 1.5);
    this.ctx.audio.play('avatar_surge', { position: pos, volume: 1 });
    this.ctx.events.emit('camera:impulse', { pullback: this.sphereActive ? 4 : 2, fovKick: 6, duration: this.transition + 0.4 });
    this.ctx.events.emit('camera:shake', { intensity: 0.35, duration: 0.6 });
    // Push nearby enemies back with the energy wave.
    this.ctx.combat.areaHit(null, { center: p.position.clone().setY(p.position.y + 1), radius: 7, damage: 0, knockback: 9, knockDir: 'radial', stagger: 40 });
    this.ctx.events.emit('avatarState:changed', { active: true, sphere: this.sphereActive });
    return true;
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    const wasSphere = this.sphereActive;
    this.sphereActive = false;
    const p = this.ctx.player;
    if (p) {
      this.ctx.vfx.burst('spirit', p.aimPoint(this.tmp), { count: 18, speed: 1 });
      p.humanoid?.setGlow(0, 0);
    }
    this.glow = 0;
    this.ctx.events.emit('avatarState:changed', { active: false, sphere: false });
    void wasSphere;
  }

  update(dt: number): void {
    this.toggleCooldown = Math.max(0, this.toggleCooldown - dt);
    const p = this.ctx.player;
    if (!p) return;
    if (this.ctx.input.wasPressed('avatarState')) this.toggle();
    if (this.active) {
      this.transition = Math.max(0, this.transition - dt);
      this.spirit = Math.max(0, this.spirit - this.drainPerSec * dt);
      if (this.spirit <= 0 || !p.alive) this.deactivate();
      this.glow = Math.min(1, this.glow + dt * 3);
      p.humanoid?.setGlow(this.glow, this.glow, '#c8ecff');
      p.chi = Math.min(p.maxChi, p.chi + 12 * dt);
      this.ctx.render.bloomBoost = 0.35 * this.glow;
    } else {
      this.spirit = Math.min(this.maxSpirit, this.spirit + this.regenPerSec * dt);
      this.ctx.render.bloomBoost = Math.max(0, this.ctx.render.bloomBoost - dt);
    }
  }

  onSessionEnd(): void {
    this.active = false;
    this.sphereActive = false;
    this.spirit = this.maxSpirit;
    this.ctx.render.bloomBoost = 0;
  }
}
