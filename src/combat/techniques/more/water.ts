import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { sharedIceMaterial } from '../../water/WaterMaterials';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { addEffect, effect } from '../../../vfx/effects/loop';
import { anim, resolveTarget } from '../bending/util';
import { fxOf, handPos, refundWater, returnToReserve, spill } from '../water/shared';

/**
 * Two more waterbending moves (both use real water, like every waterbending move).
 *  - Octopus Form: Master Pakku's form, used by Katara at the North Pole — water rises around you in
 *    eight tentacles that swat away blasts and lash anyone who comes close.
 *  - Ice Prison: water surges to a foe and freezes around them; they can neither move nor bend
 *    until the ice cracks.
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const ARMS = 8;
const REACH = 3.6;

class OctopusEffect implements WaterEffect {
  readonly kind = 'octopus';
  castId: number;
  private readonly fx: WaterFX;
  readonly arms: StreamBody[] = [];
  /** Strike state per arm: -1 idle, else seconds into the lash. */
  readonly strike: number[] = [];
  readonly strikeAt: THREE.Vector3[] = [];
  private t = 0;
  rise = 0;
  done = false;

  constructor(readonly cast: Cast) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    const n = this.fx.quality === 'low' ? 6 : ARMS;
    for (let i = 0; i < n; i++) {
      const b = new StreamBody(this.fx, { flow: 4, ice: cast.water.frozen ? 0.15 : 0 }, 1, 6);
      b.radius = 0.16;
      b.wobble = 0.05;
      this.arms.push(b);
      this.strike.push(-1);
      this.strikeAt.push(new THREE.Vector3());
    }
  }

  update(dt: number): boolean {
    this.t += dt;
    this.rise = this.done ? Math.max(0, this.rise - dt * 3) : Math.min(1, this.rise + dt * 3);
    const c = this.cast.caster;
    const base = c.position;
    const n = this.arms.length;
    for (let i = 0; i < n; i++) {
      const b = this.arms[i];
      const a = (i / n) * Math.PI * 2 + this.t * 0.6;
      const lash = this.strike[i];
      for (let k = 0; k < b.pts.length; k++) {
        const u = k / (b.pts.length - 1);
        // Each arm rises from the waist and curls outward, swaying.
        const r = 0.45 + u * 1.5 * this.rise;
        const y = 0.9 + Math.sin(u * Math.PI) * 1.1 * this.rise + u * 0.4;
        const sway = Math.sin(this.t * 3 + i * 1.3 + u * 2.5) * 0.35 * u;
        b.pts[k].set(base.x + Math.cos(a + sway) * r, base.y + y, base.z + Math.sin(a + sway) * r);
        if (lash >= 0) {
          // Lashing: the tip reaches for the target and snaps back.
          const s = Math.sin(Math.min(1, lash / 0.35) * Math.PI);
          b.pts[k].lerp(this.strikeAt[i], u * u * s);
        }
      }
      if (lash >= 0) this.strike[i] = lash + dt > 0.35 ? -1 : lash + dt;
      b.build();
    }
    return !(this.done && this.rise <= 0);
  }

  dispose(): void {
    for (const b of this.arms) b.dispose();
  }
}

