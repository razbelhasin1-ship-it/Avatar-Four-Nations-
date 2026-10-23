import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { ProjectileVisual } from '../../combat/types';
import type { BoneName } from '../../character/Animator';
import type { Humanoid } from '../../character/Humanoid';
import { debris, effect } from './loop';
import { rockGeometry, spikeGeometry, stoneMaterial } from './rocks';

/**
 * Earth effect builders: rocks torn out of the ground (they visibly rise from
 * where they came from), tumbling projectiles with dust, crowns of shards for
 * shockwaves, and stone plates bound to a humanoid's bones (guard / armor).
 */

const tmp = new THREE.Vector3();

function q(ctx: GameContext): 'low' | 'medium' | 'high' {
  return ctx.vfx.quality;
}

/**
 * A rock that erupts from the ground and hovers, waiting to be thrown. Animate
 * with the windup; hand it to a projectile with toVisual() at release.
 */
export class RisingRock {
  readonly mesh: THREE.Mesh;
  private t = 0;
  private alive = true;
  private launched = false;
  readonly current = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext,
    private readonly ground: THREE.Vector3,
    private readonly hoverY: number,
    readonly radius: number,
    readonly tint: string,
    private readonly riseTime = 0.2,
  ) {
    this.mesh = new THREE.Mesh(rockGeometry(Math.floor(Math.random() * 8), q(ctx) === 'high' ? 2 : 1), stoneMaterial(tint));
    this.mesh.scale.setScalar(radius);
    this.mesh.castShadow = q(ctx) !== 'low';
    this.mesh.position.copy(ground).setY(ground.y - radius);
    this.current.copy(this.mesh.position);
    ctx.vfx.group.add(this.mesh);
    ctx.vfx.burst('dust', ground, { count: 6, radius: radius, speed: 0.9 });
    debris(ground, q(ctx) === 'low' ? 3 : 6, { spread: 0.7, speed: 4.5, size: radius * 0.25, radius: radius * 0.6, color: tint, life: 1.2 });
    ctx.world.fx.crack(ground, radius * 1.8);
    effect(
      (dt) => {
        if (!this.alive || this.launched) return false;
        this.t += dt;
        const k = Math.min(1, this.t / riseTime);
        const e = 1 - Math.pow(1 - k, 3);
        const y = ground.y - radius + (hoverY - (ground.y - radius)) * e + (k >= 1 ? Math.sin(this.t * 9) * 0.03 : 0);
        this.mesh.position.set(ground.x, y, ground.z);
        this.mesh.rotation.y += dt * 2;
        this.current.copy(this.mesh.position);
        return true;
      },
      () => {
        if (!this.launched) this.dispose();
      },
    );
  }

  /** Becomes the projectile's visual (same mesh), tumbling with a dust trail. */
  toVisual(): ProjectileVisual {
    this.launched = true;
    this.mesh.removeFromParent();
    this.mesh.position.set(0, 0, 0);
    return rockVisualFor(this.ctx, this.mesh, this.radius, this.tint, true);
  }

  /** Crumble without throwing (interrupted). */
  crumble(): void {
    if (!this.alive || this.launched) return;
    debris(this.mesh.position, 6, { spread: 1.2, speed: 3, size: this.radius * 0.3, color: this.tint });
    this.ctx.vfx.burst('dust', this.mesh.position, { count: 6, radius: this.radius });
    this.dispose();
  }

  private dispose(): void {
    this.alive = false;
    this.mesh.removeFromParent();
  }
}

function rockVisualFor(ctx: GameContext, mesh: THREE.Mesh, radius: number, tint: string, owned: boolean): ProjectileVisual {
  const group = new THREE.Group();
  group.add(mesh);
  const spin = new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
  const dust = ctx.vfx.emitter('dust', q(ctx) === 'low' ? 10 : 22, { speed: 0.3, size: 0.25 + radius * 0.5, color: '#b8a488' }, 3);
  let t = 0;
  return {
    object: group,
    update: (p, dt) => {
      t += dt;
      mesh.rotation.x += spin.x * dt;
      mesh.rotation.y += spin.y * dt;
      mesh.rotation.z += spin.z * dt;
      dust.position.copy(p.position);
      if (Math.random() < dt * 6) debris(p.position, 1, { spread: 0.5, speed: 1, size: radius * 0.18, color: tint, life: 0.8 });
    },
    dispose: () => {
      dust.stop();
      if (!owned) mesh.geometry.dispose();
    },
  };
}

/** Thrown rock visual (no rising phase). */
export function rockVisual(ctx: GameContext, radius: number, tint: string): ProjectileVisual {
  const mesh = new THREE.Mesh(rockGeometry(Math.floor(Math.random() * 8), q(ctx) === 'high' ? 2 : 1), stoneMaterial(tint));
  mesh.scale.setScalar(radius);
  mesh.castShadow = q(ctx) !== 'low';
  return rockVisualFor(ctx, mesh, radius, tint, true);
}

