import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { Entity, Health, type HitInfo, type HitResult } from './Entity';
import { KinematicBody } from './KinematicBody';

/**
 * Wooden training target. Takes hits (kind 'target' — the player may always
 * hit it), records damage, wobbles, and optionally resets after being broken.
 * Used by training challenges, the tutorial and automated tests.
 */
export class TrainingDummy extends Entity {
  readonly kind = 'target' as const;
  totalDamage = 0;
  hits = 0;
  lastElement: string | null = null;
  private wobble = 0;
  private wobbleDir = new THREE.Vector3();
  private readonly post: THREE.Group;
  private readonly materials: THREE.Material[] = [];
  respawnTime = 3;
  private brokenTimer = 0;
  onHitCallback: ((hit: HitInfo, res: HitResult) => void) | null = null;

  constructor(hp = 120, opts: { color?: string; label?: string } = {}) {
    super();
    this.name = opts.label ?? 'Training Dummy';
    this.team = 'neutral';
    this.tags.add('dummy');
    this.height = 1.8;
    this.radius = 0.4;
    this.health = new Health(hp, 9999, 0);
    this.body = new KinematicBody(0.35, 1.8);
    this.post = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: opts.color ?? '#9a6a3a', roughness: 0.9 });
    const straw = new THREE.MeshStandardMaterial({ color: '#d8c070', roughness: 1 });
    const cloth = new THREE.MeshStandardMaterial({ color: '#b03a2a', roughness: 0.9 });
    this.materials.push(wood, straw, cloth);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.9, 8), wood);
    pole.position.y = 0.95;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.8, 10), straw);
    body.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), straw);
    head.position.y = 1.72;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), wood);
    arm.rotation.z = Math.PI / 2;
    arm.position.y = 1.35;
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 14), cloth);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 1.0;
    for (const m of [pole, body, head, arm, sash]) {
      m.castShadow = true;
      m.userData.ownsGeometry = true;
      this.post.add(m);
    }
    this.root.add(this.post);
  }

  override receiveHit(hit: HitInfo, ctx: GameContext): HitResult {
    if (this.brokenTimer > 0) return { damage: 0, killed: false, blocked: false, staggered: false };
    const res = super.receiveHit({ ...hit, knockback: undefined, launch: undefined }, ctx);
    this.totalDamage += res.damage;
    this.hits++;
    this.lastElement = hit.element;
    this.wobble = Math.min(1.2, this.wobble + 0.4 + res.damage / 40);
    if (hit.knockback) this.wobbleDir.copy(hit.knockback).setY(0).normalize();
    else this.wobbleDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.onHitCallback?.(hit, res);
    return res;
  }

  protected override onDeath(ctx: GameContext): void {
    this.alive = true; // dummies break, then reset
    this.brokenTimer = this.respawnTime;
    this.post.visible = false;
    ctx.vfx.burst('debris', this.aimPoint(), { count: 14, color: '#c8a050' });
    ctx.vfx.burst('dust', this.position, { count: 10 });
  }

  update(dt: number, ctx: GameContext): void {
    this.health!.update(dt);
    if (this.brokenTimer > 0) {
      this.brokenTimer -= dt;
      if (this.brokenTimer <= 0) {
        this.post.visible = true;
        this.health!.reset();
      }
    }
    this.wobble = Math.max(0, this.wobble - dt * 1.6);
    const t = ctx.time.elapsed;
    const a = Math.sin(t * 14) * this.wobble * 0.25;
    this.post.rotation.set(this.wobbleDir.z * a, 0, -this.wobbleDir.x * a);
  }

  override dispose(): void {
    for (const m of this.materials) m.dispose();
    super.dispose();
  }
}
