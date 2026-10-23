import { describe, expect, it } from 'vitest';
import '../../src/combat/techniques';
import { allTechniques, getTechnique } from '../../src/combat/CombatSystem';
import { AI_ATTACKS } from '../../src/ai/attacks';
import { BOSS_ENCOUNTERS, ENCOUNTER_TABLES, ENEMY_ARCHETYPES } from '../../src/data/enemies';
import { itemById } from '../../src/data/items';

describe('enemy data', () => {
  it('every archetype technique is a registered technique or an AI attack', () => {
    for (const a of Object.values(ENEMY_ARCHETYPES)) {
      const all = [...a.techniques, ...(a.phases ?? []).flatMap((p) => p.techniques ?? [])];
      for (const t of all) {
        const ok = t.id.startsWith('atk_') ? !!AI_ATTACKS[t.id] : !!getTechnique(t.id);
        expect(ok, `${a.id}: ${t.id}`).toBe(true);
      }
    }
  });

  it('benders only use their own element; waterbenders keep a melee fallback', () => {
    for (const a of Object.values(ENEMY_ARCHETYPES)) {
      for (const t of a.techniques) {
        const def = getTechnique(t.id);
        if (def) expect(def.element, `${a.id}: ${t.id}`).toBe(a.element);
      }
      if (a.element === 'water') expect(a.techniques.some((t) => t.id.startsWith('atk_') && t.weight === 0)).toBe(true);
    }
  });

  it('AI attacks never leak into the player technique catalogue', () => {
    const ids = new Set(allTechniques().map((t) => t.id));
    for (const id of Object.keys(AI_ATTACKS)) expect(ids.has(id)).toBe(false);
  });

  it('loot items exist; bosses have descending phases; encounters reference real archetypes', () => {
    for (const a of Object.values(ENEMY_ARCHETYPES)) {
      for (const l of a.loot.items) expect(itemById(l.item), `${a.id}: ${l.item}`).toBeTruthy();
      if (a.phases) {
        expect(a.rank).toBe('boss');
        for (let i = 1; i < a.phases.length; i++) expect(a.phases[i].at).toBeLessThan(a.phases[i - 1].at);
        for (const p of a.phases) for (const s of p.summon ?? []) expect(ENEMY_ARCHETYPES[s], s).toBeTruthy();
      }
      expect(a.tags.length).toBeGreaterThan(0);
    }
    for (const list of Object.values(ENCOUNTER_TABLES)) for (const t of list) for (const m of t.members) expect(ENEMY_ARCHETYPES[m], m).toBeTruthy();
    expect(BOSS_ENCOUNTERS.length).toBe(3);
    for (const b of BOSS_ENCOUNTERS) {
      expect(ENEMY_ARCHETYPES[b.boss].rank).toBe('boss');
      expect(ENEMY_ARCHETYPES[b.boss].tags).toContain(`boss_${b.boss.replace(/^boss_/, '')}`);
    }
  });
});
