import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import type { GameContext } from '../../core/GameContext';
import { setOpacity, windMaterial } from '../../vfx/effects/materials';
import { shared, shellTorus } from '../../vfx/effects/shapes';
import type { Player } from '../../player/Player';
import { byQuality, dynamicLights } from './common';

const tmp = new THREE.Vector3();

/**
 * Standard Avatar State presentation around the player (all characters, with or without
 * tattoos). The glow carries it: eyes and tattoos are lit by AvatarStateSystem (Humanoid.setGlow;
 * a luminous rim when untattooed), with a soft light, a levitation hover and an updraft that
 * stirs hair and cloth. No shell is drawn over the body. The air answers the Avatar's power
 * instead: a few thin streaks of wind circle the body well clear of it, and gusts ruffle the
 * ground around it (grass and foliage bend; dust, leaves, sand or snow lift). In the Elements
 * Sphere the sphere itself is the wind, so only the gusts remain.
 *
 * release() fades everything out (~0.35 s); dispose() restores the character exactly (hover 0,
 * wind 0) and frees every material / light / loop.
 */
export class AvatarAura {
  private readonly group = new THREE.Group();
  private readonly bands: THREE.Mesh[] = [];
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly light: THREE.PointLight | null;
  private readonly hum: LoopHandle;
  private level = 0;
  private releasing = false;
  private t = 0;
  private hover = 0;
  /** Seconds to the next gust. */
  private gust = 0.25;
  private gustN = 0;
  private disposed = false;

  constructor(private readonly ctx: GameContext, private readonly player: Player, private readonly sphere: boolean) {
    this.group.name = 'avatar_aura';
    if (!sphere) {
      // Wind circling the Avatar: thin, broken streaks at knee, waist and chest height, and a wider
      // gust sweeping the ground (medium / high).
      const q = ctx.vfx.quality;
      const geo = shared(`avatar_aura_wind_${q}`, () => shellTorus(0.03, q === 'low' ? 5 : 6, q === 'low' ? 40 : 64));
      const n = byQuality(ctx, 2, 4, 4);
      for (let i = 0; i < n; i++) {
        const m = windMaterial({ color: '#ffffff', tint: '#d8ecff', opacity: 0, speed: 3 + i * 0.7, repeat: [1, 30], threshold: i === 3 ? 0.78 : 0.7, body: 0, wrapFlow: true, wrapAcross: true, seed: i * 3.7 });
        this.mats.push(m);
        const band = new THREE.Mesh(geo, m);
        band.renderOrder = 2;
        this.bands.push(band);
        this.group.add(band);
      }
    }
    if (dynamicLights(ctx)) {
      this.light = new THREE.PointLight(sphere ? '#e6f4ff' : '#9fd8ff', 0, 8, 2);
      this.light.position.y = 1.2;
      this.group.add(this.light);
    } else this.light = null;
    ctx.vfx.group.add(this.group);
    this.hum = ctx.audio.loop('loop.avatar.hum', { position: player.position, volume: 0.55 });
    this.follow();
  }

  /** Fade out (deactivation). */
  release(_quiet = false): void {
    if (this.releasing) return;
    this.releasing = true;
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
    // The wind: each streak ring breathes and tilts a little as it circles; the fourth sweeps the ground.
    this.bands.forEach((b, i) => {
      const ground = i === 3;
      const r = (ground ? 1.75 : 1.05 + 0.2 * i) + 0.06 * Math.sin(this.t * 1.7 + i * 2.1);
      b.scale.setScalar(r * (0.75 + 0.25 * k));
      b.position.y = ground ? 0.12 : 0.32 + 0.55 * i + this.hover * 0.5 + 0.05 * Math.sin(this.t * 1.3 + i);
      b.rotation.set(Math.PI / 2 + (ground ? 0.04 : 0.14) * Math.sin(this.t * 0.9 + i * 1.9), (ground ? 0.03 : 0.18) * Math.cos(this.t * 0.7 + i), 0);
      setOpacity(this.mats[i], (ground ? 0.24 : 0.27) * k);
    });
    if (this.light) this.light.intensity = (this.sphere ? 9 : 6) * k * pulse;
    this.hum.setPosition(p.position);
    // Gusts: the ground around the Avatar answers its power.
    if (!this.releasing) {
      this.gust -= dt;
      if (this.gust <= 0) {
        this.gust = byQuality(this.ctx, 1.0, 0.75, 0.6) * (0.8 + Math.random() * 0.4);
        this.gustN++;
        this.ctx.world.fx.disturb(p.position, 3.4, 0.7);
        if (!this.sphere && this.gustN % 2 === 0) {
          const g = this.ctx.world.groundAt(p.position.x, p.position.z, p.position.y + 1.5);
          if (p.position.y - g.y < 1.5) this.ctx.vfx.burst('swirl', tmp.set(p.position.x, g.y + 0.25, p.position.z), { count: byQuality(this.ctx, 3, 5, 7), swirl: 7, radius: 1.3, speed: 1.1 });
        }
      }
    }
    // Levitation: hover when idle, skim when moving; the body stays where physics puts it.
    const b = p.body;
    const speed = b ? Math.hypot(b.velocity.x, b.velocity.z) : 0;
    const grounded = b ? b.grounded : true;
    // In the Elements Sphere the Avatar rises toward its centre when still (the series' frame).
    const idle = this.sphere ? 0.62 : 0.26;
    const target = this.releasing ? 0 : (grounded ? (speed < 1 ? idle : 0.07) : 0.1) + Math.sin(this.t * 2.1) * 0.035 * (speed < 1 ? 1 : 0.3);
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
