import { describe, expect, it } from 'vitest';
import { AMBIENCE_LAYERS, LAYER_GAIN, ambienceTargets, nightFactor, reverbFor, spotRates, type AmbienceContext } from '../../src/audio/AmbienceDirector';
import { voiceTypeFor } from '../../src/audio/AudioEvents';
import { THEMES, themeFor } from '../../src/audio/music/themes';
import { STEP_SURFACES, stepId } from '../../src/audio/recipes/footsteps';
import { listLoops, listSounds, loopMeta, soundMeta, soundTrim } from '../../src/audio/registry';
import '../../src/audio/recipes';
import '../../src/audio/trims';
import { REGIONS } from '../../src/world/WorldLayout';

const base = (o: Partial<AmbienceContext> = {}): AmbienceContext => ({
  x: 0,
  y: 10,
  z: 0,
  ground: 8,
  region: 'earth_heartland',
  theme: 'earth',
  biome: 'temperate',
  bw: { cold: 0, desert: 0, volcanic: 0, swamp: 0, tropical: 0, boreal: 0, dry: 0 },
  forest: 0.2,
  hour: 12,
  night: 0,
  seaDist: 999,
  seaFrozen: false,
  riverDist: 999,
  riverWidth: 0,
  riverFrozen: false,
  fallDist: 999,
  fallDrop: 0,
  lakeDist: 999,
  settlement: 0,
  market: 0,
  harbor: 0,
  temple: 0,
  spirit: 0,
  cave: 0,
  weather: 'clear',
  rain: 0,
  snow: 0,
  blizzard: 0,
  sand: 0,
  ash: 0,
  wind: 0.3,
  menu: false,
  ...o,
});

describe('sound library', () => {
  const sounds = new Set(listSounds());
  const loops = new Set(listLoops());

  it('covers every id the brief asks for', () => {
    const required = [
      'move.slide.snow', 'water.draw', 'water.splash', 'water.splash.small', 'water.droplets', 'water.drip', 'ice.form', 'ice.crack', 'ice.creak', 'ice.shatter',
      'stone.grind', 'stone.rise', 'stone.impact', 'stone.crumble', 'air.whoosh', 'air.gust', 'air.vortex', 'fire.whoosh', 'fire.roar', 'fire.explosion', 'fire.ignite',
      'lightning.crack', 'hit.physical', 'hit.block', 'hit.parry', 'hit.kill', 'dodge.air', 'dodge.water', 'dodge.earth', 'dodge.fire', 'body.fall', 'body.fall.heavy',
      'ui.hover', 'ui.click', 'ui.confirm', 'ui.back', 'ui.tab', 'ui.notify', 'ui.quest.complete', 'ui.technique.learned', 'ui.mastery', 'ui.discovery', 'ui.levelup',
      'creature.skybison.groan', 'creature.dragon.roar', 'creature.dragon.rumble', 'creature.polarbeardog.bark', 'creature.polarbeardog.growl', 'creature.badgermole.snort',
      'creature.ostrichhorse.squawk', 'creature.lemur.chirp', 'creature.turtleduck.quack', 'creature.wings.flap', 'creature.wings.flap_large',
      'avatar.surge', 'avatar.release', 'avatar.sphere.activate', 'ult.hurricane', 'ult.tsunami', 'ult.earthquake', 'ult.firetornado', 'ult.cataclysm', 'fail.nowater',
    ];
    expect(required.filter((id) => !sounds.has(id))).toEqual([]);
    const requiredLoops = ['loop.slide.snow', 'loop.water.stream', 'loop.water.river', 'loop.fire.crackle', 'loop.air.vortex', 'loop.avatar.hum', 'loop.avatar.sphere', 'loop.wings', 'loop.glide'];
    expect(requiredLoops.filter((id) => !loops.has(id))).toEqual([]);
    for (const v of ['male', 'female', 'child', 'elder_m', 'elder_f', 'gruff', 'monk', 'noble', 'spirit']) {
      expect(sounds.has(`voice.${v}`) && sounds.has(`voice.${v}.ask`) && sounds.has(`voice.${v}.short`)).toBe(true);
    }
  });

  it('has walk / run / land footsteps for every surface', () => {
    const surfaces = ['grass', 'tallgrass', 'dirt', 'mud', 'gravel', 'sand', 'rock', 'stone', 'cobble', 'plaster', 'wood', 'snow', 'packedsnow', 'ice', 'water', 'ash'];
    for (const s of surfaces) {
      expect(STEP_SURFACES).toContain(s);
      for (const m of ['walk', 'run', 'land']) expect(sounds.has(`step.${s}.${m}`)).toBe(true);
    }
    expect(stepId('snow', 7)).toBe('step.snow.run');
    expect(stepId('wood', 2)).toBe('step.wood.walk');
    expect(stepId('ice', 0, true)).toBe('step.ice.land');
    expect(stepId(undefined, 3)).toBe('step.dirt.walk');
  });

  it('documents every library sound and loop (desc + declared duration)', () => {
    for (const id of sounds) {
      if (!id.includes('.')) continue; // module-specific ids (underscored) belong to their modules
      const m = soundMeta(id);
      expect(m.desc, id).toBeTruthy();
      expect(m.duration ?? 0, id).toBeGreaterThan(0);
      expect(m.duration ?? 0, id).toBeLessThan(8);
    }
    for (const id of loops) if (id.includes('.')) expect(loopMeta(id).desc, id).toBeTruthy();
  });

  it('applies gain-staging trims only to measured hot recipes', () => {
    expect(soundTrim('fire.explosion')).toBeLessThan(1);
    expect(soundTrim('ui.click')).toBe(1);
  });

  it('runs every ambience layer the director may start', () => {
    for (const id of AMBIENCE_LAYERS) {
      expect(loops.has(id), id).toBe(true);
      expect(LAYER_GAIN[id] ?? 1).toBeGreaterThan(0);
    }
  });
});

