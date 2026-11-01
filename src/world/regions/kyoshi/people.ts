import type { Appearance } from '../../../character/Appearance';
import { npcLook } from '../../../character/looks';
import { Random } from '../../../core/Random';

/**
 * Everyone on Kyoshi Island is a woman in the Kyoshi Warrior outfit (the project owner's direction):
 * green kimono over a dark green skirt, dark armour with gold studs, gold headdress, white face paint
 * with red eye make-up, a pair of gold fans. Jobs (harbor, fields, kitchens, dojo) keep their routines.
 */
export function kyoshiLook(seed: number, opts: { elder?: boolean; captain?: boolean } = {}): Appearance {
  const rng = new Random(seed * 131 + 7);
  const a = npcLook(seed, 'earth', opts.elder ? 'elder' : 'guard');
  a.body = 'female';
  a.facialHair = 'none';
  a.scars = [];
  a.frame = rng.pick(['slim', 'average', 'athletic'] as const);
  a.height = Math.round(rng.range(0.93, 1.02) * 100) / 100;
  a.build = Math.round(rng.range(0.3, 0.6) * 100) / 100;
  a.hair = { style: rng.pick(['bun', 'long_loose', 'long_braid']), color: opts.elder ? rng.pick(['#8c8c8c', '#b0b0b0']) : rng.pick(['#1a1412', '#2b1d16', '#3f2a1d', '#5a3a24']) };
  a.brows = { style: rng.int(0, 3), thickness: 0.35, color: '#141010' };
  a.facePaint = 'earth_kyoshi';
  a.outfit = {
    top: 'earth_kyoshi',
    bottom: 'earth_robe_skirt',
    footwear: 'earth_boots',
    outer: 'none',
    gloves: 'earth_wraps',
    belt: 'earth_belt',
    headwear: 'earth_headband',
    necklace: 'none_neck',
    accessory: 'fans',
  };
  a.colors = { primary: '#3f7f45', secondary: '#c9a227', accent: '#2c4a30', trim: '#1e2620' };
  void opts.captain;
  return a;
}
