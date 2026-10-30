import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';

/**
 * A small pool of real point lights that follow the lanterns nearest the
 * camera, so warm light actually falls on the ice around the player at
 * night while the rest of the city glows through emissive lanterns and
 * windows (bloom). Only active with the "dynamic lights" graphics setting;
 * lights fade out before they move to another lantern (no popping).
 */
export class LanternLights {
  private readonly lights: THREE.PointLight[] = [];
  private readonly lamp: Int32Array;
  private readonly want: Int32Array;
  private readonly level: Float32Array;
  private timer = 0;
  private attached = false;

  constructor(
    private readonly parent: THREE.Object3D,
    /** Lantern centres as x, y, z triples. */
    private readonly pos: Float32Array,
    count: number,
    private readonly peak = 26,
  ) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight('#ffb35c', 0, 15, 2);
      l.name = 'agna_lantern_light';
      this.lights.push(l);
    }
    this.lamp = new Int32Array(count).fill(-1);
    this.want = new Int32Array(count).fill(-1);
    this.level = new Float32Array(count);
  }

  get count(): number {
    return this.pos.length / 3;
  }

  /** Lights currently attached and lit (for tests). */
  lit(): number {
    return this.attached ? this.lights.filter((l) => l.intensity > 0.01).length : 0;
  }

  update(dt: number, ctx: GameContext): void {
    const enabled = ctx.settings.data.graphics.dynamicLights && this.pos.length > 0;
    if (!enabled) {
      this.off();
      return;
    }
    if (!this.attached) {
      for (const l of this.lights) this.parent.add(l);
      this.attached = true;
      this.timer = 0;
    }
    const night = 1 - Math.max(0, Math.min(1, ctx.world.sky.daylight ?? 1));
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.35;
      this.pick(ctx.camera.position);
    }
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      if (this.lamp[i] !== this.want[i]) {
        this.level[i] = Math.max(0, this.level[i] - dt * 4);
        if (this.level[i] === 0) {
          this.lamp[i] = this.want[i];
          const k = this.lamp[i] * 3;
          if (k >= 0) l.position.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
        }
      } else if (this.lamp[i] >= 0) this.level[i] = Math.min(1, this.level[i] + dt * 3);
      l.intensity = this.lamp[i] >= 0 ? this.level[i] * night * this.peak : 0;
    }
  }

  /** Assign the nearest lanterns to light slots, keeping slots whose lantern is still among them. */
  private pick(cam: THREE.Vector3): void {
    const n = this.lights.length;
    const best: number[] = [], dist: number[] = [];
    for (let i = 0, k = 0; k < this.pos.length; i++, k += 3) {
      const dx = this.pos[k] - cam.x, dy = this.pos[k + 1] - cam.y, dz = this.pos[k + 2] - cam.z;
      const d = dx * dx + dy * dy * 2 + dz * dz;
      if (best.length === n && d >= dist[n - 1]) continue;
      let j = best.length < n ? best.length : n - 1;
      while (j > 0 && dist[j - 1] > d) {
        best[j] = best[j - 1];
        dist[j] = dist[j - 1];
        j--;
      }
      best[j] = i;
      dist[j] = d;
    }
    const chosen = new Set(best.filter((_, j) => dist[j] < 60 * 60));
    const free: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.want[i] >= 0 && chosen.has(this.want[i])) chosen.delete(this.want[i]);
      else free.push(i);
    }
    for (const lamp of chosen) {
      const slot = free.pop();
      if (slot === undefined) break;
      this.want[slot] = lamp;
    }
    for (const slot of free) this.want[slot] = -1;
  }

  /** Detach every light (setting off, region far away, session over). */
  off(): void {
    if (!this.attached) return;
    for (const l of this.lights) {
      this.parent.remove(l);
      l.intensity = 0;
    }
    this.lamp.fill(-1);
    this.want.fill(-1);
    this.level.fill(0);
    this.attached = false;
  }

  dispose(): void {
    this.off();
    for (const l of this.lights) l.dispose();
  }
}