registerTechnique({
  id: 'octopus_form',
  name: 'Octopus Form',
  element: 'water',
  kind: 'defense',
  tier: 3,
  description: 'Master Pakku\'s form: water rises around you in eight tentacles. They swat away blasts and lash anyone who steps within reach — a moving fortress of water.',
  usage: 'Defensive technique (slot). Lasts about four seconds; you can walk slowly inside it. Needs water.',
  icon: 'water',
  chiCost: 28,
  cooldown: 10,
  water: { amount: 30 },
  windup: 0.35,
  recovery: 0.3,
  movement: 'slow',
  airborne: false,
  channel: 4,
  interruptible: true,
  range: REACH,
  begin(cast) {
    anim(cast.caster, 'circle_arms', { speed: 1.1, fadeIn: 0.05 });
    cast.data.fx = fxOf(cast).add(new OctopusEffect(cast));
    cast.ctx.audio.play('water_gather', { position: cast.caster.position, volume: 0.7 });
  },
  release(cast) {
    cast.data.released = true;
    cast.data.loop = cast.ctx.audio.loop('water_swirl', { position: cast.caster.position, volume: 0.5 });
    cast.data.cd = new Map<number, number>();
  },
  channelUpdate(cast, dt) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const fx = cast.data.fx as OctopusEffect;
    if (!c.alive) return false;
    const center = tA.copy(c.position).setY(c.position.y + 1.1);
    // Blasts that reach the tentacles are swatted out of the air.
    for (const p of ctx.combat.projectilesInRadius(center, REACH, [])) {
      const owner = p.cast.caster;
      if (owner === c || !ctx.combat.canHarm(owner, c)) continue;
      p.kill();
      fxOf(cast).splash(p.position, 0.6, { sound: true });
      if (p.cast.def.element === 'water') returnToReserve(cast, 2);
    }
    // Anyone within reach gets lashed (each foe at most every 0.7 s).
    const cd = cast.data.cd as Map<number, number>;
    let arm = 0;
    for (const e of ctx.entities.queryRadius(c.position, REACH)) {
      if (e === c || !ctx.combat.canHarm(c, e)) continue;
      const until = cd.get(e.id) ?? 0;
      if (until > ctx.time.elapsed) continue;
      cd.set(e.id, ctx.time.elapsed + 0.7);
      const i = arm++ % fx.arms.length;
      fx.strike[i] = 0;
      e.aimPoint(fx.strikeAt[i]);
      const away = tB.copy(e.position).sub(c.position).setY(0).normalize();
      cast.hit(e, { damage: 8, knockback: away.multiplyScalar(6), stagger: 35, status: [{ type: 'soaked', duration: 4 }] }, true);
      ctx.audio.play('water_whip', { position: e.position, volume: 0.5, pitch: 1.2 });
    }
    (cast.data.loop as LoopHandle | undefined)?.setPosition(c.position);
    void dt;
    return true;
  },
  end(cast, interrupted) {
    const fx = cast.data.fx as OctopusEffect | undefined;
    if (fx) fx.done = true;
    (cast.data.loop as LoopHandle | undefined)?.stop(0.3);
    if (!cast.data.released) {
      if (interrupted) refundWater(cast);
      return;
    }
    if (cast.data.waterDone) return;
    cast.data.waterDone = true;
    const c = cast.caster;
    const back = returnToReserve(cast, cast.water.amount * 0.5);
    const g = cast.ctx.world.groundAt(c.position.x, c.position.z, c.position.y + 1);
    spill(cast, tA.set(c.position.x, g.y, c.position.z), cast.water.amount - back);
  },
  aiScore: (_c, _t, dist) => (dist < 6 ? 0.35 : 0.05),
});

registerTechnique({
  id: 'ice_prison',
  name: 'Ice Prison',
  element: 'water',
  kind: 'ability',
  tier: 3,
  description: 'Send water rushing to a foe and freeze it around them in a heartbeat. Encased to the chest, they can neither move nor bend until the ice cracks apart.',
  usage: 'Aim at or lock on to a foe and press. Needs water; the ice holds for about three seconds.',
  icon: 'water',
  chiCost: 24,
  cooldown: 9,
  water: { amount: 15 },
  windup: 0.3,
  recovery: 0.4,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 14,
  begin(cast) {
    anim(cast.caster, 'push_two', { speed: 1.2, fadeIn: 0.05 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const target = resolveTarget(cast, 3);
    const hand = handPos(c, 'hands', tA);
    const at = target ? target.position.clone() : cast.aimPoint.clone();
    // The water rushes there along the ground...
    fxOf(cast).splash(hand, 0.6, { sound: false });
    ctx.vfx.burst('spray', hand, { count: 10, dir: tB.copy(at).sub(hand), spread: 0.15, speed: 18 });
    ctx.audio.play('water_launch', { position: hand, volume: 0.7 });
    if (!target || !ctx.combat.canHarm(c, target)) {
      spill(cast, at, cast.water.amount);
      return;
    }
    // ...and freezes around the body.
    const hold = 3;
    cast.hit(target, { damage: 6, stagger: 40, status: [{ type: 'freeze', duration: hold, magnitude: 1 }, { type: 'soaked', duration: 5 }] });
    target.stunned = Math.max(target.stunned, 0.3);
    const ice = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), sharedIceMaterial());
    ice.scale.set(target.radius * 2 + 0.35, target.height * 0.5, target.radius * 2 + 0.35);
    ice.position.copy(target.position).setY(target.position.y + target.height * 0.38);
    ice.rotation.y = Math.random() * 3;
    ctx.vfx.group.add(ice);
    ctx.audio.play('ice_form', { position: target.position, volume: 0.9 });
    fxOf(cast).splash(target.position, 0.9, { ice: true, ring: true });
    let t = 0;
    const tgt = target;
    const unfreeze = () => {
      ice.removeFromParent();
      ice.geometry.dispose();
      ctx.audio.play('ice_shatter', { position: tgt.position, volume: 0.8 });
      ctx.vfx.burst('ice', tgt.aimPoint(tA), { count: 14, speed: 4 });
    };
    addEffect(
      effect((dt) => {
        t += dt;
        if (!tgt.alive || !tgt.hasStatus('freeze')) return false;
        ice.position.x = tgt.position.x;
        ice.position.z = tgt.position.z;
        return t < hold + 0.2;
      }, unfreeze),
    );
  },
  aiScore: (_c, _t, dist) => (dist < 12 ? 0.3 : 0),
});
