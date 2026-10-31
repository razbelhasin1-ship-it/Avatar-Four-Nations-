import { describe, expect, it } from 'vitest';
import '../../src/combat/techniques';
import { getTechnique } from '../../src/combat/CombatSystem';
import { COMBUSTION_ID, MarkingPerks } from '../../src/combat/techniques/fire/combustion';
import type { GameContext } from '../../src/core/GameContext';
import type { Element } from '../../src/core/types';
import { Progression } from '../../src/progression/Progression';

/** Just enough of a GameContext for MarkingPerks: session, progression, player, events. */
function world(facePaint: string, element: Element = 'fire', kind = 'campaign') {
  const on = new Map<string, Array<(e: unknown) => void>>();
  const notes: string[] = [];
  const progression = new Progression();
  progression.setupNewGame(element);
  const player = { appearance: { facePaint } };
  const ctx = {
    session: { active: true, kind, slot: 'slot1', isNew: true },
    progression,
    player,
    events: {
      on: (k: string, f: (e: unknown) => void) => on.set(k, [...(on.get(k) ?? []), f]),
      emit: (k: string, e: { text?: string }) => {
        if (k === 'ui:notify' && e.text) notes.push(e.text);
        for (const f of on.get(k) ?? []) f(e);
      },
    },
  } as unknown as GameContext;
  const perks = new MarkingPerks();
  perks.init(ctx);
  return { ctx, perks, progression, player, notes };
}

describe('combustionbending', () => {
  it('is a fire ability gained from the Third Eye, never taught', () => {
    const d = getTechnique(COMBUSTION_ID)!;
    expect(d.element).toBe('fire');
    expect(d.kind).toBe('ability');
    expect(d.innate).toBeTruthy();
    expect(d.starter).toBeFalsy();
  });

  it('a Fire Nation character with the Third Eye learns it at the start and it is slotted', () => {
    const w = world('fire_third_eye');
    w.perks.onSessionStart(w.ctx);
    expect(w.progression.knows(COMBUSTION_ID)).toBe(true);
    expect(w.progression.slotsFor('fire')).toContain(COMBUSTION_ID);
    expect(w.notes).toHaveLength(0);
  });

  it('nobody else learns it; putting on the eye mid-journey grants it with a notice', () => {
    const w = world('none');
    w.perks.onSessionStart(w.ctx);
    expect(w.progression.knows(COMBUSTION_ID)).toBe(false);
    w.player.appearance.facePaint = 'fire_third_eye';
    w.ctx.events.emit('appearance:changed', {});
    expect(w.progression.knows(COMBUSTION_ID)).toBe(true);
    expect(w.notes.some((t) => /combustionbend/i.test(t))).toBe(true);
  });

  it('needs firebending and a campaign session', () => {
    const water = world('fire_third_eye', 'water');
    water.perks.onSessionStart(water.ctx);
    expect(water.progression.knows(COMBUSTION_ID)).toBe(false);
    const tut = world('fire_third_eye', 'fire', 'tutorial');
    tut.perks.onSessionStart(tut.ctx);
    expect(tut.progression.knows(COMBUSTION_ID)).toBe(false);
  });

  it('the precheck refuses a caster without the eye', () => {
    const d = getTechnique(COMBUSTION_ID)!;
    const ctx = {} as GameContext;
    expect(d.precheck!({ humanoid: { appearance: { facePaint: 'none' } } } as never, ctx)?.reason).toBe('locked');
    expect(d.precheck!({ humanoid: { appearance: { facePaint: 'fire_third_eye' } } } as never, ctx)).toBeNull();
  });
});
