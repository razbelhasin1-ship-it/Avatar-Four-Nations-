import { describe, expect, it } from 'vitest';
import '../../src/combat/techniques';
import { allTechniques } from '../../src/combat/CombatSystem';
import { HAIR_COLORS, HAIRSTYLES } from '../../src/character/Appearance';
import { FACE_PAINTS } from '../../src/character/Markings';
import { COSMETICS, EMPTY_SLOT_IDS } from '../../src/data/cosmetics';
import { SPECIES } from '../../src/data/creatures';
import { ENEMY_ARCHETYPES } from '../../src/data/enemies';
import { MASTERS as GAME_MASTERS } from '../../src/data/masters';
import { MAIN_QUESTS } from '../../src/data/quests_main';
import { SIDE_QUESTS as GAME_SIDE_QUESTS } from '../../src/data/quests_side';
import { SUBSKILL_QUESTS } from '../../src/data/quests_subskills';
import { WORLD_SIZE } from '../../src/world/WorldLayout';
import {
  ART_QUESTS,
  BOSSES,
  COMPANIONS,
  CREATOR,
  DISCOVERY_QUESTS,
  ENEMIES,
  MAIN_QUEST,
  MASTERS,
  SIDE_QUESTS,
  SUB_ARTS,
  TECHNIQUE_COUNT,
  TECHNIQUES,
  ULTIMATES,
  WILDLIFE,
} from '../../site/src/data/catalogue';

/** The website lists what the game has: same names, nothing missing, nothing invented. */
describe('website catalogue matches the game', () => {
  const siteTechniques = [...Object.values(TECHNIQUES).flat(), ...ULTIMATES, ...SUB_ARTS.flatMap((a) => a.moves)];
  const norm = (s: string) => s.replace(/[’']/g, "'");

  it('lists every technique in the game, by its in-game name', () => {
    const game = allTechniques();
    expect(siteTechniques.length).toBe(game.length);
    expect(TECHNIQUE_COUNT).toBe(game.length);
    for (const t of siteTechniques) {
      const def = game.find((g) => g.id === t.id);
      expect(def, t.id).toBeTruthy();
      expect(t.name, t.id).toBe(def!.name);
    }
    for (const [element, list] of Object.entries(TECHNIQUES)) {
      for (const t of list) expect(game.find((g) => g.id === t.id)!.element, t.id).toBe(element);
    }
  });

  it('names every master, with the techniques their lessons teach', () => {
    expect(MASTERS.map((m) => m.name).sort()).toEqual(GAME_MASTERS.map((m) => m.name).sort());
    const game = allTechniques();
    for (const m of GAME_MASTERS) {
      const site = MASTERS.find((s) => s.name === m.name)!;
      expect(site.element, m.name).toBe(m.element);
      expect(!!site.hidden, m.name).toBe(!!m.hidden);
      for (const l of m.lessons) {
        const tech = game.find((t) => t.id === l.technique);
        if (tech) expect(site.teaches, `${m.name} teaches ${tech.name}`).toContain(tech.name);
      }
    }
  });

  it('names every bondable companion and the wildlife', () => {
    const names = SPECIES.map((s) => s.name);
    for (const c of COMPANIONS) expect(names, c.name).toContain(c.name);
    for (const w of WILDLIFE) expect(names, w).toContain(w);
    expect(COMPANIONS.length + WILDLIFE.length).toBe(SPECIES.length);
  });

  it('names every enemy and boss', () => {
    const all = Object.values(ENEMY_ARCHETYPES);
    const regular = all.filter((e) => !e.id.startsWith('boss_')).map((e) => e.name);
    const bosses = all.filter((e) => e.id.startsWith('boss_')).map((e) => e.name);
    expect([...ENEMIES].sort()).toEqual([...regular].sort());
    expect(BOSSES.map((b) => b.name).sort()).toEqual([...bosses].sort());
  });

  it('names the quests by their in-game titles', () => {
    expect(SIDE_QUESTS.map(norm)).toEqual(GAME_SIDE_QUESTS.map((q) => norm(q.title)));
    const main = MAIN_QUESTS.map((q) => norm(q.title));
    expect(main).toContain(MAIN_QUEST);
    for (const d of DISCOVERY_QUESTS) expect(main).toContain(d);
    const arts = SUBSKILL_QUESTS.map((q) => norm(q.title));
    for (const a of ART_QUESTS) expect(arts).toContain(a);
  });

  it('counts the creator options and the size of the world correctly', () => {
    expect(CREATOR.hairstyles).toBe(HAIRSTYLES.length);
    expect(CREATOR.hairColors).toBe(HAIR_COLORS.length);
    expect(CREATOR.facePaints.sort()).toEqual(FACE_PAINTS.filter((p) => p.id !== 'none').map((p) => p.name).sort());
    expect(CREATOR.clothingPieces).toBe(COSMETICS.filter((c) => !EMPTY_SLOT_IDS.has(c.id)).length);
    expect(WORLD_SIZE).toBe(4096);
  });
});
