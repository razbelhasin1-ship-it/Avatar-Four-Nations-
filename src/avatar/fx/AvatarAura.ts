import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import type { GameContext } from '../../core/GameContext';
import type { Emitter } from '../../vfx/VFX';
import { setOpacity, windMaterial } from '../../vfx/effects/materials';
import { flatRing, shared, tube } from '../../vfx/effects/shapes';
import type { Player } from '../../player/Player';
import { byQuality, dynamicLights } from './common';

/**
 * Standard Avatar State presentation around the player (all characters, with
 * or without tattoos): eyes/tattoo glow are driven by AvatarStateSystem
 * (Humanoid.setGlow → luminous rim when untattooed); this adds the energy
 * aura (rising streak shell), a swirling ground sigil, drifting spirit wisps,
 * a soft light, a levitation hover and an updraft that stirs hair and cloth.
 *
 * release() fades everything out (~0.35 s); dispose() restores the character
 * exactly (hover 0, wind 0) and frees every material / light / loop.
 */
export class AvatarAura {
  private readonly group = new THREE.Group();
  private readonly shell: THREE.Mesh;
  private readonly sigil: THREE.Mesh;
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly light: THREE.PointLight | null;
  private readonly wisps: Emitter;
  private readonly hum: LoopHandle;
  private level = 0;
  private releasing = false;
  private t = 0;
  private hover = 0;
  private disposed = false;

  constructor(private readonly ctx: GameContext, private readonly player: Player, private readonly sphere: boolean) {
    this.group.name = 'avatar_aura';
    const radial = byQuality(ctx, 12, 16, 20);
    const shellGeo = shared(`avatar_aura_shell_${radial}`, () => {
      const g = tube((v) => 0.48 + 0.16 * Math.sin(Math.PI * Math.min(1, v * 1.15)) - v * 0.12, 2.25, radial, 8);
      g.rotateX(-Math.PI / 2); // +Z → +Y: base at the feet, uv.y rises with height
      return g;
    });
    const shellMat = windMaterial({
      color: '#f2fbff',
      tint: sphere ? '#d8f0ff' : '#8fd2ff',
      opacity: 0.6,
      speed: 1.1,
      repeat: [6, 1.6],
      threshold: 0.5,
      body: 0.04,
      fade: [0.3, 0.5],
      wrapAcross: true,
      rim: true,
      additive: true,
    });
    this.mats.push(shellMat);
    this.shell = new THREE.Mesh(shellGeo, shellMat);
    this.shell.renderOrder = 2;
    const sigilGeo = shared('avatar_aura_sigil', () => {
      return flatRing(0.55, 1.35, Math.PI * 2, 48, 'around');
    });
    const sigilMat = windMaterial({ color: '#ffffff', tint: '#9fd8ff', opacity: 0.7, speed: 0.8, repeat: [1, 6], threshold: 0.45, body: 0.12, wrapFlow: true, additive: true });
    this.mats.push(sigilMat);
    this.sigil = new THREE.Mesh(sigilGeo, sigilMat);
    this.sigil.position.y = 0.04;
    this.group.add(this.shell, this.sigil);
    for (const m of this.mats) setOpacity(m, 0);
    if (dynamicLights(ctx)) {
      this.light = new THREE.PointLight(sphere ? '#e6f4ff' : '#9fd8ff', 0, 8, 2);
      this.light.position.y = 1.2;
      this.group.add(this.light);
    } else this.light = null;
    ctx.vfx.group.add(this.group);
    this.wisps = ctx.vfx.emitter('spirit', byQuality(ctx, 8, 14, 20), { radius: 0.45, speed: 0.7, size: 0.9 });
    this.hum = ctx.audio.loop('loop.avatar.hum', { position: player.position, volume: 0.55 });
    this.follow();
  }

  /** Fade out (deactivation). */
  release(_quiet = false): void {
    if (this.releasing) return;
    this.releasing = true;
    this.wisps.stop();
    this.hum.stop(0.4);
  }

  private follow(): void {
    this.group.position.copy(this.player.position);
    this.group.rotation.y = this.player.yaw;
  }

  /** Advance; returns false when fully faded (caller disposes). */
  update(dt: number): boolean {
    if (this.disposed) return false;
    this.t += dt;
    const p = this.player;
    this.level = this.releasing ? Math.max(0, this.level - dt / 0.35) : Math.min(1, this.level + dt / 0.3);
    this.follow();
    const k = this.level;
    const pulse = 0.85 + 0.15 * Math.sin(this.t * 5.3);
    setOpacity(this.mats[0], (this.sphere ? 0.3 : 0.5) * k * pulse);
    setOpacity(this.mats[1], 0.65 * k);
    this.shell.scale.set(1 + 0.04 * Math.sin(this.t * 3.1), 0.92 + 0.08 * k, 1 + 0.04 * Math.cos(this.t * 2.7));
    this.sigil.rotation.y += dt * 0.8;
    this.sigil.scale.setScalar(0.6 + 0.4 * k + 0.05 * Math.sin(this.t * 2));
    if (this.light) this.light.intensity = (this.sphere ? 9 : 6) * k * pulse;
    // Wisps rise from the chest/shoulders.
    this.wisps.position.set(p.position.x, p.position.y + 1.1 + this.hover, p.position.z);
    this.hum.setPosition(p.position);
    // Levitation: hover when idle, skim when moving; the body stays where physics puts it.
    const b = p.body;
    const speed = b ? Math.hypot(b.velocity.x, b.velocity.z) : 0;
    const grounded = b ? b.grounded : true;
    const target = this.releasing ? 0 : (grounded ? (speed < 1 ? 0.26 : 0.07) : 0.1) + Math.sin(this.t * 2.1) * 0.035 * (speed < 1 ? 1 : 0.3);
    this.hover += (target - this.hover) * Math.min(1, dt * 5);
    const h = p.humanoid;
    if (h) {
      h.root.position.y = this.hover;
      // Updraft + swirl stirs hair and cloth (Humanoid.wind → secondary motion).
      const s = k * (this.sphere ? 1.25 : 1);
      h.wind.set(Math.cos(this.t * 2.3) * 7 * s, 15 * s, Math.sin(this.t * 2.3) * 7 * s);
    }
    return this.level > 0 || !this.releasing;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.wisps.stop();
    this.hum.stop(0.2);
    const h = this.player.humanoid;
    if (h) {
      h.root.position.y = 0;
      h.wind.set(0, 0, 0);
    }
    this.group.removeFromParent();
    if (this.light) this.light.dispose();
    for (const m of this.mats) m.dispose();
  }
}
