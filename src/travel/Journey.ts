import type { GameContext } from '../core/GameContext';
import type { RouteDef } from '../data/travel';
import type { Destination } from './TravelSystem';

/**
 * The trip itself: departure, the cruise while the destination streams in, arrival. Skippable.
 * `load` places the traveller at the destination and waits until the world there is ready.
 */
export class Journey {
  private phase: 'idle' | 'cruise' = 'idle';
  private skipRequested = false;

  async run(ctx: GameContext, _route: RouteDef, dest: Destination, _instant: boolean, load: () => Promise<void>): Promise<void> {
    this.phase = 'cruise';
    this.skipRequested = false;
    ctx.ui.showLoading(`${dest.title} · ${dest.subtitle}`);
    try {
      await load();
    } finally {
      ctx.ui.hideLoading();
      this.phase = 'idle';
    }
  }

  update(_dt: number, _ctx: GameContext): void {}

  skip(): void {
    this.skipRequested = true;
  }

  cancel(ctx: GameContext): void {
    if (this.phase !== 'idle') ctx.ui.hideLoading();
    this.phase = 'idle';
  }

  state(): { phase: string; skip: boolean } {
    return { phase: this.phase, skip: this.skipRequested };
  }
}
