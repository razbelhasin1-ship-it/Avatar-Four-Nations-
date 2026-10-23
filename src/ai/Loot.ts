import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { itemById } from '../data/items';
import type { EnemyArchetype } from '../data/enemies';

/**
 * Loot dropped by defeated enemies: coin stacks and item pouches that pop out,
 * settle on the ground, glint, drift toward a nearby player and are collected
 * by walking over them (toast + sound). Uncollected loot fades after 2 minutes.
 */

interface Drop {
  kind: 'coins' | 'item';
  item: string | null;
  count: number;
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  grounded: boolean;
  spin: number;
}

let coinGeo: THREE.BufferGeometry | null = null;
let pouchGeo: THREE.BufferGeometry | null = null;
let coinMat: THREE.MeshStandardMaterial | null = null;
let pouchMat: THREE.MeshStandardMaterial | null = null;
let tieMat: THREE.MeshStandardMaterial | null = null;

function resources() {
  coinGeo ??= new THREE.CylinderGeometry(0.1, 0.1, 0.035, 14);
  pouchGeo ??= new THREE.SphereGeometry(0.15, 10, 8);
  coinMat ??= new THREE.MeshStandardMaterial({ color: '#e8b830', roughness: 0.3, metalness: 0.85, emissive: '#5a3c00', emissiveIntensity: 0.6 });
  pouchMat ??= new THREE.MeshStandardMaterial({ color: '#8a5a30', roughness: 0.9, emissive: '#2a1400', emissiveIntensity: 0.4 });
  tieMat ??= new THREE.MeshStandardMaterial({ color: '#d8b040', roughness: 0.5, metalness: 0.5 });
  return { coinGeo, pouchGeo, coinMat, pouchMat, tieMat };
}

export class LootManager {
  readonly group = new THREE.Group();
  private drops: Drop[] = [];
  /** Totals collected this session (tests / debug). */
  collected = { coins: 0, items: 0 };

  constructor() {
    this.group.name = 'enemy-loot';
  }

  get count(): number {
    return this.drops.length;
  }

  list(): Array<{ kind: string; item: string | null; count: number; x: number; y: number; z: number }> {
    return this.drops.map((d) => ({ kind: d.kind, item: d.item, count: d.count, x: d.pos.x, y: d.pos.y, z: d.pos.z }));
  }

  /** Roll the archetype's loot table and scatter the drops around `at`. */
  spawnFor(ctx: GameContext, arch: EnemyArchetype, at: THREE.Vector3, level: number): number {
    const table = arch.loot;
    let n = 0;
    const [c0, c1] = table.coins;
    if (c1 > 0) {
      const coins = Math.round((c0 + Math.random() * (c1 - c0)) * (1 + (level - 1) * 0.05));
      if (coins > 0) {
        this.add(ctx, 'coins', null, coins, at);
        n++;
      }
    }
    for (const it of table.items) {
      if (Math.random() > it.chance || !itemById(it.item)) continue;
      const [a, b] = it.count ?? [1, 1];
      this.add(ctx, 'item', it.item, a + Math.floor(Math.random() * (b - a + 1)), at);
      n++;
    }
    return n;
  }

  private add(ctx: GameContext, kind: Drop['kind'], item: string | null, count: number, at: THREE.Vector3): void {
    const r = resources();
    let obj: THREE.Object3D;
    if (kind === 'coins') {
      const g = new THREE.Group();
      const stack = Math.min(5, 1 + Math.floor(count / 8));
      for (let i = 0; i < stack; i++) {
        const m = new THREE.Mesh(r.coinGeo, r.coinMat);
        m.position.set((i % 2) * 0.03, i * 0.036, ((i * 7) % 3) * 0.015);
        g.add(m);
      }
      obj = g;
    } else {
      const g = new THREE.Group();
      const body = new THREE.Mesh(r.pouchGeo, r.pouchMat);
      body.scale.set(1, 0.85, 1);
      const tie = new THREE.Mesh(r.coinGeo, r.tieMat);
      tie.scale.set(0.5, 1.6, 0.5);
      tie.position.y = 0.13;
      g.add(body, tie);
      obj = g;
    }
    for (const c of obj.children) c.castShadow = true;
    const a = Math.random() * Math.PI * 2;
    const pos = at.clone().setY(at.y + 1);
    obj.position.copy(pos);
    this.group.add(obj);
    this.drops.push({ kind, item, count, obj, pos, vel: new THREE.Vector3(Math.cos(a) * 2.2, 4.5 + Math.random() * 1.5, Math.sin(a) * 2.2), age: 0, grounded: false, spin: (Math.random() - 0.5) * 6 });
    ctx.vfx.burst('glow', pos, { color: kind === 'coins' ? '#ffd860' : '#ffe8b0', size: 0.6, count: 1 });
  }

