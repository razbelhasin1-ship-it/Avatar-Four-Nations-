import * as THREE from 'three';
import { sharedIceMaterial } from '../../water/WaterMaterials';
import { registerTechnique } from '../../CombatSystem';
import { addEffect, effect } from '../../../vfx/effects/loop';
import { anim, resolveTarget } from '../bending/util';
import { fxOf, handPos, spill } from '../water/shared';

/**
 * Ice Prison: water surges to a foe and freezes around them; they can neither move nor bend
 * until the ice cracks. (Octopus Form, the other added waterbending move, lives in ./octopus.ts.)
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();

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
