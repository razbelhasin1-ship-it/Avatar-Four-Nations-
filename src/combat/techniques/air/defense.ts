import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { effect } from '../../../vfx/effects/loop';
import { setOpacity, windMaterial } from '../../../vfx/effects/materials';
import { flatRing, shared } from '../../../vfx/effects/shapes';
import { airPuff, windRing, WindShell } from '../../../vfx/effects/wind';
import { registerTechnique } from '../../CombatSystem';
import { bending } from '../bending/runtime';
import { aimFlat, anim, hitSphere, push, shake, stopAnim } from '../bending/util';
import { deflectProjectiles, openSlipstream } from './common';

const tmp = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Air Shield — hold to keep a spinning sphere of air around you.
// ---------------------------------------------------------------------------

interface ShieldData {
  shell: WindShell;
  loop: LoopHandle;
  ticks: Map<number, number>;
  deflected: number;
}

registerTechnique({
  id: 'air_shield',
  name: 'Air Shield',
  element: 'air',
  kind: 'defense',
  tier: 2,
  description: 'Spin a sphere of air around yourself: projectiles glance off it and anyone who closes in is thrown back.',
  usage: 'Hold the technique key to keep the shield up (drains chi). Deflects incoming projectiles and repels melee attackers; you can still move slowly.',
  icon: 'air',
  chiCost: 12,
  cooldown: 2.5,
  windup: 0.12,
  recovery: 0.25,
  movement: 'slow',
  airborne: true,
  interruptible: false,
  range: 3,
  channel: 4,
  begin(cast) {
    bending.channel(cast, 'hold', { min: 0.8, auto: 2.2 });
    anim(cast.caster, 'air_shield_hold', { fadeIn: 0.1 });
    cast.ctx.vfx.burst('swirl', cast.caster.castOrigin('chest', tmp), { count: 12, swirl: 9, radius: 0.8 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const d: ShieldData = {
      shell: new WindShell(ctx, { rings: ctx.vfx.quality === 'low' ? 2 : 3, opacity: 0.9, speed: 3 }),
      loop: ctx.audio.loop('bend_wind_loop', { position: cast.caster.position, volume: 0.7 }),
      ticks: new Map(),
      deflected: 0,
    };
    cast.data.shield = d;
    ctx.audio.play('bend_air_swirl', { position: cast.caster.position, volume: 0.8 });
    windRing(ctx, cast.caster.position.clone().setY(cast.caster.position.y + 1), { r0: 0.5, r1: 2.4, duration: 0.3, height: 2 });
  },
  channelUpdate(cast, dt) {
    if (!bending.channelKeep(cast, dt)) return false;
    const ctx = cast.ctx;
    const c = cast.caster;
    const d = cast.data.shield as ShieldData | undefined;
    if (!d) return false;
    const drain = 5 * dt;
    if (c.chi < drain) return false;
    c.chi -= drain;
    const center = c.position.clone().setY(c.position.y + 1.0);
    const t = bending.channelTime(cast);
    d.shell.update(dt, center, 1.75 + Math.sin(t * 9) * 0.04);
    d.loop.setPosition(center);
    d.deflected += deflectProjectiles(cast, center, 2.3, 'outward').length;
    const now = ctx.time.elapsed;
    hitSphere(
      cast,
      center,
      2.3,
      1.6,
      (e, away) => {
        if ((d.ticks.get(e.id) ?? 0) > now) return null;
        d.ticks.set(e.id, now + 0.45);
        airPuff(ctx, e.aimPoint(tmp).clone(), away, 0.7);
        return { damage: 3, knockback: push(away, 13), stagger: 16 };
      },
      true,
    );
    if (Math.random() < dt * 12) ctx.vfx.burst('swirl', center, { count: 1, swirl: 10, radius: 1.6, speed: 0.6 });
    if (Math.random() < dt * 4) ctx.world.fx.disturb(c.position, 3, 0.6);
    const b = c.body;
    if (b && !b.grounded) b.velocity.y = Math.max(b.velocity.y, -2);
    return true;
  },
  end(cast) {
    const d = cast.data.shield as ShieldData | undefined;
    if (d) {
      d.shell.dispose(0.25);
      d.loop.stop(0.25);
      cast.data.shield = undefined;
    }
    stopAnim(cast.caster, 'air_shield_hold', 0.2);
  },
  aiScore: (_c, _t, dist) => (dist < 3 ? 0.35 : 0.05),
});

// ---------------------------------------------------------------------------
// Wind Redirection — a short, timed catch window that returns projectiles.
// ---------------------------------------------------------------------------

interface RedirectData {
  disk: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  caught: number;
  alive: boolean;
}

registerTechnique({
  id: 'air_redirect',
  name: 'Wind Redirection',
  element: 'air',
  kind: 'defense',
  tier: 3,
  description: 'Catch incoming attacks in a whirl of wind and send them straight back at whoever threw them — stronger than before.',
  usage: 'Time it just before projectiles reach you: anything in front is returned to its owner (+50% damage). Attackers in reach are thrown back. A successful catch opens a Slipstream.',
  icon: 'air',
  chiCost: 12,
  cooldown: 1.5,
  windup: 0.06,
  recovery: 0.3,
  movement: 'root',
  airborne: true,
  interruptible: false,
  range: 7,
  channel: 0.55,
  begin(cast) {
    anim(cast.caster, 'air_redirect', { speed: 1.2, fadeIn: 0.03 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const mat = windMaterial({ wrapFlow: true, speed: 5, repeat: [1, 5], threshold: 0.38, body: 0.2, opacity: 0.9, fade: [0, 0] });
    const disk = new THREE.Mesh(shared('fx_redirect_disk', () => flatRing(0.15, 1, Math.PI * 2, 40, 'around')), mat);
    ctx.vfx.group.add(disk);
    const d: RedirectData = { disk, mat, caught: 0, alive: true };
    cast.data.redir = d;
    const dir = aimFlat(cast);
    let t = 0;
    let fadeFrom = -1;
    effect(
      (dt) => {
        t += dt;
        if (!d.alive && fadeFrom < 0) fadeFrom = t;
        const k = d.alive ? Math.min(1, t * 8) : Math.max(0, 1 - (t - fadeFrom) * 5);
        const chest = c.castOrigin('chest', tmp);
        disk.position.copy(chest).addScaledVector(dir, 1.1);
        disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        disk.rotateY(t * 14);
        disk.scale.setScalar(1.3 * (0.5 + 0.5 * k) + Math.sin(t * 30) * 0.03);
        setOpacity(mat, 0.9 * k);
        return d.alive || k > 0;
      },
      () => {
        disk.removeFromParent();
        mat.dispose();
      },
    );
    ctx.audio.play('bend_air_swirl', { position: c.position, volume: 0.6, pitch: 1.4 });
  },
  channelUpdate(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const d = cast.data.redir as RedirectData | undefined;
    if (!d) return false;
    const dir = aimFlat(cast);
    const chest = c.castOrigin('chest', new THREE.Vector3());
    const caught = deflectProjectiles(cast, chest, 7, 'return', { cone: { dir, halfAngle: 1.2 }, speedMul: 1.3, damageMul: 1.5 });
    if (caught.length) {
      d.caught += caught.length;
      openSlipstream(cast);
      c.chi = Math.min(c.maxChi, c.chi + 6 * caught.length);
      ctx.vfx.flash(chest, '#e8f6ff', 3, 0.15, 8);
      windRing(ctx, chest.clone().addScaledVector(dir, 1.2), { r0: 0.3, r1: 2.2, duration: 0.3, height: 0.6, axis: dir });
      shake(ctx, chest, 0.1, 0.15);
    }
    // Close-range counter push (once per cast per enemy).
    hitSphere(cast, chest.clone().addScaledVector(dir, 1.3), 1.8, 1.4, () => ({ damage: 4, knockback: push(dir, 14), stagger: 45 }));
    return true;
  },
  end(cast) {
    const d = cast.data.redir as RedirectData | undefined;
    if (d) d.alive = false;
  },
  aiScore: (_c, _t, dist) => (dist > 5 && dist < 20 ? 0.2 : 0),
});
