import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { registerTechnique } from '../../CombatSystem';
import { clamp01, easeOut } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import { createWaterMaterial } from '../../water/WaterMaterials';
import type { Cast, Projectile } from '../../types';
import { fxOf, handPos, refundWater, returnToReserve, spill, UP } from './shared';

/**
 * Water Shield (defense): water wraps from the source / reserve into rings
 * spinning around the bender inside a thin dome of water. While it is up the
 * bender is guarding (incoming damage reduced), hostile projectiles entering
 * the dome are stopped (fire hisses into steam, water is absorbed into the
 * reserve) and burning is put out. When it drops, most of the water returns
 * to the reserve.
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
let shellGeo: THREE.SphereGeometry | null = null;
export const SHIELD_RADIUS = 1.55;

class ShieldEffect implements WaterEffect {
  readonly kind = 'shield';
  castId: number;
  private readonly fx: WaterFX;
  private readonly rings: StreamBody[] = [];
  private readonly feed: StreamBody;
  private readonly shell: THREE.Mesh;
  private readonly shellMat: THREE.ShaderMaterial;
  readonly origin = new THREE.Vector3();
  readonly center = new THREE.Vector3();
  private t = 0;
  private upT = -1;
  private downT = -1;
  private flash = 0;
  private angle = 0;
  blocked = 0;

  constructor(readonly cast: Cast) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    const ice = cast.water.frozen ? 0.2 : 0;
    const h = handPos(cast.caster, 'hands', tA);
    this.fx.originFor(cast, h, this.origin);
    this.fx.logCast(cast, this.origin);
    this.feed = new StreamBody(this.fx, { flow: 8, ice }, this.origin.distanceTo(h) > 9 ? 1.4 : 1, 3);
    this.feed.radius = 0.16;
    const nRings = fxOf(cast).quality === 'low' ? 2 : 3;
    for (let i = 0; i < nRings; i++) {
      const b = new StreamBody(this.fx, { flow: 5, ice }, 1, 10);
      b.wobble = 0.03;
      this.rings.push(b);
    }
    shellGeo ??= new THREE.SphereGeometry(1, 24, 16);
    this.shellMat = createWaterMaterial({ flow: 2, opacity: 0, foam: 0.6, ice });
    this.shell = new THREE.Mesh(shellGeo, this.shellMat);
    this.shell.renderOrder = 11;
    this.shell.frustumCulled = false;
    this.fx.group.add(this.shell);
    if (cast.water.from) this.fx.splash(this.origin, 0.7, { sound: false });
    cast.ctx.audio.play('water_gather', { position: this.origin, volume: 0.55 });
  }

  raise(): void {
    if (this.upT < 0) this.upT = 0;
  }

  drop(): void {
    if (this.downT < 0) {
      this.downT = 0;
      const g = this.cast.ctx.world.groundAt(this.center.x, this.center.z, this.center.y + 1);
      tA.set(this.center.x, g.y + 0.08, this.center.z);
      this.fx.splash(tA, 1.2, { volume: 0.6 });
      this.cast.ctx.vfx.ring(tA, '#bfe8ff', SHIELD_RADIUS + 1.2, 0.5, { opacity: 0.5 });
    }
  }

  /** A projectile struck the dome. */
  block(at: THREE.Vector3, fire: boolean): void {
    this.blocked++;
    this.flash = 1;
    if (fire) this.fx.steam(at, 1.1);
    else this.fx.splash(at, 0.7, { volume: 0.6 });
  }

  update(dt: number): boolean {
    this.t += dt;
    const c = this.cast.caster;
    this.center.set(c.position.x, c.position.y + 1.05, c.position.z);
    const time = this.fx.time;
    let form = 0;
    if (this.upT >= 0) {
      this.upT += dt;
      form = 1;
    } else form = easeOut(this.t / Math.max(0.05, this.cast.def.windup));
    let fall = 0;
    if (this.downT >= 0) {
      this.downT += dt;
      fall = clamp01(this.downT / 0.35);
      if (fall >= 1) return false;
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    this.angle += dt * (3.2 + 2 * this.flash);
    // Feed: from the water origin up into the first ring while forming.
    const h = handPos(c, 'hands', tA);
    if (this.upT < 0 || this.upT < 0.25) {
      const f = this.feed.pts;
      f[0].copy(this.origin);
      const d = this.origin.distanceTo(h);
      f[1].lerpVectors(this.origin, h, 0.5).addScaledVector(UP, 0.22 * d + 0.5);
      f[2].copy(h);
      this.feed.head = form;
      this.feed.tail = this.upT >= 0 ? clamp01(this.upT / 0.25) : 0;
      this.feed.profile = (u) => capTaper(u, 0.08, 0.1);
      this.feed.build(3);
    } else this.feed.hide();
    // Rings: tilted loops spinning around the bender.
    const R = SHIELD_RADIUS * (0.55 + 0.45 * form) * (1 + 0.05 * Math.sin(time * 5));
    for (let k = 0; k < this.rings.length; k++) {
      const b = this.rings[k];
      const tilt = 0.45 + k * 0.62;
      const spin = this.angle * (k % 2 ? -1.25 : 1) + k * 2.1;
      const qx = Math.cos(tilt + time * 0.35 * (k + 1)), qz = Math.sin(tilt + time * 0.35 * (k + 1));
      for (let i = 0; i < 10; i++) {
        const a = spin + (i / 10) * Math.PI * 2;
        // Circle in a plane tilted about the axis (qx, 0, qz).
        const ca = Math.cos(a) * R, sa = Math.sin(a) * R;
        const tiltA = 0.55 + 0.25 * k;
        const px = ca * qx - sa * Math.cos(tiltA) * qz;
        const pz = ca * qz + sa * Math.cos(tiltA) * qx;
        const py = sa * Math.sin(tiltA) - fall * 0.9;
        b.pts[i].set(this.center.x + px, this.center.y + py * (1 - 0.5 * fall), this.center.z + pz);
      }
      b.radius = (0.07 + 0.04 * this.flash) * (1 - fall);
      b.head = Math.min(0.92, form * 0.92);
      b.profile = (u) => capTaper(u, 0.2, 0.25);
      b.build(10, true);
    }
    // Dome shell.
    const shellOp = (this.upT >= 0 ? 0.22 + 0.35 * this.flash : 0.08 * form) * (1 - fall);
    this.shellMat.uniforms.uOpacity.value = shellOp;
    this.shell.position.copy(this.center);
    this.shell.scale.setScalar(R * 1.08 * (1 - 0.3 * fall));
    if (this.upT >= 0 && this.downT < 0 && Math.random() < dt * 10) {
      const a = Math.random() * Math.PI * 2;
      tB.set(this.center.x + Math.cos(a) * R, this.center.y + (Math.random() - 0.4) * R, this.center.z + Math.sin(a) * R);
      this.cast.ctx.vfx.burst('spray', tB, { count: 1, size: 0.5, speed: 0.4 });
    }
    return this.t < 8;
  }

  trace(): Record<string, unknown> {
    return { center: this.center.toArray(), radius: SHIELD_RADIUS, up: this.upT >= 0 && this.downT < 0, blocked: this.blocked, start: this.origin.toArray() };
  }

  dispose(): void {
    this.feed.dispose();
    for (const r of this.rings) r.dispose();
    this.fx.group.remove(this.shell);
    this.shellMat.dispose();
  }
}

