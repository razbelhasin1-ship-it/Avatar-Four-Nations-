import * as THREE from 'three';
import { registerTechnique } from '../../CombatSystem';
import { easeOut } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { StreamBody, type WaterEffect } from '../../water/WaterFX';
import { createWaterMaterial } from '../../water/WaterMaterials';
import type { Cast, Projectile, ProjectileVisual } from '../../types';
import { douse, fxOf, GatherStream, handPos, refundWater, shake, spill } from './shared';

/**
 * Water Blast (heavy): hold to charge. Water rushes from the source (or the
 * reserve) and coils into a sphere between the hands, then is driven forward
 * as a heavy water bullet trailing a tail of water. Big knockback; a full
 * charge launches. The projectile visual is the projectile (same position,
 * radius scaled to the collision radius); it douses fire projectiles it
 * crosses with a burst of steam.
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
let blobGeo: THREE.SphereGeometry | null = null;

/** The coil of water forming between the hands during the windup. */
class CoilEffect implements WaterEffect {
  readonly kind = 'blast_coil';
  castId: number;
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private t = 0;
  private done = false;
  readonly center = new THREE.Vector3();

  constructor(readonly cast: Cast, readonly finalRadius: number) {
    this.castId = cast.id;
    blobGeo ??= new THREE.SphereGeometry(1, 20, 14);
    this.mat = createWaterMaterial({ flow: 5, ice: cast.water.frozen ? 0.25 : 0, opacity: 0.95 });
    this.mesh = new THREE.Mesh(blobGeo, this.mat);
    this.mesh.renderOrder = 12;
    this.mesh.frustumCulled = false;
    fxOf(cast).group.add(this.mesh);
  }

  finish(): void {
    this.done = true;
  }

  update(dt: number): boolean {
    if (this.done) return false;
    this.t += dt;
    const c = this.cast.caster;
    handPos(c, 'hands', this.center).addScaledVector(tA.set(Math.sin(c.yaw), 0, Math.cos(c.yaw)), 0.32);
    const g = easeOut(this.t / Math.max(0.05, this.cast.def.windup));
    const r = this.finalRadius * (0.25 + 0.75 * g);
    const t = fxOf(this.cast).time;
    this.mesh.position.copy(this.center);
    this.mesh.scale.set(r * (1 + 0.12 * Math.sin(t * 17)), r * (1 + 0.12 * Math.sin(t * 13 + 1)), r * (1 + 0.12 * Math.sin(t * 15 + 2)));
    this.mesh.rotation.y += dt * 6;
    return this.t < 3;
  }

  dispose(): void {
    fxOf(this.cast).group.remove(this.mesh);
    this.mat.dispose();
  }
}

/** Projectile visual: a wobbling water bullet with a trailing tail built from its path history. */
function blastVisual(cast: Cast, radius: number, start: THREE.Vector3): ProjectileVisual & { tail: StreamBody } {
  const fx = fxOf(cast);
  blobGeo ??= new THREE.SphereGeometry(1, 20, 14);
  const mat = createWaterMaterial({ flow: 9, ice: cast.water.frozen ? 0.2 : 0, opacity: 0.96 });
  const mesh = new THREE.Mesh(blobGeo, mat);
  mesh.renderOrder = 12;
  mesh.frustumCulled = false;
  const tail = new StreamBody(fx, { flow: 12, opacity: 0.9 }, 0.8, 8);
  tail.wobble = 0.07;
  const hist: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) hist.push(start.clone());
  let acc = 0;
  let time = 0;
  return {
    object: mesh,
    tail,
    update: (p: Projectile, dt: number) => {
      time += dt;
      acc += dt;
      if (acc > 0.025) {
        acc = 0;
        for (let i = 0; i < hist.length - 1; i++) hist[i].copy(hist[i + 1]);
        hist[hist.length - 1].copy(p.position);
      }
      // Tail: oldest → newest → current position.
      for (let i = 0; i < 7; i++) tail.pts[i].copy(hist[i + 1]);
      tail.pts[7].copy(p.position);
      tail.radius = radius * 0.8;
      tail.profile = (u) => capTaper(u, 0.5, 0.02) * (0.35 + 0.65 * u) * (0.85 + 0.15 * Math.sin(u * 20 - time * 30));
      tail.build(8);
      const s = radius;
      mesh.scale.set(s * (1 + 0.1 * Math.sin(time * 23)), s * (1 + 0.1 * Math.sin(time * 19 + 1)), s * (1.15 + 0.1 * Math.sin(time * 21 + 2)));
      mesh.lookAt(tA.copy(p.position).add(p.velocity));
      // Drops stream off the flying mass.
      if (Math.random() < dt * 40) fx.shed(p.position, p.velocity, 2, 1.8);
    },
    dispose: () => {
      tail.dispose();
      mat.dispose();
    },
  };
}

