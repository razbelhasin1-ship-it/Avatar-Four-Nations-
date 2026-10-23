import { COSMETICS } from '../data/cosmetics';
import { cloneAppearance, DEFAULT_APPEARANCE, FACIAL_HAIR, HAIRSTYLES, SCARS, TATTOO_STYLES, type Appearance } from './Appearance';

/**
 * Named appearance sets for the character lab / verification screenshots.
 * NPC samples are injected by the caller (avoids importing gameplay systems here).
 */

export let npcSampler: ((seed: number, nation: string, role: string) => Appearance) | null = null;
export function setNpcSampler(f: (seed: number, nation: string, role: string) => Appearance): void {
  npcSampler = f;
}

const NATION_COLORS: Record<string, Appearance['colors']> = {
  air: DEFAULT_APPEARANCE.air.colors,
  water: DEFAULT_APPEARANCE.water.colors,
  earth: DEFAULT_APPEARANCE.earth.colors,
  fire: DEFAULT_APPEARANCE.fire.colors,
};

export function lookSet(name: string): Appearance[] {
  const base = (e: keyof typeof DEFAULT_APPEARANCE) => cloneAppearance(DEFAULT_APPEARANCE[e]);
  switch (name) {
    case 'defaults':
      return [base('air'), base('water'), base('earth'), base('fire')];
    case 'hairstyles':
      return HAIRSTYLES.map((h, i) => {
        const a = base(i % 2 ? 'earth' : 'water');
        a.hair.style = h.id;
        a.hair.color = ['#2b1d16', '#5a3a24', '#1a1412', '#7a5233'][i % 4];
        a.outfit.headwear = 'none_head';
        a.outfit.necklace = 'none_neck';
        a.face.preset = i % 6;
        return a;
      });
    case 'facial':
      return FACIAL_HAIR.map((f, i) => {
        const a = base('earth');
        a.facialHair = f.id;
        a.hair.style = 'short_crop';
        a.face.preset = [2, 4, 3, 4, 2, 4, 3][i];
        a.outfit.necklace = 'none_neck';
        return a;
      });
    case 'scars':
      return SCARS.map((s, i) => {
        const a = base(i % 2 ? 'fire' : 'water');
        a.scars = [s.id];
        a.outfit.necklace = 'none_neck';
        a.outfit.top = 'fire_training';
        return a;
      });
    case 'tattoos':
      return TATTOO_STYLES.map((t) => {
        const a = base('air');
        a.tattoos = t.id;
        a.outfit.top = 'air_training_wrap';
        a.outfit.outer = 'none';
        a.outfit.necklace = 'none_neck';
        a.outfit.footwear = 'barefoot_wraps';
        return a;
      });
    case 'faces':
      return [0, 1, 2, 3, 4, 5].map((p) => {
        const a = base(p % 2 ? 'water' : 'earth');
        a.face.preset = p;
        a.hair.style = 'short_crop';
        a.outfit.necklace = 'none_neck';
        return a;
      });
    case 'eyes':
      return (['round', 'almond', 'narrow', 'wide'] as const).map((s) => {
        const a = base('water');
        a.eyes.shape = s;
        return a;
      });
    case 'nations': {
      const out: Appearance[] = [];
      const sets: Array<[keyof typeof DEFAULT_APPEARANCE, Partial<Appearance['outfit']>, Partial<Appearance>?]> = [
        ['water', {}],
        ['water', { top: 'water_tunic', bottom: 'water_skirt', gloves: 'none_gloves', necklace: 'water_moon_pendant' }, { hair: { style: 'hair_loops', color: '#2b1d16' } } as Partial<Appearance>],
        ['earth', {}],
        ['earth', { top: 'earth_formal', bottom: 'earth_robe_skirt', footwear: 'earth_boots', gloves: 'none_gloves', headwear: 'earth_hairpin', belt: 'none_belt' }, { hair: { style: 'bun', color: '#1a1412' } } as Partial<Appearance>],
        ['fire', {}],
        ['fire', { top: 'fire_royal_robe', bottom: 'fire_hakama', headwear: 'fire_royal_crown', gloves: 'none_gloves' }, { hair: { style: 'topknot', color: '#1a1412' } } as Partial<Appearance>],
        ['air', {}],
        ['air', { top: 'air_elder_robe', outer: 'none', headwear: 'air_monk_hat', accessory: 'air_glider' }, { facialHair: 'beard_long', hair: { style: 'bald', color: '#d8d8d8' } } as Partial<Appearance>],
      ];
      for (const [e, o, extra] of sets) {
        const a = base(e);
        Object.assign(a.outfit, o);
        if (extra) Object.assign(a, extra);
        out.push(a);
      }
      return out;
    }
    case 'necklaces':
      return COSMETICS.filter((c) => c.slot === 'necklace' && c.id !== 'none_neck').map((c) => {
        const a = base(c.nation === 'fire' ? 'fire' : c.nation === 'earth' ? 'earth' : c.nation === 'air' ? 'air' : 'water');
        a.outfit.necklace = c.id;
        a.outfit.outer = 'none';
        if (c.nation === 'any') a.colors = NATION_COLORS.water;
        return a;
      });
    case 'npcs': {
      const out: Appearance[] = [];
      const nations = ['water', 'earth', 'fire', 'air'];
      const roles = ['villager', 'guard', 'merchant', 'elder', 'monk', 'soldier', 'noble', 'child'];
      if (npcSampler) for (let i = 0; i < 16; i++) out.push(npcSampler(1000 + i * 17, nations[i % 4], roles[(i >> 2) % roles.length]));
      return out;
    }
    default:
      return [base('water')];
  }
}

