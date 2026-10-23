import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { defaultAnim, type AnimInput, type CreatureAction, type CreatureModel } from './models/CreatureModel';
import { createModel } from './models';

/**
 * Model viewer for screenshots and model iteration: places animated, AI-less
 * creature models in the world (window.__game.debug.companions.viewModel).
 */
export class ModelViewer {
  private items: Array<{ model: CreatureModel; anim: AnimInput; base: THREE.Vector3; yaw: number; walk: number; fly: boolean }> = [];

  constructor(private readonly ctx: GameContext) {}

  show(speciesId: string, opts: { x?: number; z?: number; y?: number; dist?: number; side?: number; yaw?: number; variant?: number; action?: CreatureAction; speed?: number; flying?: boolean; scale?: number; saddle?: boolean; look?: boolean } = {}): { x: number; y: number; z: number } | null {
    const ctx = this.ctx;
    const p = ctx.player;
    let x = opts.x, z = opts.z;
    if ((x === undefined || z === undefined) && p) {
      const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const at = p.position.clone().addScaledVector(f, opts.dist ?? 8).addScaledVector(r, opts.side ?? 0);
      x = at.x;
      z = at.z;
    }
    if (x === undefined || z === undefined) return null;
    const model = createModel(speciesId, opts.variant ?? 0, 1, opts.scale ?? 1);
    if (!model) return null;
    const y = opts.y ?? ctx.world.groundAt(x, z, Infinity).y;
    model.root.position.set(x, y, z);
    const yaw = opts.yaw ?? (p ? Math.atan2(p.position.x - x, p.position.z - z) : 0);
    model.root.rotation.y = yaw;
    model.setSaddle(!!opts.saddle);
    model.setShadows(ctx.settings.data.graphics.shadows !== 'off');
    ctx.scene.add(model.root);
    const anim = defaultAnim();
    anim.action = opts.action ?? 'none';
    anim.flying = !!opts.flying;
    anim.grounded = !opts.flying;
    anim.speed = opts.speed ?? 0;
    this.items.push({ model, anim, base: model.root.position.clone(), yaw, walk: 0, fly: !!opts.flying });
    if (opts.look !== false && p) anim.look = p.aimPoint(new THREE.Vector3());
    return { x, y, z };
  }

  update(dt: number): void {
    const p = this.ctx.player;
    for (const it of this.items) {
      it.anim.dt = dt;
      it.anim.time += dt;
      it.anim.actionT += dt;
      if (it.anim.look && p) p.aimPoint(it.anim.look);
      it.model.update(it.anim);
    }
  }

  clear(): void {
    for (const it of this.items) it.model.dispose();
    this.items = [];
  }

  get count(): number {
    return this.items.length;
  }
}