function impact(cast: Cast, p: Projectile, at: THREE.Vector3, c: number): void {
  const fx = fxOf(cast);
  const dir = tA.copy(p.velocity).normalize();
  // A heavy burst of real water: a big crown thrown along the blast, a second one up, a wet flash.
  fx.splash(at, 1.4 + c, { volume: 1, dir });
  fx.crown(at, 0.9 + c);
  cast.ctx.vfx.burst('spray', at, { count: 6, size: 0.9 + 0.5 * c });
  cast.ctx.vfx.flash(at, '#6fcfff', 1.2 + 1.2 * c, 0.16, 8);
  // Splash damage around the impact (single hit per entity per cast).
  cast.areaHit({ center: at.clone(), radius: 1.6 + 1.2 * c, height: 1.6, damage: 5 + 5 * c, knockback: 7 + 4 * c, knockDir: 'radial', stagger: 15, status: [{ type: 'soaked', duration: 8 }] });
  spill(cast, at, cast.water.amount * 0.75);
  cast.ctx.world.fx.disturb(at, 3 + 2 * c, 0.8);
  shake(cast, 0.12 + 0.18 * c, 0.22);
  void p;
}

registerTechnique({
  id: 'water_blast',
  name: 'Water Blast',
  element: 'water',
  kind: 'heavy',
  tier: 1,
  description: 'Gather a large mass of water into a churning sphere and drive it forward like a battering ram. A full charge sends foes flying.',
  usage: 'Hold Aim to charge, release to fire. Needs a good amount of real water (source or reserve).',
  icon: 'water',
  chiCost: 14,
  cooldown: 0.6,
  water: { amount: 12 },
  windup: 0.26,
  recovery: 0.42,
  movement: 'slow',
  airborne: true,
  chargeTime: 1.2,
  interruptible: true,
  range: 22,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('water_blast', { fadeIn: 0.05 });
    const fx = fxOf(cast);
    const c = 0.35 + 0.65 * cast.charge;
    const radius = 0.38 + 0.32 * c;
    cast.data.radius = radius;
    const coil = fx.add(new CoilEffect(cast, radius));
    cast.data.coil = coil;
    cast.data.gather = fx.add(
      new GatherStream(cast, {
        hand: 'hands',
        duration: cast.def.windup * 0.95,
        radius: 0.12 + 0.12 * c,
        look: { ice: cast.water.frozen ? 0.25 : 0 },
        target: (out) => out.copy(coil.center),
      }),
    );
  },
  release(cast) {
    cast.data.released = true;
    const ctx = cast.ctx;
    const c = 0.35 + 0.65 * cast.charge;
    const radius: number = cast.data.radius ?? 0.5;
    (cast.data.gather as GatherStream | undefined)?.absorb();
    const coil = cast.data.coil as CoilEffect | undefined;
    const start = coil ? coil.center.clone() : handPos(cast.caster, 'hands');
    coil?.finish();
    const dir = cast.aimDir.clone();
    if (dir.y < -0.35) dir.setY(-0.35).normalize();
    const visual = blastVisual(cast, radius, start);
    let weakened = false;
    const near: Projectile[] = [];
    cast.projectile({
      position: start,
      velocity: dir.clone().multiplyScalar(21 + 10 * cast.charge),
      radius: radius * 0.95,
      gravity: 2.5,
      life: 1.15,
      damage: 14 + 20 * cast.charge,
      knockback: 9 + 11 * cast.charge,
      launch: cast.charge > 0.8 ? 6 : cast.charge > 0.45 ? 2.5 : 0,
      stagger: 30 + 35 * cast.charge,
      status: [{ type: 'soaked', duration: 8 }],
      visual: {
        object: visual.object,
        update: (p, dt) => {
          visual.update(p, dt);
          // Water meets fire: douse hostile fire projectiles in its path.
          for (const q of ctx.combat.projectilesInRadius(p.position, radius + 0.3, near)) {
            if (q === p || q.cast.caster === cast.caster || q.cast.def.element !== 'fire') continue;
            q.kill();
            fxOf(cast).steam(q.position, 1.2);
            if (!weakened) {
              weakened = true;
              (p.spec as { damage: number }).damage *= 0.7;
            }
          }
        },
        dispose: visual.dispose,
      },
      onHitEntity: (p, e) => {
        douse(cast, e);
        impact(cast, p, p.position.clone(), c);
      },
      onHitWorld: (p, pt) => impact(cast, p, pt, c),
      onExpire: (p) => {
        fxOf(cast).droplets(visual.tail.path, 0, visual.tail.path.length, 6);
        const g = ctx.world.groundAt(p.position.x, p.position.z, p.position.y + 1);
        tB.set(p.position.x, g.y + 0.05, p.position.z);
        spill(cast, tB, cast.water.amount * 0.6);
      },
    });
    ctx.audio.play('water_launch', { position: start, volume: 0.8 + 0.2 * c, pitch: 1.15 - 0.3 * c });
    ctx.vfx.burst('spray', start, { count: 4, dir, spread: 0.4, speed: 1.4 });
    fxOf(cast).shed(start, tA.copy(dir).multiplyScalar(14), 8, 2.2);
    shake(cast, 0.06 + 0.08 * c, 0.15);
  },
  end(cast, interrupted) {
    (cast.data.coil as CoilEffect | undefined)?.finish();
    if (interrupted && !cast.data.released) {
      const g = cast.data.gather as GatherStream | undefined;
      g?.drop();
      refundWater(cast);
    }
  },
  aiScore(_caster, _target, dist) {
    return dist > 5 && dist < 20 ? 0.6 : 0.1;
  },
});
