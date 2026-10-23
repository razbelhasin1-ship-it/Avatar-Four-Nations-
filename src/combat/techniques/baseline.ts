import * as THREE from 'three';
import { registerClip } from '../../character/Animator';
import { registerTechnique } from '../CombatSystem';
import type { Cast, ProjectileVisual } from '../types';

/**
 * Baseline techniques (one basic + one heavy per element) that make the game
 * playable from day one. The combat module replaces/extends these with the
 * full movesets in air.ts / water.ts / earth.ts / fire.ts.
 */

const strike = (id: string, arm: 'L' | 'R', reach: number) =>
  registerClip({
    id,
    duration: 0.42,
    mask: arm === 'R' ? 'armR' : 'armL',
    events: [{ t: 0.12, name: 'release' }],
    keys: [
      { t: 0, pose: arm === 'R' ? { upperArmR: [0.4, 0, -0.3], foreArmR: [-1.4, 0, 0] } : { upperArmL: [0.4, 0, 0.3], foreArmL: [-1.4, 0, 0] } },
      { t: 0.12, pose: arm === 'R' ? { upperArmR: [-1.5 * reach, 0, -0.05], foreArmR: [-0.05, 0, 0] } : { upperArmL: [-1.5 * reach, 0, 0.05], foreArmL: [-0.05, 0, 0] }, ease: 'out' },
      { t: 0.42, pose: arm === 'R' ? { upperArmR: [-0.4, 0, -0.2], foreArmR: [-0.9, 0, 0] } : { upperArmL: [-0.4, 0, 0.2], foreArmL: [-0.9, 0, 0] }, ease: 'inout' },
    ],
  });
strike('base_strike_r', 'R', 1);
strike('base_strike_l', 'L', 1);

registerClip({
  id: 'base_push_two',
  duration: 0.6,
  mask: 'upper',
  keys: [
    { t: 0, pose: { spine: [-0.1, 0, 0], upperArmL: [0.3, 0, 0.4], upperArmR: [0.3, 0, -0.4], foreArmL: [-1.6, 0, 0], foreArmR: [-1.6, 0, 0] } },
    { t: 0.22, pose: { spine: [0.2, 0, 0], upperArmL: [-1.5, 0, 0.1], upperArmR: [-1.5, 0, -0.1], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0] }, ease: 'out' },
    { t: 0.6, pose: { spine: [0, 0, 0], upperArmL: [-0.3, 0, 0.3], upperArmR: [-0.3, 0, -0.3], foreArmL: [-0.5, 0, 0], foreArmR: [-0.5, 0, 0] }, ease: 'inout' },
  ],
});