/** Rock impact: chunks, dust, a crack. */
export function rockImpact(ctx: GameContext, pos: THREE.Vector3, size: number, tint: string): void {
  debris(pos, Math.round((q(ctx) === 'low' ? 4 : 8) + size * 6), { spread: 1.3, speed: 5 + size * 3, size: 0.1 + size * 0.12, radius: size * 0.3, color: tint, life: 1.6 });
  ctx.vfx.burst('dust', pos, { count: Math.round(6 + size * 8), radius: size * 0.6, speed: 1.2 + size });
  ctx.vfx.burst('debris', pos, { count: Math.round(4 + size * 6), color: tint });
  const g = ctx.world.groundAt(pos.x, pos.z, pos.y + 1).y;
  if (pos.y - g < 1.2) ctx.world.fx.crack(tmp.set(pos.x, g, pos.z), 0.6 + size);
}

/**
 * Crown of stone shards bursting out of the ground in an expanding ring
 * (shockwave stomps). Visual only — pair with a ringSweep for hits.
 */
export function shardRing(ctx: GameContext, center: THREE.Vector3, radius: number, tint: string, duration = 0.3): void {
  const low = q(ctx) === 'low';
  const rings = radius > 5 ? 2 : 1;
  for (let r = 0; r < rings; r++) {
    const rr = radius * (rings === 1 ? 0.6 : r === 0 ? 0.4 : 0.85);
    const n = Math.round((low ? 7 : 12) * (0.6 + rr / radius));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const x = center.x + Math.cos(a) * rr, z = center.z + Math.sin(a) * rr;
      const g = ctx.world.groundAt(x, z, center.y + 2).y;
      if (ctx.world.liquidAt(x, z)) continue;
      const h = 0.7 + Math.random() * 0.8 + (r === 0 ? 0.3 : 0);
      const w = 0.25 + Math.random() * 0.2;
      const m = new THREE.Mesh(spikeGeometry(i % 4), stoneMaterial(tint));
      m.position.set(x, g - h, z);
      // Lean outward from the centre.
      m.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5, 'XYZ');
      m.lookAt(x + Math.cos(a), g + 2.2, z + Math.sin(a));
      m.rotateX(Math.PI / 2);
      m.scale.set(w, h, w);
      const delay = (rr / radius) * duration * 0.8;
      const life = delay + 0.75;
      ctx.vfx.addTransient(m, life, (t) => {
        const lt = (t * life - delay) / 0.75;
        if (lt <= 0) return;
        const up = lt < 0.2 ? 1 - Math.pow(1 - lt / 0.2, 3) : lt > 0.55 ? Math.max(0, 1 - (lt - 0.55) / 0.45) : 1;
        m.position.y = g - h + h * up * 0.95;
        if (lt > 0.02 && lt < 0.06 && Math.random() < 0.5) ctx.vfx.burst('dust', tmp.set(x, g + 0.1, z), { count: 2, speed: 1 });
      }, () => {});
    }
  }
  ctx.vfx.ring(center.clone().setY(center.y + 0.12), '#c8b088', radius * 1.15, duration + 0.25, { opacity: 0.55 });
  ctx.vfx.burst('dust', center, { count: low ? 18 : 34, radius: radius * 0.5, speed: 2.4, size: 1.4 });
  debris(center, low ? 8 : 16, { spread: 1.4, speed: 7, size: 0.16, radius: radius * 0.4, color: tint, life: 1.8 });
}

/** Stone plates bound to humanoid bones (Stone Guard forearms, Rock Armor). */
export class BoneArmor {
  private readonly parts: Array<{ mesh: THREE.Mesh; bone: THREE.Object3D; scale: THREE.Vector3; delay: number }> = [];
  private t = 0;
  private dying = false;
  private dieT = 0;
  private alive = true;

  constructor(
    private readonly ctx: GameContext,
    private readonly humanoid: Humanoid,
    spec: Array<{ bone: BoneName; offset: [number, number, number]; scale: [number, number, number]; rot?: [number, number, number] }>,
    readonly tint: string,
  ) {
    spec.forEach((s, i) => {
      const bone = humanoid.bones[s.bone];
      const mesh = new THREE.Mesh(rockGeometry((i * 3) % 8, 1), stoneMaterial(tint));
      mesh.position.set(...s.offset);
      if (s.rot) mesh.rotation.set(...s.rot);
      mesh.scale.setScalar(0.001);
      mesh.castShadow = q(ctx) !== 'low';
      bone.add(mesh);
      this.parts.push({ mesh, bone, scale: new THREE.Vector3(...s.scale), delay: i * 0.03 });
    });
    effect(
      (dt) => this.update(dt),
      () => this.dispose(),
    );
  }

  private update(dt: number): boolean {
    if (!this.alive) return false;
    this.t += dt;
    if (this.dying) {
      this.dieT += dt;
      if (this.dieT > 0.01) {
        for (const p of this.parts) {
          p.mesh.getWorldPosition(tmp);
          debris(tmp, 2, { spread: 1.4, speed: 3, size: 0.09, color: this.tint, life: 1.2 });
        }
        this.ctx.vfx.burst('dust', this.humanoid.root.getWorldPosition(tmp).setY(tmp.y + 1), { count: 8, radius: 0.6 });
        return false;
      }
      return true;
    }
    for (const p of this.parts) {
      const k = Math.min(1, Math.max(0, (this.t - p.delay) / 0.18));
      const e = 1 - Math.pow(1 - k, 3);
      p.mesh.scale.copy(p.scale).multiplyScalar(Math.max(0.001, e * (k < 1 ? 1.15 - 0.15 * k : 1)));
    }
    return true;
  }

  /** Crack off and fall away as debris. */
  shatter(): void {
    this.dying = true;
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const p of this.parts) p.mesh.removeFromParent();
  }
}
