import type { CreatureModel } from './CreatureModel';
import { SkyBisonModel } from './SkyBison';
import { DragonModel } from './Dragon';
import { PolarBearDogModel } from './PolarBearDog';
import { BadgermoleModel } from './Badgermole';
import { OstrichHorseModel } from './OstrichHorse';
import { TurtleDuckModel, WingedLemurModel } from './SmallCreatures';
import { ArmadilloLizardModel, CatOwlModel, ElephantKoiModel, HogMonkeyModel, OtterPenguinModel } from './Wildlife';

/**
 * Model factory per species id. `detail` scales tessellation (graphics
 * quality), `scale` scales the whole creature (pups, individual variation).
 */
export type ModelFactory = (variant: number, detail: number, scale: number) => CreatureModel;

const FACTORIES: Record<string, ModelFactory> = {
  sky_bison: (v, d, s) => new SkyBisonModel(v, d, s),
  dragon: (v, d, s) => new DragonModel(v, d, s),
  polar_bear_dog: (v, d, s) => new PolarBearDogModel(v, d, s),
  badgermole: (v, d, s) => new BadgermoleModel(v, d, s),
  ostrich_horse: (v, d, s) => new OstrichHorseModel(v, d, s),
  winged_lemur: (v, d, s) => new WingedLemurModel(v, d, s),
  turtle_duck: (v, d, s) => new TurtleDuckModel(v, d, s),
  otter_penguin: (v, d, s) => new OtterPenguinModel(v, d, s),
  cat_owl: (v, d, s) => new CatOwlModel(v, d, s),
  armadillo_lizard: (v, d, s) => new ArmadilloLizardModel(v, d, s),
  hog_monkey: (v, d, s) => new HogMonkeyModel(v, d, s),
  elephant_koi: (v, d, s) => new ElephantKoiModel(v, d, s),
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
