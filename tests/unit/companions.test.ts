import { describe, expect, it } from 'vitest';
import { abilitiesAt, bondLevel, foodValue, HABITATS, HOMELAND_FOOD, SPECIES, speciesById, SUN_STONE_SHARDS, SUN_STONES_NEEDED } from '../../src/data/creatures';
import { itemById } from '../../src/data/items';
import { createModel, hasModel } from '../../src/companions/models';
import { defaultAnim } from '../../src/companions/models/CreatureModel';
import { CompanionSystem } from '../../src/companions/CompanionSystem';
import { angleDiff, rng } from '../../src/companions/Creature';

describe('creature catalogue', () => {
  it('every species has a procedural model that animates', () => {
    for (const s of SPECIES) {
      expect(hasModel(s.id), s.id).toBe(true);
      const m = createModel(s.id, 0, 0.6, 1)!;
      expect(m, s.id).toBeTruthy();
      const a = defaultAnim();
      a.dt = 1 / 30;
      a.speed = s.walk;
      a.flying = s.flying && s.id !== 'winged_lemur';
      m.update(a);
      if (s.rideable) expect(m.seat, `${s.id} seat`).toBeTruthy();
      m.dispose();
    }
  });

  it('diets, starting food and quest items exist in the item catalogue', () => {
    for (const s of SPECIES) for (const id of [...s.diet.preferred, ...s.diet.liked]) expect(itemById(id), `${s.id} eats ${id}`).toBeTruthy();
    for (const f of Object.values(HOMELAND_FOOD)) expect(itemById(f.item)).toBeTruthy();
    expect(itemById('sun_stone')).toBeTruthy();
    expect(SUN_STONE_SHARDS.length).toBe(SUN_STONES_NEEDED);
  });

  it('habitats reference tameable species, stream beyond their roaming radius, and only the dragon is gated', () => {
    for (const h of HABITATS) {
      const s = speciesById(h.species);
      expect(s, h.id).toBeTruthy();
      expect(h.spawnRadius).toBeGreaterThan(h.radius);
      if (h.rescue) expect(h.rescue.member).toBeLessThan(h.count);
      if (h.requires) expect(h.species).toBe('dragon');
    }
    expect(HABITATS.filter((h) => h.species === 'dragon').reduce((n, h) => n + h.count, 0)).toBe(1);
  });

  it('taming differs per species (no single generic bar)', () => {
    const tame = SPECIES.filter((s) => s.tameable && s.taming);
    const sig = new Set(tame.map((s) => JSON.stringify([s.taming!.calmGain, s.taming!.feedPreferred, s.taming!.feedCooldown, s.taming!.challenge, s.temperament])));
    expect(sig.size).toBe(tame.length);
    expect(speciesById('sky_bison')!.taming!.challenge).toBe('follow_flight');
    expect(speciesById('ostrich_horse')!.taming!.challenge).toBe('race');
    expect(speciesById('dragon')!.taming!.challenge).toBe('fearless');
    expect(foodValue('sky_bison', 'moon_peaches')).toBe('preferred');
    expect(foodValue('polar_bear_dog', 'sea_prunes')).toBe('preferred');
    expect(foodValue('polar_bear_dog', 'moon_peaches')).toBe(null);
  });

  it('bond levels and unlocks grow monotonically', () => {
    expect(bondLevel(0)).toBe(1);
    expect(bondLevel(100)).toBe(5);
    for (const s of SPECIES.filter((x) => x.tameable)) {
      let prev = 0;
      for (let b = 0; b <= 100; b += 5) {
        const n = abilitiesAt(s.id, b).length;
        expect(n).toBeGreaterThanOrEqual(prev);
        prev = n;
      }
    }
    expect(abilitiesAt('sky_bison', 0)).toContain('flight');
    expect(abilitiesAt('dragon', 25)).toContain('fire_breath');
  });

  it('helpers', () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(Math.abs(angleDiff(3.1, -3.1))).toBeLessThan(0.1);
    const r1 = rng(42), r2 = rng(42);
    for (let i = 0; i < 5; i++) expect(r1()).toBe(r2());
  });
});

describe('companion persistence', () => {
  const fakeCtx = { session: { kind: 'campaign' } } as any;

  it('round-trips bonded companions exactly once and tolerates bad data', () => {
    const a = new CompanionSystem();
    (a as any).ctx = fakeCtx;
    a.deserialize({
      v: 2,
      bonded: [
        { id: 'bison_meadow#0', speciesId: 'sky_bison', name: 'Appa', bond: 55, variant: 1, abilities: ['bogus'], active: true, home: { x: 1, z: 2 }, summoned: true },
        { id: 'bison_meadow#0', speciesId: 'sky_bison', name: 'Dupe', bond: 10 },
        { id: 'x', speciesId: 'not_a_species' },
        null,
        { id: 'bear_dog_den#0', speciesId: 'polar_bear_dog', name: '', bond: 500 },
      ],
      discovered: ['sky_bison', 3],
      trust: { 'ostrich_fields#1': 42, bad: 'x' },
      flags: ['dragon_called', 7],
    });
    expect(a.bonded.map((r) => r.id)).toEqual(['bison_meadow#0', 'bear_dog_den#0']);
    const appa = a.bonded[0];
    expect(appa.name).toBe('Appa');
    expect(appa.abilities).toEqual(abilitiesAt('sky_bison', 55));
    expect(a.bonded[1].bond).toBe(100);
    expect(a.bonded[1].name).toBe('Polar Bear Dog');
    expect(a.flags.has('dragon_called')).toBe(true);
    expect(a.wildTrust.get('ostrich_fields#1')).toBe(42);
    expect(a.bondedCount('sky_bison')).toBe(1);

    const data = JSON.parse(JSON.stringify(a.serialize()));
    const b = new CompanionSystem();
    (b as any).ctx = fakeCtx;
    b.deserialize(data);
    b.deserialize(data); // loading twice must not duplicate
    expect(b.bonded.map((r) => `${r.id}:${r.name}:${r.bond}`)).toEqual(a.bonded.map((r) => `${r.id}:${r.name}:${r.bond}`));
    expect([...b.discoveredSpecies]).toEqual(['sky_bison']);
    b.reset();
    expect(b.bonded.length).toBe(0);
    b.deserialize(undefined);
    b.deserialize({ bonded: 'nope' });
    expect(b.bondedCount()).toBe(0);
  });
});