describe('ambience director rules', () => {
  it('is day at noon and night at midnight, smooth at dusk', () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(0)).toBe(1);
    expect(nightFactor(23.5)).toBe(1);
    const dusk = nightFactor(20);
    expect(dusk).toBeGreaterThan(0.1);
    expect(dusk).toBeLessThan(0.9);
  });

  it('puts a strong summit wind on the Air Temple and none in the lowlands', () => {
    const summit = ambienceTargets(base({ y: 330, temple: 1, theme: 'air' }));
    const valley = ambienceTargets(base({ y: 12 }));
    expect(summit['amb.wind.high']).toBeGreaterThan(0.7);
    expect(summit['amb.temple']).toBeGreaterThan(0.9);
    expect(valley['amb.wind.high']).toBe(0);
    expect(valley['amb.wind']).toBeGreaterThan(0.1);
  });

  it('brings in surf near the sea (muted on frozen seas), rivers, falls and lakes by distance', () => {
    expect(ambienceTargets(base({ seaDist: 20 }))['amb.surf']).toBeGreaterThan(0.9);
    expect(ambienceTargets(base({ seaDist: 400 }))['amb.surf']).toBe(0);
    expect(ambienceTargets(base({ seaDist: 20, seaFrozen: true }))['amb.surf']).toBeLessThan(0.4);
    const wide = ambienceTargets(base({ riverDist: 3, riverWidth: 30 }));
    expect(wide['loop.water.river']).toBeGreaterThan(0.9);
    expect(wide['loop.water.stream']).toBe(0);
    const brook = ambienceTargets(base({ riverDist: 2, riverWidth: 6 }));
    expect(brook['loop.water.stream']).toBeGreaterThan(0.7);
    expect(ambienceTargets(base({ riverDist: 3, riverWidth: 30, riverFrozen: true }))['loop.water.river']).toBe(0);
    expect(ambienceTargets(base({ fallDist: 15, fallDrop: 20 }))['loop.water.waterfall']).toBeGreaterThan(0.9);
    expect(ambienceTargets(base({ lakeDist: 2 }))['loop.water.lake']).toBeGreaterThan(0.7);
  });

  it('swaps day life for night life', () => {
    const day = ambienceTargets(base({ forest: 0.9 }));
    const night = ambienceTargets(base({ forest: 0.9, hour: 23, night: 1 }));
    expect(day['amb.forest']).toBeGreaterThan(0.5);
    expect(night['amb.forest']).toBe(0);
    expect(night['amb.night']).toBeGreaterThan(0.5);
    expect(day['amb.night']).toBe(0);
    const spotsDay = spotRates(base({ forest: 0.9 }));
    const spotsNight = spotRates(base({ forest: 0.9, night: 1 }));
    const rate = (l: ReturnType<typeof spotRates>, id: string) => l.find((s) => s.id === id)?.rate ?? 0;
    expect(rate(spotsDay, 'amb.bird.chirp')).toBeGreaterThan(0);
    expect(rate(spotsNight, 'amb.bird.chirp')).toBe(0);
    expect(rate(spotsNight, 'amb.owl')).toBeGreaterThan(0);
  });

  it('voices towns, markets, biomes and caves', () => {
    const town = ambienceTargets(base({ settlement: 1, market: 1 }));
    expect(town['amb.city']).toBeGreaterThan(0.9);
    expect(town['amb.market']).toBeGreaterThan(0.9);
    expect(ambienceTargets(base({ settlement: 1, market: 1, night: 1 }))['amb.market']).toBe(0);
    const bw = base().bw;
    expect(ambienceTargets(base({ bw: { ...bw, swamp: 1 } }))['amb.swamp']).toBe(1);
    expect(ambienceTargets(base({ bw: { ...bw, desert: 1 } }))['amb.desert']).toBe(1);
    expect(ambienceTargets(base({ bw: { ...bw, volcanic: 1 } }))['amb.volcanic']).toBe(1);
    expect(ambienceTargets(base({ bw: { ...bw, cold: 1 } }))['amb.polar']).toBe(1);
    expect(reverbFor(base({ cave: 1 })).space).toBe('cave');
    expect(reverbFor(base({ settlement: 1 })).space).toBe('city');
    expect(reverbFor(base({ y: 330, temple: 1 })).space).toBe('temple');
  });

  it('layers weather (blizzard replaces snowfall, sandstorm replaces desert wind)', () => {
    expect(ambienceTargets(base({ weather: 'rain', rain: 1 }))['amb.rain']).toBe(1);
    const bl = ambienceTargets(base({ weather: 'blizzard', snow: 1, blizzard: 1, bw: { ...base().bw, cold: 1 } }));
    expect(bl['amb.blizzard']).toBe(1);
    expect(bl['amb.snowfall']).toBe(0);
    const ss = ambienceTargets(base({ weather: 'sandstorm', sand: 1, bw: { ...base().bw, desert: 1 } }));
    expect(ss['amb.sandstorm']).toBe(1);
    expect(ss['amb.desert']).toBe(0);
    expect(ambienceTargets(base({ ash: 0.8 }))['amb.ashfall']).toBeCloseTo(0.8);
  });

  it('keeps every target finite and within 0..1 for random contexts', () => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const c = base({
        y: r() * 400, forest: r(), hour: r() * 24, seaDist: r() * 300, riverDist: r() * 200, riverWidth: r() * 40, fallDist: r() * 200, fallDrop: r() * 30, lakeDist: r() * 100,
        settlement: r(), market: r(), harbor: r(), temple: r(), spirit: r(), cave: r(), rain: r(), snow: r(), blizzard: r(), sand: r(), ash: r(), wind: r() * 1.4,
        bw: { cold: r(), desert: r(), volcanic: r(), swamp: r(), tropical: r(), boreal: r(), dry: r() }, menu: r() > 0.8,
      });
      c.night = nightFactor(c.hour);
      for (const [k, v] of Object.entries(ambienceTargets(c))) {
        expect(Number.isFinite(v), k).toBe(true);
        expect(v, k).toBeGreaterThanOrEqual(0);
        expect(v, k).toBeLessThanOrEqual(1);
      }
      for (const s of spotRates(c)) expect(Number.isFinite(s.rate) && s.rate >= 0, s.id).toBe(true);
    }
  });
});

describe('music & voices', () => {
  it('has a theme for the menu and every region theme', () => {
    for (const id of ['menu', 'battle', ...new Set(REGIONS.map((r) => r.theme))]) {
      expect(THEMES[id], id).toBeTruthy();
      expect(themeFor(id).id).toBe(id);
    }
  });

  it('picks NPC voices from role / nation, deterministically', () => {
    expect(voiceTypeFor({ id: 'kid_1', role: 'child' })).toBe('child');
    expect(voiceTypeFor({ id: 'g1', role: 'guard' })).toBe('gruff');
    expect(voiceTypeFor({ id: 'gyatso', role: 'master', element: 'air' })).toBe('monk');
    expect(voiceTypeFor({ id: 'spirit_guide', role: 'villager' })).toBe('spirit');
    expect(voiceTypeFor({ id: 'abc', role: 'villager', nation: 'earth' })).toBe(voiceTypeFor({ id: 'abc', role: 'villager', nation: 'earth' }));
    expect(voiceTypeFor(undefined)).toBe('male');
  });
});
