import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import type { GameContext } from '../../../core/GameContext';
import { fireExplosion, flameRing } from '../../../vfx/effects/fire';
import { effect } from '../../../vfx/effects/loop';
import { flameMaterial, setOpacity } from '../../../vfx/effects/materials';
import { coneTube, shared, spiral } from '../../../vfx/effects/shapes';
import { registerTechnique } from '../../CombatSystem';
import { aimFlat, anim, enemiesNear, groundY, hitSphere, push, shake } from '../bending/util';
import { beginUltimate, bigObstacleAt, spiritPrecheck } from './common';

/**
 * Fire Tornado — a rotating column of flame sent in the aimed direction. It
 * travels ~25 m, drags enemies into its burning core (burn status + damage
 * ticks), lights the scene, melts ice it passes (bending:heat), scorches the
 * ground and bursts at the end. It never passes through walls, buildings or
 * cliffs (it stalls against them; trees and posts it sweeps past) and harms
 * only enemies — no world geometry is damaged.
 */

const LIFE = 4.6;
const SPEED = 5.5;
const CORE_R = 3.3;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

class FireColumn {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly outer: THREE.Mesh;
  private readonly inner: THREE.Mesh;
  private readonly bands: THREE.Mesh[] = [];
  private readonly light: THREE.PointLight | null;
  private t = 0;
  opacity = 0;