const near: Projectile[] = [];

registerTechnique({
  id: 'water_shield',
  name: 'Water Shield',
  element: 'water',
  kind: 'defense',
  tier: 1,
  description: 'Wrap water around yourself in spinning rings. Blocks projectiles, softens blows, puts out flames; most of the water returns to you when it falls.',
  usage: 'Defensive technique (slot). Lasts about three seconds. Needs water.',
  icon: 'water',
  chiCost: 16,
  cooldown: 6,
  water: { amount: 10 },
  windup: 0.22,
  recovery: 0.3,
  movement: 'slow',
  airborne: false,
  channel: 3,
  interruptible: true,
  range: 3,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('water_shield', { fadeIn: 0.05 });
    cast.data.fx = fxOf(cast).add(new ShieldEffect(cast));
  },
  release(cast) {
    cast.data.released = true;
    const ctx = cast.ctx;
    const c = cast.caster;
    const fxShield = cast.data.fx as ShieldEffect;
    fxShield.raise();
    if (!c.guarding) {
      c.guarding = true;
      cast.data.setGuard = true;
    }
    c.humanoid?.animator.play('water_shield_hold', { fadeIn: 0.2 });
    // The water slams outward as it wraps: shove adjacent attackers back.
    cast.areaHit({ center: c.position.clone().setY(c.position.y + 1), radius: 2.6, height: 1.8, damage: 3, knockback: 7, knockDir: 'radial', stagger: 12, status: [{ type: 'soaked', duration: 4 }] });
    c.removeStatus('burn');
    ctx.audio.play('water_shield', { position: c.position, volume: 0.8 });
    cast.data.loop = ctx.audio.loop('water_swirl', { position: c.position, volume: 0.45 });
  },
  channelUpdate(cast, dt) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const sh = cast.data.fx as ShieldEffect;
    if (!c.alive) return false;
    if (cast.data.setGuard) c.guarding = true;
    // Stop hostile projectiles entering the dome.
    for (const p of ctx.combat.projectilesInRadius(sh.center, SHIELD_RADIUS, near)) {
      const owner = p.cast.caster;
      if (owner === c || !ctx.combat.canHarm(owner, c)) continue;
      p.kill();
      const el = p.cast.def.element;
      sh.block(p.position, el === 'fire');
      if (el === 'water') returnToReserve(cast, 3);
      ctx.audio.play('water_splash', { position: p.position, volume: 0.6, pitch: 1.3 });
    }
    // Put out flames on the bender and allies inside.
    if (c.hasStatus('burn')) {
      c.removeStatus('burn');
      fxOf(cast).steam(sh.center, 0.8);
    }
    for (const e of ctx.entities.queryRadius(sh.center, SHIELD_RADIUS + 0.5)) {
      if (e !== c && (e.team === c.team || e.team === 'ally') && e.hasStatus('burn')) fxOf(cast).extinguish(e);
    }
    (cast.data.loop as LoopHandle | undefined)?.setPosition(c.position);
    void dt;
    return true;
  },
  end(cast, interrupted) {
    const c = cast.caster;
    if (cast.data.setGuard) {
      c.guarding = false;
      cast.data.setGuard = false;
    }
    (cast.data.loop as LoopHandle | undefined)?.stop(0.3);
    c.humanoid?.animator.stop('water_shield_hold', 0.25);
    const sh = cast.data.fx as ShieldEffect | undefined;
    sh?.drop();
    if (!cast.data.released) {
      if (interrupted) refundWater(cast);
      return;
    }
    if (cast.data.waterDone) return;
    cast.data.waterDone = true;
    const back = returnToReserve(cast, cast.water.amount * 0.6);
    const g = cast.ctx.world.groundAt(c.position.x, c.position.z, c.position.y + 1);
    spill(cast, tA.set(c.position.x, g.y, c.position.z), cast.water.amount - back);
  },
  aiScore(caster, target, dist) {
    void caster;
    void target;
    return dist < 14 ? 0.35 : 0.1;
  },
});