registerClip({
  id: 'base_stomp',
  duration: 0.7,
  mask: 'full',
  keys: [
    { t: 0, pose: { thighL: [-1.2, 0, 0.2], shinL: [1.2, 0, 0], upperArmL: [-0.3, 0, 0.8], upperArmR: [-0.3, 0, -0.8], hipsY: 0 } },
    { t: 0.28, pose: { thighL: [-0.3, 0, 0.35], shinL: [0.3, 0, 0], thighR: [-0.3, 0, -0.35], shinR: [0.5, 0, 0], upperArmL: [0.2, 0, 0.4], upperArmR: [0.2, 0, -0.4], spine: [0.25, 0, 0], hipsY: -0.25 }, ease: 'in' },
    { t: 0.7, pose: { thighL: [0, 0, 0.1], shinL: [0.1, 0, 0], thighR: [0, 0, -0.1], shinR: [0.1, 0, 0], spine: [0, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

function orbVisual(color: string, radius: number, additive = true): ProjectileVisual {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), mat);
  return {
    object: mesh,
    update: () => {},
    dispose: () => {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

function rockVisual(radius: number): ProjectileVisual {
  const mat = new THREE.MeshStandardMaterial({ color: '#7d6a55', roughness: 0.95, flatShading: true });
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), mat);
  mesh.castShadow = true;
  return {
    object: mesh,
    update: (_p, dt) => {
      mesh.rotation.x += dt * 6;
      mesh.rotation.z += dt * 4;
    },
    dispose: () => {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

function handOrigin(cast: Cast, hand: 'handL' | 'handR'): THREE.Vector3 {
  return cast.caster.castOrigin(hand, new THREE.Vector3());
}

// ---------------- AIR ----------------
registerTechnique({
  id: 'air_gust',
  name: 'Air Palm',
  element: 'air',
  kind: 'basic',
  tier: 1,
  description: 'A quick palm strike that sends a cone of wind, scattering foes.',
  usage: 'Primary attack. Chain up to three strikes.',
  icon: 'air',
  chiCost: 4,
  cooldown: 0,
  windup: 0.1,
  recovery: 0.22,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 9,
  starter: true,
  comboLength: 3,
  begin(cast) {
    cast.caster.humanoid?.animator.play(cast.comboIndex % 2 ? 'base_strike_l' : 'base_strike_r', { speed: 1.3 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, cast.comboIndex % 2 ? 'handL' : 'handR');
    const dir = cast.aimDir.clone();
    cast.areaHit({ center: o.clone().addScaledVector(dir, 3.5), radius: 4.2, cone: { dir, halfAngle: 0.6 }, damage: 7 + cast.comboIndex * 2, knockback: 7 + cast.comboIndex * 3, knockDir: dir, stagger: 10 });
    ctx.vfx.burst('air', o, { count: 16, dir, spread: 0.35, speed: 1.6 });
    ctx.world.fx.disturb(o.clone().addScaledVector(dir, 4), 4, 0.8);
    ctx.audio.play('whoosh', { position: o, volume: 0.6, pitch: 1.2 + cast.comboIndex * 0.1 });
  },
});

registerTechnique({
  id: 'air_blast_heavy',
  name: 'Air Blast',
  element: 'air',
  kind: 'heavy',
  tier: 1,
  description: 'Gather the wind between your palms and release a powerful blast.',
  usage: 'Hold Aim to charge, release to fire.',
  icon: 'air',
  chiCost: 14,
  cooldown: 1.2,
  windup: 0.18,
  recovery: 0.4,
  movement: 'slow',
  airborne: true,
  chargeTime: 1.2,
  interruptible: true,
  range: 16,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_push_two', { speed: 1.2 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, 'handR');
    const dir = cast.aimDir.clone();
    const c = 0.4 + cast.charge * 0.6;
    cast.areaHit({ center: o.clone().addScaledVector(dir, 6), radius: 6.5, cone: { dir, halfAngle: 0.5 }, damage: 18 * c, knockback: 18 * c, knockDir: dir, launch: 4 * c, stagger: 40 * c });
    ctx.vfx.burst('air', o, { count: 40, dir, spread: 0.3, speed: 2.4 });
    ctx.world.fx.disturb(o.clone().addScaledVector(dir, 6), 8, 1.4);
    ctx.audio.play('whoosh', { position: o, volume: 1, pitch: 0.8 });
    ctx.events.emit('camera:shake', { intensity: 0.12 * c, duration: 0.2 });
  },
});

// ---------------- WATER ----------------
registerTechnique({
  id: 'water_lash',
  name: 'Water Lash',
  element: 'water',
  kind: 'basic',
  tier: 1,
  description: 'Draw water and lash it at a foe. Requires a nearby water source or water you are holding.',
  usage: 'Primary attack. Needs water (rivers, sea, ponds, or your reserve).',
  icon: 'water',
  chiCost: 4,
  cooldown: 0,
  water: { amount: 4 },
  windup: 0.16,
  recovery: 0.25,
  movement: 'free',
  airborne: false,
  interruptible: false,
  range: 10,
  starter: true,
  comboLength: 3,
  begin(cast) {
    cast.caster.humanoid?.animator.play(cast.comboIndex % 2 ? 'base_strike_l' : 'base_strike_r', { speed: 1.1 });
    if (cast.water.from) cast.ctx.vfx.burst('splash', cast.water.from, { count: 8 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, cast.comboIndex % 2 ? 'handL' : 'handR');
    const v = cast.aimDir.clone().multiplyScalar(30);
    cast.projectile({
      position: o,
      velocity: v,
      radius: 0.35,
      life: 0.45,
      damage: 9 + cast.comboIndex * 2,
      knockback: 5,
      stagger: 14,
      status: [{ type: 'soaked', duration: 6 }],
      visual: orbVisual('#7fc8f0', 0.28, false),
      onHitEntity: (p) => ctx.vfx.burst('splash', p.position, { count: 12 }),
      onHitWorld: (_p, pt) => {
        ctx.vfx.burst('splash', pt, { count: 10 });
        ctx.world.fx.wet(pt, 1.5);
      },
    });
    ctx.audio.play('water_whoosh', { position: o, volume: 0.6 });
  },
});

registerTechnique({
  id: 'water_surge_heavy',
  name: 'Water Surge',
  element: 'water',
  kind: 'heavy',
  tier: 1,
  description: 'Gather a large volume of water and drive it forward as a crashing surge.',
  usage: 'Hold Aim to charge, release. Needs a good amount of water.',
  icon: 'water',
  chiCost: 14,
  cooldown: 1.6,
  water: { amount: 14 },
  windup: 0.3,
  recovery: 0.5,
  movement: 'slow',
  airborne: false,
  chargeTime: 1.3,
  interruptible: true,
  range: 14,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_push_two', { speed: 0.9 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, 'handR');
    const dir = cast.aimDir.clone().setY(Math.max(-0.2, cast.aimDir.y));
    const c = 0.5 + cast.charge * 0.5;
    cast.areaHit({ center: o.clone().addScaledVector(dir, 5), radius: 5, cone: { dir, halfAngle: 0.55 }, damage: 20 * c, knockback: 14 * c, knockDir: dir, stagger: 45 * c, status: [{ type: 'soaked', duration: 8 }] });
    ctx.vfx.burst('splash', o.clone().addScaledVector(dir, 3), { count: 50, dir, spread: 0.5, speed: 1.6 });
    ctx.vfx.burst('spray', o.clone().addScaledVector(dir, 5), { count: 20 });
    ctx.water.release(o.clone().addScaledVector(dir, 6), cast.water.amount * 0.6);
    ctx.audio.play('water_splash', { position: o, volume: 1 });
  },
});

// ---------------- EARTH ----------------
registerTechnique({
  id: 'earth_rock_strike',
  name: 'Rock Strike',
  element: 'earth',
  kind: 'basic',
  tier: 1,
  description: 'Pull a stone from the ground and punch it toward your target.',
  usage: 'Primary attack. Slower, but hits hard and staggers.',
  icon: 'earth',
  chiCost: 5,
  cooldown: 0,
  windup: 0.24,
  recovery: 0.3,
  movement: 'slow',
  airborne: false,
  interruptible: true,
  range: 22,
  starter: true,
  comboLength: 2,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_stomp', { speed: 1.6 });
    const f = cast.caster.position.clone().addScaledVector(cast.aimDir.clone().setY(0).normalize(), 1);
    cast.ctx.vfx.burst('dust', f, { count: 6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = cast.caster.castOrigin('chest', new THREE.Vector3()).addScaledVector(cast.aimDir.clone().setY(0).normalize(), 0.8);
    cast.projectile({
      position: o,
      velocity: cast.aimDir.clone().multiplyScalar(26),
      radius: 0.45,
      gravity: 4,
      life: 1.2,
      damage: 16,
      knockback: 8,
      stagger: 30,
      visual: rockVisual(0.4),
      onHitEntity: (p) => {
        ctx.vfx.burst('debris', p.position, { count: 10 });
        ctx.audio.play('rock_impact', { position: p.position, volume: 0.8 });
      },
      onHitWorld: (_p, pt) => {
        ctx.vfx.burst('debris', pt, { count: 8 });
        ctx.vfx.burst('dust', pt, { count: 6 });
        ctx.audio.play('rock_impact', { position: pt, volume: 0.6 });
      },
    });
    ctx.audio.play('rock_rise', { position: o, volume: 0.4, pitch: 1.5 });
  },
});

registerTechnique({
  id: 'earth_seismic_heavy',
  name: 'Seismic Stomp',
  element: 'earth',
  kind: 'heavy',
  tier: 1,
  description: 'Stamp the ground to send a shockwave rippling outward.',
  usage: 'Hold Aim to charge, release. Hits all around you.',
  icon: 'earth',
  chiCost: 16,
  cooldown: 2,
  windup: 0.35,
  recovery: 0.45,
  movement: 'root',
  airborne: false,
  chargeTime: 1.0,
  interruptible: false,
  range: 7,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_stomp');
  },
  release(cast) {
    const ctx = cast.ctx;
    const pos = cast.caster.position.clone();
    const c = 0.5 + cast.charge * 0.5;
    cast.areaHit({ center: pos.clone().setY(pos.y + 0.8), radius: 6 * c + 2, height: 2, damage: 22 * c, knockback: 10 * c, knockDir: 'radial', launch: 6 * c, stagger: 50 });
    ctx.vfx.ring(pos.clone().setY(pos.y + 0.15), '#c8a878', 8 * c + 2, 0.5, { opacity: 0.6 });
    ctx.vfx.burst('dust', pos, { count: 30, radius: 3 });
    ctx.vfx.burst('debris', pos, { count: 16, radius: 2 });
    ctx.world.fx.crack(pos, 3 + 3 * c);
    ctx.world.fx.disturb(pos, 8, 1.2);
    ctx.audio.play('rock_impact', { position: pos, volume: 1, pitch: 0.7 });
    ctx.events.emit('camera:shake', { intensity: 0.3 * c, duration: 0.35 });
  },
});

// ---------------- FIRE ----------------
registerTechnique({
  id: 'fire_jab',
  name: 'Fire Jab',
  element: 'fire',
  kind: 'basic',
  tier: 1,
  description: 'Fast alternating punches that throw bolts of flame.',
  usage: 'Primary attack. Chain up to four jabs quickly.',
  icon: 'fire',
  chiCost: 3,
  cooldown: 0,
  windup: 0.07,
  recovery: 0.16,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 18,
  starter: true,
  comboLength: 4,
  begin(cast) {
    cast.caster.humanoid?.animator.play(cast.comboIndex % 2 ? 'base_strike_l' : 'base_strike_r', { speed: 1.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, cast.comboIndex % 2 ? 'handL' : 'handR');
    const em = ctx.vfx.emitter('fire', 70, { speed: 0.3, size: 0.6 }, 0.6);
    cast.projectile({
      position: o,
      velocity: cast.aimDir.clone().multiplyScalar(34),
      radius: 0.3,
      life: 0.6,
      damage: 6 + (cast.comboIndex === 3 ? 6 : 0),
      knockback: 3,
      stagger: 8,
      status: cast.comboIndex === 3 ? [{ type: 'burn', duration: 2 }] : undefined,
      visual: {
        object: new THREE.Object3D(),
        update: (p) => em.position.copy(p.position),
        dispose: () => em.stop(),
      },
      onHitEntity: (p) => ctx.vfx.burst('fire', p.position, { count: 12 }),
      onHitWorld: (_p, pt) => {
        ctx.vfx.burst('fire', pt, { count: 8 });
        ctx.vfx.burst('smoke', pt, { count: 3 });
        ctx.world.fx.scorch(pt, 0.8);
      },
    });
    ctx.vfx.flash(o, '#ff9040', 2, 0.1, 6);
    ctx.audio.play('fire_burst', { position: o, volume: 0.5, pitch: 1.4 });
  },
});

registerTechnique({
  id: 'fire_blast_heavy',
  name: 'Fire Blast',
  element: 'fire',
  kind: 'heavy',
  tier: 1,
  description: 'Compress your breath and chi into a roaring fireball.',
  usage: 'Hold Aim to charge, release to fire. Burns.',
  icon: 'fire',
  chiCost: 15,
  cooldown: 1.4,
  windup: 0.2,
  recovery: 0.4,
  movement: 'slow',
  airborne: true,
  chargeTime: 1.2,
  interruptible: true,
  range: 26,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_push_two', { speed: 1.3 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, 'handR');
    const c = 0.4 + cast.charge * 0.6;
    const em = ctx.vfx.emitter('fire', 120, { speed: 0.5, size: 1 + c }, 2);
    cast.projectile({
      position: o,
      velocity: cast.aimDir.clone().multiplyScalar(28),
      radius: 0.5 + c * 0.4,
      life: 1.2,
      damage: 24 * c,
      knockback: 10 * c,
      stagger: 40 * c,
      status: [{ type: 'burn', duration: 3 * c }],
      visual: {
        object: new THREE.Object3D(),
        update: (p) => em.position.copy(p.position),
        dispose: () => em.stop(),
      },
      onHitEntity: (p) => {
        ctx.vfx.burst('fire', p.position, { count: 30, speed: 1.5 });
        ctx.vfx.flash(p.position, '#ff7a30', 6, 0.3, 14);
        cast.areaHit({ center: p.position.clone(), radius: 2.5 * c, damage: 8 * c, knockback: 5, knockDir: 'radial' });
      },
      onHitWorld: (_p, pt) => {
        ctx.vfx.burst('fire', pt, { count: 26, speed: 1.4 });
        ctx.vfx.burst('smoke', pt, { count: 6 });
        ctx.vfx.flash(pt, '#ff7a30', 6, 0.3, 14);
        ctx.world.fx.scorch(pt, 1.8 * c);
        cast.areaHit({ center: pt.clone(), radius: 2.5 * c, damage: 10 * c, knockback: 6, knockDir: 'radial' });
      },
    });
    ctx.vfx.flash(o, '#ff9040', 5, 0.2, 10);
    ctx.audio.play('fire_burst', { position: o, volume: 1 });
  },
});
