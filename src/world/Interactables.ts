import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';

/**
 * Anything the player can interact with via the Interact action:
 * NPCs, masters, shrines, chests, signs, companions, mounts, boats...
 */
export interface Interactable {
  id: string;
  /** Live position reference is fine (e.g. an entity's root.position). */
  position: THREE.Vector3;
  /** Max interaction distance (m). */
  radius: number;
  /** Prompt text, e.g. "Talk to Master Pakku". */
  label: string;
  /** Higher wins when several are in range. */
  priority?: number;
  /** Only show/allow when true. */
  enabled?(): boolean;
  interact(ctx: GameContext): void;
}

export class InteractionSystem implements GameSystem {
  private items = new Map<string, Interactable>();
  private ctx!: GameContext;
  /** Current best candidate (for the HUD prompt). */
  current: Interactable | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  register(i: Interactable): () => void {
    this.items.set(i.id, i);
    return () => {
      if (this.items.get(i.id) === i) this.items.delete(i.id);
    };
  }

  unregister(id: string): void {
    this.items.delete(id);
  }

  get(id: string): Interactable | undefined {
    return this.items.get(id);
  }

  nearest(pos: THREE.Vector3, yaw?: number): Interactable | null {
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (const i of this.items.values()) {
      if (i.enabled && !i.enabled()) continue;
      const dx = i.position.x - pos.x, dz = i.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > i.radius || Math.abs(i.position.y - pos.y) > 3.5) continue;
      let score = d - (i.priority ?? 0) * 2;
      if (yaw !== undefined && d > 0.5) {
        const dot = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
        score -= dot * 0.8;
      }
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  update(_dt: number): void {
    const p = this.ctx.player;
    if (!p || this.ctx.ui.blocksGameplay) {
      this.current = null;
      return;
    }
    this.current = this.nearest(p.position, p.yaw);
    if (this.current && this.ctx.input.wasPressed('interact')) {
      this.ctx.input.consume('interact');
      try {
        this.current.interact(this.ctx);
      } catch (err) {
        console.error('[Interact] failed', err);
      }
    }
  }

  onSessionEnd(): void {
    this.items.clear();
    this.current = null;
  }
}