  constructor(ctx: GameContext, private readonly height = 10, private readonly radius = 3.1) {
    const q = ctx.vfx.quality;
    const funnel = shared(`avatar_fire_funnel_${q}`, () => {
      const g = coneTube(0.3, 1, q === 'low' ? 14 : 22, q === 'low' ? 8 : 12);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    // Painterly outer flame (never saturates to white) around a hotter additive core.
    const mo = flameMaterial({ palette: 'fire', blend: 'normal', scroll: [1.3, -2.3], scale: [5, 1.3], intensity: 1.15, rimFade: true });
    const mi = flameMaterial({ palette: 'fire', scroll: [2.1, -3.2], scale: [4, 1.6], intensity: 1.1, rimFade: true });
    this.mats.push(mo, mi);
    this.outer = new THREE.Mesh(funnel, mo);
    this.inner = new THREE.Mesh(funnel, mi);
    this.group.add(this.outer, this.inner);
    const n = q === 'low' ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const g = shared(`avatar_fire_band_${q}_${i}`, () => spiral({ turns: 2.2, height: 1, r0: 0.32, r1: 1.08, width: 0.24, seg: q === 'low' ? 40 : 72, phase: (i / n) * Math.PI * 2 }));
      const m = flameMaterial({ sheet: true, palette: i % 2 ? 'ember' : 'fire', blend: 'normal', scroll: [0, -3], scale: [1, 3], intensity: 1.2 });
      this.mats.push(m);
      const band = new THREE.Mesh(g, m);
      this.bands.push(band);
      this.group.add(band);
    }
    this.light = ctx.settings.data.graphics.dynamicLights ? new THREE.PointLight('#ff8a3a', 0, 22, 2) : null;
    if (this.light) {
      this.light.position.y = 3;
      this.group.add(this.light);
    }
    for (const m of this.mats) setOpacity(m, 0);
    ctx.vfx.group.add(this.group);
  }

  update(dt: number, base: THREE.Vector3, scale: number): void {
    this.t += dt;
    this.group.position.copy(base);
    const h = this.height * scale, r = this.radius * scale;
    this.outer.scale.set(r, h, r);
    this.inner.scale.set(r * 0.62, h * 0.9, r * 0.62);
    this.outer.rotation.y -= dt * 6;
    this.inner.rotation.y -= dt * 9;
    this.bands.forEach((b, i) => {
      b.scale.set(r * 1.05, h, r * 1.05);
      b.rotation.y -= dt * (9 + i * 2);
    });
    this.group.rotation.z = Math.sin(this.t * 2.1) * 0.07;
    this.group.rotation.x = Math.cos(this.t * 1.6) * 0.05;
    this.mats.forEach((m, i) => setOpacity(m, this.opacity * (i === 0 ? 0.95 : i === 1 ? 0.4 : 0.7)));
    if (this.light) this.light.intensity = this.opacity * (40 + 14 * Math.sin(this.t * 19) * Math.sin(this.t * 7));
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.light?.dispose();
  }
}

registerTechnique({
  id: 'ult_fire_tornado',
  name: 'Fire Tornado',
  element: 'avatar',
  kind: 'ultimate',
  tier: 4,
  requires: 'elementsSphere',
  description: 'Spin into a blazing column of flame and drive it across the field. It drags enemies into its burning heart, sets them alight and bursts when it dies down.',
  usage: 'Elements Sphere only. The tornado travels ~25 m where you aim; enemies near it are pulled in, burned every 0.4 s and blasted at the end. It lights the night, melts ice and stops against walls. Costs 15 spirit.',
  icon: 'fire',
  chiCost: 30,
  cooldown: 16,
  windup: 0.55,
  recovery: 0.45,
  movement: 'root',
  airborne: true,
  interruptible: false,
  range: 20,
  precheck: spiritPrecheck('ult_fire_tornado'),
  begin(cast) {
    beginUltimate(cast);
    const ctx = cast.ctx;
    const c = cast.caster;
    anim(c, 'ult_fire_tornado_cast', { fadeIn: 0.03, fadeOut: 0.01 });
    ctx.audio.play('ult.firetornado', { position: c.position, volume: 1 });
    flameRing(ctx, c.position.clone().setY(c.position.y + 0.1), { r0: 0.5, r1: 2.4, height: 1.4, duration: 0.55 });
    ctx.vfx.burst('embers', c.position, { count: 20, radius: 1, speed: 2.5, swirl: 8 });
    ctx.events.emit('camera:impulse', { pullback: 2.5, fovKick: 4, duration: 1.3 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = aimFlat(cast);
    const base = c.position.clone().addScaledVector(dir, 3);
    base.y = groundY(ctx, base.x, base.z, c.position.y + 1);
    const column = new FireColumn(ctx);
    const loop: LoopHandle = ctx.audio.loop('bend_flame_loop', { position: base, volume: 1.2, pitch: 0.7 });
    const ticks = new Map<number, number>();
    let age = 0;
    let lastScorch = -99;
    let traveled = 0;
    let heatT = 0;
    let ringT = 0.4;
    let ended = false;
    const low = ctx.vfx.quality === 'low';
    const burst = () => {
      if (ended) return;
      ended = true;
      const mid = tmp2.copy(base).setY(base.y + 1.5);
      hitSphere(cast, mid, 4.8, 4, (_e, away) => ({ damage: 22, knockback: push(away, 14), launch: 5, stagger: 60, status: [{ type: 'burn', duration: 4, magnitude: 1.5 }] }), true);
      fireExplosion(ctx, mid.clone(), 4.5, { smoke: true, column: true });
      ctx.world.fx.scorch(base, 4);
      ctx.events.emit('bending:heat', { position: { x: base.x, y: base.y, z: base.z }, radius: 6, intensity: 1.5, casterId: c.id });
      ctx.audio.play('bend_explosion', { position: mid, volume: 1 });
      shake(ctx, base, 0.35, 0.45);
    };
    effect(
      (dt) => {
        age += dt;
        const grow = Math.min(1, age / 0.45) * (age > LIFE - 0.45 ? Math.max(0, (LIFE - age) / 0.45) : 1);
        // Travel; stall against cliffs and solid architecture (it never passes through).
        const step = SPEED * dt;
        const nx = base.x + dir.x * step, nz = base.z + dir.z * step;
        const ny = groundY(ctx, nx, nz, base.y + 1.5);
        const liquid = ctx.world.liquidAt(nx, nz);
        const y = liquid && liquid.level > ny ? liquid.level : ny;
        const blocked = y - base.y > 1.8 || bigObstacleAt(ctx, tmp.set(nx, y + 1.3, nz), 1.0, 0.8) !== null;
        if (!blocked) {
          base.set(nx, y, nz);
          traveled += step;
        }
        column.opacity = grow;
        column.update(dt, base, 0.3 + 0.7 * grow);
        loop.setPosition(base);
        const now = ctx.time.elapsed;
        for (const e of enemiesNear(cast, base, CORE_R + 2)) {
          const to = tmp.set(base.x - e.position.x, 0, base.z - e.position.z);
          const d = to.length();
          if (d > CORE_R || e.position.y > base.y + 6) continue;
          if (d > 0.05) to.divideScalar(d);
          const k = 1 - d / CORE_R;
          const b = e.body;
          if (b) {
            b.external.addScaledVector(to, (8 + 16 * k) * dt * grow);
            b.external.add(tmp2.set(-to.z, 0, to.x).multiplyScalar(10 * k * dt * grow));
            if (d < 2) {
              b.velocity.y = Math.max(b.velocity.y, 3.5);
              b.grounded = false;
            }
          }
          if ((ticks.get(e.id) ?? 0) <= now) {
            ticks.set(e.id, now + 0.4);
            cast.hit(e, { damage: 7, stagger: 14, status: [{ type: 'burn', duration: 3, magnitude: 1.5 }], point: e.aimPoint(tmp2).clone() }, true);
          }
        }
        heatT -= dt;
        if (heatT <= 0) {
          heatT = 0.5;
          ctx.events.emit('bending:heat', { position: { x: base.x, y: base.y, z: base.z }, radius: 4, intensity: 1, casterId: c.id });
          ctx.world.fx.disturb(base, 6, 1);
        }
        if (traveled - lastScorch > 1.5) {
          lastScorch = traveled;
          ctx.world.fx.scorch(base, 1.6);
        }
        ringT -= dt;
        if (ringT <= 0 && grow > 0.5) {
          ringT = low ? 1.2 : 0.75;
          flameRing(ctx, tmp.copy(base).setY(base.y + 0.05), { r0: 1, r1: 3.6, height: 1, duration: 0.6 });
        }
        if (Math.random() < dt * (low ? 10 : 24)) ctx.vfx.burst('embers', tmp.copy(base).setY(base.y + Math.random() * 6), { count: 3, swirl: 8, radius: 1.6, speed: 2.5 });
        if (Math.random() < dt * 10) ctx.vfx.burst('fire', tmp.copy(base).setY(base.y + 0.4), { count: 3, swirl: 9, radius: 1.2, speed: 1.6 });
        if (Math.random() < dt * 4) ctx.vfx.burst('smoke', tmp.copy(base).setY(base.y + 8), { count: 2, radius: 1.5 });
        if (age >= LIFE) {
          burst();
          return false;
        }
        return true;
      },
      () => {
        // (burst only from update: a dispose from clearEffects at session end deals no damage)
        column.dispose();
        loop.stop(0.4);
      },
    );
    ctx.vfx.flash(tmp.copy(base).setY(base.y + 2), '#ffb060', 6, 0.4, 24);
    shake(ctx, base, 0.25, 0.35);
  },
});
