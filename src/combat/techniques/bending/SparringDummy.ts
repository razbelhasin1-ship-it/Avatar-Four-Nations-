import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { Entity, Health, type HitInfo, type HitResult } from '../../../entities/Entity';
import { KinematicBody } from '../../../entities/KinematicBody';
import type { Element } from '../../../core/types';
import type { Combatant } from '../../types';

/**
 * Weighted sparring dummy: unlike the fixed TrainingDummy it has a physics body,
 * so knockback, launches, pulls and knockdowns visibly move it. Used by the
 * bending e2e tests (window.__game.debug.bending.spawnTarget) and available to
 * training content. kind 'target' → only the player/allies may damage it.
 */
export class SparringDummy extends Entity implements Combatant {
  readonly kind = 'target' as const;
  // Combatant surface so a dummy can act as a scripted "turret" in tests
  // (window.__game.debug.bending.shootAt): it never casts on its own.
  readonly humanoid = null;
  readonly isPlayer = false;
  element: Element = 'fire';
  chi = 100;
  maxChi = 100;
  waterReserve = 0;
  maxWaterReserve = 0;
  totalDamage = 0;
  hits = 0;
  lastElement: string | null = null;
  /** Largest launch speed received (tests). */
  maxLaunch = 0;
  knockdowns = 0;
  private wobble = 0;
  private readonly wobbleDir = new THREE.Vector3(1, 0, 0);
  private readonly post = new THREE.Group();
  private readonly materials: THREE.Material[] = [];
  private tilt = 0;
  private downTimer = 0;

  constructor(hp = 400) {
    super();
    this.name = 'Sparring Dummy';
    this.team = 'neutral';
    this.tags.add('dummy');
    this.tags.add('sparring');
    this.height = 1.8;
    this.radius = 0.42;
    this.health = new Health(hp, 60, 30);
    this.body = new KinematicBody(0.38, 1.8);
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5634', roughness: 0.9 });
    const sack = new THREE.MeshStandardMaterial({ color: '#c9b27a', roughness: 1 });
    const band = new THREE.MeshStandardMaterial({ color: '#3a5f8a', roughness: 0.9 });
    this.materials.push(wood, sack, band);
    const parts: Array<[THREE.BufferGeometry, THREE.Material, number]> = [
      [new THREE.CylinderGeometry(0.34, 0.4, 0.22, 12), wood, 0.11],
      [new THREE.CylinderGeometry(0.07, 0.08, 1.2, 8), wood, 0.7],
      [new THREE.CapsuleGeometry(0.3, 0.55, 4, 10), sack, 1.2],
      [new THREE.SphereGeometry(0.2, 12, 8), sack, 1.72],
      [new THREE.TorusGeometry(0.31, 0.04, 6, 16), band, 1.05],
    ];
    for (const [g, m, y] of parts) {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = y;
      if (g instanceof THREE.TorusGeometry) mesh.rotation.x = Math.PI / 2;
      mesh.castShadow = true;
      mesh.userData.ownsGeometry = true;
      this.post.add(mesh);
    }
    this.root.add(this.post);
  }

  castOrigin(which: 'handL' | 'handR' | 'hands' | 'chest' | 'feet', out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.position);
    out.y += which === 'feet' ? 0.1 : 1.3;
    return out;
  }

  powerMultiplier(): number {
    return 1;
  }

  override receiveHit(hit: HitInfo, ctx: GameContext): HitResult {
    const res = super.receiveHit(hit, ctx);
    this.totalDamage += res.damage;
    this.hits++;
    this.lastElement = hit.element;
    this.maxLaunch = Math.max(this.maxLaunch, hit.launch ?? 0);
    this.wobble = Math.min(1.4, this.wobble + 0.5 + res.damage / 30);
    if (hit.knockback && hit.knockback.lengthSq() > 0.01) this.wobbleDir.copy(hit.knockback).setY(0).normalize();
    if (hit.knockdown && !res.blocked) {
      this.knockdowns++;
      this.downTimer = 1.1;
    }
    return res;
  }

  protected override onDeath(ctx: GameContext): void {
    // Sparring dummies never die: refill and keep going.
    this.alive = true;
    this.health!.reset();
    ctx.vfx.burst('debris', this.aimPoint(), { count: 10, color: '#c9b27a' });
  }

  update(dt: number, ctx: GameContext): void {
    const h = this.health!;
    h.update(dt);
    const dot = this.updateStatuses(dt);
    if (dot > 0) {
      h.hp = Math.max(1, h.hp - dot);
      this.totalDamage += dot;
    }
    const b = this.body!;
    b.move.set(0, 0, 0);
    b.step(dt, this.root.position, ctx.world);
    if (this.root.position.y < -80) {
      // Fell out of the world: put it back on the ground.
      const p = this.root.position;
      b.place(new THREE.Vector3(p.x, ctx.world.groundAt(p.x, p.z).y + 0.1, p.z), p);
    }
    this.wobble = Math.max(0, this.wobble - dt * 1.5);
    this.downTimer = Math.max(0, this.downTimer - dt);
    const targetTilt = this.downTimer > 0 ? 1.35 : 0;
    this.tilt += (targetTilt - this.tilt) * Math.min(1, dt * (this.downTimer > 0 ? 14 : 4));
    const a = Math.sin(ctx.time.elapsed * 13) * this.wobble * 0.22 + this.tilt;
    this.post.rotation.set(this.wobbleDir.z * a, 0, -this.wobbleDir.x * a);
  }

  override dispose(): void {
    for (const m of this.materials) m.dispose();
    super.dispose();
  }
}
