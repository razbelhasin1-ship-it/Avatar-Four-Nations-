import type { CreatureModel } from './CreatureModel';
import { SkyBisonModel } from './SkyBison';

/**
 * Model factory per species id. `detail` scales tessellation (graphics
 * quality), `scale` scales the whole creature (pups, individual variation).
 */
export type ModelFactory = (variant: number, detail: number, scale: number) => CreatureModel;

const FACTORIES: Record<string, ModelFactory> = {
  sky_bison: (v, d, s) => new SkyBisonModel(v, d, s),
};

export function registerModelFactory(speciesId: string, f: ModelFactory): void {
  FACTORIES[speciesId] = f;
}

export function createModel(speciesId: string, variant = 0, detail = 1, scale = 1): CreatureModel | null {
  const f = FACTORIES[speciesId];
  return f ? f(variant, detail, scale) : null;
}

export function hasModel(speciesId: string): boolean {
  return speciesId in FACTORIES;
}