  update(dt: number, ctx: GameContext): void {
    const p = ctx.player;
    const pp = p && !p.defeated ? p.position : null;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (!d.grounded) {
        d.vel.y -= 18 * dt;
        d.pos.addScaledVector(d.vel, dt);
        const gy = ctx.world.groundAt(d.pos.x, d.pos.z, d.pos.y + 0.5).y + 0.12;
        if (d.pos.y <= gy && d.vel.y < 0) {
          d.pos.y = gy;
          if (Math.abs(d.vel.y) > 2.5) {
            d.vel.y *= -0.35;
            d.vel.x *= 0.5;
            d.vel.z *= 0.5;
          } else {
            d.grounded = true;
            d.vel.set(0, 0, 0);
          }
        }
      }
      let collect = false;
      if (pp && d.age > 0.45) {
        const dx = pp.x - d.pos.x, dz = pp.z - d.pos.z, dy = pp.y + 0.6 - d.pos.y;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.3 && Math.abs(dy) < 2.2) collect = true;
        else if (dist < 3.5 && d.grounded) {
          // Gentle magnet toward the player.
          const k = Math.min(1, (6 * dt) / Math.max(dist, 0.1));
          d.pos.x += dx * k;
          d.pos.z += dz * k;
          d.pos.y = ctx.world.groundAt(d.pos.x, d.pos.z, d.pos.y + 0.6).y + 0.12;
        }
      }
      if (collect) {
        this.collect(ctx, d);
        this.drops.splice(i, 1);
        continue;
      }
      d.spin += 0;
      d.obj.position.set(d.pos.x, d.pos.y + (d.grounded ? 0.08 + Math.sin(d.age * 3 + i) * 0.05 : 0), d.pos.z);
      d.obj.rotation.y += dt * (d.grounded ? 1.6 : d.spin);
      if (d.grounded && Math.random() < dt * 1.5) ctx.vfx.burst('glow', d.obj.position, { color: d.kind === 'coins' ? '#ffd860' : '#ffe8b0', size: 0.35, count: 1 });
      if (d.age > 120) {
        this.group.remove(d.obj);
        this.drops.splice(i, 1);
      }
    }
  }

  private collect(ctx: GameContext, d: Drop): void {
    this.group.remove(d.obj);
    if (d.kind === 'coins') {
      ctx.inventory.addCurrency(d.count);
      this.collected.coins += d.count;
      ctx.ui.notify(`+${d.count} coins`, 'success', 2, '🪙');
      ctx.audio.play('ui.coins', { volume: 0.7 });
    } else if (d.item) {
      ctx.inventory.add(d.item, d.count);
      this.collected.items += d.count;
      ctx.audio.play('ui.pickup', { volume: 0.7 });
    }
    ctx.vfx.burst('glow', d.pos, { color: '#fff0b0', size: 0.8, count: 1 });
  }

  /** Collect everything immediately (debug). */
  collectAll(ctx: GameContext): number {
    const n = this.drops.length;
    for (const d of this.drops) this.collect(ctx, d);
    this.drops = [];
    return n;
  }

  clear(): void {
    for (const d of this.drops) this.group.remove(d.obj);
    this.drops = [];
    coinGeo?.dispose();
    pouchGeo?.dispose();
    coinMat?.dispose();
    pouchMat?.dispose();
    tieMat?.dispose();
    coinGeo = pouchGeo = null;
    coinMat = pouchMat = tieMat = null;
  }
}
