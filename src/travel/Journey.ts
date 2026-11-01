import type { GameContext } from '../core/GameContext';
import type { RouteDef } from '../data/travel';
import { JourneyDirector } from './cinema';
import type { Destination } from './TravelSystem';

/**
 * The trip itself: a short, skippable cutscene (src/travel/cinema.ts) — departure, the open sea or
 * the clouds while the destination streams in, an aerial reveal, arrival. `instant` skips the shots.
 * `load` places the traveller at the destination and waits until the world there is ready.
 */
export class Journey {
  private readonly director = new JourneyDirector();

  async run(ctx: GameContext, route: RouteDef, dest: Destination, instant: boolean, load: () => Promise<void>): Promise<void> {
    if (instant) return this.director.instant(load);
    const islandReady = () => !!(ctx.world.getRegionContent('kyoshi_isle') as { ready?: boolean } | undefined)?.ready;
    await this.director.run(ctx, route, dest.title, load, islandReady);
  }

  update(_dt: number, _ctx: GameContext): void {}

  skip(): void {
    this.director.skip();
  }

  cancel(ctx: GameContext): void {
    this.director.cancel(ctx);
  }

  state(): { phase: string; skip: boolean } {
    return { phase: this.director.phase, skip: this.director.skipping };
  }
}
